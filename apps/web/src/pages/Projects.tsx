import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { showError } from "../lib/dialog";
import { toast } from "../lib/toast";
import { Box, FolderGit2, GitPullRequest, LoaderCircle, Lock, Plus, Rocket, ScrollText, Search, Star } from "lucide-react";
import type { ProjectSummary } from "@panel/shared";
import { setProjectPinned, timeAgo, useProjects } from "../lib/projects";
import { sourceLabel } from "../lib/github";
import { StateBadge } from "../components/ContainerUi";
import { CaddyBanner, DeployPill } from "../components/ProjectUi";
import { HealthBadge } from "../components/ProjectTabs";
import { EmptyState, ErrorNotice, PageHeader, SkeletonRows, StatusBadge } from "../components/Status";
import { Github } from "../components/GithubIcon";
import { intlLocale, t } from "../i18n";

const COLS = "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_7rem_7.25rem]";

export function ProjectsPage() {
  const { data, error, isLoading, refetch } = useProjects();
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const s = q.trim().toLocaleLowerCase(intlLocale());
    return (data ?? []).filter(
      (p) => !s || p.name.includes(s) || p.domains.some((d) => d.hostname.includes(s)) || sourceLabel(p.source).toLocaleLowerCase(intlLocale()).includes(s),
    );
  }, [data, q]);
  const running = data?.filter((p) => p.container?.state === "running").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <CaddyBanner />
      <PageHeader
        title={t("nav.projects")}
        description={
          data?.length ? (
            <>
              <span className="font-mono text-fg tabular-nums">{data.length}</span> {t("projects:list.statProjects", { count: data.length })} ·{" "}
              <span className="font-mono text-fg tabular-nums">{running}</span> {t("projects:list.statRunning")} · {t("projects:list.descriptionInline")}
            </>
          ) : (
            t("projects:list.description")
          )
        }
        actions={
          <>
            {data && data.length > 0 && (
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <input
                  type="search"
                  className="input pl-9"
                  placeholder={t("projects:list.searchPlaceholder")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label={t("projects:list.searchLabel")}
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </div>
            )}
            <Link to="/projects/new" className="btn max-sm:order-first max-sm:w-full">
              <Plus className="size-4" aria-hidden /> {t("projects:list.new")}
            </Link>
          </>
        }
      />

      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {isLoading && <SkeletonRows rows={4} className="h-[68px]" />}

      {data && data.length === 0 && (
        <EmptyState
          icon={<FolderGit2 className="size-5" />}
          title={t("projects:list.empty.title")}
          action={
            <Link to="/projects/new" className="btn">
              <Plus className="size-4" aria-hidden /> {t("projects:list.empty.action")}
            </Link>
          }
        >
          {t("projects:list.empty.body")}
        </EmptyState>
      )}

      {data && data.length > 0 && (
        <>
          <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-label={t("projects:list.listLabel")}>
            {/* Masaüstü sütun başlıkları */}
            <div className={`hidden gap-4 border-b border-line px-5 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase lg:grid ${COLS}`}>
              <span>{t("projects:list.columns.project")}</span>
              <span>{t("projects:list.columns.domain")}</span>
              <span>{t("projects:list.columns.lastDeploy")}</span>
              <span className="text-right">{t("projects:list.columns.time")}</span>
              <span />
            </div>
            <ul>
              {list.map((p) => (
                <ProjectRow key={p.id} p={p} />
              ))}
            </ul>
            {list.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                {t("projects:list.noMatch", { q })}{" "}
                <button className="link" onClick={() => setQ("")}>
                  {t("projects:list.clearSearch")}
                </button>
              </div>
            )}
          </section>
          <Legend />
        </>
      )}
    </div>
  );
}

/** İşaret açıklaması: listedeki işaretlerin anlamı */
function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label={t("marks.legend")}>
      <span className="inline-flex items-center gap-1.5">
        <span className="dot dot-ok" aria-hidden /> {t("projects:legend.ok")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle className="size-3 text-info" aria-hidden /> {t("projects:legend.deploying")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="dot dot-urgent" aria-hidden /> {t("projects:legend.failed")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="dot dot-none" aria-hidden /> {t("projects:legend.stopped")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Lock className="size-3 text-special" aria-hidden /> {t("projects:restricted")}
      </span>
    </div>
  );
}

function ProjectRow({ p }: { p: ProjectSummary }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function quickDeploy() {
    try {
      const r = await api.post<{ deploymentId: number }>(`/api/projects/${p.id}/deploy`);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      toast(t("projects:deploy.started", { name: p.name }), "info");
      navigate(`/projects/${p.id}?tab=deploys&deploy=${r.deploymentId}`);
    } catch (err) {
      void showError(err, t("projects:deploy.startFailed"));
    }
  }
  const primary = p.domains.find((d) => d.kind === "route");
  const extra = p.domains.filter((d) => d.kind === "route").length - 1;
  const deploying = p.lastDeployment?.status === "running" || p.lastDeployment?.status === "queued";
  const showLive = p.lastDeployment?.status === "failed" && p.liveDeploymentId != null && p.liveDeploymentId !== p.lastDeployment.id;
  async function togglePin() {
    try {
      await setProjectPinned(qc, p.id, !p.pinned);
    } catch (err) {
      void showError(err, t("projects:pin.failed"));
    }
  }
  const when = p.lastDeployment ? timeAgo(p.lastDeployment.createdAt) : null;
  return (
    <li className="group/row relative border-b border-line-soft last:border-b-0">
      <Link
        to={`/projects/${p.id}`}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-fg/[0.02] sm:px-5 ${COLS}`}
      >
        {/* Ad + durum + kaynak */}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            {p.pinned && <Star className="-mr-1 size-3.5 shrink-0 fill-accent text-accent" aria-label={t("projects:row.pinned")} />}
            <span className="truncate font-semibold text-fg">{p.name}</span>
            {p.container ? <StateBadge state={p.container.state} /> : <StatusBadge tone="neutral" shape="hollow" label={t("deploy.none")} />}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-subtle">
            {p.source.type === "github" ? <Github className="size-3 shrink-0" /> : <Box className="size-3 shrink-0" aria-hidden />}
            <span className="truncate font-mono">{sourceLabel(p.source)}</span>
          </div>
        </div>

        {/* Telefonda sağ üst: zaman */}
        <span className="self-start text-right text-xs text-muted tabular-nums lg:hidden">{when ?? ""}</span>

        {/* Domain */}
        <div className="col-span-2 flex min-w-0 items-center gap-2 text-sm lg:col-span-1">
          {primary ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-fg/90">{primary.hostname}</span>
              {primary.access && <Lock className="size-3 shrink-0 text-special" aria-label={t("projects:restricted")} />}
              {extra > 0 && <span className="shrink-0 font-mono text-xs text-muted">+{extra}</span>}
            </span>
          ) : (
            <span className="text-subtle">{t("projects:row.noDomain")}</span>
          )}
        </div>

        {/* Son deploy + sağlık + önizleme */}
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 lg:col-span-1">
          {p.lastDeployment ? (
            <>
              <DeployPill status={p.lastDeployment.status} id={p.lastDeployment.id} />
              {showLive && (
                <span className="text-xs text-muted" title={t("projects:row.liveTitle")}>
                  {t("projects:live")} <span className="font-mono text-fg">#{p.liveDeploymentId}</span>
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted">{t("projects:row.notDeployed")}</span>
          )}
          <HealthBadge health={p.health} />
          {p.previewCount > 0 && (
            <span className="badge tone-neutral h-[22px] tracking-normal">
              <GitPullRequest className="size-3" aria-hidden /> <span className="font-mono">{p.previewCount}</span> {t("projects:row.previews", { count: p.previewCount })}
            </span>
          )}
        </div>

        <span className="hidden text-right text-xs text-muted tabular-nums lg:block">{when ?? "—"}</span>
        <span className="hidden lg:block" aria-hidden />
      </Link>
      {/* Hızlı eylemler: masaüstünde satırın sonunda; klavyeyle odaklanınca da görünür */}
      <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 lg:flex">
        <button
          type="button"
          className={`btn-icon size-8 md:size-8 ${p.pinned ? "text-accent hover:text-accent" : ""}`}
          title={p.pinned ? t("projects:pin.unpin") : t("projects:pin.pin")}
          aria-label={p.pinned ? t("projects:pin.unpinNamed", { name: p.name }) : t("projects:pin.pinNamed", { name: p.name })}
          aria-pressed={p.pinned}
          onClick={() => void togglePin()}
        >
          <Star className={`size-4 ${p.pinned ? "fill-current" : ""}`} />
        </button>
        <Link to={`/projects/${p.id}?tab=logs`} className="btn-icon size-8 md:size-8" title={t("projects:row.logs")} aria-label={t("projects:row.openLogs", { name: p.name })}>
          <ScrollText className="size-4" />
        </Link>
        <button
          type="button"
          className="btn-icon size-8 md:size-8"
          title={deploying ? t("projects:deploy.inProgress") : t("projects:deploy.action")}
          aria-label={deploying ? t("projects:row.deployingNamed", { name: p.name }) : t("projects:row.deployNamed", { name: p.name })}
          disabled={deploying}
          onClick={() => void quickDeploy()}
        >
          <Rocket className="size-4" />
        </button>
      </div>
    </li>
  );
}
