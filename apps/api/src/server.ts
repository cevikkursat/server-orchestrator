import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import sjson from "secure-json-parse";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { requestLanguage, translate } from "./lib/i18n.js";
import { authPlugin } from "./modules/auth/routes.js";
import { systemRoutes } from "./modules/system/routes.js";
import { containerRoutes } from "./modules/containers/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { githubRoutes } from "./modules/github/routes.js";
import { databaseRoutes } from "./modules/databases/routes.js";
import { explorerRoutes } from "./modules/explorer/routes.js";
import { offsiteRoutes } from "./modules/offsite/routes.js";
import { recoveryRoutes } from "./modules/recovery/routes.js";
import { backupRoutes } from "./modules/backups/routes.js";
import { cronRoutes } from "./modules/cron/routes.js";
import { notifyRoutes } from "./modules/notify/routes.js";
import { terminalRoutes } from "./modules/terminal/routes.js";
import { metricsRoutes } from "./modules/metrics/routes.js";
import { securityPlugin } from "./modules/security/plugin.js";
import { securityRoutes } from "./modules/security/routes.js";
import { envGroupRoutes } from "./modules/envgroups/routes.js";
import { maintenanceRoutes } from "./modules/maintenance/routes.js";
import { updaterRoutes } from "./modules/updater/routes.js";
import { ZodError } from "zod";

export async function buildServer() {
  const app = Fastify({
    logger: true,
    // Caddy (docker ağı) arkasında gerçek istemci IP'sini al
    // Sadece panel-internal ağındaki Caddy'ye güven; uygulama container'ları
    // X-Forwarded-For ile sahte IP gönderemesin (bkz. deploy/docker-compose.yml)
    // Tailscale modunda zincir: tailnet IP → (Docker ağ geçidi) → Caddy → panel; ağ geçitleri de
    // güvenilir sayılmalı ki gerçek tailnet IP'si görünsün. Ağ kapısı ayrıca bağlantı kaynağına bakar.
    trustProxy: config.isProd ? [process.env.TRUSTED_PROXY ?? "172.30.0.0/24", "172.30.0.1", "172.31.0.1"] : false,
  });

  // Tüm hataları arayüzün beklediği { error } biçimine çevir
  // Mesajlar çeviri anahtarıdır; isteğin diline (Accept-Language) çevrilir
  app.setErrorHandler((err: Error & { statusCode?: number; params?: Record<string, unknown> }, req, reply) => {
    const lng = requestLanguage(req);
    // Route içinde .parse() ile yakalanan doğrulama hataları
    if (err instanceof ZodError) return reply.code(400).send({ error: translate(lng, err.issues[0]?.message ?? "errors:invalidRequest") });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 && config.isProd ? translate(lng, "errors:serverError") : translate(lng, err.message, err.params) });
  });

  // Boş gövdeli JSON isteklerini (ör. Content-Type'lı DELETE) {} say.
  // secure-json-parse: __proto__ / constructor ile prototype poisoning'i engeller.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (body === "") return done(null, {});
    try {
      done(null, sjson.parse(body as string, null, { protoAction: "error", constructorAction: "error" }));
    } catch {
      done(Object.assign(new Error("errors:invalidJson"), { statusCode: 400 }), undefined);
    }
  });

  await app.register(cookie);
  // Ağ kapısı, IP izin listesi, origin kontrolü, güvenlik başlıkları (her şeyden önce)
  await app.register(securityPlugin);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      // Eklenti bunu hata olarak fırlatır; panelin hata işleyicisi `message` alanını { error } yapar
      message: "errors:tooManyRequests",
      params: { seconds: Math.ceil(ctx.ttl / 1000) },
    }),
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get("/api/health", async () => ({ ok: true }));
  await app.register(authPlugin);
  await app.register(systemRoutes);
  await app.register(containerRoutes);
  await app.register(projectRoutes);
  await app.register(githubRoutes);
  await app.register(databaseRoutes);
  await app.register(explorerRoutes);
  await app.register(backupRoutes);
  await app.register(offsiteRoutes);
  await app.register(recoveryRoutes);
  await app.register(cronRoutes);
  await app.register(notifyRoutes);
  await app.register(terminalRoutes);
  await app.register(metricsRoutes);
  await app.register(securityRoutes);
  await app.register(envGroupRoutes);
  await app.register(maintenanceRoutes);
  await app.register(updaterRoutes);

  // Üretimde derlenmiş arayüzü aynı sunucudan ver (SPA fallback ile)
  if (config.webDist && fs.existsSync(path.join(config.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: translate(requestLanguage(req), "errors:notFound") });
    });
  }

  return app;
}
