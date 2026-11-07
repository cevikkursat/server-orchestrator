import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { DotShape, Tone } from "../components/Status";
import type { Deployment, DeploymentStatus, PanelSettings, ProjectDetail, ProjectSummary } from "@panel/shared";
import { api } from "./api";
import { t } from "../i18n";

export const useSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: () => api.get<PanelSettings>("/api/settings"), refetchInterval: 15000 });

/** Projeyi listelerde üste sabitle / sabitlemeyi kaldır */
export async function setProjectPinned(qc: QueryClient, id: number, pinned: boolean) {
  await api.put(`/api/projects/${id}/pin`, { pinned });
  await Promise.all([qc.invalidateQueries({ queryKey: ["projects"] }), qc.invalidateQueries({ queryKey: ["project", id] })]);
}

export const useProjects = () =>
  useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectSummary[]>("/api/projects"), refetchInterval: 5000 });

export const useProject = (id: number) =>
  useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`), refetchInterval: 5000 });

const isActive = (s?: DeploymentStatus) => s === "queued" || s === "running";

export const useDeployment = (id: number | null) =>
  useQuery({
    queryKey: ["deployment", id],
    queryFn: () => api.get<Deployment>(`/api/deployments/${id}`),
    enabled: id !== null,
    // Devam eden deployu sık yokla
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 1000 : false),
  });

/** Durum etiketleri seçili dilde (getter: her okumada güncel dil) */
const deployStatus = (id: DeploymentStatus, tone: Tone, shape: DotShape) => ({
  get label() {
    return t(`deploy.${id}`);
  },
  tone,
  shape,
});
export const deployStatusStyle: Record<DeploymentStatus, { label: string; tone: Tone; shape: DotShape }> = {
  queued: deployStatus("queued", "neutral", "hollow"),
  running: deployStatus("running", "info", "spin"),
  success: deployStatus("success", "success", "dot"),
  failed: deployStatus("failed", "danger", "x"),
};

type TriggerKey = "create" | "manual" | "update" | "webhook" | "rollback" | "preview" | "scheduled" | "pre-deploy";
/** Deploy ve yedek tetikleyicilerinin adı; bilinmeyen tetikleyici olduğu gibi yazılır */
export const triggerLabel = new Proxy({} as Record<string, string>, {
  get: (_, k: string) => t(`trigger.${k as TriggerKey}`, { defaultValue: k }),
});

export function appUrl(hostname: string, https: boolean) {
  // Geliştirmede Caddy 8080'de
  return https ? `https://${hostname}` : `http://${hostname}${hostname.endsWith(".localhost") ? ":8080" : ""}`;
}

export { duration, timeAgo } from "./format";
