import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  explorerUnlockSchema,
  mongoDocSchema,
  mongoFindSchema,
  mongoIdSchema,
  mongoReplaceSchema,
  redisCreateSchema,
  redisEditSchema,
  redisKeySchema,
  redisScanSchema,
  sqlQuerySchema,
  sqlRowInsertSchema,
  sqlRowKeySchema,
  sqlRowsSchema,
  sqlRowUpdateSchema,
  dbEngineInfo,
  isSqlEngine,
  type DbEngine,
  type ExplorerStatus,
  type ExplorerTree,
} from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { HttpError } from "../../lib/errors.js";
import { verifyUserTotp } from "../auth/service.js";
import { getDatabaseRow, passwordOf } from "../databases/service.js";
import { notify } from "../notify/service.js";
import * as lock from "./lock.js";
import * as mongo from "./mongo.js";
import * as redis from "./redis.js";
import * as sql from "./sql.js";
import { pt, rt } from "../../lib/i18n.js";

/**
 * Veritabanı gezgini. Erişim katmanları:
 *  1. Panel oturumu (şifre + 2FA) ve panelin ağ kapısı (Tailscale / IP izin listesi)
 *  2. Gezgin kilidi: oturum başına ayrıca 2FA kodu; 15 dk işlem yoksa kapanır
 *  3. Bağlantı sadece panelin kayıtlı veritabanlarına, iç Docker ağı üzerinden (db-<isim>) kurulur;
 *     veritabanlarının dışarıya açık portu yoktur, adres kullanıcıdan alınmaz.
 *  4. Her değişiklik denetim kaydına yazılır.
 */

const idParams = z.object({ id: z.coerce.number().int().positive() });
/** Belge / hücre düzenlemelerinde büyük değerlere izin */
const big = { bodyLimit: 20 * 1024 * 1024 };

function target(req: FastifyRequest, engines: DbEngine[]) {
  const p = idParams.safeParse(req.params);
  if (!p.success) throw new HttpError(400, "errors:common.invalidId");
  const d = getDatabaseRow(p.data.id);
  if (!engines.includes(d.engine)) throw new HttpError(400, "errors:explorer.unsupported");
  return { d, host: `db-${d.name}`, password: passwordOf(d) };
}

function guard(req: FastifyRequest) {
  if (!req.user || !lock.touch(req.user.sessionId)) throw new HttpError(423, "errors:explorer.locked");
}

const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => schema.parse(body);

export async function explorerRoutes(app: FastifyInstance) {
  // ---- Kilit ----
  app.get("/api/explorer/status", async (req): Promise<ExplorerStatus> => {
    const until = req.user ? lock.peek(req.user.sessionId) : null;
    return { unlocked: !!until, expiresAt: until, idleMinutes: lock.IDLE_MS / 60_000 };
  });

  app.post("/api/explorer/unlock", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { code } = parse(explorerUnlockSchema, req.body);
    if (!(await verifyUserTotp(req.user!.id, code))) {
      audit("explorer.unlock_failed", req.ip);
      return reply.code(401).send({ error: rt(req, "errors:common.totpInvalid") });
    }
    const until = lock.unlock(req.user!.sessionId);
    audit("explorer.unlock", req.ip, { username: req.user!.username });
    notify("login", pt("notify:explorer.unlockedTitle"), pt("notify:explorer.unlockedBody", { username: req.user!.username, ip: req.ip }));
    return { unlocked: true, expiresAt: until, idleMinutes: lock.IDLE_MS / 60_000 } satisfies ExplorerStatus;
  });

  app.post("/api/explorer/lock", async (req) => {
    if (req.user) lock.lock(req.user.sessionId);
    return { ok: true };
  });

  const write = (req: FastifyRequest, database: string, op: string, details: Record<string, unknown>) =>
    audit("explorer.write", req.ip, { database, op, ...details });

  // ---- Ağaç ----
  app.get("/api/databases/:id/explorer/tree", async (req): Promise<ExplorerTree> => {
    guard(req);
    const t = target(req, ["postgres", "mysql", "mariadb", "mongo", "redis", "valkey"]);
    const engine = t.d.engine;
    const groups = isSqlEngine(engine)
      ? await sql.sqlTree({ engine, ...t })
      : engine === "mongo"
        ? await mongo.mongoTree(t)
        : await redis.redisTree(t, dbEngineInfo[engine].label);
    return { engine, groups };
  });

  // ---- SQL ----
  const sqlTarget = (req: FastifyRequest) => {
    const t = target(req, ["postgres", "mysql", "mariadb"]);
    return { t: { engine: t.d.engine as "postgres" | "mysql" | "mariadb", host: t.host, password: t.password }, name: t.d.name };
  };

  app.post("/api/databases/:id/explorer/sql/rows", async (req) => {
    guard(req);
    return sql.sqlRows(sqlTarget(req).t, parse(sqlRowsSchema, req.body));
  });

  app.post("/api/databases/:id/explorer/sql/row", async (req) => {
    guard(req);
    const b = parse(sqlRowKeySchema, req.body);
    return sql.sqlRow(sqlTarget(req).t, b.schema, b.table, b.key);
  });

  app.post("/api/databases/:id/explorer/sql/update", big, async (req) => {
    guard(req);
    const { t, name } = sqlTarget(req);
    const b = parse(sqlRowUpdateSchema, req.body);
    const r = await sql.sqlUpdate(t, b.schema, b.table, b.key, b.values);
    write(req, name, "update", { table: `${b.schema}.${b.table}`, key: b.key, columns: Object.keys(b.values) });
    return r;
  });

  app.post("/api/databases/:id/explorer/sql/insert", big, async (req) => {
    guard(req);
    const { t, name } = sqlTarget(req);
    const b = parse(sqlRowInsertSchema, req.body);
    const r = await sql.sqlInsert(t, b.schema, b.table, b.values);
    write(req, name, "insert", { table: `${b.schema}.${b.table}`, columns: Object.keys(b.values) });
    return r;
  });

  app.post("/api/databases/:id/explorer/sql/delete", async (req) => {
    guard(req);
    const { t, name } = sqlTarget(req);
    const b = parse(sqlRowKeySchema, req.body);
    const r = await sql.sqlDelete(t, b.schema, b.table, b.key);
    write(req, name, "delete", { table: `${b.schema}.${b.table}`, key: b.key });
    return r;
  });

  app.post("/api/databases/:id/explorer/sql/query", big, async (req) => {
    guard(req);
    const { t, name } = sqlTarget(req);
    const b = parse(sqlQuerySchema, req.body);
    try {
      return await sql.sqlConsole(t, b.sql, b.write);
    } finally {
      // Yazma izniyle çalışan her sorgu (başarısız olsa da) kayda geçer
      if (b.write) write(req, name, "query", { sql: b.sql.slice(0, 1000) });
    }
  });

  // ---- MongoDB ----
  const mongoTarget = (req: FastifyRequest) => {
    const t = target(req, ["mongo"]);
    return { t: { host: t.host, password: t.password }, name: t.d.name };
  };

  app.post("/api/databases/:id/explorer/mongo/find", async (req) => {
    guard(req);
    return mongo.mongoFind(mongoTarget(req).t, parse(mongoFindSchema, req.body));
  });

  app.post("/api/databases/:id/explorer/mongo/insert", big, async (req) => {
    guard(req);
    const { t, name } = mongoTarget(req);
    const b = parse(mongoDocSchema, req.body);
    const r = await mongo.mongoInsert(t, b);
    write(req, name, "insert", { collection: `${b.db}.${b.collection}`, id: r.id });
    return r;
  });

  app.post("/api/databases/:id/explorer/mongo/replace", big, async (req) => {
    guard(req);
    const { t, name } = mongoTarget(req);
    const b = parse(mongoReplaceSchema, req.body);
    const r = await mongo.mongoReplace(t, b);
    write(req, name, "update", { collection: `${b.db}.${b.collection}`, id: b.id.slice(0, 200) });
    return r;
  });

  app.post("/api/databases/:id/explorer/mongo/delete", async (req) => {
    guard(req);
    const { t, name } = mongoTarget(req);
    const b = parse(mongoIdSchema, req.body);
    const r = await mongo.mongoDelete(t, b);
    write(req, name, "delete", { collection: `${b.db}.${b.collection}`, id: b.id.slice(0, 200) });
    return r;
  });

  // ---- Redis ----
  const redisTarget = (req: FastifyRequest) => {
    const t = target(req, ["redis", "valkey"]);
    return { t: { host: t.host, password: t.password }, name: t.d.name };
  };

  app.post("/api/databases/:id/explorer/redis/scan", async (req) => {
    guard(req);
    return redis.redisScan(redisTarget(req).t, parse(redisScanSchema, req.body));
  });

  app.post("/api/databases/:id/explorer/redis/get", async (req) => {
    guard(req);
    return redis.redisGet(redisTarget(req).t, parse(redisKeySchema, req.body));
  });

  app.post("/api/databases/:id/explorer/redis/edit", big, async (req) => {
    guard(req);
    const { t, name } = redisTarget(req);
    const b = parse(redisEditSchema, req.body);
    const r = await redis.redisEdit(t, b);
    write(req, name, b.change.op, { db: b.db, key: b.key.slice(0, 200) });
    return r;
  });

  app.post("/api/databases/:id/explorer/redis/create", big, async (req) => {
    guard(req);
    const { t, name } = redisTarget(req);
    const b = parse(redisCreateSchema, req.body);
    const r = await redis.redisCreate(t, b);
    write(req, name, "create", { db: b.db, key: b.key.slice(0, 200), type: b.type });
    return r;
  });
}
