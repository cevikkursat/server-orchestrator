import { useEffect, useState } from "react";
import { AlertTriangle, Globe, Lock, Network } from "lucide-react";
import type { DomainAccess } from "@panel/shared";
import { useSettings } from "../lib/projects";
import { timeAgo } from "../lib/format";
import { t } from "../i18n";

/** Domain erişim rozeti: herkese açık / Tailscale / IP listesi */
export function AccessBadge({ access }: { access: DomainAccess }) {
  if (!access) return null;
  const parts = [access.tailnet && "Tailscale", access.ips.length && `${access.ips.length} IP`].filter(Boolean);
  return (
    <span className="badge tone-neutral tracking-normal text-fg/85" title={t("domains:access.badgeTitle")}>
      <Lock className="size-3" aria-hidden /> {t("domains:access.only", { sources: parts.join(" + ") })}
    </span>
  );
}

const parseIps = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Erişim seçimi. value null = herkese açık */
export function AccessEditor({ value, onChange }: { value: DomainAccess; onChange: (v: DomainAccess) => void }) {
  const [ipText, setIpText] = useState((value?.ips ?? []).join("\n"));
  useEffect(() => setIpText((value?.ips ?? []).join("\n")), [value?.ips.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = (restricted: boolean, label: string, Icon: typeof Globe) => (
    <button
      type="button"
      onClick={() => onChange(restricted ? (value ?? { tailnet: true, ips: [] }) : null)}
      aria-pressed={!!value === restricted}
      className="flex flex-1 items-center justify-center gap-2"
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="segmented flex-nowrap">
        {option(false, t("domains:access.public"), Globe)}
        {option(true, t("domains:access.restricted"), Lock)}
      </div>
      {value && (
        <div className="space-y-3 rounded-lg border border-line bg-canvas/40 p-3">
          <label className="check-row items-start text-sm text-fg/85">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.tailnet}
              onChange={(e) => onChange({ ...value, tailnet: e.target.checked })}
            />
            <span>
              {t("domains:access.tailnet")}
              <span className="block text-xs text-subtle">{t("domains:access.tailnetHint")}</span>
            </span>
          </label>
          <div>
            <label className="block">
              <span className="label">{t("domains:access.extraIps")}</span>
            <textarea
              className="input h-20 font-mono text-xs"
              placeholder={"203.0.113.10\n203.0.113.0/24"}
              value={ipText}
              onChange={(e) => setIpText(e.target.value)}
              onBlur={() => onChange({ ...value, ips: parseIps(ipText) })}
            />
            </label>
            <p className="hint">
              {t("domains:access.extraIpsHint")}
            </p>
          </div>
          {!value.tailnet && !parseIps(ipText).length && <p className="text-xs text-danger">{t("domains:access.needSource")}</p>}
        </div>
      )}
    </div>
  );
}

/** "Sadece Tailscale" domainleri için gereken tek seferlik Tailscale DNS ayarı ve durumu */
export function TailnetSetup({ compact = false }: { compact?: boolean }) {
  const { data } = useSettings();
  const tn = data?.tailnet;
  if (!tn) return null;

  if (!tn.ipv4 && !tn.ipv6) {
    return (
      <div className="notice notice-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <div className="font-medium">{t("domains:tailnet.missingTitle")}</div>
          <div className="mt-1 text-warning/75">
            {t("domains:tailnet.missing.before")}
            <code>deploy/.env</code>
            {t("domains:tailnet.missing.file")}
            <code>TAILSCALE_IPV4</code>
            {t("domains:tailnet.missing.and")}
            <code>TAILSCALE_IPV6</code>
            {t("domains:tailnet.missing.values")}
            <code>tailscale ip -4</code> / <code>tailscale ip -6</code>
            {t("domains:tailnet.missing.then")}
            <code>docker compose up -d</code>
            {t("domains:tailnet.missing.after")}
          </div>
        </div>
      </div>
    );
  }

  // Bir kez bile sorgu geldiyse Tailscale tarafındaki ayar yapılmış demektir
  const active = !!tn.lastQueryAt;
  if (compact && active) return null;
  const zones = tn.zones.length ? tn.zones : [data!.baseDomain];

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised text-sm" aria-labelledby="ts-dns-title">
      <div className="card-head flex-wrap">
        <h3 id="ts-dns-title" className="cap flex items-center gap-2">
          <Network className="size-3.5" aria-hidden /> {t("domains:tailnet.title")}
        </h3>
        {!tn.dnsRunning ? (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-danger">
            <span className="dot dot-urgent-solid" aria-hidden /> {t("domains:tailnet.dnsDown")}
            {tn.dnsError ? `: ${tn.dnsError}` : ""}
          </span>
        ) : active ? (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-fg">
            <span className="dot dot-ok" aria-hidden /> {t("domains:tailnet.active", { ago: timeAgo(tn.lastQueryAt!) })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-warning">
            <span className="dot dot-look" aria-hidden /> {t("domains:tailnet.noQuery")}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5">
      <p className="text-muted">
        {t("domains:tailnet.intro")}
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-fg/85 marker:font-mono marker:text-xs marker:text-faint">
        <li>
          <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noreferrer" className="link">
            {t("domains:tailnet.consoleLink")}
          </a>{" "}
          → Nameservers → <b>Add nameserver → Custom…</b>
        </li>
        <li>
          {t("domains:tailnet.nameserver")} <code className="rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs">{tn.ipv4 ?? tn.ipv6}</code>
        </li>
        <li>
          {t("domains:tailnet.restrictBefore")}
          <b>Restrict to domain</b>
          {t("domains:tailnet.restrictAfter")}{" "}
          {zones.map((z) => (
            <code key={z} className="mr-1 rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs">
              {z}
            </code>
          ))}
        </li>
      </ol>
      <div className="rounded-md border border-line-soft bg-canvas/40 px-3.5 py-3 text-xs text-muted">
        <div className="cap mb-1.5">{t("domains:tailnet.whenTitle")}</div>
        {t("domains:tailnet.when")}
        {!active && (
          <>
            {" "}
            {t("domains:tailnet.stuck.before")}
            <b className="font-semibold text-fg">Use Tailscale DNS</b>
            {t("domains:tailnet.stuck.middle")}
            <code className="font-mono">tailscale up --accept-dns</code>
            {t("domains:tailnet.stuck.after")}
          </>
        )}
      </div>
      <p className="text-xs text-subtle">
        {t("domains:tailnet.others")}
      </p>
      </div>
    </section>
  );
}
