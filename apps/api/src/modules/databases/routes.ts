import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createDatabaseSchema, linkDatabaseSchema } from "@panel/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { audit } from "../../lib/audit.js";
import { encrypt } from "../../lib/crypto.js";
import { parseBody } from "../../lib/validate.js";
import { backupDatabase, listDatabaseBackups } from "../backups/service.js";
import { HttpError, decryptEnv, getProjectRow } from "../projects/service.js";
import * as svc from "./service.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const id = (req: FastifyRequest) => {
  const r = idParams.safeParse(req.params);
  if (!r.success) throw new HttpError(400, "errors:common.invalidId");
  return r.data.id;
};

export async function databaseRoutes(app: FastifyInstance) {
  app.get("/api/databases", async () => svc.listDatabases());
  app.get("/api/databases/:id", async (req) => svc.getDatabase(id(req)));

  app.post("/api/databases", async (req, reply) => {
    const body = parseBody(createDatabaseSchema, req.body, reply);
    if (!body) return;
    const d = await svc.createDatabase(body);
    audit("database.create", req.ip, { name: d.name, engine: d.engine, version: d.version });
    return reply.code(201).send(await svc.getDatabase(d.id));
  });

  app.delete("/api/databases/:id", async (req) => {
    const q = z.object({ keepVolume: z.enum(["0", "1"]).default("0") }).parse(req.query);
    const d = await svc.deleteDatabase(id(req), q.keepVolume === "1");
    audit("database.delete", req.ip, { name: d.name, keepVolume: q.keepVolume === "1" });
    return { ok: true };
  });

  // Bağlantı adresini bir projenin ortam değişkenine yaz
  app.post("/api/databases/:id/link", async (req, reply) => {
    const body = parseBody(linkDatabaseSchema, req.body, reply);
    if (!body) return;
    const d = svc.getDatabaseRow(id(req));
    const p = getProjectRow(body.projectId);
    const add = svc.linkEnv(d, body.envKey);
    const env = decryptEnv(p).filter((e) => !add.some((a) => a.key === e.key));
    env.push(...add);
    db.update(schema.projects)
      .set({ envEncrypted: encrypt(JSON.stringify(env)), updatedAt: Date.now() })
      .where(eq(schema.projects.id, p.id))
      .run();
    audit("database.link", req.ip, { database: d.name, project: p.name, envKeys: add.map((a) => a.key) });
    return { ok: true, projectId: p.id, keys: add.map((a) => a.key) };
  });

  app.get("/api/databases/:id/backups", async (req) => listDatabaseBackups(svc.getDatabaseRow(id(req)).name));

  // Orthanc: hasta / çalışma / görüntü sayıları ve boyut
  app.get("/api/databases/:id/orthanc-stats", async (req) => {
    const d = svc.getDatabaseRow(id(req));
    if (d.engine !== "orthanc") throw new HttpError(400, "errors:database.notOrthanc");
    const auth = Buffer.from(`app:${svc.passwordOf(d)}`).toString("base64");
    const r = await fetch(`http://db-${d.name}:8042/statistics`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!r?.ok) throw new HttpError(502, "errors:database.orthancUnreachable");
    const s = (await r.json()) as Record<string, string | number>;
    return { patients: Number(s.CountPatients), studies: Number(s.CountStudies), series: Number(s.CountSeries), instances: Number(s.CountInstances), sizeMb: Number(s.TotalDiskSizeMB) };
  });

  app.post("/api/databases/:id/backup", async (req) => {
    const entry = await backupDatabase(id(req), "manual");
    audit("backup.manual", req.ip, { database: entry.targetName, status: entry.status });
    return entry;
  });
}
