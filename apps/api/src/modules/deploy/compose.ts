import fs from "node:fs";
import path from "node:path";
import type { EnvVar, GithubSource } from "@panel/shared";
import { config } from "../../config.js";
import { docker } from "../../lib/docker.js";
import { run } from "../../lib/process.js";
import { pt } from "../../lib/i18n.js";

/**
 * Docker Compose projeleri.
 *
 * Repo `composeDir/<proje>/` altına çekilir ve `docker compose -p panel-<proje> up -d --build`
 * çalıştırılır. Panel kendi ek dosyasını (override) ekler:
 *   - tüm servislere panel etiketleri, log boyutu sınırı, yeniden başlatma politikası
 *   - domainlere bağlanan servis: panel-apps ağı (Caddy ulaşsın) + projenin ortam değişkenleri
 * Projenin ortam değişkenleri compose dosyasında ${DEGISKEN} olarak da kullanılabilir.
 *
 * Güvenlik: sunucuyu ele geçirebilecek ayarlar reddedilir (privileged, host ağı, dışarı port
 * açma, proje klasörü dışını bağlama, docker.sock…). Uygulamalar dışarıya sadece Caddy ile açılır.
 */

type Log = (l: string) => void;
type ComposeSource = GithubSource & { compose: NonNullable<GithubSource["compose"]> };

export const composeProjectName = (name: string) => `panel-${name}`;
const projectDir = (name: string) => path.join(config.docker.composeDir, name);
const overridePath = (name: string) => path.join(config.docker.composeDir, `.${name}.panel.json`);
/** Repo buraya çekilir (aynı diskte olsun ki proje klasörüne taşımak anlık olsun) */
export const composeStagingDir = (name: string, depId: number) => path.join(config.docker.composeDir, `.${name}.new-${depId}`);

interface ComposeService {
  image?: string;
  privileged?: boolean;
  network_mode?: string;
  pid?: string;
  ipc?: string;
  userns_mode?: string;
  cap_add?: string[];
  devices?: unknown[];
  ports?: { published?: string | number; target?: number }[];
  volumes?: { type: string; source?: string; target?: string }[];
  restart?: string;
  logging?: unknown;
}
interface ComposeConfig {
  services: Record<string, ComposeService>;
}

const DANGEROUS_CAPS = new Set(["ALL", "SYS_ADMIN", "SYS_MODULE", "SYS_PTRACE", "SYS_RAWIO", "NET_ADMIN", "DAC_READ_SEARCH", "SYS_BOOT"]);

function validate(cfg: ComposeConfig, dir: string, mainService: string) {
  const problems: string[] = [];
  if (!cfg.services[mainService]) {
    problems.push(pt("messages:compose.serviceMissing", { service: mainService, services: Object.keys(cfg.services).join(", ") }));
  }
  const inside = (p: string) => {
    const rel = path.relative(dir, p);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  for (const [name, s] of Object.entries(cfg.services)) {
    const at = `${name}:`;
    if (s.privileged) problems.push(`${at} ${pt("messages:compose.notAllowed", { what: "privileged" })}`);
    for (const [k, v] of [["network_mode", s.network_mode], ["pid", s.pid], ["ipc", s.ipc], ["userns_mode", s.userns_mode]] as const) {
      if (v === "host") problems.push(`${at} ${pt("messages:compose.notAllowed", { what: `${k}: host` })}`);
    }
    if (name === mainService && s.network_mode) problems.push(`${at} ${pt("messages:compose.mainNetworkMode")}`);
    if (s.ports?.some((p) => p.published !== undefined && p.published !== "")) {
      problems.push(`${at} ${pt("messages:compose.ports")}`);
    }
    if (s.devices?.length) problems.push(`${at} ${pt("messages:compose.notAllowed", { what: "devices" })}`);
    const caps = (s.cap_add ?? []).map((c) => c.toUpperCase().replace(/^CAP_/, "")).filter((c) => DANGEROUS_CAPS.has(c));
    if (caps.length) problems.push(`${at} ${pt("messages:compose.notAllowed", { what: `cap_add: ${caps.join(", ")}` })}`);
    for (const v of s.volumes ?? []) {
      if (v.type === "bind" && v.source && !inside(v.source)) {
        problems.push(`${at} ${pt("messages:compose.bindOutside", { source: v.source })}`);
      } else if (v.type === "bind" && v.source && !fs.existsSync(v.source)) {
        // Repoda olmayan klasör = çalışırken oluşan veri. Proje klasörü her deploy'da repodan
        // yenilendiği için bu veri silinirdi.
        problems.push(
          `${at} ${pt("messages:compose.bindMissing", { source: `./${path.relative(dir, v.source)}`, target: v.target })}`,
        );
      }
    }
  }
  if (problems.length) throw new Error(`${pt("messages:compose.rejected")}\n  - ${problems.join("\n  - ")}`);
}


function buildOverride(name: string, cfg: ComposeConfig | null, mainService: string, env: EnvVar[], services: string[]) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const svc of services) {
    const s = cfg?.services[svc];
    out[svc] = {
      labels: { "panel.managed": "true", "panel.project": name, "panel.compose": "true" },
      ...(s && !s.restart ? { restart: "unless-stopped" } : {}),
      ...(s && !s.logging ? { logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } } } : {}),
    };
  }
  out[mainService] = {
    ...out[mainService],
    // Ana servis panel-apps ağında proje adıyla da bulunur (http://<proje>:<port>)
    networks: { default: {}, [config.docker.appsNetwork]: { aliases: [name] } },
    // Değerler dosyaya YAZILMAZ (diskte düz metin kalmasın): compose çalışırken panelin verdiği
    // ortamdan okunur. Yerine konan değer tekrar yorumlanmadığı için $ içeren değerler de bozulmaz.
    environment: Object.fromEntries(env.map((e) => [e.key, `\${${e.key}}`])),
  };
  return { services: out, networks: { [config.docker.appsNetwork]: { external: true } } };
}

async function compose(name: string, workdir: string, file: string, args: string[], env: EnvVar[], log: Log | null, timeoutMs = 10 * 60_000) {
  const res = await run(
    "docker",
    ["compose", "-p", composeProjectName(name), "--project-directory", workdir, "-f", file, "-f", overridePath(name), ...args],
    {
      cwd: workdir,
      // Compose dosyasındaki ${DEGISKEN}'ler projenin değişkenlerinden dolar; panelin kendi ayarları sızmasın
      inheritEnv: false,
      env: Object.fromEntries(env.map((e) => [e.key, e.value])),
      timeoutMs,
      mask: env.filter((e) => e.value.length >= 8).map((e) => e.value),
      onLine: log ? (l) => l.trim() && log(`  ${l}`) : undefined,
    },
  );
  return res;
}

/**
 * Compose projesini kurar/günceller. Çekilmiş repo `srcDir`'dedir; buradan proje klasörüne taşınır.
 * Domainlere bağlanan servisin container adını döner.
 */
export async function composeUp(opts: { name: string; gh: ComposeSource; srcDir: string; env: EnvVar[]; log: Log }): Promise<string> {
  const { name, gh, env, log } = opts;
  const { file, service } = gh.compose;
  fs.mkdirSync(config.docker.composeDir, { recursive: true });

  // Yeni dosyalar yerine geçer (eski container'ların bağladığı dosyalar .prev'de kalır)
  const dir = projectDir(name);
  const prev = `${dir}.prev`;
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(dir)) fs.renameSync(dir, prev);
  fs.renameSync(opts.srcDir, dir);

  const workdir = path.join(dir, gh.rootDir);
  const composeFile = path.join(workdir, file);
  let cfg: ComposeConfig;
  try {
    if (!fs.existsSync(workdir) || !fs.realpathSync(workdir).startsWith(fs.realpathSync(dir))) {
      throw new Error(pt("messages:compose.rootInvalid"));
    }
    if (!fs.existsSync(composeFile)) throw new Error(pt("messages:compose.fileMissing", { file: path.join(gh.rootDir, file) }));

    // 1) Servis listesi (sadece repodaki dosya) → ana servis var mı
    fs.writeFileSync(overridePath(name), "{}");
    const list = await compose(name, workdir, composeFile, ["config", "--services"], env, null, 60_000);
    if (list.code !== 0) throw new Error(`${pt("messages:compose.unreadable")}\n${list.output.slice(-10).join("\n")}`);
    const names = list.output.map((l) => l.trim()).filter(Boolean);
    if (!names.includes(service)) throw new Error(pt("messages:compose.serviceMissing", { service, services: names.join(", ") }));

    // 2) Panel eklentisiyle birleşmiş tam ayar → güvenlik doğrulaması
    fs.writeFileSync(overridePath(name), JSON.stringify(buildOverride(name, null, service, env, names)));
    const cfgRes = await compose(name, workdir, composeFile, ["config", "--format", "json"], env, null, 60_000);
    if (cfgRes.code !== 0) throw new Error(`${pt("messages:compose.unreadable")}\n${cfgRes.output.slice(-10).join("\n")}`);
    cfg = JSON.parse(cfgRes.output.join("\n")) as ComposeConfig;
    validate(cfg, dir, service);
  } catch (err) {
    // Çalışan servisler eski dosyalarla devam etsin
    fs.rmSync(dir, { recursive: true, force: true });
    if (fs.existsSync(prev)) fs.renameSync(prev, dir);
    throw err;
  }
  const services = Object.keys(cfg.services);
  log(pt("messages:compose.services", { services: services.join(", "), service }));

  // 3) Asıl eklenti: tüm servislere etiket/log/restart, ana servise ağ + değişkenler
  fs.writeFileSync(overridePath(name), JSON.stringify(buildOverride(name, cfg, service, env, services)));

  log("docker compose up -d --build");
  const up = await compose(name, workdir, composeFile, ["up", "-d", "--build", "--remove-orphans", "--quiet-pull"], env, log, 30 * 60_000);
  if (up.code !== 0) throw new Error(pt("messages:compose.upFailed", { code: up.code }));

  // Repodan dosya bağlayan (./nginx.conf gibi) servisler: ayarı değişmese bile yeni dosyaları görsün.
  // Linux'ta bağlama eski klasöre (artık .prev) takılı kalır; yeniden oluşturmak gerekir.
  const bindServices = services.filter((svc) => cfg.services[svc]?.volumes?.some((v) => v.type === "bind"));
  if (bindServices.length) {
    log(pt("messages:compose.recreating", { services: bindServices.join(", ") }));
    const re = await compose(name, workdir, composeFile, ["up", "-d", "--no-deps", "--force-recreate", ...bindServices], env, log, 10 * 60_000);
    if (re.code !== 0) throw new Error(pt("messages:compose.upFailed", { code: re.code }));
  }
  fs.rmSync(prev, { recursive: true, force: true });

  const list = await docker.listContainers({
    all: true,
    filters: { label: [`com.docker.compose.project=${composeProjectName(name)}`, `com.docker.compose.service=${service}`] },
  });
  const main = list.find((c) => c.State === "running") ?? list[0];
  if (!main) throw new Error(pt("messages:compose.containerMissing", { service }));
  return (main.Names?.[0] ?? main.Id).replace(/^\//, "");
}

/** Proje silinirken: container'lar ve ağ kaldırılır. Adlandırılmış volume'ler (veriler) KALIR. */
export async function composeDown(name: string) {
  const res = await run("docker", ["compose", "-p", composeProjectName(name), "down", "--remove-orphans"], { inheritEnv: false, timeoutMs: 5 * 60_000 });
  fs.rmSync(projectDir(name), { recursive: true, force: true });
  fs.rmSync(`${projectDir(name)}.prev`, { recursive: true, force: true });
  fs.rmSync(overridePath(name), { force: true });
  if (res.code !== 0) throw new Error(res.output.slice(-3).join(" | "));
}
