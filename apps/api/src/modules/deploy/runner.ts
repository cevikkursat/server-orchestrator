import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type Dockerode from "dockerode";
import type { DeploymentTrigger, GithubSource } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { docker } from "../../lib/docker.js";
import { syncCaddy } from "../caddy/service.js";
import { installationToken, setCommitStatus } from "../github/service.js";
import { notify } from "../notify/service.js";
import {
  HttpError,
  MANAGED_LABEL,
  PROJECT_LABEL,
  getProjectRow,
  linkedDatabases,
  projectVolumeName,
  resolveEnv,
  pruneProjectImages,
  removeProjectContainers,
  type ProjectRow,
} from "../projects/service.js";
import { buildImage, cloneRepo, planBuild } from "./builder.js";
import { composeStagingDir, composeUp } from "./compose.js";
import { probeHttp } from "../health/service.js";
import { backupDatabase } from "../backups/service.js";
import { errorText, pt } from "../../lib/i18n.js";

/**
 * Deploy akışı (kesintisiz):
 *   0. (GitHub kaynağı) Repo çekilir ve image build edilir
 *   1. (Image kaynağı) Image çekilir
 *   2. Yeni container `app-<proje>-<deployId>` adıyla başlatılır (eskisi çalışmaya devam eder)
 *   3. Hazır olması beklenir (TCP portu / Docker healthcheck / kararlı çalışma)
 *   4. Caddy upstream'i yeni container'a çevrilir
 *   5. Kısa bir bekleme sonrası eski container'lar kapatılır
 * Herhangi bir adım başarısız olursa yeni container silinir, eski hiç etkilenmez.
 */

/** Saklanacak build image'ı sayısı (geri dönüş için) */
const KEEP_IMAGES = 5;

// Aynı projenin deployları sıraya girer
const chains = new Map<number, Promise<void>>();

// Build'ler sunucuyu yorar: tüm projeler genelinde aynı anda tek build
let buildChain: Promise<unknown> = Promise.resolve();
function withBuildSlot<T>(fn: () => Promise<T>): Promise<T> {
  const p = buildChain.then(fn, fn);
  buildChain = p.catch(() => {});
  return p;
}

export function enqueueDeploy(
  projectId: number,
  trigger: DeploymentTrigger,
  extra: { commitSha?: string | null; commitMessage?: string | null; image?: string } = {},
) {
  const p = getProjectRow(projectId);
  const dep = db
    .insert(schema.deployments)
    .values({
      projectId,
      status: "queued",
      trigger,
      // GitHub projelerinde gerçek image build sonrası yazılır
      image: extra.image ?? (p.sourceType === "github" && p.github ? `${p.github.repoFullName}@${p.github.branch}` : p.image),
      commitSha: extra.commitSha ?? null,
      commitMessage: extra.commitMessage?.split("\n")[0]?.slice(0, 300) ?? null,
      createdAt: Date.now(),
    })
    .returning({ id: schema.deployments.id })
    .get();

  const prev = chains.get(projectId) ?? Promise.resolve();
  const next = prev.then(() => runDeploy(dep.id)).catch(() => {});
  chains.set(projectId, next);
  void next.finally(() => {
    if (chains.get(projectId) === next) chains.delete(projectId);
  });
  return dep.id;
}

function appendLog(id: number, line: string) {
  const ts = new Date().toISOString().slice(11, 19);
  db.update(schema.deployments)
    .set({ log: sql`${schema.deployments.log} || ${`[${ts}] ${line}\n`}` })
    .where(eq(schema.deployments.id, id))
    .run();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tag yoksa :latest ekle (aksi halde Docker TÜM tag'leri çeker) */
export function normalizeImage(image: string) {
  if (image.includes("@")) return image;
  const last = image.split("/").pop() ?? image;
  return last.includes(":") ? image : `${image}:latest`;
}

async function pullImage(image: string, log: (l: string) => void) {
  log(pt("messages:deploy.pulling", { image }));
  try {
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      const seen = new Set<string>();
      docker.modem.followProgress(
        stream,
        (err) => (err ? reject(err) : resolve()),
        (e: { status?: string; id?: string; progress?: string; error?: string }) => {
          if (e.error) return;
          // İlerleme çubuğu satırlarını atla, her katman için durumları bir kez yaz
          if (e.progress || !e.status) return;
          const key = `${e.id ?? ""}:${e.status}`;
          if (seen.has(key)) return;
          seen.add(key);
          if (!e.id || /Pull complete|Already exists/.test(e.status)) log(e.id ? `  ${e.id}: ${e.status}` : `  ${e.status}`);
        },
      );
    });
  } catch (err) {
    // Yerelde build edilmiş image'lar registry'de yoktur
    const local = await docker
      .getImage(image)
      .inspect()
      .catch(() => null);
    if (!local) throw new Error(pt("messages:deploy.pullFailed", { error: (err as Error).message }));
    log(pt("messages:deploy.pullLocal", { error: (err as Error).message.split("\n")[0] }));
  }
}

async function ensureNetwork(name: string) {
  const nets = await docker.listNetworks({ filters: { name: [name] } });
  if (!nets.some((n) => n.Name === name)) await docker.createNetwork({ Name: name, Driver: "bridge" });
}

function tcpProbe(host: string, port: number, timeoutMs = 2000) {
  return new Promise<boolean>((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

async function waitReady(c: Dockerode.Container, name: string, port: number, log: (l: string) => void, opts: { fresh?: boolean } = {}) {
  const deadline = Date.now() + config.docker.readyTimeoutMs;
  let stableSince: number | null = null;
  let mode: string | null = null;
  const enter = (m: string, msg: string) => {
    if (mode !== m) {
      mode = m;
      log(msg);
    }
  };

  while (Date.now() < deadline) {
    const info = await c.inspect();
    const st = info.State;
    if (st.Status === "exited" || st.Status === "dead") {
      throw new Error(pt("messages:deploy.exited", { code: st.ExitCode }));
    }
    if (st.Restarting || (opts.fresh !== false && info.RestartCount > 0)) {
      throw new Error(pt("messages:deploy.restarting", { code: st.ExitCode }));
    }

    if (st.Health) {
      enter("health", pt("messages:deploy.waitDockerHealth"));
      if (st.Health.Status === "healthy") return;
      if (st.Health.Status === "unhealthy") throw new Error(pt("messages:deploy.dockerUnhealthy"));
    } else if (config.docker.panelInDocker) {
      enter("tcp", pt("messages:deploy.waitPort", { port }));
      if (await tcpProbe(name, port)) return;
    } else {
      // Geliştirme ortamı: panel container IP'lerine ulaşamaz; 5 sn kararlı çalışmayı yeterli say
      enter("stable", pt("messages:deploy.waitStable"));
      if (st.Running) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= 5000) return;
      }
    }
    await sleep(1000);
  }
  throw new Error(
    mode === "tcp"
      ? pt("messages:deploy.portTimeout", { port, count: config.docker.readyTimeoutMs / 1000 })
      : pt("messages:deploy.notReady"),
  );
}

/**
 * Deploy öncesi yedek: yeni sürüm açılırken veritabanını değiştirirse (migration) bir önceki
 * duruma dönülebilsin. Yedek alınamazsa deploy durur (veri güvenliği önce).
 */
async function backupBeforeDeploy(project: ProjectRow, log: (l: string) => void) {
  if (project.parentId || !project.preDeployBackup) return;
  for (const d of linkedDatabases(project)) {
    log(pt("messages:deploy.preBackup", { name: d.name, engine: d.engine }));
    const b = await backupDatabase(d.id, "predeploy");
    if (b.status !== "success") {
      throw new Error(pt("messages:deploy.preBackupFailed", { name: d.name, error: b.error ?? pt("messages:unknownError") }));
    }
    log(pt("messages:deploy.preBackupDone", { id: b.id, file: b.fileName, kb: ((b.sizeBytes ?? 0) / 1024).toFixed(0) }));
  }
}

/** Proje sağlık kontrolü açıksa, trafiği çevirmeden önce o yolun da yanıt vermesini bekle */
async function waitHealthy(host: string, project: ProjectRow, log: (l: string) => void) {
  const hc = project.healthCheck;
  if (!hc?.enabled || !config.docker.panelInDocker) return;
  log(pt("messages:deploy.waitHealth", { path: hc.path }));
  const deadline = Date.now() + config.docker.readyTimeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const r = await probeHttp(host, project.port, hc.path, hc.timeoutSec * 1000);
    if (r.ok) {
      log(pt("messages:deploy.healthOk", { status: r.status, ms: r.latencyMs }));
      return;
    }
    if (r.error !== last) log(`  ${r.error}`);
    last = r.error ?? "";
    await sleep(2000);
  }
  throw new Error(pt("messages:deploy.healthTimeout", { count: config.docker.readyTimeoutMs / 1000, path: hc.path, error: last }));
}

async function tailContainerLogs(c: Dockerode.Container, lines = 30): Promise<string[]> {
  try {
    const buf = (await c.logs({ stdout: true, stderr: true, tail: lines, follow: false })) as unknown as Buffer;
    // Multiplex başlıklarını (8 bayt) ayıkla
    const out: string[] = [];
    let i = 0;
    if (buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0) {
      while (i + 8 <= buf.length) {
        const len = buf.readUInt32BE(i + 4);
        out.push(buf.subarray(i + 8, i + 8 + len).toString("utf8"));
        i += 8 + len;
      }
      return out.join("").split("\n").filter(Boolean);
    }
    return buf.toString("utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let activeBuilds = 0;

/** Repoyu çekip image build eder; image etiketini döner */
async function buildFromGithub(
  project: ProjectRow,
  gh: GithubSource,
  depId: number,
  log: (l: string) => void,
  onCommit: (c: { sha: string; message: string }) => void,
): Promise<string> {
  if (activeBuilds > 0) log(pt("messages:deploy.buildQueued"));
  return withBuildSlot(async () => {
    activeBuilds++;
    const dir = path.join(config.dataDir, "builds", String(depId));
    try {
      const token = await installationToken(gh.installationId);
      const commit = await cloneRepo({ repoFullName: gh.repoFullName, branch: gh.branch, token, dest: dir, log });
      onCommit(commit);

      const contextDir = path.join(dir, gh.rootDir);
      // Repo içindeki bir symlink ile klon dışına çıkılmasın
      if (fs.existsSync(contextDir) && !fs.realpathSync(contextDir).startsWith(fs.realpathSync(dir))) {
        throw new Error(pt("messages:deploy.rootOutside"));
      }
      const plan = planBuild(contextDir, { dockerfilePath: gh.dockerfilePath, startCommand: project.startCommand });
      const tag = `panel-${project.name}:${depId}`;
      await buildImage({
        contextDir,
        plan,
        tag,
        labels: {
          [MANAGED_LABEL]: "true",
          [PROJECT_LABEL]: project.name,
          "panel.deployment": String(depId),
          "panel.commit": commit.sha,
          // Üretilen Dockerfile'lar başlatma komutunu zaten içerir
          "panel.generated": plan.generated ? "1" : "0",
        },
        log,
      });
      return tag;
    } finally {
      activeBuilds--;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

async function runDeploy(id: number) {
  const log = (l: string) => appendLog(id, l);
  const setStatus = (v: Partial<typeof schema.deployments.$inferInsert>) =>
    db.update(schema.deployments).set(v).where(eq(schema.deployments.id, id)).run();

  setStatus({ status: "running", startedAt: Date.now() });
  const dep = db.select().from(schema.deployments).where(eq(schema.deployments.id, id)).get()!;
  const project = getProjectRow(dep.projectId);
  const gh = project.sourceType === "github" ? project.github : null;
  const name = `app-${project.name}-${id}`;
  const previous = project.currentContainer;
  let container: Dockerode.Container | null = null;

  // GitHub'da commit'in yanında görünen durum
  let commitSha = dep.commitSha;
  const targetUrl = config.panelDomain
    ? `https://${config.panelDomain}/projects/${project.id}?tab=deploys&deploy=${id}`
    : null;
  const previewHost = project.parentId
    ? (db.select().from(schema.domains).where(eq(schema.domains.projectId, project.id)).get()?.hostname ?? null)
    : null;
  const report = (state: "pending" | "success" | "failure", desc: string) =>
    gh && commitSha
      ? setCommitStatus(
          gh.installationId,
          gh.repoFullName,
          commitSha,
          state,
          desc,
          state === "success" && previewHost ? `https://${previewHost}` : targetUrl,
          project.parentId ? "sunucu-paneli/preview" : "sunucu-paneli/deploy",
        )
      : Promise.resolve();

  try {
    log(pt("messages:deploy.started", { id, trigger: dep.trigger, project: project.name }));
    void report("pending", pt("messages:deploy.statusStarted"));
    await ensureNetwork(config.docker.appsNetwork);

    if (gh?.compose) {
      // ---- Docker Compose projesi ----
      const compose = gh.compose;
      const env = resolveEnv(project);
      await backupBeforeDeploy(project, log);
      const cname = await withBuildSlot(async () => {
        const staging = composeStagingDir(project.name, id);
        try {
          const token = await installationToken(gh.installationId);
          const commit = await cloneRepo({
            repoFullName: gh.repoFullName,
            branch: gh.branch,
            token,
            dest: staging,
            log,
            sha: dep.trigger === "rollback" ? dep.commitSha : null,
          });
          commitSha = commit.sha;
          setStatus({ commitSha: commit.sha, commitMessage: commit.message.slice(0, 300), image: `compose:${gh.repoFullName}@${commit.sha.slice(0, 7)}` });
          void report("pending", "docker compose up");
          return await composeUp({ name: project.name, gh: { ...gh, compose }, srcDir: staging, env, log });
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
      });
      const c = docker.getContainer(cname);
      log(pt("messages:deploy.composeWait", { name: cname }));
      await waitReady(c, cname, project.port, log, { fresh: false });
      await waitHealthy(cname, project, log);
      db.update(schema.projects).set({ currentContainer: cname }).where(eq(schema.projects.id, project.id)).run();
      await syncCaddy();
      setStatus({ status: "success", containerName: cname, finishedAt: Date.now() });
      log(pt("messages:deploy.success"));
      void report("success", pt("messages:deploy.statusSuccess"));
      notify("deploySuccess", pt("notify:deploy.successTitle", { project: project.name }), `#${id} · ${commitSha ? commitSha.slice(0, 7) + " · " : ""}docker compose`);
      return;
    }

    let image: string;
    if (dep.trigger === "rollback") {
      image = dep.image;
      log(pt("messages:deploy.rollingBack", { image }));
      const local = await docker
        .getImage(image)
        .inspect()
        .catch(() => null);
      if (!local) {
        if (image.startsWith("panel-")) throw new Error(pt("messages:deploy.imageGone"));
        await pullImage(image, log);
      }
    } else if (gh) {
      image = await buildFromGithub(project, gh, id, log, (c) => {
        commitSha = c.sha;
        setStatus({ commitSha: c.sha, commitMessage: c.message.slice(0, 300) });
        void report("pending", pt("messages:deploy.statusBuilding"));
      });
      setStatus({ image });
    } else {
      image = normalizeImage(project.image);
      setStatus({ image });
      await pullImage(image, log);
    }

    const env = resolveEnv(project);
    // Image hazır; yeni container açılmadan (migration çalışmadan) hemen önce
    await backupBeforeDeploy(project, log);
    // Uygulamalar dinleyecekleri portu PORT değişkeninden okuyabilsin
    if (!env.some((e) => e.key === "PORT")) env.push({ key: "PORT", value: String(project.port) });

    // Başlatma komutu: üretilen Dockerfile'larda zaten gömülü
    const imgInfo = await docker.getImage(image).inspect();
    const generated = imgInfo.Config?.Labels?.["panel.generated"] === "1";
    const cmd = project.startCommand && !generated ? ["sh", "-c", project.startCommand] : undefined;
    if (cmd) log(pt("messages:deploy.startCommand", { command: project.startCommand }));

    // Kalıcı klasörler (PR önizlemelerine bağlanmaz: canlı dosyalara yazmasınlar)
    const volumes = project.parentId ? [] : (project.volumes ?? []);
    for (const v of volumes) {
      const vname = projectVolumeName(project.name, v.name);
      const exists = await docker.getVolume(vname).inspect().catch(() => null);
      if (!exists) {
        await docker.createVolume({ Name: vname, Labels: { [MANAGED_LABEL]: "true", [PROJECT_LABEL]: project.name, "panel.volume": v.name } });
        log(pt("messages:deploy.volumeCreated", { name: vname }));
      }
      log(pt("messages:deploy.volume", { path: v.path, name: vname }));
    }

    log(pt("messages:deploy.creating", { name, port: project.port, count: env.length }));
    container = await docker.createContainer({
      name,
      Image: image,
      ...(cmd ? { Cmd: cmd } : {}),
      Env: env.map((e) => `${e.key}=${e.value}`),
      Labels: {
        [MANAGED_LABEL]: "true",
        [PROJECT_LABEL]: project.name,
        "panel.deployment": String(id),
      },
      ExposedPorts: { [`${project.port}/tcp`]: {} },
      // Sabit iç ad: diğer container'lar bu projeye http://<proje>:<port> ile ulaşır. Blue-green'de yeni
      // container adı en baştan taşır, eski kapatılınca onunki kalkar. PR önizlemeleri canlı adı almaz.
      NetworkingConfig: { EndpointsConfig: { [config.docker.appsNetwork]: { Aliases: project.parentId ? [] : [project.name] } } },
      HostConfig: {
        NetworkMode: config.docker.appsNetwork,
        RestartPolicy: { Name: "unless-stopped" },
        Mounts: volumes.map((v) => ({ Type: "volume" as const, Source: projectVolumeName(project.name, v.name), Target: v.path })),
        ...(project.memoryMb
          ? { Memory: project.memoryMb * 1024 * 1024, MemorySwap: project.memoryMb * 1024 * 1024 * 2 }
          : {}),
        ...(project.cpus ? { NanoCpus: Math.round(project.cpus * 1e9) } : {}),
        LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
        // Uygulamalar ayrıcalık yükseltemesin
        SecurityOpt: ["no-new-privileges"],
      },
    });
    await container.start();
    log(pt("messages:deploy.startedWait"));
    await waitReady(container, name, project.port, log);
    log(pt("messages:deploy.ready"));
    await waitHealthy(name, project, log);

    // Trafiği yeni container'a çevir
    db.update(schema.projects).set({ currentContainer: name }).where(eq(schema.projects.id, project.id)).run();
    try {
      await syncCaddy();
      log(pt("messages:deploy.caddySwitched"));
    } catch (err) {
      db.update(schema.projects).set({ currentContainer: previous }).where(eq(schema.projects.id, project.id)).run();
      throw new Error(pt("messages:deploy.caddyFailed", { error: (err as Error).message }));
    }

    if (previous) {
      // Devam eden istekler bitsin
      await sleep(3000);
      log(pt("messages:deploy.stoppingOld", { name: previous }));
    }
    await removeProjectContainers(project.name, name);
    if (image.startsWith("panel-")) await pruneProjectImages(project.name, KEEP_IMAGES, [image]).catch(() => {});

    setStatus({ status: "success", containerName: name, finishedAt: Date.now() });
    log(pt("messages:deploy.success"));
    void report("success", pt("messages:deploy.statusSuccess"));
    notify("deploySuccess", pt("notify:deploy.successTitle", { project: project.name }), `#${id} · ${commitSha ? commitSha.slice(0, 7) + " · " : ""}${image}`);
  } catch (err) {
    const msg = errorText(err);
    log(pt("messages:deploy.error", { error: msg }));
    if (container) {
      const tail = await tailContainerLogs(container);
      if (tail.length) {
        log(pt("messages:deploy.lastLogs"));
        for (const l of tail) log(`  ${l}`);
      }
      await container.remove({ force: true }).catch(() => {});
      log(previous ? pt("messages:deploy.removedNewKeepOld", { name: previous }) : pt("messages:deploy.removedNew"));
    }
    setStatus({ status: "failed", error: msg, finishedAt: Date.now() });
    void report("failure", msg);
    notify(
      "deployFailure",
      pt("notify:deploy.failedTitle", { project: project.name }),
      `#${id}: ${msg}${previous && !gh?.compose ? "\n" + pt("notify:deploy.previousRunning") : ""}`,
      "error",
    );
  }
}

/** Başarılı bir eski deploy'un image'ı ile yeniden deploy */
export function rollbackTo(deploymentId: number) {
  const d = db
    .select()
    .from(schema.deployments)
    .where(and(eq(schema.deployments.id, deploymentId), eq(schema.deployments.status, "success")))
    .get();
  if (!d) throw new HttpError(404, "errors:deploy.noSuccessful");
  return enqueueDeploy(d.projectId, "rollback", {
    image: d.image,
    commitSha: d.commitSha,
    commitMessage: d.commitMessage,
  });
}
