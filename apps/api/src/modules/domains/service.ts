import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { asc } from "drizzle-orm";
import type { DomainCheck, DomainOverview, DnsStatus } from "@panel/shared";
import { domainToUnicode } from "node:url";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { HttpError } from "../projects/service.js";
import { panelDate, pt } from "../../lib/i18n.js";

/**
 * Domain DNS/SSL kontrolleri. Kendi aldığınız bir domaini (ornek.com) bağlarken
 * DNS kaydının bu sunucuyu gösterip göstermediğini ve Caddy'nin sertifika alıp
 * almadığını panelden görebilmek için.
 */

// Sunucunun genel IP'si sadece PUBLIC_IP ortam değişkeninden gelir (dış servise istek atılmaz)
const publicIps: string[] = config.publicIps.filter((ip) => net.isIP(ip));

/** Açılışta PUBLIC_IP'yi kontrol edip uyarı yazar */
export function checkPublicIpConfig(log: { warn: (m: string) => void; info: (m: string) => void }) {
  const invalid = config.publicIps.filter((ip) => !net.isIP(ip));
  if (invalid.length) log.warn(`Ignored invalid address(es) in PUBLIC_IP: ${invalid.join(", ")}`);
  if (publicIps.length) log.info(`Server public IP: ${publicIps.join(", ")}`);
  else log.warn("PUBLIC_IP is not set; domain DNS checks can't give a result.");
}

export function overview(): DomainOverview {
  const projects = new Map(db.select().from(schema.projects).all().map((p) => [p.id, p.name]));
  const rows = db.select().from(schema.domains).orderBy(asc(schema.domains.hostname)).all();
  const primary = new Map<number, string>();
  for (const d of [...rows].sort((a, b) => a.id - b.id)) {
    if (d.kind === "route" && !primary.has(d.projectId)) primary.set(d.projectId, d.hostname);
  }
  return {
    publicIps,
    baseDomain: config.baseDomain,
    // Tailscale modunda panel adresi internette değil; DNS/SSL kontrolü anlamsız
    panelDomain: config.panelAccess === "public" ? config.panelDomain : null,
    panelAccess: config.panelAccess,
    webhookDomain: config.webhookDomain,
    https: config.caddy.https,
    domains: rows.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      display: domainToUnicode(d.hostname) || d.hostname,
      kind: d.kind,
      access: d.access ?? null,
      target: d.target ?? null,
      createdAt: d.createdAt,
      projectId: d.projectId,
      projectName: projects.get(d.projectId) ?? "?",
      primaryHostname: primary.get(d.projectId) ?? null,
    })),
  };
}

// Cloudflare "proxy" (turuncu bulut) açıksa DNS Cloudflare IP'si döner; bu da çalışır
const CLOUDFLARE_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const cfList = new net.BlockList();
for (const c of CLOUDFLARE_V4) {
  const [ip, bits] = c.split("/");
  cfList.addSubnet(ip!, Number(bits), "ipv4");
}

// Let's Encrypt'in göreceği gibi genel DNS'e sor (yerel önbellek/ağ DNS'i yanıltmasın)
const publicResolver = new dns.Resolver({ timeout: 3000, tries: 2 });
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);
const systemResolver = new dns.Resolver({ timeout: 3000, tries: 2 });

async function resolveAll(hostname: string) {
  const addresses: string[] = [];
  let notFound = 0;
  let networkError = false;
  for (const type of ["A", "AAAA"] as const) {
    let lastErr: string | undefined;
    for (const r of [publicResolver, systemResolver]) {
      try {
        addresses.push(...(type === "A" ? await r.resolve4(hostname) : await r.resolve6(hostname)));
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = (err as NodeJS.ErrnoException).code;
        // Kesin yanıt: kayıt yok. Diğer çözücüyü denemeye gerek yok
        if (lastErr === "ENOTFOUND" || lastErr === "ENODATA") break;
      }
    }
    if (lastErr === "ENOTFOUND" || lastErr === "ENODATA") notFound++;
    else if (lastErr) networkError = true;
  }
  return { addresses: [...new Set(addresses)], notFound: notFound > 0 && !networkError };
}

async function checkDns(hostname: string): Promise<DomainCheck["dns"]> {
  const { addresses, notFound } = await resolveAll(hostname);
  const status: DnsStatus = !addresses.length
    ? notFound
      ? "missing"
      : "unknown"
    : !publicIps.length
      ? "unknown"
      : addresses.some((a) => publicIps.includes(a))
        ? "ok"
        : addresses.every((a) => net.isIPv4(a) && cfList.check(a, "ipv4"))
          ? "proxied"
          : "wrong";

  const ipText = publicIps.join(" / ") || pt("messages:domains.serverIp");
  const message = {
    ok: () => pt("messages:domains.dnsOk"),
    proxied: () => pt("messages:domains.dnsProxied"),
    wrong: () => pt("messages:domains.dnsWrong", { addresses: addresses.join(", "), ip: ipText }),
    missing: () => pt("messages:domains.dnsMissing", { ip: ipText }),
    unknown: () => pt(publicIps.length ? "messages:domains.dnsUnknown" : "messages:domains.dnsNoPublicIp"),
  }[status]();
  return { status, addresses, message };
}

function checkTls(hostname: string): Promise<DomainCheck["tls"]> {
  return new Promise((resolve) => {
    // Caddy'ye iç ağdan, bu domainin adıyla (SNI) bağlan ve sunduğu sertifikaya bak
    const socket = tls.connect({ host: config.caddy.tlsHost, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 6000 });
    const done = (v: DomainCheck["tls"]) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const identityErr = cert?.subject ? tls.checkServerIdentity(hostname, cert) : new Error("no certificate");
      const ok = socket.authorized && !identityErr;
      const issuer = cert?.issuer?.O ?? cert?.issuer?.CN ?? null;
      const validTo = cert?.valid_to ? Date.parse(cert.valid_to) : null;
      done({
        ok,
        issuer: issuer ? String(issuer) : null,
        validTo,
        message: ok
          ? pt("messages:domains.tlsValid", { issuer, until: validTo ? panelDate(validTo) : "?" })
          : pt("messages:domains.tlsMissing", { reason: socket.authorizationError ? ` (${socket.authorizationError})` : "" }),
      });
    });
    socket.once("timeout", () => done({ ok: false, issuer: null, validTo: null, message: pt("messages:domains.tlsTimeout") }));
    socket.once("error", (e) => done({ ok: false, issuer: null, validTo: null, message: pt("messages:domains.tlsError", { error: e.message }) }));
  });
}

export async function checkDomain(hostname: string): Promise<DomainCheck> {
  // Panel'i rastgele adresler için DNS/TLS sorgu aracı olarak kullandırma
  const known = (config.panelAccess === "public" && hostname === config.panelDomain) || hostname === config.webhookDomain || db.select().from(schema.domains).all().some((d) => d.hostname === hostname);
  if (!known) throw new HttpError(404, "errors:domain.unknown");
  const [dnsRes, tlsRes] = await Promise.all([checkDns(hostname), config.caddy.https ? checkTls(hostname) : Promise.resolve(null)]);
  return { hostname, dns: dnsRes, tls: tlsRes };
}
