import { BSON, MongoClient, type Document } from "mongodb";
import type { ExplorerTree, MongoFindResult } from "@panel/shared";
import { HttpError } from "../../lib/errors.js";

/**
 * MongoDB gezgini. Belgeler Extended JSON (relaxed) metni olarak taşınır:
 * ObjectId → {"$oid": "…"}, tarih → {"$date": "…"}. Sunucuda JavaScript çalıştıran
 * operatörler ($where, $function, $accumulator) filtrelerde kabul edilmez.
 */
const { EJSON } = BSON;
const SYSTEM_DBS = new Set(["admin", "config", "local"]);
const FORBIDDEN_OPS = new Set(["$where", "$function", "$accumulator"]);
const TIMEOUT_MS = 15_000;

export interface MongoTarget {
  host: string;
  password: string;
}

async function withClient<T>(t: MongoTarget, fn: (c: MongoClient) => Promise<T>): Promise<T> {
  const c = new MongoClient(`mongodb://app:${encodeURIComponent(t.password)}@${t.host}:27017/?authSource=admin`, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    directConnection: true,
    appName: "sunucu-paneli",
  });
  try {
    await c.connect();
  } catch (err) {
    throw new HttpError(502, "errors:explorer.connectFailed", { error: (err as Error).message });
  }
  try {
    return await fn(c);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, (err as Error).message);
  } finally {
    await c.close().catch(() => {});
  }
}

function userDb(c: MongoClient, name: string) {
  if (SYSTEM_DBS.has(name)) throw new HttpError(400, "errors:explorer.systemDb", { name });
  return c.db(name);
}

function parse(text: string, what: "filter" | "sort" | "document"): Document {
  let v: unknown;
  try {
    v = EJSON.parse(text, { relaxed: false });
  } catch (err) {
    throw new HttpError(400, "errors:explorer.jsonInvalid", { context: what, error: (err as Error).message });
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "errors:explorer.jsonNotObject", { context: what });
  return v as Document;
}

function parseId(text: string): unknown {
  try {
    return EJSON.parse(text, { relaxed: false });
  } catch {
    throw new HttpError(400, "errors:explorer.idUnreadable");
  }
}

function rejectJs(v: unknown) {
  if (Array.isArray(v)) return v.forEach(rejectJs);
  if (v && typeof v === "object" && !(v instanceof BSON.ObjectId) && v.constructor === Object) {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_OPS.has(k)) throw new HttpError(400, "errors:explorer.operatorForbidden", { operator: k });
      rejectJs(x);
    }
  }
}

const show = (d: unknown) => EJSON.stringify(d, undefined, 2, { relaxed: true });

export const mongoTree = (t: MongoTarget) =>
  withClient(t, async (c) => {
    const { databases } = await c.db("admin").admin().listDatabases({ nameOnly: true });
    const groups: ExplorerTree["groups"] = [];
    for (const { name } of databases) {
      if (SYSTEM_DBS.has(name)) continue;
      const cols = await c.db(name).listCollections({}, { nameOnly: false }).toArray();
      const items = await Promise.all(
        cols
          .filter((x) => !x.name.startsWith("system."))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (x) => ({
            name: x.name,
            kind: "collection" as const,
            count: x.type === "view" ? null : await c.db(name).collection(x.name).estimatedDocumentCount({ maxTimeMS: 5000 }).catch(() => null),
          })),
      );
      groups.push({ name, items });
    }
    return groups;
  });

export const mongoFind = (t: MongoTarget, r: { db: string; collection: string; filter: string; sort: string; skip: number; limit: number }) =>
  withClient(t, async (c): Promise<MongoFindResult> => {
    const filter = parse(r.filter || "{}", "filter");
    const sort = parse(r.sort || "{}", "sort");
    rejectJs(filter);
    const col = userDb(c, r.db).collection(r.collection);
    const docs = await col.find(filter, { sort, skip: r.skip, limit: r.limit, maxTimeMS: TIMEOUT_MS }).toArray();
    let total: number | null = null;
    try {
      total = Object.keys(filter).length
        ? await col.countDocuments(filter, { maxTimeMS: 5000 })
        : await col.estimatedDocumentCount({ maxTimeMS: 5000 });
    } catch {
      total = null;
    }
    return { docs: docs.map(show), total };
  });

export const mongoInsert = (t: MongoTarget, r: { db: string; collection: string; doc: string }) =>
  withClient(t, async (c) => {
    const doc = parse(r.doc, "document");
    const res = await userDb(c, r.db).collection(r.collection).insertOne(doc);
    return { id: show(res.insertedId) };
  });

export const mongoReplace = (t: MongoTarget, r: { db: string; collection: string; id: string; doc: string }) =>
  withClient(t, async (c) => {
    const id = parseId(r.id);
    const doc = parse(r.doc, "document");
    if ("_id" in doc) {
      if (EJSON.stringify(doc._id) !== EJSON.stringify(id)) throw new HttpError(400, "errors:explorer.idImmutable");
      delete doc._id;
    }
    const res = await userDb(c, r.db).collection(r.collection).replaceOne({ _id: id } as Document, doc);
    if (res.matchedCount !== 1) throw new HttpError(409, "errors:explorer.docGone");
    return { ok: true };
  });

export const mongoDelete = (t: MongoTarget, r: { db: string; collection: string; id: string }) =>
  withClient(t, async (c) => {
    const res = await userDb(c, r.db).collection(r.collection).deleteOne({ _id: parseId(r.id) } as Document);
    if (res.deletedCount !== 1) throw new HttpError(409, "errors:explorer.docGone");
    return { ok: true };
  });
