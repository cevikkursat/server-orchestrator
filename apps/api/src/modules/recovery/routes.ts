import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { panelRestoreSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { HttpError } from "../../lib/errors.js";
import { verifyUserTotp } from "../auth/service.js";
import { stagePanelRestore } from "../backups/service.js";
import { getJob, getPlan, runRecovery } from "./service.js";

export async function recoveryRoutes(app: FastifyInstance) {
  app.get("/api/recovery", async () => ({ plan: await getPlan(), job: getJob() }));

  app.post("/api/recovery/run", async (req) => {
    audit("recovery.run", req.ip);
    return runRecovery();
  });

  // Panel yedeğine dönüş: bütün panel verisini değiştirir, 2FA kodu ister. Panel yeniden başlar.
  app.post("/api/backups/:id/restore-panel", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const id = z.object({ id: z.coerce.number().int().positive() }).parse(req.params).id;
    const { code } = panelRestoreSchema.parse(req.body);
    if (!(await verifyUserTotp(req.user!.id, code))) throw new HttpError(401, "errors:common.totpInvalid");
    const r = await stagePanelRestore(id);
    audit("backup.panel_restore", req.ip, { id, fileName: r.fileName });
    await reply.send({ ok: true, restarting: true });
    // Yanıt gittikten sonra kapan; Docker (restart: unless-stopped) paneli yeniden başlatır,
    // açılışta dosyalar yerine konur
    setTimeout(() => process.exit(0), 800);
    return reply;
  });
}
