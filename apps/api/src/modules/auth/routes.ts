import type { FastifyInstance, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { languageSchema, loginSchema, setupStartSchema, setupVerifySchema, type AuthStatus } from "@panel/shared";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { notify } from "../notify/service.js";
import * as auth from "./service.js";
import { pt, requestLanguage, rt } from "../../lib/i18n.js";
import { syncCaddy } from "../caddy/service.js";

export const SESSION_COOKIE = "panel_session";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: number; username: string; sessionId: string } | null;
  }
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/setup/start",
  "/api/auth/setup/verify",
  // İmza ile doğrulanır
  "/api/github/webhook",
  // Tek kullanımlık state ile doğrulanır (GitHub'dan çapraz site yönlendirme, cookie gelmez)
  "/api/github/manifest/callback",
]);

// fastify-plugin ile sarıyoruz ki onRequest hook'u tüm uygulamaya uygulansın
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    req.user = auth.getSessionUser(req.cookies[SESSION_COOKIE]);
    const path = req.url.split("?")[0]!;
    if (!req.user && !PUBLIC_ROUTES.has(path)) {
      return reply.code(401).send({ error: rt(req, "errors:auth.sessionRequired") });
    }
  });

  const strictLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.get("/api/auth/status", async (req): Promise<AuthStatus> => ({
    setupRequired: auth.isSetupRequired(),
    authenticated: !!req.user,
    user: req.user ? { id: req.user.id, username: req.user.username, language: auth.userLanguage(req.user.id) } : null,
  }));

  // Arayüz dili: bildirimler ve sunucunun yazdığı metinler de bu dilde olur
  app.put("/api/auth/language", async (req, reply) => {
    const body = parseBody(languageSchema, req.body, reply);
    if (!body) return;
    auth.setUserLanguage(req.user!.id, body.language);
    // Caddy'nin sunduğu erişim reddi / hata sayfaları panelin dilinde
    void syncCaddy().catch(() => {});
    return { ok: true };
  });

  app.post("/api/auth/setup/start", strictLimit, async (req, reply) => {
    const body = parseBody(setupStartSchema, req.body, reply);
    if (!body) return;
    if (!auth.isSetupRequired()) return reply.code(409).send({ error: rt(req, "errors:auth.setupDone") });
    if (!auth.checkSetupToken(body.setupToken)) return reply.code(403).send({ error: rt(req, "errors:auth.setupTokenInvalid") });
    return auth.startSetup(body.username, body.password, requestLanguage(req));
  });

  app.post("/api/auth/setup/verify", strictLimit, async (req, reply) => {
    const body = parseBody(setupVerifySchema, req.body, reply);
    if (!body) return;
    if (!auth.checkSetupToken(body.setupToken)) return reply.code(403).send({ error: rt(req, "errors:auth.setupTokenInvalid") });
    const user = await auth.finishSetup(body.code);
    if (!user) return reply.code(400).send({ error: rt(req, "errors:auth.codeWrong") });
    audit("auth.setup", req.ip, { username: user.username });
    setSessionCookie(reply, auth.createSession(user.id, req.ip, req.headers["user-agent"] ?? null));
    return { ok: true };
  });

  app.post("/api/auth/login", strictLimit, async (req, reply) => {
    const body = parseBody(loginSchema, req.body, reply);
    if (!body) return;

    // Hesap genelinde kilit: çok sayıda IP'den deneme yapılsa bile
    const before = auth.lockState();
    if (before.lockedUntil) {
      const min = Math.ceil((before.lockedUntil - Date.now()) / 60_000);
      return reply.code(429).send({ error: rt(req, "errors:auth.locked", { count: min }) });
    }

    const user = await auth.verifyCredentials(body.username, body.password, body.code);
    const ua = req.headers["user-agent"] ?? null;
    if (!user) {
      audit("auth.login_failed", req.ip, { username: body.username.slice(0, 64) });
      const after = auth.lockState();
      if (after.lockedUntil) {
        audit("auth.locked", req.ip, { failed: after.failedLast15m });
        notify(
          "securityAlert",
          pt("notify:auth.lockedTitle"),
          pt("notify:auth.lockedBody", { count: after.failedLast15m, ip: req.ip }),
          "error",
        );
      }
      return reply.code(401).send({ error: rt(req, "errors:auth.badCredentials") });
    }
    audit("auth.login", req.ip, { username: user.username, userAgent: ua?.slice(0, 200) });
    notify("login", pt("notify:auth.loginTitle"), pt("notify:auth.loginBody", { username: user.username, ip: req.ip, browser: ua?.slice(0, 120) ?? "?" }));
    setSessionCookie(reply, auth.createSession(user.id, req.ip, ua));
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    auth.deleteSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
});
