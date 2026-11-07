import { db, schema } from "../../db/index.js";
import { docker } from "../../lib/docker.js";
import { diskInfo, memoryInfo } from "../../lib/sysinfo.js";
import { notify } from "../notify/service.js";
import { pt } from "../../lib/i18n.js";

/**
 * Dakikada bir: disk/bellek doluluğu ve proje/veritabanı container'larının durumu.
 * Aynı durum için tekrar tekrar bildirim atmamak için son durum hafızada tutulur;
 * sadece değişimlerde (çöktü → düzeldi) bildirim gider.
 */

const HIGH = 90;
const RECOVER = 85;
const alerted = { disk: false, memory: false };
const lastState = new Map<string, boolean>(); // container adı → çalışıyor mu

async function checkResources() {
  const mem = memoryInfo();
  const disk = await diskInfo();
  const memPct = (mem.usedBytes / mem.totalBytes) * 100;
  const diskPct = disk ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1);

  if (disk && !alerted.disk && diskPct >= HIGH) {
    alerted.disk = true;
    notify("resources", pt("notify:monitor.diskTitle", { pct: diskPct.toFixed(0) }), pt("notify:monitor.diskBody", { free: gb(disk.freeBytes) }), "warning");
  } else if (alerted.disk && diskPct < RECOVER) alerted.disk = false;

  if (!alerted.memory && memPct >= HIGH) {
    alerted.memory = true;
    notify("resources", pt("notify:monitor.memoryTitle", { pct: memPct.toFixed(0) }), pt("notify:monitor.memoryBody", { free: gb(mem.freeBytes), total: gb(mem.totalBytes) }), "warning");
  } else if (alerted.memory && memPct < RECOVER) alerted.memory = false;
}

/** Bilinçli olarak durdurulan container'lar (yedek, geri yükleme): "durdu" bildirimi gitmesin */
const maintenance = new Set<string>();

export async function withMaintenance<T>(name: string, fn: () => Promise<T>): Promise<T> {
  maintenance.add(name);
  try {
    return await fn();
  } finally {
    maintenance.delete(name);
    lastState.delete(name); // sonraki turda durumu sessizce yeniden öğren
  }
}

async function checkContainers() {
  const watched = new Map<string, string>(); // container adı → görünen ad
  for (const p of db.select().from(schema.projects).all()) {
    if (p.currentContainer) watched.set(p.currentContainer, pt("notify:monitor.projectLabel", { name: p.name }));
  }
  for (const d of db.select().from(schema.databases).all()) watched.set(`db-${d.name}`, pt("notify:monitor.databaseLabel", { name: d.name }));

  const list = await docker.listContainers({ all: true, filters: { label: ["panel.managed=true"] } });
  const byName = new Map(list.map((c) => [(c.Names?.[0] ?? "").replace(/^\//, ""), c]));

  for (const [name, label] of watched) {
    if (maintenance.has(name)) continue;
    const c = byName.get(name);
    const up = c?.State === "running";
    const prev = lastState.get(name);
    lastState.set(name, up);
    if (prev === undefined) continue; // ilk tur: sadece durumu öğren
    if (prev && !up) {
      notify("containerDown", pt("notify:monitor.downTitle", { label }), c ? pt("notify:monitor.status", { status: c.Status }) : pt("notify:monitor.containerMissing"), "error");
    } else if (!prev && up) {
      notify("containerDown", pt("notify:monitor.upTitle", { label }), c?.Status ?? "", "info");
    }
  }
  for (const name of lastState.keys()) if (!watched.has(name)) lastState.delete(name);
}

export function startMonitor() {
  const tick = () => {
    checkResources().catch(() => {});
    checkContainers().catch(() => {});
  };
  tick();
  setInterval(tick, 60_000).unref();
}
