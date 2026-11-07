import type { HealthResult, HealthStatus } from "@panel/shared";

/**
 * Sağlık kontrolü sonuçları (bellekte). Panel yeniden başlayınca sıfırlanır; ilk kontrolle dolar.
 * Ayrı dosya: proje servisi okur, kontrol döngüsü yazar (döngüsel import olmasın).
 */

const HISTORY = 30;

export interface HealthEntry extends HealthStatus {
  failures: number;
  /** Bu çökme döneminde yeniden başlatma yapıldı mı */
  restarted: boolean;
  /** Durumu hangi container için tutuyoruz (deploy sonrası sıfırlanır) */
  container: string | null;
}

const states = new Map<number, HealthEntry>();

export function healthOf(projectId: number): HealthStatus | null {
  const s = states.get(projectId);
  if (!s) return null;
  return { state: s.state, since: s.since, last: s.last, history: s.history };
}

export function healthEntry(projectId: number, container: string | null): HealthEntry {
  let s = states.get(projectId);
  if (!s || s.container !== container) {
    s = { state: "unknown", since: null, last: null, history: [], failures: 0, restarted: false, container };
    states.set(projectId, s);
  }
  return s;
}

export function pushResult(s: HealthEntry, r: HealthResult) {
  s.last = r;
  s.history.push(r);
  if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY);
}

export function clearHealth(projectId: number) {
  states.delete(projectId);
}
