import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { RedisOp, RedisScanResult, RedisValue } from "@panel/shared";
import { formatTtl, useExplorer } from "../../lib/explorer";
import { confirmDialog, showError } from "../../lib/dialog";
import { FormError } from "../AuthCard";
import { Modal } from "../Modal";
import { t } from "../../i18n";

/** Anahtar türü: renk yerine sabit genişlikte yazı (tek vurgu rengi kuralı) */
const TypeTag = ({ type }: { type: string }) => <span className="badge tone-neutral w-14 justify-center font-mono tracking-normal">{type}</span>;

export function RedisView({ dbId, db, onChanged }: { dbId: number; db: number; onChanged: () => void }) {
  const { call } = useExplorer(dbId);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<RedisScanResult["keys"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function scan(reset: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await call<RedisScanResult>("redis/scan", { db, pattern: pattern || "*", cursor: reset ? "0" : cursor });
      setKeys((k) => (reset ? r.keys : [...k, ...r.keys.filter((x) => !k.some((y) => y.key === x.key))]));
      setCursor(r.cursor === "0" ? null : r.cursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void scan(true);
  }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = () => {
    void scan(true);
    onChanged();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="min-w-0 self-start overflow-hidden rounded-lg border border-line bg-raised">
        <form
          className="flex gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void scan(true);
          }}
        >
          <input className="input font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label={t("databases:redis.pattern")} placeholder={t("databases:redis.patternPlaceholder")} spellCheck={false} />
          <button className="btn-icon shrink-0 border border-line-strong" disabled={busy} title={t("databases:explorer.search")} aria-label={t("databases:explorer.search")}>
            <Search className="size-4" aria-hidden />
          </button>
          <button type="button" className="btn-icon shrink-0 border border-line-strong" title={t("databases:redis.newKey")} aria-label={t("databases:redis.newKey")} onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
          </button>
        </form>
        {error && (
          <div className="px-3 pt-3">
            <FormError message={error} />
          </div>
        )}
        <div className="max-h-[65vh] overflow-y-auto">
          {keys.map((k) => (
            <button
              key={k.key}
              onClick={() => setSelected(k.key)}
              aria-current={selected === k.key ? "true" : undefined}
              className={`relative flex min-h-11 w-full items-center gap-2.5 border-b border-line-soft px-3 py-2 text-left text-xs transition-colors duration-150 last:border-0 md:min-h-9 ${
                selected === k.key ? "bg-fg/[0.04] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent" : "hover:bg-fg/[0.02]"
              }`}
            >
              <TypeTag type={k.type} />
              <span className="min-w-0 flex-1 truncate font-mono text-fg">{k.key}</span>
              {k.ttlMs >= 0 && <span className="shrink-0 font-mono text-subtle">{formatTtl(k.ttlMs)}</span>}
            </button>
          ))}
          {!keys.length && !busy && <p className="p-6 text-center text-sm text-muted">{t("databases:redis.noKeys")}</p>}
        </div>
        <div className="flex min-h-12 items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <span>
            <span className="font-mono text-fg">{keys.length}</span>
            {t("databases:redis.shown", { count: keys.length })}
          </span>
          {cursor && (
            <button className="btn-secondary btn-sm max-sm:min-h-11" disabled={busy} onClick={() => scan(false)}>
              {t("databases:redis.loadMore")}
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        {selected ? (
          <KeyPanel
            key={selected}
            dbId={dbId}
            db={db}
            keyName={selected}
            onDeleted={() => {
              setSelected(null);
              refreshAll();
            }}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{t("databases:redis.pickKey")}</p>
        )}
      </div>
      {creating && (
        <CreateKey
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            await call("redis/create", { db, ...body });
            setCreating(false);
            setSelected(body.key);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

type EditState = { title: string; fields: { name: string; label: string; value: string; multiline?: boolean; number?: boolean }[]; build: (v: Record<string, string>) => RedisOp };

function KeyPanel({ dbId, db, keyName, onDeleted }: { dbId: number; db: number; keyName: string; onDeleted: () => void }) {
  const { call } = useExplorer(dbId);
  const q = useQuery({ queryKey: ["explorer-redis", dbId, db, keyName], queryFn: () => call<RedisValue>("redis/get", { db, key: keyName }), retry: false });
  const [edit, setEdit] = useState<EditState | null>(null);
  const v = q.data;

  async function op(change: RedisOp, confirm?: string) {
    if (confirm && !(await confirmDialog({ title: confirm, message: keyName, confirmLabel: t("states.yes"), danger: true }))) return;
    try {
      await call("redis/edit", { db, key: keyName, change });
      if (change.op === "del") onDeleted();
      else q.refetch();
    } catch (err) {
      void showError(err);
    }
  }

  if (q.error) return <FormError message={(q.error as Error).message} />;
  if (!v) return <div className="skeleton h-40" aria-busy="true" aria-label={t("states.loading")} />;

  const pairs = Array.isArray(v.value) && Array.isArray(v.value[0]) ? (v.value as [string, string][]) : null;
  const items = Array.isArray(v.value) && !pairs ? (v.value as string[]) : null;
  const ro = v.type === "stream";

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="font-mono text-sm break-all text-fg">{v.key}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <TypeTag type={v.type} />
              <span>
                <span className="font-mono text-fg">{v.length}</span>
                {v.type === "string" ? t("databases:redis.chars", { count: v.length }) : t("databases:redis.items", { count: v.length })}
              </span>
              <span>
                {t("databases:redis.ttlPrefix")}
                <span className="font-mono">{formatTtl(v.ttlMs)}</span>
              </span>
              {v.truncated && <span>{t("databases:redis.partial")}</span>}
            </div>
          </div>
          <div className="flex gap-0.5">
            <button className="btn-icon" title={t("actions.refresh")} aria-label={t("actions.refresh")} onClick={() => q.refetch()}>
              <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
            </button>
            <button
              className="btn-icon"
              title={t("databases:redis.ttl")}
              aria-label={t("databases:redis.ttl")}
              onClick={() =>
                setEdit({
                  title: t("databases:redis.ttlEditTitle"),
                  fields: [{ name: "s", label: t("databases:redis.seconds"), value: v.ttlMs > 0 ? String(Math.round(v.ttlMs / 1000)) : "", number: true }],
                  build: (f) => ({ op: "expire", seconds: f.s ? Number(f.s) : null }),
                })
              }
            >
              <Clock className="size-4" aria-hidden />
            </button>
            <button className="btn-icon hover:text-danger" title={t("databases:redis.deleteKey")} aria-label={t("databases:redis.deleteKey")} onClick={() => op({ op: "del" }, t("databases:redis.deleteKeyConfirm"))}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
      </div>

      {v.type === "string" && <StringEditor value={v.value as string} disabled={v.truncated} onSave={(value) => op({ op: "set", value })} />}

      {(pairs || items) && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-line text-left text-[11px] tracking-[0.14em] text-faint uppercase">
              <tr>
                <th className="px-4 py-2 font-semibold">{v.type === "hash" ? t("databases:redis.field") : v.type === "zset" ? t("databases:redis.member") : v.type === "stream" ? t("databases:redis.id") : v.type === "list" ? "#" : t("databases:redis.member")}</th>
                {(pairs || v.type === "list") && <th className="px-3 py-2 font-semibold">{v.type === "zset" ? t("databases:redis.score") : v.type === "stream" ? t("databases:redis.fields") : t("databases:explorer.value")}</th>}
                {!ro && <th className="w-20" />}
              </tr>
            </thead>
            <tbody className="font-mono">
              {pairs?.map(([a, b], i) => (
                <tr key={`${a}-${i}`} className="border-b border-line-soft last:border-b-0 hover:bg-fg/[0.02]">
                  <td className="max-w-xs px-4 py-2 break-all text-fg">{a}</td>
                  <td className="max-w-md px-3 py-2 break-all text-fg/90">{b}</td>
                  {!ro && (
                    <td className="px-2 text-right">
                      <RowActions
                        onEdit={() =>
                          setEdit(
                            v.type === "hash"
                              ? { title: t("databases:redis.fieldTitle", { name: a }), fields: [{ name: "v", label: t("databases:explorer.value"), value: b, multiline: true }], build: (f) => ({ op: "hset", field: a, value: f.v! }) }
                              : { title: t("databases:redis.scoreTitle", { name: a }), fields: [{ name: "s", label: t("databases:redis.score"), value: b, number: true }], build: (f) => ({ op: "zadd", member: a, score: Number(f.s) }) },
                          )
                        }
                        onDelete={() => op(v.type === "hash" ? { op: "hdel", field: a } : { op: "zrem", member: a }, t("databases:redis.deleteItemConfirm"))}
                      />
                    </td>
                  )}
                </tr>
              ))}
              {items?.map((x, i) => (
                <tr key={`${x}-${i}`} className="border-b border-line-soft last:border-b-0 hover:bg-fg/[0.02]">
                  {v.type === "list" && <td className="w-12 px-4 py-2 text-subtle">{i}</td>}
                  <td className={`max-w-md py-2 break-all text-fg/90 ${v.type === "list" ? "px-3" : "px-4"}`}>{x}</td>
                  <td className="px-2 text-right">
                    <RowActions
                      onEdit={
                        v.type === "list"
                          ? () => setEdit({ title: t("databases:redis.itemTitle", { index: i }), fields: [{ name: "v", label: t("databases:explorer.value"), value: x, multiline: true }], build: (f) => ({ op: "lset", index: i, value: f.v! }) })
                          : undefined
                      }
                      onDelete={() => op(v.type === "list" ? { op: "lrem", value: x } : { op: "srem", value: x }, t("databases:redis.deleteItemConfirm"))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!ro && v.type !== "string" && (
        <div className="border-t border-line px-4 py-3">
        <button
          className="btn-secondary btn-sm max-sm:min-h-11"
          onClick={() =>
            setEdit(
              v.type === "hash"
                ? {
                    title: t("databases:redis.addField"),
                    fields: [{ name: "f", label: t("databases:redis.field"), value: "" }, { name: "v", label: t("databases:explorer.value"), value: "", multiline: true }],
                    build: (f) => ({ op: "hset", field: f.f!, value: f.v! }),
                  }
                : v.type === "zset"
                  ? {
                      title: t("databases:redis.addMember"),
                      fields: [{ name: "m", label: t("databases:redis.member"), value: "" }, { name: "s", label: t("databases:redis.score"), value: "0", number: true }],
                      build: (f) => ({ op: "zadd", member: f.m!, score: Number(f.s) }),
                    }
                  : { title: v.type === "list" ? t("databases:redis.append") : t("databases:redis.addMember"), fields: [{ name: "v", label: t("databases:explorer.value"), value: "", multiline: true }], build: (f) => (v.type === "list" ? { op: "rpush", value: f.v! } : { op: "sadd", value: f.v! }) },
            )
          }
        >
          <Plus className="size-3.5" aria-hidden /> {t("actions.add")}
        </button>
        </div>
      )}

      {edit && (
        <FieldsModal
          state={edit}
          onClose={() => setEdit(null)}
          onSubmit={async (vals) => {
            await call("redis/edit", { db, key: keyName, change: edit.build(vals) });
            setEdit(null);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  return (
    <span className="inline-flex gap-0.5">
      {onEdit && (
        <button className="btn-icon md:size-8" title={t("actions.edit")} aria-label={t("actions.edit")} onClick={onEdit}>
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
      <button className="btn-icon hover:text-danger md:size-8" title={t("actions.delete")} aria-label={t("actions.delete")} onClick={onDelete}>
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function StringEditor({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="space-y-2 p-4">
      <textarea className="input min-h-40 bg-canvas font-mono text-xs leading-5" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("databases:explorer.value")} disabled={disabled} spellCheck={false} />
      {disabled ? (
        <p className="text-xs text-subtle">{t("databases:redis.tooLarge")}</p>
      ) : (
        <button className="btn" disabled={text === value} onClick={() => onSave(text)}>
          {t("actions.save")}
        </button>
      )}
    </div>
  );
}

function FieldsModal({ state, onClose, onSubmit }: { state: EditState; onClose: () => void; onSubmit: (v: Record<string, string>) => Promise<void> }) {
  const [vals, setVals] = useState(() => Object.fromEntries(state.fields.map((f) => [f.name, f.value])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(vals);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={state.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t("actions.cancel")}
          </button>
          <button className="btn" disabled={busy} onClick={() => submit()}>
            {t("actions.save")}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        {state.fields.map((f) => (
          <div key={f.name}>
            <div className="label" aria-hidden>{f.label}</div>
            {f.multiline ? (
              <textarea className="input min-h-24 font-mono text-xs" aria-label={f.label} value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} spellCheck={false} />
            ) : (
              <input className="input font-mono text-xs" type={f.number ? "number" : "text"} step="any" aria-label={f.label} value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            )}
          </div>
        ))}
        <FormError message={error} />
      </form>
    </Modal>
  );
}

function CreateKey({ onClose, onCreate }: { onClose: () => void; onCreate: (b: { key: string; type: "string" | "hash" | "list" | "set" | "zset"; value: string; field: string; score: number }) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<"string" | "hash" | "list" | "set" | "zset">("string");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [score, setScore] = useState("0");
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try {
      await onCreate({ key, type, value, field, score: Number(score) || 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const valueLabel = type === "string" ? t("databases:explorer.value") : type === "hash" ? t("databases:redis.fieldValue") : t("databases:redis.firstItem");
  return (
    <Modal
      title={t("databases:redis.newKey")}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t("actions.cancel")}
          </button>
          <button className="btn" disabled={!key || (type === "hash" && !field)} onClick={submit}>
            {t("databases:explorer.create")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div>
            <label className="block">
              <span className="label">{t("databases:redis.key")}</span>
            <input className="input font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("databases:redis.key")} autoFocus />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="label">{t("databases:redis.type")}</span>
            <select className="input" aria-label={t("databases:redis.type")} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {["string", "hash", "list", "set", "zset"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            </label>
          </div>
        </div>
        {type === "hash" && (
          <div>
            <label className="block">
              <span className="label">{t("databases:redis.firstField")}</span>
            <input className="input font-mono text-xs" value={field} onChange={(e) => setField(e.target.value)} aria-label={t("databases:redis.firstField")} />
            </label>
          </div>
        )}
        {type === "zset" && (
          <div>
            <label className="block">
              <span className="label">{t("databases:redis.score")}</span>
            <input className="input" type="number" step="any" value={score} onChange={(e) => setScore(e.target.value)} aria-label={t("databases:redis.score")} />
            </label>
          </div>
        )}
        <div>
          <label className="block">
              <span className="label">{valueLabel}</span>
          <textarea className="input min-h-24 font-mono text-xs" value={value} onChange={(e) => setValue(e.target.value)} aria-label={valueLabel} spellCheck={false} />
            </label>
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
