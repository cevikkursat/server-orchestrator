import type { FastifyInstance } from "fastify";
import { audit } from "../../lib/audit.js";
import * as svc from "./service.js";

export async function updaterRoutes(app: FastifyInstance) {
  app.get("/api/updater", async () => svc.updateStatus());

  app.post("/api/updater/check", async (req) => {
    svc.requestUpdate("check");
    audit("panel.update_check", req.ip);
    return { ok: true };
  });

  app.post("/api/updater/update", async (req) => {
    svc.requestUpdate("update");
    audit("panel.update", req.ip);
    return { ok: true };
  });
}
