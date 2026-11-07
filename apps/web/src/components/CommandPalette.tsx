import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Database, FolderGit2, Rocket, ScrollText, Search, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useDatabases } from "../lib/ops";
import { useProjects } from "../lib/projects";
import { useOverlay } from "../lib/overlay";
import { showError } from "../lib/dialog";
import { toast } from "../lib/toast";
import { navItems } from "./Layout";
import { t } from "../i18n";

type Group = "pages" | "projects" | "actions" | "databases";

interface Cmd {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void | Promise<void>;
}

const norm = (s: string) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** Kısayolla açılan komut paleti: Ctrl/⌘ + K */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("palette:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("palette:open", onOpen);
    };
  }, []);
  return { open, setOpen };
}

/** Sayfalardaki "Ara" düğmeleri paleti açar */
export const openCommandPalette = () => window.dispatchEvent(new Event("palette:open"));

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: projects } = useProjects();
  const { data: dbs } = useDatabases();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useOverlay(box, onClose, { initialFocus: input });

  const go = (to: string) => () => navigate(to);
  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = navItems.map((n) => ({ id: `nav-${n.to}`, group: "pages", label: n.label, icon: n.icon, keywords: n.label, run: go(n.to) }));
    for (const p of projects ?? []) {
      if (p.preview) continue;
      const kw = `${p.name} ${p.domains.map((d) => d.hostname).join(" ")}`;
      out.push(
        { id: `p-${p.id}`, group: "projects", label: p.name, hint: p.domains[0]?.hostname, icon: FolderGit2, keywords: kw, run: go(`/projects/${p.id}`) },
        {
          id: `p-${p.id}-deploy`,
          group: "actions",
          label: t("palette.deploy", { name: p.name }),
          icon: Rocket,
          keywords: `${kw} ${t("palette.keywords.deploy")}`,
          run: async () => {
            try {
              const r = await api.post<{ deploymentId: number }>(`/api/projects/${p.id}/deploy`);
              void qc.invalidateQueries({ queryKey: ["projects"] });
              toast(t("palette.deployStarted", { name: p.name }), "info");
              navigate(`/projects/${p.id}?tab=deploys&deploy=${r.deploymentId}`);
            } catch (err) {
              void showError(err, t("palette.deployFailed"));
            }
          },
        },
        { id: `p-${p.id}-logs`, group: "actions", label: t("palette.logs", { name: p.name }), icon: ScrollText, keywords: `${kw} ${t("palette.keywords.logs")}`, run: go(`/projects/${p.id}?tab=logs`) },
        { id: `p-${p.id}-env`, group: "actions", label: t("palette.env", { name: p.name }), icon: SlidersHorizontal, keywords: `${kw} ${t("palette.keywords.env")}`, run: go(`/projects/${p.id}?tab=env`) },
      );
    }
    for (const d of dbs ?? []) {
      out.push({ id: `db-${d.id}`, group: "databases", label: d.name, hint: d.engine, icon: Database, keywords: `${d.name} ${d.engine} ${t("palette.keywords.database")}`, run: go("/databases") });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, dbs]);

  const results = useMemo(() => {
    const query = norm(q.trim());
    if (!query) return cmds.filter((c) => c.group !== "actions").slice(0, 30);
    const words = query.split(/\s+/);
    return cmds.filter((c) => words.every((w) => norm(`${c.label} ${c.keywords}`).includes(w))).slice(0, 40);
  }, [cmds, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function run(c: Cmd | undefined) {
    if (!c) return;
    onClose();
    void c.run();
  }

  let lastGroup: Group | "" = "";
  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center px-3 pt-[12vh]">
      <div className="anim-fade absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={box} role="dialog" aria-modal="true" aria-label={t("palette.title")} className="anim-pop relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden />
          <input
            ref={input}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle sm:text-sm"
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.searchLabel")}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              }
            }}
          />
          <kbd className="kbd hidden sm:inline">Esc</kbd>
        </div>
        <ul ref={list} id="cmd-list" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-subtle">{t(`palette.groups.${head}`)}</div>}
                <div
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm md:min-h-9 ${i === active ? "bg-hover text-fg" : "text-muted"}`}
                >
                  <Icon className={`size-4 shrink-0 ${i === active ? "text-accent" : "text-subtle"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="truncate font-mono text-xs text-subtle">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-subtle" aria-hidden />}
                </div>
              </li>
            );
          })}
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-subtle">{t("palette.noMatch", { q })}</li>}
        </ul>
        <div className="hidden items-center gap-3 border-t border-line px-3 py-2 text-xs text-subtle sm:flex">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> {t("palette.select")}
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> {t("palette.run")}
          </span>
          <span className="ml-auto">{t("palette.tip")}</span>
        </div>
      </div>
    </div>
  );
}
