import net from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../../config.js";
import { getSecret } from "../../lib/settings.js";
import type { SecuritySettings } from "@panel/shared";
import { rt } from "../../lib/i18n.js";

/**
 * Panel geneli güvenlik katmanları (tüm isteklerden önce çalışır):
 *
 * 1. Ağ kapısı (production): Panel'e sadece panel-internal ağındaki Caddy ve container'ın
 *    kendisi (healthcheck) bağlanabilir. Aynı Docker ağındaki uygulama container'ları panel
 *    API'sine doğrudan ulaşamaz.
 * 2. IP izin listesi (isteğe bağlı): Tanımlıysa panel sadece bu IP'lerden açılır.
 *    GitHub webhook'u hariç (GitHub'ın kendi IP'lerinden gelir, imzayla doğrulanır).
 * 3. Origin kontrolü: Değişiklik yapan isteklerde (POST/PUT/DELETE) tarayıcı başka bir
 *    siteden geliyorsa reddet (CSRF'e karşı SameSite cookie'ye ek savunma).
 * 4. Güvenlik başlıkları: CSP, clickjacking, MIME sniffing vb.
 */

export const SECURITY_KEY = "security";
export const getSecuritySettings = (): SecuritySettings => getSecret<SecuritySettings>(SECURITY_KEY) ?? { ipAllowlist: [] };

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) → 1.2.3.4 */
export const normalizeIp = (ip: string) => (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip);

export function buildBlockList(entries: string[]) {
  const list = new net.BlockList();
  for (const e of entries) {
    const [ip, bits] = e.split("/");
    const type = net.isIPv6(ip!) ? "ipv6" : "ipv4";
    if (bits !== undefined) list.addSubnet(ip!, Number(bits), type);
    else list.addAddress(ip!, type);
  }
  return list;
}

export function ipAllowed(ip: string, entries: string[]) {
  if (!entries.length) return true;
  const n = normalizeIp(ip);
  return buildBlockList(entries).check(n, net.isIPv6(n) ? "ipv6" : "ipv4");
}

// İzin listesi her istekte DB'den okunmasın
let cache: { at: number; list: string[] } = { at: 0, list: [] };
export function invalidateSecurityCache() {
  cache = { at: 0, list: [] };
}
function allowlist() {
  if (Date.now() - cache.at > 10_000) cache = { at: Date.now(), list: getSecuritySettings().ipAllowlist };
  return cache.list;
}

const trustedNet = (() => {
  const l = new net.BlockList();
  for (const e of (process.env.TRUSTED_PROXY ?? "172.30.0.0/24").split(",")) {
    const [ip, bits] = e.trim().split("/");
    if (ip && bits) l.addSubnet(ip, Number(bits), net.isIPv6(ip) ? "ipv6" : "ipv4");
  }
  l.addAddress("127.0.0.1", "ipv4");
  l.addAddress("::1", "ipv6");
  return l;
})();

const IP_EXEMPT = new Set(["/api/github/webhook", "/api/health"]);
const pathOf = (req: FastifyRequest) => req.url.split("?")[0]!;

function originOk(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin) return true; // tarayıcı dışı istemci veya aynı site GET
  try {
    const host = new URL(origin).host;
    return (
      host === req.headers.host ||
      // tailscale serve gibi bir proxy Host başlığını değiştirse de panelin kendi adresi geçerli
      (!!config.panelDomain && host === config.panelDomain) ||
      (!config.isProd && /^localhost(:\d+)?$/.test(host))
    );
  } catch {
    return false;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // xterm.js ve React satır içi stil kullanır
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  // GitHub App manifest formu github.com'a POST edilir
  "form-action 'self' https://github.com",
].join("; ");

export const securityPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (req, reply) => {
    // 1) Ağ kapısı: X-Forwarded-For'a değil, gerçek TCP bağlantısının kaynağına bakılır
    if (config.isProd) {
      const remote = normalizeIp(req.socket.remoteAddress ?? "");
      if (!trustedNet.check(remote, net.isIPv6(remote) ? "ipv6" : "ipv4")) {
        return reply.code(403).send({ error: rt(req, "errors:common.accessDenied") });
      }
      // 1b) Kapı kontrolü: Caddy her isteğe hangi kapıdan geldiğini yazar (istemci değeri ezilir).
      //     İnternete açık webhook kapısından gelen istek webhook dışında hiçbir şeye ulaşamaz.
      const entry = req.headers["x-panel-entry"];
      const loopback = remote === "127.0.0.1" || remote === "::1";
      if (entry === "webhook") {
        if (pathOf(req) !== "/api/github/webhook") return reply.code(404).send({ error: rt(req, "errors:notFound") });
      } else if (entry !== "panel" && !loopback) {
        return reply.code(403).send({ error: rt(req, "errors:common.accessDenied") });
      }
    }
    // 2) IP izin listesi (req.ip: Caddy'nin ilettiği gerçek istemci IP'si)
    if (!IP_EXEMPT.has(pathOf(req)) && !ipAllowed(req.ip, allowlist())) {
      return reply.code(403).type("text/plain; charset=utf-8").send(rt(req, "errors:security.ipNotAllowed"));
    }
    // 3) Değişiklik yapan isteklerde origin kontrolü
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && pathOf(req) !== "/api/github/webhook" && !originOk(req)) {
      return reply.code(403).send({ error: rt(req, "errors:security.badOrigin") });
    }
  });

  // 4) Güvenlik başlıkları
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    if (config.isProd) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (!pathOf(req).startsWith("/api/")) reply.header("Content-Security-Policy", CSP);
    // API yanıtları (hassas veri içerebilir) önbelleğe alınmasın
    else reply.header("Cache-Control", "no-store");
    return payload;
  });
});
