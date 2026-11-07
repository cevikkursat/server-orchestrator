import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Rocket, SearchX } from "lucide-react";
import type { DeploymentSummary } from "@panel/shared";
import { api } from "../lib/api";
import { triggerLabel } from "../lib/projects";
import { duration, timeAgo } from "../lib/format";
import { intlLocale, t } from "../i18n";
import { DeployBadge } from "../components/ProjectUi";
import { EmptyState, ErrorNotice, PageHeader, SkeletonRows } from "../components/Status";

type StatusFilter = "all" | "failed" | "active" | "success";
const statusFilters: StatusFilter[] = ["all", "failed", "active", "success"];
/** API en fazla bu kadar deploy döndürür */
const LIMIT = 100;
const matchesStatus = (d: DeploymentSummary, f: StatusFilter) =>
  f === "all" || (f === "active" ? d.status === "queued" || d.status === "running" : d.status === f);

const link = (d: DeploymentSummary) => `/projects/${d.projectId}?tab=deploys&deploy=${d.id}`;

/** Commit varsa kısa sha + mesajın ilk satırı, yoksa image */
function Source({ d, withMessage = true }: { d: DeploymentSummary; withMessage?: boolean }) {
  if (!d.commitSha) return <span className="text-muted">{d.image}</span>;
  const msg = d.commitMessage?.split("\n")[0];
  return (
    <>
      <span className="text-fg">{d.commitSha.slice(0, 7)}</span>
      {withMessage && msg && <span className="font-sans text-muted"> · {msg}</span>}
    </>
  );
}

const sourceTitle = (d: DeploymentSummary) => (d.commitSha ? `${d.commitSha}${d.commitMessage ? ` · ${d.commitMessage}` : ""}\n${d.image}` : d.image);

/** Başarısız deploy'un hata satırı: neden + logu açma */
function ErrorLine({ d }: { d: DeploymentSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2 text-xs text-danger/90">
      <span className="dot dot-urgent" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{d.error}</span>
      <Link to={link(d)} className="btn-secondary btn-sm max-sm:ml-[17px]" onClick={(e) => e.stopPropagation()}>
        {t("deploys:list.openLog")}
      </Link>
    </div>
  );
}

export function DeploymentsPage() {
  const navigate = useNavigate();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["deployments", "all"],
    queryFn: () => api.get<DeploymentSummary[]>("/api/deployments"),
    refetchInterval: 3000,
  });
  const [project, setProject] = useState<number | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const projects = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of data ?? []) if (!m.has(d.projectId)) m.set(d.projectId, d.projectName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], intlLocale()));
  }, [data]);
  const inProject = useMemo(() => (data ?? []).filter((d) => project === "all" || d.projectId === project), [data, project]);
  const rows = useMemo(() => inProject.filter((d) => matchesStatus(d, status)), [inProject, status]);
  const counts = useMemo(() => Object.fromEntries(statusFilters.map((f) => [f, inProject.filter((d) => matchesStatus(d, f)).length])) as Record<StatusFilter, number>, [inProject]);
  const filtered = project !== "all" || status !== "all";
  const clear = () => {
    setProject("all");
    setStatus("all");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("nav.deploys")}
        docTitle={t("nav.deploys")}
        description={
          <>
            {t("deploys:list.descriptionBefore")}
            <span className="font-mono text-xs text-fg">{LIMIT}</span>
            {t("deploys:list.descriptionAfter")} ·{" "}
            <span className="inline-flex items-center gap-1.5">
              <span className="dot dot-ok animate-pulse motion-reduce:animate-none" aria-hidden />
              {t("deploys:list.refreshEvery", { seconds: 3 })}
            </span>
          </>
        }
      />
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {isLoading && <SkeletonRows rows={5} className="h-14" />}
      {data?.length === 0 && (
        <EmptyState icon={<Rocket className="size-5" />} title={t("deploys:empty.title")}>
          {t("deploys:empty.body")}
        </EmptyState>
      )}

      {!!data?.length && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="input w-auto max-w-full min-w-0 max-sm:flex-1 sm:max-w-64"
            aria-label={t("deploys:list.filterProject")}
            value={project}
            onChange={(e) => setProject(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">{t("deploys:list.allProjects")}</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="segmented max-sm:grid max-sm:w-full max-sm:grid-cols-4" role="radiogroup" aria-label={t("deploys:list.filterStatus")}>
            {statusFilters.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={status === f} onClick={() => setStatus(f)} className="inline-flex items-center justify-center gap-1.5 max-sm:px-1.5">
                {t(`deploys:filters.${f}`)}
                <span className={`font-mono text-[11px] tabular-nums ${status === f ? "" : "text-faint"}`}>{counts[f]}</span>
              </button>
            ))}
          </div>
          {filtered && (
            <span className="font-mono text-xs text-faint tabular-nums" aria-live="polite">
              {t("deploys:list.shownOf", { shown: rows.length, total: data.length })}
            </span>
          )}
        </div>
      )}

      {!!data?.length && rows.length === 0 && (
        <EmptyState
          icon={<SearchX className="size-5" />}
          title={t("deploys:noMatch.title")}
          action={
            <button className="btn-secondary" onClick={clear}>
              {t("deploys:noMatch.clear")}
            </button>
          }
        >
          {t("deploys:noMatch.body", { limit: LIMIT })}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <>
          {/* Telefon: liste */}
          <ul className="overflow-hidden rounded-lg border border-line bg-raised md:hidden">
            {rows.map((d) => (
              <li key={d.id} className="border-b border-line-soft last:border-b-0">
                <Link to={link(d)} className="block px-4 py-3 active:bg-fg/[0.03]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{d.projectName}</span>
                    <DeployBadge status={d.status} />
                  </div>
                  <div className="mt-1 truncate font-mono text-xs" title={sourceTitle(d)}>
                    <Source d={d} />
                  </div>
                  <div className="mt-1 flex justify-between gap-3 text-xs text-muted">
                    <span className="min-w-0 truncate">
                      <span className="font-mono">#{d.id}</span> · {triggerLabel[d.trigger]} <span className="text-faint">·</span> {timeAgo(d.createdAt)}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{duration(d.startedAt, d.finishedAt)}</span>
                  </div>
                </Link>
                {d.error && (
                  <div className="px-4 pb-3">
                    <ErrorLine d={d} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Masaüstü: tablo */}
          <div className="hidden overflow-hidden rounded-lg border border-line bg-raised md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint uppercase">
                <tr>
                  <th className="w-16 px-4 py-2.5 font-semibold sm:px-5">#</th>
                  <th className="px-4 py-2.5 font-semibold">{t("deploys:table.project")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("deploys:table.status")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("deploys:table.source")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("deploys:table.trigger")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold sm:px-5">{t("deploys:table.duration")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <Fragment key={d.id}>
                    <tr
                      className={`cursor-pointer transition-colors duration-150 hover:bg-fg/[0.02] ${d.error ? "" : "border-b border-line-soft last:border-b-0"}`}
                      onClick={() => navigate(link(d))}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted tabular-nums sm:px-5">#{d.id}</td>
                      <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                        <Link to={link(d)} className="underline-offset-3 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {d.projectName}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <DeployBadge status={d.status} />
                      </td>
                      <td className="max-w-[300px] truncate px-4 py-2.5 font-mono text-xs" title={sourceTitle(d)}>
                        <span className="lg:hidden">
                          <Source d={d} withMessage={false} />
                        </span>
                        <span className="max-lg:hidden">
                          <Source d={d} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">
                        {triggerLabel[d.trigger]} <span className="text-faint">·</span> {timeAgo(d.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap text-muted tabular-nums sm:px-5">{duration(d.startedAt, d.finishedAt)}</td>
                    </tr>
                    {d.error && (
                      <tr className="border-b border-line-soft last:border-b-0">
                        <td colSpan={6} className="px-4 pb-3 sm:px-5">
                          <ErrorLine d={d} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
