import type { FastifyInstance } from "fastify";
import { cleanupSettingsSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import * as svc from "./service.js";

export async function maintenanceRoutes(app: FastifyInstance) {
  app.get("/api/cleanup", async () => svc.cleanupOverview());

  app.put("/api/cleanup/settings", async (req, reply) => {
    const body = parseBody(cleanupSettingsSchema, req.body, reply);
    if (!body) return;
    svc.saveCleanupSettings(body);
    audit("cleanup.settings", req.ip, body);
    return { ok: true };
  });

  app.post("/api/cleanup/run", async (req) => {
    const r = await svc.runCleanup("manual");
    audit("cleanup.run", req.ip, { reclaimedBytes: r.reclaimedBytes, imagesDeleted: r.imagesDeleted });
    return r;
  });
}
