import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Github } from "../components/GithubIcon";
import { api } from "../lib/api";
import { startGithubAppCreation, useGithubStatus } from "../lib/github";
import { useSettings } from "../lib/projects";
import { useNotifications } from "../lib/ops";
import { useSystem, useUpdater, type Level } from "../lib/status";
import { FormError } from "../components/AuthCard";
import { PageHeader } from "../components/Status";
import { NotificationSettings } from "../components/NotificationSettings";
import { CleanupSection, Dot, Panel, SummaryStrip, UpdaterSection, lede, panelBody, type StripCell } from "../components/MaintenanceUi";
import { confirmDialog } from "../lib/dialog";
import { LanguageSelect } from "../components/LanguageSelect";
import { t } from "../i18n";
import { fmtDateTime, fmtPercent } from "../lib/format";

export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 md:gap-5">
      <PageHeader title={t("settings:page.title")} description={t("settings:page.description")} flush />
      <SettingsStrip />
      <CleanupSection />
      <div className="grid items-start gap-4 md:gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <UpdaterSection />
        <GithubSection />
      </div>
      <NotificationSettings />
      <LanguageSection />
      <ProxySection />
    </div>
  );
}

/** Ayarlar sayfasının özet şeridi: ne bakılmalı + disk, sürüm, GitHub, bildirim durumu */
function SettingsStrip() {
  const { data: sys } = useSystem();
  const { data: updater } = useUpdater();
  const { data: gh } = useGithubStatus();
  const { data: notif } = useNotifications();
  if (!sys && !updater && !gh && !notif) return <SummaryStrip label={t("settings:strip.label")} title={t("settings:strip.title")} head="…" headLevel="none" cells={null} />;

  const issues: { name: string; level: Level }[] = [];
  const cells: StripCell[] = [];

  const pct = sys?.disk ? (sys.disk.usedBytes / sys.disk.totalBytes) * 100 : null;
  const diskLevel: Level | "none" = pct == null ? "none" : pct >= 90 ? "danger" : pct >= 80 ? "warning" : "ok";
  if (diskLevel === "danger" || diskLevel === "warning") issues.push({ name: t("settings:strip.issue.disk"), level: diskLevel });
  cells.push({ label: t("settings:strip.disk"), value: pct == null ? "—" : t("settings:strip.diskUsed", { pct: fmtPercent(pct) }), level: diskLevel });

  if (!updater) cells.push({ label: t("settings:strip.panelVersion"), value: "—", level: "none" });
  else if (!updater.installed) cells.push({ label: t("settings:strip.panelVersion"), value: t("settings:strip.noUpdater"), level: "none", title: t("settings:strip.noUpdaterTitle") });
  else if (updater.pending.length) {
    issues.push({ name: t("settings:strip.issue.update"), level: "warning" });
    cells.push({ label: t("settings:strip.panelVersion"), value: t("settings:strip.pendingChanges", { count: updater.pending.length }), level: "warning", title: updater.current?.message });
  } else
    cells.push({
      label: t("settings:strip.panelVersion"),
      value: updater.current ? t("settings:strip.upToDate", { sha: updater.current.sha.slice(0, 7) }) : t("settings:strip.notChecked"),
      level: updater.current ? "ok" : "none",
      title: updater.current?.message,
    });

  if (!gh) cells.push({ label: "GitHub", value: "—", level: "none" });
  else if (!gh.configured) cells.push({ label: "GitHub", value: t("settings:strip.notConnected"), level: "none" });
  else {
    const needsPerm = gh.appMissing.length > 0 || gh.installations.some((i) => i.missing.length > 0);
    if (needsPerm) issues.push({ name: t("settings:strip.issue.github"), level: "warning" });
    cells.push({
      label: "GitHub",
      value: needsPerm
        ? t("settings:strip.awaitingPermission")
        : gh.installations.length
          ? t("settings:strip.connectedInstalls", { count: gh.installations.length })
          : t("settings:strip.connectedNoInstalls"),
      level: needsPerm || !gh.installations.length ? "warning" : "ok",
    });
  }

  const channels = notif ? [notif.email.enabled && t("settings:strip.email"), notif.telegram.enabled && "Telegram", notif.discord.enabled && "Discord"].filter(Boolean) : [];
  cells.push({ label: t("settings:strip.notifications"), value: !notif ? "—" : channels.length ? channels.join(", ") : t("settings:strip.off"), level: !notif || !channels.length ? "none" : "ok" });

  const worst: Level = issues.some((i) => i.level === "danger") ? "danger" : "warning";
  return (
    <SummaryStrip
      label={t("settings:strip.label")}
      title={t("settings:strip.title")}
      head={issues.length ? t("settings:strip.issues", { count: issues.length }) : t("settings:strip.allGood")}
      headLevel={issues.length ? worst : "ok"}
      detail={issues.length ? issues.map((i) => i.name).join(t("settings:strip.and")) : undefined}
      cells={cells}
    />
  );
}

function GithubSection() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [search] = useSearchParams();
  const { data, isLoading, refetch, isFetching } = useGithubStatus();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flag = search.get("github");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await startGithubAppCreation(); // sayfa GitHub'a gider
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: t("settings:github.removeConfirm.title"),
      message: t("settings:github.removeConfirm.message"),
      confirmLabel: t("settings:github.remove"),
      danger: true,
    });
    if (!ok) return;
    const r = await api.del<{ htmlUrl: string | null }>("/api/github/app");
    await qc.invalidateQueries({ queryKey: ["github"] });
    if (r.htmlUrl && (await confirmDialog({
        title: t("settings:github.deleteConfirm.title"),
        message: t("settings:github.deleteConfirm.message"),
        confirmLabel: t("settings:github.deleteConfirm.confirm"),
        cancelLabel: t("states.no"),
      }))) {
      window.open(`${r.htmlUrl.replace("/apps/", "/settings/apps/")}/advanced`, "_blank");
    }
  }

  return (
    <Panel
      id="github"
      title={
        <span className="flex items-center gap-2">
          <Github className="size-3.5" /> GitHub
        </span>
      }
      aside={
        data &&
        (data.configured ? (
          <span className="flex items-center gap-2 text-fg">
            <Dot level="ok" /> {t("settings:github.connected")}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Dot level="none" /> {t("settings:github.notConnected")}
          </span>
        ))
      }
      footer={
        data?.configured && (
          <>
            <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> {t("actions.refresh")}
            </button>
            <button className="btn-ghost ml-auto text-danger hover:text-danger" onClick={remove}>
              {t("settings:github.remove")}
            </button>
          </>
        )
      }
    >
      <div className={panelBody}>
        {isLoading && <div className="skeleton h-16" aria-label={t("states.loading")} />}

        {data && !data.configured && (
          <>
            <p className={lede}>
              {t("settings:github.introBefore")} <b className="font-semibold text-fg">GitHub App</b> {t("settings:github.introAfter")}{" "}
              <i>{t("settings:github.introCreate")}</i> {t("settings:github.introEnd")}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-muted">
              <li className="flex items-start gap-2.5">
                <Dot level="none" className="mt-1.5" /> {t("settings:github.bulletPermissions")}
              </li>
              <li className="flex items-start gap-2.5">
                <Dot level="none" className="mt-1.5" /> {t("settings:github.bulletEvents")}
              </li>
              <li className="flex items-start gap-2.5">
                <Dot level="none" className="mt-1.5" /> {t("settings:github.bulletAccess")}
              </li>
            </ul>
            {settings?.panelAccess === "tailscale" && !settings.webhookDomain && (
              <p className="notice notice-warning block text-xs">
                {t("settings:github.noWebhookDomain")}
              </p>
            )}
            {window.location.hostname === "localhost" && (
              <p className="notice notice-warning block text-xs">
                {t("settings:github.localhost")}
              </p>
            )}
            <FormError message={error} />
            <div>
              <button className="btn max-sm:w-full" onClick={create} disabled={busy}>
                <Github className="size-4" /> {busy ? t("settings:github.redirecting") : t("settings:github.create")}
              </button>
            </div>
          </>
        )}

        {data?.configured && data.app && (
          <>
            {flag === "created" && data.installations.length === 0 && (
              <div className="notice block border-success/25 bg-success/[0.06] text-success">
                <CheckCircle2 className="mr-1.5 inline size-4" aria-hidden /> {t("settings:github.created")}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3.5 py-3">
              <div className="min-w-[200px] flex-1 [overflow-wrap:anywhere]">
                <a href={data.app.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
                  {data.app.name} <ExternalLink className="size-3" aria-hidden />
                </a>
                <div className="text-xs text-muted">
                  {t("settings:github.owner", { owner: data.app.owner })}{" "}
                  {data.webhookActive ? <span className="font-mono text-fg">{data.webhookUrl}</span> : t("settings:github.webhookOff")}
                </div>
              </div>
              <a href={data.app.installUrl} target="_blank" rel="noreferrer" className="btn-secondary max-sm:w-full">
                {data.installations.length ? t("settings:github.editAccess") : t("settings:github.install")}
              </a>
            </div>

            {data.error && <FormError message={data.error} />}

            {data.appMissing.length > 0 && (
              <div className="notice notice-warning block space-y-2">
                <div className="font-medium">{t("settings:github.missing.title")}</div>
                <p className="text-warning/80">
                  {t("settings:github.missing.body")} <b>{data.appMissing.join(", ")}</b>
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-warning/80">
                  <li>
                    {data.permissionsUrl ? (
                      <a href={data.permissionsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {t("settings:github.missing.openPermissions")}
                      </a>
                    ) : (
                      t("settings:github.missing.openPermissions")
                    )}{" "}
                    (Permissions & events)
                  </li>
                  <li>
                    <i>Repository permissions → Pull requests</i>: <b>Read-only</b>
                  </li>
                  <li>
                    {t("settings:github.missing.subscribeBefore")} <i>Subscribe to events</i> → {t("settings:github.missing.subscribeMid")} <b>Pull request</b>{" "}
                    {t("settings:github.missing.subscribeAfter")}
                  </li>
                  <li>
                    <b>Save changes</b>
                    {t("settings:github.missing.saveAfter")}
                  </li>
                </ol>
              </div>
            )}
            {data.appMissing.length === 0 && data.installations.some((i) => i.missing.length > 0) && (
              <div className="notice notice-warning block space-y-2">
                <div className="font-medium">{t("settings:github.approve.title")}</div>
                <p className="text-warning/80">
                  {t("settings:github.approve.body")}{" "}
                  <b>{[...new Set(data.installations.flatMap((i) => i.missing))].join(", ")}</b>
                </p>
                {data.installations
                  .filter((i) => i.missing.length)
                  .map((i) => (
                    <a key={i.id} href={i.manageUrl} target="_blank" rel="noreferrer" className="btn inline-flex">
                      {t("settings:github.approve.open", { account: i.account })}
                    </a>
                  ))}
              </div>
            )}

            {data.installations.length > 0 && (
              <div>
                <div className="label">{t("settings:github.installations")}</div>
                <ul className="rounded-md border border-line">
                  {data.installations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-1.5 pr-1.5 pl-3.5 text-sm last:border-b-0">
                      <span className="min-w-0 flex-1 truncate">
                        <b className="font-semibold">{i.account}</b> <span className="text-xs text-muted">{i.accountType === "User" ? t("settings:github.personal") : t("settings:github.organization")}</span>
                      </span>
                      <span className="text-xs text-muted">{i.repositorySelection === "all" ? t("settings:github.allRepos") : t("settings:github.selectedRepos")}</span>
                      <a href={i.manageUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" aria-label={t("settings:github.editInstall", { account: i.account })}>
                        {t("actions.edit")}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className={lede}>
              {t("settings:github.summary")}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

/** Dil seçimi: arayüz ve bildirimler bu dilde olur (oturum açıkken sunucuya da kaydedilir) */
function LanguageSection() {
  return (
    <Panel id="dil" title={t("settings:language.title")}>
      <div className={panelBody}>
        <LanguageSelect compact />
        <p className={lede}>{t("settings:language.description")}</p>
      </div>
    </Panel>
  );
}

/** Caddy: sorun yokken sessiz, kapalı bir satır; ulaşılamıyorsa açık gelir */
function ProxySection() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [msg, setMsg] = useState<string | null>(null);

  async function resync() {
    setMsg(null);
    try {
      await api.post("/api/caddy/sync");
      setMsg(t("settings:proxy.reloaded"));
    } catch (err) {
      setMsg((err as Error).message);
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  if (!data) return null;
  const ok = data.caddy.reachable;
  return (
    <details className="group min-w-0 rounded-lg border border-line bg-raised" open={!ok || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-xs text-muted sm:px-5 [&::-webkit-details-marker]:hidden">
        <Dot level={ok ? "ok" : "danger"} />
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
          <b className="text-sm font-semibold whitespace-nowrap text-fg">{t("settings:proxy.title")}</b>
          <span className="min-w-0">
            · {ok ? t("settings:proxy.connected") : <span className="text-danger">{data.caddy.error ?? t("settings:proxy.unreachable")}</span>}
            {data.caddy.lastSyncAt && <> · {t("settings:proxy.lastSyncInline", { time: fmtDateTime(data.caddy.lastSyncAt) })}</>}
          </span>
        </span>
        <span className="ml-auto text-faint transition-transform duration-150 group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[160px_1fr] sm:gap-y-2 [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:max-sm:mb-2 [&_dt]:text-xs [&_dt]:text-muted sm:[&_dt]:leading-5">
          <dt>{t("settings:proxy.status")}</dt>
          <dd className={ok ? "text-fg" : "text-danger"}>{ok ? t("settings:proxy.statusConnected") : data.caddy.error}</dd>
          <dt>{t("settings:proxy.lastSync")}</dt>
          <dd>{data.caddy.lastSyncAt ? fmtDateTime(data.caddy.lastSyncAt) : "—"}</dd>
          <dt>{t("settings:proxy.baseDomain")}</dt>
          <dd className="font-mono text-xs leading-5">{data.baseDomain}</dd>
          <dt>{t("settings:proxy.panelAccess")}</dt>
          <dd>{data.panelAccess === "tailscale" ? t("settings:proxy.accessTailscale") : t("settings:proxy.accessPublic")}</dd>
          <dt>{t("settings:proxy.panelDomain")}</dt>
          <dd className="font-mono text-xs leading-5">{data.panelDomain ?? "—"}</dd>
          <dt>{t("settings:proxy.webhookDomain")}</dt>
          <dd className="font-mono text-xs leading-5">{data.webhookDomain ? `${data.webhookDomain}/api/github/webhook` : t("settings:proxy.webhookOff")}</dd>
          <dt>HTTPS</dt>
          <dd>{data.https ? t("settings:proxy.httpsAuto") : t("settings:proxy.httpsOff")}</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-secondary max-sm:w-full" onClick={resync}>
            <RefreshCw className="size-4" aria-hidden /> {t("settings:proxy.reload")}
          </button>
          {msg && (
            <p className="text-xs text-muted" role="status">
              {msg}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
