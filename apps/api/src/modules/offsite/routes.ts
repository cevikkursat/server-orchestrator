import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { offsiteEmailKeySchema, offsiteRevealSchema, offsiteSettingsSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { HttpError } from "../../lib/errors.js";
import { verifyUserTotp } from "../auth/service.js";
import * as svc from "./service.js";

export async function offsiteRoutes(app: FastifyInstance) {
  app.get("/api/offsite", async () => svc.getStatus());

  app.post("/api/offsite/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    return svc.testConnection(offsiteSettingsSchema.parse(req.body));
  });

  app.put("/api/offsite", async (req) => {
    const body = offsiteSettingsSchema.parse(req.body);
    const r = await svc.saveSettings(body);
    audit("offsite.settings", req.ip, { enabled: body.enabled, endpoint: body.endpoint, bucket: body.bucket, keyImported: !!body.key });
    return r;
  });

  // Kurtarma anahtarını göstermek için 2FA kodu ayrıca istenir
  app.post("/api/offsite/key", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const { code } = offsiteRevealSchema.parse(req.body);
    if (!(await verifyUserTotp(req.user!.id, code))) {
      audit("offsite.key_reveal_failed", req.ip);
      throw new HttpError(401, "errors:common.totpInvalid");
    }
    audit("offsite.key_reveal", req.ip);
    return svc.revealKey();
  });

  // Kurtarma anahtarını parolayla şifreleyip e-postaya gönder (2FA ister)
  app.post("/api/offsite/key/email", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const { code, passphrase } = offsiteEmailKeySchema.parse(req.body);
    if (!(await verifyUserTotp(req.user!.id, code))) {
      audit("offsite.key_reveal_failed", req.ip);
      throw new HttpError(401, "errors:common.totpInvalid");
    }
    const r = await svc.emailKey(passphrase);
    audit("offsite.key_emailed", req.ip, { to: r.sentTo, fingerprint: r.fingerprint });
    return r;
  });

  app.post("/api/offsite/retry", async () => {
    svc.retryFailed();
    return svc.getStatus();
  });

  app.get("/api/offsite/objects", async () => svc.listObjects());

  app.post("/api/offsite/import", async (req) => {
    const { key } = z.object({ key: z.string().min(1).max(1024) }).parse(req.body);
    const r = await svc.importObject(key);
    audit("offsite.import", req.ip, { key });
    return r;
  });
}
