import fs from "node:fs";
import path from "node:path";

const env = process.env;
const isProd = env.NODE_ENV === "production";
const bool = (v: string | undefined, def: boolean) => (v === undefined ? def : v === "true" || v === "1");

/**
 * Sunucunun saat dilimi. Container'da sunucunun kökü HOST_ROOT'a bağlı: önce /etc/timezone,
 * sonra /etc/localtime bağlantısının hedefi (…/zoneinfo/Europe/Berlin). Okunamazsa UTC.
 */
function hostTimezone(): string | null {
  const root = env.HOST_ROOT ?? "";
  try {
    const tz = fs.readFileSync(`${root}/etc/timezone`, "utf8").trim();
    if (tz) return tz;
  } catch {
    /* yok */
  }
  try {
    const m = /zoneinfo\/(.+)$/.exec(fs.readlinkSync(`${root}/etc/localtime`));
    if (m) return m[1]!;
  } catch {
    /* yok */
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export const config = {
  // Geliştirmede 3100 (3000 başka projelerle sık çakışır); production image PORT=3000 verir
  port: Number(env.PORT ?? (isProd ? 3000 : 3100)),
  // Geliştirmede sadece bu bilgisayar (yerel ağdaki cihazlar erişemesin); container içinde tüm arayüzler
  host: env.HOST ?? (isProd ? "0.0.0.0" : "127.0.0.1"),
  isProd,
  dataDir: path.resolve(env.DATA_DIR ?? "./data"),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Boşsa panelin dilindeki uygulama adı (messages:appName) */
  totpIssuer: env.TOTP_ISSUER || null,
  /** Zamanlanmış işlerin (yedek, cron) saat dilimi */
  timezone: env.TZ_PANEL || hostTimezone() || "UTC",

  /** Yeni projelere önerilen ana domain (ör. ornek.com) */
  baseDomain: env.BASE_DOMAIN ?? "localhost",
  /** Panelin kendi domaini (Tailscale modunda: sunucu.tailXXXX.ts.net) */
  panelDomain: env.PANEL_DOMAIN ?? null,
  /**
   * Panele nasıl erişilir:
   *  - "tailscale": panel internete kapalı; sadece tailnet'ten (tailscale serve → 127.0.0.1:8080)
   *  - "public":    panel PANEL_DOMAIN üzerinden internete açık (2FA ile)
   */
  panelAccess: (env.PANEL_ACCESS === "tailscale" ? "tailscale" : "public") as "tailscale" | "public",
  /** GitHub webhook'larının geldiği, internete açık tek adres (ör. deploy.ornek.com) */
  webhookDomain: env.WEBHOOK_DOMAIN || null,
  /** Sunucunun genel IP adres(ler)i; boşsa açılışta otomatik bulunur */
  publicIps: (env.PUBLIC_IP ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Caddy'nin panele ulaştığı adres (sadece iç ağda tanımlı alias) */
  panelUpstream: env.PANEL_UPSTREAM ?? (isProd ? "panel.internal:3000" : null),

  caddy: {
    /** Panelin Caddy admin API'sine bağlandığı adres: "unix:/yol.sock" veya "http://host:port" */
    adminUrl: env.CADDY_ADMIN ?? (isProd ? "unix:/run/caddy-admin/admin.sock" : "http://localhost:2019"),
    /** Caddy'ye yüklenen ayarda admin'in dinleyeceği adres */
    adminListen: env.CADDY_ADMIN_LISTEN ?? (isProd ? "unix//run/caddy-admin/admin.sock" : "0.0.0.0:2019"),
    adminOrigins: (env.CADDY_ADMIN_ORIGINS ?? (isProd ? "" : "localhost:2019,127.0.0.1:2019")).split(",").filter(Boolean),
    https: bool(env.CADDY_HTTPS, isProd),
    acmeEmail: env.ACME_EMAIL ?? null,
    /** Tailscale modunda panelin Caddy'deki özel portu (host'ta sadece 127.0.0.1'e açılır) */
    privatePort: Number(env.CADDY_PRIVATE_PORT ?? 8080),
    /**
     * Özel porta bağlanmasına izin verilen kaynaklar: sadece sunucunun kendisi (127.0.0.1 ve
     * Docker ağ geçitleri; tailscale serve buradan gelir). Uygulama container'ları REDDEDİLİR.
     * Ağ geçitleri docker-compose.yml'deki sabit alt ağlardan gelir.
     */
    privateSources: (env.CADDY_PRIVATE_SOURCES ?? "127.0.0.1/32,::1/128,172.30.0.1/32,172.31.0.1/32").split(",").map((s) => s.trim()),
    /** SSL durumunu kontrol etmek için panelin bağlandığı Caddy adresi */
    tlsHost: env.CADDY_TLS_HOST ?? "caddy",
    /**
     * Tailscale girişi: `tailscale serve --tcp=443 --proxy-protocol=2` sunucunun Tailscale
     * adreslerindeki 443'ü ham TCP olarak 127.0.0.1:8443'e (bu port) aktarır. Caddy TLS'i
     * kendisi çözer (panel .ts.net + sadece Tailscale'e açık domainler) ve PROXY başlığından
     * gerçek cihaz IP'sini (100.x / fd7a:) öğrenir.
     */
    tailnetPort: Number(env.CADDY_TAILNET_PORT ?? 8443),
  },

  /** Sadece Tailscale'den açılan domainler (boşsa özellik kapalı) */
  tailnet: {
    ipv4: env.TAILSCALE_IPV4 || null,
    ipv6: env.TAILSCALE_IPV6 || null,
    /** Tailscale cihaz adres aralıkları */
    ranges: ["100.64.0.0/10", "fd7a:115c:a1e0::/48"],
    /** Panelin DNS sunucusunun container içindeki portu (host'ta Tailscale IP:53'e bağlanır) */
    dnsPort: Number(env.TAILNET_DNS_PORT ?? (isProd ? 53 : 5354)),
    /** Diğer adları çözmek için genel DNS sunucuları */
    upstream: (env.TAILNET_DNS_UPSTREAM ?? "1.1.1.1,8.8.8.8").split(",").map((s) => s.trim()).filter(Boolean),
  },

  docker: {
    /** Uygulama container'larının bağlandığı ağ (Caddy de bu ağda) */
    appsNetwork: env.APPS_NETWORK ?? "panel-apps",
    /** Panel docker içinde ve apps ağındaysa yeni container'ın portunu TCP ile yoklar */
    panelInDocker: bool(env.PANEL_IN_DOCKER, false),
    readyTimeoutMs: Number(env.DEPLOY_READY_TIMEOUT_MS ?? 60_000),
    /**
     * Docker Compose projelerinin dosyaları. Host'ta ve panel container'ında AYNI yolda olmalı:
     * compose dosyasındaki göreli bağlamalar (./nginx.conf) Docker'a host yolu olarak gider.
     */
    composeDir: path.resolve(env.COMPOSE_DIR ?? (isProd ? "/opt/panel/compose" : "./data/compose")),
  },

  /** Panel güncelleyicisiyle (host'taki systemd servisi) dosya üzerinden konuşulan klasör */
  updaterDir: path.resolve(env.UPDATER_DIR ?? path.join(env.DATA_DIR ?? "./data", "updater")),
};
