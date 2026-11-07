import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Layers, Pencil, Plus, Rocket, Trash2, X } from "lucide-react";
import type { EnvGroup, EnvVar } from "@panel/shared";
import { api } from "../lib/api";
import { timeAgo } from "../lib/projects";
import { FormError } from "../components/AuthCard";
import { EnvEditor } from "../components/ProjectUi";
import { EmptyState, ErrorNotice, PageHeader, SkeletonRows } from "../components/Status";
import { confirmDialog } from "../lib/dialog";
import { t } from "../i18n";

export function EnvGroupsPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ["env-groups"], queryFn: () => api.get<EnvGroup[]>("/api/env-groups") });
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5 [&>*]:w-full [&>*]:max-w-[960px]">
      <PageHeader
        title={t("nav.envGroups")}
        flush
        description={
          <>
            {t("envGroups:page.descriptionBefore")}
            <b className="font-semibold text-fg">{t("envGroups:page.descriptionTab")}</b>
            {t("envGroups:page.descriptionAfter")}
          </>
        }
        actions={
          !creating && (
            <button className="btn max-sm:flex-1" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> {t("envGroups:page.newGroup")}
            </button>
          )
        }
      />

      {error && <ErrorNotice error={error} />}
      {isLoading && <SkeletonRows rows={2} className="h-48" />}
      {creating && <GroupCard onDone={() => setCreating(false)} />}
      {data?.length === 0 && !creating && (
        <EmptyState icon={<Layers className="size-5" aria-hidden />} title={t("envGroups:page.emptyTitle")}>
          {t("envGroups:page.emptyBody")}
        </EmptyState>
      )}
      {data?.map((g) => <GroupCard key={g.id} group={g} />)}
    </div>
  );
}

function GroupCard({ group, onDone }: { group?: EnvGroup; onDone?: () => void }) {
  const qc = useQueryClient();
  const ids = { title: useId(), name: useId() };
  const [name, setName] = useState(group?.name ?? "");
  const [env, setEnv] = useState<EnvVar[]>(group?.env ?? [{ key: "", value: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Var olan grup önce okunur biçimde gösterilir; yeni grup doğrudan düzenlemede açılır
  const [editing, setEditing] = useState(!group);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (group) {
      setName(group.name);
      setEnv(group.env);
    }
  }, [group?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const clean = env.filter((e) => e.key);
  const dirty = !group || name !== group.name || JSON.stringify(clean) !== JSON.stringify(group.env);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["env-groups"] }), qc.invalidateQueries({ queryKey: ["project"] })]);

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (group) {
        const r = await api.put<{ projects: number[] }>(`/api/env-groups/${group.id}`, { name: name.trim(), env: clean });
        setMsg(r.projects.length ? t("envGroups:card.savedRedeploy") : t("envGroups:card.saved"));
        setEditing(false);
      } else {
        await api.post("/api/env-groups", { name: name.trim(), env: clean });
        onDone?.();
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!group) return onDone?.();
    setName(group.name);
    setEnv(group.env);
    setError(null);
    setEditing(false);
  }

  async function redeploy() {
    if (!group) return;
    const ok = await confirmDialog({
      title: t("envGroups:card.redeployConfirm.title"),
      message: group.projects.map((p) => p.name).join(", "),
      confirmLabel: t("envGroups:card.redeployConfirm.confirm"),
    });
    if (!ok) return;
    const r = await api.post<{ deployments: number[] }>(`/api/env-groups/${group.id}/redeploy`);
    setMsg(t("envGroups:card.redeployStarted", { count: r.deployments.length }));
    qc.invalidateQueries({ queryKey: ["deployments"] });
  }

  async function remove() {
    if (!group) return onDone?.();
    const ok = await confirmDialog({
      title: t("envGroups:card.removeConfirm.title", { name: group.name }),
      message: group.projects.length
        ? t("envGroups:card.removeConfirm.message", { projects: group.projects.map((p) => p.name).join(", ") })
        : undefined,
      confirmLabel: t("actions.delete"),
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/env-groups/${group.id}`);
    await refresh();
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby={ids.title}>
      <div className="card-head flex-wrap">
        {group ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={ids.title} className="truncate font-mono text-[15px] font-semibold text-fg">
              {group.name}
            </h2>
            <span className="text-xs text-muted">
              <span className="font-mono text-fg">{group.env.length}</span>
              {t("envGroups:card.vars", { count: group.env.length, ago: timeAgo(group.updatedAt) })}
            </span>
          </div>
        ) : (
          <h2 id={ids.title} className="cap">
            {t("envGroups:page.newGroup")}
          </h2>
        )}
        <div className="ml-auto flex items-center gap-1">
          {group && !editing && (
            <>
              <button className="btn-ghost btn-sm max-sm:min-h-11" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
                {reveal ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />} {reveal ? t("actions.hide") : t("actions.show")}
              </button>
              <button className="btn-secondary btn-sm max-sm:min-h-11" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" aria-hidden /> {t("actions.edit")}
              </button>
            </>
          )}
          {group ? (
            <button className="btn-icon border border-line md:size-8" title={t("envGroups:card.removeGroup")} aria-label={t("envGroups:card.removeNamed", { name: group.name })} onClick={remove}>
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          ) : (
            <button className="btn-icon border border-line md:size-8" title={t("actions.cancel")} aria-label={t("envGroups:card.closeNew")} onClick={remove}>
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="max-w-xs">
            <label className="label" htmlFor={ids.name}>
              {t("envGroups:card.name")}
            </label>
            <input id={ids.name} className="input font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="smtp" spellCheck={false} autoCapitalize="off" />
          </div>
          <div>
            <div className="label">{t("envGroups:card.variables")}</div>
            <EnvEditor value={env} onChange={setEnv} />
          </div>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <button className="btn max-sm:flex-1" disabled={busy || !dirty || !name.trim()} onClick={save}>
              {group ? t("actions.save") : t("envGroups:card.create")}
            </button>
            <button className="btn-ghost max-sm:flex-1 max-sm:justify-center" onClick={cancel}>
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      ) : (
        group && (
          <>
            {group.env.length ? (
              <dl className="py-1.5">
                {group.env.map((e) => (
                  <div key={e.key} className="grid gap-x-6 gap-y-0.5 px-4 py-1.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:px-5">
                    <dt className="truncate font-mono text-xs font-medium text-fg" title={e.key}>
                      {e.key}
                    </dt>
                    <dd className={`min-w-0 font-mono text-xs break-all ${reveal ? "text-fg/85" : "tracking-[0.2em] text-subtle"}`}>
                      {reveal ? e.value || <span className="text-faint italic tracking-normal">{t("envGroups:card.empty")}</span> : "••••••••••••"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-4 py-4 text-sm text-muted sm:px-5">{t("envGroups:card.noVars")}</p>
            )}
          </>
        )
      )}

      {group && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
          <span className="cap">{t("envGroups:card.usedBy")}</span>
          {group.projects.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {group.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}?tab=env`}
                    className="inline-flex min-h-7 items-center rounded-full border border-line-strong px-2.5 text-xs font-medium text-fg transition-colors duration-150 hover:border-accent/60"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted">
              {t("envGroups:card.unusedBefore")}
              <b className="font-semibold text-fg">{t("envGroups:card.unusedTab")}</b>
              {t("envGroups:card.unusedAfter")}
            </span>
          )}
          {group.projects.length > 0 && (
            <button className="btn-secondary btn-sm max-sm:min-h-11 max-sm:w-full sm:ml-auto" disabled={busy || dirty} onClick={redeploy}>
              <Rocket className="size-3.5" aria-hidden /> {t("envGroups:card.redeploy")}
            </button>
          )}
          {msg && (
            <p className="basis-full text-xs text-success" role="status">
              {msg}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
