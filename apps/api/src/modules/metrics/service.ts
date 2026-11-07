import os from "node:os";
import { lt } from "drizzle-orm";
import type Dockerode from "dockerode";
import { metricRanges, type ContainerUsage, type MetricHistory, type MetricRange } from "@panel/shared";
import { db, schema, sqlite } from "../../db/index.js";
import { docker, isSystemContainer } from "../../lib/docker.js";
import { diskInfo, memoryInfo, networkCounters } from "../../lib/sysinfo.js";

/**
 * Sunucu metrikleri: 15 sn'de bir CPU/bellek/disk/ağ örneği alınıp SQLite'a yazılır
 * (7 gün saklanır). Ayrıca çalışan container'ların kaynak kullanımı ölçülüp hafızada tutulur.
 */

const INTERVAL_MS = 15_000;
const RETENTION_MS = 7 * 24 * 3600_000;
const MAX_POINTS = 240;

// ---- Sunucu ----
type CpuSnap = { idle: number; total: number };
const cpuSnap = (): CpuSnap =>
  os.cpus().reduce(
    (a, c) => {
      const t = c.times;
      a.idle += t.idle;
      a.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return a;
    },
    { idle: 0, total: 0 },
  );

let prevCpu = cpuSnap();
let prevNet: { rx: number; tx: number; at: number } | null = null;
let lastNetwork: { rxPerSec: number; txPerSec: number; source: "host" | "container" } | null = null;

export const latestNetwork = () => lastNetwork;

async function sampleHost() {
  const now = Date.now();
  const cur = cpuSnap();
  const dTotal = cur.total - prevCpu.total;
  const cpu = dTotal > 0 ? Math.max(0, Math.min(100, (1 - (cur.idle - prevCpu.idle) / dTotal) * 100)) : 0;
  prevCpu = cur;

  const net = networkCounters();
  let rx: number | null = null;
  let tx: number | null = null;
  if (net && prevNet) {
    const dt = (now - prevNet.at) / 1000;
    const dRx = net.rx - prevNet.rx;
    const dTx = net.tx - prevNet.tx;
    // Sayaç sıfırlandıysa (arayüz yeniden kuruldu) bu örneği atla
    if (dt > 0 && dRx >= 0 && dTx >= 0) {
      rx = dRx / dt;
      tx = dTx / dt;
      lastNetwork = { rxPerSec: rx, txPerSec: tx, source: net.source };
    }
  }
  prevNet = net ? { rx: net.rx, tx: net.tx, at: now } : null;

  const mem = memoryInfo();
  const disk = await diskInfo();
  db.insert(schema.metrics)
    .values({
      ts: now,
      cpu: Math.round(cpu * 10) / 10,
      memUsed: mem.usedBytes,
      memTotal: mem.totalBytes,
      diskUsed: disk?.usedBytes ?? null,
      diskTotal: disk?.totalBytes ?? null,
      netRx: rx,
      netTx: tx,
      load1: os.loadavg()[0] ?? 0,
    })
    .onConflictDoNothing()
    .run();
}

export function history(range: MetricRange): MetricHistory {
  const spanMs = metricRanges[range] * 1000;
  // Kova en az örnekleme aralığı kadar olsun
  const bucketMs = Math.max(INTERVAL_MS, Math.ceil(spanMs / MAX_POINTS / INTERVAL_MS) * INTERVAL_MS);
  const rows = sqlite
    .prepare(
      `SELECT (ts / @b) * @b AS t,
              AVG(cpu) AS cpu,
              AVG(mem_used * 100.0 / mem_total) AS memPct,
              AVG(CASE WHEN disk_total > 0 THEN disk_used * 100.0 / disk_total END) AS diskPct,
              AVG(net_rx) AS rx,
              AVG(net_tx) AS tx
         FROM metrics
        WHERE ts >= @since
        GROUP BY t
        ORDER BY t`,
    )
    .all({ b: bucketMs, since: Date.now() - spanMs }) as MetricHistory["points"];
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    range,
    bucketMs,
    points: rows.map((p) => ({ ...p, cpu: r1(p.cpu)!, memPct: r1(p.memPct)!, diskPct: r1(p.diskPct), rx: p.rx, tx: p.tx })),
  };
}

// ---- Container'lar ----
let usage: ContainerUsage[] = [];
const prevContainerNet = new Map<string, { rx: number; tx: number; at: number }>();

export const containerUsage = () => usage;

function classify(c: Dockerode.ContainerInfo): Pick<ContainerUsage, "kind" | "label"> {
  const name = (c.Names?.[0] ?? c.Id).replace(/^\//, "");
  const l = c.Labels ?? {};
  if (l["panel.project"]) return { kind: "project", label: l["panel.project"] };
  if (l["panel.database"]) return { kind: "database", label: l["panel.database"] };
  if (isSystemContainer(name) || name === "caddy-dev") return { kind: "system", label: name };
  return { kind: "other", label: name };
}

async function statsOf(c: Dockerode.ContainerInfo): Promise<ContainerUsage | null> {
  try {
    const s = (await docker.getContainer(c.Id).stats({ stream: false })) as Dockerode.ContainerStats;
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage ?? 0);
    const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
    const cpus = s.cpu_stats.online_cpus || 1;
    const ms = s.memory_stats as Dockerode.ContainerStats["memory_stats"] & { stats?: Record<string, number> };
    const cache = ms.stats?.inactive_file ?? ms.stats?.total_inactive_file ?? 0;

    let rx = 0;
    let tx = 0;
    for (const n of Object.values(s.networks ?? {})) {
      rx += n.rx_bytes;
      tx += n.tx_bytes;
    }
    const now = Date.now();
    const prev = prevContainerNet.get(c.Id);
    prevContainerNet.set(c.Id, { rx, tx, at: now });
    const dt = prev ? (now - prev.at) / 1000 : 0;
    const ok = prev && dt > 0 && rx >= prev.rx && tx >= prev.tx;

    // Limit verilmemişse Docker host belleğini döner; bunu "limit yok" say
    const limit = ms.limit && ms.limit < os.totalmem() * 0.98 ? ms.limit : null;
    return {
      id: c.Id,
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
      ...classify(c),
      cpuPercent: sysDelta > 0 && cpuDelta > 0 ? Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10 : 0,
      memoryBytes: Math.max(0, (ms.usage ?? 0) - cache),
      memoryLimitBytes: limit,
      rxPerSec: ok ? (rx - prev.rx) / dt : null,
      txPerSec: ok ? (tx - prev.tx) / dt : null,
    };
  } catch {
    return null; // ölçüm sırasında durmuş olabilir
  }
}

async function sampleContainers() {
  const list = await docker.listContainers({ filters: { status: ["running"] } });
  // Docker her stats çağrısında ~1 sn örnekler; aynı anda en fazla 8 tane
  const out: ContainerUsage[] = [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map(statsOf));
    for (const u of batch) if (u) out.push(u);
  }
  const alive = new Set(list.map((c) => c.Id));
  for (const id of prevContainerNet.keys()) if (!alive.has(id)) prevContainerNet.delete(id);
  usage = out.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes);
}

export function startMetrics() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await sampleHost().catch(() => {});
      await sampleContainers().catch(() => {});
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, INTERVAL_MS).unref();
  setInterval(() => {
    db.delete(schema.metrics).where(lt(schema.metrics.ts, Date.now() - RETENTION_MS)).run();
  }, 3600_000).unref();
}

