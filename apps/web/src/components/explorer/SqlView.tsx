import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { SqlCell, SqlEngine, SqlColumn, SqlFilter, SqlQueryResult, SqlRowsResult } from "@panel/shared";
import { useExplorer } from "../../lib/explorer";
import { confirmDialog, showError } from "../../lib/dialog";
import { FormError } from "../AuthCard";
import { Modal } from "../Modal";
import { TabBar } from "../TabBar";
import { fmtNumber } from "../../lib/format";
import { t } from "../../i18n";

type Tab = "data" | "sql";

export function SqlView({ dbId, schema, table, engine }: { dbId: number; schema: string; table: string; engine: SqlEngine }) {
  const [tab, setTab] = useState<Tab>(table ? "data" : "sql");
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <TabBar
        className="px-2 sm:px-3"
        tabs={[...(table ? [{ id: "data" as Tab, label: <span className="font-mono text-[13px]">{schema}.{table}</span> }] : []), { id: "sql" as Tab, label: t("databases:sql.console") }]}
        value={tab}
        onChange={setTab}
      />
      {tab === "data" && table ? <TableData dbId={dbId} schema={schema} table={table} /> : <SqlConsole dbId={dbId} engine={engine} defaultTable={table ? `${schema}.${table}` : null} />}
    </div>
  );
}

export function Cell({ v, max = 80 }: { v: SqlCell; max?: number }) {
  if (v === null) return <span className="text-faint italic">NULL</span>;
  if (v === "") return <span className="text-faint italic">{t("databases:explorer.empty")}</span>;
  return <>{v.length > max ? `${v.slice(0, max)}…` : v}</>;
}

const opLabels = (): Record<SqlFilter["op"], string> => ({
  eq: "=",
  neq: "≠",
  contains: t("databases:sql.op.contains"),
  gt: ">",
  lt: "<",
  null: t("databases:sql.op.null"),
  notnull: t("databases:sql.op.notnull"),
});

function TableData({ dbId, schema, table }: { dbId: number; schema: string; table: string }) {
  const { call } = useExplorer(dbId);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<SqlFilter[]>([]);
  const [draft, setDraft] = useState<SqlFilter[]>([]);
  const [editing, setEditing] = useState<{ key: Record<string, SqlCell> } | "new" | null>(null);

  const q = useQuery({
    queryKey: ["explorer-sql", dbId, schema, table, page, pageSize, sort, filters],
    queryFn: () => call<SqlRowsResult>("sql/rows", { schema, table, page, pageSize, sort, filters }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = q.data;
  const pkCols = data?.columns.filter((c) => c.pk) ?? [];
  const keyOf = (row: SqlCell[]) => Object.fromEntries(pkCols.map((c) => [c.name, row[data!.columns.indexOf(c)] ?? null]));

  const toggleSort = (c: string) => {
    setPage(0);
    setSort((s) => (s?.column !== c ? { column: c, dir: "asc" } : s.dir === "asc" ? { column: c, dir: "desc" } : null));
  };
  const applyFilters = () => {
    setPage(0);
    setFilters(draft.filter((f) => f.column));
  };

  const from = page * pageSize;
  const pages = data?.total != null ? Math.max(1, Math.ceil(data.total / pageSize)) : null;

  return (
    <div>
      <div className="space-y-2 border-b border-line px-4 py-3">
        {draft.map((f, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap">
            <select
              className="input font-mono text-xs sm:w-44"
              aria-label={t("databases:sql.column")}
              value={f.column}
              onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
            >
              {data?.columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
            <button className="btn-icon row-span-2 self-start sm:order-last" title={t("databases:sql.remove")} aria-label={t("databases:sql.removeFilter")} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              <X className="size-4" aria-hidden />
            </button>
            <div className="flex gap-2 sm:contents">
              <select
                className="input w-32 shrink-0"
                aria-label={t("databases:sql.condition")}
                value={f.op}
                onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, op: e.target.value as SqlFilter["op"] } : x)))}
              >
                {Object.entries(opLabels()).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {f.op !== "null" && f.op !== "notnull" && (
                <input
                  className="input min-w-0 flex-1 font-mono text-xs sm:min-w-40"
                  value={f.value}
                  placeholder={t("databases:sql.valuePlaceholder")}
                  aria-label={t("databases:explorer.value")}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              )}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost btn-sm max-sm:min-h-11" onClick={() => setDraft((d) => [...d, { column: data?.columns[0]?.name ?? "", op: "eq", value: "" }])}>
            <Filter className="size-3.5" aria-hidden /> {t("databases:sql.addFilter")}
          </button>
          {draft.length > 0 && (
            <>
              <button className="btn-secondary btn-sm max-sm:min-h-11" onClick={applyFilters}>
                {t("databases:sql.apply")}
              </button>
              <button
                className="btn-ghost btn-sm max-sm:min-h-11"
                onClick={() => {
                  setDraft([]);
                  setFilters([]);
                  setPage(0);
                }}
              >
                {t("databases:sql.clear")}
              </button>
            </>
          )}
          {filters.length > 0 && (
            <span className="text-xs text-muted">
              <span className="font-mono text-fg">{filters.length}</span>
              {t("databases:sql.activeFilters", { count: filters.length })}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {data?.editable && (
              <button className="btn-secondary btn-sm max-sm:min-h-11" onClick={() => setEditing("new")}>
                <Plus className="size-3.5" aria-hidden /> {t("databases:sql.newRow")}
              </button>
            )}
            <button className="btn-icon" title={t("actions.refresh")} aria-label={t("actions.refresh")} onClick={() => q.refetch()}>
              <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
            </button>
          </span>
        </div>
        {data && !data.editable && (
          <p className="text-xs text-subtle">{data.kind === "view" ? t("databases:sql.viewReadonly") : t("databases:sql.noPk")}</p>
        )}
      </div>

      {q.error && (
        <div className="px-4 pt-3">
          <FormError message={(q.error as Error).message} />
        </div>
      )}
      {!data && !q.error && (
        <div className="space-y-2 p-4">
          <div className="skeleton h-8" />
          <div className="skeleton h-8" />
          <div className="skeleton h-8" />
        </div>
      )}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-line bg-raised text-left">
              <tr>
                {data.columns.map((c) => (
                  <th
                    key={c.name}
                    className="px-3 py-2 align-bottom font-semibold whitespace-nowrap first:pl-4"
                    aria-sort={sort?.column === c.name ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      className={`inline-flex min-h-6 items-center gap-1 font-mono text-xs hover:text-fg ${sort?.column === c.name ? "text-fg" : "text-muted"}`}
                      onClick={() => toggleSort(c.name)}
                      title={c.type}
                    >
                      <span className={c.pk ? "text-accent" : ""}>{c.name}</span>
                      {sort?.column === c.name && (sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                    </button>
                    <div className="font-mono text-[10px] font-normal text-faint">
                      {c.type}
                      {c.pk ? " · PK" : ""}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {data.rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-line-soft transition-colors duration-150 last:border-b-0 ${data.editable ? "cursor-pointer hover:bg-fg/[0.03]" : "hover:bg-fg/[0.02]"}`}
                  onClick={() => data.editable && setEditing({ key: keyOf(row) })}
                >
                  {row.map((v, j) => (
                    <td key={j} className="max-w-xs truncate px-3 py-2 whitespace-nowrap text-fg/90 first:pl-4">
                      <Cell v={v} />
                    </td>
                  ))}
                </tr>
              ))}
              {!data.rows.length && (
                <tr>
                  <td colSpan={data.columns.length} className="px-3 py-8 text-center font-sans text-sm text-muted">
                    {t("databases:sql.noRows")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
          <span>
            <span className="font-mono text-fg">{data.rows.length ? `${from + 1}–${from + data.rows.length}` : "0"}</span>
            {data.total != null && (
              <>
                {" "}
                / <span className="font-mono">{fmtNumber(data.total)}</span>
              </>
            )}
            {t("databases:sql.rows", { count: data.total ?? data.rows.length })}
          </span>
          <div className="flex items-center gap-2">
            <select className="input w-auto md:min-h-8 md:py-1" aria-label={t("databases:sql.pageSize")} value={pageSize} onChange={(e) => (setPageSize(Number(e.target.value)), setPage(0))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {t("databases:sql.perPage", { count: n })}
                </option>
              ))}
            </select>
            <button className="btn-icon border border-line md:size-8" aria-label={t("databases:explorer.prevPage")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="font-mono">
              <span className="text-fg">{page + 1}</span>
              {pages ? ` / ${pages}` : ""}
            </span>
            <button
              className="btn-icon border border-line md:size-8"
              aria-label={t("databases:explorer.nextPage")}
              disabled={data.rows.length < pageSize || (pages != null && page + 1 >= pages)}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {editing && data && (
        <RowEditor
          dbId={dbId}
          schema={schema}
          table={table}
          columns={data.columns}
          rowKey={editing === "new" ? null : editing.key}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

const longType = (type: string) => /text|json|xml|char\(\d{3,}|varchar\(\d{3,}|bytea|blob/i.test(type) || /\[\]$/.test(type);

function RowEditor({
  dbId,
  schema,
  table,
  columns,
  rowKey,
  onClose,
  onSaved,
}: {
  dbId: number;
  schema: string;
  table: string;
  columns: SqlColumn[];
  rowKey: Record<string, SqlCell> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { call } = useExplorer(dbId);
  const isNew = rowKey === null;
  const [orig, setOrig] = useState<Record<string, SqlCell> | null>(isNew ? {} : null);
  const [vals, setVals] = useState<Record<string, SqlCell>>({});
  /** Yeni satırda boş bırakılan (varsayılanı kullanılacak) sütunlar */
  const [useDefault, setUseDefault] = useState<Record<string, boolean>>(() => Object.fromEntries(columns.map((c) => [c.name, isNew && c.hasDefault])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    call<Record<string, SqlCell>>("sql/row", { schema, table, key: rowKey })
      .then((r) => {
        setOrig(r);
        setVals(r);
      })
      .catch((e: Error) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = isNew
    ? Object.fromEntries(columns.filter((c) => c.editable && !useDefault[c.name]).map((c) => [c.name, vals[c.name] ?? (c.nullable ? null : "")]))
    : Object.fromEntries(Object.entries(vals).filter(([k, v]) => orig && v !== orig[k]));
  const nChanged = Object.keys(changed).length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await call("sql/insert", { schema, table, values: changed });
      else await call("sql/update", { schema, table, key: rowKey, values: changed });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: t("databases:sql.deleteRowConfirm"),
      message: `${schema}.${table} · ${Object.entries(rowKey!)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}\n${t("databases:explorer.irreversible")}`,
      confirmLabel: t("actions.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await call("sql/delete", { schema, table, key: rowKey });
      onSaved();
    } catch (err) {
      void showError(err, t("databases:explorer.deleteFailed"));
    }
  }

  return (
    <Modal
      wide
      title={isNew ? t("databases:sql.newRowTitle", { table }) : t("databases:sql.editRowTitle", { table })}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn-ghost mr-auto justify-center text-danger hover:text-danger" onClick={remove}>
              <Trash2 className="size-4" /> {t("databases:sql.deleteRow")}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {t("actions.cancel")}
          </button>
          <button className="btn" disabled={busy || !orig || (!isNew && nChanged === 0)} onClick={save}>
            {busy ? t("actions.saving") : isNew ? t("actions.add") : nChanged ? t("databases:sql.saveFields", { count: nChanged }) : t("actions.save")}
          </button>
        </>
      }
    >
      {!orig && !error && <p className="text-sm text-muted">{t("databases:explorer.loading")}</p>}
      {orig && (
        <div className="space-y-3">
          {columns.map((c) => {
            const v = vals[c.name] ?? null;
            const isNull = v === null;
            const dflt = !!useDefault[c.name];
            const isChanged = !isNew && orig && v !== orig[c.name];
            return (
              <div key={c.name}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-mono font-semibold ${c.pk ? "text-accent" : "text-fg"}`}>{c.name}</span>
                  <span className="font-mono text-subtle">{c.type}</span>
                  {c.pk && <span className="font-mono text-faint">{t("databases:sql.primaryKey")}</span>}
                  {!c.editable && <span className="text-subtle">{t("databases:sql.notEditable")}</span>}
                  {isChanged && <span className="font-medium text-accent">{t("databases:sql.changed")}</span>}
                  <span className="ml-auto flex gap-3">
                    {isNew && c.hasDefault && (
                      <label className="flex items-center gap-1 text-muted">
                        <input type="checkbox" className="accent-accent" checked={dflt} onChange={(e) => setUseDefault({ ...useDefault, [c.name]: e.target.checked })} />
                        {t("databases:sql.useDefault")}
                      </label>
                    )}
                    {c.nullable && c.editable && !dflt && (
                      <label className="flex items-center gap-1 text-muted">
                        <input type="checkbox" className="accent-accent" checked={isNull} onChange={(e) => setVals({ ...vals, [c.name]: e.target.checked ? null : "" })} />
                        NULL
                      </label>
                    )}
                  </span>
                </div>
                {longType(c.type) || (v?.length ?? 0) > 80 || v?.includes("\n") ? (
                  <textarea
                    className="input min-h-24 font-mono text-xs"
                    rows={Math.min(14, Math.max(3, (v ?? "").split("\n").length + 1))}
                    value={dflt ? "" : (v ?? "")}
                    placeholder={dflt ? t("databases:sql.defaultValue") : isNull ? "NULL" : ""}
                    aria-label={c.name}
                    disabled={!c.editable || dflt || (isNull && c.nullable)}
                    onChange={(e) => setVals({ ...vals, [c.name]: e.target.value })}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    className="input font-mono text-xs"
                    value={dflt ? "" : (v ?? "")}
                    placeholder={dflt ? t("databases:sql.defaultValue") : isNull ? "NULL" : ""}
                    aria-label={c.name}
                    disabled={!c.editable || dflt || (isNull && c.nullable)}
                    onChange={(e) => setVals({ ...vals, [c.name]: e.target.value })}
                    spellCheck={false}
                  />
                )}
              </div>
            );
          })}
          <p className="text-xs text-subtle">
            {t("databases:sql.valuesHint")}
          </p>
        </div>
      )}
      <FormError message={error} />
    </Modal>
  );
}

function SqlConsole({ dbId, engine, defaultTable }: { dbId: number; engine: SqlEngine; defaultTable: string | null }) {
  const { call } = useExplorer(dbId);
  const quoted = defaultTable
    ? engine === "postgres"
      ? defaultTable
          .split(".")
          .map((p) => (/^[a-z_][a-z0-9_]*$/.test(p) ? p : `"${p}"`))
          .join(".")
      : defaultTable
          .split(".")
          .map((p) => `\`${p}\``)
          .join(".")
    : null;
  const [sql, setSql] = useState(quoted ? `SELECT * FROM ${quoted} LIMIT 100;` : engine === "postgres" ? "SELECT now();" : "SELECT NOW();");
  const [write, setWrite] = useState(false);
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runQuery() {
    if (write) {
      const ok = await confirmDialog({
        title: t("databases:sql.writeConfirm.title"),
        message: t("databases:sql.writeConfirm.message"),
        confirmLabel: t("databases:sql.run"),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await call<SqlQueryResult>("sql/query", { sql, write }));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <textarea
        className="input min-h-36 bg-canvas font-mono text-xs leading-5"
        aria-label={t("databases:sql.query")}
        value={sql}
        spellCheck={false}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void runQuery();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy || !sql.trim()} onClick={runQuery}>
          <Play className="size-4" aria-hidden /> {busy ? t("databases:sql.running") : t("databases:sql.run")}
        </button>
        <kbd className="kbd hidden sm:inline">Ctrl Enter</kbd>
        <label className={`check-row ml-auto ${write ? "text-danger" : "text-muted"}`}>
          <input type="checkbox" className="accent-danger" checked={write} onChange={(e) => setWrite(e.target.checked)} />
          {t("databases:sql.write")}
        </label>
      </div>
      {!write && <p className="text-xs text-subtle">{t("databases:sql.readonlyNote")}</p>}
      <FormError message={error} />
      {result && (
        <div className="space-y-3">
          <p className="font-mono text-xs text-subtle">{result.durationMs} ms</p>
          {result.statements.map((s, i) => (
            <div key={i} className="space-y-1.5">
              <div className="text-xs text-muted">
                <span className="font-mono text-fg/85">{s.command || "OK"}</span>
                {s.rowCount != null &&
                  ` · ${t(s.columns ? "databases:sql.resultRows" : "databases:sql.resultAffected", { count: s.rowCount, n: fmtNumber(s.rowCount) })}`}
                {s.truncated && ` · ${t("databases:sql.truncated")}`}
              </div>
              {s.columns && (
                <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-line bg-raised text-left font-mono text-[11px] text-muted">
                      <tr>
                        {s.columns.map((c, j) => (
                          <th key={j} className="whitespace-nowrap px-3 py-2 font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {s.rows!.map((row, j) => (
                        <tr key={j} className="border-b border-line-soft last:border-b-0 hover:bg-fg/[0.02]">
                          {row.map((v, k) => (
                            <td key={k} className="max-w-xs truncate whitespace-nowrap px-3 py-2 text-fg/90" title={v ?? "NULL"}>
                              <Cell v={v} max={120} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
