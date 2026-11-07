import { ErrorNotice, PageHeader, SkeletonRows } from "../components/Status";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Copy, ExternalLink, Globe, Plus, Search, X } from "lucide-react";
import type { DomainOverview } from "@panel/shared";
import { api } from "../lib/api";
import { copy } from "../lib/ops";
import { appUrl, useProjects, useSettings } from "../lib/projects";
import { DnsHelp, DomainStatus, domainCheckQuery, tlsDaysLeft, useDomainOverview } from "../components/DomainStatus";
import { AccessBadge, TailnetSetup } from "../components/AccessUi";
import { CaddyBanner } from "../components/ProjectUi";
import { FormError } from "../components/AuthCard";
import { confirmDialog, showError } from "../lib/dialog";
import { t } from "../i18n";

const COLS = "md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1.6fr)_2.75rem]";

export function DomainsPage() {
  const qc = useQueryClient();
  const { data, error } = useDomainOverview();
  const { data: projects } = useProjects();
  const [hostname, setHostname] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [redirectWww, setRedirectWww] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const ids = { form: useId(), host: useId(), project: useId(), list: useId() };

  const term = q.trim().toLocaleLowerCase("tr");
  const domains = useMemo(
    () =>
      (data?.domains ?? []).filter(
        (d) => !term || [d.hostname, d.display, d.projectName].some((v) => v.toLocaleLowerCase("tr").includes(term)),
      ),
    [data, term],
  );

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const r = await api.post<{ warning: string | null }>(`/api/projects/${projectId}/domains`, { hostname, redirectWww: redirectWww && isApexLike(hostname) });
      setWarning(r.warning);
      setHostname("");
      qc.invalidateQueries({ queryKey: ["domains"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  async function remove(projectIdOf: number, id: number, name: string) {
    if (!(await confirmDialog({ title: t("domains:list.removeConfirm.title", { name }), message: t("domains:list.removeConfirm.message"), confirmLabel: t("domains:list.removeConfirm.confirm"), danger: true }))) return;
    await api.del(`/api/projects/${projectIdOf}/domains/${id}`).catch((e: Error) => showError(e));
    qc.invalidateQueries({ queryKey: ["domains"] });
  }

  if (error) return <ErrorNotice error={error} />;
  if (!data) return <SkeletonRows rows={4} />;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <CaddyBanner />
      <PageHeader
        title={t("nav.domains")}
        flush
        description={
          <>
            {t("domains:page.descriptionBefore")}
            <span className="font-mono text-xs text-fg">{data.baseDomain}</span>
            {t("domains:page.descriptionAfter")}
          </>
        }
      />

      <DomainSummary data={data} />

      {data.domains.some((d) => d.access?.tailnet) && <TailnetSetup />}

      <form onSubmit={add} className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby={ids.form}>
        <div className="card-head flex-wrap">
          <h2 id={ids.form} className="cap">
            {t("domains:form.title")}
          </h2>
          <span className="text-xs text-muted max-sm:basis-full">{t("domains:form.hint")}</span>
        </div>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-end">
            <div className="min-w-0">
              <label className="label" htmlFor={ids.host}>
                {t("domains:form.domain")}
              </label>
              <input
                id={ids.host}
                className="input font-mono"
                placeholder={t("domains:form.placeholder")}
                spellCheck={false}
                autoCapitalize="off"
                value={hostname}
                onChange={(e) => setHostname(e.target.value.trim())}
              />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor={ids.project}>
                {t("domains:form.project")}
              </label>
              <select id={ids.project} className="input" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{t("domains:form.selectProject")}</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" disabled={!hostname || !projectId}>
              <Plus className="size-4" aria-hidden /> {t("domains:form.submit")}
            </button>
          </div>
          {hostname && isApexLike(hostname) && (
            <label className="check-row text-muted">
              <input type="checkbox" className="accent-accent" checked={redirectWww} onChange={(e) => setRedirectWww(e.target.checked)} />
              <span>
                {t("domains:form.redirectWwwBefore")}
                <span className="font-mono text-xs text-fg">www.{hostname}</span>
                {t("domains:form.redirectWwwAfter")}
              </span>
            </label>
          )}
          <FormError message={formError} />
          {warning && <p className="notice notice-warning py-2.5">{warning}</p>}
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-line bg-raised" aria-labelledby={ids.list}>
        <h2 id={ids.list} className="sr-only">
          {t("domains:list.title")}
        </h2>
        {(data.domains.length > 5 || data.publicIps.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
            {data.domains.length > 5 && (
              <div className="relative min-w-48 flex-1 sm:max-w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                <input
                  type="search"
                  className="input pl-9"
                  placeholder={t("domains:list.search")}
                  aria-label={t("domains:list.search")}
                  spellCheck={false}
                  autoCapitalize="off"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            )}
            {data.publicIps.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0 text-xs sm:ml-auto">
                <span className="text-muted">{t("domains:list.dnsShouldPoint")}</span>
                {data.publicIps.map((ip) => (
                  <span key={ip} className="inline-flex min-w-0 items-center">
                    <span className="font-mono break-all text-fg tabular-nums">{ip}</span>
                    <button className="btn-icon" onClick={() => copy(ip)} title={t("actions.copy")} aria-label={t("domains:list.copyIp", { ip })}>
                      <Copy className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className={`hidden gap-4 border-b border-line px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase sm:px-5 md:grid ${COLS}`}>
          <span>{t("domains:list.colDomain")}</span>
          <span>{t("domains:list.colProject")}</span>
          <span>{t("domains:list.colStatus")}</span>
          <span className="sr-only">{t("domains:list.colActions")}</span>
        </div>
        <ul>
          {data.panelDomain && !term && (
            <li className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:px-5 ${COLS}`}>
              <span className="truncate font-mono text-[13px]">{data.panelDomain}</span>
              <span className="text-sm text-muted">{t("domains:list.thisPanel")}</span>
              <div className="col-span-2 md:col-span-1">
                <DomainStatus hostname={data.panelDomain} />
              </div>
            </li>
          )}
          {domains.map((d) => (
            <li
              key={d.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b border-line-soft px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-fg/[0.02] sm:px-5 ${COLS}`}
            >
              <div className="min-w-0">
                <a href={appUrl(d.hostname, data.https)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] hover:underline">
                  <span className="truncate">{d.display}</span> <ExternalLink className="size-3 shrink-0 text-subtle" aria-hidden />
                </a>
                {d.display !== d.hostname && <div className="truncate font-mono text-[11px] text-subtle">{d.hostname}</div>}
                {d.kind === "redirect" && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-subtle">
                    <ArrowRight className="size-3 shrink-0" aria-hidden /> <span className="truncate">{t("domains:list.redirectsTo", { target: d.primaryHostname ?? "" })}</span>
                  </div>
                )}
                {d.kind === "route" && d.hostname === d.primaryHostname && <div className="mt-0.5 text-xs text-subtle">{t("domains:list.primary")}</div>}
                {d.access && (
                  <div className="mt-1.5">
                    <AccessBadge access={d.access} />
                  </div>
                )}
              </div>
              <button
                className="btn-icon -mt-2 -mr-2 md:order-last md:-mt-1.5 md:mr-0"
                title={t("domains:list.remove")}
                aria-label={t("domains:list.removeNamed", { name: d.display })}
                onClick={() => remove(d.projectId, d.id, d.display)}
              >
                <X className="size-4" aria-hidden />
              </button>
              <div className="col-span-2 text-sm md:col-span-1">
                <Link to={`/projects/${d.projectId}?tab=domains`} className="inline-flex items-center gap-1.5 hover:underline">
                  <span className="text-muted md:hidden">{t("domains:list.projectPrefix")}</span> {d.projectName}
                </Link>
              </div>
              <div className="col-span-2 min-w-0 md:col-span-1">
                <DomainStatus hostname={d.hostname} detail compact={data.publicIps.length > 0} />
              </div>
            </li>
          ))}
        </ul>
        {data.domains.length === 0 && !data.panelDomain && (
          <div className="px-4 py-10 text-center text-sm text-muted">
            <Globe className="mx-auto mb-2 size-6 text-subtle" aria-hidden />
            {t("domains:list.empty")}
          </div>
        )}
        {data.domains.length > 0 && domains.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted">
            {t("domains:list.noMatch", { q: q.trim() })}
            <button className="btn-secondary" onClick={() => setQ("")}>
              {t("domains:list.clearSearch")}
            </button>
          </div>
        )}
      </section>

      <details className="group overflow-hidden rounded-lg border border-line bg-raised">
        <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold select-none sm:px-5 [&::-webkit-details-marker]:hidden">
          {t("domains:guide.title")}
          <ChevronDown className="size-4 text-subtle transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
        </summary>
        <div className="grid gap-5 border-t border-line px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_300px] [&>*]:min-w-0">
          <DnsHelp ips={data.publicIps} bare />
          <div className="space-y-2.5 border-line max-lg:border-t max-lg:pt-5 lg:border-l lg:pl-6">
            <div className="cap">{t("domains:guide.notes")}</div>
            {data.publicIps.length === 0 && (
              <p className="text-xs text-warning">
                {t("domains:guide.ipMissing.before")}
                <code>deploy/.env</code>
                {t("domains:guide.ipMissing.middle")}
                <code>PUBLIC_IPV4=…</code>
                {t("domains:guide.ipMissing.after")}
              </p>
            )}
            <p className="text-xs text-pretty text-muted">{t("domains:guide.propagation")}</p>
            <p className="text-xs text-pretty text-muted">
              {t("domains:guide.dnsFirst")}
            </p>
            <p className="text-xs text-pretty text-muted">
              {t("domains:guide.wildcard.before")}
              <Code>{data.baseDomain}</Code>
              {t("domains:guide.wildcard.middle")}
              <Code>*</Code>
              {t("domains:guide.wildcard.after")}
            </p>
            <p className="text-xs text-pretty text-muted">
              {t("domains:guide.idn.before")}
              <Code>.com.tr</Code>
              {t("domains:guide.idn.after")}
            </p>
          </div>
        </div>
      </details>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("marks.legend")}>
        <li className="flex items-center gap-1.5">
          <span className="dot dot-ok" aria-hidden /> {t("marks.ok")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="dot dot-look" aria-hidden /> {t("domains:legend.waiting")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="dot dot-urgent" aria-hidden /> {t("domains:legend.fix")}
        </li>
      </ul>
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-sm border border-line bg-canvas px-1 py-px font-mono text-[11px] text-fg">{children}</code>
);

type Level = "ok" | "look" | "urgent" | "none";
const dotCls: Record<Level, string> = { ok: "dot-ok", look: "dot-look", urgent: "dot-urgent", none: "dot-none" };
const textCls: Record<Level, string> = { ok: "text-fg", look: "text-warning", urgent: "text-danger", none: "text-muted" };

/** Sayfa üstü özet şeridi: DNS, SSL, erişim, Tailscale DNS. Domain kontrolleri satırlarla aynı sorguyu paylaşır. */
function DomainSummary({ data }: { data: DomainOverview }) {
  const { data: settings } = useSettings();
  const hosts = useMemo(() => [...(data.panelDomain ? [data.panelDomain] : []), ...data.domains.map((d) => d.hostname)], [data]);
  const checks = useQueries({ queries: hosts.map((h) => domainCheckQuery(h)) });
  if (hosts.length === 0) return null;

  const loaded = checks.map((c) => c.data).filter((c) => c != null);
  const ready = loaded.length === hosts.length;
  const bad = loaded.filter((c) => c.dns.status === "wrong" || c.dns.status === "missing").length;
  const unknown = loaded.filter((c) => c.dns.status === "unknown").length;
  const tls = loaded.map((c) => c.tls).filter((x) => x != null);
  const tlsOk = tls.filter((x) => x.ok);
  const tlsWaiting = tls.length - tlsOk.length;
  const minDays = tlsOk.map(tlsDaysLeft).filter((n) => n != null).reduce<number | null>((m, n) => (m == null || n < m ? n : m), null);
  const restricted = data.domains.filter((d) => d.access);
  const tailnetDomains = restricted.filter((d) => d.access?.tailnet).length;

  const cells: { key: string; label: string; level: Level; value: ReactNode }[] = [];

  cells.push(
    !ready
      ? { key: "dns", label: "DNS", level: "none", value: t("domains:summary.checking") }
      : bad > 0
        ? { key: "dns", label: "DNS", level: "look", value: <><span className="font-mono">{bad}</span>{t("domains:summary.dnsBad", { count: bad })}</> }
        : unknown > 0
          ? { key: "dns", label: "DNS", level: "none", value: <><span className="font-mono">{unknown}</span>{t("domains:summary.dnsUnknown", { count: unknown })}</> }
          : { key: "dns", label: "DNS", level: "ok", value: t("domains:summary.dnsOk") },
  );

  if (!ready) cells.push({ key: "ssl", label: "SSL", level: "none", value: t("domains:summary.checking") });
  else if (tls.length === 0) cells.push({ key: "ssl", label: "SSL", level: "none", value: t("domains:summary.httpsOff") });
  else
    cells.push({
      key: "ssl",
      label: "SSL",
      level: tlsWaiting > 0 ? "look" : "ok",
      value: (
        <>
          <span className="font-mono">{tlsOk.length}</span>
          {t("domains:summary.sslValid")}
          {tlsWaiting > 0 && (
            <>
              {" "}· <span className="font-mono">{tlsWaiting}</span>
              {t("domains:summary.sslWaiting")}
            </>
          )}
          {tlsWaiting === 0 && minDays != null && (
            <>
              {" "}· {t("domains:summary.renewalBefore")}
              <span className="font-mono">{minDays}</span>
              {t("domains:summary.renewalAfter", { count: minDays })}
            </>
          )}
        </>
      ),
    });

  cells.push({
    key: "access",
    label: t("domains:summary.access"),
    level: "ok",
    value:
      restricted.length === 0 ? (
        t("domains:summary.allPublic")
      ) : (
        <>
          <span className="font-mono">{restricted.length}</span>
          {t("domains:summary.restricted", { count: restricted.length })}
        </>
      ),
  });

  const tn = settings?.tailnet;
  if (tn) {
    const active = !!tn.lastQueryAt && Date.now() - tn.lastQueryAt < 24 * 3600_000;
    const needed = tailnetDomains > 0;
    cells.push(
      !tn.ipv4 && !tn.ipv6
        ? { key: "ts", label: "Tailscale DNS", level: needed ? "look" : "none", value: t("domains:summary.tsNotSet") }
        : !tn.dnsRunning
          ? { key: "ts", label: "Tailscale DNS", level: needed ? "urgent" : "none", value: t("domains:summary.tsDown") }
          : active
            ? { key: "ts", label: "Tailscale DNS", level: "ok", value: t("domains:summary.tsActive") }
            : { key: "ts", label: "Tailscale DNS", level: needed ? "look" : "none", value: t("domains:summary.tsNoQuery") },
    );
  }

  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-raised lg:grid-cols-4" aria-label={t("domains:summary.label")}>
      {cells.map((c, i) => (
        <div
          key={c.key}
          className={`flex min-w-0 flex-col justify-center gap-1 border-line px-4 py-3 sm:px-5 ${i % 2 === 0 ? "border-r" : "lg:border-r"} ${
            i < 2 ? "max-lg:border-b" : ""
          } last:border-r-0`}
        >
          <span className="cap">{c.label}</span>
          <span className={`flex min-w-0 items-baseline gap-2 text-sm font-semibold text-pretty ${textCls[c.level]}`}>
            <span className={`dot ${dotCls[c.level]} relative -top-px`} aria-hidden />
            <span className="min-w-0">{c.value}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

/** www.'siz ve iki parçalı (ornek.com, ornek.com.tr) görünen adreslerde www yönlendirmesi önerilir */
function isApexLike(h: string) {
  const s = h.toLowerCase();
  if (s.startsWith("www.")) return false;
  const parts = s.split(".");
  return parts.length === 2 || (parts.length === 3 && /^(com|net|org|gov|edu|gen|web|biz|info|av|bel|k12|name|tv)$/.test(parts[1]!));
}
