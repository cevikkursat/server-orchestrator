import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ExplorerStatus } from "@panel/shared";
import { api, ApiError } from "./api";
import { t } from "../i18n";

export const useExplorerStatus = () =>
  useQuery({
    queryKey: ["explorer-status"],
    queryFn: () => api.get<ExplorerStatus>("/api/explorer/status"),
    refetchInterval: 30_000,
  });

/** Gezgin isteği: kilit kapanmışsa (423) durum yenilenir ve kilit ekranı açılır */
export async function explorerCall<T>(qc: QueryClient, url: string, body: unknown): Promise<T> {
  try {
    const r = await api.post<T>(url, body);
    // Her başarılı istek kilidi uzatır; geri sayım güncel kalsın
    qc.setQueryData<ExplorerStatus>(["explorer-status"], (s) => (s ? { ...s, expiresAt: Date.now() + s.idleMinutes * 60_000 } : s));
    return r;
  } catch (err) {
    if (err instanceof ApiError && err.status === 423) qc.invalidateQueries({ queryKey: ["explorer-status"] });
    throw err;
  }
}

/** GET isteği: kilit kapanmışsa (423) kilit ekranı açılır */
export async function explorerGet<T>(qc: QueryClient, url: string): Promise<T> {
  try {
    return await api.get<T>(url);
  } catch (err) {
    if (err instanceof ApiError && err.status === 423) qc.invalidateQueries({ queryKey: ["explorer-status"] });
    throw err;
  }
}

export function useExplorer(dbId: number) {
  const qc = useQueryClient();
  return {
    qc,
    call: <T>(path: string, body: unknown) => explorerCall<T>(qc, `/api/databases/${dbId}/explorer/${path}`, body),
  };
}

export function formatTtl(ms: number) {
  if (ms < 0) return t("databases:ttl.none");
  const s = Math.round(ms / 1000);
  if (s < 60) return t("databases:ttl.seconds", { count: s });
  if (s < 3600) return t("databases:ttl.minutes", { count: Math.round(s / 60) });
  if (s < 86400) return t("databases:ttl.hours", { count: Math.round(s / 3600) });
  return t("databases:ttl.days", { count: Math.round(s / 86400) });
}
