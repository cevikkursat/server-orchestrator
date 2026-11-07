import http from "node:http";
import { asc } from "drizzle-orm";
import type { DomainAccess, DomainTarget } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { pt } from "../../lib/i18n.js";

/**
 * Caddy entegrasyonu.
 *
 * Panelin veritabanı tek doğruluk kaynağıdır: her değişiklikte TÜM Caddy ayarı
 * DB'den yeniden üretilip /load ile yüklenir. Caddy hatalı ayarı reddeder ve
 * eski ayarla çalışmaya devam eder. Caddy `--resume` ile başlatıldığı için
 * panel kapalıyken yeniden başlasa bile son yüklenen ayarla açılır.
 */

// ---- Admin API istemcisi (unix socket veya http) ----
function caddyRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const url = config.caddy.adminUrl;
  const target = url.startsWith("unix:")
    ? { socketPath: url.slice("unix:".length), path }
    : (() => {
        const u = new URL(url);
        return { hostname: u.hostname, port: u.port, path };
      })();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...target,
        method,
        timeout: 15_000,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          // http admin'de origin kontrolü için
          ...("hostname" in target ? { Host: `${target.hostname}:${target.port}` } : { Host: "caddy" }),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Caddy admin API timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- Ayar üretimi ----
type Route = Record<string, unknown>;

const SECURITY_HEADERS = {
  handler: "headers",
  response: {
    set: {
      "Strict-Transport-Security": ["max-age=31536000; includeSubDomains"],
      "X-Content-Type-Options": ["nosniff"],
      "X-Frame-Options": ["DENY"],
      "Referrer-Policy": ["same-origin"],
    },
    delete: ["Server"],
  },
};

const text = (status: number, body: string): Route => ({
  handler: "static_response",
  status_code: status,
  headers: { "Content-Type": ["text/plain; charset=utf-8"] },
  body,
});

/**
 * Panele giden her isteğe hangi kapıdan geldiğini yazan başlık. İstemcinin gönderdiği
 * değer her zaman ezilir; panel "webhook" kapısından gelene webhook dışında izin vermez.
 */
export const ENTRY_HEADER = "X-Panel-Entry";
const toPanel = (entry: "panel" | "webhook") => ({
  handler: "reverse_proxy",
  upstreams: [{ dial: config.panelUpstream }],
  headers: { request: { set: { [ENTRY_HEADER]: [entry] } } },
});

export function buildCaddyConfig() {
  const scheme = config.caddy.https ? "https" : "http";
  const routes: Route[] = [];
  const servers: Record<string, unknown> = {};

  if (config.panelUpstream) {
    // Panelin tam arayüzü: ya internete açık domain ya da sadece Tailscale'den gelen özel port
    if (config.panelAccess === "public" && config.panelDomain) {
      routes.push({
        match: [{ host: [config.panelDomain] }],
        handle: [...(config.caddy.https ? [SECURITY_HEADERS] : []), { handler: "encode", encodings: { zstd: {}, gzip: {} } }, toPanel("panel")],
        terminal: true,
      });
    }
    if (config.panelAccess === "tailscale") {
      servers.panel = {
        // Host'ta sadece 127.0.0.1'e açılır; önünde `tailscale serve` (HTTPS) durur
        listen: [`:${config.caddy.privatePort}`],
        automatic_https: { disable: true },
        // Sadece sunucunun kendisinden gelen tailscale serve'ün X-Forwarded-For'una güven
        trusted_proxies: { source: "static", ranges: config.caddy.privateSources },
        routes: [
          {
            // Bağlantının GERÇEK kaynağına bakılır (başlıkla taklit edilemez). Aynı Docker
            // ağındaki uygulama container'ları caddy:8080'e bağlanabilse de burada reddedilir.
            match: [{ remote_ip: { ranges: config.caddy.privateSources } }],
            handle: [SECURITY_HEADERS, { handler: "encode", encodings: { zstd: {}, gzip: {} } }, toPanel("panel")],
            terminal: true,
          },
          { handle: [text(403, pt("messages:caddy.accessDenied"))] },
        ],
      };
    }
    // GitHub webhook'u: internete açık tek panel adresi, sadece bu yol
    if (config.webhookDomain) {
      routes.push(
        { match: [{ host: [config.webhookDomain], path: ["/api/github/webhook"] }], handle: [toPanel("webhook")], terminal: true },
        { match: [{ host: [config.webhookDomain] }], handle: [text(404, pt("messages:caddy.notFound"))], terminal: true },
      );
    }
  }

  routes.push(...siteRoutes("public", scheme));
  // Tanımsız host'lar
  routes.push({ handle: [text(404, pt("messages:caddy.noApp"))] });

  // Tailscale girişi: tailscale serve --tcp=443 --proxy-protocol=2 → 127.0.0.1:8443 → burası.
  // TLS'i Caddy çözer; PROXY başlığı sadece sunucunun kendisinden (tailscaled) kabul edilir.
  if (config.panelAccess === "tailscale" || tailnetConfigured()) {
    const tailnetRoutes: Route[] = [];
    if (config.panelUpstream && config.panelAccess === "tailscale" && config.panelDomain) {
      tailnetRoutes.push({
        match: [{ host: [config.panelDomain], remote_ip: { ranges: config.tailnet.ranges } }],
        handle: [SECURITY_HEADERS, { handler: "encode", encodings: { zstd: {}, gzip: {} } }, toPanel("panel")],
        terminal: true,
      });
    }
    tailnetRoutes.push(...siteRoutes("tailnet", "https"), { handle: [text(404, pt("messages:caddy.noApp"))] });
    servers.tailnet = {
      listen: [`:${config.caddy.tailnetPort}`],
      listener_wrappers: [
        { wrapper: "proxy_protocol", timeout: "5s", allow: config.caddy.privateSources, fallback_policy: "reject" },
        { wrapper: "tls" },
      ],
      // Bu port sadece Tailscale'den gelir; 80'den yönlendirme gerekmez
      automatic_https: { disable_redirects: true },
      // tailscale serve sadece TCP aktarır: HTTP/3 (UDP) önerilmesin, tarayıcı boşuna denemesin
      protocols: ["h1", "h2"],
      routes: tailnetRoutes,
      errors: { routes: [{ handle: [text(502, pt("messages:caddy.unreachable"))] }] },
    };
  }

  const server: Record<string, unknown> = {
    listen: config.caddy.https ? [":443"] : [":80"],
    routes,
    // Caddy'nin 502 vb. hatalarını sade bir mesaja çevir
    errors: {
      routes: [{ handle: [text(502, pt("messages:caddy.unreachable"))] }],
    },
  };
  if (!config.caddy.https) server.automatic_https = { disable: true };

  // Sertifikalar: panelin .ts.net adı tailscaled'den (soket Caddy'ye bağlı), diğerleri Let's Encrypt.
  // Sadece Tailscale'e açık domainler de genel DNS'te bu sunucuyu gösterdiği için HTTP-01 ile alınır.
  const policies: Record<string, unknown>[] = [];
  if (servers.tailnet && config.panelAccess === "tailscale" && config.panelDomain) {
    policies.push({ subjects: [config.panelDomain], get_certificate: [{ via: "tailscale" }] });
  }
  if (config.caddy.https && config.caddy.acmeEmail) policies.push({ issuers: [{ module: "acme", email: config.caddy.acmeEmail }] });

  return {
    admin: {
      listen: config.caddy.adminListen,
      ...(config.caddy.adminOrigins.length ? { origins: config.caddy.adminOrigins } : {}),
    },
    apps: {
      http: { servers: { main: server, ...servers } },
      ...(policies.length ? { tls: { automation: { policies } } } : {}),
    },
  };
}

export const tailnetConfigured = () => !!(config.tailnet.ipv4 || config.tailnet.ipv6);

/**
 * Bir domainin bu girişte kimlere açık olduğu. null: herkese.
 * Genel girişte sadece listedeki IP'ler; Tailscale girişinde ayrıca Tailscale cihazları.
 */
export function allowedRanges(access: DomainAccess, entry: "public" | "tailnet"): string[] | null {
  if (!access) return null;
  return entry === "tailnet" && access.tailnet ? [...config.tailnet.ranges, ...access.ips] : access.ips;
}

/** 403 sayfası; sorunu anlamak için bağlantının geldiği adres ve giriş de yazılır */
const denied = (access: NonNullable<DomainAccess>, entry: "public" | "tailnet") =>
  text(
    403,
    pt(access.tailnet ? "messages:caddy.deniedTailnet" : "messages:caddy.deniedIp") +
      "\n\n" +
      // {http.request.remote.host}: Caddy yer tutucusu, isteğin geldiği adresle doldurulur
      pt("messages:caddy.deniedDiagnostics", {
        address: "{http.request.remote.host}",
        entry: entry === "tailnet" ? "Tailscale" : pt("messages:caddy.entryInternet"),
      }) +
      (access.tailnet && entry === "public" ? "\n\n" + pt("messages:caddy.deniedViaInternet") : ""),
  );

/** Projelerin route'ları. Aynı projede erişimi farklı domainler ayrı gruplanır. */
function siteRoutes(entry: "public" | "tailnet", scheme: string): Route[] {
  const routes: Route[] = [];
  const projects = db.select().from(schema.projects).orderBy(asc(schema.projects.id)).all();
  const allDomains = db.select().from(schema.domains).orderBy(asc(schema.domains.id)).all();

  // Aynı erişim kuralına sahip host'ları tek route'ta topla; kısıtlıysa önce izinli kaynaklar, sonra 403
  const guarded = (hosts: string[], access: DomainAccess, handle: Route[]) => {
    const ranges = allowedRanges(access, entry);
    if (ranges === null) return [{ match: [{ host: hosts }], handle, terminal: true }];
    const out: Route[] = [];
    if (ranges.length) out.push({ match: [{ host: hosts, remote_ip: { ranges } }], handle, terminal: true });
    out.push({ match: [{ host: hosts }], handle: [denied(access!, entry)], terminal: true });
    return out;
  };
  const groupByAccess = (doms: typeof allDomains) => {
    const groups = new Map<string, { access: DomainAccess; hosts: string[] }>();
    for (const d of doms) {
      const key = JSON.stringify(d.access ?? null);
      if (!groups.has(key)) groups.set(key, { access: d.access ?? null, hosts: [] });
      groups.get(key)!.hosts.push(d.hostname);
    }
    return [...groups.values()];
  };

  const byId = new Map(projects.map((p) => [p.id, p]));
  const proxyTo = (p: (typeof projects)[number] | undefined, port: number): Route =>
    p?.currentContainer
      ? { handler: "reverse_proxy", upstreams: [{ dial: `${p.currentContainer}:${port}` }] }
      : text(503, pt(p ? "messages:caddy.notDeployed" : "messages:caddy.targetMissing"));
  /** Domain hedefi: varsayılan port + yol önekine göre kurallar (en uzun önek önce) */
  const targetHandle = (p: (typeof projects)[number], target: DomainTarget | null): Route[] => {
    const fallback = proxyTo(p, target?.port ?? p.port);
    if (!target?.rules.length) return [fallback];
    const rules = [...target.rules].sort((a, b) => b.prefix.length - a.prefix.length);
    return [
      {
        handler: "subroute",
        routes: [
          ...rules.map((r) => {
            const tp = r.projectId == null ? p : byId.get(r.projectId);
            return {
              match: [{ path: [r.prefix, `${r.prefix}/*`] }],
              handle: [...(r.strip ? [{ handler: "rewrite", strip_path_prefix: r.prefix }] : []), proxyTo(tp, r.port ?? tp?.port ?? p.port)],
              terminal: true,
            };
          }),
          { handle: [fallback] },
        ],
      },
    ];
  };

  for (const p of projects) {
    const doms = allDomains.filter((d) => d.projectId === p.id);
    const routeDoms = doms.filter((d) => d.kind === "route");
    if (!routeDoms.length) continue;
    const primary = routeDoms[0]!.hostname;

    // Aynı erişim kuralı + aynı hedef → tek route
    const byTarget = new Map<string, typeof routeDoms>();
    for (const d of routeDoms) {
      const k = JSON.stringify(d.target ?? null);
      if (!byTarget.has(k)) byTarget.set(k, []);
      byTarget.get(k)!.push(d);
    }
    for (const group of byTarget.values()) {
      const handle = targetHandle(p, group[0]!.target ?? null);
      for (const g of groupByAccess(group)) routes.push(...guarded(g.hosts, g.access, handle));
    }

    const redirect: Route = {
      handler: "static_response",
      status_code: 308,
      // HTTPS yokken (geliştirme, Caddy :8080'de) istekteki portu koru
      headers: { Location: [`${scheme}://${primary}${config.caddy.https ? "" : ":{http.request.port}"}{http.request.uri}`] },
    };
    for (const g of groupByAccess(doms.filter((d) => d.kind === "redirect"))) routes.push(...guarded(g.hosts, g.access, [redirect]));
  }
  return routes;
}

// ---- Senkronizasyon ----
const state = { reachable: false, error: null as string | null, lastSyncAt: null as number | null };
let chain: Promise<void> = Promise.resolve();

/** Ayarı yükler. Aynı anda gelen çağrılar sıraya girer. Hata fırlatır. */
export function syncCaddy(): Promise<void> {
  const run = async () => {
    let rejected = false;
    try {
      const res = await caddyRequest("POST", "/load", buildCaddyConfig());
      if (res.status >= 400) {
        // Caddy JSON hata döner: {"error":"..."}
        let msg = res.body;
        try {
          msg = (JSON.parse(res.body) as { error?: string }).error ?? res.body;
        } catch {}
        rejected = true;
        throw new Error(pt("messages:caddy.rejected", { error: msg }));
      }
      Object.assign(state, { reachable: true, error: null, lastSyncAt: Date.now() });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      const msg = ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(e.code ?? "")
        ? pt("messages:caddy.adminUnreachable", { url: config.caddy.adminUrl })
        : e.message;
      Object.assign(state, { reachable: rejected, error: msg });
      throw new Error(msg);
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export function caddyStatus() {
  return { ...state };
}

/** Açılışta Caddy hazır olana kadar dener (Caddy panelden sonra başlayabilir) */
export function syncCaddyWithRetry(log: { warn: (m: string) => void; info: (m: string) => void }) {
  let attempt = 0;
  const tryOnce = () => {
    syncCaddy()
      .then(() => log.info("Caddy config synced"))
      .catch((e: Error) => {
        attempt++;
        const delay = Math.min(30_000, 2000 * attempt);
        if (attempt <= 3 || attempt % 10 === 0) log.warn(`${e.message}. Retrying in ${delay / 1000} s.`);
        setTimeout(tryOnce, delay).unref();
      });
  };
  tryOnce();
}
