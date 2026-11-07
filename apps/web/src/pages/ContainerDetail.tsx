import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { ContainerDetail, ContainerStats } from "@panel/shared";
import { api } from "../lib/api";
import { fmtDateTime, fmtPercent, formatBytes } from "../lib/format";
import { t } from "../i18n";
import { ContainerActions, StateBadge } from "../components/ContainerUi";
import { trStatus } from "../lib/containers";
import { useSystem } from "../lib/status";
import { LogViewer } from "../components/LogViewer";
import { Terminal } from "../components/LazyTerminal";
import { TabBar } from "../components/TabBar";
import { ErrorNotice, SkeletonRows } from "../components/Status";

/** Tek ondalıklı yüzde; `trimZero` ile "12,0" yerine "12" */
const pct = (n: number, trimZero = false) => fmtPercent(n, trimZero && Math.round(n * 10) % 10 === 0 ? 0 : 1);

/** Kaynak kutucuğu: atlas etiketi, mono değer, varsa ölçü çubuğu, alt satır */
function Tile({ label, value, meter, sub }: { label: string; value: ReactNode; meter?: number | null; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-raised px-3.5 py-3 sm:px-[18px] sm:py-3.5">
      <span className="cap">{label}</span>
      <b className="truncate font-mono text-[15px] leading-7 font-medium tracking-[-0.01em] tabular-nums sm:text-xl">{value}</b>
      {meter != null && (
        <div className="mt-1 mb-0.5 h-1 overflow-hidden rounded-sm bg-line-soft" aria-hidden>
          <i className="block h-full rounded-sm bg-meter transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
        </div>
      )}
      {sub && <span className="truncate text-xs text-muted">{sub}</span>}
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-b border-line-soft px-4 py-2.5 last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-4 sm:px-5 sm:py-[11px]">
      <dt className="text-xs leading-5 text-muted">{k}</dt>
      <dd className="min-w-0 font-mono text-xs leading-5 break-all text-fg">{children}</dd>
    </div>
  );
}

const fmtDate = (v: string | number | null) => (v ? fmtDateTime(new Date(v)) : "—");

export function ContainerDetailPage() {
  const { id = "" } = useParams();
  const [tab, setTab] = useState<"logs" | "terminal" | "info">("logs");

  const { data: c, error, refetch } = useQuery({
    queryKey: ["container", id],
    queryFn: () => api.get<ContainerDetail>(`/api/containers/${id}`),
    refetchInterval: 5000,
  });
  const running = c?.state === "running";
  const { data: stats } = useQuery({
    queryKey: ["container", id, "stats"],
    queryFn: () => api.get<ContainerStats>(`/api/containers/${id}/stats`),
    refetchInterval: 3000,
    enabled: running,
  });
  const { data: system } = useSystem();

  const back = (
    <Link to="/containers" className="mb-4 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-fg">
      <ArrowLeft className="size-3.5" aria-hidden /> {t("nav.containers")}
    </Link>
  );

  if (error)
    return (
      <div className="mx-auto max-w-6xl">
        {back}
        <ErrorNotice error={error} onRetry={() => refetch()} />
      </div>
    );
  if (!c)
    return (
      <div className="mx-auto max-w-6xl">
        {back}
        <SkeletonRows rows={3} className="h-20" />
      </div>
    );

  const memLimit = c.limits.memoryBytes ?? stats?.memoryLimitBytes ?? 0;
  // CPU çubuğu: limit varsa limite, yoksa sunucunun çekirdek sayısına göre
  const cpuCap = (c.limits.cpus ?? system?.cpu.cores ?? 0) * 100;
  const memPct = stats && memLimit ? (stats.memoryBytes / memLimit) * 100 : null;

  return (
    <div className="mx-auto max-w-6xl">
      {back}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="page-title min-w-0 truncate">{c.name}</h1>
            <StateBadge state={c.state} />
            <span className="text-xs text-muted" title={c.status}>
              {trStatus(c.status)}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-faint">
            {c.image} · {c.id.slice(0, 12)}
          </p>
        </div>
        <div className="max-sm:w-full max-sm:[&_button]:flex-1 max-sm:[&>div]:w-full">
          <ContainerActions c={c} size="md" />
        </div>
      </div>

      {running && (
        <section className="mt-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-label={t("containers:detail.resources")}>
          <Tile
            label={t("containers:detail.cpu")}
            value={stats ? pct(stats.cpuPercent) : "…"}
            meter={stats && cpuCap ? (stats.cpuPercent / cpuCap) * 100 : null}
            sub={
              c.limits.cpus ? (
                <>
                  {t("containers:detail.limit")}
                  <span className="font-mono">{c.limits.cpus}</span>
                  {t("containers:detail.cores", { count: c.limits.cpus })}
                </>
              ) : (
                t("containers:detail.unlimited")
              )
            }
          />
          <Tile
            label={t("containers:detail.memory")}
            value={stats ? formatBytes(stats.memoryBytes) : "…"}
            meter={c.limits.memoryBytes ? memPct : null}
            sub={
              c.limits.memoryBytes ? (
                <>
                  {t("containers:detail.limit")}
                  <span className="font-mono">{formatBytes(memLimit)}</span>
                  {memPct != null && <> · {pct(memPct, true)}</>}
                </>
              ) : (
                t("containers:detail.unlimited")
              )
            }
          />
          <Tile
            label={t("containers:detail.network")}
            value={stats ? `↓ ${formatBytes(stats.networkRxBytes)}` : "…"}
            sub={stats ? <span className="font-mono">↑ {formatBytes(stats.networkTxBytes)}</span> : undefined}
          />
          <Tile
            label={t("containers:detail.processes")}
            value={stats ? String(stats.pids) : "…"}
            sub={
              <>
                {t("containers:detail.restartsBefore")}
                <span className="font-mono">{c.restartCount}</span>
                {t("containers:detail.restartsAfter", { count: c.restartCount })}
              </>
            }
          />
        </section>
      )}

      <TabBar
        className="mt-5"
        tabs={[
          { id: "logs", label: t("containers:detail.tabs.logs") },
          { id: "terminal", label: t("containers:detail.tabs.terminal") },
          { id: "info", label: t("containers:detail.tabs.info") },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === "logs" ? (
          <LogViewer containerId={c.id} live={running} />
        ) : tab === "terminal" ? (
          running ? (
            <>
              <Terminal containerId={c.id} />
              <p className="mt-3 text-xs text-faint">{t("containers:detail.terminalNote")}</p>
            </>
          ) : (
            <div className="card text-sm text-muted">{t("containers:detail.notRunning")}</div>
          )
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-raised">
            <dl>
              <Row k={t("containers:info.id")}>{c.id}</Row>
              <Row k={t("containers:info.image")}>{c.image}</Row>
              <Row k={t("containers:info.command")}>{c.command}</Row>
              <Row k={t("containers:info.created")}>{fmtDate(c.createdAt)}</Row>
              <Row k={t("containers:info.started")}>{fmtDate(c.startedAt)}</Row>
              {!running && <Row k={t("containers:info.finished")}>{c.finishedAt ? `${fmtDate(c.finishedAt)} · ${c.exitCode}` : "—"}</Row>}
              <Row k={t("containers:info.restartPolicy")}>{c.restartPolicy}</Row>
              <Row k={t("containers:info.composeProject")}>{c.composeProject ?? "—"}</Row>
              <Row k={t("containers:info.ports")}>
                {c.ports.length ? c.ports.map((p) => `${p.publicPort ? `${p.publicPort}→` : ""}${p.privatePort}/${p.type}`).join(", ") : "—"}
              </Row>
              <Row k={t("containers:info.networks")}>
                {c.networks.length
                  ? c.networks.map((n) => (
                      <div key={n.name}>
                        {n.name} <span className="text-faint">({n.ip || t("containers:info.noIp")})</span>
                      </div>
                    ))
                  : "—"}
              </Row>
              <Row k={t("containers:info.mounts")}>
                {c.mounts.length
                  ? c.mounts.map((m) => (
                      <div key={m.destination}>
                        {m.source} → {m.destination}
                        {m.readOnly && <span className="text-faint"> {t("containers:info.readOnly")}</span>}
                      </div>
                    ))
                  : "—"}
              </Row>
              <Row k={t("containers:info.labels")}>
                {Object.keys(c.labels).length
                  ? Object.entries(c.labels).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-faint">{k}=</span>
                        {v}
                      </div>
                    ))
                  : "—"}
              </Row>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
