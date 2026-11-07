import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import type { DeploymentStatus, EnvVar } from "@panel/shared";
import { deployStatusStyle, duration, triggerLabel, useDeployment, useSettings } from "../lib/projects";
import { confirmDialog } from "../lib/dialog";
import { copy } from "../lib/ops";
import { toast } from "../lib/toast";
import { StatusBadge } from "./Status";
import { t } from "../i18n";

export function DeployBadge({ status }: { status: DeploymentStatus }) {
  const s = deployStatusStyle[status];
  return <StatusBadge tone={s.tone} shape={s.shape} label={s.label} />;
}

/** Deploy etiketi: ince çerçeveli rozet içinde işaret + durum + deploy numarası (listelerde) */
export function DeployPill({ status, id }: { status: DeploymentStatus; id?: number }) {
  const s = deployStatusStyle[status];
  const mark =
    s.shape === "spin" ? (
      <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
    ) : s.shape === "dot" ? (
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
    ) : (
      <span className="size-1.5 rounded-full ring-[1.5px] ring-current ring-inset" aria-hidden />
    );
  return (
    <span className={`badge tone-${s.tone} h-[22px] tracking-normal`}>
      {mark}
      {s.label}
      {id != null && <span className="font-mono tabular-nums">#{id}</span>}
    </span>
  );
}

export function CaddyBanner() {
  const { data } = useSettings();
  if (!data || data.caddy.reachable) return null;
  return (
    <div className="mb-6 notice notice-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-medium">{t("projects:caddy.unreachable")}</div>
        <div className="mt-0.5 text-warning/75">
          {t("projects:caddy.body", { error: data.caddy.error ?? "" })}
        </div>
      </div>
    </div>
  );
}

/** Ortam değişkeni düzenleyici: satır satır veya .env yapıştırarak */
export function EnvEditor({ value, onChange }: { value: EnvVar[]; onChange: (v: EnvVar[]) => void }) {
  const [reveal, setReveal] = useState(false);
  const [bulk, setBulk] = useState<string | null>(null);

  const set = (i: number, patch: Partial<EnvVar>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const dupes = new Set(value.map((e) => e.key).filter((k, i, a) => k && a.indexOf(k) !== i));

  function applyBulk() {
    const parsed = parseDotenv(bulk ?? "");
    const map = new Map(value.filter((e) => e.key).map((e) => [e.key, e.value]));
    for (const e of parsed) map.set(e.key, e.value);
    onChange([...map].map(([key, v]) => ({ key, value: v })));
    setBulk(null);
  }

  if (bulk !== null) {
    return (
      <div className="space-y-2">
        <textarea
          className="input h-48 font-mono text-xs"
          placeholder={t("projects:envEditor.bulkPlaceholder")}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={applyBulk}>
            {t("projects:envEditor.addBulk", { count: parseDotenv(bulk).length })}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setBulk(null)}>
            {t("actions.cancel")}
          </button>
        </div>
        <p className="text-xs text-subtle">{t("projects:envEditor.bulkHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {value.map((e, i) => (
        <div key={i} className="flex gap-2">
          <input
            className={`input w-2/5 font-mono text-xs ${dupes.has(e.key) ? "border-danger" : ""}`}
            placeholder={t("projects:envEditor.keyPlaceholder")}
            aria-label={t("projects:envEditor.keyLabel")}
            aria-invalid={dupes.has(e.key) || undefined}
            spellCheck={false}
            autoCapitalize="off"
            value={e.key}
            onChange={(ev) => set(i, { key: ev.target.value.trim() })}
          />
          <input
            className="input flex-1 font-mono text-xs"
            placeholder={t("projects:envEditor.valuePlaceholder")}
            aria-label={e.key ? t("projects:envEditor.valueLabelNamed", { key: e.key }) : t("projects:envEditor.valueLabel")}
            type={reveal ? "text" : "password"}
            autoComplete="off"
            value={e.value}
            onChange={(ev) => set(i, { value: ev.target.value })}
          />
          <button type="button" className="btn-icon" onClick={() => onChange(value.filter((_, j) => j !== i))} title={t("projects:remove")} aria-label={e.key ? t("projects:envEditor.removeNamed", { key: e.key }) : t("projects:envEditor.removeVar")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      {value.length === 0 && <p className="text-sm text-subtle">{t("projects:envEditor.empty")}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-secondary btn-sm max-md:min-h-11" onClick={() => onChange([...value, { key: "", value: "" }])}>
          <Plus className="size-4" aria-hidden /> {t("projects:envEditor.add")}
        </button>
        <button type="button" className="btn-ghost btn-sm max-md:min-h-11" onClick={() => setBulk("")}>
          {t("projects:envEditor.paste")}
        </button>
        {value.length > 0 && (
          <button type="button" className="btn-ghost btn-sm ml-auto max-md:min-h-11" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {reveal ? t("actions.hide") : t("actions.show")}
          </button>
        )}
      </div>
      {dupes.size > 0 && <p className="text-xs text-danger">{t("projects:envEditor.dupes", { keys: [...dupes].join(", ") })}</p>}
    </div>
  );
}

export function parseDotenv(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out.push({ key: m[1]!, value: v });
  }
  return out;
}

/** Deploy logu (devam ediyorsa canlı yoklanır) */
export function DeploymentLog({ id }: { id: number }) {
  const { data } = useDeployment(id);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [data?.log]);

  if (!data) return <div className="skeleton h-72" aria-busy="true" aria-label={t("projects:buildLog.loading")} />;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="card-head bg-raised">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="cap">{t("projects:buildLog.title", { id: data.id })}</span>
          <DeployPill status={data.status} />
          <span className="min-w-0 truncate text-xs text-muted max-sm:hidden" title={data.image}>
            {triggerLabel[data.trigger]}
            {data.image && <span className="font-mono"> · {data.image}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-muted tabular-nums">{duration(data.startedAt, data.finishedAt)}</span>
          <button
            type="button"
            className="btn-ghost btn-sm max-md:min-h-11"
            disabled={!data.log}
            onClick={() => {
              copy(data.log);
              toast(t("projects:buildLog.copied"));
            }}
          >
            <Copy className="size-4" aria-hidden /> {t("actions.copy")}
          </button>
        </div>
      </div>
      {data.error && <div className="border-b border-danger/25 bg-danger/[0.06] px-4 py-2 text-sm text-danger sm:px-5">{data.error}</div>}
      <pre ref={ref} className="max-h-[360px] overflow-auto px-4 py-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-meter sm:max-h-[460px]">
        {data.log || t("projects:buildLog.queued")}
      </pre>
    </div>
  );
}

export function DangerButton({ label, confirmText, onConfirm }: { label: string; confirmText: string; onConfirm: () => void }) {
  return (
    <button
      type="button"
      className="btn-danger"
      onClick={async () => {
        const ok = await confirmDialog({ title: t("projects:danger.confirmTitle", { name: confirmText }), message: t("projects:danger.irreversible"), confirmLabel: label, danger: true, typeToConfirm: confirmText });
        if (ok) onConfirm();
      }}
    >
      <Trash2 className="size-4" /> {label}
    </button>
  );
}
