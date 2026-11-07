import { Play, RotateCw, Square } from "lucide-react";
import type { ContainerState, ContainerSummary } from "@panel/shared";
import { stateStyle, useContainerAction } from "../lib/containers";
import { StatusBadge } from "./Status";
import { t } from "../i18n";

export function StateBadge({ state }: { state: ContainerState }) {
  const s = stateStyle[state] ?? stateStyle.created;
  return <StatusBadge tone={s.tone} shape={s.shape} label={s.label} />;
}

/**
 * Başlat / durdur / yeniden başlat.
 * size="sm" ikon düğmeleri (aria-label ile), "md" yazılı düğmeler; `labels` sm boyutta da yazıyı zorlar.
 * Durdur mercan çerçeveli (yazılıda) ya da üstüne gelince mercan (ikonda); Başlat yeşil ikonlu.
 */
export function ContainerActions({ c, size = "sm", labels }: { c: ContainerSummary; size?: "sm" | "md"; labels?: boolean }) {
  const action = useContainerAction();
  const running = c.state === "running" || c.state === "restarting";
  const busy = action.isPending;
  const withText = labels || size === "md";
  const sm = size === "sm" ? " btn-sm" : "";
  const icon = "btn-icon border border-line hover:border-line-strong md:size-[30px]";
  const label = (text: string) => (withText ? text : null);

  return (
    <div className={`flex items-center ${withText ? "gap-2" : "gap-1.5"}`} onClick={(e) => e.stopPropagation()}>
      {running ? (
        <button
          className={withText ? `btn-danger${sm}` : `${icon} hover:border-danger/55 hover:bg-transparent hover:text-danger`}
          title={c.isSelf ? t("containers:actions.selfStop") : t("containers:actions.stop")}
          aria-label={t("containers:actions.stop")}
          disabled={busy || c.isSelf}
          onClick={() => action.mutate({ c, action: "stop" })}
        >
          <Square className="size-3.5" aria-hidden /> {label(t("containers:actions.stop"))}
        </button>
      ) : (
        <button
          className={withText ? `btn-secondary${sm}` : `${icon} text-success hover:text-success`}
          title={t("containers:actions.start")}
          aria-label={t("containers:actions.start")}
          disabled={busy}
          onClick={() => action.mutate({ c, action: "start" })}
        >
          <Play className={`size-3.5 ${withText ? "text-success" : ""}`} aria-hidden /> {label(t("containers:actions.start"))}
        </button>
      )}
      {!withText && <span className="mx-1 h-[18px] w-px bg-line" aria-hidden />}
      <button className={withText ? `btn-secondary${sm}` : icon} title={t("containers:actions.restart")} aria-label={t("containers:actions.restart")} disabled={busy} onClick={() => action.mutate({ c, action: "restart" })}>
        <RotateCw className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> {label(t("containers:actions.restart"))}
      </button>
    </div>
  );
}
