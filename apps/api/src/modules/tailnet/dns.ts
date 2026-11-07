import dgram from "node:dgram";
import net from "node:net";
import { domainToASCII } from "node:url";
import type { TailnetInfo } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import { tailnetConfigured } from "../caddy/service.js";

/**
 * Tailscale cihazları için küçük DNS sunucusu (split DNS).
 *
 * Sorun: "sadece Tailscale'den açılsın" denen bir domain (pr-12-blog.ornek.com) genel
 * DNS'te sunucunun genel IP'sini gösterir (sertifika için gerekli). Tarayıcı oraya giderse
 * bağlantı internetten gelir ve Tailscale cihazı olduğu anlaşılamaz.
 *
 * Çözüm: Tailscale yönetim panelinde "ornek.com için şu DNS sunucusunu kullan"
 * (split DNS) denir. Tailscale cihazları bu alan adındaki soruları buraya sorar:
 *   - Tailscale'e açık bir domain ise → sunucunun Tailscale IP'si (100.x / fd7a:)
 *   - Diğer her ad → genel DNS'e sorulup cevap aynen iletilir (www, @ vb. değişmez)
 * Bağlantı Tailscale üzerinden gelince Caddy cihazın Tailscale IP'sini görür ve izin verir.
 *
 * Sadece sunucunun Tailscale adreslerinde dinler (docker-compose: TAILSCALE_IPV4:53).
 */

const TYPE_A = 1;
const TYPE_AAAA = 28;
const UPSTREAM_TIMEOUT_MS = 3000;

const state = {
  running: false,
  error: null as string | null,
  lastQueryAt: null as number | null,
  lastQueryName: null as string | null,
};

// Son sorgu panel yeniden başlasa da unutulmasın (kurulumun bir kez yapıldığının kanıtı).
// Her sorguda diske yazmamak için en fazla dakikada bir kaydedilir.
const LAST_KEY = "tailnet_dns_last_query";
let savedAt = 0;
function loadLastQuery() {
  const v = getSecret<{ at: number; name: string }>(LAST_KEY);
  if (v && !state.lastQueryAt) {
    state.lastQueryAt = v.at;
    state.lastQueryName = v.name;
  }
}
function saveLastQuery() {
  if (Date.now() - savedAt < 60_000) return;
  savedAt = Date.now();
  try {
    setSecret(LAST_KEY, { at: state.lastQueryAt, name: state.lastQueryName });
  } catch {
    /* kayıt başarısız olsa da DNS cevabı etkilenmez */
  }
}

// Tailscale'e açık domainler (her sorguda DB'ye gitmemek için kısa önbellek)
let cache = { at: 0, hosts: new Set<string>() };
function tailnetHosts() {
  if (Date.now() - cache.at > 5000) {
    const rows = db.select({ hostname: schema.domains.hostname, access: schema.domains.access }).from(schema.domains).all();
    cache = { at: Date.now(), hosts: new Set(rows.filter((r) => r.access?.tailnet).map((r) => r.hostname)) };
  }
  return cache.hosts;
}
export function invalidateDnsCache() {
  cache.at = 0;
}

// ---- DNS mesajı (RFC 1035): sadece soru bölümünü okumak ve basit cevap yazmak yeterli ----
interface Question {
  id: number;
  flags: number;
  name: string;
  type: number;
  cls: number;
  /** Soru bölümünün bittiği bayt (cevap bunun arkasına eklenir) */
  end: number;
}

function parseQuestion(buf: Buffer): Question | null {
  if (buf.length < 12) return null;
  const qd = buf.readUInt16BE(4);
  if (qd !== 1) return null;
  let i = 12;
  const labels: string[] = [];
  while (i < buf.length) {
    const len = buf[i]!;
    if (len === 0) {
      i++;
      break;
    }
    if (len & 0xc0) return null; // soruda sıkıştırma beklenmez
    labels.push(buf.subarray(i + 1, i + 1 + len).toString("latin1"));
    i += 1 + len;
  }
  if (i + 4 > buf.length) return null;
  return {
    id: buf.readUInt16BE(0),
    flags: buf.readUInt16BE(2),
    name: labels.join(".").toLowerCase(),
    type: buf.readUInt16BE(i),
    cls: buf.readUInt16BE(i + 2),
    end: i + 4,
  };
}

function ipBytes(ip: string): Buffer {
  if (net.isIPv4(ip)) return Buffer.from(ip.split(".").map(Number));
  // IPv6: :: açılımı
  const [head, tail] = ip.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  const b = Buffer.alloc(16);
  groups.forEach((g, k) => b.writeUInt16BE(parseInt(g || "0", 16), k * 2));
  return b;
}

/** Soruya kendi cevabımızı yazar (Tailscale IP'si ya da boş NOERROR) */
function answer(query: Buffer, q: Question, ip: string | null): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(q.id, 0);
  // QR=1, opcode aynı, AA=1, RD aynı, RA=1, RCODE=0
  header.writeUInt16BE(0x8000 | (q.flags & 0x7900) | 0x0400 | 0x0080, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(ip ? 1 : 0, 6);
  const question = query.subarray(12, q.end);
  if (!ip) return Buffer.concat([header, question]);
  const data = ipBytes(ip);
  const rr = Buffer.alloc(12);
  rr.writeUInt16BE(0xc00c, 0); // ad: sorudaki ada işaretçi
  rr.writeUInt16BE(q.type, 2);
  rr.writeUInt16BE(1, 4); // IN
  rr.writeUInt32BE(60, 6); // TTL: değişiklikler çabuk yayılsın
  rr.writeUInt16BE(data.length, 10);
  return Buffer.concat([header, question, rr, data]);
}

function servfail(query: Buffer): Buffer {
  const b = Buffer.from(query.subarray(0, Math.min(query.length, 512)));
  if (b.length >= 4) b.writeUInt16BE(0x8000 | (b.readUInt16BE(2) & 0x7900) | 0x0080 | 2, 2);
  return b;
}

/** Bize ait olmayan soruyu genel DNS'e sorar */
function forwardUdp(query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const servers = config.tailnet.upstream;
    const host = servers[0]!;
    const sock = dgram.createSocket(net.isIPv6(host) ? "udp6" : "udp4");
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error("upstream timeout"));
    }, UPSTREAM_TIMEOUT_MS);
    let retry: NodeJS.Timeout | undefined;
    const done = () => {
      clearTimeout(timer);
      clearTimeout(retry);
      sock.close();
    };
    sock.once("message", (msg) => {
      done();
      resolve(msg);
    });
    sock.once("error", (e) => {
      done();
      reject(e);
    });
    sock.send(query, 53, host);
    // İlk sunucu cevap vermezse ikinciye de sor
    if (servers[1] && net.isIPv6(servers[1]) === net.isIPv6(host)) retry = setTimeout(() => sock.send(query, 53, servers[1]!), 800);
  });
}

function forwardTcp(query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: config.tailnet.upstream[0]!, port: 53 });
    let buf = Buffer.alloc(0);
    s.setTimeout(UPSTREAM_TIMEOUT_MS, () => s.destroy(new Error("upstream timeout")));
    s.on("connect", () => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(query.length);
      s.write(Buffer.concat([len, query]));
    });
    s.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        resolve(buf.subarray(2, 2 + buf.readUInt16BE(0)));
        s.end();
      }
    });
    s.on("error", reject);
    s.on("close", () => reject(new Error("connection closed")));
  });
}

/** Sıkıştırılmış ya da düz bir DNS adını atlar; adın bittiği baytı döner */
function skipName(buf: Buffer, i: number): number {
  while (i < buf.length) {
    const len = buf[i]!;
    if (len === 0) return i + 1;
    if ((len & 0xc0) === 0xc0) return i + 2;
    i += 1 + len;
  }
  return -1;
}

/**
 * Genel DNS'ten gelen cevaptaki TTL'leri kısaltır (yerinde).
 * Neden: bir domain sonradan "sadece Tailscale" yapılınca cihazlar genel IP'yi saatlerce
 * önbellekte tutar (ör. 4 saat) ve o süre boyunca 403 alır. Kısa TTL ile geçiş ~1 dakikada olur.
 */
export function capTtls(res: Buffer, max: number): Buffer {
  if (res.length < 12) return res;
  const counts = [res.readUInt16BE(4), res.readUInt16BE(6), res.readUInt16BE(8), res.readUInt16BE(10)];
  let i = 12;
  for (let k = 0; k < counts[0]!; k++) {
    i = skipName(res, i);
    if (i < 0) return res;
    i += 4;
  }
  const rrs = counts[1]! + counts[2]! + counts[3]!;
  for (let k = 0; k < rrs; k++) {
    i = skipName(res, i);
    if (i < 0 || i + 10 > res.length) return res;
    const type = res.readUInt16BE(i);
    // OPT (EDNS) kaydında TTL alanı TTL değil, bayraklardır
    if (type !== 41 && res.readUInt32BE(i + 4) > max) res.writeUInt32BE(max, i + 4);
    i += 10 + res.readUInt16BE(i + 8);
  }
  return res;
}

async function handle(query: Buffer, tcp: boolean): Promise<Buffer | null> {
  const q = parseQuestion(query);
  if (!q || q.flags & 0x8000) return null; // cevap paketi ya da bozuk
  state.lastQueryAt = Date.now();
  state.lastQueryName = q.name;
  saveLastQuery();

  const host = domainToASCII(q.name) || q.name;
  if (tailnetHosts().has(host) && q.cls === 1) {
    if (q.type === TYPE_A) return answer(query, q, config.tailnet.ipv4);
    if (q.type === TYPE_AAAA) return answer(query, q, config.tailnet.ipv6);
    // HTTPS/SVCB vb.: kayıt yok (tarayıcı A/AAAA ile devam eder)
    return answer(query, q, null);
  }
  try {
    return capTtls(await (tcp ? forwardTcp(query) : forwardUdp(query)), 60);
  } catch {
    return servfail(query);
  }
}

export function startTailnetDns(log: { warn: (m: string) => void; info: (m: string) => void }) {
  if (!tailnetConfigured()) return;
  loadLastQuery();
  const port = config.tailnet.dnsPort;

  // Container'ın kendi ağı IPv4; host'taki IPv6 Tailscale adresine gelenleri Docker buraya aktarır
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    void handle(msg, false).then((res) => res && udp.send(res, rinfo.port, rinfo.address));
  });
  udp.on("error", (e) => {
    state.running = false;
    state.error = e.message;
    log.warn(`Tailscale DNS (UDP ${port}) failed to start: ${e.message}`);
  });
  udp.bind(port, "0.0.0.0", () => {
    state.running = true;
    state.error = null;
    log.info(`Tailscale DNS server listening (port ${port})`);
  });

  const tcp = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.setTimeout(10_000, () => sock.destroy());
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const msg = buf.subarray(2, 2 + buf.readUInt16BE(0));
        buf = buf.subarray(2 + msg.length);
        void handle(Buffer.from(msg), true).then((res) => {
          if (!res || sock.destroyed) return;
          const len = Buffer.alloc(2);
          len.writeUInt16BE(res.length);
          sock.write(Buffer.concat([len, res]));
        });
      }
    });
    sock.on("error", () => {});
  });
  tcp.on("error", (e) => log.warn(`Tailscale DNS (TCP ${port}) failed to start: ${e.message}`));
  tcp.listen(port, "0.0.0.0");
}

/** Split DNS için Tailscale'e eklenmesi gereken alan adları (ör. ornek.com, ornek.com.tr) */
function zonesFor(hosts: string[]) {
  const twoLevel = /\.(com|net|org|gen|web|biz|info|av|bel|edu|gov|k12|tv|tel|pol|name|co|ac|or|ne|gob|gv)\.[a-z]{2}$/;
  const zones = new Set<string>();
  for (const h of hosts) {
    const parts = h.split(".");
    zones.add(parts.slice(twoLevel.test(h) ? -3 : -2).join("."));
  }
  return [...zones].sort();
}

export function tailnetInfo(): TailnetInfo {
  return {
    ipv4: config.tailnet.ipv4,
    ipv6: config.tailnet.ipv6,
    dnsRunning: state.running,
    dnsError: state.error,
    lastQueryAt: state.lastQueryAt,
    lastQueryName: state.lastQueryName,
    zones: zonesFor([...tailnetHosts()]),
  };
}
