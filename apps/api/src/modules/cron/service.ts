import { Cron } from "croner";
import { asc, eq } from "drizzle-orm";
import type { CronJob, CronJobInput } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { docker } from "../../lib/docker.js";
import { execInContainer } from "../../lib/exec.js";
import { backupAll, getBackupSettings } from "../backups/service.js";
import { notify } from "../notify/service.js";
import { HttpError, getProjectRow } from "../projects/service.js";
import { errorText, pt } from "../../lib/i18n.js";

/**
 * Zamanlayıcı: günlük yedek + projelerin cron görevleri.
 * Görevler projenin o an yayında olan container'ı içinde `sh -c` ile çalışır.
 */

type Row = typeof schema.cronJobs.$inferSelect;
const MAX_OUTPUT = 16 * 1024;
const JOB_TIMEOUT_MS = 10 * 60_000;

const timers = new Map<number, Cron>();
const runningJobs = new Set<number>();
let backupTimer: Cron | null = null;

export function validateSchedule(expr: string) {
  try {
    const c = new Cron(expr, { timezone: config.timezone, paused: true });
    const next = c.nextRun();
    c.stop();
    if (!next) throw new Error(pt("errors:cron.neverRuns"));
    return next;
  } catch (err) {
    throw new HttpError(400, "errors:cron.invalidExpression", { reason: (err as Error).message.replace(/^CronPattern: /, "") });
  }
}

function toJob(r: Row): CronJob {
  const t = timers.get(r.id);
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    schedule: r.schedule,
    command: r.command,
    enabled: r.enabled,
    nextRunAt: r.enabled && t ? (t.nextRun()?.getTime() ?? null) : null,
    lastRunAt: r.lastRunAt,
    lastStatus: r.lastStatus,
    lastOutput: r.lastOutput,
    lastDurationMs: r.lastDurationMs,
  };
}

function getRow(id: number, projectId?: number) {
  const r = db.select().from(schema.cronJobs).where(eq(schema.cronJobs.id, id)).get();
  if (!r || (projectId !== undefined && r.projectId !== projectId)) throw new HttpError(404, "errors:cron.notFound");
  return r;
}

export const listJobs = (projectId: number) =>
  db.select().from(schema.cronJobs).where(eq(schema.cronJobs.projectId, projectId)).orderBy(asc(schema.cronJobs.id)).all().map(toJob);

export function createJob(projectId: number, input: CronJobInput) {
  getProjectRow(projectId);
  validateSchedule(input.schedule);
  const r = db
    .insert(schema.cronJobs)
    .values({ projectId, name: input.name, schedule: input.schedule, command: input.command, enabled: input.enabled ?? true, createdAt: Date.now() })
    .returning()
    .get();
  schedule(r);
  return toJob(r);
}

export function updateJob(projectId: number, id: number, input: CronJobInput) {
  getRow(id, projectId);
  validateSchedule(input.schedule);
  db.update(schema.cronJobs)
    .set({ name: input.name, schedule: input.schedule, command: input.command, enabled: input.enabled ?? true })
    .where(eq(schema.cronJobs.id, id))
    .run();
  const r = getRow(id);
  schedule(r);
  return toJob(r);
}

export function deleteJob(projectId: number, id: number) {
  getRow(id, projectId);
  unschedule(id);
  db.delete(schema.cronJobs).where(eq(schema.cronJobs.id, id)).run();
}

function unschedule(id: number) {
  timers.get(id)?.stop();
  timers.delete(id);
}

function schedule(r: Row) {
  unschedule(r.id);
  if (!r.enabled) return;
  timers.set(
    r.id,
    new Cron(r.schedule, { timezone: config.timezone, protect: true }, () => {
      void runJob(r.id).catch(() => {});
    }),
  );
}

export async function runJob(id: number): Promise<CronJob> {
  const r = getRow(id);
  if (runningJobs.has(id)) throw new HttpError(409, "errors:cron.running");
  // Proje silinmişse (cascade ile görev de silinir) zamanlayıcıyı kapat
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId)).get();
  if (!project) {
    unschedule(id);
    throw new HttpError(404, "errors:project.notFound");
  }

  runningJobs.add(id);
  const started = Date.now();
  db.update(schema.cronJobs).set({ lastStatus: "running", lastRunAt: started }).where(eq(schema.cronJobs.id, id)).run();

  let status: "success" | "failed" = "failed";
  let output = "";
  try {
    if (!project.currentContainer) throw new Error(pt("messages:cron.noContainer"));
    const info = await docker.getContainer(project.currentContainer).inspect().catch(() => null);
    if (!info?.State.Running) throw new Error(pt("messages:cron.containerNotRunning", { container: project.currentContainer }));

    const res = await execInContainer(info.Id, ["sh", "-c", r.command], { timeoutMs: JOB_TIMEOUT_MS, maxOutput: MAX_OUTPUT });
    output = [res.stdout, res.stderr].filter(Boolean).join(res.stdout && res.stderr ? "\n--- stderr ---\n" : "");
    if (res.timedOut) output += `\n[${pt("messages:cron.timedOut", { count: JOB_TIMEOUT_MS / 60000 })}]`;
    status = res.exitCode === 0 && !res.timedOut ? "success" : "failed";
    if (status === "failed" && !res.timedOut) output += `\n[${pt("messages:cron.exitCode", { code: res.exitCode })}]`;
  } catch (err) {
    output = errorText(err);
  } finally {
    runningJobs.delete(id);
  }

  db.update(schema.cronJobs)
    .set({ lastStatus: status, lastOutput: output.slice(-MAX_OUTPUT), lastDurationMs: Date.now() - started })
    .where(eq(schema.cronJobs.id, id))
    .run();
  if (status === "failed") {
    notify("cronFailure", pt("notify:cron.failedTitle", { project: project.name, job: r.name }), output.slice(-1500) || pt("notify:cron.noOutput"), "error");
  }
  return toJob(getRow(id));
}

// ---- Yedek zamanlaması ----
export function scheduleBackups() {
  backupTimer?.stop();
  backupTimer = null;
  const s = getBackupSettings();
  if (!s.enabled) return;
  const days = s.days?.length && s.days.length < 7 ? s.days.join(",") : "*";
  backupTimer = new Cron(`0 ${s.hour} * * ${days}`, { timezone: config.timezone, protect: true }, () => {
    void backupAll("schedule").catch(() => {});
  });
}

export const nextBackupAt = () => backupTimer?.nextRun()?.getTime() ?? null;

export function startScheduler() {
  // Panel kapanırken yarıda kalmış görevleri kapat
  db.update(schema.cronJobs)
    .set({ lastStatus: "failed", lastOutput: pt("messages:interruptedByRestart") })
    .where(eq(schema.cronJobs.lastStatus, "running"))
    .run();
  for (const r of db.select().from(schema.cronJobs).all()) schedule(r);
  scheduleBackups();
}
