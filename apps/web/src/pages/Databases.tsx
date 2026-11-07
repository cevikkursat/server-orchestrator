import { useState, type FormEvent } from "react";
import { EmptyState, ErrorNotice, PageHeader, SkeletonRows, StatusBadge } from "../components/Status";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, Database, Eye, EyeOff, Download, History, Link2, Plus, RotateCcw, Table2, Terminal as TermIcon, Trash2, X } from "lucide-react";
import { dbEngineInfo, dbEngines, isKvEngine, isServiceEngine, type BackupEntry, type DatabaseInfo, type DbEngine, type OrthancStats } from "@panel/shared";
import { api, formatBytes } from "../lib/api";
import { copy, useDatabases } from "../lib/ops";
import { timeAgo, useProjects } from "../lib/projects";
import { StateBadge } from "../components/ContainerUi";
import { FormError } from "../components/AuthCard";
import { alertDialog, confirmDialog, showError } from "../lib/dialog";
import { fmtDateTime, fmtNumber } from "../lib/format";
import { t } from "../i18n";

/** "Orthanc (DICOM)" → "Orthanc": açıklama satırı ayrıca yazılıyor */
const engineName = (e: DbEngine) => dbEngineInfo[e].label.replace(/ \(.*\)$/, "");

/** Motor seçicide adın altındaki kısa açıklama (yalnız arayüz metni) */
const engineHint = (e: DbEngine) => t(`databases:engineHint.${e}`);

export function DatabasesPage() {
  const { data, error, isLoading } = useDatabases();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <PageHeader
        title={t("nav.databases")}
        flush
        description={
          <>
            {t("databases:page.description")}
            {data && data.length > 0 && (
              <>
                {" "}
                · <span className="font-mono text-fg">{data.length}</span>
                {t("databases:page.installed")}
              </>
            )}
          </>
        }
        actions={
          !creating && (
            <button className="btn max-sm:flex-1" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> {t("databases:page.newDb")}
            </button>
          )
        }
      />

      {creating && <CreateForm onDone={() => setCreating(false)} />}
      {error && <ErrorNotice error={error} />}
      {isLoading && <SkeletonRows rows={2} className="h-40" />}
      {data && data.length === 0 && !creating && (
        <EmptyState icon={<Database className="size-5" aria-hidden />} title={t("databases:page.emptyTitle")}>
          {t("databases:page.emptyBody")}
        </EmptyState>
      )}
      {data?.map((d) => <DatabaseCard key={d.id} d={d} />)}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [engine, setEngine] = useState<DbEngine>("postgres");
  const [version, setVersion] = useState(dbEngineInfo.postgres.versions[0]!);
  const [name, setName] = useState("");
  const [memoryMb, setMemoryMb] = useState<number | null>(512);
  const [vector, setVector] = useState(false);
  const [orthanc, setOrthanc] = useState<OrthancForm>({
    storage: "s3",
    endpoint: "",
    region: "auto",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    rootPath: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/databases", {
        name,
        engine,
        version,
        memoryMb,
        vector: engine === "postgres" && vector,
        orthanc: engine === "orthanc" ? (orthanc.storage === "local" ? { storage: "local" } : orthanc) : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["databases"] });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-lg border border-accent/30 bg-raised" aria-labelledby="new-db-title">
      <div className="card-head">
        <h2 id="new-db-title" className="cap">
          {t("databases:create.title")}
        </h2>
        <button type="button" className="btn-icon -mr-2" onClick={onDone} title={t("actions.close")} aria-label={t("databases:create.closeForm")}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div role="group" aria-labelledby="new-db-engine">
          <div id="new-db-engine" className="label">
            {t("databases:create.engine")}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {dbEngines.map((e) => (
              <button
                type="button"
                key={e}
                aria-pressed={engine === e}
                onClick={() => {
                  setEngine(e);
                  setVersion(dbEngineInfo[e].versions[0]!);
                }}
                className={`min-h-14 rounded-md border px-3 py-2.5 text-left transition-colors duration-150 ${
                  engine === e ? "border-accent/70 bg-accent/[0.07]" : "border-line bg-canvas/40 hover:border-line-strong"
                }`}
              >
                <span className="block text-sm font-semibold text-fg">{engineName(e)}</span>
                <span className={`block text-[11px] leading-4 ${engine === e ? "text-muted" : "text-subtle"}`}>{engineHint(e)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="block">
              <span className="label">{t("databases:create.name")}</span>
              <input
                className="input font-mono"
                spellCheck={false}
                autoCapitalize="off"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32))}
                placeholder="blog-db"
                autoFocus
              />
            </label>
            <p className="hint font-mono">{t("databases:create.address", { name: name || t("databases:create.namePlaceholder") })}</p>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:create.version")}</span>
              <select className="input" value={version} onChange={(e) => setVersion(e.target.value)}>
                {dbEngineInfo[engine].versions.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:create.memoryLimit")}</span>
              <select className="input" value={memoryMb ?? ""} onChange={(e) => setMemoryMb(e.target.value ? Number(e.target.value) : null)}>
                {[128, 256, 512, 1024, 2048].map((m) => (
                  <option key={m} value={m}>
                    {m >= 1024 ? `${m / 1024} GB` : `${m} MB`}
                  </option>
                ))}
                <option value="">{t("databases:create.unlimited")}</option>
              </select>
            </label>
          </div>
        </div>
        {engine === "orthanc" && <OrthancStorageFields value={orthanc} onChange={setOrthanc} />}
        {engine === "postgres" && (
          <label className="check-row items-start text-sm text-fg">
            <input type="checkbox" className="mt-1 accent-accent" checked={vector} onChange={(e) => setVector(e.target.checked)} />
            <span>
              <span className="font-medium">{t("databases:create.vector")}</span>
              <span className="block text-xs text-subtle">{t("databases:create.vectorHint")}</span>
            </span>
          </label>
        )}
        <p className="text-xs text-subtle">{t("databases:create.passwordNote")}</p>
        <FormError message={error} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
        <button type="button" className="btn-secondary max-sm:flex-1" onClick={onDone}>
          {t("actions.cancel")}
        </button>
        <button className="btn max-sm:flex-1" disabled={busy || name.length < 2}>
          {busy ? t("databases:create.creating") : t("databases:create.submit")}
        </button>
      </div>
    </form>
  );
}

const actionBtn = "btn-secondary btn-sm max-sm:min-h-11";
const pressed = "border-accent/60 bg-accent/[0.07]";

function DatabaseCard({ d }: { d: DatabaseInfo }) {
  const qc = useQueryClient();
  const { data: projects } = useProjects();
  const [reveal, setReveal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [projectId, setProjectId] = useState<number | "">("");
  const [envKey, setEnvKey] = useState(dbEngineInfo[d.engine].envKey);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBackups, setShowBackups] = useState(false);

  const masked = reveal ? d.connectionUrl : d.connectionUrl.replace(d.password, "•".repeat(12));
  const running = d.container?.state === "running";
  const lb = d.lastBackup;

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["databases"] });
      qc.invalidateQueries({ queryKey: ["db-backups", d.id] });
    }
  }

  const link = () =>
    run(async () => {
      await api.post(`/api/databases/${d.id}/link`, { projectId, envKey });
      setLinking(false);
      const p = projects?.find((x) => x.id === projectId);
      const keys = d.engine === "orthanc" ? ["_URL", "_USERNAME", "_PASSWORD"].map((s) => envKey.replace(/_URL$/, "") + s).join(", ") : envKey;
      return t("databases:card.linked", { keys, project: p?.name ?? "" });
    });

  const backup = () =>
    run(async () => {
      const r = await api.post<{ status: string; error: string | null; sizeBytes: number | null }>(`/api/databases/${d.id}/backup`);
      if (r.status !== "success") throw new Error(r.error ?? t("databases:card.backupFailed"));
      return t("databases:card.backupDone");
    });

  async function remove() {
    const ok = await confirmDialog({
      title: t("databases:card.removeConfirm.title", { name: d.name }),
      message: t("databases:card.removeConfirm.message"),
      confirmLabel: t("databases:card.removeConfirm.confirm"),
      danger: true,
      typeToConfirm: d.name,
    });
    if (!ok) return;
    await api.del(`/api/databases/${d.id}`);
    qc.invalidateQueries({ queryKey: ["databases"] });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby={`db-${d.id}-name`}>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id={`db-${d.id}-name`} className="text-base font-bold">
                {d.name}
              </h2>
              {d.container ? <StateBadge state={d.container.state} /> : <StatusBadge tone="danger" shape="x" label={t("container.none")} />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted">
              <span>
                {engineName(d.engine)} <span className="font-mono text-fg">{d.version}</span>
                {d.vector ? " + pgvector" : ""}
              </span>
              {d.storage?.mode === "s3" ? (
                <span>
                  {t("databases:card.imagesS3")}
                  <span className="font-mono text-fg">{d.storage.bucket}</span>
                </span>
              ) : d.storage?.mode === "local" ? (
                <span>{t("databases:card.imagesLocal")}</span>
              ) : null}
              <span>
                {t("databases:card.memory")} {d.memoryMb ? <span className="font-mono text-fg">{d.memoryMb} MB</span> : t("databases:card.memoryUnlimited")}
              </span>
              {lb ? (
                <span className={`inline-flex items-center gap-1.5 ${lb.status === "failed" ? "text-danger" : ""}`}>
                  <span className={`dot ${lb.status === "success" ? "dot-ok" : lb.status === "failed" ? "dot-urgent" : "dot-look"}`} aria-hidden />
                  {t("databases:card.lastBackup", {
                    ago: timeAgo(lb.createdAt),
                    status: t(lb.status === "success" ? "databases:card.backupStatus.success" : lb.status === "failed" ? "databases:card.backupStatus.failed" : "databases:card.backupStatus.running"),
                  })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="dot dot-none" aria-hidden /> {t("databases:card.noBackup")}
                </span>
              )}
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            {!isServiceEngine(d.engine) && (
              <Link to={`/databases/${d.id}/data`} className={`${actionBtn} ${running ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!running}>
                <Table2 className="size-3.5" aria-hidden /> {t("databases:card.data")}
              </Link>
            )}
            <button className={`${actionBtn} ${linking ? pressed : ""}`} aria-expanded={linking} onClick={() => setLinking((l) => !l)}>
              <Link2 className="size-3.5" aria-hidden /> {t("databases:card.link")}
            </button>
            <button className={`${actionBtn} ${showBackups ? pressed : ""}`} aria-expanded={showBackups} onClick={() => setShowBackups((v) => !v)}>
              <History className="size-3.5" aria-hidden /> {t("databases:card.backups")}
            </button>
            <button className={actionBtn} onClick={backup} disabled={busy || !running}>
              <Archive className="size-3.5" aria-hidden /> {t("databases:card.backup")}
            </button>
            {d.container && (
              <Link to={`/containers/${d.container.id}`} className={actionBtn} title={t("databases:card.logsTitle")}>
                <TermIcon className="size-3.5" aria-hidden /> {t("databases:card.logs")}
              </Link>
            )}
            <button className="btn-danger btn-sm max-sm:col-span-2 max-sm:min-h-11 sm:ml-2" onClick={remove} title={t("databases:card.remove")} aria-label={t("databases:card.removeNamed", { name: d.name })}>
              <Trash2 className="size-3.5" aria-hidden /> {t("actions.delete")}
            </button>
          </div>
        </div>

        <div>
          <div className="label" id={`db-${d.id}-url`}>
            {t("databases:card.url")}
          </div>
          <div className="flex gap-2">
            <code aria-labelledby={`db-${d.id}-url`} className="input flex min-w-0 flex-1 items-center overflow-x-auto font-mono text-xs whitespace-nowrap">
              {masked}
            </code>
            <button className="btn-icon border border-line" onClick={() => setReveal((r) => !r)} title={reveal ? t("actions.hide") : t("actions.show")} aria-label={reveal ? t("databases:card.hideUrl") : t("databases:card.showUrl")}>
              {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
            <button className="btn-icon border border-line" onClick={() => copy(d.connectionUrl)} title={t("actions.copy")} aria-label={t("databases:card.copyUrl")}>
              <Copy className="size-4" aria-hidden />
            </button>
          </div>
          <p className="hint">{t("databases:card.urlHint")}</p>
        </div>

        {linking && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-canvas/40 p-3">
            <div className="min-w-48 flex-1">
              <label className="block">
                <span className="label">{t("databases:card.project")}</span>
                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">{t("databases:card.select")}</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="w-full sm:w-48">
              <label className="block">
                <span className="label">{t("databases:card.envKey")}</span>
                <input className="input font-mono text-xs" value={envKey} onChange={(e) => setEnvKey(e.target.value.trim())} />
              </label>
            </div>
            <button className="btn max-sm:w-full" disabled={!projectId || !envKey || busy} onClick={link}>
              {t("actions.add")}
            </button>
          </div>
        )}
        {d.engine === "orthanc" && running && <OrthancStatsLine d={d} />}
        {msg && (
          <p className={`notice py-2.5 ${msg.ok ? "border-success/25 bg-success/[0.05] text-success" : "notice-danger"}`} role="status">
            {msg.text}
          </p>
        )}
      </div>
      {showBackups && <DbBackups d={d} />}
    </section>
  );
}

function OrthancStatsLine({ d }: { d: DatabaseInfo }) {
  const { data, error } = useQuery({
    queryKey: ["orthanc-stats", d.id],
    queryFn: () => api.get<OrthancStats>(`/api/databases/${d.id}/orthanc-stats`),
    refetchInterval: 60_000,
    retry: false,
  });
  if (error) return <p className="text-xs text-subtle">{t("databases:orthanc.statsFailed", { error: (error as Error).message })}</p>;
  if (!data) return null;
  const n = (v: number) => fmtNumber(v);
  return (
    <p className="text-xs text-muted">
      <span className="font-mono text-fg">{n(data.patients)}</span>
      {t("databases:orthanc.patients", { count: data.patients })} · <span className="font-mono text-fg">{n(data.studies)}</span>
      {t("databases:orthanc.studies", { count: data.studies })} · <span className="font-mono text-fg">{n(data.instances)}</span>
      {t("databases:orthanc.instances", { count: data.instances })} · <span className="font-mono text-fg">{n(data.sizeMb)} MB</span>
      {d.storage?.mode === "s3" ? t("databases:orthanc.inS3") : ""}
    </p>
  );
}

type OrthancForm = { storage: "local" | "s3"; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; rootPath: string };

function OrthancStorageFields({ value, onChange }: { value: OrthancForm; onChange: (v: OrthancForm) => void }) {
  const set = (p: Partial<OrthancForm>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3 rounded-md border border-line bg-canvas/40 p-3">
      <div className="label">{t("databases:orthanc.whereTitle")}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["s3", t("databases:orthanc.s3Title"), t("databases:orthanc.s3Desc")],
            ["local", t("databases:orthanc.localTitle"), t("databases:orthanc.localDesc")],
          ] as const
        ).map(([k, title, desc]) => (
          <button
            type="button"
            key={k}
            onClick={() => set({ storage: k })}
            aria-pressed={value.storage === k}
            className={`rounded-md border p-3 text-left text-sm transition-colors duration-150 ${value.storage === k ? "border-accent/70 bg-accent/[0.07]" : "border-line hover:border-line-strong"}`}
          >
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-xs text-subtle">{desc}</div>
          </button>
        ))}
      </div>
      {value.storage === "s3" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block">
              <span className="label">{t("databases:orthanc.endpoint")}</span>
              <input className="input font-mono text-xs" value={value.endpoint} onChange={(e) => set({ endpoint: e.target.value.trim() })} placeholder={t("databases:orthanc.endpointPlaceholder")} />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:orthanc.bucket")}</span>
              <input className="input font-mono text-xs" value={value.bucket} onChange={(e) => set({ bucket: e.target.value.trim() })} placeholder={t("databases:orthanc.bucketPlaceholder")} />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:orthanc.region")}</span>
              <input className="input font-mono text-xs" value={value.region} onChange={(e) => set({ region: e.target.value.trim() })} />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:orthanc.accessKey")}</span>
              <input className="input font-mono text-xs" value={value.accessKeyId} onChange={(e) => set({ accessKeyId: e.target.value.trim() })} autoComplete="off" />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:orthanc.secretKey")}</span>
              <input className="input font-mono text-xs" type="password" value={value.secretAccessKey} onChange={(e) => set({ secretAccessKey: e.target.value.trim() })} autoComplete="new-password" />
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block">
              <span className="label">{t("databases:orthanc.rootPath")}</span>
              <input className="input font-mono text-xs" value={value.rootPath} onChange={(e) => set({ rootPath: e.target.value.trim() })} placeholder={t("databases:orthanc.rootPathPlaceholder")} />
            </label>
          </div>
          <p className="text-xs text-subtle sm:col-span-2">
            {t("databases:orthanc.note")}
          </p>
        </div>
      )}
    </div>
  );
}

const backupTriggers = ["schedule", "manual", "predeploy"] as const;
const triggerLabel = (tr: string) =>
  (backupTriggers as readonly string[]).includes(tr) ? t(`databases:backups.trigger.${tr as (typeof backupTriggers)[number]}`) : tr;

/** Bu veritabanının yedekleri: indir / geri yükle */
function DbBackups({ d }: { d: DatabaseInfo }) {
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["db-backups", d.id],
    queryFn: () => api.get<BackupEntry[]>(`/api/databases/${d.id}/backups`),
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "running") ? 3000 : false),
  });
  const [busyId, setBusyId] = useState<number | null>(null);

  async function restore(b: BackupEntry) {
    const ok = await confirmDialog({
      title: t("databases:backups.restoreConfirm.title"),
      message: t("databases:backups.restoreConfirm.message", { name: d.name, date: fmtDateTime(b.createdAt) }),
      confirmLabel: t("databases:backups.restoreConfirm.confirm"),
      danger: true,
      typeToConfirm: d.name,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      const r = await api.post<{ safetyBackupId: number }>(`/api/backups/${b.id}/restore`);
      void alertDialog({ title: t("databases:backups.restored.title"), message: t("databases:backups.restored.message", { id: r.safetyBackupId }), tone: "success" });
    } catch (err) {
      void showError(err, t("databases:backups.restoreFailed"));
    } finally {
      setBusyId(null);
      qc.invalidateQueries({ queryKey: ["db-backups", d.id] });
      qc.invalidateQueries({ queryKey: ["databases"] });
      qc.invalidateQueries({ queryKey: ["backups"] });
    }
  }

  return (
    <div className="border-t border-line px-4 pt-3 pb-2 sm:px-5" role="region" aria-labelledby={`db-${d.id}-bk`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id={`db-${d.id}-bk`} className="cap">
          {t("databases:backups.title")}
          {data && <span className="ml-1.5 font-mono tracking-normal text-faint">· {data.length}</span>}
        </h3>
        <span className="text-xs text-muted">
          {isKvEngine(d.engine)
            ? t("databases:backups.kvNote", { engine: dbEngineInfo[d.engine].label })
            : t("databases:backups.safetyNote")}
        </span>
      </div>
      {error && (
        <div className="mt-2">
          <FormError message={(error as Error).message} />
        </div>
      )}
      {!data && !error && <div className="skeleton my-3 h-10" />}
      {data && data.length > 0 && (
        <ul className="mt-1 max-h-96 overflow-y-auto">
          {data.map((b) => (
            <li key={b.id} className="flex items-center gap-2 border-b border-line-soft py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-fg">
                    {fmtDateTime(b.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-mono text-xs text-subtle">
                    #{b.id} · {triggerLabel(b.trigger)}
                    {b.sizeBytes != null && ` · ${formatBytes(b.sizeBytes)}`}
                  </span>
                </div>
                {b.status !== "success" && (
                  <div className={`mt-0.5 flex items-center gap-1.5 text-xs ${b.status === "failed" ? "text-danger" : "text-warning"}`} title={b.error ?? ""}>
                    <span className={`dot ${b.status === "failed" ? "dot-urgent" : "dot-look"}`} aria-hidden />
                    <span className="truncate">{b.status === "failed" ? t("databases:backups.failed", { error: b.error ?? "" }) : t("databases:backups.running")}</span>
                  </div>
                )}
              </div>
              {b.status === "success" && (
                <a className="btn-icon" href={`/api/backups/${b.id}/download`} title={t("databases:backups.download")} aria-label={t("databases:backups.downloadNamed", { id: b.id })}>
                  <Download className="size-4" aria-hidden />
                </a>
              )}
              {b.restorable && (
                <button className="btn-secondary btn-sm max-sm:min-h-11" disabled={busyId !== null || d.container?.state !== "running"} onClick={() => restore(b)}>
                  <RotateCcw className={`size-3.5 ${busyId === b.id ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                  {busyId === b.id ? t("databases:backups.restoring") : t("databases:backups.restore")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.length === 0 && <p className="py-3 text-sm text-muted">{t("databases:backups.empty")}</p>}
    </div>
  );
}
