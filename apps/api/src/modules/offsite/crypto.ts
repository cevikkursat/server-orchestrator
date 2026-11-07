import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { pt } from "../../lib/i18n.js";

/**
 * Sunucu dışına giden yedeklerin şifrelenmesi (AES-256-GCM, akış halinde).
 * Dosya biçimi: "PNLBK1\n" (7 bayt) + IV (12) + şifreli veri + doğrulama etiketi (16)
 * Anahtar panelin kendi anahtarından AYRIDIR ("kurtarma anahtarı"): sunucu tamamen kaybolsa da
 * kullanıcının sakladığı bu anahtarla yedekler açılabilir.
 */
const MAGIC = Buffer.from("PNLBK1\n");
const IV_LEN = 12;
const TAG_LEN = 16;

/** Anahtar yanlış / dosya bozuk: metin dile göre değiştiği için kodla tanınır */
const DECRYPT_FAILED = "PANEL_DECRYPT_FAILED";
export const isDecryptError = (err: unknown) => (err as { code?: string } | null)?.code === DECRYPT_FAILED;

export const newKey = () => crypto.randomBytes(32);

export function parseKey(b64: string) {
  const k = Buffer.from(b64.trim(), "base64");
  if (k.length !== 32) throw new Error(pt("errors:offsite.keyInvalid"));
  return k;
}

/** Anahtarın kendisini değil, kısa parmak izini gösteririz */
export const fingerprint = (key: Buffer) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);

/** Okunan dosyayı şifreleyip döndüren akış (yükleme sırasında diske şifreli kopya yazılmaz) */
export function encryptStream(file: string, key: Buffer) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let headerSent = false;
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!headerSent) {
        headerSent = true;
        this.push(Buffer.concat([MAGIC, iv]));
      }
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      if (!headerSent) this.push(Buffer.concat([MAGIC, iv]));
      this.push(cipher.final());
      cb(null, cipher.getAuthTag());
    },
  });
  return fs.createReadStream(file).pipe(t);
}

/** Şifreli dosyayı çözer. Etiket doğrulanmazsa (yanlış anahtar / bozuk dosya) hata verir ve çıktıyı siler. */
export async function decryptFile(input: string, output: string, key: Buffer) {
  const size = fs.statSync(input).size;
  if (size < MAGIC.length + IV_LEN + TAG_LEN) throw new Error(pt("errors:offsite.notEncrypted"));
  const fd = fs.openSync(input, "r");
  const head = Buffer.alloc(MAGIC.length + IV_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  fs.readSync(fd, head, 0, head.length, 0);
  fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  fs.closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(pt("errors:offsite.notEncrypted"));
  const d = crypto.createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  d.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(input, { start: head.length, end: size - TAG_LEN - 1 }), d, fs.createWriteStream(output));
  } catch (err) {
    fs.rmSync(output, { force: true });
    if (/auth|unable to authenticate/i.test((err as Error).message)) {
      throw Object.assign(new Error(pt("errors:offsite.decryptFailed")), { code: DECRYPT_FAILED });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parolayla sarılmış kurtarma anahtarı (e-postayla saklamak için)
// Biçim: "PNLKEY1." + base64url(salt 16 | iv 12 | etiket 16 | şifreli anahtar 32)
// Parola hiçbir yerde saklanmaz; scrypt (N=2^17) paroladan anahtar türetmeyi kasten yavaşlatır.
// ---------------------------------------------------------------------------
const WRAP_PREFIX = "PNLKEY1.";
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const kdf = (passphrase: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(passphrase.normalize("NFC"), salt, 32, SCRYPT, (err, k) => (err ? reject(err) : resolve(k))),
  );

export const isWrappedKey = (s: string) => s.trim().startsWith(WRAP_PREFIX);

export async function wrapKey(key: Buffer, passphrase: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", await kdf(passphrase, salt), iv);
  c.setAAD(Buffer.from(WRAP_PREFIX));
  const ct = Buffer.concat([c.update(key), c.final()]);
  return WRAP_PREFIX + Buffer.concat([salt, iv, c.getAuthTag(), ct]).toString("base64url");
}

export async function unwrapKey(wrapped: string, passphrase: string) {
  const text = wrapped.replace(/\s+/g, "");
  const raw = Buffer.from(text.slice(WRAP_PREFIX.length), "base64url");
  if (!isWrappedKey(text) || raw.length !== 16 + 12 + 16 + 32) {
    throw new Error(pt("errors:offsite.wrappedUnreadable"));
  }
  const d = crypto.createDecipheriv("aes-256-gcm", await kdf(passphrase, raw.subarray(0, 16)), raw.subarray(16, 28));
  d.setAAD(Buffer.from(WRAP_PREFIX));
  d.setAuthTag(raw.subarray(28, 44));
  try {
    return Buffer.concat([d.update(raw.subarray(44)), d.final()]);
  } catch {
    throw new Error(pt("errors:offsite.wrongPassphrase"));
  }
}
