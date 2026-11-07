import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Eye, KeyRound, Lock, RefreshCw, Table2 } from "lucide-react";
import { dbEngineInfo, isKvEngine, isSqlEngine, type DatabaseInfo, type ExplorerStatus, type ExplorerTree } from "@panel/shared";
import { api } from "../lib/api";
import { explorerGet, useExplorerStatus } from "../lib/explorer";
import { FormError } from "../components/AuthCard";
import { ErrorNotice, PageHeader, SkeletonRows } from "../components/Status";
import { SqlView } from "../components/explorer/SqlView";
import { MongoView } from "../components/explorer/MongoView";
import { RedisView } from "../components/explorer/RedisView";
import { fmtNumber } from "../lib/format";
import { t } from "../i18n";

/**
 * Veritabanı gezgini: /databases/:id/data?g=<şema|veritabanı>&t=<tablo|koleksiyon|dbN>
 * Panel oturumuna ek olarak 2FA koduyla açılır.
 */
export function DatabaseExplorerPage() {
  const id = Number(useParams().id);
  const { data: d, error } = useQuery({ queryKey: ["database", id], queryFn: () => api.get<DatabaseInfo>(`/api/databases/${id}`) });
  const { data: status } = useExplorerStatus();

  return (
    <div className="mx-auto max-w-[1400px]">
      {error && (
        <>
          <BackLink />
          <ErrorNotice error={error} />
        </>
      )}
      {!d && !error && <SkeletonRows rows={3} />}
      {d && (
        <>
          <PageHeader
            back={<BackLink />}
            title={d.name}
            description={
              <>
                {dbEngineInfo[d.engine].label} <span className="font-mono text-fg">{d.version}</span>
                {d.vector ? " + pgvector" : ""}
                {t("databases:explorer.subtitle")}
              </>
            }
            actions={status?.unlocked && <LockBar status={status} />}
          />
          {!status ? null : status.unlocked ? <Explorer db={d} /> : <UnlockCard status={status} />}
        </>
      )}
    </div>
  );
}

const BackLink = () => (
  <Link to="/databases" className="-ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-sm px-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-fg">
    <ArrowLeft className="size-3.5" aria-hidden /> {t("nav.databases")}
  </Link>
);

function LockBar({ status }: { status: ExplorerStatus }) {
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const left = status.expiresAt ? Math.min(status.idleMinutes, Math.max(0, Math.ceil((status.expiresAt - now) / 60_000))) : 0;
  async function lockNow() {
    await api.post("/api/explorer/lock");
    qc.invalidateQueries({ queryKey: ["explorer-status"] });
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-raised py-1.5 pr-1.5 pl-3.5 text-xs text-muted sm:w-auto">
      <span className="inline-flex items-center gap-2 font-semibold text-fg">
        <span className="dot dot-ok" aria-hidden /> {t("databases:explorer.unlocked")}
      </span>
      <span className="min-w-0 flex-1">
        {t("databases:explorer.autoLockBefore")}
        <span className="font-mono text-fg">{left}</span>
        {t("databases:explorer.autoLockAfter", { count: left })}
      </span>
      <button className="btn-secondary btn-sm max-sm:min-h-11" onClick={lockNow}>
        <Lock className="size-3.5" aria-hidden /> {t("databases:explorer.lock")}
      </button>
    </div>
  );
}

function UnlockCard({ status }: { status: ExplorerStatus }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<ExplorerStatus>("/api/explorer/unlock", { code });
      qc.setQueryData(["explorer-status"], s);
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card mx-auto mt-2 max-w-md space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-canvas text-accent">
          <KeyRound className="size-5" aria-hidden />
        </div>
        <div>
          <h2 className="font-semibold">{t("databases:explorer.lockedTitle")}</h2>
          <p className="text-sm text-muted">{t("databases:explorer.lockedBody")}</p>
        </div>
      </div>
      <input
        className="input text-center font-mono text-lg tracking-[0.4em]"
        aria-label={t("databases:explorer.code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <FormError message={error} />
      <button className="btn w-full" disabled={busy || code.length !== 6}>
        {busy ? t("databases:explorer.verifying") : t("actions.open")}
      </button>
      <p className="hint">
        {t("databases:explorer.lockHint", { count: status.idleMinutes })}
      </p>
    </form>
  );
}

function Explorer({ db }: { db: DatabaseInfo }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tree = useQuery({
    queryKey: ["explorer-tree", db.id],
    queryFn: () => explorerGet<ExplorerTree>(qc, `/api/databases/${db.id}/explorer/tree`),
    retry: false,
  });
  const group = params.get("g");
  const item = params.get("t");
  const select = (g: string, item: string) => setParams({ g, t: item }, { replace: false });

  // İlk açılışta ilk tabloyu seç
  useEffect(() => {
    if (group || !tree.data) return;
    const g = tree.data.groups.find((x) => x.items.length);
    if (g) setParams({ g: g.name, t: g.items[0]!.name }, { replace: true });
  }, [tree.data, group, setParams]);

  const engine = db.engine;
  const kind = engine === "mongo" ? "collection" : isKvEngine(engine) ? "database" : "table";

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-w-0">
        {/* Telefon: açılır liste */}
        <div className="lg:hidden">
          {tree.data && (
            <select className="input font-mono" aria-label={t(`databases:explorer.select.${kind}`)} value={group && item ? `${group}\u0000${item}` : ""} onChange={(e) => select(...(e.target.value.split("\u0000") as [string, string]))}>
              <option value="" disabled>
                {t(`databases:explorer.select.${kind}`)}
              </option>
              {tree.data.groups.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.items.map((i) => (
                    <option key={i.name} value={`${g.name}\u0000${i.name}`}>
                      {i.name}
                      {i.count != null ? ` (${i.count})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
        <nav className="hidden overflow-hidden rounded-lg border border-line bg-raised lg:block" aria-label={engine === "mongo" ? t("databases:explorer.databases") : t("databases:explorer.schemas")}>
          <div className="flex min-h-12 items-center justify-between border-b border-line py-2 pr-2 pl-4">
            <span className="cap">{engine === "mongo" ? t("databases:explorer.databases") : isKvEngine(engine) ? dbEngineInfo[engine].label : t("databases:explorer.schemas")}</span>
            <button className="btn-icon md:size-8" title={t("actions.refresh")} aria-label={t("databases:explorer.refreshTree")} onClick={() => tree.refetch()}>
              <RefreshCw className={`size-3.5 ${tree.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            {tree.data?.groups.map((g) => <TreeGroup key={g.name} g={g} active={g.name === group ? item : null} onSelect={(item) => select(g.name, item)} />)}
            {!tree.data && !tree.error && (
              <div className="space-y-1.5 p-1.5">
                <div className="skeleton h-6" />
                <div className="skeleton h-6" />
                <div className="skeleton h-6" />
              </div>
            )}
            {tree.data && !tree.data.groups.some((g) => g.items.length) && <p className="p-3 text-sm text-muted">{t(`databases:explorer.none.${kind}`)}</p>}
          </div>
        </nav>
        {tree.error && <FormError message={(tree.error as Error).message} />}
      </aside>
      <section className="min-w-0">
        {group && item ? (
          isSqlEngine(engine) ? (
            <SqlView key={`${group}.${item}`} dbId={db.id} schema={group} table={item} engine={engine} />
          ) : engine === "mongo" ? (
            <MongoView key={`${group}.${item}`} dbId={db.id} database={group} collection={item} onChanged={() => tree.refetch()} />
          ) : (
            <RedisView key={item} dbId={db.id} db={Number(item.replace(/^db/, "")) || 0} onChanged={() => tree.refetch()} />
          )
        ) : (
          isSqlEngine(engine) ? (
            <SqlView dbId={db.id} schema="" table="" engine={engine} />
          ) : (
            <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              <Table2 className="mx-auto mb-2 size-5 text-subtle" aria-hidden /> {t(`databases:explorer.pick.${kind}`)}
            </div>
          )
        )}
      </section>
    </div>
  );
}

function TreeGroup({ g, active, onSelect }: { g: ExplorerTree["groups"][number]; active: string | null; onSelect: (t: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        className="flex min-h-8 w-full items-center gap-1 rounded-sm px-1.5 pt-1.5 text-left font-mono text-[11px] text-subtle transition-colors duration-150 hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-3" aria-hidden /> : <ChevronRight className="size-3" aria-hidden />}
        <span className="truncate">{g.name}</span>
      </button>
      {open &&
        g.items.map((i) => (
          <button
            key={i.name}
            onClick={() => onSelect(i.name)}
            aria-current={active === i.name ? "true" : undefined}
            title={i.kind === "view" ? t("databases:explorer.viewNamed", { name: i.name }) : i.name}
            className={`relative flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 pl-3 text-left transition-colors duration-150 ${
              active === i.name
                ? "bg-fg/[0.05] font-semibold text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                : "text-fg/80 hover:bg-fg/[0.03] hover:text-fg"
            }`}
          >
            {i.kind === "view" && <Eye className="size-3.5 shrink-0 text-subtle" aria-label={t("databases:explorer.view")} />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{i.name}</span>
            {i.count != null && <span className="font-mono text-[11px] font-normal text-subtle">{fmtNumber(i.count)}</span>}
          </button>
        ))}
    </div>
  );
}
