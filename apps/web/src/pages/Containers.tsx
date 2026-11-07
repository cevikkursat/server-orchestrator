import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Search } from "lucide-react";
import type { ContainerSummary } from "@panel/shared";
import { api } from "../lib/api";
import { ContainerActions, StateBadge } from "../components/ContainerUi";
import { trStatus } from "../lib/containers";
import { useDocker } from "../lib/status";
import { EmptyState, ErrorNotice, PageHeader, SkeletonRows } from "../components/Status";
import { t } from "../i18n";

type Filter = "all" | "running" | "stopped";

const ports = (c: ContainerSummary) =>
  c.ports.length ? c.ports.map((p) => (p.publicPort ? `${p.publicPort}→${p.privatePort}` : `${p.privatePort}`)).join(", ") : "—";

const SystemTag = () => (
  <span className="badge tone-neutral font-mono font-medium tracking-normal" title={t("containers:system.title")}>
    {t("containers:system.tag")}
  </span>
);

export function ContainersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["containers"],
    queryFn: () => api.get<ContainerSummary[]>("/api/containers"),
    refetchInterval: 5000,
  });
  const { data: docker } = useDocker();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (filter === "running" && c.state !== "running") return false;
      if (filter === "stopped" && c.state === "running") return false;
      return !term || c.name.toLowerCase().includes(term) || c.image.toLowerCase().includes(term);
    });
  }, [data, q, filter]);

  const running = data?.filter((c) => c.state === "running").length ?? 0;
  const counts: Record<Filter, number> = { all: data?.length ?? 0, running, stopped: (data?.length ?? 0) - running };
  const anySystem = data?.some((c) => c.isSystem);
  const anyPublished = data?.some((c) => c.ports.some((p) => p.publicPort));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("nav.containers")}
        description={
          data ? (
            <>
              <span className="font-mono text-xs text-fg">{data.length}</span>
              {t("containers:list.containers", { count: data.length })} · <span className="font-mono text-xs text-fg">{running}</span>
              {t("containers:list.running")}
              {docker?.version && (
                <>
                  {" "}
                  · Docker <span className="font-mono text-xs text-fg">{docker.version}</span>
                </>
              )}
            </>
          ) : (
            t("containers:list.description")
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="segmented" role="radiogroup" aria-label={t("containers:list.filterStatus")}>
          {(["all", "running", "stopped"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className="inline-flex items-center gap-1.5">
              {t(`containers:filters.${f}`)}
              {data && <span className={`font-mono text-[11px] tabular-nums ${filter === f ? "" : "text-faint"}`}>{counts[f]}</span>}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-9" type="search" spellCheck={false} placeholder={t("containers:list.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("containers:list.searchLabel")} />
        </div>
      </div>

      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {isLoading && <SkeletonRows rows={5} className="h-14" />}

      {data && rows.length === 0 && (
        <EmptyState icon={<Boxes className="size-5" />} title={t("containers:empty.title")}>
          {q || filter !== "all" ? t("containers:empty.filtered") : t("containers:empty.none")}
        </EmptyState>
      )}

      {data && rows.length > 0 && (
        <>
          {/* Telefon: liste */}
          <ul className="overflow-hidden rounded-lg border border-line bg-raised md:hidden">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center gap-2 border-b border-line-soft py-1 pr-3 last:border-b-0">
                <Link to={`/containers/${c.id}`} className="min-w-0 flex-1 py-2 pl-4 active:bg-fg/[0.03]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">{c.name}</span>
                    {c.isSystem && <SystemTag />}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2.5">
                    <StateBadge state={c.state} />
                    <span className="min-w-0 truncate text-xs text-muted" title={c.status}>
                      {trStatus(c.status)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted" title={c.image}>
                    {c.image}
                  </div>
                </Link>
                <ContainerActions c={c} />
              </li>
            ))}
          </ul>

          {/* Masaüstü: tablo */}
          <div className="hidden overflow-hidden rounded-lg border border-line bg-raised md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold sm:px-5">{t("containers:table.name")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("containers:table.status")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("containers:table.image")}</th>
                  <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">{t("containers:table.ports")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold sm:px-5">{t("containers:table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02]"
                    onClick={() => navigate(`/containers/${c.id}`)}
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <div className="flex items-center gap-2 font-semibold">
                        <Link to={`/containers/${c.id}`} className="underline-offset-3 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {c.name}
                        </Link>
                        {c.isSystem && <SystemTag />}
                      </div>
                      <div className="mt-0.5 text-xs text-muted" title={c.status}>
                        {trStatus(c.status)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StateBadge state={c.state} />
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 font-mono text-xs text-muted" title={c.image}>
                      {c.image}
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-muted lg:table-cell">{ports(c)}</td>
                    <td className="px-4 py-2.5 sm:px-5">
                      <div className="flex justify-end">
                        <ContainerActions c={c} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && (anySystem || anyPublished) && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-faint">
          {anySystem && (
            <span className="inline-flex items-center gap-1.5">
              <SystemTag />
              {t("containers:list.systemLegend")}
            </span>
          )}
          {anyPublished && (
            <span>
              {t("containers:list.portsLegend")} <span className="font-mono">{t("containers:list.portsLegendValue")}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
