import { Cron } from "croner";
import type { CleanupOverview, CleanupResult, CleanupSettings, DiskUsage } from "@panel/shared";
import { config } from "../../config.js";
import { docker } from "../../lib/docker.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import { notify } from "../notify/service.js";
import { PROJECT_LABEL } from "../projects/service.js";
import { pt } from "../../lib/i18n.js";

/**
 * Disk temizliği (haftalık, Pazar 04:00 + elle).
 *   - Etiketsiz (dangling) image'lar: her zaman
 *   - N günden eski, hiçbir container'ın kullanmadığı image'lar. Panelin proje build'leri HARİÇ:
 *     onlar geri dönüş için saklanır (proje başına son 5 build, deploy sonrası panel temizler).
 *   - N günden eski build önbelleği
 * Volume'lere (veriler) ve container'lara dokunulmaz.
 */

const SETTINGS_KEY = "cleanup.settings";
const LAST_KEY = "cleanup.last";
const defaults: CleanupSettings = { enabled: true, olderThanDays: 7 };

let timer: Cron | null = null;
let running = false;

export const getCleanupSettings = (): CleanupSettings => ({ ...defaults, ...(getSecret<CleanupSettings>(SETTINGS_KEY) ?? {}) });

export function saveCleanupSettings(s: CleanupSettings) {
  setSecret(SETTINGS_KEY, s);
  scheduleCleanup();
}

export async function diskUsage(): Promise<DiskUsage | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const df: any = await docker.df();
    const images = (df.Images ?? []) as { Size: number; SharedSize: number; Containers: number }[];
    const containers = (df.Containers ?? []) as { SizeRw?: number }[];
    const volumes = (df.Volumes ?? []) as { UsageData?: { Size: number } }[];
    const cache = (df.BuildCache ?? []) as { Size: number; InUse: boolean; Shared: boolean }[];
    return {
      images: {
        count: images.length,
        // Katmanlar image'lar arasında paylaşıldığı için toplam, Docker'ın verdiği katman boyutudur
        sizeBytes: df.LayersSize ?? images.reduce((a, i) => a + i.Size, 0),
        reclaimableBytes: images.filter((i) => i.Containers === 0).reduce((a, i) => a + Math.max(0, i.Size - Math.max(0, i.SharedSize)), 0),
      },
      containers: { count: containers.length, sizeBytes: containers.reduce((a, c) => a + (c.SizeRw ?? 0), 0) },
      volumes: { count: volumes.length, sizeBytes: volumes.reduce((a, v) => a + Math.max(0, v.UsageData?.Size ?? 0), 0) },
      buildCache: {
        sizeBytes: cache.reduce((a, c) => a + c.Size, 0),
        reclaimableBytes: cache.filter((c) => !c.InUse && !c.Shared).reduce((a, c) => a + c.Size, 0),
      },
    };
  } catch {
    return null;
  }
}

export async function runCleanup(trigger: CleanupResult["trigger"]): Promise<CleanupResult> {
  if (running) throw Object.assign(new Error("errors:maintenance.running"), { statusCode: 409 });
  running = true;
  const until = `${getCleanupSettings().olderThanDays * 24}h`;
  const result: CleanupResult = { at: Date.now(), trigger, reclaimedBytes: 0, imagesDeleted: 0, error: null };
  try {
    const dangling = await docker.pruneImages({ filters: { dangling: ["true"] } });
    // Kullanılmayan eski image'lar; proje build'leri (geri dönüş için) hariç
    const unused = await docker.pruneImages({ filters: { dangling: ["false"], until: [until], "label!": [PROJECT_LABEL] } });
    const cache = await docker.pruneBuilder({ filters: { until: [until] } } as Parameters<typeof docker.pruneBuilder>[0] & object);
    for (const r of [dangling, unused]) {
      result.reclaimedBytes += r.SpaceReclaimed ?? 0;
      result.imagesDeleted += (r.ImagesDeleted ?? []).filter((d) => d.Deleted).length;
    }
    result.reclaimedBytes += cache.SpaceReclaimed ?? 0;
  } catch (err) {
    result.error = (err as Error).message;
    notify("resources", pt("notify:maintenance.failedTitle"), result.error, "warning");
  } finally {
    running = false;
  }
  setSecret(LAST_KEY, result);
  return result;
}

export function scheduleCleanup() {
  timer?.stop();
  timer = null;
  if (!getCleanupSettings().enabled) return;
  timer = new Cron("0 4 * * 0", { timezone: config.timezone, protect: true }, () => {
    void runCleanup("schedule").catch(() => {});
  });
}

export async function cleanupOverview(): Promise<CleanupOverview> {
  return {
    settings: getCleanupSettings(),
    nextRunAt: timer?.nextRun()?.getTime() ?? null,
    running,
    last: getSecret<CleanupResult>(LAST_KEY),
    usage: await diskUsage(),
  };
}
