import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { OffsiteObject, OffsiteSettingsInput, OffsiteStatus } from "@panel/shared";
import { db, schema } from "../../db/index.js";
import { HttpError } from "../../lib/errors.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import { backupDir, backupEvents, backupFilePath, getBackupSettings } from "../backups/service.js";
import { notify, sendDirectEmail } from "../notify/service.js";
import { decryptFile, encryptStream, fingerprint, isDecryptError, isWrappedKey, newKey, parseKey, unwrapKey, wrapKey } from "./crypto.js";
import { panelDateTime, pt } from "../../lib/i18n.js";

/**
 * Sunucu dışı yedek kopyası. Her başarılı yedek, şifrelenip S3 uyumlu bir depoya (Cloudflare R2,
 * Backblaze B2, Hetzner…) gönderilir. Ayarlar ve kurtarma anahtarı panelin şifreli ayarlarında durur.
 * Nesne adı: <önek><yedek dosya adı>.enc · Yerel yedek silinince buluttaki silinmez; buluttakiler
 * kendi saklama süresiyle temizlenir (her hedefin en son yedeği kalır).
 */
const SETTINGS_KEY = "offsite_settings";
const KEY_KEY = "offsite_key";
/** Anahtarın panel dışına en son ne zaman alındığı; parmak iziyle bağlı (anahtar değişirse geçersiz) */
const SAVED_KEY = "offsite_key_saved";
type Saved = { at: number; via: "shown" | "emailed" | "imported"; fingerprint: string };

function markKeySaved(via: Saved["via"], key: Buffer) {
  setSecret(SAVED_KEY, { at: Date.now(), via, fingerprint: fingerprint(key) } satisfies Saved);
}

type Stored = Omit<OffsiteSettingsInput, "key">;
const getStored = () => getSecret<Stored>(SETTINGS_KEY);
const getKey = () => {
  const k = getSecret<string>(KEY_KEY);
  return k ? parseKey(k) : null;
};

function client(s: Stored) {
  return new S3Client({
    endpoint: s.endpoint,
    region: s.region || "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
    // R2 ve diğer S3 uyumlu servislerle uyum: sadece gerektiğinde sağlama toplamı
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
}

const s3Error = (err: unknown) => {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = e.$metadata?.httpStatusCode;
  if (e.name === "NoSuchBucket") return pt("errors:offsite.noBucket");
  if (e.name === "InvalidAccessKeyId" || e.name === "SignatureDoesNotMatch" || code === 403 || code === 401) {
    return pt("errors:offsite.accessDenied");
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/.test(e.message ?? "")) return pt("errors:offsite.unreachable", { error: e.message });
  return `${e.name ?? pt("errors:offsite.genericName")}: ${e.message ?? String(err)}`.slice(0, 400);
};

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
export function getStatus(): OffsiteStatus {
  const s = getStored();
  const key = getKey();
  const count = (st: "pending" | "failed") =>
    db.select({ id: schema.backups.id }).from(schema.backups).where(eq(schema.backups.remoteStatus, st)).all().length;
  const last = db
    .select({ at: schema.backups.remoteAt })
    .from(schema.backups)
    .where(and(eq(schema.backups.remoteStatus, "uploaded"), isNotNull(schema.backups.remoteAt)))
    .orderBy(desc(schema.backups.remoteAt))
    .limit(1)
    .get();
  return {
    configured: !!s,
    settings: s ? { enabled: s.enabled, endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKeyId: s.accessKeyId, prefix: s.prefix, retentionDays: s.retentionDays } : null,
    hasSecret: !!s?.secretAccessKey,
    keyFingerprint: key ? fingerprint(key) : null,
    keySaved: keySavedState(key),
    pending: count("pending"),
    failed: count("failed"),
    lastUploadAt: last?.at ?? null,
  };
}

function keySavedState(key: Buffer | null): OffsiteStatus["keySaved"] {
  const s = getSecret<Saved>(SAVED_KEY);
  if (!key || !s || s.fingerprint !== fingerprint(key)) return null;
  return { at: s.at, via: s.via };
}

function merge(input: OffsiteSettingsInput): Stored {
  const prev = getStored();
  const secret = input.secretAccessKey || prev?.secretAccessKey || "";
  if (!secret) throw new HttpError(400, "errors:offsite.secretRequired");
  const { key: _key, ...rest } = input;
  return { ...rest, secretAccessKey: secret };
}

/** Bağlantıyı dener: küçük bir nesne yaz, oku, sil */
export async function testConnection(input: OffsiteSettingsInput) {
  const s = merge(input);
  const c = client(s);
  const key = `${s.prefix}.panel-baglanti-testi-${Date.now()}`;
  try {
    await c.send(new PutObjectCommand({ Bucket: s.bucket, Key: key, Body: "ok" }));
    const got = await c.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }));
    if ((await got.Body?.transformToString()) !== "ok") throw new Error(pt("errors:offsite.testReadBack"));
    await c.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key }));
  } catch (err) {
    throw new HttpError(400, s3Error(err));
  } finally {
    c.destroy();
  }
  return { ok: true };
}

export async function saveSettings(input: OffsiteSettingsInput) {
  const s = merge(input);
  if (input.key) {
    // Yeni sunucuda eski yedekleri açabilmek için mevcut anahtarı kullan (düz ya da e-postadaki parolalı biçim)
    let k: Buffer;
    try {
      if (isWrappedKey(input.key)) {
        if (!input.keyPassphrase) throw new Error(pt("errors:offsite.wrappedNeedsPassphrase"));
        k = await unwrapKey(input.key, input.keyPassphrase);
      } else {
        k = parseKey(input.key);
      }
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    setSecret(KEY_KEY, k.toString("base64"));
    markKeySaved("imported", k);
  } else if (!getKey()) {
    setSecret(KEY_KEY, newKey().toString("base64"));
  }
  setSecret(SETTINGS_KEY, s);
  if (s.enabled) {
    // Açıldığında son yedekleri sıraya al (hedef başına en yenisi)
    queueLatest();
    kick();
  }
  return getStatus();
}

/** Kurtarma anahtarını parolayla şifreleyip bildirim e-postasına gönderir; parola saklanmaz, e-postaya yazılmaz */
export async function emailKey(passphrase: string) {
  const key = getKey();
  if (!key) throw new HttpError(404, "errors:offsite.noKey");
  const wrapped = await wrapKey(key, passphrase);
  const when = new Date();
  const body = pt("notify:offsite.keyEmailBody", { date: panelDateTime(when), fingerprint: fingerprint(key), key: wrapped });
  try {
    const to = await sendDirectEmail(pt("notify:offsite.keyEmailSubject", { app: pt("messages:appName") }), body);
    markKeySaved("emailed", key);
    return { sentTo: to, fingerprint: fingerprint(key), sentAt: when.getTime() };
  } catch (err) {
    throw new HttpError(400, (err as Error).message);
  }
}

export function revealKey() {
  const k = getSecret<string>(KEY_KEY);
  if (!k) throw new HttpError(404, "errors:offsite.noKey");
  const parsed = parseKey(k);
  markKeySaved("shown", parsed);
  return { key: k, fingerprint: fingerprint(parsed) };
}

// ---------------------------------------------------------------------------
// Gönderme kuyruğu (tek tek, sırayla)
// ---------------------------------------------------------------------------
let running = false;
const setRemote = (id: number, v: Partial<typeof schema.backups.$inferInsert>) => db.update(schema.backups).set(v).where(eq(schema.backups.id, id)).run();

function enabledSettings() {
  const s = getStored();
  return s?.enabled ? s : null;
}

/** Her hedefin en son başarılı yerel yedeğini (henüz gönderilmemişse) sıraya alır */
function queueLatest() {
  const rows = db.select().from(schema.backups).where(eq(schema.backups.status, "success")).orderBy(desc(schema.backups.id)).all();
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${r.kind}:${r.targetName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (r.remoteStatus == null && r.fileName && fs.existsSync(path.join(backupDir, r.fileName))) setRemote(r.id, { remoteStatus: "pending", remoteError: null });
  }
}

export function kick() {
  if (running || !enabledSettings()) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        const s = enabledSettings();
        const key = getKey();
        if (!s || !key) break;
        const next = db
          .select()
          .from(schema.backups)
          .where(eq(schema.backups.remoteStatus, "pending"))
          .orderBy(schema.backups.id)
          .limit(1)
          .get();
        if (!next) break;
        await uploadOne(s, key, next);
      }
      const s = enabledSettings();
      if (s) await applyRemoteRetention(s).catch(() => {});
    } finally {
      running = false;
    }
  })();
}

async function uploadOne(s: Stored, key: Buffer, r: typeof schema.backups.$inferSelect) {
  let file: string;
  try {
    file = backupFilePath(r);
  } catch {
    // Dosya bu sunucuda yok (silinmiş ya da geri yüklenen panel kaydı başka sunucudan): gönderilecek bir şey yok
    setRemote(r.id, { remoteStatus: null, remoteError: null });
    return;
  }
  const objectKey = `${s.prefix}${r.fileName}.enc`;
  setRemote(r.id, { remoteStatus: "uploading", remoteError: null });
  const c = client(s);
  try {
    await new Upload({
      client: c,
      params: {
        Bucket: s.bucket,
        Key: objectKey,
        Body: encryptStream(file, key),
        ContentType: "application/octet-stream",
        Metadata: {
          kind: r.kind,
          target: encodeURIComponent(r.targetName),
          engine: r.engine ?? "",
          created: String(r.createdAt),
          keyfp: fingerprint(key),
        },
      },
      partSize: 16 * 1024 * 1024,
      queueSize: 2,
    }).done();
    setRemote(r.id, { remoteStatus: "uploaded", remoteKey: objectKey, remoteAt: Date.now(), remoteError: null });
  } catch (err) {
    const msg = s3Error(err);
    setRemote(r.id, { remoteStatus: "failed", remoteError: msg });
    notify("backupFailure", pt("notify:offsite.uploadFailedTitle", { target: r.targetName }), msg, "error");
  } finally {
    c.destroy();
  }
}

/** Yerel yedek tamamlanınca: açıksa sıraya al */
backupEvents.on("success", (id: number) => {
  if (!enabledSettings()) return;
  setRemote(id, { remoteStatus: "pending", remoteError: null });
  kick();
});

export function retryFailed() {
  db.update(schema.backups)
    .set({ remoteStatus: "pending", remoteError: null })
    .where(inArray(schema.backups.remoteStatus, ["failed"]))
    .run();
  kick();
}

/** Panel açılışında: yarıda kalan gönderimleri yeniden sıraya al */
export function startOffsite() {
  db.update(schema.backups).set({ remoteStatus: "pending" }).where(eq(schema.backups.remoteStatus, "uploading")).run();
  kick();
}

// ---------------------------------------------------------------------------
// Buluttaki yedekler
// ---------------------------------------------------------------------------
/** Dosya adından hedef: zaman damgası ve kimlik atılır (db-blog-20261105-030000-12.dump → db-blog) */
const groupOf = (fileName: string) => fileName.replace(/-\d{8}-\d{6}-\d+\..*$/, "");

async function listRemote(s: Stored) {
  const c = client(s);
  const out: { key: string; size: number; lastModified: number }[] = [];
  try {
    let token: string | undefined;
    do {
      const page = await c.send(new ListObjectsV2Command({ Bucket: s.bucket, Prefix: s.prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (o.Key && o.Key.endsWith(".enc") && !o.Key.slice(s.prefix.length).includes("/")) {
          out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified?.getTime() ?? 0 });
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    throw new HttpError(502, s3Error(err));
  } finally {
    c.destroy();
  }
  return out;
}

export async function listObjects(): Promise<OffsiteObject[]> {
  const s = getStored();
  if (!s) throw new HttpError(400, "errors:offsite.notConfigured");
  const local = new Set(db.select({ f: schema.backups.fileName }).from(schema.backups).all().map((r) => r.f));
  return (await listRemote(s))
    .map((o) => {
      const fileName = o.key.slice(s.prefix.length).replace(/\.enc$/, "");
      return { ...o, fileName, local: local.has(fileName) && fs.existsSync(path.join(backupDir, fileName)) };
    })
    .sort((a, b) => b.lastModified - a.lastModified);
}

/** Süresi dolan buluttaki yedekleri siler; her hedefin en yenisi kalır */
async function applyRemoteRetention(s: Stored) {
  const cutoff = Date.now() - s.retentionDays * 86_400_000;
  const objs = await listRemote(s);
  // Her hedefin en yeni keepMin yedeği süresi dolsa da kalır (yereldeki kuralın aynısı)
  const keepMin = Math.max(1, getBackupSettings().keepMin ?? 3);
  const byGroup = new Map<string, typeof objs>();
  for (const o of objs) {
    const g = groupOf(o.key.slice(s.prefix.length));
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(o);
  }
  const protectedKeys = new Set<string>();
  for (const list of byGroup.values()) {
    list.sort((a, b) => b.lastModified - a.lastModified);
    for (const o of list.slice(0, keepMin)) protectedKeys.add(o.key);
  }
  const c = client(s);
  try {
    for (const o of objs) {
      if (o.lastModified < cutoff && !protectedKeys.has(o.key)) {
        await c.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: o.key }));
        db.update(schema.backups).set({ remoteStatus: null, remoteKey: null }).where(eq(schema.backups.remoteKey, o.key)).run();
      }
    }
  } finally {
    c.destroy();
  }
}

/** Buluttaki bir yedeği indirip çözer ve yerel yedekler listesine ekler (sonra normal geri yüklenir) */
export async function importObject(objectKey: string) {
  const s = getStored();
  const key = getKey();
  if (!s || !key) throw new HttpError(400, "errors:offsite.notConfigured");
  if (!objectKey.startsWith(s.prefix) || !objectKey.endsWith(".enc")) throw new HttpError(400, "errors:offsite.invalidObject");
  const fileName = objectKey.slice(s.prefix.length).replace(/\.enc$/, "");
  if (!/^[\w.-]+$/.test(fileName) || fileName.startsWith(".")) throw new HttpError(400, "errors:offsite.invalidFileName");
  const final = path.join(backupDir, fileName);
  if (fs.existsSync(final)) throw new HttpError(409, "errors:offsite.alreadyLocal");
  fs.mkdirSync(backupDir, { recursive: true });
  const tmp = path.join(backupDir, `.import-${Date.now()}.enc.partial`);
  const out = `${final}.partial`;
  const c = client(s);
  try {
    const head = await c.send(new HeadObjectCommand({ Bucket: s.bucket, Key: objectKey }));
    const meta = head.Metadata ?? {};
    if (meta.keyfp && meta.keyfp !== fingerprint(key)) {
      throw new HttpError(400, "errors:offsite.otherKey", { fingerprint: meta.keyfp });
    }
    const obj = await c.send(new GetObjectCommand({ Bucket: s.bucket, Key: objectKey }));
    if (!obj.Body) throw new Error(pt("errors:offsite.emptyDownload"));
    await pipeline(obj.Body as NodeJS.ReadableStream, fs.createWriteStream(tmp));
    await decryptFile(tmp, out, key);
    fs.renameSync(out, final);
    const kind = (["database", "panel", "volume"].includes(meta.kind ?? "") ? meta.kind : fileName.startsWith("panel-") ? "panel" : fileName.startsWith("vol-") ? "volume" : "database") as
      | "database"
      | "panel"
      | "volume";
    const engine = (meta.engine || null) as typeof schema.backups.$inferInsert.engine;
    const created = Number(meta.created) || head.LastModified?.getTime() || Date.now();
    const row = db
      .insert(schema.backups)
      .values({
        kind,
        targetName: meta.target ? decodeURIComponent(meta.target) : groupOf(fileName),
        engine,
        fileName,
        sizeBytes: fs.statSync(final).size,
        status: "success",
        trigger: "manual",
        createdAt: created,
        finishedAt: Date.now(),
        remoteStatus: "uploaded",
        remoteKey: objectKey,
        remoteAt: head.LastModified?.getTime() ?? Date.now(),
      })
      .returning()
      .get();
    return { id: row.id, fileName };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, isDecryptError(err) ? (err as Error).message : s3Error(err));
  } finally {
    c.destroy();
    fs.rmSync(tmp, { force: true });
    fs.rmSync(out, { force: true });
  }
}
