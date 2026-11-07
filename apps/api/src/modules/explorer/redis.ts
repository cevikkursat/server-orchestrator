import { Redis } from "ioredis";
import type { ExplorerTree, RedisOp, RedisScanResult, RedisValue } from "@panel/shared";
import { HttpError } from "../../lib/errors.js";

/**
 * Redis anahtar gezgini. Anahtarlar SCAN ile parça parça listelenir (KEYS kullanılmaz: büyük
 * veride sunucuyu kilitler). Koleksiyonlarda en fazla MAX_ITEMS eleman gösterilir.
 */
const MAX_ITEMS = 1000;
const MAX_STRING = 1_000_000;

export interface RedisTarget {
  host: string;
  password: string;
}

async function withRedis<T>(t: RedisTarget, db: number, fn: (r: Redis) => Promise<T>): Promise<T> {
  const r = new Redis({
    host: t.host,
    port: 6379,
    password: t.password,
    db,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 15_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    connectionName: "sunucu-paneli",
  });
  r.on("error", () => {});
  try {
    await r.connect();
  } catch (err) {
    r.disconnect();
    throw new HttpError(502, "errors:explorer.connectFailed", { error: (err as Error).message });
  }
  try {
    return await fn(r);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const msg = (err as Error).message;
    throw new HttpError(400, /WRONGTYPE/.test(msg) ? "errors:explorer.wrongType" : msg);
  } finally {
    r.disconnect();
  }
}

export const redisTree = (t: RedisTarget, label = "Redis") =>
  withRedis(t, 0, async (r): Promise<ExplorerTree["groups"]> => {
    const info = await r.info("keyspace");
    const counts = new Map<number, number>([[0, 0]]);
    for (const m of info.matchAll(/^db(\d+):keys=(\d+)/gm)) counts.set(Number(m[1]), Number(m[2]));
    return [
      {
        name: label,
        items: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([db, n]) => ({ name: `db${db}`, kind: "keys" as const, count: n })),
      },
    ];
  });

export const redisScan = (t: RedisTarget, req: { db: number; pattern: string; cursor: string }) =>
  withRedis(t, req.db, async (r): Promise<RedisScanResult> => {
    // Az eşleşmeli desenlerde tek SCAN boş dönebilir: birkaç tur dene
    let cursor = req.cursor;
    let keys: string[] = [];
    for (let i = 0; i < 20 && keys.length < 100; i++) {
      const [next, batch] = await r.scan(cursor, "MATCH", req.pattern || "*", "COUNT", 500);
      keys.push(...batch);
      cursor = next;
      if (cursor === "0") break;
    }
    keys = [...new Set(keys)].sort();
    const p = r.pipeline();
    for (const k of keys) p.type(k).pttl(k);
    const res = (await p.exec()) ?? [];
    return {
      cursor,
      keys: keys.map((key, i) => ({ key, type: String(res[i * 2]?.[1] ?? "none"), ttlMs: Number(res[i * 2 + 1]?.[1] ?? -1) })),
    };
  });

async function pairs(scan: (cursor: string) => Promise<[string, string[]]>) {
  const out: [string, string][] = [];
  let cursor = "0";
  do {
    const [next, flat] = await scan(cursor);
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
    cursor = next;
  } while (cursor !== "0" && out.length < MAX_ITEMS);
  return out.slice(0, MAX_ITEMS);
}

export const redisGet = (t: RedisTarget, req: { db: number; key: string }) =>
  withRedis(t, req.db, async (r): Promise<RedisValue> => {
    const type = await r.type(req.key);
    if (type === "none") throw new HttpError(404, "errors:explorer.keyGone");
    const ttlMs = await r.pttl(req.key);
    const base = { key: req.key, type, ttlMs };
    switch (type) {
      case "string": {
        const length = await r.strlen(req.key);
        const value = length > MAX_STRING ? await r.getrange(req.key, 0, MAX_STRING - 1) : ((await r.get(req.key)) ?? "");
        return { ...base, length, value, truncated: length > MAX_STRING };
      }
      case "hash": {
        const length = await r.hlen(req.key);
        const value = await pairs((c) => r.hscan(req.key, c, "COUNT", 500));
        return { ...base, length, value, truncated: length > value.length };
      }
      case "list": {
        const length = await r.llen(req.key);
        return { ...base, length, value: await r.lrange(req.key, 0, MAX_ITEMS - 1), truncated: length > MAX_ITEMS };
      }
      case "set": {
        const length = await r.scard(req.key);
        const value: string[] = [];
        let c = "0";
        do {
          const [next, batch] = await r.sscan(req.key, c, "COUNT", 500);
          value.push(...batch);
          c = next;
        } while (c !== "0" && value.length < MAX_ITEMS);
        return { ...base, length, value: [...new Set(value)].slice(0, MAX_ITEMS).sort(), truncated: length > MAX_ITEMS };
      }
      case "zset": {
        const length = await r.zcard(req.key);
        const flat = await r.zrange(req.key, "0", String(MAX_ITEMS - 1), "WITHSCORES");
        const value: [string, string][] = [];
        for (let i = 0; i < flat.length; i += 2) value.push([flat[i]!, flat[i + 1]!]);
        return { ...base, length, value, truncated: length > MAX_ITEMS };
      }
      case "stream": {
        const length = await r.xlen(req.key);
        const entries = await r.xrevrange(req.key, "+", "-", "COUNT", 100);
        const value: [string, string][] = entries.map(([id, fields]) => {
          const o: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) o[fields[i]!] = fields[i + 1]!;
          return [id, JSON.stringify(o)];
        });
        return { ...base, length, value, truncated: length > 100 };
      }
      default:
        return { ...base, length: 0, value: "", truncated: false };
    }
  });

export const redisEdit = (t: RedisTarget, req: { db: number; key: string; change: RedisOp }) =>
  withRedis(t, req.db, async (r) => {
    const k = req.key;
    const c = req.change;
    if (c.op !== "del" && (await r.exists(k)) === 0) throw new HttpError(404, "errors:explorer.keyGone");
    switch (c.op) {
      case "set":
        if ((await r.type(k)) !== "string") throw new HttpError(400, "errors:explorer.wrongType");
        await r.set(k, c.value, "KEEPTTL");
        break;
      case "hset":
        await r.hset(k, c.field, c.value);
        break;
      case "hdel":
        await r.hdel(k, c.field);
        break;
      case "lset":
        await r.lset(k, c.index, c.value);
        break;
      case "rpush":
        await r.rpush(k, c.value);
        break;
      case "lrem":
        await r.lrem(k, 1, c.value);
        break;
      case "sadd":
        await r.sadd(k, c.value);
        break;
      case "srem":
        await r.srem(k, c.value);
        break;
      case "zadd":
        await r.zadd(k, c.score, c.member);
        break;
      case "zrem":
        await r.zrem(k, c.member);
        break;
      case "expire":
        if (c.seconds == null) await r.persist(k);
        else await r.expire(k, c.seconds);
        break;
      case "del":
        await r.del(k);
        break;
    }
    return { ok: true };
  });

export const redisCreate = (
  t: RedisTarget,
  req: { db: number; key: string; type: "string" | "hash" | "list" | "set" | "zset"; value: string; field: string; score: number },
) =>
  withRedis(t, req.db, async (r) => {
    if (await r.exists(req.key)) throw new HttpError(409, "errors:explorer.keyExists");
    if (req.type === "string") await r.set(req.key, req.value);
    else if (req.type === "hash") {
      if (!req.field) throw new HttpError(400, "errors:explorer.fieldRequired");
      await r.hset(req.key, req.field, req.value);
    } else if (req.type === "list") await r.rpush(req.key, req.value);
    else if (req.type === "set") await r.sadd(req.key, req.value);
    else await r.zadd(req.key, req.score, req.value);
    return { ok: true };
  });
