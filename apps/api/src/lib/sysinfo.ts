import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";

/**
 * Bellek: Linux'ta os.freemem() dosya önbelleğini "kullanılan" sayar ve bellek hep dolu
 * görünür. /proc/meminfo'daki MemAvailable, gerçekte kullanılabilir belleği verir.
 */
export function memoryInfo() {
  const total = os.totalmem();
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const avail = /^MemAvailable:\s+(\d+) kB/m.exec(txt);
    if (avail) {
      const free = Number(avail[1]) * 1024;
      return { totalBytes: total, freeBytes: free, usedBytes: total - free };
    }
  } catch {}
  const free = os.freemem();
  return { totalBytes: total, freeBytes: free, usedBytes: total - free };
}

// Sanal arayüzler (container köprüleri vb.) sayılmasın; aynı trafik iki kez toplanır
const VIRTUAL_IFACE = /^(lo|veth|docker|br-|virbr|cni|flannel|cali|vxlan|tunl|kube|services)/;

/**
 * Toplam ağ sayaçları (bayt). Panel container içindeyse kendi ağ alanını değil,
 * host'unkini okumak için host'un 1 numaralı sürecinin ağ bilgisine bakılır
 * (/host/proc/1/net/dev). Okunamazsa container'ın kendi sayaçlarına düşer.
 */
export function networkCounters(): { rx: number; tx: number; source: "host" | "container" } | null {
  const hostRoot = process.env.HOST_ROOT;
  const candidates: [string, "host" | "container"][] = [
    ...(hostRoot ? ([[`${hostRoot}/proc/1/net/dev`, "host"]] as [string, "host"][]) : []),
    ["/proc/net/dev", hostRoot ? "container" : "host"],
  ];
  for (const [file, source] of candidates) {
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n").slice(2);
      let rx = 0;
      let tx = 0;
      for (const line of lines) {
        const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
        if (!m || VIRTUAL_IFACE.test(m[1]!.trim())) continue;
        const f = m[2]!.trim().split(/\s+/).map(Number);
        rx += f[0] ?? 0;
        tx += f[8] ?? 0;
      }
      return { rx, tx, source };
    } catch {}
  }
  return null; // ör. Windows geliştirme ortamı
}

/** Parses os-release (KEY=value, values optionally quoted) */
function parseOsRelease(txt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of txt.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\(["'\\$`])/g, "$1");
    }
    out[m[1]!] = v;
  }
  return out;
}

function readFirst(files: string[]): string | null {
  for (const f of files) {
    try {
      return fs.readFileSync(f, "utf8");
    } catch {}
  }
  return null;
}

export type HostOsInfo = { name: string; id: string; version: string | null; wsl: boolean };
let osCache: HostOsInfo | null = null;

/**
 * Host operating system. In Docker the host root is mounted at HOST_ROOT (/host), so the host's
 * own /etc/os-release is read (the container's would say Debian). WSL2 is detected from the
 * kernel version string (the kernel is shared, so /proc/version works inside the container too).
 * In development (e.g. Windows) it falls back to Node's os module. The OS does not change while
 * the panel runs, so the result is cached.
 */
export function hostOsInfo(): HostOsInfo {
  if (osCache) return osCache;
  const root = process.env.HOST_ROOT ?? "";
  const kernel = (readFirst([`${root}/proc/version`, "/proc/version"]) ?? os.release()).toLowerCase();
  const wsl = /microsoft|wsl/.test(kernel) || Boolean(process.env.WSL_DISTRO_NAME);
  const rel = process.platform === "linux" ? readFirst([`${root}/etc/os-release`, `${root}/usr/lib/os-release`]) : null;
  if (rel) {
    const r = parseOsRelease(rel);
    osCache = {
      name: r.PRETTY_NAME || [r.NAME, r.VERSION].filter(Boolean).join(" ") || "Linux",
      id: r.ID || "linux",
      version: r.VERSION_ID || null,
      wsl,
    };
  } else {
    osCache = { name: `${os.type()} ${os.release()}`, id: os.platform(), version: os.release() || null, wsl };
  }
  return osCache;
}

export async function diskInfo() {
  // Container içinde host diski /host olarak bağlanır
  const p = process.platform === "win32" ? "C:\\" : (process.env.HOST_ROOT ?? "/");
  try {
    const s = await fsp.statfs(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { path: p, totalBytes: total, freeBytes: free, usedBytes: total - free };
  } catch {
    return null;
  }
}
