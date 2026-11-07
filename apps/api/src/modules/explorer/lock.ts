/**
 * Veritabanı gezgini kilidi. Panel oturumu açık olsa bile veriye erişmek için 2FA kodu ayrıca
 * istenir (açık unutulmuş bir tarayıcı / çalınmış bir oturum çerezi tek başına yetmesin).
 * Kilit oturuma bağlıdır, sadece bellekte tutulur (panel yeniden başlarsa kilitlenir) ve
 * IDLE_MS boyunca gezginde işlem yapılmazsa kendiliğinden kapanır. Mutlak üst sınır MAX_MS.
 */
export const IDLE_MS = 15 * 60_000;
const MAX_MS = 2 * 3600_000;

const unlocked = new Map<string, { since: number; until: number }>();

export function unlock(sessionId: string) {
  const now = Date.now();
  unlocked.set(sessionId, { since: now, until: now + IDLE_MS });
  return now + IDLE_MS;
}

export function lock(sessionId: string) {
  unlocked.delete(sessionId);
}

/** Açıksa süreyi uzatır ve bitiş anını döner; kapalıysa null */
export function touch(sessionId: string): number | null {
  const e = unlocked.get(sessionId);
  const now = Date.now();
  if (!e || e.until < now || now - e.since > MAX_MS) {
    unlocked.delete(sessionId);
    return null;
  }
  e.until = Math.min(now + IDLE_MS, e.since + MAX_MS);
  return e.until;
}

export function peek(sessionId: string): number | null {
  const e = unlocked.get(sessionId);
  return e && e.until > Date.now() ? e.until : null;
}
