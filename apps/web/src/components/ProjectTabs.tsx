import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitPullRequest, Trash2 } from "lucide-react";
import {
  defaultHealthCheck,
  type EnvGroup,
  type HealthCheckSettings,
  type HealthStatus,
  type PreviewSettings,
  type ProjectDetail,
  type ProjectSummary,
} from "@panel/shared";
import { api } from "../lib/api";
import { appUrl, timeAgo, useSettings } from "../lib/projects";
import { FormError } from "./AuthCard";
import { StateBadge } from "./ContainerUi";
import { DeployPill, EnvEditor } from "./ProjectUi";
import { AccessEditor, TailnetSetup } from "./AccessUi";
import { confirmDialog } from "../lib/dialog";
import { t } from "../i18n";
import { fmtTime } from "../lib/format";

// ---- Sağlık rozeti: ince çerçeveli etiket, işaret + yazı ----
export function HealthBadge({ health }: { health: HealthStatus | null }) {
  if (!health) return null;
  const s = {
    up: { label: t("projects:health.up"), tone: "success" as const, solid: true },
    down: { label: t("projects:health.down"), tone: "danger" as const, solid: false },
    unknown: { label: t("projects:health.unknown"), tone: "neutral" as const, solid: false },
  }[health.state];
  return (
    <span
      className={`badge h-[22px] tracking-normal ${s.tone === "success" ? "tone-neutral" : `tone-${s.tone}`}`}
      title={health.last?.error ?? (health.last ? `HTTP ${health.last.status} · ${health.last.latencyMs} ms` : "")}
    >
      <span className={`size-1.5 rounded-full ${s.solid ? "bg-success" : "ring-[1.5px] ring-current ring-inset"}`} aria-hidden />
      {s.label}
    </span>
  );
}

// ---- Sağlık kontrolü sekmesi ----
export function HealthTab({ p }: { p: ProjectDetail }) {
  const qc = useQueryClient();
  const [v, setV] = useState<HealthCheckSettings>(p.healthCheck ?? { ...defaultHealthCheck, enabled: false });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(p.healthCheck ?? { ...defaultHealthCheck, enabled: false }), [JSON.stringify(p.healthCheck)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(p.healthCheck ?? { ...defaultHealthCheck, enabled: false });
  const set = (patch: Partial<HealthCheckSettings>) => (setSaved(false), setV({ ...v, ...patch }));
  const num = (k: keyof HealthCheckSettings, label: string, min: number, max: number, suffix: string) => (
    <div>
      <div className="label" aria-hidden>{label}</div>
      <div className="flex items-center gap-2">
        <input aria-label={label} className="input" type="number" min={min} max={max} value={v[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) })} />
        <span className="shrink-0 text-xs text-subtle">{suffix}</span>
      </div>
    </div>
  );

  async function save() {
    setError(null);
    try {
      await api.put(`/api/projects/${p.id}/health`, { healthCheck: v.enabled || p.healthCheck ? v : null });
      await qc.invalidateQueries({ queryKey: ["project", p.id] });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const h = p.health;
  return (
    <div className="max-w-3xl space-y-4">
      {h && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <HealthBadge health={h} />
            <span className="text-xs text-subtle">
              {h.since && `${t("projects:health.since", { ago: timeAgo(h.since) })} · `}
              {h.last ? t("projects:health.lastCheck", { ago: timeAgo(h.last.at) }) : t("projects:health.noCheckYet")}
            </span>
          </div>
          {h.history.length > 0 && (
            <div className="flex h-8 items-end gap-0.5" aria-label={t("projects:health.recent")}>
              {h.history.map((r) => (
                <div
                  key={r.at}
                  title={`${fmtTime(r.at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${r.ok ? `HTTP ${r.status} · ${r.latencyMs} ms` : r.error}`}
                  className={`min-w-1 flex-1 rounded-sm ${r.ok ? "h-full bg-success/80" : "h-3/5 bg-danger"}`}
                />
              ))}
            </div>
          )}
          {h.last && !h.last.ok && <p className="text-sm text-danger">{h.last.error}</p>}
        </div>
      )}

      <div className="card space-y-4">
        <label className="check-row items-start text-sm">
          <input type="checkbox" className="mt-0.5" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>
            {t("projects:health.enabled")}
            <span className="block text-xs text-subtle">
              {t("projects:health.enabledHint")}
            </span>
          </span>
        </label>
        {v.enabled && (
          <>
            <div>
              <label className="block">
<span className="label">{t("projects:health.path")}</span>
              <input className="input font-mono" value={v.path} onChange={(e) => set({ path: e.target.value.trim() })} placeholder="/health" />
</label>
              <p className="mt-1 text-xs text-subtle">{t("projects:health.pathHint")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {num("intervalSec", t("projects:health.interval"), 10, 3600, t("projects:health.unitSec"))}
              {num("timeoutSec", t("projects:health.timeout"), 1, 60, t("projects:health.unitSec"))}
              {num("failureThreshold", t("projects:health.threshold"), 1, 20, t("projects:health.unitFailures"))}
            </div>
            <label className="check-row items-start text-sm text-fg/85">
              <input type="checkbox" className="mt-0.5" checked={v.autoRestart} onChange={(e) => set({ autoRestart: e.target.checked })} />
              <span>
                {t("projects:health.autoRestart")}
                <span className="block text-xs text-subtle">{t("projects:health.autoRestartHint")}</span>
              </span>
            </label>
          </>
        )}
        <FormError message={error} />
        <div className="flex items-center gap-3">
          <button className="btn" disabled={!dirty} onClick={save}>
            {t("actions.save")}
          </button>
          {saved && !dirty && <span className="text-xs text-success">{t("projects:save.saved")}</span>}
        </div>
      </div>
    </div>
  );
}

// ---- Ortak değişken grupları seçimi (Ortam değişkenleri sekmesinde) ----
export function EnvGroupsPicker({ p }: { p: ProjectDetail }) {
  const qc = useQueryClient();
  const { data: groups } = useQuery({ queryKey: ["env-groups"], queryFn: () => api.get<EnvGroup[]>("/api/env-groups") });
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: number, on: boolean) {
    setError(null);
    const groupIds = on ? [...p.envGroupIds, id] : p.envGroupIds.filter((g) => g !== id);
    try {
      await api.put(`/api/projects/${p.id}/env-groups`, { groupIds });
      await Promise.all([qc.invalidateQueries({ queryKey: ["project", p.id] }), qc.invalidateQueries({ queryKey: ["env-groups"] })]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const own = new Set(p.env.map((e) => e.key));
  return (
    <section className="max-w-3xl overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="env-groups-title">
      <div className="card-head">
        <h3 id="env-groups-title" className="cap">
          {t("projects:envGroups.title")}
        </h3>
        <Link to="/env-groups" className="card-link">
          {t("projects:envGroups.manage")}
        </Link>
      </div>
      {groups && groups.length === 0 && (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">
          {t("projects:envGroups.emptyBefore")}
          <Link to="/env-groups" className="link">
            {t("nav.envGroups")}
          </Link>
          {t("projects:envGroups.emptyAfter")}
        </p>
      )}
      {groups && groups.length > 0 && (
        <div>
          {groups.map((g) => {
            const on = p.envGroupIds.includes(g.id);
            const overridden = g.env.filter((e) => own.has(e.key)).map((e) => e.key);
            return (
              <label key={g.id} className="flex cursor-pointer items-start gap-2.5 border-b border-line-soft px-4 py-3 text-sm last:border-b-0 hover:bg-fg/[0.02] sm:px-5">
                <input type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(g.id, e.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{g.name}</span>{" "}
                  <span className="text-xs text-muted">
                    {t("projects:envGroups.vars", { count: g.env.length })} ·{" "}
                    {g.projects.length ? t("projects:envGroups.usedIn", { count: g.projects.length }) : t("projects:envGroups.unused")}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted">{g.env.map((e) => e.key).join(", ") || t("projects:envGroups.emptyGroup")}</span>
                  {on && overridden.length > 0 && (
                    <span className="block text-xs text-warning">{t("projects:envGroups.overridden", { keys: overridden.join(", ") })}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="space-y-2 border-t border-line px-4 py-3 sm:px-5">
        <FormError message={error} />
        <p className="text-xs text-muted">{t("projects:envGroups.note")}</p>
      </div>
    </section>
  );
}

// ---- PR önizlemeleri sekmesi ----
export function PreviewsTab({ p }: { p: ProjectDetail }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: previews } = useQuery({
    queryKey: ["previews", p.id],
    queryFn: () => api.get<ProjectSummary[]>(`/api/projects/${p.id}/previews`),
    refetchInterval: 5000,
  });
  const [v, setV] = useState<PreviewSettings>(p.previewSettings);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(p.previewSettings), [JSON.stringify(p.previewSettings)]); // eslint-disable-line react-hooks/exhaustive-deps
  const clean = { ...v, env: v.env.filter((e) => e.key) };
  const dirty = JSON.stringify(clean) !== JSON.stringify(p.previewSettings);
  const supported = p.source.type === "github" && !p.source.compose;

  async function save() {
    setError(null);
    try {
      const r = await api.put<{ warning: string | null }>(`/api/projects/${p.id}/previews`, clean);
      setWarning(r.warning);
      await qc.invalidateQueries({ queryKey: ["project", p.id] });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(x: ProjectSummary) {
    if (!(await confirmDialog({ title: t("projects:previews.deleteConfirm.title", { name: x.name }), message: t("projects:previews.deleteConfirm.message"), confirmLabel: t("actions.delete"), danger: true }))) return;
    await api.del(`/api/projects/${x.id}`);
    await qc.invalidateQueries({ queryKey: ["previews", p.id] });
  }

  if (!supported) {
    return (
      <div className="card max-w-3xl text-sm text-muted">
        {t("projects:previews.unsupported")}
        {p.source.type === "github" && ` ${t("projects:previews.unsupportedCompose")}`}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-4">
        <label className="check-row items-start text-sm">
          <input type="checkbox" className="mt-0.5" checked={v.enabled} onChange={(e) => (setSaved(false), setV({ ...v, enabled: e.target.checked }))} />
          <span>
            {t("projects:previews.enabled")}
            <span className="block text-xs text-subtle">
              {t("projects:previews.hint.p1")}
              <span className="font-mono">{p.source.type === "github" && p.source.branch}</span>
              {t("projects:previews.hint.p2")}
              <span className="font-mono">pr-12-{p.name}.{settings?.baseDomain}</span>
              {t("projects:previews.hint.p3")}
            </span>
          </span>
        </label>
        {v.enabled && (
          <>
            <div>
              <div className="label">{t("projects:previews.access")}</div>
              <AccessEditor value={v.access} onChange={(access) => (setSaved(false), setV({ ...v, access }))} />
            </div>
            <div>
              <div className="label">{t("projects:previews.envTitle")}</div>
              <p className="mb-2 text-xs text-subtle">
                {t("projects:previews.envBefore")}
                <span className="font-mono">DATABASE_URL</span>
                {t("projects:previews.envAfter")}
              </p>
              <EnvEditor value={v.env} onChange={(env) => (setSaved(false), setV({ ...v, env }))} />
            </div>
          </>
        )}
        <FormError message={error} />
        {warning && <p className="text-sm text-warning">{warning}</p>}
        <div className="flex items-center gap-3">
          <button className="btn" disabled={!dirty || (!!v.access && !v.access.tailnet && !v.access.ips.length)} onClick={save}>
            {t("actions.save")}
          </button>
          {saved && !dirty && <span className="text-xs text-success">{t("projects:save.saved")}</span>}
        </div>
        <p className="text-xs text-subtle">
          {t("projects:previews.appHint.before")}
          <i>Permissions → Pull requests: Read</i>
          {t("projects:previews.appHint.and")}
          <i>Subscribe to events → Pull request</i>
          {t("projects:previews.appHint.after")}
        </p>
      </div>

      {v.enabled && v.access?.tailnet && <TailnetSetup compact />}

      <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="previews-title">
        <div className="card-head">
          <h3 id="previews-title" className="cap">
            {t("projects:previews.openTitle")}
          </h3>
        </div>
        {previews?.length === 0 && <div className="px-4 py-4 text-sm text-muted sm:px-5">{t("projects:previews.none")}</div>}
        {previews?.map((x) => {
          const host = x.domains[0];
          return (
            <div key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 text-sm last:border-b-0 sm:px-5">
              <GitPullRequest className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link to={`/projects/${x.id}`} className="font-medium hover:underline">
                  <span className="font-semibold tabular-nums">#{x.preview?.prNumber}</span> {x.preview?.prTitle}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                  {host && (
                    <a href={appUrl(host.hostname, settings?.https ?? false)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-fg/90 hover:underline">
                      {host.hostname} <ExternalLink className="size-3 text-faint" aria-hidden />
                    </a>
                  )}
                  {x.preview?.prUrl && (
                    <a href={x.preview.prUrl} target="_blank" rel="noreferrer" className="hover:text-fg/85">
                      {t("projects:previews.openOnGithub")}
                    </a>
                  )}
                  <span className="font-mono">{x.source.type === "github" && x.source.branch}</span>
                </div>
              </div>
              {x.lastDeployment && <DeployPill status={x.lastDeployment.status} id={x.lastDeployment.id} />}
              {x.container && <StateBadge state={x.container.state} />}
              <button className="btn-icon hover:text-danger" title={t("projects:settings.deletePreview.title")} aria-label={t("projects:previews.deleteNamed", { name: x.name })} onClick={() => remove(x)}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
