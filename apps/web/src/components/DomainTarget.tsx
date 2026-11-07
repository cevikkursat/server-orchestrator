import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, X } from "lucide-react";
import type { DomainEntry, DomainTarget, ProjectDetail } from "@panel/shared";
import { api } from "../lib/api";
import { useProjects } from "../lib/projects";
import { FormError } from "./AuthCard";
import { t } from "../i18n";

type Rule = DomainTarget["rules"][number];

/** Domain hedefinin kısa özeti: "port 3001 · /api → uygulama-api:3000" */
export function TargetSummary({ d, p }: { d: DomainEntry; p: ProjectDetail }) {
  const { data: projects } = useProjects();
  const tg = d.target;
  if (!tg) return null;
  const name = (id: number | null) => (id == null ? p.name : (projects?.find((x) => x.id === id)?.name ?? `#${id}`));
  const port = (r: Rule) => r.port ?? (r.projectId == null ? (tg.port ?? p.port) : (projects?.find((x) => x.id === r.projectId)?.port ?? "?"));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-subtle">
      <span>
        <ArrowRight className="mr-1 inline size-3" />
        {p.name}:{tg.port ?? p.port}
      </span>
      {tg.rules.map((r) => (
        <span key={r.prefix}>
          {r.prefix}/* → {name(r.projectId)}:{port(r)}
          {r.strip ? t("domains:target.stripSuffix") : ""}
        </span>
      ))}
    </div>
  );
}

export function DomainTargetForm({ d, p, onDone, onResult }: { d: DomainEntry; p: ProjectDetail; onDone: () => void; onResult: (w: string | null) => void }) {
  const qc = useQueryClient();
  const { data: projects } = useProjects();
  const [port, setPort] = useState<string>(d.target?.port ? String(d.target.port) : "");
  const [rules, setRules] = useState<Rule[]>(d.target?.rules ?? []);
  const [error, setError] = useState<string | null>(null);
  const others = (projects ?? []).filter((x) => x.id !== p.id && !x.preview);
  const set = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    try {
      const target: DomainTarget = { port: port ? Number(port) : null, rules };
      const r = await api.put<{ warning: string | null }>(`/api/projects/${p.id}/domains/${d.id}/target`, { target });
      onResult(r.warning);
      await qc.invalidateQueries({ queryKey: ["project", p.id] });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-line bg-canvas p-3">
      <div>
        <div className="label" id="dt-port">{t("domains:target.defaultPort")}</div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-subtle">{p.name}:</span>
          <input aria-labelledby="dt-port" className="input w-28 font-mono text-xs" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} placeholder={String(p.port)} />
          <span className="text-xs text-subtle">{t("domains:target.defaultPortHint", { port: p.port })}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="label">{t("domains:target.routing")}</div>
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
            <input className="input w-28 font-mono text-xs" value={r.prefix} onChange={(e) => set(i, { prefix: e.target.value.trim() })} placeholder="/api" />
            <span className="text-xs text-subtle">/* →</span>
            <select
              className="input w-auto font-mono text-xs"
              value={r.projectId ?? ""}
              onChange={(e) => set(i, { projectId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{t("domains:target.thisProject", { name: p.name })}</option>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <input
              className="input w-24 font-mono text-xs"
              type="number"
              min={1}
              max={65535}
              value={r.port ?? ""}
              onChange={(e) => set(i, { port: e.target.value ? Number(e.target.value) : null })}
              placeholder={String(r.projectId == null ? p.port : (others.find((x) => x.id === r.projectId)?.port ?? ""))}
            />
            <label className="flex items-center gap-1 text-xs text-muted" title={t("domains:target.stripTitle")}>
              <input type="checkbox" className="accent-zinc-300" checked={r.strip} onChange={(e) => set(i, { strip: e.target.checked })} />
              {t("domains:target.strip")}
            </label>
            <button type="button" className="btn-ghost ml-auto px-2" title={t("domains:target.remove")} onClick={() => setRules(rules.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary py-1.5" onClick={() => setRules([...rules, { prefix: "/api", projectId: null, port: null, strip: false }])}>
          <Plus className="size-4" /> {t("domains:target.addRule")}
        </button>
        <p className="text-xs text-subtle">
          {t("domains:target.exampleBefore")}
          <span className="font-mono">/api</span>
          {t("domains:target.exampleAfter")}
        </p>
      </div>

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
