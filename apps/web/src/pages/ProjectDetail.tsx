import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Copy, ExternalLink, GitPullRequest, LoaderCircle, Lock, Plus, Rocket, Star, Undo2, X } from "lucide-react";
import { EmptyState, ErrorNotice, StatusBadge } from "../components/Status";
import { Github } from "../components/GithubIcon";
import type { DeploymentSummary, DomainAccess, DomainEntry, EnvVar, ProjectDetail, ProjectSourceInput, UpdateProjectInput } from "@panel/shared";
import { api } from "../lib/api";
import { sourceLabel } from "../lib/github";
import { isSourceComplete, SourceFields } from "../components/SourceFields";
import { appUrl, duration, setProjectPinned, timeAgo, triggerLabel, useProject, useSettings } from "../lib/projects";
import { ContainerActions, StateBadge } from "../components/ContainerUi";
import { CaddyBanner, DangerButton, DeployPill, DeploymentLog, EnvEditor } from "../components/ProjectUi";
import { LogViewer } from "../components/LogViewer";
import { Terminal } from "../components/LazyTerminal";
import { CronTab } from "../components/CronTab";
import { FormError } from "../components/AuthCard";
import { DnsHelp, DomainStatus, useDomainOverview } from "../components/DomainStatus";
import { ResourceFields, StartCommandField, VolumeFields } from "./NewProject";
import { AccessBadge, AccessEditor, TailnetSetup } from "../components/AccessUi";
import { EnvGroupsPicker, HealthBadge, HealthTab, PreviewsTab } from "../components/ProjectTabs";
import { confirmDialog, showError } from "../lib/dialog";
import { TabBar } from "../components/TabBar";
import { DomainTargetForm, TargetSummary } from "../components/DomainTarget";
import { copy } from "../lib/ops";
import { t } from "../i18n";

type Tab = "deploys" | "logs" | "env" | "domains" | "previews" | "health" | "cron" | "terminal" | "settings";
const allTabs: Tab[] = ["deploys", "logs", "env", "domains", "previews", "health", "cron", "terminal", "settings"];
// PR önizlemesinin ayarları ana projeden gelir
const previewTabs = new Set<Tab>(["deploys", "logs", "domains", "terminal", "settings"]);

export function ProjectDetailPage() {
  const id = Number(useParams().id);
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const { data: p, error } = useProject(id);
  const { data: settings } = useSettings();
  const tab = (search.get("tab") as Tab) ?? "deploys";
  const setTab = (next: Tab) => setSearch((s) => (s.set("tab", next), s), { replace: true });

  async function deploy() {
    const r = await api.post<{ deploymentId: number }>(`/api/projects/${id}/deploy`);
    setSearch({ tab: "deploys", deploy: String(r.deploymentId) }, { replace: true });
    qc.invalidateQueries({ queryKey: ["project", id] });
    qc.invalidateQueries({ queryKey: ["deployments"] });
  }

  if (error) return <ErrorNotice error={error} />;
  if (!p)
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="skeleton h-5 w-24" />
        <div className="skeleton h-16 w-80 max-w-full" />
        <div className="skeleton h-10" />
        <div className="skeleton h-72" />
      </div>
    );

  const routes = p.domains.filter((d) => d.kind === "route");
  const tabs = allTabs
    .filter((id) => (p.preview ? previewTabs.has(id) : id !== "previews" || p.source.type === "github"))
    .map((id) => ({ id, label: t(`projects:detail.tabs.${id}`) }));
  const deploying = p.lastDeployment?.status === "running" || p.lastDeployment?.status === "queued";

  return (
    <div className="mx-auto max-w-6xl">
      <CaddyBanner />
      <Link
        to={p.preview ? `/projects/${p.preview.parentId}?tab=previews` : "/projects"}
        className="-ml-1 mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted transition-colors hover:text-fg max-md:min-h-11"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {p.preview ? p.preview.parentName : t("nav.projects")}
      </Link>
      {p.preview && (
        <div className="notice notice-special mb-4 flex-wrap items-center gap-2 py-2.5">
          <GitPullRequest className="size-4" />
          <span>
            {p.preview.prTitle
              ? t("projects:detail.preview.bannerTitled", { n: p.preview.prNumber, title: p.preview.prTitle })
              : t("projects:detail.preview.banner", { n: p.preview.prNumber })}
          </span>
          {p.preview.prUrl && (
            <a href={p.preview.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-special hover:underline">
              GitHub <ExternalLink className="size-3" />
            </a>
          )}
          <span className="text-special/70">· {t("projects:detail.preview.autoDelete")}</span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="page-title min-w-0 truncate">{p.name}</h1>
            {p.container ? <StateBadge state={p.container.state} /> : <StatusBadge tone="neutral" shape="hollow" label={t("container.none")} />}
            <HealthBadge health={p.health} />
            {!p.preview && (
              <button
                type="button"
                className={`btn-icon -my-2 ${p.pinned ? "text-accent hover:text-accent" : ""}`}
                title={p.pinned ? t("projects:pin.unpin") : t("projects:pin.pinLists")}
                aria-label={p.pinned ? t("projects:pin.unpin") : t("projects:pin.pinLists")}
                aria-pressed={p.pinned}
                onClick={() => setProjectPinned(qc, p.id, !p.pinned).catch((err) => showError(err, t("projects:pin.failed")))}
              >
                <Star className={`size-4 ${p.pinned ? "fill-current" : ""}`} />
              </button>
            )}
          </div>
          {routes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {routes.map((d) => (
                <a
                  key={d.id}
                  href={appUrl(d.hostname, settings?.https ?? false)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5 border-b border-line text-fg transition-colors duration-150 hover:border-muted max-md:min-h-11"
                >
                  <span className="truncate">{d.display}</span>
                  {d.access ? <Lock className="size-3 shrink-0 text-special" aria-label={t("projects:restricted")} /> : <ExternalLink className="size-3 shrink-0 text-faint" aria-hidden />}
                </a>
              ))}
            </div>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs text-subtle">
            {p.source.type === "github" ? (
              <a href={`https://github.com/${p.source.repoFullName}/tree/${p.source.branch}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg/85">
                <Github className="size-3.5" /> {sourceLabel(p.source)}
              </a>
            ) : (
              sourceLabel(p.source)
            )}
            <span>· {t("projects:detail.port", { port: p.port })}</span>
            {p.source.type === "github" && !p.source.autoDeploy && <span>· {t("projects:detail.autoDeployOff")}</span>}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {p.container && (
            <>
              <div className="sm:hidden">
                <ContainerActions c={{ ...p.container, image: sourceLabel(p.source), createdAt: 0, ports: [], composeProject: null, projectName: p.name, isSelf: false, isSystem: false }} size="sm" />
              </div>
              <div className="hidden sm:block">
                <ContainerActions c={{ ...p.container, image: sourceLabel(p.source), createdAt: 0, ports: [], composeProject: null, projectName: p.name, isSelf: false, isSystem: false }} size="md" />
              </div>
            </>
          )}
          <button className="btn flex-1 sm:flex-none" onClick={deploy} disabled={deploying}>
            {deploying ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
            {deploying ? t("projects:deploy.inProgressEllipsis") : t("projects:deploy.action")}
          </button>
        </div>
      </div>

      <TabBar className="mt-6" tabs={tabs} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === "deploys" && (
          <DeploysTab
            projectId={id}
            currentContainer={p.container?.name ?? null}
            selected={Number(search.get("deploy")) || null}
            onSelect={(d) => setSearch({ tab: "deploys", deploy: String(d) }, { replace: true })}
          />
        )}
        {tab === "logs" &&
          (p.container ? (
            <LogViewer containerId={p.container.id} live={p.container.state === "running"} />
          ) : (
            <EmptyState title={t("projects:detail.logsEmpty.title")}>{t("projects:detail.logsEmpty.body")}</EmptyState>
          ))}
        {tab === "env" && <EnvTab p={p} onDeploy={deploy} />}
        {tab === "domains" && <DomainsTab p={p} />}
        {tab === "previews" && <PreviewsTab p={p} />}
        {tab === "health" && <HealthTab p={p} />}
        {tab === "cron" && <CronTab projectId={p.id} hasContainer={p.container?.state === "running"} />}
        {tab === "terminal" &&
          (p.container?.state === "running" ? (
            <Terminal containerId={p.container.id} />
          ) : (
            <EmptyState title={t("projects:detail.terminalEmpty.title")}>{t("projects:detail.terminalEmpty.body")}</EmptyState>
          ))}
        {tab === "settings" && <SettingsTab p={p} onDeploy={deploy} />}
      </div>
    </div>
  );
}

// ---- Deploylar ----
function DeploysTab({
  projectId,
  currentContainer,
  selected,
  onSelect,
}: {
  projectId: number;
  currentContainer: string | null;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const { data } = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: () => api.get<DeploymentSummary[]>(`/api/projects/${projectId}/deployments`),
    refetchInterval: 3000,
  });
  const current = selected ?? data?.[0]?.id ?? null;
  const sel = data?.find((d) => d.id === current);
  const canRollback = sel?.status === "success" && sel.containerName !== currentContainer;

  // Liste en yeniden eskiye gelir. Yayındaki sürüm: container'ı şu an çalışan başarılı deploy.
  const liveIdx = data?.findIndex((d) => d.status === "success" && !!d.containerName && d.containerName === currentContainer) ?? -1;
  const live = liveIdx >= 0 ? data![liveIdx] : null;
  const latest = data?.[0];
  const inProgress = latest?.status === "queued" || latest?.status === "running";
  // Yayındakinden yeni (ya da yayında sürüm yoksa en yeni) başarısız deploy
  const failed = data?.find((d, i) => d.status === "failed" && (liveIdx < 0 || i < liveIdx)) ?? null;
  // Container yoksa dönülebilecek en yeni başarılı sürüm
  const fallback = !currentContainer && !inProgress ? (data?.find((d) => d.status === "success") ?? null) : null;

  async function rollback(target: DeploymentSummary) {
    const ok = await confirmDialog({
      title: t("projects:deploys.rollbackConfirm.title", { id: target.id }),
      message: target.commitSha ? `${target.commitSha.slice(0, 7)} ${target.commitMessage ?? ""}` : target.image,
      confirmLabel: t("projects:deploys.rollbackConfirm.confirm"),
    });
    if (!ok) return;
    try {
      const r = await api.post<{ deploymentId: number }>(`/api/deployments/${target.id}/rollback`);
      onSelect(r.deploymentId);
      qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch (err) {
      void showError(err, t("projects:deploys.rollbackFailed"));
    }
  }

  if (data && !data.length) return <EmptyState title={t("projects:deploys.empty.title")}>{t("projects:deploys.empty.body")}</EmptyState>;

  // Telefonda liste logun üstünde durur: en yeni 3 (ve seçili olan) gösterilir, gerisi "Tümünü göster" ile açılır
  const COLLAPSED = 3;
  const hiddenCount = data && !showAll ? data.filter((d, i) => i >= COLLAPSED && d.id !== current).length : 0;

  let pinned: ReactNode = null;
  if (failed && live && !inProgress) {
    pinned = (
      <div className="notice notice-warning flex-wrap items-center justify-between py-2.5" role="status">
        <span className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="text-fg">
            {t("projects:deploys.failedLiveRunning", { failed: failed.id, live: live.id })}
          </span>
        </span>
        {current !== failed.id && (
          <button className="btn-secondary btn-sm max-md:min-h-11" onClick={() => onSelect(failed.id)}>
            {t("projects:deploys.viewLog")}
          </button>
        )}
      </div>
    );
  } else if (fallback) {
    pinned = (
      <div className="notice notice-danger flex-wrap items-center justify-between py-2.5" role="status">
        <span className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>{failed ? t("projects:deploys.failedNoLive", { id: failed.id }) : t("projects:deploys.noLive")}</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {failed && current !== failed.id && (
            <button className="btn-ghost btn-sm max-md:min-h-11" onClick={() => onSelect(failed.id)}>
              {t("projects:deploys.viewLog")}
            </button>
          )}
          <button className="btn-secondary btn-sm max-md:min-h-11" onClick={() => rollback(fallback)}>
            <Undo2 className="size-4" aria-hidden /> {t("projects:deploys.rollbackTo", { id: fallback.id })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pinned}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_1fr] xl:grid-cols-[300px_1fr] [&>*]:min-w-0">
        <div className="space-y-1.5">
          {data?.map((d, i) => (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              aria-pressed={d.id === current}
              className={`w-full rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 ${
                d.id === current ? "border-accent/45 bg-raised" : "border-line hover:border-line-strong"
              } ${!showAll && i >= COLLAPSED && d.id !== current ? "hidden lg:block" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums">#{d.id}</span>
                <DeployPill status={d.status} />
              </div>
              {d.commitSha && (
                <div className="mt-1.5 truncate text-xs text-fg" title={d.commitMessage ?? ""}>
                  <span className="font-mono text-faint">{d.commitSha.slice(0, 7)}</span> {d.commitMessage}
                </div>
              )}
              <div className="mt-1.5 flex justify-between gap-2 text-xs text-muted">
                <span className="min-w-0">
                  {triggerLabel[d.trigger]} · {timeAgo(d.createdAt)}
                  {d.containerName && d.containerName === currentContainer && <span className="font-semibold text-success"> · {t("projects:live")}</span>}
                </span>
                <span className="shrink-0 font-mono tabular-nums">{duration(d.startedAt, d.finishedAt)}</span>
              </div>
            </button>
          ))}
          {hiddenCount > 0 && (
            <button className="btn-ghost w-full lg:hidden" onClick={() => setShowAll(true)}>
              {t("projects:deploys.showAll", { count: hiddenCount })}
            </button>
          )}
          {showAll && data && data.length > COLLAPSED && (
            <button className="btn-ghost w-full lg:hidden" onClick={() => setShowAll(false)}>
              {t("projects:deploys.showLess")}
            </button>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          {canRollback && sel && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-xs">
              <span className="text-muted">{t("projects:deploys.notLive")}</span>
              <button className="btn-secondary btn-sm max-md:min-h-11" onClick={() => rollback(sel)}>
                <Undo2 className="size-4" aria-hidden /> {t("projects:deploys.rollbackHere")}
              </button>
            </div>
          )}
          {current && <DeploymentLog id={current} />}
        </div>
      </div>
    </div>
  );
}

// ---- Ortak: ayarları kaydet ----
function useSaveProject(p: ProjectDetail) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(patch: Partial<UpdateProjectInput>, then?: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: UpdateProjectInput = {
        source: p.source,
        startCommand: p.startCommand,
        port: p.port,
        env: p.env,
        memoryMb: p.memoryMb,
        cpus: p.cpus,
        volumes: p.volumes,
        preDeployBackup: p.preDeployBackup,
        ...patch,
      };
      await api.put(`/api/projects/${p.id}`, body);
      await qc.invalidateQueries({ queryKey: ["project", p.id] });
      setSaved(true);
      if (then) await then();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { save, error, busy, saved };
}

function SaveButtons({ busy, saved, dirty, onSave, onSaveDeploy }: { busy: boolean; saved: boolean; dirty: boolean; onSave: () => void; onSaveDeploy: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn" disabled={busy || !dirty} onClick={onSaveDeploy}>
        <Rocket className="size-4" /> {t("projects:save.saveDeploy")}
      </button>
      <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={onSave}>
        {t("projects:save.saveOnly")}
      </button>
      {saved && !dirty && <span className="text-xs text-success">{t("projects:save.savedNextDeploy")}</span>}
    </div>
  );
}

function EnvTab({ p, onDeploy }: { p: ProjectDetail; onDeploy: () => Promise<void> }) {
  const [env, setEnv] = useState<EnvVar[]>(p.env);
  const { save, error, busy, saved } = useSaveProject(p);
  useEffect(() => setEnv(p.env), [p.env]);
  const clean = env.filter((e) => e.key);
  const dirty = JSON.stringify(clean) !== JSON.stringify(p.env);

  return (
    <div className="space-y-4">
      <div className="card max-w-3xl space-y-4">
        <EnvEditor value={env} onChange={setEnv} />
        <p className="text-xs text-subtle">
          {t("projects:env.encrypted")}
          {p.source.type === "github" && p.source.compose && ` ${t("projects:env.composeNote")}`}
        </p>
        <FormError message={error} />
        <SaveButtons busy={busy} saved={saved} dirty={dirty} onSave={() => save({ env: clean })} onSaveDeploy={() => save({ env: clean }, onDeploy)} />
      </div>
      <EnvGroupsPicker p={p} />
    </div>
  );
}

function SettingsTab({ p, onDeploy }: { p: ProjectDetail; onDeploy: () => Promise<void> }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [source, setSource] = useState<ProjectSourceInput>(p.source);
  const [startCommand, setStartCommand] = useState(p.startCommand ?? "");
  const [port, setPort] = useState(p.port);
  const [memoryMb, setMemoryMb] = useState(p.memoryMb);
  const [cpus, setCpus] = useState(p.cpus);
  const [volumes, setVolumes] = useState(p.volumes);
  const [preDeployBackup, setPreDeployBackup] = useState(p.preDeployBackup);
  const { save, error, busy, saved } = useSaveProject(p);
  const patch = { source, startCommand: startCommand.trim() || null, port, memoryMb, cpus, volumes, preDeployBackup };
  const dirty =
    JSON.stringify(source) !== JSON.stringify(p.source) ||
    (startCommand.trim() || null) !== p.startCommand ||
    port !== p.port ||
    memoryMb !== p.memoryMb ||
    cpus !== p.cpus ||
    JSON.stringify(volumes) !== JSON.stringify(p.volumes) ||
    preDeployBackup !== p.preDeployBackup;

  async function remove() {
    await api.del(`/api/projects/${p.id}`);
    await qc.invalidateQueries({ queryKey: ["projects"] });
    navigate(p.preview ? `/projects/${p.preview.parentId}?tab=previews` : "/projects");
  }

  if (p.preview) {
    return (
      <div className="card max-w-3xl border-danger/35">
        <h3 className="text-sm font-semibold text-danger">{t("projects:settings.deletePreview.title")}</h3>
        <p className="mt-1 text-sm text-muted">
          {t("projects:settings.deletePreview.body")}
        </p>
        <div className="mt-4">
          <DangerButton label={t("projects:settings.deletePreview.title")} confirmText={p.name} onConfirm={remove} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {p.internalUrl && (
        <div className="card flex flex-wrap items-center gap-3 py-3">
          <span className="text-sm text-muted">{t("projects:settings.internalUrl")}</span>
          <code className="font-mono text-sm text-fg">{p.internalUrl}</code>
          <button type="button" className="btn-icon" title={t("actions.copy")} aria-label={t("projects:settings.copyInternal")} onClick={() => copy(p.internalUrl!)}>
            <Copy className="size-4" aria-hidden />
          </button>
          <span className="basis-full text-xs text-subtle">
            {t("projects:settings.internalHint")}
          </span>
        </div>
      )}
      <form className="card space-y-5" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <SourceFields value={source} onChange={setSource} />
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <StartCommandField value={startCommand} onChange={setStartCommand} />
          <div>
            <label className="block">
<span className="label">{t("projects:fields.internalPort")}</span>
            <input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
</label>
          </div>
        </div>
        <ResourceFields memoryMb={memoryMb} cpus={cpus} onMemory={setMemoryMb} onCpus={setCpus} />
        {!(source.type === "github" && source.compose) && <VolumeFields value={volumes} onChange={setVolumes} projectName={p.name} />}
        <label className="check-row items-start text-sm text-fg/85">
          <input type="checkbox" className="mt-0.5" checked={preDeployBackup} onChange={(e) => setPreDeployBackup(e.target.checked)} />
          <span>
            {t("projects:settings.preDeployBackup.label")}
            <span className="block text-xs text-subtle">
              {p.linkedDatabases.length ? (
                <>
                  {t("projects:settings.preDeployBackup.before")}
                  <span className="font-mono">{p.linkedDatabases.join(", ")}</span>
                  {t("projects:settings.preDeployBackup.after")}
                </>
              ) : (
                t("projects:settings.preDeployBackup.noDbs")
              )}
            </span>
          </span>
        </label>
        <FormError message={error} />
        <SaveButtons
          busy={busy || !isSourceComplete(source)}
          saved={saved}
          dirty={dirty}
          onSave={() => save(patch)}
          onSaveDeploy={() => save(patch, onDeploy)}
        />
      </form>

      <div className="card border-danger/35">
        <h3 className="text-sm font-semibold text-danger">{t("projects:settings.danger.title")}</h3>
        <p className="mt-1 text-sm text-muted">
          {t("projects:settings.danger.body")}
          {p.source.type === "github" && p.source.compose && ` ${t("projects:settings.danger.composeNote")}`}
        </p>
        <div className="mt-4">
          <DangerButton label={t("projects:settings.danger.deleteProject")} confirmText={p.name} onConfirm={remove} />
        </div>
      </div>
    </div>
  );
}

// ---- Domainler ----
function DomainsTab({ p }: { p: ProjectDetail }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: overview } = useDomainOverview();
  const [hostname, setHostname] = useState("");
  const [redirectWww, setRedirectWww] = useState(false);
  const [access, setAccess] = useState<DomainAccess>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const primary = p.domains.find((d) => d.kind === "route")?.hostname;

  async function run(fn: () => Promise<{ warning: string | null }>) {
    setError(null);
    try {
      const r = await fn();
      setWarning(r.warning);
      await qc.invalidateQueries({ queryKey: ["project", p.id] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(() => api.post(`/api/projects/${p.id}/domains`, { hostname, redirectWww, access }));
    setHostname("");
    setRedirectWww(false);
    setAccess(null);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card divide-y divide-line-soft p-0">
        {p.domains.map((d) => (
          <div key={d.id} className="space-y-2 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <a href={appUrl(d.hostname, settings?.https ?? false)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-sm text-fg hover:underline">
                {d.display}
              </a>
              {d.hostname === primary && <span className="badge tone-neutral h-[22px] tracking-normal">{t("projects:domains.primary")}</span>}
              <div className="ml-auto flex items-center gap-0.5">
                {!p.preview && d.kind === "route" && editingTarget !== d.id && (
                  <button className="btn-ghost btn-sm min-h-11 md:min-h-9" title={t("projects:domains.targetTitle")} onClick={() => setEditingTarget(d.id)}>
                    <ArrowRight className="size-3.5" aria-hidden /> {t("projects:domains.target")}
                  </button>
                )}
                {!p.preview && editing !== d.id && (
                  <button className="btn-ghost btn-sm min-h-11 md:min-h-9" title={t("projects:domains.accessTitle")} onClick={() => setEditing(d.id)}>
                    <Lock className="size-3.5" aria-hidden /> {t("projects:domains.access")}
                  </button>
                )}
                <button
                  className="btn-icon hover:text-danger"
                  title={t("projects:domains.removeTitle")}
                  aria-label={t("projects:domains.removeNamed", { name: d.display })}
                  onClick={async () => {
                    if (await confirmDialog({ title: t("projects:domains.removeConfirm.title", { name: d.display }), message: t("projects:domains.removeConfirm.message"), confirmLabel: t("projects:remove"), danger: true })) {
                      await run(() => api.del(`/api/projects/${p.id}/domains/${d.id}`));
                    }
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {d.kind === "redirect" && (
              <div className="flex items-center gap-1 text-xs text-subtle">
                <ArrowRight className="size-3 shrink-0" aria-hidden /> <span className="truncate">{t("projects:domains.redirectsTo", { host: primary ?? "" })}</span>
              </div>
            )}
            <AccessBadge access={d.access} />
            {d.kind === "route" && <TargetSummary d={d} p={p} />}
            <DomainStatus hostname={d.hostname} detail />
            {editing === d.id && <DomainAccessForm d={d} projectId={p.id} onDone={() => setEditing(null)} onResult={setWarning} />}
            {editingTarget === d.id && <DomainTargetForm d={d} p={p} onDone={() => setEditingTarget(null)} onResult={setWarning} />}
          </div>
        ))}
        {p.domains.length === 0 && <div className="px-5 py-4 text-sm text-subtle">{t("projects:domains.empty")}</div>}
      </div>

      <form onSubmit={add} className="card space-y-3">
        <label htmlFor="domain-add" className="label">{t("projects:domains.add")}</label>
        <div className="flex gap-2">
          <input id="domain-add" className="input min-w-0 flex-1 font-mono" spellCheck={false} autoCapitalize="off" value={hostname} onChange={(e) => setHostname(e.target.value.trim())} placeholder={t("projects:domains.placeholder", { base: settings?.baseDomain ?? "localhost" })} />
          <button className="btn" disabled={!hostname}>
            <Plus className="size-4" /> {t("actions.add")}
          </button>
        </div>
        {hostname && !hostname.startsWith("www.") && (
          <label className="check-row text-muted">
            <input type="checkbox" checked={redirectWww} onChange={(e) => setRedirectWww(e.target.checked)} />
            <span>
              {t("projects:domains.redirectWww.before")}
              <span className="font-mono">www.{hostname}</span>
              {t("projects:domains.redirectWww.after")}
            </span>
          </label>
        )}
        {hostname && <AccessEditor value={access} onChange={setAccess} />}
        <FormError message={error} />
        {warning && <p className="text-sm text-warning">{warning}</p>}
        <p className="text-xs text-subtle">
          {t("projects:domains.hint", { base: settings?.baseDomain ?? "" })}
        </p>
      </form>
      {p.domains.some((d) => d.access?.tailnet) && <TailnetSetup compact />}
      {overview && <DnsHelp ips={overview.publicIps} compact />}
    </div>
  );
}

function DomainAccessForm({ d, projectId, onDone, onResult }: { d: DomainEntry; projectId: number; onDone: () => void; onResult: (w: string | null) => void }) {
  const qc = useQueryClient();
  const [access, setAccess] = useState<DomainAccess>(d.access);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api.put<{ warning: string | null }>(`/api/projects/${projectId}/domains/${d.id}/access`, { access });
      onResult(r.warning);
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-line bg-canvas p-3">
      <AccessEditor value={access} onChange={setAccess} />
      <FormError message={error} />
      <div className="flex gap-2">
        <button className="btn" onClick={save}>
          {t("actions.save")}
        </button>
        <button className="btn-ghost" onClick={onDone}>
          {t("actions.cancel")}
        </button>
      </div>
    </div>
  );
}
