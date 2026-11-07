import crypto from "node:crypto";
import { invalidatePanelLanguage } from "../../lib/i18n.js";
import { hash, verify as verifyHash } from "@node-rs/argon2";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import QRCode from "qrcode";
import { and, asc, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { config } from "../../config.js";
import { pt } from "../../lib/i18n.js";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// ---- Kurulum token'ı ----
// Henüz aktif admin yokken paneli başkası sahiplenmesin diye sunucu loguna
// tek seferlik bir token yazılır. Kurulum ekranı bu token'ı ister.
let setupToken: string | null = null;

export function isSetupRequired(): boolean {
  const u = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.totpEnabled, true)).get();
  return !u;
}

export function ensureSetupToken(): string | null {
  if (!isSetupRequired()) {
    setupToken = null;
    return null;
  }
  setupToken ??= crypto.randomBytes(16).toString("hex");
  return setupToken;
}

export function checkSetupToken(token: string): boolean {
  if (!setupToken) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(sha256(setupToken)));
}

// ---- Kurulum ----
/** language: kurulumu yapan tarayıcının dili; panelin (bildirimler dahil) dili olur */
export async function startSetup(username: string, password: string, language: string) {
  // Yarım kalmış kurulumu temizle (TOTP'si doğrulanmamış kullanıcı)
  db.delete(schema.users).where(eq(schema.users.totpEnabled, false)).run();

  const secret = generateSecret();
  const passwordHash = await hash(password);
  db.insert(schema.users)
    .values({ username, passwordHash, totpSecret: secret, totpEnabled: false, language, createdAt: Date.now() })
    .run();

  invalidatePanelLanguage();
  const otpauthUrl = generateURI({ issuer: config.totpIssuer ?? pt("messages:appName"), label: username, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { otpauthUrl, qrDataUrl, secret };
}

export async function finishSetup(code: string) {
  const user = db.select().from(schema.users).where(eq(schema.users.totpEnabled, false)).get();
  if (!user) return null;
  if (!(await checkTotp(user, code))) return null;
  db.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, user.id)).run();
  setupToken = null;
  return user;
}

// ---- 2FA ----
/**
 * Kodu doğrular. ±30 sn tolerans (telefon saati kaymış olabilir). Kabul edilen kodun zaman
 * adımı kaydedilir; aynı kod (veya daha eskisi) ikinci kez kullanılamaz (replay engeli).
 */
async function checkTotp(user: { id: number; totpSecret: string; totpLastStep: number }, token: string) {
  const r = await verifyTotp({ secret: user.totpSecret, token, epochTolerance: 30 });
  if (!r.valid) return false;
  // TOTP sonucundaki epoch, kodun eşleştiği aralığın başlangıcıdır (kaymayı zaten içerir)
  const step = "epoch" in r ? Math.floor((r as { epoch: number }).epoch / 30) : Math.floor(Date.now() / 30_000) + r.delta;
  if (step <= user.totpLastStep) return false;
  db.update(schema.users).set({ totpLastStep: step }).where(eq(schema.users.id, user.id)).run();
  return true;
}

/** Oturumu açık kullanıcının 2FA kodunu doğrular (hassas işlemlerden önce yeniden doğrulama) */
export async function verifyUserTotp(userId: number, code: string) {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user?.totpEnabled) return false;
  return checkTotp(user, code);
}

// ---- Giriş kilidi ----
// IP başına sınırın (dakikada 5) üstüne, hesap genelinde: çok sayıda IP'den deneme yapılsa da
// 15 dakikada 10 başarısız denemede giriş 15 dakika kapanır.
export const LOCK_WINDOW_MS = 15 * 60_000;
export const LOCK_THRESHOLD = 10;

export function lockState() {
  // Sunucudan (SSH ile) kilit kaldırıldıysa sayım o andan başlar
  const lastUnlock = db
    .select({ createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .where(inArray(schema.auditLog.action, ["cli.unlock", "cli.reset_admin"]))
    .orderBy(desc(schema.auditLog.id))
    .limit(1)
    .get();
  const since = Math.max(Date.now() - LOCK_WINDOW_MS, lastUnlock?.createdAt ?? 0);
  const fails = db
    .select({ createdAt: schema.auditLog.createdAt })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "auth.login_failed"), gt(schema.auditLog.createdAt, since)))
    .orderBy(asc(schema.auditLog.createdAt))
    .all();
  const lockedUntil = fails.length >= LOCK_THRESHOLD ? fails[fails.length - LOCK_THRESHOLD]!.createdAt + LOCK_WINDOW_MS : null;
  return { failedLast15m: fails.length, lockedUntil: lockedUntil && lockedUntil > Date.now() ? lockedUntil : null };
}

// Kullanıcı yoksa da hash doğrulaması yapılır; yanıt süresinden kullanıcı adı anlaşılmasın
const dummyHashPromise = hash("dummy-password-for-timing");

export async function verifyCredentials(username: string, password: string, code: string) {
  const user = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.username, username), eq(schema.users.totpEnabled, true)))
    .get();
  const passwordOk = await verifyHash(user?.passwordHash ?? (await dummyHashPromise), password);
  if (!user || !passwordOk) return null;
  if (!(await checkTotp(user, code))) return null;
  return user;
}

export async function changePassword(userId: number, current: string, next: string, code: string) {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return false;
  if (!(await verifyHash(user.passwordHash, current))) return false;
  if (!(await checkTotp(user, code))) return false;
  db.update(schema.users).set({ passwordHash: await hash(next) }).where(eq(schema.users.id, userId)).run();
  return true;
}

// ---- Oturumlar ----
/** Bu kadar süre hiç istek gelmeyen oturum kapanır (mutlak süre: config.sessionTtlMs) */
export const IDLE_TIMEOUT_MS = 12 * 3600_000;

export function createSession(userId: number, ip: string | null, userAgent: string | null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db.insert(schema.sessions)
    .values({ id: sha256(token), userId, ip, userAgent, createdAt: now, lastSeenAt: now, expiresAt: now + config.sessionTtlMs })
    .run();
  return token;
}

export function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const id = sha256(token);
  const now = Date.now();
  const row = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      sessionId: schema.sessions.id,
      lastSeenAt: schema.sessions.lastSeenAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now)))
    .get();
  if (!row) return null;
  // Hareketsizlik süresi dolduysa oturumu kapat
  if (now - (row.lastSeenAt ?? row.createdAt) > IDLE_TIMEOUT_MS) {
    db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
    return null;
  }
  // Son görülme zamanını en fazla dakikada bir yaz
  if (now - (row.lastSeenAt ?? 0) > 60_000) {
    db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, id)).run();
  }
  return { id: row.id, username: row.username, sessionId: row.sessionId };
}

export function listSessions(userId: number, currentSessionId: string) {
  return db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, Date.now())))
    .orderBy(desc(schema.sessions.lastSeenAt))
    .all()
    .map((s) => ({
      // Hash'in ilk 16 karakteri yeterince benzersiz; tam hash dışarı verilmez
      id: s.id.slice(0, 16),
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      current: s.id === currentSessionId,
    }));
}

export function revokeSession(userId: number, shortId: string) {
  const s = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .all()
    .find((x) => x.id.startsWith(shortId));
  if (!s) return false;
  db.delete(schema.sessions).where(eq(schema.sessions.id, s.id)).run();
  return true;
}

export function revokeOtherSessions(userId: number, keepSessionId: string) {
  return db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId)))
    .run().changes;
}

export function deleteSession(token: string | undefined) {
  if (!token) return;
  db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token))).run();
}

export function purgeExpiredSessions() {
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now())).run();
  db.delete(schema.sessions).where(lt(schema.sessions.lastSeenAt, Date.now() - IDLE_TIMEOUT_MS)).run();
}

// ---- Dil tercihi ----
export function userLanguage(userId: number): string | null {
  return db.select({ language: schema.users.language }).from(schema.users).where(eq(schema.users.id, userId)).get()?.language ?? null;
}

export function setUserLanguage(userId: number, language: string) {
  db.update(schema.users).set({ language }).where(eq(schema.users.id, userId)).run();
  invalidatePanelLanguage();
}
