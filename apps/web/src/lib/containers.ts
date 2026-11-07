import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DotShape, Tone } from "../components/Status";
import type { ContainerAction, ContainerState, ContainerSummary } from "@panel/shared";
import { api } from "./api";
import { t } from "../i18n";
import { confirmDialog, showError } from "./dialog";

const state = (id: ContainerState, tone: Tone, shape: DotShape) => ({
  get label() {
    return t(`container.${id}`);
  },
  tone,
  shape,
});
export const stateStyle: Record<ContainerState, { label: string; tone: Tone; shape: DotShape }> = {
  running: state("running", "success", "dot"),
  exited: state("exited", "neutral", "hollow"),
  paused: state("paused", "warning", "pause"),
  restarting: state("restarting", "info", "spin"),
  created: state("created", "neutral", "hollow"),
  removing: state("removing", "danger", "spin"),
  dead: state("dead", "danger", "x"),
};

type ActionTarget = Pick<ContainerSummary, "id" | "name" | "isSystem"> & { projectName?: string | null };

/** Durdurmanın sonucunu anlatan uyarı; onay gerekmiyorsa null */
function stopWarning(c: ActionTarget): string | null {
  if (c.isSystem) return t("containers:confirm.systemStop");
  if (c.name.startsWith("db-")) return t("containers:confirm.databaseStop", { name: c.name });
  if (c.projectName) return t("containers:confirm.projectStop", { project: c.projectName });
  return null;
}

export function useContainerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ c, action }: { c: ActionTarget; action: ContainerAction }) => {
      // Durdurma: veritabanı, sistem ve proje container'larında onay ister.
      // Yeniden başlatma tek dokunuş; yalnız sistem container'ında (panel/proxy) onay ister.
      const warning = action === "stop" ? stopWarning(c) : action === "restart" && c.isSystem ? t("containers:confirm.systemRestart") : null;
      if (warning) {
        const ok = await confirmDialog({
          title: action === "stop" ? t("containers:confirm.stopTitle", { name: c.name }) : t("containers:confirm.restartTitle", { name: c.name }),
          message: warning,
          confirmLabel: action === "stop" ? t("containers:actions.stop") : t("containers:actions.restart"),
          danger: action === "stop",
        });
        if (!ok) return false;
      }
      await api.post(`/api/containers/${c.id}/${action}`);
      return true;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["container"] });
      qc.invalidateQueries({ queryKey: ["docker"] });
    },
    onError: (err) => void showError(err),
  });
}

// ---- Docker durum metni → seçili dil ----
type Unit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
const units: [RegExp, Unit][] = [
  [/^seconds?$/, "second"],
  [/^minutes?$/, "minute"],
  [/^hours?$/, "hour"],
  [/^days?$/, "day"],
  [/^weeks?$/, "week"],
  [/^months?$/, "month"],
  [/^years?$/, "year"],
];

/**
 * "24 minutes" / "About a minute" / "an hour" → { text: "yaklaşık 1 dakika", since: "yaklaşık 1 dakikadır" }.
 * `since` "… çalışıyor" önünde kullanılır (Türkçede ek alır); 1 saniyeden kısa sürede boş.
 */
function trDuration(raw: string): { text: string; since: string } | null {
  let s = raw.trim().toLowerCase();
  if (s === "less than a second") return { text: t("containers:status.lessThanSecond"), since: "" };
  const about = s.startsWith("about ");
  if (about) s = s.slice(6);
  s = s.replace(/^an? /, "1 ");
  const m = /^(\d+) (\w+)$/.exec(s);
  const u = m && units.find(([re]) => re.test(m[2]!));
  if (!m || !u) return null;
  const count = Number(m[1]);
  const wrap = (d: string) => (about ? t("containers:status.about", { duration: d }) : d);
  return { text: wrap(t(`containers:status.unit.${u[1]}`, { count })), since: wrap(t(`containers:status.since.${u[1]}`, { count })) };
}

const health = {
  healthy: () => t("containers:status.healthy"),
  unhealthy: () => t("containers:status.unhealthy"),
  "health: starting": () => t("containers:status.healthStarting"),
} as Record<string, (() => string) | undefined>;

/**
 * Docker'ın İngilizce durum metnini ("Up 24 minutes (healthy)", "Exited (0) 3 hours ago")
 * seçili dilde okunur hale getirir ("running for 24 minutes · healthy"); tanınmayanı olduğu gibi bırakır.
 */
export function trStatus(status: string): string {
  const s = status.trim();
  let m = /^Up (.+?)( \((?:healthy|unhealthy|health: starting)\))?( \(Paused\))?$/i.exec(s);
  if (m) {
    const d = trDuration(m[1]!);
    if (!d) return s;
    const base = d.since ? t("containers:status.runningFor", { duration: d.since }) : t("containers:status.justStarted");
    const parts: string[] = [m[3] ? t("containers:status.pausedSuffix", { base }) : base];
    if (m[2]) parts.push(health[m[2].trim().slice(1, -1).toLowerCase()]?.() ?? m[2].trim());
    return parts.join(" · ");
  }
  m = /^Exited \((-?\d+)\) (.+) ago$/i.exec(s);
  if (m) {
    const d = trDuration(m[2]!);
    return d ? t("containers:status.exited", { duration: d.text, code: m[1]! }) : s;
  }
  m = /^Restarting \((-?\d+)\) (.+) ago$/i.exec(s);
  if (m) {
    const d = trDuration(m[2]!);
    return d ? t("containers:status.restarting", { duration: d.text, code: m[1]! }) : s;
  }
  if (/^Created$/i.test(s)) return t("containers:status.created");
  if (/^Paused$/i.test(s)) return t("containers:status.paused");
  if (/^Removal In Progress$/i.test(s)) return t("containers:status.removing");
  if (/^Dead$/i.test(s)) return t("containers:status.dead");
  return s;
}
