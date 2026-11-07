import { useQueries, useQuery } from "@tanstack/react-query";
import type { DockerSummary, DomainCheck, OffsiteStatus, SystemInfo, UpdateStatus } from "@panel/shared";
import { api } from "./api";
import { useBackups } from "./ops";
import { timeAgo, useProjects, useSettings } from "./projects";
import { useDomainOverview } from "../components/DomainStatus";
import { t } from "../i18n";
import { fmtDateTime, fmtPercent } from "./format";

/**
 * Panelin iki ortak cevabı:
 *  - usePosture(): koruma durumu (erişim, 2FA, son yedek, sunucu dışı kopya, sürüm); her ekranda görünür
 *  - useAttention(): "şu an beni ne bekliyor" listesi; Genel Bakış ve telefon sekme sayacı
 */
export type Level = "ok" | "info" | "warning" | "danger";

export interface PostureItem {
  id: "access" | "twofa" | "backup" | "offsite" | "version";
  label: string;
  /** Telefonda kısa etiket */
  short?: string;
  value: string;
  level: Level;
  to: string;
  title?: string;
}

export interface AttentionItem {
  id: string;
  level: Exclude<Level, "ok">;
  title: string;
  detail?: string;
  to: string;
  action: string;
}

const DAY = 86_400_000;

export const useSystem = () => useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/system"), refetchInterval: 5000 });
export const useOffsite = () => useQuery({ queryKey: ["offsite"], queryFn: () => api.get<OffsiteStatus>("/api/offsite"), refetchInterval: 60_000 });
export const useUpdater = () => useQuery({ queryKey: ["updater"], queryFn: () => api.get<UpdateStatus>("/api/updater"), refetchInterval: 120_000 });

function useBackupState() {
  const { data } = useBackups();
  if (!data) return null;
  const done = data.backups.filter((b) => b.status !== "running");
  const lastOk = done.filter((b) => b.status === "success").sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  const last = done.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  // Seçili günler arasındaki en uzun boşluk + 1 gün: bundan eskiyse yedek gecikmiş demektir
  const days = [...data.settings.days].sort();
  let gap = 7;
  if (days.length > 1) gap = Math.max(...days.map((d, i) => ((days[(i + 1) % days.length]! - d + 7) % 7 || 7)));
  const stale = lastOk ? Date.now() - lastOk.createdAt > (gap + 1) * DAY : true;
  return { enabled: data.settings.enabled, lastOk, lastFailed: last?.status === "failed" ? last : null, stale };
}

export function usePosture(): PostureItem[] | null {
  const { data: settings } = useSettings();
  const backup = useBackupState();
  const { data: offsite } = useOffsite();
  const { data: updater } = useUpdater();
  if (!settings) return null;

  const items: PostureItem[] = [
    settings.panelAccess === "tailscale"
      ? { id: "access", label: t("dashboard:posture.access.label"), value: "Tailscale", level: "ok", to: "/security", title: t("dashboard:posture.access.tailscaleTitle") }
      : { id: "access", label: t("dashboard:posture.access.label"), value: t("dashboard:posture.access.public"), level: "warning", to: "/security", title: t("dashboard:posture.access.publicTitle") },
    { id: "twofa", label: "2FA", value: t("states.on"), level: "ok", to: "/security", title: t("dashboard:posture.twofa.title") },
  ];

  if (backup) {
    const label = t("dashboard:posture.backup.label");
    const short = t("dashboard:posture.backup.short");
    items.push(
      !backup.enabled
        ? { id: "backup", label, short, value: backup.lastOk ? t("dashboard:posture.backup.autoOffAgo", { ago: timeAgo(backup.lastOk.createdAt) }) : t("dashboard:posture.backup.autoOff"), level: "warning", to: "/backups" }
        : backup.lastFailed
          ? { id: "backup", label, short, value: t("dashboard:posture.backup.failed"), level: "danger", to: "/backups", title: backup.lastFailed.error ?? undefined }
          : backup.lastOk
            ? { id: "backup", label, short, value: timeAgo(backup.lastOk.createdAt), level: backup.stale ? "warning" : "ok", to: "/backups", title: fmtDateTime(backup.lastOk.createdAt) }
            : { id: "backup", label, short, value: t("dashboard:posture.backup.none"), level: "warning", to: "/backups" },
    );
  }
  if (offsite) {
    const label = t("dashboard:posture.offsite.label");
    const short = t("dashboard:posture.offsite.short");
    items.push(
      !offsite.configured
        ? { id: "offsite", label, short, value: t("dashboard:posture.offsite.notConfigured"), level: "warning", to: "/backups" }
        : !offsite.settings?.enabled
          ? { id: "offsite", label, short, value: t("states.off"), level: "warning", to: "/backups" }
          : offsite.failed > 0
          ? { id: "offsite", label, short, value: t("dashboard:posture.offsite.failed", { count: offsite.failed }), level: "danger", to: "/backups" }
          : { id: "offsite", label, short, value: offsite.lastUploadAt ? timeAgo(offsite.lastUploadAt) : t("states.on"), level: "ok", to: "/backups" },
    );
  }
  if (updater?.current) {
    items.push({
      id: "version",
      label: t("nav.version"),
      value: updater.pending.length ? `${updater.current.sha.slice(0, 7)} · ${t("nav.updateAvailable")}` : updater.current.sha.slice(0, 7),
      level: updater.pending.length ? "info" : "ok",
      to: "/settings",
      title: updater.current.message,
    });
  }
  return items;
}

const order: Record<AttentionItem["level"], number> = { danger: 0, warning: 1, info: 2 };

export function useAttention(): { items: AttentionItem[]; ready: boolean } {
  const { data: projects } = useProjects();
  const { data: sys } = useSystem();
  const { data: settings } = useSettings();
  const { data: offsite } = useOffsite();
  const { data: overview } = useDomainOverview();
  const backup = useBackupState();

  const routeHosts = (overview?.domains ?? []).filter((d) => d.kind === "route").map((d) => d.hostname);
  const checks = useQueries({
    queries: routeHosts.map((h) => ({
      queryKey: ["domain-check", h],
      queryFn: () => api.get<DomainCheck>(`/api/domains/check?hostname=${encodeURIComponent(h)}`),
      staleTime: 60_000,
    })),
  });

  const items: AttentionItem[] = [];

  if (settings && !settings.caddy.reachable) {
    items.push({ id: "caddy", level: "danger", title: t("dashboard:attention.caddy.title"), detail: t("dashboard:attention.caddy.detail"), to: "/containers", action: t("nav.containers") });
  }

  for (const p of projects ?? []) {
    if (p.preview) continue;
    const to = `/projects/${p.id}`;
    if (p.lastDeployment?.status === "failed") {
      items.push({
        id: `deploy-${p.id}`,
        level: "danger",
        title: t("dashboard:attention.deployFailed.title", { name: p.name, id: p.lastDeployment.id }),
        detail:
          p.container?.state === "running"
            ? p.liveDeploymentId && p.liveDeploymentId !== p.lastDeployment.id
              ? t("dashboard:attention.deployFailed.liveRunning", { id: p.liveDeploymentId })
              : t("dashboard:attention.deployFailed.previousRunning")
            : t("dashboard:attention.deployFailed.notRunning"),
        to: `${to}?tab=deploys&deploy=${p.lastDeployment.id}`,
        action: t("dashboard:attention.actions.inspect"),
      });
    } else if (p.container && p.container.state !== "running" && p.lastDeployment) {
      items.push({ id: `down-${p.id}`, level: "danger", title: t("dashboard:attention.down.title", { name: p.name }), detail: t("dashboard:attention.down.detail"), to, action: t("actions.open") });
    } else if (p.health?.state === "down") {
      items.push({ id: `health-${p.id}`, level: "danger", title: t("dashboard:attention.health.title", { name: p.name }), detail: p.health.last?.error ?? t("dashboard:attention.health.detail"), to: `${to}?tab=health`, action: t("dashboard:attention.actions.health") });
    }
  }

  if (sys?.disk) {
    const pct = (sys.disk.usedBytes / sys.disk.totalBytes) * 100;
    if (pct >= 80)
      items.push({
        id: "disk",
        level: pct >= 90 ? "danger" : "warning",
        title: t("dashboard:attention.disk.title", { pct: fmtPercent(pct) }),
        detail: t("dashboard:attention.disk.detail"),
        to: "/settings#bakim",
        action: t("dashboard:attention.actions.cleanup"),
      });
  }
  if (sys) {
    const mem = (sys.memory.usedBytes / sys.memory.totalBytes) * 100;
    if (mem >= 92) items.push({ id: "mem", level: "warning", title: t("dashboard:attention.mem.title", { pct: fmtPercent(mem) }), detail: t("dashboard:attention.mem.detail"), to: "/containers", action: t("nav.containers") });
  }

  const badDns = checks.filter((c) => c.data && (c.data.dns.status === "missing" || c.data.dns.status === "wrong")).length;
  if (badDns) {
    items.push({
      id: "dns",
      level: "warning",
      title: t("dashboard:attention.dns.title", { count: badDns }),
      detail: t("dashboard:attention.dns.detail"),
      to: "/domains",
      action: t("nav.domains"),
    });
  }

  if (backup) {
    if (backup.lastFailed) items.push({ id: "backup-failed", level: "danger", title: t("dashboard:attention.backupFailed"), detail: backup.lastFailed.error ?? undefined, to: "/backups", action: t("nav.backups") });
    else if (!backup.enabled) items.push({ id: "backup-off", level: "warning", title: t("dashboard:attention.backupOff"), to: "/backups", action: t("actions.open") });
    else if (backup.stale) items.push({ id: "backup-stale", level: "warning", title: backup.lastOk ? t("dashboard:attention.backupStale", { ago: timeAgo(backup.lastOk.createdAt) }) : t("dashboard:attention.backupNever"), to: "/backups", action: t("nav.backups") });
  }
  if (offsite) {
    if (!offsite.configured) items.push({ id: "offsite", level: "warning", title: t("dashboard:attention.offsite.title"), detail: t("dashboard:attention.offsite.detail"), to: "/backups", action: t("dashboard:attention.actions.setUp") });
    else if (!offsite.settings?.enabled) items.push({ id: "offsite-off", level: "warning", title: t("dashboard:attention.offsiteOff.title"), detail: t("dashboard:attention.offsiteOff.detail"), to: "/backups", action: t("actions.open") });
    else if (offsite.failed > 0) items.push({ id: "offsite-failed", level: "danger", title: t("dashboard:attention.offsiteFailed", { count: offsite.failed }), to: "/backups", action: t("nav.backups") });
    if (offsite.configured && offsite.keyFingerprint && !offsite.keySaved)
      items.push({
        id: "offsite-key",
        level: "warning",
        title: t("dashboard:attention.offsiteKey.title"),
        detail: t("dashboard:attention.offsiteKey.detail"),
        to: "/backups",
        action: t("dashboard:attention.actions.key"),
      });
  }

  items.sort((a, b) => order[a.level] - order[b.level]);
  return { items, ready: !!(projects && sys && settings) };
}

export const useDocker = () => useQuery({ queryKey: ["docker"], queryFn: () => api.get<DockerSummary>("/api/docker"), refetchInterval: 10_000 });

/** Bekleyen bir işin hangi bölüme ait olduğu (menüde o bölümün yanına nokta düşer) */
function sectionOf(id: string): string {
  if (id.startsWith("deploy-") || id.startsWith("down-") || id.startsWith("health-")) return "/projects";
  if (id === "dns") return "/domains";
  if (id.startsWith("backup") || id.startsWith("offsite")) return "/backups";
  if (id === "caddy" || id === "mem") return "/containers";
  if (id === "disk") return "/settings";
  return "/";
}

export interface NavMark {
  /** Sağda mono sayı (proje sayısı, 9/10 …) */
  count?: string;
  /** Bölümde bekleyen en ciddi iş */
  level?: Exclude<Level, "ok" | "info"> | "ok";
}

/** Menü işaretleri: bölüm başına sayı + bekleyen iş noktası. Yalnız zaten çekilen veriler kullanılır. */
export function useNavMarks(): Record<string, NavMark> {
  const { items } = useAttention();
  const { data: projects } = useProjects();
  const { data: overview } = useDomainOverview();
  const { data: backups } = useBackups();
  const { data: docker } = useDocker();
  const marks: Record<string, NavMark> = {
    "/": { count: items.length ? String(items.length) : undefined },
    "/projects": { count: projects ? String(projects.filter((p) => !p.preview).length) : undefined },
    "/domains": { count: overview ? String(overview.domains.length) : undefined },
    "/containers": { count: docker?.available ? `${docker.containers.running}/${docker.containers.total}` : undefined },
    "/backups": { count: backups ? String(backups.backups.length) : undefined },
    "/security": { count: "2FA", level: "ok" },
  };
  const worst = (a: NavMark["level"], b: AttentionItem["level"]) => (a === "danger" || b === "danger" ? "danger" : "warning");
  for (const i of items) {
    if (i.level === "info") continue;
    const s = sectionOf(i.id);
    marks[s] = { ...marks[s], level: worst(marks[s]?.level, i.level) };
    if (s !== "/") marks["/"] = { ...marks["/"], level: worst(marks["/"]?.level, i.level) };
  }
  return marks;
}
