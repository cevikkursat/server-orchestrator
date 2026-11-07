import { domainToUnicode } from "node:url";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { ContainerState, createProjectSchema, DomainAccess, PreviewSettings, DeploymentSummary, DomainEntry, DomainInput, EnvVar, ProjectDetail, ProjectSource, ProjectSummary, updateProjectSchema, DomainTarget } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { docker } from "../../lib/docker.js";
import { HttpError } from "../../lib/errors.js";
import { groupEnvForProject, mergeEnv, projectGroupIds } from "../envgroups/service.js";
import { clearHealth, healthOf } from "../health/state.js";
import { composeDown } from "../deploy/compose.js";
import { pt } from "../../lib/i18n.js";

export const PROJECT_LABEL = "panel.project";
export const MANAGED_LABEL = "panel.managed";

export { HttpError };

export type ProjectRow = typeof schema.projects.$inferSelect;

export function getProjectRow(id: number): ProjectRow {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!p) throw new HttpError(404, "errors:project.notFound");
  return p;
}

export function decryptEnv(p: Pick<ProjectRow, "envEncrypted">): EnvVar[] {
  return p.envEncrypted ? (JSON.parse(decrypt(p.envEncrypted)) as EnvVar[]) : [];
}

const encryptEnv = (env: EnvVar[]) => (env.length ? encrypt(JSON.stringify(env)) : null);

// ---- PR önizleme ayarları (env şifreli saklanır) ----
type StoredPreview = Omit<PreviewSettings, "env"> & { envEncrypted: string | null };
const defaultPreview: PreviewSettings = { enabled: false, env: [], access: { tailnet: true, ips: [] } };

export function getPreviewSettings(p: Pick<ProjectRow, "previewSettings">): PreviewSettings {
  if (!p.previewSettings) return defaultPreview;
  const s = JSON.parse(p.previewSettings) as StoredPreview;
  return { enabled: s.enabled, access: s.access, env: s.envEncrypted ? (JSON.parse(decrypt(s.envEncrypted)) as EnvVar[]) : [] };
}

export function setPreviewSettings(id: number, v: PreviewSettings) {
  getProjectRow(id);
  const stored: StoredPreview = { enabled: v.enabled, access: v.access, envEncrypted: encryptEnv(v.env) };
  db.update(schema.projects).set({ previewSettings: JSON.stringify(stored), updatedAt: Date.now() }).where(eq(schema.projects.id, id)).run();
  // Açık önizlemelerin domain erişimi de güncellensin
  const children = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.parentId, id)).all();
  for (const c of children) db.update(schema.domains).set({ access: v.access }).where(eq(schema.domains.projectId, c.id)).run();
}

/**
 * Container'a verilecek değişkenler: ortak gruplar → projenin kendi değişkenleri.
 * PR önizlemesinde: ana projenin sonucu → ana projenin önizleme değişkenleri.
 */
export function resolveEnv(p: ProjectRow): EnvVar[] {
  if (p.parentId) {
    const parent = db.select().from(schema.projects).where(eq(schema.projects.id, p.parentId)).get();
    if (parent) return mergeEnv(resolveEnv(parent), getPreviewSettings(parent).env);
  }
  return mergeEnv(groupEnvForProject(p.id), decryptEnv(p));
}

// ---- Domain kuralları ----
type DomainRowInput = { hostname: string; kind: "route" | "redirect"; access: DomainAccess };
function expandDomains(inputs: (Omit<DomainInput, "access"> & { access?: DomainAccess })[]): DomainRowInput[] {
  const out: DomainRowInput[] = [];
  for (const d of inputs) {
    const access = d.access ?? null;
    out.push({ hostname: d.hostname, kind: "route", access });
    if (d.redirectWww && !d.hostname.startsWith("www.")) out.push({ hostname: `www.${d.hostname}`, kind: "redirect", access });
  }
  return out;
}

function assertDomainsAvailable(hosts: string[], exceptProjectId?: number) {
  const unique = new Set(hosts);
  if (unique.size !== hosts.length) throw new HttpError(400, "errors:project.domainDuplicate");
  for (const reserved of [config.panelDomain, config.webhookDomain]) {
    if (reserved && unique.has(reserved)) throw new HttpError(409, "errors:project.domainReserved", { domain: reserved });
  }
  if (!hosts.length) return;
  const taken = db
    .select({ hostname: schema.domains.hostname, projectId: schema.domains.projectId })
    .from(schema.domains)
    .where(inArray(schema.domains.hostname, hosts))
    .all()
    .filter((d) => d.projectId !== exceptProjectId);
  if (taken.length) throw new HttpError(409, "errors:project.domainTaken", { domains: taken.map((t) => t.hostname).join(", ") });
}

// ---- Okuma ----
type ContainerLite = { id: string; name: string; state: ContainerState; status: string };

async function managedContainers(): Promise<Map<string, ContainerLite>> {
  try {
    const list = await docker.listContainers({ all: true, filters: { label: [`${MANAGED_LABEL}=true`] } });
    return new Map(
      list.map((c) => {
        const name = (c.Names?.[0] ?? c.Id).replace(/^\//, "");
        return [name, { id: c.Id, name, state: c.State as ContainerState, status: c.Status }];
      }),
    );
  } catch {
    return new Map(); // Docker yoksa liste yine de dönsün
  }
}

function toDomainEntry(d: typeof schema.domains.$inferSelect): DomainEntry {
  return {
    id: d.id,
    hostname: d.hostname,
    display: domainToUnicode(d.hostname) || d.hostname,
    kind: d.kind,
    access: d.access ?? null,
    target: d.target ?? null,
    createdAt: d.createdAt,
  };
}

/** Yayındaki container'ı üreten deploy: container adı deploy kaydında tutulur */
function liveDeploymentId(p: ProjectRow): number | null {
  if (!p.currentContainer) return null;
  const d = db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, p.id), eq(schema.deployments.containerName, p.currentContainer)))
    .orderBy(desc(schema.deployments.id))
    .limit(1)
    .get();
  return d?.id ?? null;
}

function lastDeployments(projectIds: number[]) {
  const map = new Map<number, ProjectSummary["lastDeployment"]>();
  for (const id of projectIds) {
    const d = db
      .select({
        id: schema.deployments.id,
        status: schema.deployments.status,
        createdAt: schema.deployments.createdAt,
        finishedAt: schema.deployments.finishedAt,
      })
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, id))
      .orderBy(desc(schema.deployments.id))
      .limit(1)
      .get();
    map.set(id, d ?? null);
  }
  return map;
}

export function projectSource(p: Pick<ProjectRow, "sourceType" | "image" | "github">): ProjectSource {
  if (p.sourceType === "github" && p.github) return p.github;
  return { type: "image", image: p.image };
}

/** Kaynağı DB kolonlarına çevirir */
function sourceColumns(source: ProjectSource) {
  return source.type === "github"
    ? { sourceType: "github" as const, image: "", github: source }
    : { sourceType: "image" as const, image: source.image, github: null };
}

function previewInfo(p: ProjectRow, names: Map<number, string>): ProjectSummary["preview"] {
  if (!p.parentId || !p.prNumber) return null;
  const repo = p.github?.repoFullName;
  return {
    parentId: p.parentId,
    parentName: names.get(p.parentId) ?? "?",
    prNumber: p.prNumber,
    prTitle: p.prTitle,
    prUrl: repo ? `https://github.com/${repo}/pull/${p.prNumber}` : null,
  };
}

function toSummary(
  p: ProjectRow,
  doms: DomainEntry[],
  containers: Map<string, ContainerLite>,
  last: ProjectSummary["lastDeployment"],
  all: ProjectRow[],
): ProjectSummary {
  const names = new Map(all.map((x) => [x.id, x.name]));
  return {
    id: p.id,
    name: p.name,
    internalUrl: p.parentId ? null : `http://${p.name}:${p.port}`,
    source: projectSource(p),
    startCommand: p.startCommand,
    port: p.port,
    memoryMb: p.memoryMb,
    cpus: p.cpus,
    volumes: p.volumes ?? [],
    domains: doms,
    container: p.currentContainer ? (containers.get(p.currentContainer) ?? null) : null,
    lastDeployment: last,
    liveDeploymentId: liveDeploymentId(p),
    pinned: p.pinned,
    preview: previewInfo(p, names),
    previewCount: all.filter((x) => x.parentId === p.id).length,
    health: p.healthCheck?.enabled ? healthOf(p.id) : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Projeler. Varsayılan: PR önizlemeleri hariç; parentId verilirse o projenin önizlemeleri */
export async function listProjects(opts: { parentId?: number } = {}): Promise<ProjectSummary[]> {
  const all = db.select().from(schema.projects).orderBy(asc(schema.projects.name)).all();
  const projects = all.filter((p) => (opts.parentId ? p.parentId === opts.parentId : !p.parentId));
  const doms = db.select().from(schema.domains).orderBy(asc(schema.domains.id)).all();
  const containers = await managedContainers();
  const last = lastDeployments(projects.map((p) => p.id));
  projects.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return projects.map((p) =>
    toSummary(
      p,
      doms.filter((d) => d.projectId === p.id).map(toDomainEntry),
      containers,
      last.get(p.id) ?? null,
      all,
    ),
  );
}

export async function getProject(id: number): Promise<ProjectDetail> {
  const p = getProjectRow(id);
  const doms = db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.projectId, id))
    .orderBy(asc(schema.domains.id))
    .all()
    .map(toDomainEntry);
  const containers = await managedContainers();
  const last = lastDeployments([id]).get(id) ?? null;
  const all = db.select().from(schema.projects).all();
  return {
    ...toSummary(p, doms, containers, last, all),
    env: decryptEnv(p),
    envGroupIds: projectGroupIds(id),
    preDeployBackup: p.preDeployBackup,
    linkedDatabases: linkedDatabases(p).map((d) => d.name),
    healthCheck: p.healthCheck ?? null,
    previewSettings: getPreviewSettings(p),
  };
}

// ---- Yazma ----
export function setPinned(id: number, pinned: boolean) {
  getProjectRow(id);
  db.update(schema.projects).set({ pinned }).where(eq(schema.projects.id, id)).run();
}

export function createProject(input: z.infer<typeof createProjectSchema>) {
  if (db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.name, input.name)).get()) {
    throw new HttpError(409, "errors:project.nameTaken");
  }
  const doms = expandDomains(input.domains);
  assertDomainsAvailable(doms.map((d) => d.hostname));

  const now = Date.now();
  return db.transaction((tx) => {
    const p = tx
      .insert(schema.projects)
      .values({
        name: input.name,
        ...sourceColumns(input.source),
        startCommand: input.startCommand || null,
        port: input.port,
        envEncrypted: encryptEnv(input.env ?? []),
        memoryMb: input.memoryMb ?? null,
        cpus: input.cpus ?? null,
        volumes: input.volumes ?? [],
        preDeployBackup: input.preDeployBackup ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    for (const d of doms) tx.insert(schema.domains).values({ projectId: p.id, ...d, createdAt: now }).run();
    return p;
  });
}

export function updateProject(id: number, input: z.infer<typeof updateProjectSchema>) {
  getProjectRow(id);
  db.update(schema.projects)
    .set({
      ...sourceColumns(input.source),
      startCommand: input.startCommand || null,
      port: input.port,
      envEncrypted: encryptEnv(input.env),
      memoryMb: input.memoryMb,
      cpus: input.cpus,
      volumes: input.volumes ?? [],
      preDeployBackup: input.preDeployBackup ?? true,
      updatedAt: Date.now(),
    })
    .where(eq(schema.projects.id, id))
    .run();
}

export function addDomain(projectId: number, input: DomainInput) {
  getProjectRow(projectId);
  const doms = expandDomains([input]);
  assertDomainsAvailable(doms.map((d) => d.hostname));
  const now = Date.now();
  for (const d of doms) db.insert(schema.domains).values({ projectId, ...d, createdAt: now }).run();
}

/**
 * Projenin kullandığı panel veritabanları: ortam değişkenlerinde (gruplar dahil) veritabanı
 * container'ının adı (db-<isim>) bir adresin parçası olarak geçenler.
 */
export function linkedDatabases(p: ProjectRow) {
  const values = resolveEnv(p).map((e) => e.value);
  return db
    .select()
    .from(schema.databases)
    .all()
    .filter((d) => {
      if (d.engine === "orthanc") return false; // görüntü arşivi: deploy öncesi yedeğe uygun değil
      const re = new RegExp(`(^|[^\\w.-])db-${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.-])`);
      return values.some((v) => re.test(v));
    });
}

/** Kalıcı klasörün Docker volume adı (proje silinse de volume kalır; veri kaybolmasın) */
export const projectVolumeName = (project: string, volume: string) => `panel-vol-${project}-${volume}`;

export function setDomainAccess(projectId: number, domainId: number, access: DomainAccess) {
  const r = db
    .update(schema.domains)
    .set({ access })
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.projectId, projectId)))
    .run();
  if (!r.changes) throw new HttpError(404, "errors:project.domainNotFound");
}

export function setDomainTarget(projectId: number, domainId: number, target: DomainTarget | null) {
  const d = db.select().from(schema.domains).where(and(eq(schema.domains.id, domainId), eq(schema.domains.projectId, projectId))).get();
  if (!d) throw new HttpError(404, "errors:project.domainNotFound");
  if (d.kind !== "route") throw new HttpError(400, "errors:project.redirectNoTarget");
  for (const r of target?.rules ?? []) {
    if (r.projectId == null) continue;
    const t = db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId)).get();
    if (!t) throw new HttpError(400, "errors:project.ruleTargetNotFound", { prefix: r.prefix });
    if (t.parentId) throw new HttpError(400, "errors:project.ruleTargetPreview", { prefix: r.prefix });
  }
  const empty = !target || (target.port == null && !target.rules.length);
  db.update(schema.domains).set({ target: empty ? null : target }).where(eq(schema.domains.id, domainId)).run();
}

export function setHealthCheck(id: number, hc: ProjectRow["healthCheck"]) {
  getProjectRow(id);
  db.update(schema.projects).set({ healthCheck: hc, updatedAt: Date.now() }).where(eq(schema.projects.id, id)).run();
}

export function removeDomain(projectId: number, domainId: number) {
  const r = db
    .delete(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.projectId, projectId)))
    .run();
  if (!r.changes) throw new HttpError(404, "errors:project.domainNotFound");
}

/** Projenin tüm container'larını siler (isteğe bağlı biri hariç) */
export async function removeProjectContainers(name: string, keep?: string) {
  const list = await docker.listContainers({ all: true, filters: { label: [`${PROJECT_LABEL}=${name}`] } });
  for (const c of list) {
    const cname = (c.Names?.[0] ?? "").replace(/^\//, "");
    if (keep && cname === keep) continue;
    const ctr = docker.getContainer(c.Id);
    if (c.State === "running") await ctr.stop({ t: 10 }).catch(() => {});
    await ctr.remove({ force: true }).catch(() => {});
  }
}

/** Projenin build edilmiş image'larını temizler; en yeni `keep` tanesi ve `exclude` kalır */
export async function pruneProjectImages(name: string, keep: number, exclude: string[] = []) {
  const images = await docker.listImages({ filters: { label: [`${PROJECT_LABEL}=${name}`] } });
  const sorted = images.sort((a, b) => b.Created - a.Created);
  for (const img of sorted.slice(keep)) {
    if ((img.RepoTags ?? []).some((t) => exclude.includes(t))) continue;
    await docker
      .getImage(img.Id)
      .remove({ force: false })
      .catch(() => {}); // kullanımdaysa atla
  }
}

export async function deleteProject(id: number) {
  const p = getProjectRow(id);
  // Önce PR önizlemeleri (container ve image'ları da silinsin)
  for (const c of db.select().from(schema.projects).where(eq(schema.projects.parentId, id)).all()) await deleteProject(c.id);
  if (p.github?.compose) await composeDown(p.name).catch(() => {});
  await removeProjectContainers(p.name);
  await pruneProjectImages(p.name, 0).catch(() => {});
  clearHealth(id);
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  return p;
}

// ---- Deploylar (okuma) ----
const deploymentCols = {
  id: schema.deployments.id,
  projectId: schema.deployments.projectId,
  projectName: schema.projects.name,
  status: schema.deployments.status,
  trigger: schema.deployments.trigger,
  image: schema.deployments.image,
  commitSha: schema.deployments.commitSha,
  commitMessage: schema.deployments.commitMessage,
  containerName: schema.deployments.containerName,
  error: schema.deployments.error,
  createdAt: schema.deployments.createdAt,
  startedAt: schema.deployments.startedAt,
  finishedAt: schema.deployments.finishedAt,
};

export function listDeployments(opts: { projectId?: number; limit?: number }): DeploymentSummary[] {
  const q = db
    .select(deploymentCols)
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.deployments.projectId, schema.projects.id));
  return (opts.projectId ? q.where(eq(schema.deployments.projectId, opts.projectId)) : q)
    .orderBy(desc(schema.deployments.id))
    .limit(opts.limit ?? 50)
    .all();
}

export function getDeployment(id: number) {
  const d = db
    .select({ ...deploymentCols, log: schema.deployments.log })
    .from(schema.deployments)
    .innerJoin(schema.projects, eq(schema.deployments.projectId, schema.projects.id))
    .where(eq(schema.deployments.id, id))
    .get();
  if (!d) throw new HttpError(404, "errors:project.deployNotFound");
  return d;
}

/** Panel yeniden başladığında yarıda kalan deployları kapat */
export function failInterruptedDeployments() {
  db.update(schema.deployments)
    .set({ status: "failed", error: pt("messages:interruptedByRestart"), finishedAt: Date.now() })
    .where(inArray(schema.deployments.status, ["queued", "running"]))
    .run();
}

