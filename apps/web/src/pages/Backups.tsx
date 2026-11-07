import { ErrorNotice, PageHeader, StatusBadge } from "../components/Status";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Play, RotateCcw, Trash2 } from "lucide-react";
import type { BackupEntry, BackupSettings, OffsiteStatus } from "@panel/shared";
import { api, formatBytes } from "../lib/api";
import { useBackups } from "../lib/ops";
import { timeAgo } from "../lib/projects";
import { FormError } from "../components/AuthCard";
import { alertDialog, confirmDialog, showError } from "../lib/dialog";
import { OffsiteCard, RemoteTag, useOffsite } from "../components/OffsiteUi";
import { PanelRestoreModal, RecoveryCard } from "../components/RecoveryUi";
import { DotLegend, Panel, SummaryStrip, Switch, lede, panelBody, type StripCell } from "../components/MaintenanceUi";
import { t } from "../i18n";
import { fmtDate, fmtDateTime } from "../lib/format";

export function BackupsPage() {
  const qc = useQueryClient();
  const { data, error, refetch } = useBackups();
  const { data: offsite } = useOffsite();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function runAll() {
    setRunning(true);
    setMsg(null);
    try {
      const r = await api.post<BackupEntry[]>("/api/backups/run");
      const failed = r.filter((b) => b.status === "failed");
      setMsg(
        failed.length
          ? { text: t("backups:page.runFailed", { count: failed.length, names: failed.map((f) => f.targetName).join(", ") }), ok: false }
          : { text: t("backups:page.runDone", { count: r.length }), ok: true },
      );
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["backups"] });
      qc.invalidateQueries({ queryKey: ["databases"] });
    }
  }

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <PageHeader
        title={t("backups:page.title")}
        description={
          <>
            {t("backups:page.description")}
            {data?.settings.enabled && data.nextRunAt && (
              <>
                {" "}
                · {t("backups:page.nextRun")}{" "}
                <span className="font-mono text-xs text-fg" title={fmtDateTime(data.nextRunAt)}>
                  {fmtDateTime(data.nextRunAt, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </>
        }
        actions={
          <button className="btn max-sm:flex-1" onClick={runAll} disabled={running}>
            <Play className="size-4" aria-hidden /> {running ? t("backups:page.running") : t("backups:page.runAll")}
          </button>
        }
        flush
      />
      <p className={`text-sm ${msg?.ok ? "text-success" : "text-danger"} ${msg ? "" : "sr-only"}`} role="status">
        {msg?.text}
      </p>
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {data && <BackupStrip backups={data.backups} settings={data.settings} offsite={offsite} />}
      <RecoveryCard />
      <div className="grid items-start gap-4 md:gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        {data ? <SettingsCard settings={data.settings} directory={data.directory} nextRunAt={data.nextRunAt} /> : <div className="skeleton h-96" />}
        <OffsiteCard />
      </div>
      {data && <BackupList backups={data.backups} />}
      <DotLegend
        items={[
          ["ok", t("backups:legend.ok")],
          ["warning", t("backups:legend.warning")],
          ["danger", t("backups:legend.failed")],
          ["spin", t("backups:legend.running")],
          ["none", t("backups:legend.waiting")],
        ]}
      />
    </div>
  );
}

/** Yedek koruması şeridi: son yedek, geri dönüş noktası, sunucu dışı kopya, kurtarma anahtarı */
function BackupStrip({ backups, settings, offsite }: { backups: BackupEntry[]; settings: BackupSettings; offsite: OffsiteStatus | undefined }) {
  const lastOk = backups.filter((b) => b.status === "success").sort((a, b) => b.createdAt - a.createdAt)[0];
  // Her hedefin en son yedeği başarısızsa sayılır
  const latest = new Map<string, BackupEntry>();
  for (const b of [...backups].sort((a, b) => b.createdAt - a.createdAt)) {
    const k = `${b.kind}:${b.targetName}`;
    if (!latest.has(k)) latest.set(k, b);
  }
  const failed = [...latest.values()].filter((b) => b.status === "failed").length;
  const notes: string[] = [];
  if (failed) notes.push(t("backups:strip.failed", { count: failed }));
  if (offsite?.pending) notes.push(t("backups:strip.pending", { count: offsite.pending }));
  if (offsite?.failed) notes.push(t("backups:strip.uploadFailed", { count: offsite.failed }));

  const points = settings.enabled && settings.days.length ? plan(settings).points : null;
  const lastLabel = t("backups:strip.lastBackup");
  const pointsLabel = t("backups:strip.restorePoints");
  const offsiteLabel = t("backups:strip.offsite");
  const keyLabel = t("backups:strip.recoveryKey");
  const cells: StripCell[] = [
    lastOk
      ? { label: lastLabel, value: timeAgo(lastOk.createdAt), level: "ok", title: fmtDateTime(lastOk.createdAt) }
      : { label: lastLabel, value: t("backups:strip.none"), level: "warning" },
    points == null
      ? { label: pointsLabel, value: t("backups:strip.autoOff"), level: "warning" }
      : { label: pointsLabel, value: t("backups:strip.pointsPerTarget", { count: points }), level: points < 3 ? "warning" : "ok" },
    !offsite
      ? { label: offsiteLabel, value: "—", level: "none" }
      : !offsite.configured
        ? { label: offsiteLabel, value: t("backups:strip.notConfigured"), level: "warning" }
        : !offsite.settings?.enabled
          ? { label: offsiteLabel, value: t("backups:strip.off"), level: "warning" }
          : { label: offsiteLabel, value: t("backups:strip.on"), level: offsite.failed ? "danger" : "ok" },
    !offsite
      ? { label: keyLabel, value: "—", level: "none" }
      : offsite.keyFingerprint
        ? offsite.keySaved
          ? {
              label: keyLabel,
              value: t("backups:strip.keySaved", { time: timeAgo(offsite.keySaved.at) }),
              level: "ok",
              title: t("backups:strip.fingerprint", { fp: offsite.keyFingerprint }),
            }
          : {
              label: keyLabel,
              value: t("backups:strip.neverShown"),
              level: "warning",
              title: t("backups:strip.neverShownTitle", { fp: offsite.keyFingerprint }),
            }
        : { label: keyLabel, value: t("backups:strip.none"), level: "none", title: t("backups:strip.keyCreatedLater") },
  ];

  const off = !settings.enabled;
  return (
    <SummaryStrip
      label={t("backups:strip.label")}
      title={t("backups:strip.label")}
      head={off ? t("backups:strip.headOff") : !lastOk ? t("backups:strip.headNone") : t("backups:strip.headOk")}
      headLevel={off || !lastOk || notes.length ? (failed || offsite?.failed ? "danger" : "warning") : "ok"}
      detail={notes.length ? notes.join(", ") : undefined}
      cells={cells}
    />
  );
}

// Pazartesiden başlayan sıra; değerler cron günleri (0 = Pazar)
const weekdays = [1, 2, 3, 4, 5, 6, 0] as const;
/** Kısa gün adı seçili dilde: 1 Ocak 2024 Pazartesi */
const weekdayName = (d: number) => fmtDate(new Date(2024, 0, 1 + ((d + 6) % 7)), { weekday: "short" });

/**
 * Seçilen günler + saklama süresi + "en az tut" ile kaç geri dönüş noktası olacağını ve en kötü
 * durumda kaç günlük veri kaybedilebileceğini hesaplar (yanlış ayarı kaydetmeden fark etmek için).
 */
function plan(s: BackupSettings) {
  const days = [...new Set(s.days)].sort((a, b) => a - b);
  // Haftalık takvimde iki yedek arasındaki en uzun boşluk (gün)
  let gap = 7;
  if (days.length > 1) gap = Math.max(...days.map((d, i) => (i + 1 < days.length ? days[i + 1]! : days[0]! + 7) - d));
  // Son 400 günde yedek alınan günler (bugünden geriye), saklananlar
  const ages: number[] = [];
  const today = new Date().getDay();
  for (let back = 0; back < 400; back++) if (days.includes((((today - back) % 7) + 7) % 7)) ages.push(back);
  const inWindow = ages.filter((a) => a <= s.retentionDays).length;
  const points = Math.max(inWindow, Math.min(s.keepMin ?? 3, ages.length));
  return { points, oldest: ages[points - 1] ?? 0, gap };
}

function PlanSummary({ s }: { s: BackupSettings }) {
  const { points, oldest, gap } = plan(s);
  const risky = points < 3;
  return (
    <div
      className={`rounded-md border px-3.5 py-3 text-xs leading-[18px] text-muted [&_b]:font-semibold [&_b]:text-fg ${risky ? "border-warning/30 bg-warning/[0.05]" : "border-line bg-canvas/50"}`}
      aria-live="polite"
    >
      {t("backups:plan.before")} <b>{t("backups:plan.points", { count: points })}</b>
      {t("backups:plan.middle", { oldest })} <b>{t("backups:plan.gap", { count: gap })}</b> {t("backups:plan.after")}
      {risky && (
        <span className="mt-1 block text-warning">
          {t("backups:plan.risky")}
        </span>
      )}
    </div>
  );
}

function SettingsCard({ settings, directory, nextRunAt }: { settings: BackupSettings; directory: string; nextRunAt: number | null }) {
  const qc = useQueryClient();
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  async function save() {
    setError(null);
    try {
      await api.put("/api/backups/settings", s);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["backups"] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const dayBtn = "chip min-h-11 min-w-11 justify-center disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8 md:min-w-9 md:px-2";

  return (
    <Panel
      id="oto-yedek"
      title={t("backups:schedule.title")}
      aside={
        <Switch checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} className="text-xs text-muted">
          <span className="sr-only">{t("backups:schedule.toggle")}</span>
          {s.enabled ? t("backups:schedule.on") : t("backups:schedule.off")}
        </Switch>
      }
      footer={
        <>
          <button className="btn-secondary max-sm:w-full" disabled={!dirty || (s.enabled && s.days.length === 0)} onClick={save}>
            {t("actions.save")}
          </button>
          <span className="text-xs text-muted" role="status">
            {dirty ? t("backups:schedule.unsaved") : saved ? <span className="text-success">{t("backups:schedule.saved")}</span> : t("states.noChanges")}
          </span>
        </>
      }
    >
      <div className={panelBody}>
        <div>
          <div className="label" id="days-label">
            {t("backups:schedule.days")}
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-labelledby="days-label">
            {weekdays.map((d) => {
              const on = s.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!s.enabled}
                  aria-pressed={on}
                  onClick={() => setS({ ...s, days: on ? s.days.filter((x) => x !== d) : [...s.days, d].sort() })}
                  className={dayBtn}
                >
                  {weekdayName(d)}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px self-center bg-line" aria-hidden />
            {(
              [
                [t("backups:schedule.everyDay"), [0, 1, 2, 3, 4, 5, 6]],
                [t("backups:schedule.twiceWeek"), [1, 4]],
                [t("backups:schedule.onceWeek"), [0]],
              ] as const
            ).map(([label, days]) => (
              <button key={label} type="button" disabled={!s.enabled} className="btn-ghost btn-sm max-md:min-h-11 md:px-2" onClick={() => setS({ ...s, days: [...days] })}>
                {label}
              </button>
            ))}
          </div>
          {s.enabled && s.days.length === 0 && <p className="mt-1 text-xs text-danger">{t("backups:schedule.pickDay")}</p>}
        </div>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <label className="block min-w-0">
            <span className="label">{t("backups:schedule.hour")}</span>
            <select className="input" value={s.hour} onChange={(e) => setS({ ...s, hour: Number(e.target.value) })} disabled={!s.enabled}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:schedule.retention")}</span>
            <select className="input" value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Number(e.target.value) })}>
              {[3, 7, 14, 30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {t("backups:schedule.dayCount", { count: d })}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:schedule.keepMin")}</span>
            <select className="input" value={s.keepMin ?? 3} onChange={(e) => setS({ ...s, keepMin: Number(e.target.value) })}>
              {[1, 2, 3, 5, 7, 10, 14].map((n) => (
                <option key={n} value={n}>
                  {t("backups:schedule.lastN", { count: n })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm max-md:min-h-11">
          <input type="checkbox" className="mt-[3px]" checked={s.includePanel} onChange={(e) => setS({ ...s, includePanel: e.target.checked })} />
          <span>
            {t("backups:schedule.includePanel")}
            <small className="block text-xs leading-4 text-muted">{t("backups:schedule.includePanelHint")}</small>
          </span>
        </label>
        {s.enabled && s.days.length > 0 && <PlanSummary s={s} />}
        {settings.enabled && nextRunAt && (
          <p className="text-xs text-muted">
            {t("backups:schedule.next")}{" "}
            <b className="font-semibold text-fg">
              {fmtDateTime(nextRunAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </b>
          </p>
        )}
        <p className={lede}>
          {t("backups:schedule.whereBefore")} <code className="font-mono text-[11px] break-all text-fg">{directory}</code>
          {t("backups:schedule.whereAfter")}
        </p>
        <FormError message={error} />
      </div>
    </Panel>
  );
}

const kindFilters = ["all", "database", "panel", "volume"] as const;
type KindFilter = (typeof kindFilters)[number];

const triggerLabel = (tr: BackupEntry["trigger"]) => t(`backups:list.trigger.${tr}`);

const statusShape = {
  success: { tone: "success", shape: "dot" },
  failed: { tone: "danger", shape: "x" },
  running: { tone: "info", shape: "spin" },
} as const;
const statusBadge = (s: BackupEntry["status"]) => ({ ...statusShape[s], label: t(`backups:list.status.${s}`) });

function targetMeta(b: BackupEntry) {
  return b.kind === "panel"
    ? t("backups:list.meta.panel")
    : b.kind === "volume"
      ? t("backups:list.meta.volume")
      : `${t("backups:list.meta.database")}${b.engine ? ` · ${b.engine}` : ""}`;
}

function BackupList({ backups }: { backups: BackupEntry[] }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [panelRestore, setPanelRestore] = useState<BackupEntry | null>(null);

  async function restore(b: BackupEntry) {
    if (b.kind === "panel") return setPanelRestore(b);
    const when = fmtDateTime(b.createdAt);
    const ok = await confirmDialog({
      title: t("backups:list.restoreConfirm.title"),
      message:
        b.kind === "volume"
          ? t("backups:list.restoreConfirm.volume", { name: b.targetName, when })
          : t("backups:list.restoreConfirm.database", { name: b.targetName, when }),
      confirmLabel: t("backups:list.restoreConfirm.confirm"),
      danger: true,
      typeToConfirm: b.targetName,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      const r = await api.post<{ safetyBackupId: number }>(`/api/backups/${b.id}/restore`);
      void alertDialog({ title: t("backups:list.restoreDone"), message: t("backups:list.safetyBackup", { id: r.safetyBackupId }), tone: "success" });
    } catch (err) {
      void showError(err, t("backups:list.restoreFailed"));
    } finally {
      setBusyId(null);
      qc.invalidateQueries({ queryKey: ["backups"] });
    }
  }

  async function remove(b: BackupEntry) {
    if (!(await confirmDialog({ title: t("backups:list.deleteConfirm"), message: b.fileName ?? `#${b.id}`, confirmLabel: t("actions.delete"), danger: true }))) return;
    await api.del(`/api/backups/${b.id}`).catch((e: Error) => showError(e));
    qc.invalidateQueries({ queryKey: ["backups"] });
  }

  const name = (b: BackupEntry) => (b.kind === "panel" ? t("backups:list.panelName") : b.targetName);

  const actions = (b: BackupEntry): ReactNode => (
    <div className="flex justify-end gap-0.5">
      {b.status === "success" && (
        <a className="btn-icon" href={`/api/backups/${b.id}/download`} title={t("backups:list.download")} aria-label={t("backups:list.downloadLabel", { name: name(b) })}>
          <Download className="size-4" aria-hidden />
        </a>
      )}
      {b.restorable && (
        <button
          className="btn-icon"
          title={b.kind === "panel" ? t("backups:list.restorePanelTitle") : t("backups:list.restore")}
          aria-label={b.kind === "panel" ? t("backups:list.restorePanelLabel") : t("backups:list.restoreLabel", { name: name(b) })}
          disabled={busyId !== null}
          onClick={() => restore(b)}
        >
          <RotateCcw className={`size-4 ${busyId === b.id ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
        </button>
      )}
      {b.status !== "running" && (
        <button className="btn-icon hover:text-danger" title={t("actions.delete")} aria-label={t("backups:list.deleteLabel", { name: name(b) })} onClick={() => remove(b)}>
          <Trash2 className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );

  const shown = filter === "all" ? backups : backups.filter((b) => b.kind === filter);
  const total = shown.reduce((n, b) => n + (b.sizeBytes ?? 0), 0);

  return (
    <>
      {panelRestore && <PanelRestoreModal b={panelRestore} onClose={() => setPanelRestore(null)} />}
      <Panel
        id="yedek-listesi"
        title={t("backups:list.title")}
        aside={
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("backups:list.filterLabel")}>
            {kindFilters.map((k) => (
              <button key={k} type="button" className="chip min-h-11 md:min-h-7" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {t(`backups:list.filter.${k}`)}
              </button>
            ))}
          </div>
        }
        footer={
          shown.length > 0 && (
            <span className="text-xs text-muted">
              <span className="font-mono text-fg">{shown.length}</span> {t("backups:list.footerCount", { count: shown.length })}{" "}
              <span className="font-mono text-fg">{formatBytes(total)}</span> {t("backups:list.footerNote")}
            </span>
          )
        }
      >
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
            <Archive className="size-6 text-faint" aria-hidden />
            {backups.length === 0 ? t("backups:list.empty") : t("backups:list.emptyKind")}
          </div>
        ) : (
          <>
            {/* Masaüstü: tablo */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold sm:px-5">{t("backups:list.col.target")}</th>
                    <th className="px-4 py-2.5 font-semibold">{t("backups:list.col.trigger")}</th>
                    <th className="px-4 py-2.5 font-semibold">{t("backups:list.col.status")}</th>
                    <th className="px-4 py-2.5 font-semibold whitespace-nowrap">{t("backups:list.col.offsite")}</th>
                    <th className="px-4 py-2.5 font-semibold">{t("backups:list.col.date")}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{t("backups:list.col.size")}</th>
                    <th className="px-4 py-2.5">
                      <span className="sr-only">{t("backups:list.col.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.id} className="border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02]">
                      <td className="max-w-72 px-4 py-2.5 sm:px-5">
                        <div className="truncate font-semibold" title={name(b)}>
                          {name(b)}
                        </div>
                        <div className="truncate text-xs text-muted">{targetMeta(b)}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">{triggerLabel(b.trigger)}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge {...statusBadge(b.status)} />
                        {b.error && (
                          <div className="mt-0.5 line-clamp-2 max-w-60 text-xs text-danger" title={b.error}>
                            {b.error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <RemoteTag b={b} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted tabular-nums" title={fmtDateTime(b.createdAt)}>
                        {timeAgo(b.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap text-muted tabular-nums">{b.sizeBytes != null ? formatBytes(b.sizeBytes) : "—"}</td>
                      <td className="py-1 pr-3 pl-2">{actions(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Telefon: satır yığını */}
            <ul className="md:hidden">
              {shown.map((b) => (
                <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line-soft py-3 pr-2 pl-4 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{name(b)}</div>
                    <div className="truncate text-xs text-muted">
                      {targetMeta(b)} · {triggerLabel(b.trigger)}
                    </div>
                  </div>
                  <div className="row-span-2">{actions(b)}</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                    <StatusBadge {...statusBadge(b.status)} />
                    {b.remoteStatus && <RemoteTag b={b} />}
                    <span className="font-mono tabular-nums">{timeAgo(b.createdAt)}</span>
                    {b.sizeBytes != null && <span className="font-mono tabular-nums">{formatBytes(b.sizeBytes)}</span>}
                  </div>
                  {b.error && <div className="col-span-2 text-xs text-danger [overflow-wrap:anywhere]">{b.error}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
