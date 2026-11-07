import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { RecoveryPlan, RecoveryStatus, RecoverySource } from "@panel/shared";
import { db, schema } from "../../db/index.js";
import { docker } from "../../lib/docker.js";
import { HttpError } from "../../lib/errors.js";
import { backupDir, restoreBackup } from "../backups/service.js";
import { findContainer, recreateDatabase } from "../databases/service.js";
import { enqueueDeploy } from "../deploy/runner.js";
import { getStatus as offsiteStatus, importObject, listObjects } from "../offsite/service.js";
import { getDeployment, projectVolumeName } from "../projects/service.js";
import { errorText, panelDateTime, pt } from "../../lib/i18n.js";

/**
 * Felaket kurtarma: panel yedeği yeni bir sunucuya geri yüklendikten sonra panel kayıtlarını
 * gerçek duruma getirir.
 *   1. Container'ı olmayan veritabanları aynı isim/sürüm/şifreyle kurulur, en son yedekleri yüklenir
 *   2. Daha önce başarıyla deploy edilmiş ama container'ı olmayan projeler deploy edilir
 *   3. Sunucuda hiç olmayan kalıcı klasörler en son yedekleriyle doldurulur
 * En son yedek yerelde yoksa (yeni sunucu) sunucu dışı kopyadan indirilir.
 * Var olan hiçbir şeye dokunmaz: zaten çalışan veritabanının ya da dolu klasörün üzerine yazmaz.
 */

type Row = typeof schema.backups.$inferSelect;

/** Bir hedefin en son yedeği: yereldeki ve buluttaki arasından yeni olan */
async function latestSource(
  kind: "database" | "volume",
  target: string,
  fileGroup: string,
  remote: Awaited<ReturnType<typeof listObjects>> | null,
): Promise<RecoverySource | null> {
  const locals = db
    .select()
    .from(schema.backups)
    .where(and(eq(schema.backups.kind, kind), eq(schema.backups.targetName, target), eq(schema.backups.status, "success")))
    .orderBy(desc(schema.backups.createdAt), desc(schema.backups.id))
    .all()
    .filter((r) => r.fileName && fs.existsSync(path.join(backupDir, r.fileName)));
  const local = locals[0];
  // En yeni = yedeğin ALINDIĞI an (dosya adındaki zaman damgası + sıra no); buluta yüklenme zamanı
  // değil (aynı anda yüklenen eski bir yedek yanlışlıkla seçilmesin)
  const re = new RegExp(`^${fileGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{8})-(\\d{6})-(\\d+)\\.`);
  const rem = (remote ?? [])
    .map((o) => {
      const m = re.exec(o.fileName);
      if (!m) return null;
      const [, d, t, id] = m as unknown as [string, string, string, string];
      const at = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
      return { o, at, id: Number(id) };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.at - a.at || b.id - a.id)[0];
  // Yerel kayıt aynı dosyaysa ya da daha yeniyse yerel olan kullanılır
  if (local && (!rem || local.fileName === rem.o.fileName || local.createdAt > rem.at + 1000)) {
    return { where: "local", backupId: local.id, objectKey: null, fileName: local.fileName!, createdAt: local.createdAt };
  }
  if (rem) return { where: "remote", backupId: null, objectKey: rem.o.key, fileName: rem.o.fileName, createdAt: rem.at };
  return null;
}

async function remoteList() {
  const st = offsiteStatus();
  if (!st.configured) return { list: null, error: null };
  try {
    return { list: await listObjects(), error: null };
  } catch (err) {
    return { list: null, error: errorText(err) };
  }
}

const volumeExists = async (name: string) => !!(await docker.getVolume(name).inspect().catch(() => null));
const containerExists = async (id: string | null) => !!id && !!(await docker.getContainer(id).inspect().catch(() => null));
/** Projede daha önce en az bir başarılı deploy var mı (hiç deploy edilmemiş proje "eksik" sayılmaz) */
const everDeployed = (projectId: number) =>
  !!db
    .select({ id: schema.deployments.id })
    .from(schema.deployments)
    .where(and(eq(schema.deployments.projectId, projectId), eq(schema.deployments.status, "success")))
    .get();

export async function getPlan(): Promise<RecoveryPlan> {
  const { list: remote, error: remoteError } = await remoteList();
  const databases: RecoveryPlan["databases"] = [];
  for (const d of db.select().from(schema.databases).orderBy(schema.databases.name).all()) {
    if (await findContainer(d)) continue;
    databases.push({ id: d.id, name: d.name, engine: d.engine, source: await latestSource("database", d.name, `db-${d.name}`, remote) });
  }
  const projects: RecoveryPlan["projects"] = [];
  const volumes: RecoveryPlan["volumes"] = [];
  for (const p of db.select().from(schema.projects).orderBy(schema.projects.name).all()) {
    // Önizlemeler ve hiç başarıyla deploy edilmemiş projeler kurtarılacak bir şey değildir
    // (kalıcı klasörleri de ilk deploy'da açılır)
    if (p.parentId || !everDeployed(p.id)) continue;
    // Container'ı hiç yoksa eksik; durdurulmuş ama duran container bilinçli bir tercih olabilir
    if (!(await containerExists(p.currentContainer))) projects.push({ id: p.id, name: p.name });
    for (const v of p.volumes ?? []) {
      if (await volumeExists(projectVolumeName(p.name, v.name))) continue;
      volumes.push({ projectId: p.id, project: p.name, volume: v.name, path: v.path, source: await latestSource("volume", `${p.name}/${v.name}`, `vol-${p.name}-${v.name}`, remote) });
    }
  }
  return { databases, projects, volumes, remoteConfigured: offsiteStatus().configured, remoteError };
}

// ---------------------------------------------------------------------------
// Çalıştırma (tek seferde bir tane, durumu bellekte)
// ---------------------------------------------------------------------------
let job: RecoveryStatus | null = null;

export const getJob = () => job;

function step(label: string) {
  const s = { label, state: "running" as const, detail: null as string | null };
  job!.steps.push(s);
  return {
    ok: (detail?: string) => Object.assign(job!.steps[job!.steps.indexOf(s)]!, { state: "done", detail: detail ?? null }),
    fail: (detail: string) => {
      Object.assign(job!.steps[job!.steps.indexOf(s)]!, { state: "failed", detail });
      job!.failed++;
    },
    skip: (detail: string) => Object.assign(job!.steps[job!.steps.indexOf(s)]!, { state: "skipped", detail }),
  };
}

/** Kaynağı yerel bir yedek kaydına çevirir (buluttaysa indirir) */
async function toLocalBackup(src: RecoverySource): Promise<number> {
  if (src.backupId) return src.backupId;
  try {
    return (await importObject(src.objectKey!)).id;
  } catch (err) {
    // Aynı dosya bu sunucuda zaten varsa onu kullan
    if (err instanceof HttpError && err.statusCode === 409) {
      const r = db.select().from(schema.backups).where(eq(schema.backups.fileName, src.fileName)).orderBy(desc(schema.backups.id)).get() as Row | undefined;
      if (r) return r.id;
    }
    throw err;
  }
}

async function waitDeploy(id: number) {
  for (let i = 0; i < 60 * 30; i++) {
    const d = getDeployment(id);
    if (d.status === "success" || d.status === "failed") return d;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(pt("messages:recovery.deployTimeout"));
}

export async function runRecovery() {
  if (job?.state === "running") throw new HttpError(409, "errors:recovery.running");
  const plan = await getPlan();
  if (!plan.databases.length && !plan.projects.length && !plan.volumes.length) throw new HttpError(400, "errors:recovery.nothing");
  job = { state: "running", startedAt: Date.now(), finishedAt: null, steps: [], failed: 0 };
  void (async () => {
    // 1) Veritabanları: önce kur, sonra yükle (uygulamalar açılınca verilerini bulsun)
    for (const d of plan.databases) {
      const s = step(pt("messages:recovery.dbStep", { name: d.name }));
      try {
        await recreateDatabase(d.id);
        if (!d.source) {
          s.ok(pt("messages:recovery.dbEmpty"));
          continue;
        }
        const id = await toLocalBackup(d.source);
        await restoreBackup(id, { safety: false });
        s.ok(pt(d.source.where === "remote" ? "messages:recovery.dbRestoredRemote" : "messages:recovery.dbRestoredLocal", { date: panelDateTime(d.source.createdAt) }));
      } catch (err) {
        s.fail(errorText(err));
      }
    }
    // 2) Projeler
    for (const p of plan.projects) {
      const s = step(pt("messages:recovery.projectStep", { name: p.name }));
      try {
        const dep = await waitDeploy(enqueueDeploy(p.id, "manual"));
        if (dep.status === "success") s.ok(pt("messages:recovery.deployOk", { id: dep.id }));
        else s.fail(pt("messages:recovery.deployFailed", { id: dep.id, error: dep.error ?? pt("messages:recovery.seeDeployLog") }));
      } catch (err) {
        s.fail(errorText(err));
      }
    }
    // 3) Kalıcı klasörler (sadece sunucuda hiç olmayanlar; deploy boş olarak açtı)
    for (const v of plan.volumes) {
      const s = step(pt("messages:recovery.volumeStep", { project: v.project, volume: v.volume, path: v.path }));
      if (!v.source) {
        s.skip(pt("messages:recovery.volumeEmpty"));
        continue;
      }
      try {
        const id = await toLocalBackup(v.source);
        await restoreBackup(id, { safety: false });
        s.ok(pt("messages:recovery.volumeRestored", { date: panelDateTime(v.source.createdAt) }));
      } catch (err) {
        s.fail(errorText(err));
      }
    }
    job!.state = job!.failed ? "failed" : "done";
    job!.finishedAt = Date.now();
  })();
  return job;
}
