import { asc, eq, inArray } from "drizzle-orm";
import type { EnvGroup, EnvGroupInput, EnvVar } from "@panel/shared";
import { db, schema } from "../../db/index.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { HttpError } from "../../lib/errors.js";

/**
 * Ortak değişken grupları: birden çok projede kullanılan değerler (SMTP, API anahtarı…) tek yerde.
 * Deploy sırasında birleştirme: gruplar (sırayla) → projenin kendi değişkenleri. Aynı isimde
 * sonraki kazanır; yani proje değişkeni her zaman gruptakini ezer.
 */

type Row = typeof schema.envGroups.$inferSelect;

const decryptEnv = (r: Pick<Row, "envEncrypted">): EnvVar[] => (r.envEncrypted ? (JSON.parse(decrypt(r.envEncrypted)) as EnvVar[]) : []);
const encryptEnv = (env: EnvVar[]) => (env.length ? encrypt(JSON.stringify(env)) : null);

function getRow(id: number) {
  const r = db.select().from(schema.envGroups).where(eq(schema.envGroups.id, id)).get();
  if (!r) throw new HttpError(404, "errors:envGroup.notFound");
  return r;
}

export function listGroups(): EnvGroup[] {
  const rows = db.select().from(schema.envGroups).orderBy(asc(schema.envGroups.name)).all();
  const links = db
    .select({ groupId: schema.projectEnvGroups.groupId, id: schema.projects.id, name: schema.projects.name })
    .from(schema.projectEnvGroups)
    .innerJoin(schema.projects, eq(schema.projectEnvGroups.projectId, schema.projects.id))
    .orderBy(asc(schema.projects.name))
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    env: decryptEnv(r),
    projects: links.filter((l) => l.groupId === r.id).map((l) => ({ id: l.id, name: l.name })),
    updatedAt: r.updatedAt,
  }));
}

function assertNameFree(name: string, exceptId?: number) {
  const r = db.select({ id: schema.envGroups.id }).from(schema.envGroups).where(eq(schema.envGroups.name, name)).get();
  if (r && r.id !== exceptId) throw new HttpError(409, "errors:envGroup.nameTaken");
}

export function createGroup(input: EnvGroupInput) {
  assertNameFree(input.name);
  const now = Date.now();
  return db.insert(schema.envGroups).values({ name: input.name, envEncrypted: encryptEnv(input.env), createdAt: now, updatedAt: now }).returning().get();
}

export function updateGroup(id: number, input: EnvGroupInput) {
  getRow(id);
  assertNameFree(input.name, id);
  db.update(schema.envGroups).set({ name: input.name, envEncrypted: encryptEnv(input.env), updatedAt: Date.now() }).where(eq(schema.envGroups.id, id)).run();
  return linkedProjectIds(id);
}

export function deleteGroup(id: number) {
  const r = getRow(id);
  const projects = linkedProjectIds(id);
  db.delete(schema.envGroups).where(eq(schema.envGroups.id, id)).run();
  return { name: r.name, projects };
}

export function linkedProjectIds(groupId: number) {
  return db
    .select({ projectId: schema.projectEnvGroups.projectId })
    .from(schema.projectEnvGroups)
    .where(eq(schema.projectEnvGroups.groupId, groupId))
    .all()
    .map((r) => r.projectId);
}

export function projectGroupIds(projectId: number) {
  return db
    .select({ groupId: schema.projectEnvGroups.groupId })
    .from(schema.projectEnvGroups)
    .where(eq(schema.projectEnvGroups.projectId, projectId))
    .orderBy(asc(schema.projectEnvGroups.position))
    .all()
    .map((r) => r.groupId);
}

export function setProjectGroups(projectId: number, groupIds: number[]) {
  const unique = [...new Set(groupIds)];
  if (unique.length) {
    const found = db.select({ id: schema.envGroups.id }).from(schema.envGroups).where(inArray(schema.envGroups.id, unique)).all();
    if (found.length !== unique.length) throw new HttpError(400, "errors:envGroup.notFound");
  }
  db.transaction((tx) => {
    tx.delete(schema.projectEnvGroups).where(eq(schema.projectEnvGroups.projectId, projectId)).run();
    unique.forEach((groupId, position) => tx.insert(schema.projectEnvGroups).values({ projectId, groupId, position }).run());
  });
}

/** Projeye bağlı grupların değişkenleri, bağlanma sırasıyla birleştirilmiş */
export function groupEnvForProject(projectId: number): EnvVar[] {
  const ids = projectGroupIds(projectId);
  if (!ids.length) return [];
  const rows = new Map(db.select().from(schema.envGroups).where(inArray(schema.envGroups.id, ids)).all().map((r) => [r.id, r]));
  return mergeEnv(...ids.map((id) => (rows.has(id) ? decryptEnv(rows.get(id)!) : [])));
}

/** Aynı isimli değişkenlerde sonraki liste kazanır; sıra ilk görülüşe göre korunur */
export function mergeEnv(...lists: EnvVar[][]): EnvVar[] {
  const map = new Map<string, string>();
  for (const l of lists) for (const e of l) map.set(e.key, e.value);
  return [...map].map(([key, value]) => ({ key, value }));
}
