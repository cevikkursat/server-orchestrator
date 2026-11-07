import { useQuery } from "@tanstack/react-query";
import { Cloud, Lock, RefreshCw } from "lucide-react";
import type { DnsStatus, DomainCheck, DomainOverview } from "@panel/shared";
import { api } from "../lib/api";
import { t } from "../i18n";

export const useDomainOverview = () =>
  useQuery({ queryKey: ["domains"], queryFn: () => api.get<DomainOverview>("/api/domains"), refetchInterval: 30_000 });

/** Tek bir domainin DNS/SSL kontrol sorgusu; sayfa özeti de aynı anahtarı paylaşır (istek tekrarlanmaz) */
export const domainCheckQuery = (hostname: string) => ({
  queryKey: ["domain-check", hostname],
  queryFn: () => api.get<DomainCheck>(`/api/domains/check?hostname=${encodeURIComponent(hostname)}`),
  staleTime: 60_000,
  // DNS yeni ayarlandıysa sık kontrol et
  refetchInterval: (q: { state: { data?: DomainCheck } }) =>
    q.state.data && q.state.data.dns.status !== "ok" && q.state.data.dns.status !== "proxied" ? 30_000 : (false as const),
});

/** Sertifikanın bitmesine kalan gün (yoksa null) */
export const tlsDaysLeft = (tls: DomainCheck["tls"]) => (tls?.validTo ? Math.max(0, Math.floor((tls.validTo - Date.now()) / 86_400_000)) : null);

// Durum her zaman işaret + yazıyla (renk tek başına anlam taşımaz)
// Etiketler fonksiyon: dil değişince yeniden okunur
const dnsUi: Record<DnsStatus, { dot: string; label: () => string; text: string }> = {
  ok: { dot: "dot-ok", label: () => t("domains:status.dnsOk"), text: "text-fg" },
  proxied: { dot: "", label: () => "Cloudflare", text: "text-fg" },
  wrong: { dot: "dot-urgent", label: () => t("domains:status.wrongIp"), text: "text-danger" },
  missing: { dot: "dot-urgent", label: () => t("domains:status.missing"), text: "text-danger" },
  unknown: { dot: "dot-none", label: () => t("domains:status.unknown"), text: "text-muted" },
};

/**
 * Bir domainin DNS ve SSL durumu; mesajı gerektiğinde açık yazar.
 * `compact`: sunucu IP'si sayfada zaten gösteriliyorsa (liste) uzun DNS cümlesi yerine kısa özet yazar.
 */
export function DomainStatus({ hostname, detail = false, compact = false }: { hostname: string; detail?: boolean; compact?: boolean }) {
  const { data, isFetching, refetch, error } = useQuery(domainCheckQuery(hostname));

  if (error) return <span className="text-xs text-subtle">{t("domains:status.failed")}</span>;
  if (!data) return <span className="text-xs text-subtle">{t("domains:status.checking")}</span>;

  const d = dnsUi[data.dns.status];
  const bad = data.dns.status === "wrong" || data.dns.status === "missing";
  const showDnsMsg = detail && data.dns.status !== "ok";
  const showTlsMsg = detail && data.tls && !data.tls.ok;
  const days = data.tls?.ok ? tlsDaysLeft(data.tls) : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 font-medium">
        <span className={`inline-flex items-center gap-2 ${d.text}`} title={data.dns.message}>
          {data.dns.status === "proxied" ? <Cloud className="size-3.5 text-success" aria-hidden /> : <span className={`dot ${d.dot}`} aria-hidden />}
          {d.label()}
        </span>
        {data.tls && (
          <span className={`inline-flex items-center gap-2 ${data.tls.ok ? "text-fg" : "text-warning"}`} title={data.tls.message}>
            {data.tls.ok ? <Lock className="size-3.5 text-success" aria-hidden /> : <span className="dot dot-look" aria-hidden />}
            {data.tls.ok ? t("domains:status.sslValid") : t("domains:status.sslWaiting")}
            {days != null && (
              <span className="text-muted">
                · <span className="font-mono text-xs text-fg tabular-nums">{t("domains:status.days", { count: days })}</span>
              </span>
            )}
          </span>
        )}
        {/* Görünen simge küçük; dokunma alanı ::after ile 44px */}
        <button
          className="relative inline-grid size-6 place-items-center rounded-sm text-subtle transition-colors duration-150 after:absolute after:-inset-2.5 hover:text-fg md:after:-inset-1"
          onClick={() => refetch()}
          title={t("domains:status.recheck")}
          aria-label={t("domains:status.recheckFor", { hostname })}
        >
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
        </button>
      </div>
      {showDnsMsg && <p className={`text-xs text-pretty ${bad ? "text-danger" : "text-muted"}`}>{compact ? shortDnsMessage(data.dns) : data.dns.message}</p>}
      {showTlsMsg && <p className="text-xs text-pretty text-muted">{data.tls!.message}</p>}
    </div>
  );
}

function shortDnsMessage(dns: DomainCheck["dns"]): string {
  if (dns.status === "wrong") return t("domains:status.shortWrong", { addresses: dns.addresses.join(", ") });
  if (dns.status === "missing") return t("domains:status.shortMissing");
  return dns.message;
}

/**
 * Yeni bir domaini bağlamak için DNS talimatı.
 * `compact`: kutu içinde, kısa (proje sayfası). `bare`: başlık ve dipnot olmadan yalnız adımlar (Domainler rehberi kendi yan notunu verir).
 */
export function DnsHelp({ ips, compact = false, bare = false }: { ips: string[]; compact?: boolean; bare?: boolean }) {
  const v4 = ips.filter((i) => !i.includes(":"));
  const v6 = ips.filter((i) => i.includes(":"));
  const a = v4.length ? v4 : [t("domains:dnsHelp.serverIp")];
  const rows: [string, string, string][] = [
    ...a.map((ip): [string, string, string] => ["A", "@", ip]),
    ...a.map((ip): [string, string, string] => ["A", "www", ip]),
    ...v6.map((ip): [string, string, string] => ["AAAA", "@", ip]),
    ...v6.map((ip): [string, string, string] => ["AAAA", "www", ip]),
  ];
  return (
    <div className={`${compact ? "rounded-lg border border-line bg-canvas p-3 sm:p-4" : ""} min-w-0 text-sm`}>
      {!bare && <div className="cap mb-2">{t("domains:dnsHelp.title")}</div>}
      <ol className="list-outside list-decimal space-y-2 pl-5 text-fg/90 marker:font-mono marker:text-xs marker:text-faint">
        <li>
          {t("domains:dnsHelp.step1.before")}
          <b className="font-semibold text-fg">{t("domains:dnsHelp.step1.bold")}</b>
          {t("domains:dnsHelp.step1.after")}
        </li>
        <li>
          {t("domains:dnsHelp.step2")}
          <div className="mt-2 max-w-md overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-line font-sans text-[11px] tracking-[0.14em] text-faint uppercase">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t("domains:dnsHelp.colType")}</th>
                  <th className="px-3 py-2 font-semibold">{t("domains:dnsHelp.colHost")}</th>
                  <th className="px-3 py-2 font-semibold">{t("domains:dnsHelp.colValue")}</th>
                </tr>
              </thead>
              <tbody className="text-fg">
                {rows.map(([type, h, ip]) => (
                  <tr key={`${type}-${h}-${ip}`} className="border-b border-line-soft last:border-b-0">
                    <td className="px-3 py-2">{type}</td>
                    <td className="px-3 py-2 text-muted">{h}</td>
                    <td className="px-3 py-2 break-all">{ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </li>
        <li>
          {t("domains:dnsHelp.step3.before")}
          <b className="font-semibold text-fg">{t("domains:dnsHelp.step3.bold")}</b>
          {t("domains:dnsHelp.step3.after")}
        </li>
      </ol>
      {!compact && !bare && (
        <p className="hint mt-3">
          {t("domains:dnsHelp.footnote")}
        </p>
      )}
    </div>
  );
}
