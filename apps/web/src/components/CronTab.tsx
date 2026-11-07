import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import type { CronJob } from "@panel/shared";
import { api } from "../lib/api";
import { useCronJobs } from "../lib/ops";
import { timeAgo } from "../lib/projects";
import { FormError } from "./AuthCard";
import { confirmDialog, showError } from "../lib/dialog";
import { t } from "../i18n";
import { fmtDateTime, fmtNumber } from "../lib/format";

const presets = [
  { id: "every5", value: "*/5 * * * *" },
  { id: "hourly", value: "0 * * * *" },
  { id: "daily", value: "0 3 * * *" },
  { id: "weekly", value: "0 9 * * 1" },
  { id: "monthly", value: "0 0 1 * *" },
] as const;

const seconds = (ms: number) => t("projects:cron.seconds", { n: fmtNumber(ms / 1000, 1) });

export function CronTab({ projectId, hasContainer }: { projectId: number; hasContainer: boolean }) {
  const qc = useQueryClient();
  const { data } = useCronJobs(projectId);
  const [editing, setEditing] = useState<CronJob | "new" | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [openOutput, setOpenOutput] = useState<number | null>(null);

  async function run(j: CronJob) {
    setRunningId(j.id);
    try {
      await api.post(`/api/projects/${projectId}/cron/${j.id}/run`);
      setOpenOutput(j.id);
    } catch (err) {
      void showError(err, t("projects:cron.runFailed"));
    } finally {
      setRunningId(null);
      qc.invalidateQueries({ queryKey: ["cron", projectId] });
    }
  }

  async function remove(j: CronJob) {
    if (!(await confirmDialog({ title: t("projects:cron.deleteConfirm", { name: j.name }), confirmLabel: t("actions.delete"), danger: true }))) return;
    await api.del(`/api/projects/${projectId}/cron/${j.id}`);
    qc.invalidateQueries({ queryKey: ["cron", projectId] });
  }

  return (
    <div className="max-w-3xl space-y-4">
      {!hasContainer && (
        <p className="notice notice-warning block">
          {t("projects:cron.needsContainer")}
        </p>
      )}
      <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="cron-title">
        <div className="card-head">
          <h3 id="cron-title" className="cap">
            {t("projects:cron.title")}
          </h3>
          {editing !== "new" && (
            <button className="btn-secondary btn-sm max-md:min-h-11" onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> {t("projects:cron.add")}
            </button>
          )}
        </div>
        {data?.map((j) => (
          <div key={j.id} className="space-y-2 border-b border-line-soft px-4 py-3 last:border-b-0 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{j.name}</span>
                  {!j.enabled && <span className="badge tone-neutral">{t("projects:cron.disabled")}</span>}
                </div>
                <div className="mt-0.5 flex min-w-0 gap-2 font-mono text-xs">
                  <span className="shrink-0 text-fg/90">{j.schedule}</span>
                  <span className="truncate text-muted" title={j.command}>
                    {j.command}
                  </span>
                </div>
              </div>
              <div className="text-right text-xs text-muted">
                {j.lastRunAt ? (
                  <button
                    onClick={() => setOpenOutput(openOutput === j.id ? null : j.id)}
                    className="inline-flex min-h-8 items-center gap-2 hover:text-fg"
                    aria-expanded={openOutput === j.id}
                    title={t("projects:cron.showOutput")}
                  >
                    <span
                      className={`dot ${j.lastStatus === "success" ? "dot-ok" : j.lastStatus === "failed" ? "dot-urgent" : "dot-info"}`}
                      aria-hidden
                    />
                    <span>
                      {t("projects:cron.last", { ago: timeAgo(j.lastRunAt) })}
                      {j.lastStatus === "failed" ? ` · ${t("projects:cron.failed")}` : j.lastStatus === "success" ? "" : ` · ${t("projects:cron.running")}`}
                      {j.lastDurationMs != null && j.lastStatus !== "running" && <span className="font-mono tabular-nums"> · {seconds(j.lastDurationMs)}</span>}
                    </span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="dot dot-none" aria-hidden /> {t("projects:cron.neverRan")}
                  </span>
                )}
                {j.nextRunAt && (
                  <div className="tabular-nums">{t("projects:cron.next", { at: fmtDateTime(j.nextRunAt, { dateStyle: "short", timeStyle: "short" }) })}</div>
                )}
              </div>
              <div className="flex gap-0.5">
                <button
                  className="btn-icon"
                  title={t("projects:cron.runNow")}
                  aria-label={t("projects:cron.runNowNamed", { name: j.name })}
                  disabled={runningId !== null || !hasContainer}
                  onClick={() => run(j)}
                >
                  <Play className={`size-4 ${runningId === j.id ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden />
                </button>
                <button className="btn-icon" title={t("actions.edit")} aria-label={t("projects:cron.editNamed", { name: j.name })} onClick={() => setEditing(j)}>
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button className="btn-icon hover:text-danger" title={t("actions.delete")} aria-label={t("projects:cron.deleteNamed", { name: j.name })} onClick={() => remove(j)}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </div>
            {openOutput === j.id && j.lastOutput !== null && (
              <pre className="max-h-64 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-meter">
                {j.lastOutput || t("projects:cron.noOutput")}
                {j.lastDurationMs != null && <span className="text-subtle">{`\n— ${seconds(j.lastDurationMs)}`}</span>}
              </pre>
            )}
          </div>
        ))}
        {data?.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">{t("projects:cron.empty")}</p>
        )}
      </section>

      {editing && <JobForm projectId={projectId} job={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
    </div>
  );
}

function JobForm({ projectId, job, onDone }: { projectId: number; job: CronJob | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(job?.name ?? "");
  const [schedule, setSchedule] = useState(job?.schedule ?? "0 3 * * *");
  const [command, setCommand] = useState(job?.command ?? "");
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cron ifadesini yazarken sıradaki çalışma zamanını göster
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const r = await api.get<{ nextRunAt: number }>(`/api/cron/preview?schedule=${encodeURIComponent(schedule)}`);
        setPreview(t("projects:cron.form.nextRun", { at: fmtDateTime(r.nextRunAt) }));
      } catch (err) {
        setPreview((err as Error).message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [schedule]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = { name, schedule, command, enabled };
      if (job) await api.put(`/api/projects/${projectId}/cron/${job.id}`, body);
      else await api.post(`/api/projects/${projectId}/cron`, body);
      qc.invalidateQueries({ queryKey: ["cron", projectId] });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{job ? t("projects:cron.form.edit") : t("projects:cron.form.new")}</h3>
        <button type="button" className="btn-icon" title={t("actions.close")} aria-label={t("projects:cron.form.close")} onClick={onDone}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block">
<span className="label">{t("projects:cron.form.name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("projects:cron.form.namePlaceholder")} autoFocus />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("projects:cron.form.schedule")}</span>
          <input className="input font-mono" spellCheck={false} autoCapitalize="off" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
</label>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {presets.map((p) => (
              <button type="button" key={p.value} className="chip" onClick={() => setSchedule(p.value)}>
                {t(`projects:cron.presets.${p.id}`)}
              </button>
            ))}
          </div>
          {preview && <p className="hint">{preview}</p>}
        </div>
      </div>
      <div>
        <label className="block">
<span className="label">{t("projects:cron.form.command")}</span>
        <textarea className="input h-20 font-mono text-xs" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("projects:cron.form.commandPlaceholder")} />
</label>
        <p className="mt-1 text-xs text-subtle">{t("projects:cron.form.commandHint")}</p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("projects:cron.form.enabled")}
      </label>
      <FormError message={error} />
      <button className="btn" disabled={!name || !command || !schedule}>
        {t("actions.save")}
      </button>
    </form>
  );
}
