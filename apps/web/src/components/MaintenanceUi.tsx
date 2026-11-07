import { useEffect, useState, useRef, type ReactNode, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Loader2, RefreshCw } from "lucide-react";
import type { CleanupOverview, UpdateStatus } from "@panel/shared";
import { api, formatBytes } from "../lib/api";
import { timeAgo } from "../lib/projects";
import { useSystem, type Level } from "../lib/status";
import { FormError } from "./AuthCard";
import { confirmDialog } from "../lib/dialog";
import { t } from "../i18n";
import { fmtDate, fmtDateTime } from "../lib/format";

// ---- Ortak parçalar (Yedekler, Güvenlik, Ayarlar sayfaları) ----

/** Durum noktası: dolu = yolunda, amber halka = bakılmalı, mercan halka = acil, gri halka = veri yok / pasif */
export function Dot({ level, className = "" }: { level: Level | "none"; className?: string }) {
  const cls = { ok: "dot-ok", info: "dot-info", warning: "dot-look", danger: "dot-urgent", none: "dot-none" }[level];
  return <span className={`dot ${cls} ${className}`} aria-hidden />;
}

const levelText: Record<Level | "none", string> = { ok: "text-fg", info: "text-fg", warning: "text-warning", danger: "text-danger", none: "text-muted" };

export interface StripCell {
  label: string;
  value: ReactNode;
  level: Level | "none";
  title?: string;
}

/**
 * Sayfanın kendi özet şeridi: solda başlık cümlesi, sağda 4 hücre (cap + nokta + değer).
 * Telefonda başlık tam satır, hücreler 2 sütun.
 */
export function SummaryStrip({
  label,
  title,
  head,
  headLevel,
  detail,
  cells,
}: {
  label: string;
  title: string;
  head: ReactNode;
  headLevel: Level | "none";
  detail?: ReactNode;
  cells: StripCell[] | null;
}) {
  return (
    <section
      className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-raised sm:grid-cols-4 xl:grid-cols-[minmax(300px,1.6fr)_repeat(4,minmax(0,1fr))]"
      aria-label={label}
    >
      <div className="col-span-2 flex min-w-0 flex-col justify-center gap-1 border-b border-line px-4 py-3.5 sm:col-span-4 sm:px-5 xl:col-span-1 xl:border-r xl:border-b-0">
        <span className="cap">{title}</span>
        <span className={`font-bold text-pretty ${headLevel === "ok" ? "text-success" : levelText[headLevel]}`}>
          {head}
          {detail && <span className="font-medium text-muted"> · {detail}</span>}
        </span>
      </div>
      {cells
        ? cells.map((c, i) => (
            <div
              key={c.label}
              title={c.title}
              className={`flex min-w-0 flex-col justify-center gap-1 border-line px-4 py-3 sm:px-5 ${i % 2 === 0 ? "border-r" : "sm:border-r"} ${i < 2 ? "max-sm:border-b" : ""} last:border-r-0`}
            >
              <span className="cap">{c.label}</span>
              <span className={`flex min-w-0 items-center gap-2 font-semibold ${levelText[c.level]}`}>
                <Dot level={c.level} />
                <span className="truncate">{c.value}</span>
              </span>
            </div>
          ))
        : Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-r border-line px-5 py-3.5 last:border-r-0">
              <div className="skeleton h-9" />
            </div>
          ))}
    </section>
  );
}

/** Nokta açıklaması (sayfanın en altında) */
export function DotLegend({ items }: { items: [Level | "none" | "spin", string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("marks.legend")}>
      {items.map(([l, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          {l === "spin" ? <Loader2 className="size-3 text-info" aria-hidden /> : <Dot level={l} />} {text}
        </li>
      ))}
    </ul>
  );
}

/** Kart kabuğu: başlık şeridi (cap + sağ taraf), gövde, isteğe bağlı alt şerit */
export function Panel({
  id,
  title,
  aside,
  children,
  footer,
  className = "",
  sectionRef,
}: {
  id: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  sectionRef?: Ref<HTMLElement>;
}) {
  return (
    <section ref={sectionRef} id={id} className={`min-w-0 overflow-hidden rounded-lg border border-line bg-raised ${className}`} aria-labelledby={`${id}-title`}>
      <div className="card-head flex-wrap">
        <h2 id={`${id}-title`} className="cap">
          {title}
        </h2>
        {aside && <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">{aside}</div>}
      </div>
      {children}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  );
}

/** Aç/kapa anahtarı (görünüşü anahtar, altta gerçek checkbox; ekran okuyucu "anahtar" der) */
export function Switch({
  checked,
  onChange,
  children,
  disabled,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold md:min-h-8 ${className}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="relative h-[18px] w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-line transition-colors duration-150 after:absolute after:top-[3px] after:left-[3px] after:size-3 after:rounded-full after:bg-muted after:transition-transform after:duration-150 checked:bg-accent/35 checked:after:translate-x-3.5 checked:after:bg-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:after:transition-none"
      />
      {children}
    </label>
  );
}

/** Kart gövdesi: tutarlı iç boşluk */
export const panelBody = "flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-5";
/** Açıklama metni (küçük, ikincil, okunur genişlikte) */
export const lede = "max-w-[72ch] text-xs leading-[18px] text-pretty text-muted";
/** Kopyalanabilir komut / anahtar kutusu */
export const cmdBox = "flex min-w-0 items-center gap-2 rounded-md border border-line-soft bg-canvas py-1 pr-1 pl-3";

// ---- Disk temizliği ----
export function CleanupSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["cleanup"], queryFn: () => api.get<CleanupOverview>("/api/cleanup"), refetchInterval: 30_000 });
  const { data: sys } = useSystem();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/cleanup/run");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["cleanup"] });
    }
  }

  async function saveSettings(patch: Partial<CleanupOverview["settings"]>) {
    if (!data) return;
    await api.put("/api/cleanup/settings", { ...data.settings, ...patch });
    qc.invalidateQueries({ queryKey: ["cleanup"] });
  }

  const ref = useRef<HTMLElement>(null);
  // Genel Bakış'taki "Temizlik" bağlantısı (#bakim) buraya kaydırır
  useEffect(() => {
    if (data && window.location.hash === "#bakim") ref.current?.scrollIntoView({ block: "start" });
  }, [data]);

  // Yüklenirken de kart (ve #bakim çapası) yerinde dursun; Docker ölçümü birkaç saniye sürebilir
  if (!data)
    return (
      <Panel id="bakim" sectionRef={ref} className="scroll-mt-20" title={t("settings:cleanup.title")}>
        <div className={panelBody} aria-busy="true" aria-label={t("states.loading")}>
          <div className="skeleton h-16" />
          <div className="skeleton h-10" />
        </div>
      </Panel>
    );
  const u = data.usage;
  const disk = sys?.disk;
  const diskPct = disk ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
  const reclaimable = u ? u.images.reclaimableBytes + u.buildCache.reclaimableBytes : null;
  const dockerTotal = u ? u.images.sizeBytes + u.buildCache.sizeBytes + u.containers.sizeBytes + u.volumes.sizeBytes : 0;
  const share = (b: number) => `${dockerTotal > 0 ? (b / dockerTotal) * 100 : 0}%`;
  const working = busy || data.running;

  const tiles: [string, number, ReactNode][] = u
    ? [
        [
          t("settings:cleanup.images"),
          u.images.sizeBytes,
          <>
            {t("settings:cleanup.imagesSub", { count: u.images.count })} <b className="font-semibold text-warning">{formatBytes(u.images.reclaimableBytes)}</b>{" "}
            {t("settings:cleanup.unused")}
          </>,
        ],
        [
          t("settings:cleanup.buildCache"),
          u.buildCache.sizeBytes,
          <>
            <b className="font-semibold text-warning">{formatBytes(u.buildCache.reclaimableBytes)}</b> {t("settings:cleanup.deletable")}
          </>,
        ],
        [t("settings:cleanup.containers"), u.containers.sizeBytes, t("settings:cleanup.count", { count: u.containers.count })],
        [t("settings:cleanup.volumes"), u.volumes.sizeBytes, t("settings:cleanup.volumesSub", { count: u.volumes.count })],
      ]
    : [];

  return (
    <Panel
      id="bakim"
      sectionRef={ref}
      className="scroll-mt-20"
      title={t("settings:cleanup.title")}
      aside={
        (disk || reclaimable != null) && (
          <span>
            {disk && (
              <span className={`font-mono tabular-nums ${diskPct >= 90 ? "text-danger" : diskPct >= 80 ? "text-warning" : "text-fg"}`}>
                {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
              </span>
            )}
            {disk && reclaimable != null && " · "}
            {reclaimable != null && (
              <>
                <span className="font-mono text-fg tabular-nums">{formatBytes(reclaimable)}</span> {t("settings:cleanup.reclaimable")}
              </>
            )}
          </span>
        )
      }
      footer={
        <>
          <button className="btn max-sm:w-full" onClick={run} disabled={working}>
            <RefreshCw className={`size-4 ${working ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> {working ? t("settings:cleanup.running") : t("settings:cleanup.run")}
          </button>
          {data.last && (
            <span className="text-xs text-muted">
              {t("settings:cleanup.last", { time: timeAgo(data.last.at) })}{" "}
              {data.last.error ? (
                <span className="text-danger">{data.last.error}</span>
              ) : (
                <>
                  <span className="font-mono text-fg tabular-nums">{formatBytes(data.last.reclaimedBytes)}</span> {t("settings:cleanup.freed")}{" "}
                  <span className="font-mono text-fg tabular-nums">{data.last.imagesDeleted}</span>{" "}
                  {t("settings:cleanup.imagesDeleted", { count: data.last.imagesDeleted })}
                </>
              )}
            </span>
          )}
        </>
      }
    >
      {u && (
        <div className="grid grid-cols-2 border-b border-line-soft md:grid-cols-4">
          {tiles.map(([label, size, sub], i) => (
            <div
              key={label}
              className={`flex min-w-0 flex-col gap-0.5 border-line-soft px-4 py-3 sm:px-5 md:py-3.5 ${i % 2 === 0 ? "border-r" : "md:border-r"} ${i < 2 ? "max-md:border-b" : ""} last:border-r-0`}
            >
              <span className="text-xs text-muted">{label}</span>
              <span className="font-mono text-lg leading-[26px] font-medium tabular-nums">{formatBytes(size)}</span>
              <span className="text-xs text-muted">{sub}</span>
            </div>
          ))}
        </div>
      )}
      <div className={panelBody}>
        {u && dockerTotal > 0 && (
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-line-soft"
            role="img"
            aria-label={t("settings:cleanup.barLabel", { cache: formatBytes(u.buildCache.reclaimableBytes), images: formatBytes(u.images.reclaimableBytes) })}
          >
            <i className="block h-full bg-accent" style={{ width: share(u.buildCache.reclaimableBytes) }} />
            <i className="block h-full bg-accent/45" style={{ width: share(u.images.reclaimableBytes) }} />
            <i className="block h-full flex-1 bg-meter" />
          </div>
        )}
        <p className={lede}>
          {t("settings:cleanup.description")}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <label className="check-row">
            <input type="checkbox" checked={data.settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} />
            {t("settings:cleanup.auto")}
          </label>
          <span className="flex items-center gap-2">
            <select
              className="input w-auto"
              aria-label={t("settings:cleanup.ageLimit")}
              value={data.settings.olderThanDays}
              onChange={(e) => saveSettings({ olderThanDays: Number(e.target.value) })}
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {t("settings:cleanup.days", { count: d })}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">{t("settings:cleanup.olderThan")}</span>
          </span>
        </div>
        <FormError message={error} />
      </div>
    </Panel>
  );
}

// ---- Panel güncelleme ----
/** Tıklanan işin durumu: sunucudaki güncelleyici dosya üzerinden birkaç saniye sonra başlar */
interface Pending {
  action: "check" | "update";
  /** Tıklama anındaki sunucu değerleri (tarayıcı saatine güvenmemek için) */
  prevFinishedAt: number | null;
  prevSha: string | null;
  clickedAt: number;
}

export function UpdaterSection() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const { data, refetch, isError } = useQuery({
    queryKey: ["updater"],
    queryFn: () => api.get<UpdateStatus>("/api/updater"),
    // İş sürerken sık yokla; güncelleme sırasında panel yeniden başlar, istek hatası normaldir
    refetchInterval: (q) => (pending || q.state.data?.state === "running" || q.state.status === "error" ? 1500 : 30_000),
    retry: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tıklanan iş bitti mi? (sunucunun bitiş zamanı değişti ve artık çalışmıyor)
  useEffect(() => {
    if (!pending || !data) return;
    const finished = data.state !== "running" && data.finishedAt != null && data.finishedAt !== pending.prevFinishedAt;
    if (!finished) return;
    setPending(null);
    // Yeni sürüm yüklendiyse sayfadaki eski arayüz kodunu at
    if (pending.action === "update" && data.state === "done" && data.current?.sha && data.current.sha !== pending.prevSha) {
      setTimeout(() => window.location.reload(), 1500);
    }
  }, [data, pending]);

  // Geçen süre sayacı ve yanıt vermeyen güncelleyici için zaman aşımı
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      const limit = pending.action === "update" ? 20 * 60_000 : 3 * 60_000;
      if (Date.now() - pending.clickedAt > limit) {
        setPending(null);
        setError(t("settings:updater.timeout", { cmd: t("settings:updater.statusCmd") }));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pending]);

  async function request(action: "check" | "update") {
    if (pending) return;
    setError(null);
    if (action === "update" && !(await confirmDialog({ title: t("settings:updater.confirm.title"), message: t("settings:updater.confirm.message"), confirmLabel: t("settings:updater.confirm.confirm") }))) return;
    setPending({ action, prevFinishedAt: data?.finishedAt ?? null, prevSha: data?.current?.sha ?? null, clickedAt: Date.now() });
    try {
      await api.post(`/api/updater/${action}`);
      await refetch();
    } catch (err) {
      setPending(null);
      setError((err as Error).message);
    }
    qc.invalidateQueries({ queryKey: ["updater"] });
  }

  if (!data) return null;
  const running = data.state === "running" || !!pending;
  const busyAction = pending?.action ?? (data.state === "running" ? data.action : null);
  const elapsed = pending ? Math.max(0, Math.round((now - pending.clickedAt) / 1000)) : 0;

  const aside = !data.installed ? (
    <span className="flex items-center gap-2">
      <Dot level="none" /> {t("settings:updater.notInstalled")}
    </span>
  ) : busyAction ? (
    <span className="flex items-center gap-2 text-info">
      <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> {busyAction === "check" ? t("settings:updater.checking") : t("settings:updater.updating")}
    </span>
  ) : data.pending.length > 0 ? (
    <span className="flex items-center gap-2 text-warning">
      <Dot level="warning" /> {t("settings:updater.available")}
    </span>
  ) : data.state === "failed" ? (
    <span className="flex items-center gap-2 text-danger">
      <Dot level="danger" /> {t("settings:updater.lastFailed")}
    </span>
  ) : data.state === "done" ? (
    <span className="flex items-center gap-2 text-fg">
      <Dot level="ok" /> {t("settings:updater.upToDate")}
      {data.action === "update" ? t("settings:updater.updateDone") : ""}
    </span>
  ) : null;

  return (
    <Panel
      id="guncelleme"
      title={t("settings:updater.title")}
      aside={aside}
      footer={
        data.installed && (
          <>
            <button className="btn-secondary max-sm:flex-1" onClick={() => request("check")} disabled={running}>
              <RefreshCw className={`size-4 ${busyAction === "check" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />{" "}
              {busyAction === "check" ? t("settings:updater.checkingBtn") : t("settings:updater.check")}
            </button>
            {(data.pending.length > 0 || busyAction === "update") && (
              <button className="btn max-sm:flex-1" onClick={() => request("update")} disabled={running}>
                {busyAction === "update" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUpCircle className="size-4" aria-hidden />}{" "}
                {busyAction === "update" ? t("settings:updater.updatingBtn") : t("settings:updater.updateNow")}
              </button>
            )}
            {data.log && (
              <button className="btn-ghost ml-auto" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
                {showLog ? t("settings:updater.hideLog") : t("settings:updater.showLog")}
              </button>
            )}
          </>
        )
      }
    >
      <div className={panelBody}>
        {!data.installed ? (
          <>
            <p className={lede}>{t("settings:updater.installHint")}</p>
            <pre className="overflow-x-auto rounded-md border border-line-soft bg-canvas px-3 py-2 font-mono text-xs text-fg/85">{t("settings:updater.installCmd")}</pre>
            <p className={lede}>
              {t("settings:updater.howBefore")} <code className="font-mono text-fg">git pull</code> {t("settings:updater.and")}{" "}
              <code className="font-mono text-fg">docker compose up -d --build</code>
              {t("settings:updater.howAfter")}
            </p>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[120px_1fr] sm:gap-y-2 [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:max-sm:mb-2 [&_dt]:text-xs [&_dt]:text-muted sm:[&_dt]:leading-5">
              <dt>{t("settings:updater.installedVersion")}</dt>
              <dd>
                {data.current ? (
                  <>
                    <span className="font-mono text-xs text-muted">{data.current.sha.slice(0, 7)}</span> {data.current.message}
                    <span className="text-xs text-muted"> · {fmtDate(new Date(data.current.date))}</span>
                  </>
                ) : (
                  t("settings:updater.notCheckedYet")
                )}
              </dd>
              <dt>{t("settings:updater.lastCheck")}</dt>
              <dd title={data.finishedAt ? fmtDateTime(data.finishedAt) : undefined}>{data.finishedAt ? timeAgo(data.finishedAt) : "—"}</dd>
            </dl>

            {data.pending.length > 0 && (
              <div>
                <div className="label">{t("settings:updater.newChanges", { count: data.pending.length })}</div>
                <ul className="max-h-48 overflow-auto rounded-md border border-line">
                  {data.pending.map((c) => (
                    <li key={c.sha} className="flex min-w-0 gap-2.5 border-b border-line-soft px-3 py-2 text-xs last:border-b-0">
                      <span className="shrink-0 font-mono text-faint">{c.sha.slice(0, 7)}</span>
                      <span className="truncate" title={c.message}>
                        {c.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className={lede}>
              {t("settings:updater.restartBefore")} <code className="font-mono text-fg">git pull</code> {t("settings:updater.and")}{" "}
              <code className="font-mono text-fg">docker compose up -d --build</code>
              {t("settings:updater.restartAfter")}
            </p>
            {data.missingEnv.length > 0 && (
              <p className="notice notice-warning block text-xs">
                {t("settings:updater.missingEnvBefore")} <span className="font-mono">{data.missingEnv.join(", ")}</span>
                {t("settings:updater.missingEnvMid")} <span className="font-mono">.env.example</span> {t("settings:updater.missingEnvAfter")}{" "}
                <span className="font-mono">docker compose up -d</span>
                {t("settings:updater.missingEnvEnd")}
              </p>
            )}
            {!running && data.state === "failed" && <FormError message={data.error ?? t("settings:updater.failed")} />}
            {busyAction && (
              <p className="flex items-center gap-2 text-xs text-info" role="status">
                <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                {busyAction === "check"
                  ? t("settings:updater.progressCheck")
                  : isError
                    ? t("settings:updater.progressRestart")
                    : data.state === "running"
                      ? t("settings:updater.progressBuild")
                      : t("settings:updater.progressStart")}
                {elapsed > 0 && <span className="font-mono text-muted tabular-nums">{t("settings:updater.elapsed", { count: elapsed })}</span>}
              </p>
            )}
            {showLog && (
              <pre className="max-h-72 overflow-auto rounded-md border border-line-soft bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-fg/85">{data.log}</pre>
            )}
          </>
        )}
        <FormError message={error} />
      </div>
    </Panel>
  );
}
