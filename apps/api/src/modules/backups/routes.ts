import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { backupSettingsSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { nextBackupAt, scheduleBackups } from "../cron/service.js";
import { HttpError } from "../projects/service.js";
import * as svc from "./service.js";

const id = (req: FastifyRequest) => {
  const r = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!r.success) throw new HttpError(400, "errors:common.invalidId");
  return r.data.id;
};

export async function backupRoutes(app: FastifyInstance) {
  app.get("/api/backups", async () => ({
    backups: svc.listBackups(),
    settings: svc.getBackupSettings(),
    nextRunAt: nextBackupAt(),
    directory: svc.backupDir,
  }));

  app.put("/api/backups/settings", async (req, reply) => {
    const body = parseBody(backupSettingsSchema, req.body, reply);
    if (!body) return;
    svc.saveBackupSettings(body);
    scheduleBackups();
    audit("backup.settings", req.ip, body);
    return { ok: true, nextRunAt: nextBackupAt() };
  });

  app.post("/api/backups/run", async (req) => {
    audit("backup.manual_all", req.ip);
    return svc.backupAll("manual");
  });

  app.get("/api/backups/:id/download", async (req, reply) => {
    const r = svc.getBackupRow(id(req));
    const file = svc.backupFilePath(r);
    audit("backup.download", req.ip, { id: r.id, file: r.fileName });
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${r.fileName}"`)
      .header("Content-Length", fs.statSync(file).size)
      .send(fs.createReadStream(file));
  });

  app.post("/api/backups/:id/restore", async (req) => {
    const backupId = id(req);
    const r = await svc.restoreBackup(backupId);
    audit("backup.restore", req.ip, { id: backupId, ...r });
    return { ok: true, ...r };
  });

  app.delete("/api/backups/:id", async (req) => {
    svc.deleteBackup(id(req));
    audit("backup.delete", req.ip, { id: id(req) });
    return { ok: true };
  });
}
