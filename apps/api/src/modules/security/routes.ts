import type { FastifyInstance } from "fastify";
import { desc, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { changePasswordSchema, securitySettingsSchema, type SecurityOverview } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { audit } from "../../lib/audit.js";
import { setSecret } from "../../lib/settings.js";
import { parseBody } from "../../lib/validate.js";
import * as auth from "../auth/service.js";
import { notify } from "../notify/service.js";
import { HttpError } from "../projects/service.js";
import { SECURITY_KEY, getSecuritySettings, invalidateSecurityCache, ipAllowed, normalizeIp } from "./plugin.js";
import { pt } from "../../lib/i18n.js";

export async function securityRoutes(app: FastifyInstance) {
  app.get("/api/security", async (req): Promise<SecurityOverview> => {
    const lock = auth.lockState();
    return {
      currentIp: normalizeIp(req.ip),
      settings: getSecuritySettings(),
      lockedUntil: lock.lockedUntil,
      failedLast15m: lock.failedLast15m,
      idleTimeoutHours: auth.IDLE_TIMEOUT_MS / 3600_000,
      sessionDays: config.sessionTtlMs / 86400_000,
      panelAccess: config.panelAccess,
    };
  });

  app.put("/api/security", async (req, reply) => {
    const body = parseBody(securitySettingsSchema, req.body, reply);
    if (!body) return;
    const list = [...new Set(body.ipAllowlist)];
    // Kendini dışarıda bırakma
    if (list.length && !ipAllowed(req.ip, list)) {
      throw new HttpError(400, "errors:security.selfLockout", { ip: normalizeIp(req.ip) });
    }
    setSecret(SECURITY_KEY, { ipAllowlist: list });
    invalidateSecurityCache();
    audit("security.allowlist", req.ip, { ipAllowlist: list });
    notify("securityAlert", pt("notify:security.allowlistTitle"), list.length ? pt("notify:security.allowlistBody", { ips: list.join("\n") }) : pt("notify:security.allowlistRemoved"), "warning");
    return { ok: true };
  });

  // ---- Oturumlar ----
  app.get("/api/security/sessions", async (req) => auth.listSessions(req.user!.id, req.user!.sessionId));

  app.delete("/api/security/sessions/:id", async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/) }).parse(req.params);
    if (req.user!.sessionId.startsWith(id)) throw new HttpError(400, "errors:security.revokeCurrent");
    if (!auth.revokeSession(req.user!.id, id)) throw new HttpError(404, "errors:security.sessionNotFound");
    audit("security.session_revoked", req.ip, { session: id });
    return { ok: true };
  });

  app.post("/api/security/sessions/revoke-others", async (req) => {
    const n = auth.revokeOtherSessions(req.user!.id, req.user!.sessionId);
    audit("security.sessions_revoked", req.ip, { count: n });
    return { ok: true, revoked: n };
  });

  // ---- Şifre ----
  app.post("/api/security/password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parseBody(changePasswordSchema, req.body, reply);
    if (!body) return;
    const ok = await auth.changePassword(req.user!.id, body.currentPassword, body.newPassword, body.code);
    if (!ok) {
      audit("security.password_change_failed", req.ip);
      throw new HttpError(400, "errors:security.passwordWrong");
    }
    // Şifre değişince diğer cihazlardaki oturumlar kapanır
    const revoked = auth.revokeOtherSessions(req.user!.id, req.user!.sessionId);
    audit("security.password_changed", req.ip, { revokedSessions: revoked });
    notify("securityAlert", pt("notify:security.passwordTitle"), pt("notify:security.passwordBody", { ip: req.ip, count: revoked }), "warning");
    return { ok: true, revokedSessions: revoked };
  });

  // ---- İşlem kaydı ----
  app.get("/api/security/audit", async (req) => {
    const q = z.object({ filter: z.enum(["security", "all"]).default("security"), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const base = db.select().from(schema.auditLog);
    const filtered =
      q.filter === "security"
        ? base.where(
            or(
              like(schema.auditLog.action, "auth.%"),
              like(schema.auditLog.action, "security.%"),
              like(schema.auditLog.action, "github.app%"),
              like(schema.auditLog.action, "explorer.%"),
              like(schema.auditLog.action, "offsite.%"),
              inArray(schema.auditLog.action, ["terminal.open", "backup.download", "backup.restore", "backup.panel_restore", "recovery.run"]),
            ),
          )
        : base;
    return filtered.orderBy(desc(schema.auditLog.id)).limit(q.limit).all();
  });
}
