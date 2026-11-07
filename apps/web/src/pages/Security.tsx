import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LogOut, Plus, X } from "lucide-react";
import { ipOrCidrSchema, type AuditEntry, type SecurityOverview, type SessionInfo } from "@panel/shared";
import { api } from "../lib/api";
import { timeAgo } from "../lib/projects";
import { copy } from "../lib/ops";
import { toast } from "../lib/toast";
import { FormError } from "../components/AuthCard";
import { PageHeader, SkeletonRows } from "../components/Status";
import { TailnetSetup } from "../components/AccessUi";
import { Dot, DotLegend, Panel, SummaryStrip, cmdBox, lede, panelBody, type StripCell } from "../components/MaintenanceUi";
import { confirmDialog, showError } from "../lib/dialog";
import { t } from "../i18n";
import { fmtDateTime, fmtTime } from "../lib/format";
import type trSecurity from "../locales/tr/security";

type ActionKey = keyof (typeof trSecurity)["audit"]["action"];

const useSessions = () => useQuery({ queryKey: ["sessions"], queryFn: () => api.get<SessionInfo[]>("/api/security/sessions") });

export function SecurityPage() {
  const { data } = useQuery({ queryKey: ["security"], queryFn: () => api.get<SecurityOverview>("/api/security"), refetchInterval: 30_000 });

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <PageHeader title={t("security:page.title")} description={t("security:page.description")} flush />
      {!data ? (
        <SkeletonRows rows={4} className="h-24" />
      ) : (
        <>
          <SecurityStrip s={data} />
          <div className="grid items-start gap-4 md:gap-5 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
            <div className="flex min-w-0 flex-col gap-4 md:gap-5">
              <ProtectionCard s={data} />
              <SessionsCard />
              <AuditCard />
            </div>
            <div className="flex min-w-0 flex-col gap-4 md:gap-5">
              <PasswordCard />
              <AllowlistCard s={data} />
              {/* Kısıtlı domain ayarı Domainler sayfasında da çıkar; burada yalnız panel Tailscale arkasındaysa */}
              {data.panelAccess === "tailscale" && <TailnetSetup />}
            </div>
          </div>
          <EmergencyCard />
          <DotLegend
            items={[
              ["ok", t("security:legend.ok")],
              ["warning", t("security:legend.warning")],
              ["danger", t("security:legend.danger")],
              ["none", t("security:legend.none")],
            ]}
          />
        </>
      )}
    </div>
  );
}

function SecurityStrip({ s }: { s: SecurityOverview }) {
  const { data: sessions } = useSessions();
  const ips = s.settings.ipAllowlist.length;
  const cells: StripCell[] = [
    s.panelAccess === "tailscale"
      ? { label: t("security:strip.access"), value: t("security:strip.tailscaleOnly"), level: "ok" }
      : { label: t("security:strip.access"), value: t("security:strip.public"), level: "warning", title: t("security:strip.publicTitle") },
    { label: t("security:strip.twoFactor"), value: t("security:strip.required"), level: "ok" },
    { label: t("security:strip.sessions"), value: sessions ? t("security:strip.devices", { count: sessions.length }) : "—", level: sessions ? "ok" : "none" },
    { label: t("security:strip.ipLimit"), value: ips ? t("security:strip.addresses", { count: ips }) : t("security:strip.noLimit"), level: ips ? "ok" : "none" },
  ];
  const locked = !!s.lockedUntil;
  return (
    <SummaryStrip
      label={t("security:strip.label")}
      title={t("security:strip.title")}
      head={locked ? t("security:strip.locked") : t("security:strip.active")}
      headLevel={locked ? "danger" : s.failedLast15m > 0 ? "warning" : "ok"}
      detail={
        <>
          {t("security:strip.failedBefore")} <span className="font-mono">{s.failedLast15m}</span> {t("security:strip.failedAfter", { count: s.failedLast15m })}
        </>
      }
      cells={cells}
    />
  );
}

function ProtectionCard({ s }: { s: SecurityOverview }) {
  const items: [string, string | null][] = [
    [t("security:protection.singleAdmin"), t("security:protection.singleAdminSub")],
    [t("security:protection.twoFactor"), t("security:protection.twoFactorSub")],
    [t("security:protection.rateLimit"), t("security:protection.rateLimitSub")],
    [t("security:protection.session"), t("security:protection.sessionSub", { hours: s.idleTimeoutHours, days: s.sessionDays })],
    s.panelAccess === "tailscale"
      ? [t("security:protection.closed"), t("security:protection.closedSub")]
      : [t("security:protection.open"), t("security:protection.openSub")],
    [t("security:protection.caddy"), t("security:protection.caddySub")],
    [t("security:protection.csrf"), t("security:protection.csrfSub")],
    [t("security:protection.crypto"), null],
  ];
  const publicAccess = s.panelAccess !== "tailscale";
  return (
    <Panel
      id="koruma"
      title={t("security:protection.title")}
      aside={<span>{publicAccess ? t("security:protection.oneOptional") : t("security:protection.allOn")}</span>}
      footer={
        <span className="text-xs text-muted">
          {t("security:protection.footerBefore")}{" "}
          <Link to="/settings#bildirimler" className="text-fg underline underline-offset-2 hover:text-accent">
            {t("security:protection.footerLink")}
          </Link>
          {t("security:protection.footerAfter")}
        </span>
      }
    >
      {s.lockedUntil && (
        <div className="px-4 pt-4 sm:px-5">
          <div className="notice notice-danger" role="alert">
            {t("security:protection.locked", { time: fmtTime(s.lockedUntil, { hour: "2-digit", minute: "2-digit", second: "2-digit" }), count: s.failedLast15m })}
          </div>
        </div>
      )}
      <ul>
        {items.map(([text, sub], i) => (
          <li key={text} className="grid grid-cols-[7px_1fr] items-start gap-3.5 border-b border-line-soft px-4 py-2.5 text-sm last:border-b-0 sm:px-5">
            <Dot level={publicAccess && i === 4 ? "warning" : "ok"} className="mt-[7px]" />
            <span className="min-w-0">
              {text}
              {sub && <small className="block text-xs leading-4 text-muted">{sub}</small>}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AllowlistCard({ s }: { s: SecurityOverview }) {
  const qc = useQueryClient();
  const [list, setList] = useState(s.settings.ipAllowlist);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setList(s.settings.ipAllowlist), [s.settings.ipAllowlist]);
  const dirty = JSON.stringify(list) !== JSON.stringify(s.settings.ipAllowlist);

  function add(v: string) {
    const r = ipOrCidrSchema.safeParse(v);
    if (!r.success) {
      const msg = r.error.issues[0]?.message;
      return setError(msg ? t(msg, msg) : t("security:allowlist.invalid"));
    }
    setError(null);
    if (!list.includes(r.data)) setList([...list, r.data]);
    setInput("");
  }

  async function save() {
    setError(null);
    try {
      await api.put("/api/security", { ipAllowlist: list });
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["security"] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const missingSelf = list.length > 0 && !list.includes(s.currentIp);

  return (
    <Panel
      id="ip"
      title={t("security:allowlist.title")}
      aside={<span>{t("security:allowlist.optional")}</span>}
      footer={
        <>
          <button className="btn-secondary max-sm:w-full" disabled={!dirty} onClick={save}>
            {t("actions.save")}
          </button>
          <span className="text-xs text-muted" role="status">
            {saved && !dirty ? (
              <span className="text-success">{t("security:allowlist.saved")}</span>
            ) : dirty ? (
              t("security:allowlist.unsaved")
            ) : (
              t("security:allowlist.lockedOut")
            )}
          </span>
        </>
      }
    >
      <div className={panelBody}>
        <p className={lede}>
          {t("security:allowlist.introBefore")} <b className="font-semibold text-fg">{t("security:allowlist.introBold")}</b>{" "}
          {t("security:allowlist.introAfter")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((ip) => (
            <span key={ip} className="inline-flex h-8 items-center gap-0.5 rounded-sm border border-line pl-2.5 font-mono text-xs text-fg">
              {ip}
              <button
                type="button"
                onClick={() => setList(list.filter((x) => x !== ip))}
                className="grid size-11 place-items-center rounded-sm text-faint transition-colors duration-150 hover:text-fg md:size-7"
                aria-label={t("security:allowlist.remove", { ip })}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {list.length === 0 && <span className="text-xs text-muted">{t("security:allowlist.none")}</span>}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            add(input);
          }}
        >
          <input
            className="input min-w-[11rem] flex-1 font-mono text-xs"
            aria-label={t("security:allowlist.inputLabel")}
            placeholder={t("security:allowlist.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn-secondary" disabled={!input}>
            <Plus className="size-4" aria-hidden /> {t("actions.add")}
          </button>
        </form>
        <p className="text-xs text-muted">
          {t("security:allowlist.currentIp")} <code className="font-mono text-fg">{s.currentIp}</code>
          {!list.includes(s.currentIp) && (
            <>
              {" · "}
              <button type="button" className="min-h-8 text-fg underline underline-offset-2 hover:text-accent" onClick={() => add(s.currentIp)}>
                {t("security:allowlist.addThis")}
              </button>
            </>
          )}
        </p>
        {missingSelf && <p className="text-xs text-warning">{t("security:allowlist.missingSelf")}</p>}
        <FormError message={error} />
      </div>
    </Panel>
  );
}

function browserName(ua: string | null) {
  if (!ua) return t("security:sessions.unknown");
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : t("security:sessions.browser");
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${b}${os ? ` · ${os}` : ""}`;
}

const DAY = 86_400_000;

function SessionsCard() {
  const qc = useQueryClient();
  const { data } = useSessions();
  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] });

  async function revoke(id: string) {
    await api.del(`/api/security/sessions/${id}`).catch((e: Error) => showError(e));
    refresh();
  }
  async function revokeOthers() {
    if (!(await confirmDialog({
        title: t("security:sessions.revokeOthersConfirm.title"),
        message: t("security:sessions.revokeOthersConfirm.message"),
        confirmLabel: t("security:sessions.revokeOthersConfirm.confirm"),
        danger: true,
      }))) return;
    await api.post("/api/security/sessions/revoke-others");
    refresh();
  }

  return (
    <Panel
      id="oturumlar"
      title={t("security:sessions.title")}
      aside={
        data &&
        data.length > 1 && (
          <button className="btn-danger btn-sm" onClick={revokeOthers}>
            <LogOut className="size-3.5" aria-hidden /> {t("security:sessions.revokeOthers")}
          </button>
        )
      }
      footer={<span className="text-xs text-muted">{t("security:sessions.footer")}</span>}
    >
      {!data ? (
        <div className="p-4 sm:px-5">
          <SkeletonRows rows={2} className="h-10" />
        </div>
      ) : (
        <ul>
          {data.map((s) => {
            const idle = !s.current && (!s.lastSeenAt || Date.now() - s.lastSeenAt > DAY);
            return (
              <li key={s.id} className="flex items-center gap-3.5 border-b border-line-soft py-2.5 pr-2 pl-4 last:border-b-0 sm:pl-5">
                <Dot level={idle ? "none" : "ok"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="font-semibold">{browserName(s.userAgent)}</b>
                    {s.current && <span className="badge tone-success">{t("security:sessions.thisDevice")}</span>}
                  </div>
                  <div className="font-mono text-[11px] text-muted [overflow-wrap:anywhere] sm:truncate">
                    {t("security:sessions.meta", { ip: s.ip ?? "?", created: timeAgo(s.createdAt), seen: s.lastSeenAt ? timeAgo(s.lastSeenAt) : "?" })}
                  </div>
                </div>
                {!s.current && (
                  <button className="btn-icon hover:text-danger" title={t("security:sessions.revoke")}
                    aria-label={t("security:sessions.revokeLabel", { name: browserName(s.userAgent) })} onClick={() => revoke(s.id)}>
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const mismatch = next2.length > 0 && next !== next2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (next !== next2) return setError(t("security:password.mismatch"));
    try {
      const r = await api.post<{ revokedSessions: number }>("/api/security/password", { currentPassword: current, newPassword: next, code });
      setDone(r.revokedSessions ? t("security:password.changedRevoked", { count: r.revokedSessions }) : t("security:password.changed"));
      setCurrent("");
      setNext("");
      setNext2("");
      setCode("");
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    }
  }

  return (
    <form onSubmit={submit} className="min-w-0 overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby="sifre-title">
      <div className="card-head">
        <h2 id="sifre-title" className="cap">
          {t("security:password.title")}
        </h2>
      </div>
      <div className={panelBody}>
        <label className="block">
          <span className="label">{t("security:password.current")}</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t("security:password.code")}</span>
          <input
            className="input text-center font-mono tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
          />
        </label>
        <label className="block">
          <span className="label">{t("security:password.next")}</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t("security:password.next2")}</span>
          <input className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} aria-invalid={mismatch || undefined} />
        </label>
        {mismatch && <p className="-mt-2 text-xs text-danger">{t("security:password.mismatch")}</p>}
        <FormError message={error} />
        {done && (
          <p className="text-sm text-success" role="status">
            {done}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
        <button className="btn-secondary max-sm:w-full" disabled={!current || next.length < 12 || code.length !== 6}>
          {t("security:password.submit")}
        </button>
        <span className="text-xs text-muted">{t("security:password.note")}</span>
      </div>
    </form>
  );
}

/** İşlem kodu (ör. auth.login) → seçili dilde etiket; bilinmeyen kod olduğu gibi görünür */
const actionLabel = (a: string) => t(`security:audit.action.${a.replace(".", "_") as ActionKey}`, { defaultValue: a });

function AuditCard() {
  const [all, setAll] = useState(false);
  const { data } = useQuery({
    queryKey: ["audit", all],
    queryFn: () => api.get<AuditEntry[]>(`/api/security/audit?filter=${all ? "all" : "security"}&limit=100`),
    refetchInterval: 30_000,
  });
  const bad = (a: string) => a === "auth.login_failed" || a === "auth.locked" || a.endsWith("_failed");
  const secure = (a: string) => /^(auth|security|offsite)\./.test(a);

  return (
    <Panel
      id="kayit"
      title={t("security:audit.title")}
      aside={
        <div className="flex gap-1" role="group" aria-label={t("security:audit.filterLabel")}>
          <button type="button" className="chip min-h-11 md:min-h-7" aria-pressed={!all} onClick={() => setAll(false)}>
            {t("security:audit.security")}
          </button>
          <button type="button" className="chip min-h-11 md:min-h-7" aria-pressed={all} onClick={() => setAll(true)}>
            {t("security:audit.all")}
          </button>
        </div>
      }
    >
      {!data ? (
        <div className="p-4 sm:px-5">
          <SkeletonRows rows={3} className="h-10" />
        </div>
      ) : data.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted sm:px-5">{t("security:audit.empty")}</p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {data.map((e) => {
            const warn = bad(e.action);
            return (
              <li key={e.id} className="flex items-start gap-3.5 border-b border-line-soft px-4 py-2.5 last:border-b-0 sm:px-5">
                <Dot level={warn ? "warning" : secure(e.action) ? "ok" : "none"} className="mt-[7px]" />
                <div className="min-w-0 flex-1">
                  <b className={`text-sm font-semibold ${warn ? "text-warning" : ""}`}>{actionLabel(e.action)}</b>
                  {warn && <span className="sr-only">{t("security:audit.attention")}</span>}
                  {e.details && (
                    <div className="truncate font-mono text-[11px] text-faint" title={e.details}>
                      {e.details}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-muted tabular-nums">
                  <div title={fmtDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</div>
                  <div className="font-mono text-[11px] text-faint">{e.ip ?? t("security:audit.server")}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function EmergencyCard() {
  const cmds = [
    [t("security:emergency.unlock"), "docker exec panel node /app/api/dist/cli.js unlock"],
    [t("security:emergency.clearAllowlist"), "docker exec panel node /app/api/dist/cli.js clear-allowlist && docker restart panel"],
    [t("security:emergency.logoutAll"), "docker exec panel node /app/api/dist/cli.js logout-all"],
    [t("security:emergency.resetAdmin"), "docker exec panel node /app/api/dist/cli.js reset-admin --evet"],
  ] as const;
  return (
    <Panel id="acil" title={t("security:emergency.title")} aside={<span>{t("security:emergency.aside")}</span>}>
      <div className={panelBody}>
        <p className={lede}>{t("security:emergency.intro")}</p>
        <div className="grid gap-x-5 gap-y-3.5 xl:grid-cols-2">
          {cmds.map(([label, cmd]) => (
            <div key={cmd} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">{label}</span>
              <div className={cmdBox}>
                <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-7 whitespace-nowrap text-fg/85 [overflow-wrap:normal]">{cmd}</code>
                <button
                  type="button"
                  className="btn-icon"
                  title={t("actions.copy")}
                  aria-label={t("security:emergency.copyLabel", { label })}
                  onClick={() => {
                    copy(cmd);
                    toast(t("security:emergency.copied"));
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
