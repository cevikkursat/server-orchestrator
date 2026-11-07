import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, CircleCheck, Plus, Search, Star } from "lucide-react";
import type { ContainerUsage, DomainCheck, MetricHistory, MetricRange } from "@panel/shared";
import { api, formatBytes, formatUptime } from "../lib/api";
import { TimeSeriesChart } from "../components/TimeSeriesChart";
import { ErrorNotice, PageHeader, StatusBadge } from "../components/Status";
import { StateBadge } from "../components/ContainerUi";
import { openCommandPalette } from "../components/CommandPalette";
import { useDomainOverview } from "../components/DomainStatus";
import { timeAgo, useProjects } from "../lib/projects";
import { useBackups } from "../lib/ops";
import { useAttention, useDocker, usePosture, useSystem, useUpdater, type AttentionItem, type Level, type PostureItem } from "../lib/status";
import { t } from "../i18n";
import { fmtDate, fmtDateTime, fmtNumber, fmtPercent } from "../lib/format";

/** Tüm sayılar seçili dilin biçiminde (tr: %0,5 · 0,41; en: 0.5% · 0.41) */
const pct = (v: number) => fmtPercent(v, v < 10 && v > 0 ? 1 : 0);
export const formatRate = (b: number) => `${formatBytes(b)}/s`;
const DAY = 86_400_000;

const ranges: MetricRange[] = ["1h", "6h", "24h", "7d"];
const rangeLabel = (r: MetricRange) => t(`dashboard:server.ranges.${r}.label`);
const rangeSpan = (r: MetricRange) => t(`dashboard:server.ranges.${r}.span`);

/** Durum noktası: dolu = yolunda, amber halka = bakılmalı, mercan = acil, gri halka = veri yok */
function Dot({ level, label }: { level: Level | "none"; label?: string }) {
  const cls = { ok: "dot-ok", info: "dot-info", warning: "dot-look", danger: "dot-urgent-solid", none: "dot-none" }[level];
  return <span className={`dot ${cls}`} {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })} />;
}

export function DashboardPage() {
  const { data: sys, error } = useSystem();
  if (error) return <ErrorNotice error={error} />;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <PageHeader
        title={t("nav.overview")}
        description={
          sys ? (
            <span className="text-xs">
              {sys.os.name}
              {sys.os.wsl && <span className="badge tone-neutral ml-1.5 align-[1px]">WSL2</span>} · <span className="font-mono text-fg">{sys.cpu.cores}</span> {t("dashboard:header.cores", { count: sys.cpu.cores })} ·{" "}
              <span className="font-mono text-fg">{formatBytes(sys.memory.totalBytes)}</span> {t("dashboard:header.memory")} ·{" "}
              <span className="font-mono text-fg">{formatUptime(sys.uptimeSec)}</span> {t("dashboard:header.uptime")}
            </span>
          ) : (
            t("dashboard:header.fallback")
          )
        }
        actions={
          <>
            <button type="button" className="btn-secondary max-sm:flex-1 md:hidden" onClick={openCommandPalette}>
              <Search className="size-4" aria-hidden /> {t("nav.search")} <kbd className="kbd max-sm:hidden">Ctrl K</kbd>
            </button>
            <Link to="/projects/new" className="btn max-sm:flex-1">
              <Plus className="size-4" aria-hidden /> {t("dashboard:header.newProject")}
            </Link>
          </>
        }
        flush
      />

      <StatusBand />
      <AttentionList />

      <div className="grid gap-4 md:gap-5 lg:grid-cols-6 [&>*]:min-w-0">
        <TopConsumers />
        <ServerCard />
      </div>

      <Forecast />
      <ProjectsBrief />

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("marks.legend")}>
        <li className="flex items-center gap-1.5">
          <Dot level="ok" /> {t("marks.ok")}
        </li>
        <li className="flex items-center gap-1.5">
          <Dot level="warning" /> {t("marks.look")}
        </li>
        <li className="flex items-center gap-1.5">
          <Dot level="danger" /> {t("marks.urgentShort")}
        </li>
        <li className="flex items-center gap-1.5">
          <Dot level="none" /> {t("marks.none")}
        </li>
      </ul>
    </div>
  );
}

// ---- Durum bandı ----

type SubKey = "apps" | "disk" | "backup" | "dns" | "access";
type Sub = { key: SubKey; level: Level | "none" };

function subsystems(items: AttentionItem[], access: PostureItem | undefined, ready: boolean): Sub[] {
  const lv = (match: (id: string) => boolean): Level | "none" => {
    if (!ready) return "none";
    const hit = items.filter((i) => match(i.id));
    if (hit.some((i) => i.level === "danger")) return "danger";
    if (hit.some((i) => i.level === "warning")) return "warning";
    return "ok";
  };
  return [
    { key: "apps", level: lv((id) => /^(deploy|down|health)-/.test(id) || id === "caddy") },
    { key: "disk", level: lv((id) => id === "disk" || id === "mem") },
    { key: "backup", level: lv((id) => id.startsWith("backup") || id.startsWith("offsite")) },
    { key: "dns", level: lv((id) => id === "dns") },
    { key: "access", level: access ? (access.level === "ok" ? "ok" : "warning") : "none" },
  ];
}

const subShort = (k: SubKey) => t(`dashboard:band.short.${k}`);
const subName = (k: SubKey) => t(`dashboard:band.names.${k}`);
const levelName = (l: Level | "none") => t(`dashboard:levels.${l}`);

function StatusBand() {
  const posture = usePosture();
  const { items, ready } = useAttention();
  const access = posture?.find((p) => p.id === "access");
  const subs = subsystems(items, access, ready);
  const busy = subs.filter((s) => s.level === "warning" || s.level === "danger");
  const urgent = busy.some((s) => s.level === "danger");
  const cells = (posture ?? []).filter((p) => p.id !== "version");

  return (
    <section
      className="grid overflow-hidden rounded-lg border border-line bg-raised grid-cols-2 sm:grid-cols-4 xl:grid-cols-[minmax(330px,1.6fr)_repeat(4,minmax(0,1fr))]"
      aria-label={t("dashboard:band.title")}
    >
      <div className="col-span-2 flex flex-col justify-center gap-1 border-b border-line px-4 py-3.5 sm:col-span-4 sm:px-5 xl:col-span-1 xl:border-r xl:border-b-0">
        <span className="cap">{t("dashboard:band.title")}</span>
        {!ready ? (
          <div className="skeleton h-5 w-56" />
        ) : busy.length === 0 ? (
          <span className="font-bold text-fg">{t("dashboard:band.allGood")}</span>
        ) : (
          <span className={`font-bold ${urgent ? "text-danger" : "text-warning"}`}>
            <span className="font-mono">{busy.length}</span> {t("dashboard:band.busy", { count: busy.length })}
            {access?.level === "ok" && <span className="font-medium text-muted"> · {t("dashboard:band.accessOk")}</span>}
          </span>
        )}
        <ul className="mt-2 flex justify-between gap-2 sm:justify-start sm:gap-[18px]" aria-label={t("dashboard:band.subsystems")}>
          {subs.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-muted" title={`${subName(s.key)}: ${levelName(s.level)}`}>
              <Dot level={s.level} />
              <span aria-hidden>{subShort(s.key)}</span>
              <span className="sr-only">
                {subName(s.key)}: {levelName(s.level)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {posture
        ? cells.map((c, i) => (
            <Link
              key={c.id}
              to={c.to}
              title={c.title}
              className={`flex min-w-0 flex-col justify-center gap-1 border-line px-4 py-3 transition-colors duration-150 hover:bg-fg/[0.025] sm:px-5 ${
                i % 2 === 0 ? "border-r" : "sm:border-r"
              } ${i < 2 ? "max-sm:border-b" : ""} last:border-r-0`}
            >
              <span className="cap">{c.id === "twofa" ? t("dashboard:band.twofa") : c.label}</span>
              <span className={`flex min-w-0 items-center gap-2 font-semibold ${c.level === "warning" ? "text-warning" : c.level === "danger" ? "text-danger" : "text-fg"}`}>
                <Dot level={c.level} />
                <span className="truncate">{c.value}</span>
              </span>
            </Link>
          ))
        : Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-r border-line px-5 py-3.5 last:border-r-0">
              <div className="skeleton h-9" />
            </div>
          ))}
    </section>
  );
}

// ---- Seni bekleyenler ----

const levelLabel = (l: AttentionItem["level"]) => t(`dashboard:attention.level.${l}`);

function AttentionList() {
  const { items, ready } = useAttention();
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="attn-title">
      <div className="card-head">
        <h2 id="attn-title" className="cap">
          {t("dashboard:attention.title")}{ready && items.length > 0 && <span className="ml-1.5 font-mono tracking-normal text-faint">{items.length}</span>}
        </h2>
      </div>
      {!ready ? (
        <div className="space-y-2 p-4">
          <div className="skeleton h-10" />
          <div className="skeleton h-10" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-5 sm:px-5">
          <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
          <div>
            <div className="font-semibold">{t("dashboard:attention.empty.title")}</div>
            <div className="text-sm text-muted">{t("dashboard:attention.empty.detail")}</div>
          </div>
        </div>
      ) : (
        <ul>
          {items.map((i) => (
            <li
              key={i.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3.5 last:border-b-0 sm:px-5 md:grid-cols-[104px_minmax(0,1fr)_auto]"
            >
              <span
                className={`col-span-2 inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] md:col-span-1 ${
                  i.level === "danger" ? "text-danger" : i.level === "warning" ? "text-warning" : "text-info"
                }`}
              >
                <Dot level={i.level} />
                {levelLabel(i.level)}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-pretty">{i.title}</div>
                {i.detail && <div className="mt-0.5 text-xs text-muted text-pretty">{i.detail}</div>}
              </div>
              <Link to={i.to} className="btn-secondary btn-sm shrink-0">
                {i.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- En çok kaynak kullananlar ----

const kindLabel = (k: ContainerUsage["kind"]) => t(`dashboard:top.kinds.${k}`);

function TopConsumers() {
  const [sort, setSort] = useState<"cpu" | "mem" | "net">("cpu");
  const { data } = useQuery({
    queryKey: ["metrics", "containers"],
    queryFn: () => api.get<ContainerUsage[]>("/api/metrics/containers"),
    refetchInterval: 15_000,
  });
  const { data: docker } = useDocker();
  const rows = useMemo(() => {
    const list = [...(data ?? [])];
    const key = { cpu: (u: ContainerUsage) => u.cpuPercent, mem: (u: ContainerUsage) => u.memoryBytes, net: (u: ContainerUsage) => (u.rxPerSec ?? 0) + (u.txPerSec ?? 0) }[sort];
    return list.sort((a, b) => key(b) - key(a)).slice(0, 5);
  }, [data, sort]);
  const cpuMax = Math.max(1, ...rows.map((r) => r.cpuPercent));

  const th = (id: typeof sort, label: string, align = "text-right") => (
    <th className={`px-4 py-1 font-semibold ${align}`} aria-sort={sort === id ? "descending" : "none"}>
      <button onClick={() => setSort(id)} className={`inline-flex min-h-8 items-center uppercase hover:text-fg ${sort === id ? "text-fg" : ""}`} aria-pressed={sort === id}>
        {label}
        {sort === id ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-raised lg:col-span-4" aria-labelledby="top-title">
      <div className="card-head">
        <h2 id="top-title" className="cap">
          {t("dashboard:top.title")}
        </h2>
        <Link to="/containers" className="card-link">
          {t("nav.containers")} →
        </Link>
      </div>
      {/* Telefon: liste */}
      <ul className="sm:hidden">
        {rows.map((u) => (
          <li key={u.id} className="border-b border-line-soft last:border-b-0">
            <Link to={`/containers/${u.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-hover">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{u.label}</div>
                <div className="text-xs text-muted">{kindLabel(u.kind)}</div>
              </div>
              <div className="text-right font-mono text-xs tabular-nums">
                <div className="text-fg">{fmtPercent(u.cpuPercent, 1)} CPU</div>
                <div className="text-muted">{formatBytes(u.memoryBytes)}</div>
              </div>
              <ChevronRight className="size-4 text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
        {(!data || rows.length === 0) && <li className="px-4 py-6 text-center text-sm text-muted">{data ? t("dashboard:top.empty") : t("dashboard:top.waiting")}</li>}
      </ul>
      <div className="hidden flex-1 overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold uppercase sm:px-5">{t("dashboard:top.cols.container")}</th>
              <th className="hidden px-4 py-2.5 font-semibold uppercase md:table-cell">{t("dashboard:top.cols.kind")}</th>
              {th("cpu", "CPU", "text-left")}
              {th("mem", t("dashboard:top.cols.memory"))}
              {th("net", t("dashboard:top.cols.network"))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02] [&>td]:lg:py-3.5">
                <td className="px-4 py-2.5 sm:px-5">
                  <Link to={`/containers/${u.id}`} className="font-semibold hover:underline">
                    {u.label}
                  </Link>
                  {u.label !== u.name && <div className="font-mono text-[11px] text-subtle">{u.name}</div>}
                </td>
                <td className="hidden px-4 py-2.5 text-xs text-muted md:table-cell">{kindLabel(u.kind)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="mr-2.5 inline-block h-[3px] w-16 overflow-hidden rounded-full bg-line-soft align-middle" aria-hidden>
                    <span className="block h-full rounded-full bg-info" style={{ width: `${(u.cpuPercent / cpuMax) * 100}%` }} />
                  </span>
                  <span className="font-mono text-xs">{fmtPercent(u.cpuPercent, 1)}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap">
                  {formatBytes(u.memoryBytes)}
                  {u.memoryLimitBytes && <span className="text-subtle"> / {formatBytes(u.memoryLimitBytes)}</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap text-muted">
                  {u.rxPerSec != null ? `${formatRate(u.rxPerSec)} / ${formatRate(u.txPerSec ?? 0)}` : t("dashboard:top.measuring")}
                </td>
              </tr>
            ))}
            {(!data || rows.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  {data ? t("dashboard:top.empty") : t("dashboard:top.waiting")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {docker &&
        (docker.available ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
            <Dot level="ok" />
            <b className="font-semibold text-fg">Docker {docker.version}</b>
            <span className="text-faint">·</span>
            <span>
              <span className="font-mono">
                {docker.containers.running} / {docker.containers.total}
              </span>{" "}
              {t("dashboard:top.docker.running", { count: docker.containers.total })}
            </span>
            <span className="text-faint">·</span>
            <span>
              <span className="font-mono">{docker.images}</span> {t("dashboard:top.docker.images", { count: docker.images })}
            </span>
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-danger sm:px-5" role="alert">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t("dashboard:top.docker.unavailable")}
          </div>
        ))}
    </section>
  );
}

// ---- Sunucu kartı: ölçü sekmeleri ----

type Metric = "cpu" | "mem" | "disk" | "net";
const metricName = (m: Metric) => t(`dashboard:server.metrics.${m}`);
const metrics: Metric[] = ["cpu", "mem", "disk", "net"];

function useMetricHistory(range: MetricRange) {
  return useQuery({
    queryKey: ["metrics", range],
    queryFn: () => api.get<MetricHistory>(`/api/metrics/history?range=${range}`),
    refetchInterval: range === "1h" ? 15_000 : 60_000,
    placeholderData: keepPreviousData,
  });
}

function ServerCard() {
  const { data: sys } = useSystem();
  const [metric, setMetric] = useState<Metric>("cpu");
  const [range, setRange] = useState<MetricRange>("24h");
  const hist = useMetricHistory(range);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const now: Record<Metric, number | null> = {
    cpu: sys ? sys.cpu.usagePercent : null,
    mem: sys ? (sys.memory.usedBytes / sys.memory.totalBytes) * 100 : null,
    disk: sys?.disk ? (sys.disk.usedBytes / sys.disk.totalBytes) * 100 : null,
    net: null,
  };
  const crit = (m: Metric) => (now[m] ?? 0) >= 90;
  const sub: Record<Metric, string> = sys
    ? {
        cpu: t("dashboard:server.load", { values: sys.cpu.loadAvg.map((l) => fmtNumber(l, 2)).join(" ") }),
        mem: `${formatBytes(sys.memory.usedBytes)} / ${formatBytes(sys.memory.totalBytes)}`,
        disk: sys.disk ? `${formatBytes(sys.disk.usedBytes)} / ${formatBytes(sys.disk.totalBytes)}` : t("dashboard:server.unreadable"),
        net: t("dashboard:server.perSecond"),
      }
    : { cpu: "", mem: "", disk: "", net: "" };

  const pts = hist.data?.points ?? [];
  const times = pts.map((p) => p.t);
  const values: Record<Metric, (number | null)[]> = {
    cpu: pts.map((p) => p.cpu),
    mem: pts.map((p) => p.memPct),
    disk: pts.map((p) => p.diskPct),
    net: pts.map((p) => p.rx),
  };
  const nums = values[metric].filter((v): v is number => v != null);
  const fmt = metric === "net" ? formatRate : pct;
  const stats = nums.length ? { min: Math.min(...nums), avg: nums.reduce((a, b) => a + b, 0) / nums.length, max: Math.max(...nums) } : null;

  function onTabKey(e: KeyboardEvent, i: number) {
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: metrics.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const n = (j + metrics.length) % metrics.length;
    setMetric(metrics[n]!);
    tabs.current[n]?.focus();
  }

  const summary = (m: Metric) => {
    if (!sys) return "—";
    if (m === "net") return sys.network ? `↓${formatBytes(sys.network.rxPerSec)}` : "—";
    return now[m] == null ? "—" : pct(now[m]!);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised max-lg:order-first lg:col-span-2" aria-labelledby="srv-title">
      <div className="card-head">
        <h2 id="srv-title" className="cap">
          {t("dashboard:server.title")}
        </h2>
        <span className="text-xs text-muted">{t("dashboard:server.now")}</span>
      </div>
      <dl className="grid grid-cols-4 border-b border-line">
        {metrics.map((m, i) => (
          <div key={m} className={`flex min-w-0 flex-col gap-0.5 py-2.5 ${i === 0 ? "pl-4 sm:pl-5" : "border-l border-line-soft pl-3"}`}>
            <dt className="cap">{metricName(m)}</dt>
            <dd className={`truncate font-mono text-[13px] tabular-nums ${crit(m) ? "text-danger" : "text-fg"}`}>{summary(m)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex border-b border-line px-2 sm:px-3" role="tablist" aria-label={t("dashboard:server.metricTabs")}>
        {metrics.map((m, i) => (
          <button
            key={m}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`srv-tab-${m}`}
            aria-selected={metric === m}
            aria-controls="srv-panel"
            tabIndex={metric === m ? 0 : -1}
            onClick={() => setMetric(m)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`relative min-h-11 min-w-11 px-2.5 text-xs transition-colors duration-150 md:min-h-[38px] ${
              metric === m
                ? "font-semibold text-fg after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent"
                : "font-medium text-muted hover:text-fg"
            }`}
          >
            {metricName(m)}
          </button>
        ))}
      </div>
      <div id="srv-panel" role="tabpanel" aria-labelledby={`srv-tab-${metric}`}>
        <div className="px-4 pt-4 sm:px-5">
          {metric === "net" ? (
            <div className="flex items-baseline justify-between gap-2">
              <b className="font-mono text-[28px] leading-8 font-medium tracking-[-0.02em] tabular-nums">
                {sys?.network ? (
                  <>
                    ↓ {formatBytes(sys.network.rxPerSec)} <span className="text-lg text-muted">↑ {formatBytes(sys.network.txPerSec)}</span>
                  </>
                ) : (
                  "—"
                )}
              </b>
              <span className="text-xs text-muted">{t("dashboard:server.perSecondShort")}</span>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <b className={`font-mono text-[28px] leading-8 font-medium tracking-[-0.02em] tabular-nums ${crit(metric) ? "text-danger" : ""}`}>
                  {now[metric] == null ? "—" : pct(now[metric]!)}
                </b>
                <span className="truncate font-mono text-xs text-muted">{sub[metric]}</span>
              </div>
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-line-soft"
                role="meter"
                aria-label={metricName(metric)}
                aria-valuenow={now[metric] == null ? undefined : Math.round(now[metric]!)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`h-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none ${crit(metric) ? "bg-danger" : "bg-meter"}`}
                  style={{ transform: `scaleX(${Math.min(100, now[metric] ?? 0) / 100})` }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 sm:px-5">
          <div className="flex gap-1" role="group" aria-label={t("dashboard:server.timeRange")}>
            {ranges.map((r) => (
              <button key={r} className="chip" aria-pressed={range === r} onClick={() => setRange(r)}>
                {rangeLabel(r)}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">{rangeSpan(range)}</span>
        </div>
        <div className="px-4 pt-2 sm:px-5">
          <TimeSeriesChart
            bare
            title={t("dashboard:server.chartTitle", { metric: metricName(metric), span: rangeSpan(range) })}
            times={times}
            series={
              metric === "net"
                ? [
                    { key: "rx", label: t("dashboard:server.download"), color: "var(--viz-series-1)", values: values.net },
                    { key: "tx", label: t("dashboard:server.upload"), color: "var(--viz-series-2)", values: pts.map((p) => p.tx) },
                  ]
                : [{ key: metric, label: metricName(metric), color: crit(metric) ? "var(--viz-critical)" : "var(--viz-series-1)", values: values[metric] }]
            }
            bucketMs={hist.data?.bucketMs ?? 15_000}
            format={fmt}
            yMax={metric === "net" ? undefined : 100}
            unit={metric === "net" ? "bytes" : undefined}
            stale={hist.isPlaceholderData}
            height={120}
            emptyText={metric === "net" && sys?.network === null ? t("dashboard:server.netUnavailable") : undefined}
          />
          {metric === "net" && (
            <div className="mt-1 flex gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-2.5 bg-meter" aria-hidden />↓ {t("dashboard:server.downloadLower")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-2.5 bg-[repeating-linear-gradient(90deg,var(--color-info)_0_3px,transparent_3px_6px)]" aria-hidden />↑ {t("dashboard:server.uploadLower")}
              </span>
            </div>
          )}
        </div>
        <dl className="mx-4 mt-3 mb-4 grid grid-cols-3 border-t border-line-soft pt-3 sm:mx-5">
          {(
            [
              [t("dashboard:server.stats.min"), stats?.min],
              [t("dashboard:server.stats.avg"), stats?.avg],
              [t("dashboard:server.stats.max"), stats?.max],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="cap">{k}</dt>
              <dd className="mt-0.5 font-mono text-xs text-fg tabular-nums">
                {v == null ? "—" : fmt(v)}
                {metric === "net" && v != null && " ↓"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---- Tahmin ----

/** Son 7 günün disk doluluğundan doğrusal eğilim: günlük artış (yüzde puanı) */
function diskTrend(h: MetricHistory | undefined) {
  const pts = (h?.points ?? []).filter((p) => p.diskPct != null);
  if (pts.length < 2 || pts[pts.length - 1]!.t - pts[0]!.t < DAY) return null;
  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / DAY);
  const ys = pts.map((p) => p.diskPct!);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : null;
}

interface Cell {
  key: string;
  level: Level | "none";
  title: string;
  sub: string;
  to?: string;
  extra?: ReactNode;
}

function Forecast() {
  const { data: sys } = useSystem();
  const week = useMetricHistory("7d");
  const { data: backups } = useBackups();
  const { data: updater } = useUpdater();
  const { data: overview } = useDomainOverview();
  const hosts = (overview?.domains ?? []).filter((d) => d.kind === "route").map((d) => d.hostname);
  const checks = useQueries({
    queries: hosts.map((h) => ({
      queryKey: ["domain-check", h],
      queryFn: () => api.get<DomainCheck>(`/api/domains/check?hostname=${encodeURIComponent(h)}`),
      staleTime: 60_000,
    })),
  });

  const cells: Cell[] = [];

  // Disk
  const cur = sys?.disk ? (sys.disk.usedBytes / sys.disk.totalBytes) * 100 : null;
  const slope = diskTrend(week.data);
  if (cur == null) cells.push({ key: "disk", level: "none", title: t("dashboard:forecast.disk.unreadable.title"), sub: t("dashboard:forecast.disk.unreadable.sub") });
  else if (slope == null) cells.push({ key: "disk", level: "none", title: t("dashboard:forecast.disk.collecting.title"), sub: t("dashboard:forecast.disk.collecting.sub", { pct: fmtPercent(cur) }) });
  else if (slope <= 0.05) cells.push({ key: "disk", level: "ok", title: t("dashboard:forecast.disk.stable.title"), sub: t("dashboard:forecast.disk.stable.sub", { pct: fmtPercent(cur) }) });
  else {
    const days = (100 - cur) / slope;
    const perDay = (slope / 100) * sys!.disk!.totalBytes;
    const level: Level = days <= 14 ? "danger" : days <= 45 ? "warning" : "ok";
    const when = new Date(Date.now() + days * DAY);
    cells.push({
      key: "disk",
      level,
      title: days > 365 ? t("dashboard:forecast.disk.overYear") : t("dashboard:forecast.disk.fillsIn", { count: Math.max(1, Math.round(days)) }),
      sub: t("dashboard:forecast.disk.perDay", { size: formatBytes(perDay) }),
      to: level === "ok" ? undefined : "/settings#bakim",
      extra: (
        <div className="mt-3" aria-hidden>
          <div className="relative h-0.5 bg-line">
            <i className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${cur}%` }} />
            <s className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(90deg,var(--color-danger)_0_3px,transparent_3px_6px)]" style={{ left: `${cur}%` }} />
            <u className="absolute -top-[3px] -ml-1 size-2 rounded-full bg-accent" style={{ left: `${cur}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-faint">
            <span>{t("dashboard:forecast.disk.today", { pct: fmtPercent(cur) })}</span>
            <span>{days <= 365 ? t("dashboard:forecast.disk.fullOn", { date: fmtDate(when, { day: "numeric", month: "long" }), full: fmtPercent(100) }) : fmtPercent(100)}</span>
          </div>
        </div>
      ),
    });
  }

  // Yedek
  if (!backups) cells.push({ key: "backup", level: "none", title: t("dashboard:forecast.backup.loading"), sub: "" });
  else if (!backups.settings.enabled || !backups.nextRunAt)
    cells.push({ key: "backup", level: "warning", title: t("dashboard:attention.backupOff"), sub: t("dashboard:forecast.backup.offSub"), to: "/backups" });
  else
    cells.push({
      key: "backup",
      level: "ok",
      title: t("dashboard:forecast.backup.next", { when: fmtDateTime(backups.nextRunAt, { weekday: "long", hour: "2-digit", minute: "2-digit" }) }),
      sub: t("dashboard:forecast.backup.retention", { count: backups.settings.retentionDays }),
      to: "/backups",
    });

  // SSL
  const valid = checks.map((c) => c.data?.tls?.validTo).filter((v): v is number => v != null);
  if (!hosts.length) cells.push({ key: "ssl", level: "none", title: t("dashboard:forecast.ssl.none.title"), sub: t("dashboard:forecast.ssl.none.sub") });
  else if (!valid.length) cells.push({ key: "ssl", level: "none", title: t("dashboard:forecast.ssl.reading"), sub: t("dashboard:forecast.ssl.domains", { count: hosts.length }) });
  else {
    const nearest = Math.min(...valid);
    const d = Math.floor((nearest - Date.now()) / DAY);
    cells.push({
      key: "ssl",
      level: d < 7 ? "danger" : d < 14 ? "warning" : "ok",
      title: d < 0 ? t("dashboard:forecast.ssl.expired") : t("dashboard:forecast.ssl.nearest", { count: d }),
      sub: t("dashboard:forecast.ssl.certs", { count: valid.length }),
      to: "/domains",
    });
  }

  // Panel güncellemesi
  if (!updater) cells.push({ key: "update", level: "none", title: t("dashboard:forecast.update.loading"), sub: "" });
  else if (!updater.installed) cells.push({ key: "update", level: "none", title: t("dashboard:forecast.update.notInstalled.title"), sub: t("dashboard:forecast.update.notInstalled.sub"), to: "/settings" });
  else if (updater.pending.length)
    cells.push({ key: "update", level: "warning", title: t("dashboard:forecast.update.pending.title"), sub: t("dashboard:forecast.update.pending.sub", { count: updater.pending.length }), to: "/settings" });
  else cells.push({ key: "update", level: "ok", title: t("dashboard:forecast.update.upToDate"), sub: updater.current ? `${t("nav.version")} ${updater.current.sha.slice(0, 7)}` : "", to: "/settings" });

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="fc-title">
      <div className="card-head">
        <h2 id="fc-title" className="cap">
          {t("dashboard:forecast.title")}
        </h2>
        <span className="text-xs text-muted">{t("dashboard:forecast.span")}</span>
      </div>
      <ul className="grid sm:grid-cols-2 xl:grid-cols-4">
        {cells.map((c, i) => {
          const body = (
            <>
              <span className="mt-[7px]">
                <Dot level={c.level} label={levelName(c.level)} />
              </span>
              <div className="min-w-0">
                <b className="block font-semibold text-pretty">{c.title}</b>
                {c.sub && <span className="text-xs text-muted">{c.sub}</span>}
                {c.extra}
              </div>
            </>
          );
          const cls = "grid h-full grid-cols-[7px_minmax(0,1fr)] items-start gap-3.5 px-4 py-3.5 sm:px-5";
          return (
            <li
              key={c.key}
              className={`border-line-soft max-sm:border-b max-sm:last:border-b-0 ${i % 2 === 0 ? "sm:border-r" : ""} ${i < 2 ? "sm:max-xl:border-b" : ""} xl:border-r xl:last:border-r-0`}
            >
              {c.to ? (
                <Link to={c.to} className={`${cls} transition-colors duration-150 hover:bg-fg/[0.025]`}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- Projeler ----

function ProjectsBrief() {
  const { data } = useProjects();
  const list = (data ?? []).filter((p) => !p.preview);
  if (!data || !list.length) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="pr-title">
      <div className="card-head">
        <h2 id="pr-title" className="cap">
          {t("nav.projects")}
        </h2>
        <Link to="/projects" className="card-link">
          {t("dashboard:projects.all", { count: list.length })}
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint uppercase">
            <tr>
              <th className="px-4 py-2.5 font-semibold sm:px-5">{t("dashboard:projects.cols.project")}</th>
              <th className="px-4 py-2.5 font-semibold">{t("dashboard:projects.cols.status")}</th>
              <th className="hidden px-4 py-2.5 font-semibold md:table-cell">{t("dashboard:projects.cols.domain")}</th>
              <th className="px-4 py-2.5 font-semibold">{t("dashboard:projects.cols.lastDeploy")}</th>
              <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">{t("dashboard:projects.cols.time")}</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 8).map((p) => {
              const domain = p.domains.find((d) => d.kind === "route") ?? p.domains[0];
              const failed = p.lastDeployment?.status === "failed";
              return (
                <tr key={p.id} className="border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02]">
                  <td className="px-4 py-2.5 sm:px-5">
                    <Link to={`/projects/${p.id}`} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
                      {p.pinned && <Star className="size-3 shrink-0 fill-accent text-accent" aria-label={t("dashboard:projects.pinned")} />}
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {p.container ? <StateBadge state={p.container.state} /> : <StatusBadge tone="neutral" shape="hollow" label={t("deploy.none")} />}
                      {failed && (
                        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-danger">
                          <Dot level="danger" /> {t("dashboard:projects.lastFailed")}
                          {p.liveDeploymentId != null && p.liveDeploymentId !== p.lastDeployment!.id && (
                            <span className="text-muted">
                              · {t("dashboard:projects.live")} <span className="font-mono text-fg">#{p.liveDeploymentId}</span>
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden max-w-56 truncate px-4 py-2.5 text-muted md:table-cell">{domain ? domain.display : "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.lastDeployment ? `#${p.lastDeployment.id}` : <span className="text-muted">—</span>}</td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted sm:table-cell">{p.lastDeployment ? timeAgo(p.lastDeployment.createdAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
