import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Boxes,
  Database,
  Ellipsis,
  FolderGit2,
  Globe,
  Layers,
  LayoutDashboard,
  LogOut,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { markLoggedOut, useAuthStatus } from "../lib/auth";
import { useOverlay } from "../lib/overlay";
import { useNavMarks, useUpdater, type NavMark } from "../lib/status";
import { Brand, BrandMark } from "./Brand";
import { LanguageButton, LanguageRow } from "./LanguageSelect";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { t } from "../i18n";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

type NavKey = "overview" | "projects" | "domains" | "databases" | "envGroups" | "deploys" | "containers" | "backups" | "security" | "settings";
/** Etiket getter: her okumada seçili dilde */
const item = (to: string, key: NavKey, icon: LucideIcon, end?: boolean): NavItem => ({
  to,
  get label() {
    return t(`nav.${key}`);
  },
  icon,
  end,
});

/** Gruplar kenar çubuğunda ince çizgiyle ayrılır */
const groups: { items: NavItem[] }[] = [
  { items: [item("/", "overview", LayoutDashboard, true)] },
  {
    items: [
      item("/projects", "projects", FolderGit2),
      item("/domains", "domains", Globe),
      item("/databases", "databases", Database),
      item("/env-groups", "envGroups", Layers),
    ],
  },
  {
    items: [item("/deployments", "deploys", Rocket), item("/containers", "containers", Boxes), item("/backups", "backups", Archive)],
  },
  {
    items: [item("/security", "security", ShieldCheck), item("/settings", "settings", Settings)],
  },
];
const all = groups.flatMap((g) => g.items);
/** Komut paleti de bu listeyi kullanır */
export const navItems = all;

/** Telefonda alt çubukta duran ana bölümler; gerisi "Diğer" sayfasında */
const primaryMobile = ["/", "/projects", "/databases", "/deployments"];
const mobileMain = primaryMobile.map((to) => all.find((i) => i.to === to)!);
const mobileMore = all.filter((i) => !primaryMobile.includes(i.to));

const isActive = (item: NavItem, pathname: string) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`));

/** Bölümdeki bekleyen işin noktası: dolu yeşil = yolunda, amber halka = bakılmalı, mercan = acil */
function MarkDot({ level }: { level?: NavMark["level"] }) {
  if (!level) return null;
  const cls = level === "danger" ? "dot dot-urgent-solid" : level === "warning" ? "dot dot-look" : "dot dot-ok";
  const label = level === "danger" ? t("marks.urgent") : level === "warning" ? t("marks.look") : t("marks.ok");
  return <span className={cls} role="img" aria-label={label} title={label} />;
}

export function Layout() {
  const qc = useQueryClient();
  const { data } = useAuthStatus();
  const { pathname, hash } = useLocation();
  // #bakim, #bildirimler gibi bağlantılar: hedef veri yüklenince görünür; 3 sn'ye kadar bekleyip kaydır
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 30) window.clearInterval(timer);
      el?.scrollIntoView({ block: "start" });
    }, 100);
    return () => window.clearInterval(timer);
  }, [pathname, hash]);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);
  const palette = useCommandPalette();
  const marks = useNavMarks();
  const { data: updater } = useUpdater();

  async function logout() {
    // Sunucuya ulaşılamasa bile arayüzden çık (çerez sunucuda zaten geçersiz olacak)
    await api.post("/api/auth/logout").catch(() => {});
    markLoggedOut(qc);
  }

  const moreActive = mobileMore.some((i) => isActive(i, pathname));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Masaüstü: kenar çubuğu (ray) */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-raised px-4 pt-5 pb-4 md:flex">
        <div className="mb-3 border-b border-line px-2 pb-5">
          <Brand />
        </div>
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="mb-2 flex h-9 w-full items-center gap-2 rounded-md border border-line px-2.5 text-sm text-subtle transition-colors duration-150 hover:border-line-strong hover:text-muted"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 truncate text-left">{t("nav.search")}</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>
        <nav className="-mx-1 flex flex-1 flex-col overflow-y-auto px-1 py-1" aria-label={t("nav.main")}>
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-px">
              {gi > 1 && <div className="mx-2.5 my-2 h-px bg-line" aria-hidden />}
              {g.items.map(({ to, label, end }) => {
                const m = marks[to];
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `relative flex h-9 items-center justify-between gap-2 rounded-md pr-2.5 pl-3.5 text-sm transition-colors duration-150 ${
                        isActive
                          ? "bg-accent/[0.07] font-semibold text-fg before:absolute before:inset-y-[9px] before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                          : "font-medium text-muted hover:bg-fg/[0.03] hover:text-fg"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className="truncate">{label}</span>
                        <span className="flex items-center gap-2">
                          <MarkDot level={m?.level} />
                          {m?.count && <span className={`font-mono text-xs tabular-nums ${isActive ? "text-accent" : "text-faint"}`}>{m.count}</span>}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-2 flex flex-col gap-1 border-t border-line px-2 pt-3.5 text-xs text-muted">
          <span className="flex items-center gap-2 text-fg">
            <span className="dot dot-ok" aria-hidden />
            {t("nav.panelRunning")}
          </span>
          {updater?.current && (
            <span className="truncate" title={updater.current.message}>
              {t("nav.version")} <span className="font-mono">{updater.current.sha.slice(0, 7)}</span>
              {updater.pending.length > 0 && ` · ${t("nav.updateAvailable")}`}
            </span>
          )}
          <div className="mt-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate">{data?.user?.username}</div>
            <LanguageButton placement="up" />
            <button onClick={logout} className="btn-icon -mr-2" aria-label={t("nav.logout")} title={t("nav.logout")}>
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Telefon: üst çubuk */}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-raised/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <BrandMark size={28} />
        <span className="ml-2.5 min-w-0 flex-1 truncate text-base font-bold tracking-tight">{t("appName")}</span>
        <button type="button" className="btn-icon -mr-2" onClick={() => palette.setOpen(true)} aria-label={t("nav.searchOrRun")}>
          <Search className="size-5" />
        </button>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 md:px-8 md:pt-6 md:pb-10">
          <Outlet />
        </main>
      </div>
      {palette.open && <CommandPalette onClose={() => palette.setOpen(false)} />}

      {/* Telefon: alt sekme çubuğu */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label={t("nav.main")}
      >
        <div className="grid h-16 grid-cols-5">
          {mobileMain.map((item) => (
            <TabLink key={item.to} item={item} active={isActive(item, pathname)} mark={marks[item.to]?.level === "ok" ? undefined : marks[item.to]?.level} />
          ))}
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-expanded={more}
            aria-haspopup="dialog"
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${moreActive ? "text-fg" : "text-subtle"}`}
          >
            <span className="relative">
              <Ellipsis className={`size-5 ${moreActive ? "text-accent" : ""}`} aria-hidden />
              <span className="absolute -top-0.5 left-[calc(100%+1px)]">
                <MarkDot level={worstOf(mobileMore.map((i) => marks[i.to]?.level))} />
              </span>
            </span>
            {t("nav.more")}
          </button>
        </div>
      </nav>

      {/* Telefon: "Diğer" alt sayfası */}
      {more && <MoreSheet onClose={() => setMore(false)} pathname={pathname} user={data?.user?.username} onLogout={logout} />}
    </div>
  );
}

function worstOf(levels: (NavMark["level"] | undefined)[]): NavMark["level"] | undefined {
  if (levels.includes("danger")) return "danger";
  if (levels.includes("warning")) return "warning";
  return undefined;
}

function MoreSheet({ onClose, pathname, user, onLogout }: { onClose: () => void; pathname: string; user?: string; onLogout: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(ref, onClose);
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="anim-fade absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.moreSections")}
        className="anim-sheet absolute inset-x-0 bottom-0 rounded-t-xl border-t border-line bg-raised pb-[calc(0.75rem+env(safe-area-inset-bottom))] outline-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-zinc-700" aria-hidden />
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <span className="text-sm font-semibold">{t("nav.moreSections")}</span>
          <button className="btn-icon" onClick={onClose} aria-label={t("actions.close")}>
            <X className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 px-3">
          {mobileMore.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(`${to}/`);
            return (
              <NavLink
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3.5 text-center text-xs font-medium transition-colors ${
                  active ? "border-accent/40 bg-accent/10 text-fg" : "border-line bg-surface text-muted active:bg-hover"
                }`}
              >
                <Icon className={`size-5 ${active ? "text-accent" : ""}`} aria-hidden />
                {label}
              </NavLink>
            );
          })}
        </div>
        <LanguageRow className="mx-3 mt-3" />
        <div className="mx-3 mt-3 flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-muted uppercase">{user?.slice(0, 1)}</div>
          <div className="min-w-0 flex-1 truncate text-sm">{user}</div>
          <button onClick={onLogout} className="btn-ghost text-danger hover:text-danger">
            <LogOut className="size-4" aria-hidden /> {t("nav.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabLink({ item, active, mark }: { item: NavItem; active: boolean; mark?: NavMark["level"] }) {
  const Icon = item.icon;
  const short: Record<string, string> = { "/": t("nav.overviewShort"), "/databases": t("nav.databasesShort") };
  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-current={active ? "page" : undefined}
      className={`relative flex flex-col items-center justify-center gap-1 text-[11px] transition-colors ${active ? "font-semibold text-fg before:absolute before:inset-x-[30%] before:-top-px before:h-0.5 before:rounded-b-sm before:bg-accent" : "font-medium text-subtle"}`}
    >
      <span className="relative">
        <Icon className={`size-5 ${active ? "text-accent" : ""}`} aria-hidden />
        {mark && (
          <span className="absolute -top-0.5 left-[calc(100%+1px)]">
            <MarkDot level={mark} />
          </span>
        )}
      </span>
      <span className="max-w-full truncate px-1">{short[item.to] ?? item.label}</span>
    </NavLink>
  );
}
