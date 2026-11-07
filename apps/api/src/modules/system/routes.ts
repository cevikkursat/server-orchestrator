import os from "node:os";
import type { FastifyInstance } from "fastify";
import type { SystemInfo } from "@panel/shared";
import { diskInfo, hostOsInfo, memoryInfo } from "../../lib/sysinfo.js";
import { latestNetwork } from "../metrics/service.js";

function cpuTimes() {
  return os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

async function cpuUsagePercent(sampleMs = 250) {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = cpuTimes();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 1000) / 10 : 0;
}

export async function systemRoutes(app: FastifyInstance) {
  app.get("/api/system", async (): Promise<SystemInfo> => {
    const [usagePercent, disk] = await Promise.all([cpuUsagePercent(), diskInfo()]);
    const cpus = os.cpus();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSec: Math.floor(os.uptime()),
      cpu: {
        model: cpus[0]?.model.trim() ?? "unknown",
        cores: cpus.length,
        usagePercent,
        loadAvg: os.loadavg() as [number, number, number],
      },
      memory: memoryInfo(),
      network: latestNetwork(),
      disk,
      os: hostOsInfo(),
    };
  });
}
