import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, lt } from "drizzle-orm";
import * as tar from "tar";
import type { BackupEntry, BackupSettings, DbEngine } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema, sqlite } from "../../db/index.js";
import { execInContainer } from "../../lib/exec.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import {
  databaseContainerName,
  databaseVolumeName,
  getDatabaseRow,
  passwordOf,
  requireRunningContainer,
  startContainer,
  waitDatabaseHealthy,
  type DatabaseRow,
} from "../databases/service.js";
import { notify } from "../notify/service.js";
import { withMaintenance } from "../monitor/service.js";
import { docker } from "../../lib/docker.js";
import { HttpError } from "../projects/service.js";
import { errorText, panelLanguage, pt } from "../../lib/i18n.js";

/**
 * Yedekler data/backups altında tutulur:
 *   - Veritabanları: motorun kendi döküm aracıyla (pg_dump, mariadb-dump, mongodump, redis --rdb)
 *   - Panel: SQLite'ın canlı yedeği + şifreleme anahtarı (tar.gz)
 *   - Projelerin kalıcı klasörleri: çalışan container'dan klasörün tar.gz'si
 */

export const backupDir = path.join(config.dataDir, "backups");
const SETTINGS_KEY = "backup_settings";
const defaults: BackupSettings = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 3, retentionDays: 7, keepMin: 3, includePanel: true };

export const getBackupSettings = (): BackupSettings => ({ ...defaults, ...(getSecret<BackupSettings>(SETTINGS_KEY) ?? {}) });
export const saveBackupSettings = (s: BackupSettings) => setSecret(SETTINGS_KEY, s);

type Row = typeof schema.backups.$inferSelect;

/** "success": yedek dosyası hazır (sunucu dışı kopya bunu dinler) */
export const backupEvents = new EventEmitter();

const toEntry = (r: Row): BackupEntry => ({
  id: r.id,
  kind: r.kind,
  targetName: r.targetName,
  engine: r.engine,
  fileName: r.fileName,
  sizeBytes: r.sizeBytes,
  status: r.status,
  error: r.error,
  trigger: r.trigger,
  createdAt: r.createdAt,
  finishedAt: r.finishedAt,
  remoteStatus: r.remoteStatus,
  remoteError: r.remoteError,
  remoteAt: r.remoteAt,
  restorable:
    r.status === "success" && ((r.kind === "database" && r.engine !== "redis" && r.engine !== "valkey") || r.kind === "volume" || r.kind === "panel"),
});

export function listBackups(limit = 200): BackupEntry[] {
  return db.select().from(schema.backups).orderBy(desc(schema.backups.id)).limit(limit).all().map(toEntry);
}

/** Bir veritabanının bütün yedekleri (yeniden eskiye) */
export function listDatabaseBackups(name: string): BackupEntry[] {
  return db
    .select()
    .from(schema.backups)
    .where(and(eq(schema.backups.kind, "database"), eq(schema.backups.targetName, name)))
    .orderBy(desc(schema.backups.id))
    .all()
    .map(toEntry);
}

export function getBackupRow(id: number) {
  const r = db.select().from(schema.backups).where(eq(schema.backups.id, id)).get();
  if (!r) throw new HttpError(404, "errors:backup.notFound");
  return r;
}

export function backupFilePath(r: Pick<Row, "fileName">) {
  if (!r.fileName || r.fileName.includes("/") || r.fileName.includes("\\") || r.fileName.startsWith(".")) {
    throw new HttpError(404, "errors:backup.noFile");
  }
  const p = path.join(backupDir, r.fileName);
  if (!fs.existsSync(p)) throw new HttpError(404, "errors:backup.fileMissing");
  return p;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const ext: Record<DbEngine, string> = { postgres: "dump", mysql: "sql.gz", mariadb: "sql.gz", redis: "rdb", valkey: "rdb", mongo: "archive.gz", orthanc: "tar.gz" };

/**
 * Orthanc yedeği: Orthanc dizin dosyasını (SQLite) özel kilitle açtığı için canlı kopya alınamaz.
 * Container kısa süre durdurulur (Orthanc yazmaları bitirip kapanır), /var/lib/orthanc/db olduğu
 * gibi arşivlenir, container yeniden başlatılır. S3 modunda klasörde sadece küçük dizin olduğundan
 * birkaç saniye sürer; disk modunda görüntülerin boyutuyla orantılıdır. Arşiv kökü "db/".
 */
async function dumpOrthanc(d: DatabaseRow, cid: string, out: fs.WriteStream) {
  const c = docker.getContainer(cid);
  await withMaintenance(databaseContainerName(d.name), async () => {
    await c.stop({ t: 30 });
    try {
      const stream = (await c.getArchive({ path: "/var/lib/orthanc/db" })) as unknown as NodeJS.ReadableStream;
      await pipeline(stream, zlib.createGzip(), out);
    } finally {
      await c.start().catch(() => {});
    }
    await waitDatabaseHealthy(d, 300_000);
  });
}

function startRow(kind: Row["kind"], targetName: string, engine: DbEngine | null, trigger: Row["trigger"]) {
  return db
    .insert(schema.backups)
    .values({ kind, targetName, engine, status: "running", trigger, createdAt: Date.now() })
    .returning()
    .get();
}

function finishRow(id: number, v: Partial<Row>) {
  db.update(schema.backups).set({ ...v, finishedAt: Date.now() }).where(eq(schema.backups.id, id)).run();
  if (v.status === "success") backupEvents.emit("success", id);
}

const failMsg = (r: { exitCode: number | null; stderr: string; timedOut: boolean }) =>
  r.timedOut ? pt("messages:backup.timeout") : pt("messages:backup.exitCode", { code: r.exitCode, output: r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400) });

/** Container içinden döküm alıp dosyaya yazar */
async function dumpDatabase(d: DatabaseRow, file: string) {
  const cid = await requireRunningContainer(d);
  const pw = passwordOf(d);
  const timeoutMs = 60 * 60_000;
  const out = fs.createWriteStream(file);
  const closed = new Promise<void>((r) => out.once("close", () => r()));

  let res;
  if (d.engine === "postgres") {
    res = await execInContainer(cid, ["pg_dump", "-U", "app", "-d", "app", "-Fc"], { env: [`PGPASSWORD=${pw}`], stdout: out, timeoutMs });
  } else if (d.engine === "mariadb" || d.engine === "mysql") {
    const gz = zlib.createGzip();
    gz.pipe(out);
    const cmd =
      d.engine === "mysql"
        ? ["mysqldump", "-uapp", "--single-transaction", "--routines", "--triggers", "--no-tablespaces", "app"]
        : ["mariadb-dump", "-uapp", "--single-transaction", "--routines", "--triggers", "app"];
    res = await execInContainer(cid, cmd, {
      env: [`MYSQL_PWD=${pw}`],
      stdout: gz,
      timeoutMs,
    });
  } else if (d.engine === "orthanc") {
    await dumpOrthanc(d, cid, out);
    return;
  } else if (d.engine === "mongo") {
    res = await execInContainer(
      cid,
      ["mongodump", "--archive", "--gzip", "-u", "app", "-p", pw, "--authenticationDatabase", "admin"],
      { stdout: out, timeoutMs },
    );
  } else {
    // Redis / Valkey: önce container içinde RDB dosyası üret, sonra dışarı akıt
    const tmp = "/tmp/panel-backup.rdb";
    const r1 = await execInContainer(cid, [d.engine === "valkey" ? "valkey-cli" : "redis-cli", "-a", pw, "--no-auth-warning", "--rdb", tmp], { timeoutMs });
    if (r1.exitCode !== 0) {
      out.destroy();
      throw new Error(failMsg(r1));
    }
    res = await execInContainer(cid, ["sh", "-c", `cat ${tmp} && rm -f ${tmp}`], { stdout: out, timeoutMs });
  }
  await closed;
  if (res.exitCode !== 0 || res.timedOut) throw new Error(failMsg(res));
}

export async function backupDatabase(dbId: number, trigger: Row["trigger"]): Promise<BackupEntry> {
  const d = getDatabaseRow(dbId);
  fs.mkdirSync(backupDir, { recursive: true });
  const row = startRow("database", d.name, d.engine, trigger);
  const fileName = `db-${d.name}-${stamp()}-${row.id}.${ext[d.engine]}`;
  const final = path.join(backupDir, fileName);
  const partial = `${final}.partial`;
  try {
    await dumpDatabase(d, partial);
    fs.renameSync(partial, final);
    finishRow(row.id, { status: "success", fileName, sizeBytes: fs.statSync(final).size });
  } catch (err) {
    fs.rmSync(partial, { force: true });
    const msg = errorText(err);
    finishRow(row.id, { status: "failed", error: msg });
    notify("backupFailure", pt("notify:backup.failedTitle", { target: d.name }), msg, "error");
  }
  return toEntry(getBackupRow(row.id));
}

export async function backupPanel(trigger: Row["trigger"]): Promise<BackupEntry> {
  fs.mkdirSync(backupDir, { recursive: true });
  const row = startRow("panel", "panel", null, trigger);
  const fileName = `panel-${stamp()}-${row.id}.tar.gz`;
  const work = path.join(backupDir, `.work-${row.id}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    // SQLite canlı yedek API'si: panel çalışırken tutarlı kopya
    await sqlite.backup(path.join(work, "panel.db"));
    // Kopya bu yedeğin kaydını "sürüyor" olarak içeriyor: bu yedekten geri dönülen panelde
    // "yarıda kaldı" görünmesin diye kopyadaki kendi kaydını tamamlanmış işaretle
    {
      const Database = (await import("better-sqlite3")).default;
      const copy = new Database(path.join(work, "panel.db"));
      try {
        copy.prepare("UPDATE backups SET status = 'success', file_name = ?, finished_at = ? WHERE id = ?").run(fileName, Date.now(), row.id);
      } finally {
        copy.close();
      }
    }
    const files = ["panel.db"];
    const keyFile = path.join(config.dataDir, "secret.key");
    if (fs.existsSync(keyFile)) {
      fs.copyFileSync(keyFile, path.join(work, "secret.key"));
      files.push("secret.key");
    }
    // Açıklama dosyası panelin dilinde (BENIOKU.txt / README.txt)
    const readme = panelLanguage() === "tr" ? "BENIOKU.txt" : "README.txt";
    fs.writeFileSync(path.join(work, readme), pt("messages:backup.readme"));
    files.push(readme);
    await tar.c({ gzip: true, file: path.join(backupDir, fileName), cwd: work }, files);
    finishRow(row.id, { status: "success", fileName, sizeBytes: fs.statSync(path.join(backupDir, fileName)).size });
  } catch (err) {
    const msg = errorText(err);
    finishRow(row.id, { status: "failed", error: msg });
    notify("backupFailure", pt("notify:backup.panelFailedTitle"), msg, "error");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return toEntry(getBackupRow(row.id));
}

/**
 * Projenin kalıcı klasörünü, çalışan container'ından tar.gz olarak alır. Arşivin içinde klasörün
 * kendi adı vardır (ör. files/...). Geri yüklemek: docker cp ile container'daki yolun üst klasörüne.
 */
export async function backupVolume(projectName: string, volume: { name: string; path: string }, trigger: Row["trigger"]): Promise<BackupEntry> {
  fs.mkdirSync(backupDir, { recursive: true });
  const target = `${projectName}/${volume.name}`;
  const row = startRow("volume", target, null, trigger);
  const fileName = `vol-${projectName}-${volume.name}-${stamp()}-${row.id}.tar.gz`;
  const final = path.join(backupDir, fileName);
  const partial = `${final}.partial`;
  try {
    const p = db.select().from(schema.projects).where(eq(schema.projects.name, projectName)).get();
    if (!p?.currentContainer) throw new Error(pt("errors:backup.noRunningContainer"));
    const c = docker.getContainer(p.currentContainer);
    const info = await c.inspect().catch(() => null);
    if (!info?.State.Running) throw new Error(pt("errors:backup.notRunning", { name: p.currentContainer }));
    const stream = (await c.getArchive({ path: volume.path })) as unknown as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(partial);
      stream.on("error", reject);
      out.on("error", reject);
      out.on("close", () => resolve());
      stream.pipe(zlib.createGzip()).pipe(out);
    });
    fs.renameSync(partial, final);
    finishRow(row.id, { status: "success", fileName, sizeBytes: fs.statSync(final).size });
  } catch (err) {
    fs.rmSync(partial, { force: true });
    const msg = errorText(err);
    finishRow(row.id, { status: "failed", error: msg });
    notify("backupFailure", pt("notify:backup.failedTitle", { target }), msg, "error");
  }
  return toEntry(getBackupRow(row.id));
}

let running: Promise<BackupEntry[]> | null = null;

/** Tüm veritabanlarını (+ isteğe bağlı paneli) sırayla yedekler ve eski yedekleri temizler */
export function backupAll(trigger: Row["trigger"]): Promise<BackupEntry[]> {
  if (running) return running;
  running = (async () => {
    const s = getBackupSettings();
    const out: BackupEntry[] = [];
    if (s.includePanel || trigger === "manual") out.push(await backupPanel(trigger));
    for (const d of db.select().from(schema.databases).all()) out.push(await backupDatabase(d.id, trigger));
    for (const p of db.select().from(schema.projects).all()) {
      if (p.parentId) continue;
      for (const v of p.volumes ?? []) out.push(await backupVolume(p.name, v, trigger));
    }
    applyRetention(s.retentionDays, s.keepMin);
    return out;
  })().finally(() => (running = null));
  return running;
}

/**
 * Süresi dolan yedekleri siler. Her hedefin en yeni `keepMin` başarılı yedeği, süresi dolsa da
 * kalır (seyrek yedek + kısa saklama gibi ayarlarda tek geri dönüş noktasına düşülmesin).
 */
export function applyRetention(days: number, keepMin = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  const old = db.select().from(schema.backups).where(lt(schema.backups.createdAt, cutoff)).all();
  const keep = new Map<string, Set<number>>();
  const protectedIds = (kind: Row["kind"], target: string) => {
    const k = `${kind}:${target}`;
    if (!keep.has(k)) {
      const ids = db
        .select({ id: schema.backups.id })
        .from(schema.backups)
        .where(and(eq(schema.backups.kind, kind), eq(schema.backups.targetName, target), eq(schema.backups.status, "success")))
        .orderBy(desc(schema.backups.createdAt), desc(schema.backups.id))
        .limit(Math.max(1, keepMin))
        .all()
        .map((r) => r.id);
      keep.set(k, new Set(ids));
    }
    return keep.get(k)!;
  };
  for (const r of old) {
    if (r.status === "running") continue;
    if (protectedIds(r.kind, r.targetName).has(r.id)) continue;
    deleteBackup(r.id);
  }
}

export function deleteBackup(id: number) {
  const r = getBackupRow(id);
  if (r.status === "running") throw new HttpError(409, "errors:backup.deleteRunning");
  if (r.fileName && !r.fileName.includes("/") && !r.fileName.includes("\\")) {
    fs.rmSync(path.join(backupDir, r.fileName), { force: true });
  }
  db.delete(schema.backups).where(eq(schema.backups.id, id)).run();
}

/** Arşivdeki en üst klasör adları (ör. "files") */
async function topLevelNames(file: string) {
  const names = new Set<string>();
  await tar.t({
    file,
    onReadEntry: (e) => {
      const top = e.path.replace(/^\.\//, "").split("/")[0];
      if (top) names.add(top);
    },
  });
  return names;
}

/**
 * Kalıcı klasör yedeğini geri yükler: klasörün mevcut içeriği silinir, yedektekiler konur.
 * Öncesinde mevcut durumun yedeği alınır. Projenin çalışan container'ı üzerinden yapılır.
 */
async function restoreVolume(r: Row, opts: { safety?: boolean } = {}) {
  const [projectName, volName] = r.targetName.split("/");
  const p = db.select().from(schema.projects).where(eq(schema.projects.name, projectName ?? "")).get();
  if (!p) throw new HttpError(404, "errors:backup.projectGone", { name: projectName });
  const v = (p.volumes ?? []).find((x) => x.name === volName);
  if (!v) throw new HttpError(404, "errors:backup.volumeGone", { name: volName });
  const file = backupFilePath(r);

  // Yedekteki klasör adı, projedeki yolun son parçasıyla aynı olmalı (ör. files ↔ /app/files)
  const expected = path.posix.basename(v.path);
  const tops = await topLevelNames(file);
  if (tops.size !== 1 || !tops.has(expected)) {
    throw new HttpError(400, "errors:backup.volumePathMismatch", { folders: [...tops].join(", "), path: v.path });
  }

  if (!p.currentContainer) throw new HttpError(409, "errors:backup.noRunningContainer");
  const c = docker.getContainer(p.currentContainer);
  const info = await c.inspect().catch(() => null);
  if (!info?.State.Running) throw new HttpError(409, "errors:backup.notRunning", { name: p.currentContainer });

  let safetyId: number | null = null;
  if (opts.safety !== false) {
    const safety = await backupVolume(p.name, v, "manual");
    if (safety.status !== "success") throw new HttpError(500, "errors:backup.safetyFailed", { error: safety.error });
    safetyId = safety.id;
  }

  // Mevcut içeriği temizle (klasörün kendisi volume'ün bağlandığı yer; silinmez)
  const clean = await execInContainer(info.Id, ["sh", "-c", 'find "$1" -mindepth 1 -delete', "sh", v.path], { user: "root", timeoutMs: 10 * 60_000 });
  if (clean.exitCode !== 0) {
    throw new HttpError(500, "errors:backup.cleanFailed", { error: failMsg(clean) });
  }
  await c.putArchive(fs.createReadStream(file).pipe(zlib.createGunzip()), { path: path.posix.dirname(v.path) });
  return { safetyBackupId: safetyId };
}

/** Veritabanı ya da kalıcı klasör yedeğini geri yükler. Öncesinde mevcut durumun yedeği alınır. */
/**
 * Veritabanı ya da kalıcı klasör yedeğini geri yükler. Varsayılan olarak öncesinde mevcut durumun
 * yedeği alınır; felaket kurtarmada (veri zaten boş) `safety: false` ile atlanır.
 */
export async function restoreBackup(id: number, opts: { safety?: boolean } = {}) {
  const r = getBackupRow(id);
  if (!toEntry(r).restorable) throw new HttpError(400, "errors:backup.notRestorable");
  if (r.kind === "panel") throw new HttpError(400, "errors:backup.panelSeparate");
  if (r.kind === "volume") return restoreVolume(r, opts);
  const d = db.select().from(schema.databases).where(eq(schema.databases.name, r.targetName)).get();
  if (!d) throw new HttpError(404, "errors:backup.databaseGone", { name: r.targetName });
  if (d.engine !== r.engine) throw new HttpError(400, "errors:backup.engineMismatch");
  const file = backupFilePath(r);

  let safetyId: number | null = null;
  if (opts.safety !== false) {
    const safety = await backupDatabase(d.id, "manual");
    if (safety.status !== "success") throw new HttpError(500, "errors:backup.safetyFailed", { error: safety.error });
    safetyId = safety.id;
  }

  if (d.engine === "orthanc") {
    await restoreOrthanc(d, file);
    return { safetyBackupId: safetyId };
  }
  const cid = await requireRunningContainer(d);
  const pw = passwordOf(d);
  const timeoutMs = 60 * 60_000;
  let res;
  if (d.engine === "postgres") {
    res = await execInContainer(
      cid,
      ["pg_restore", "-U", "app", "-d", "app", "--clean", "--if-exists", "--no-owner", "--single-transaction"],
      { env: [`PGPASSWORD=${pw}`], stdin: fs.createReadStream(file), timeoutMs },
    );
  } else if (d.engine === "mariadb" || d.engine === "mysql") {
    res = await execInContainer(cid, [d.engine === "mysql" ? "mysql" : "mariadb", "-uapp", "app"], {
      env: [`MYSQL_PWD=${pw}`],
      stdin: fs.createReadStream(file).pipe(zlib.createGunzip()),
      timeoutMs,
    });
  } else {
    res = await execInContainer(
      cid,
      ["mongorestore", "--archive", "--gzip", "--drop", "-u", "app", "-p", pw, "--authenticationDatabase", "admin"],
      { stdin: fs.createReadStream(file), timeoutMs },
    );
  }
  if (res.exitCode !== 0 || res.timedOut) throw new HttpError(500, "errors:backup.restoreFailed", { error: failMsg(res) });
  return { safetyBackupId: safetyId };
}

/** Panel yeniden başladığında yarıda kalan yedekleri kapat */
export function failInterruptedBackups() {
  db.update(schema.backups)
    .set({ status: "failed", error: pt("messages:interruptedByRestart"), finishedAt: Date.now() })
    .where(eq(schema.backups.status, "running"))
    .run();
  // Yarım kalmış dosyalar
  if (fs.existsSync(backupDir)) {
    for (const f of fs.readdirSync(backupDir)) {
      if (f.endsWith(".partial") || f.startsWith(".work-")) fs.rmSync(path.join(backupDir, f), { recursive: true, force: true });
    }
  }
}


/**
 * Panel yedeğini geri yükleme (panel.db + secret.key). Çalışan veritabanının altından dosya
 * değiştirilemez: dosyalar data/restore-pending/ altına açılır, panel kapanır; yeniden açılırken
 * (veritabanı açılmadan önce) restore-swap.ts yerlerine koyar, eskileri before-restore-<zaman>/ altına taşır.
 */
export const RESTORE_PENDING_DIR = path.join(config.dataDir, "restore-pending");

export async function stagePanelRestore(id: number) {
  const r = getBackupRow(id);
  if (r.kind !== "panel" || r.status !== "success") throw new HttpError(400, "errors:backup.notPanel");
  if (process.env.PANEL_SECRET) {
    throw new HttpError(400, "errors:backup.panelSecretSet");
  }
  const file = backupFilePath(r);
  const tmp = `${RESTORE_PENDING_DIR}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    await tar.x({ file, cwd: tmp, filter: (p) => p === "panel.db" || p === "secret.key" });
    if (!fs.existsSync(path.join(tmp, "panel.db")) || !fs.existsSync(path.join(tmp, "secret.key"))) {
      throw new HttpError(400, "errors:backup.panelFilesMissing");
    }
    // Yedeğin gerçekten bir panel veritabanı olduğunu doğrula
    const Database = (await import("better-sqlite3")).default;
    const check = new Database(path.join(tmp, "panel.db"), { readonly: true, fileMustExist: true });
    try {
      const users = check.prepare("SELECT count(*) AS n FROM users").get() as { n: number };
      if (!users.n) throw new HttpError(400, "errors:backup.panelNoUser");
    } finally {
      check.close();
    }
    fs.rmSync(RESTORE_PENDING_DIR, { recursive: true, force: true });
    fs.renameSync(tmp, RESTORE_PENDING_DIR);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "errors:backup.panelOpenFailed", { error: (err as Error).message });
  }
  return { fileName: r.fileName };
}

/**
 * Orthanc geri yükleme: container ve volume silinir, aynı ayarlarla (başlatılmadan) yeniden
 * oluşturulur, yedek içine açılır, sonra başlatılır. S3 modunda görüntüler depoda kalır; sadece
 * dizin geri gelir.
 */
async function restoreOrthanc(d: DatabaseRow, file: string) {
  const name = databaseContainerName(d.name);
  await withMaintenance(name, async () => {
    await docker.getContainer(name).remove({ force: true }).catch(() => {});
    await docker.getVolume(databaseVolumeName(d.name)).remove().catch(() => {});
    const c = await startContainer(d, passwordOf(d), false);
    await c.putArchive(fs.createReadStream(file).pipe(zlib.createGunzip()), { path: "/var/lib/orthanc" });
    await c.start();
    await waitDatabaseHealthy(d, 300_000);
  });
}
