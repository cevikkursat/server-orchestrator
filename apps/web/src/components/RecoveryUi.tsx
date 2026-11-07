import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, Cloud, HardDrive, LifeBuoy, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { BackupEntry, RecoveryPlan, RecoverySource, RecoveryStatus } from "@panel/shared";
import { api } from "../lib/api";
import { confirmDialog } from "../lib/dialog";
import { FormError } from "./AuthCard";
import { Modal } from "./Modal";
import { Dot, lede } from "./MaintenanceUi";
import { t } from "../i18n";
import { fmtDateTime } from "../lib/format";

const when = (ts: number) => fmtDateTime(ts, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Source({ s }: { s: RecoverySource | null }) {
  if (!s) return <span className="text-warning">{t("backups:recovery.noBackup")}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      {s.where === "remote" ? <Cloud className="size-3.5" aria-hidden /> : <HardDrive className="size-3.5" aria-hidden />}
      {when(s.createdAt)} {s.where === "remote" ? t("backups:recovery.fromRemote") : ""}
    </span>
  );
}

/**
 * Panel yedeği yeni sunucuya açıldıktan sonra: kayıtlı ama sunucuda olmayan veritabanları, projeler
 * ve kalıcı klasörler. Eksik yokken sessiz, kapalı bir satır; eksik varken ya da kurtarma sürerken öne çıkar.
 */
export function RecoveryCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["recovery"],
    queryFn: () => api.get<{ plan: RecoveryPlan; job: RecoveryStatus | null }>("/api/recovery"),
    refetchInterval: (q) => (q.state.data?.job?.state === "running" ? 2000 : 60_000),
  });
  const [error, setError] = useState<string | null>(null);
  const plan = data?.plan;
  const job = data?.job;
  const missing = plan ? plan.databases.length + plan.projects.length + plan.volumes.length : 0;

  useEffect(() => {
    if (job && job.state !== "running") {
      qc.invalidateQueries({ queryKey: ["backups"] });
      qc.invalidateQueries({ queryKey: ["databases"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    }
  }, [job?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) return null;

  // Eksik yok, iş yok: sessiz satır
  if (!missing && !job)
    return (
      <details className="group min-w-0 rounded-lg border border-line bg-raised">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-xs text-muted sm:px-5 [&::-webkit-details-marker]:hidden">
          <Dot level="ok" />
          <b className="text-sm font-semibold text-fg">{t("backups:recovery.title")}</b>
          <span className="min-w-0 truncate">{t("backups:recovery.nothingMissing")}</span>
          <span className="ml-auto text-faint transition-transform duration-150 group-open:rotate-180" aria-hidden>
            ▾
          </span>
        </summary>
        <p className={`px-4 pb-3.5 sm:px-5 ${lede}`}>{t("backups:recovery.explain")}</p>
      </details>
    );

  async function run() {
    const ok = await confirmDialog({
      title: t("backups:recovery.confirm.title"),
      message: t("backups:recovery.confirm.message"),
      confirmLabel: t("backups:recovery.confirm.confirm"),
    });
    if (!ok) return;
    setError(null);
    try {
      await api.post("/api/recovery/run");
      qc.invalidateQueries({ queryKey: ["recovery"] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const running = job?.state === "running";
  const level = running ? "info" : missing ? "warning" : job?.failed ? "warning" : "ok";
  const groups = [
    {
      title: t("backups:recovery.databases"),
      count: plan.databases.length,
      items: plan.databases.map((d) => (
        <li key={d.id} className="py-0.5">
          <span className="font-mono text-xs text-fg">{d.name}</span> <span className="text-xs text-muted">{d.engine}</span>
          <div className="text-xs">
            <Source s={d.source} />
          </div>
        </li>
      )),
    },
    {
      title: t("backups:recovery.projects"),
      count: plan.projects.length,
      items: plan.projects.map((p) => (
        <li key={p.id} className="py-0.5">
          <span className="font-mono text-xs text-fg">{p.name}</span> <span className="text-xs text-muted">{t("backups:recovery.willDeploy")}</span>
        </li>
      )),
    },
    {
      title: t("backups:recovery.volumes"),
      count: plan.volumes.length,
      items: plan.volumes.map((v) => (
        <li key={`${v.project}/${v.volume}`} className="py-0.5">
          <span className="font-mono text-xs text-fg">
            {v.project}/{v.volume}
          </span>
          <div className="text-xs">
            <Source s={v.source} />
          </div>
        </li>
      )),
    },
  ];

  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border bg-raised ${level === "warning" ? "border-warning/35" : "border-line"}`} aria-labelledby="recovery-title">
      <div className="card-head flex-wrap">
        <h2 id="recovery-title" className="cap flex items-center gap-2">
          <LifeBuoy className="size-3.5" aria-hidden /> {t("backups:recovery.title")}
        </h2>
        <span className={`flex items-center gap-2 text-xs ${level === "warning" ? "text-warning" : level === "info" ? "text-info" : "text-fg"}`}>
          {running ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : <Dot level={level} />}
          {running
            ? t("backups:recovery.running")
            : missing
              ? t("backups:recovery.missing", { count: missing })
              : job?.failed
                ? t("backups:recovery.stepsFailed", { count: job.failed })
                : t("backups:recovery.done")}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className={`${lede} flex-1`}>
            {running
              ? t("backups:recovery.runningText")
              : missing
                ? t("backups:recovery.missingText")
                : t("backups:recovery.finished")}
          </p>
          {missing > 0 && !running && (
            <button className="btn-secondary max-sm:w-full" onClick={run}>
              <LifeBuoy className="size-4" aria-hidden /> {job ? t("backups:recovery.retry") : t("backups:recovery.start")}
            </button>
          )}
        </div>

        {missing > 0 && !running && (
          <div className="grid gap-3 md:grid-cols-3">
            {groups.map((g) => (
              <div key={g.title} className="min-w-0">
                <div className="label">
                  {g.title} <span className="font-mono text-faint">({g.count})</span>
                </div>
                {g.count ? <ul>{g.items}</ul> : <p className="text-xs text-muted">{t("backups:recovery.noneMissing")}</p>}
              </div>
            ))}
          </div>
        )}
        {plan.remoteError && <p className="text-xs text-warning">{t("backups:recovery.remoteError", { error: plan.remoteError })}</p>}
        {!plan.remoteConfigured && missing > 0 && (
          <p className={lede}>
            {t("backups:recovery.noRemote")}
          </p>
        )}

        {job && (
          <ul className="flex flex-col gap-1.5 rounded-md border border-line-soft bg-canvas p-3 text-sm" aria-live="polite">
            {job.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                {s.state === "running" ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info motion-reduce:animate-none" aria-label={t("backups:recovery.step.running")} />
                ) : s.state === "done" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label={t("backups:recovery.step.done")} />
                ) : s.state === "failed" ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label={t("backups:recovery.step.failed")} />
                ) : (
                  <MinusCircle className="mt-0.5 size-4 shrink-0 text-faint" aria-label={t("backups:recovery.step.skipped")} />
                )}
                <div className="min-w-0">
                  <div>{s.label}</div>
                  {s.detail && <div className={`text-xs ${s.state === "failed" ? "text-danger" : "text-muted"}`}>{s.detail}</div>}
                </div>
              </li>
            ))}
            {running && !job.steps.length && (
              <li className="flex gap-2 text-muted">
                <CircleDashed className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> {t("backups:recovery.starting")}
              </li>
            )}
          </ul>
        )}
        {job && !running && (
          <p className={`text-sm ${job.failed ? "text-warning" : "text-success"}`}>
            {job.failed ? t("backups:recovery.failedResult", { count: job.failed }) : t("backups:recovery.completed")} {t("backups:recovery.dnsReminder")}
          </p>
        )}
        <FormError message={error} />
      </div>
    </section>
  );
}

/** Panel yedeğine dönüş: bütün panel verisini değiştirir; 2FA ister, panel yeniden başlar */
export function PanelRestoreModal({ b, onClose }: { b: BackupEntry; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"form" | "restarting">("form");

  async function submit() {
    setError(null);
    try {
      await api.post(`/api/backups/${b.id}/restore-panel`, { code });
      setPhase("restarting");
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    }
  }

  // Panel yeniden açılınca giriş ekranına git (oturumlar yedekteki veritabanından gelir)
  useEffect(() => {
    if (phase !== "restarting") return;
    let down = false;
    const timer = setInterval(async () => {
      const up = await fetch("/api/health").then((r) => r.ok).catch(() => false);
      if (!up) down = true;
      else if (down) window.location.href = "/login";
    }, 1500);
    const fallback = setTimeout(() => (window.location.href = "/login"), 90_000);
    return () => {
      clearInterval(timer);
      clearTimeout(fallback);
    };
  }, [phase]);

  return (
    <Modal title={t("backups:panelRestore.title")} onClose={phase === "form" ? onClose : () => {}}>
      {phase === "restarting" ? (
        <div className="flex items-center gap-3 py-4 text-sm text-fg/85">
          <Loader2 className="size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" aria-hidden />
          {t("backups:panelRestore.restarting")}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="notice notice-danger">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              {t("backups:panelRestore.warnBefore")} <b>{t("backups:panelRestore.warnBold")}</b> {t("backups:panelRestore.warnMiddle", { when: when(b.createdAt) })}{" "}
              <span className="font-mono">before-restore-…</span> {t("backups:panelRestore.warnAfter")}
            </div>
          </div>
          <div>
            <label className="block">
<span className="label">
              {t("backups:panelRestore.typeBefore")} <span className="font-mono text-fg">panel</span> {t("backups:panelRestore.typeAfter")}
            </span>
            <input className="input font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
</label>
          </div>
          <div>
            <label className="block">
<span className="label">{t("backups:panelRestore.code")}</span>
            <input
              className="input text-center font-mono tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
</label>
          </div>
          <FormError message={error} />
          <button className="btn-danger-solid w-full" disabled={typed !== "panel" || code.length !== 6}>
            {t("backups:panelRestore.submit")}
          </button>
        </form>
      )}
    </Modal>
  );
}
