import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { MongoFindResult } from "@panel/shared";
import { useExplorer } from "../../lib/explorer";
import { confirmDialog, showError } from "../../lib/dialog";
import { FormError } from "../AuthCard";
import { Modal } from "../Modal";
import { fmtNumber } from "../../lib/format";
import { t } from "../../i18n";

const PAGE = 25;

/** Belgenin kısa özeti: ilk birkaç alan */
function summary(doc: Record<string, unknown>) {
  return Object.entries(doc)
    .filter(([k]) => k !== "_id")
    .slice(0, 6)
    .map(([k, v]) => {
      const s = v && typeof v === "object" ? (("$date" in v && String((v as { $date: unknown }).$date)) || ("$oid" in v && String((v as { $oid: unknown }).$oid)) || JSON.stringify(v)) : String(v);
      return [k, s.length > 60 ? `${s.slice(0, 60)}…` : s] as const;
    });
}

const idText = (id: unknown) => (id && typeof id === "object" && "$oid" in id ? String((id as { $oid: string }).$oid) : JSON.stringify(id));

export function MongoView({ dbId, database, collection, onChanged }: { dbId: number; database: string; collection: string; onChanged: () => void }) {
  const { call } = useExplorer(dbId);
  const [filter, setFilter] = useState("{}");
  const [sort, setSort] = useState('{"_id": -1}');
  const [applied, setApplied] = useState({ filter: "{}", sort: '{"_id": -1}' });
  const [skip, setSkip] = useState(0);
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);

  const q = useQuery({
    queryKey: ["explorer-mongo", dbId, database, collection, applied, skip],
    queryFn: () => call<MongoFindResult>("mongo/find", { db: database, collection, ...applied, skip, limit: PAGE }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const docs = (q.data?.docs ?? []).map((text) => ({ text, doc: JSON.parse(text) as Record<string, unknown> }));

  const search = () => {
    setSkip(0);
    setApplied({ filter: filter.trim() || "{}", sort: sort.trim() || "{}" });
  };

  async function remove(id: unknown) {
    const ok = await confirmDialog({
      title: t("databases:mongo.deleteConfirm"),
      message: `${database}.${collection} · _id ${idText(id)}\n${t("databases:explorer.irreversible")}`,
      confirmLabel: t("actions.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await call("mongo/delete", { db: database, collection, id: JSON.stringify(id) });
      q.refetch();
      onChanged();
    } catch (err) {
      void showError(err, t("databases:explorer.deleteFailed"));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <div className="card-head">
        <h2 className="cap min-w-0 truncate">
          <span className="font-mono tracking-normal normal-case text-fg">
            {database}.{collection}
          </span>
        </h2>
        <span className="flex items-center gap-1">
          <button className="btn-secondary btn-sm max-sm:min-h-11" onClick={() => setEditing({ id: null, text: "{\n  \n}" })}>
            <Plus className="size-3.5" aria-hidden /> {t("databases:mongo.newDoc")}
          </button>
          <button className="btn-icon" title={t("actions.refresh")} aria-label={t("actions.refresh")} onClick={() => q.refetch()}>
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
          </button>
        </span>
      </div>
      <div className="space-y-2 border-b border-line px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
          <label className="block min-w-0">
            <span className="label">{t("databases:mongo.filter")}</span>
            <input className="input font-mono text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} spellCheck={false} placeholder='{"email": "a@b.com"}' />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("databases:mongo.sort")}</span>
            <input className="input font-mono text-xs" value={sort} onChange={(e) => setSort(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} spellCheck={false} />
          </label>
          <button className="btn-secondary" onClick={search}>
            <Search className="size-4" aria-hidden /> {t("databases:explorer.search")}
          </button>
        </div>
        <p className="text-xs text-subtle">
          {t("databases:mongo.syntaxBefore")}
          <code className="font-mono text-muted">{'{"age": {"$gt": 30}}'}</code>
          {t("databases:mongo.syntaxMiddle")}
          <code className="font-mono text-muted">{'{"_id": {"$oid": "…"}}'}</code>
          {t("databases:mongo.syntaxAfter")}
        </p>
      </div>

      {q.error && (
        <div className="px-4 pt-3">
          <FormError message={(q.error as Error).message} />
        </div>
      )}
      {!q.data && !q.error && (
        <div className="space-y-2 p-4">
          <div className="skeleton h-14" />
          <div className="skeleton h-14" />
        </div>
      )}

      <ul>
        {docs.map(({ text, doc }) => (
          <li key={text} className="flex items-start gap-2 border-b border-line-soft px-4 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02]">
            <button className="min-w-0 flex-1 py-0.5 text-left" onClick={() => setEditing({ id: JSON.stringify(doc._id), text })}>
              <div className="font-mono text-xs text-accent">{idText(doc._id)}</div>
              <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                {summary(doc).map(([k, v]) => (
                  <div key={k} className="min-w-0 truncate">
                    <span className="text-subtle">{k}: </span>
                    <span className="font-mono text-fg/90">{v}</span>
                  </div>
                ))}
              </div>
            </button>
            <div className="flex shrink-0 gap-0.5">
              <button className="btn-icon" title={t("actions.edit")} aria-label={t("databases:mongo.editNamed", { id: idText(doc._id) })} onClick={() => setEditing({ id: JSON.stringify(doc._id), text })}>
                <Pencil className="size-4" aria-hidden />
              </button>
              <button className="btn-icon hover:text-danger" title={t("actions.delete")} aria-label={t("databases:mongo.deleteNamed", { id: idText(doc._id) })} onClick={() => remove(doc._id)}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {q.data && !docs.length && <p className="px-4 py-8 text-center text-sm text-muted">{t("databases:mongo.noDocs")}</p>}

      {q.data && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
          <span>
            <span className="font-mono text-fg">{docs.length ? `${skip + 1}–${skip + docs.length}` : "0"}</span>
            {q.data.total != null && (
              <>
                {" "}
                / <span className="font-mono">{fmtNumber(q.data.total)}</span>
              </>
            )}
            {t("databases:mongo.docs", { count: q.data.total ?? docs.length })}
          </span>
          <div className="flex gap-2">
            <button className="btn-icon border border-line md:size-8" aria-label={t("databases:explorer.prevPage")} disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - PAGE))}>
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button className="btn-icon border border-line md:size-8" aria-label={t("databases:explorer.nextPage")} disabled={docs.length < PAGE} onClick={() => setSkip((s) => s + PAGE)}>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {editing && (
        <DocEditor
          title={editing.id ? t("databases:mongo.editTitle", { name: collection }) : t("databases:mongo.newTitle", { name: collection })}
          initial={editing.text}
          onClose={() => setEditing(null)}
          onSave={async (text) => {
            if (editing.id) await call("mongo/replace", { db: database, collection, id: editing.id, doc: text });
            else await call("mongo/insert", { db: database, collection, doc: text });
            setEditing(null);
            q.refetch();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function DocEditor({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  let parseError: string | null = null;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) parseError = t("databases:mongo.notObject");
  } catch (e) {
    parseError = (e as Error).message;
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t("actions.cancel")}
          </button>
          <button className="btn" disabled={busy || !!parseError || text === initial} onClick={save}>
            {busy ? t("actions.saving") : t("actions.save")}
          </button>
        </>
      }
    >
      <textarea
        className="input min-h-[50vh] bg-canvas font-mono text-xs leading-5"
        aria-label={t("databases:mongo.docLabel")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={Math.min(30, text.split("\n").length + 2)}
      />
      <p className={`mt-2 text-xs ${parseError ? "text-warning" : "text-subtle"}`}>
        {parseError
          ? t("databases:mongo.jsonError", { error: parseError })
          : t("databases:mongo.extendedHint")}
      </p>
      <FormError message={error} />
    </Modal>
  );
}
