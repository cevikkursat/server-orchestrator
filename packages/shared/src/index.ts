import { z } from "zod";

// ---- Auth ----
export const setupStartSchema = z.object({
  setupToken: z.string().min(1),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(12, "validation:passwordMin"),
});
export type SetupStartInput = z.infer<typeof setupStartSchema>;

export const setupVerifySchema = z.object({
  setupToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "validation:totpCode"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export * from "./i18n";

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  /** language: kullanıcının seçtiği arayüz dili; bildirimler de bu dilde gider */
  user: { id: number; username: string; language: string | null } | null;
}

export const languageSchema = z.object({ language: z.enum(["tr", "en"]) });

export interface SetupStartResult {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

// ---- System ----
export interface SystemInfo {
  hostname: string;
  platform: string;
  release: string;
  uptimeSec: number;
  cpu: { model: string; cores: number; usagePercent: number; loadAvg: [number, number, number] };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number };
  disk: { path: string; totalBytes: number; usedBytes: number; freeBytes: number } | null;
  /** Son ölçümdeki ağ hızı (bayt/sn). Ölçülemiyorsa null */
  network: { rxPerSec: number; txPerSec: number; source: "host" | "container" } | null;
  /** Host operating system (from the host's /etc/os-release when the panel runs in Docker) */
  os: {
    /** PRETTY_NAME, e.g. "Ubuntu 24.04.1 LTS"; in development os.type() + release */
    name: string;
    /** os-release ID (ubuntu, debian, fedora, rocky, arch, opensuse-tumbleweed…) or os.platform() */
    id: string;
    version: string | null;
    /** Running inside WSL2 on Windows */
    wsl: boolean;
  };
}

// ---- Metrik geçmişi ----
export const metricRanges = { "1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600, "7d": 7 * 24 * 3600 } as const;
export type MetricRange = keyof typeof metricRanges;

export interface MetricPoint {
  /** Kova başlangıcı (ms) */
  t: number;
  cpu: number;
  memPct: number;
  diskPct: number | null;
  rx: number | null;
  tx: number | null;
}

export interface MetricHistory {
  range: MetricRange;
  /** Noktalar arası süre (ms); bundan büyük boşluklar çizgide kırılır */
  bucketMs: number;
  points: MetricPoint[];
}

export interface ContainerUsage {
  id: string;
  name: string;
  kind: "project" | "database" | "system" | "other";
  /** Proje veya veritabanı adı */
  label: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number | null;
  rxPerSec: number | null;
  txPerSec: number | null;
}

// ---- Containers ----
export type ContainerState = "running" | "exited" | "paused" | "restarting" | "created" | "removing" | "dead";

export interface ContainerPort {
  privatePort: number;
  publicPort?: number;
  type: string;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  createdAt: number;
  ports: ContainerPort[];
  composeProject: string | null;
  /** Panel tarafından yönetilen bir projeye aitse proje adı */
  projectName: string | null;
  /** Panelin kendi container'ı (durdurulmamalı) */
  isSelf: boolean;
  /** Panelin çalışması için kritik (caddy, panel) */
  isSystem: boolean;
}

export interface ContainerDetail extends ContainerSummary {
  command: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  restartCount: number;
  restartPolicy: string;
  health: string | null;
  networks: { name: string; ip: string }[];
  mounts: { type: string; source: string; destination: string; readOnly: boolean }[];
  labels: Record<string, string>;
  limits: { memoryBytes: number | null; cpus: number | null };
}

export interface ContainerStats {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  pids: number;
}

export type ContainerAction = "start" | "stop" | "restart";

export interface DockerSummary {
  available: boolean;
  version: string | null;
  containers: { total: number; running: number };
  images: number;
}

/** Log WebSocket'inden gelen mesajlar */
export type LogMessage =
  | { type: "line"; stream: "stdout" | "stderr"; ts: string | null; text: string }
  | { type: "end" }
  | { type: "error"; message: string };

// ---- Projeler ----
export const slugSchema = z
  .string()
  .min(2, "validation:slugMin")
  .max(32, "validation:slugMax")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "validation:slugFormat");

/** Türkçe karakterli domainleri (örnek: şehir.com) DNS biçimine (xn--…) çevirir; tarayıcı ve Node'da çalışır */
/** Panelin kendi adları: projeler bu adları alamaz (iç ağdaki adlarla çakışmasın) */
export const projectNameSchema = slugSchema.refine(
  (n) => !["panel", "caddy"].includes(n) && !/^(db|app)-/.test(n),
  "validation:projectNameReserved",
);

export function toAsciiHostname(v: string) {
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "");
  if (/^[\x00-\x7f]*$/.test(s)) return s;
  try {
    return new URL(`http://${s}`).hostname;
  } catch {
    return s;
  }
}

export const hostnameSchema = z
  .string()
  .transform(toAsciiHostname)
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/, "validation:domainInvalid"),
  );

export const envVarSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "validation:envKeyFormat"),
  value: z.string().max(32_768),
});
export type EnvVar = z.infer<typeof envVarSchema>;

export const imageSchema = z
  .string()
  .trim()
  .min(1, "validation:imageRequired")
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/, "validation:imageInvalid");

/** Repo içi göreli yol: boş = kök. ".." ve mutlak yol yasak */
const repoPath = z
  .string()
  .trim()
  .max(255)
  .regex(/^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.\-/]*$/, "validation:repoPathInvalid")
  .transform((s) => s.replace(/^\.\/?/, "").replace(/\/+$/, ""));

export const githubSourceSchema = z.object({
  type: z.literal("github"),
  installationId: z.number().int().positive(),
  repoId: z.number().int().positive(),
  repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  branch: z
    .string()
    .trim()
    .min(1, "validation:branchRequired")
    .max(255)
    .regex(/^(?!-)[^\s~^:?*[\\]+$/, "validation:branchInvalid"),
  /** Monorepo'larda uygulamanın bulunduğu klasör */
  rootDir: repoPath.default(""),
  /** Boşsa: rootDir/Dockerfile, o da yoksa otomatik algılama */
  dockerfilePath: repoPath.default(""),
  /** Bu branch'e push gelince otomatik deploy et */
  autoDeploy: z.boolean().default(true),
  /**
   * Monorepo: push'ta sadece bu klasörlerde (ya da dosyalarda) değişiklik varsa deploy et.
   * Boş: her push deploy edilir. Değişen dosyalar bilinemiyorsa (ör. zorla push) yine deploy edilir.
   */
  watchPaths: z.array(repoPath.refine((p) => p.length > 0, "validation:pathEmpty")).max(30).default([]),
  /**
   * Docker Compose projesi: repo içindeki compose dosyası `docker compose up` ile çalışır,
   * `service` adlı servis domainlere bağlanır. null: tek container (Dockerfile) akışı.
   */
  compose: z
    .object({
      file: repoPath.default("docker-compose.yml"),
      service: z.string().trim().min(1, "validation:serviceRequired").max(63).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "validation:serviceInvalid"),
    })
    .nullable()
    .default(null),
});
export type GithubSource = z.infer<typeof githubSourceSchema>;

export const imageSourceSchema = z.object({ type: z.literal("image"), image: imageSchema });
export type ImageSource = z.infer<typeof imageSourceSchema>;

export const projectSourceSchema = z.discriminatedUnion("type", [imageSourceSchema, githubSourceSchema]);
export type ProjectSource = z.infer<typeof projectSourceSchema>;
export type ProjectSourceInput = z.input<typeof projectSourceSchema>;

/**
 * Kalıcı klasör: container'daki bu yol, deploy'lar arasında korunan bir Docker volume'üne bağlanır
 * (yüklenen dosyalar, SQLite dosyası vb.). Gece yedeğine dahil edilir. PR önizlemelerine bağlanmaz.
 */
export const projectVolumeSchema = z.object({
  name: z.string().trim().min(1, "validation:nameRequired").max(32).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "validation:volumeNameFormat"),
  path: z
    .string()
    .trim()
    .max(255)
    .regex(/^\/[\w.\-/]*$/, "validation:volumePathAbsolute")
    .refine((p) => !p.split("/").includes(".."), "validation:pathNoDotDot")
    .refine((p) => !["/", "/bin", "/etc", "/lib", "/usr", "/proc", "/sys", "/dev"].includes(p.replace(/\/+$/, "") || "/"), "validation:volumeSystemDir")
    .transform((p) => p.replace(/\/+$/, "")),
});
export type ProjectVolume = z.infer<typeof projectVolumeSchema>;

const projectSettings = {
  source: projectSourceSchema,
  /** Container başlatma komutunu değiştirir (sh -c ile çalışır; $PORT kullanılabilir) */
  startCommand: z.string().trim().max(2000).nullable().default(null),
  port: z.number().int().min(1).max(65535),
  env: z
    .array(envVarSchema)
    .max(200)
    .refine((a) => new Set(a.map((e) => e.key)).size === a.length, "validation:envDuplicate"),
  memoryMb: z.number().int().min(32).max(16384).nullable(),
  cpus: z.number().min(0.1).max(64).nullable(),
  volumes: z
    .array(projectVolumeSchema)
    .max(10)
    .refine((a) => new Set(a.map((v) => v.name)).size === a.length, "validation:volumeDuplicateName")
    .refine((a) => new Set(a.map((v) => v.path)).size === a.length, "validation:volumeDuplicatePath")
    .default([]),
  /** Deploy başlamadan önce projenin kullandığı panel veritabanlarını yedekle */
  preDeployBackup: z.boolean().default(true),
};

/** Tek IP (1.2.3.4, 2001:db8::1) veya CIDR aralığı (1.2.3.0/24) */
export const ipOrCidrSchema = z
  .string()
  .trim()
  .regex(/^(\d{1,3}(\.\d{1,3}){3}(\/(3[0-2]|[12]?\d))?|[0-9a-fA-F:]+:[0-9a-fA-F:]*(\/(12[0-8]|1[01]\d|[1-9]?\d))?)$/, "validation:ipInvalid");

/**
 * Domain erişimi. null: herkese açık.
 * Kısıtlıysa sadece Tailscale cihazlarından (tailnet: true) ve/veya listedeki IP'lerden açılır.
 */
export const domainAccessSchema = z
  .object({
    tailnet: z.boolean(),
    ips: z.array(ipOrCidrSchema).max(50),
  })
  .refine((a) => a.tailnet || a.ips.length > 0, "validation:accessEmpty")
  .nullable();
export type DomainAccess = z.infer<typeof domainAccessSchema>;

export const domainInputSchema = z.object({
  hostname: hostnameSchema,
  redirectWww: z.boolean().default(false),
  access: domainAccessSchema.default(null),
});
export const domainAccessUpdateSchema = z.object({ access: domainAccessSchema });
export type DomainInput = z.infer<typeof domainInputSchema>;

export const createProjectSchema = z.object({
  name: projectNameSchema,
  ...projectSettings,
  domains: z.array(domainInputSchema).max(10),
  deploy: z.boolean().default(true),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object(projectSettings);
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export type DomainKind = "route" | "redirect";
/**
 * Domainin nereye gideceği. port: projenin hangi portu (null = projenin portu).
 * rules: yol önekine göre başka bir porta ya da başka bir projeye (iç adıyla) yönlendirme;
 * en uzun önek önce eşleşir, eşleşmeyen istekler varsayılan hedefe gider.
 */
export const domainRuleSchema = z.object({
  prefix: z
    .string()
    .trim()
    .max(100)
    .regex(/^\/[A-Za-z0-9._~\-/]*$/, "validation:prefixFormat")
    .transform((p) => p.replace(/\/+$/, ""))
    .refine((p) => p.length > 1, "validation:prefixEmpty"),
  /** null: bu proje */
  projectId: z.number().int().positive().nullable().default(null),
  /** null: hedef projenin portu */
  port: z.number().int().min(1).max(65535).nullable().default(null),
  /** Öneki uygulamaya göndermeden önce sil (/api/users → /users) */
  strip: z.boolean().default(false),
});
export const domainTargetSchema = z
  .object({
    port: z.number().int().min(1).max(65535).nullable().default(null),
    rules: z.array(domainRuleSchema).max(20).default([]),
  })
  .refine((t) => new Set(t.rules.map((r) => r.prefix)).size === t.rules.length, "validation:prefixDuplicate");
export type DomainTarget = z.infer<typeof domainTargetSchema>;
export const domainTargetUpdateSchema = z.object({ target: domainTargetSchema.nullable() });

export interface DomainEntry {
  id: number;
  /** null: projenin portuna */
  target: DomainTarget | null;
  /** null: herkese açık */
  access: DomainAccess;
  /** DNS biçimi (punycode) */
  hostname: string;
  /** Kullanıcıya gösterilen biçim (Türkçe karakterli olabilir) */
  display: string;
  /** route: uygulamaya gider · redirect: birincil domaine 308 ile yönlenir */
  kind: DomainKind;
  createdAt: number;
}

export type DeploymentStatus = "queued" | "running" | "success" | "failed";
export type DeploymentTrigger = "create" | "manual" | "update" | "webhook" | "rollback" | "preview";

export interface DeploymentSummary {
  id: number;
  projectId: number;
  projectName: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  /** Çalıştırılan image (GitHub projelerinde build sonrası dolar) */
  image: string;
  commitSha: string | null;
  commitMessage: string | null;
  containerName: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Deployment extends DeploymentSummary {
  log: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  /** Diğer container'ların bu projeye ulaştığı iç adres (http://<proje>:<port>); önizlemelerde null */
  internalUrl: string | null;
  source: ProjectSource;
  startCommand: string | null;
  port: number;
  memoryMb: number | null;
  cpus: number | null;
  volumes: ProjectVolume[];
  domains: DomainEntry[];
  container: { id: string; name: string; state: ContainerState; status: string } | null;
  lastDeployment: Pick<DeploymentSummary, "id" | "status" | "createdAt" | "finishedAt"> | null;
  /** Şu an trafiği alan container'ı üreten deploy (son deploy başarısızsa yayındaki sürüm budur) */
  liveDeploymentId: number | null;
  /** Listelerde en üstte durur */
  pinned: boolean;
  /** PR önizlemesiyse ana proje ve PR bilgisi */
  preview: { parentId: number; parentName: string; prNumber: number; prUrl: string | null; prTitle: string | null } | null;
  /** Ana projenin açık önizleme sayısı */
  previewCount: number;
  health: HealthStatus | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDetail extends ProjectSummary {
  env: EnvVar[];
  preDeployBackup: boolean;
  /** Ortam değişkenlerinde adresi geçen panel veritabanları (deploy öncesi yedeklenenler) */
  linkedDatabases: string[];
  envGroupIds: number[];
  healthCheck: HealthCheckSettings | null;
  previewSettings: PreviewSettings;
}

// ---- Sağlık kontrolü ----
export const healthCheckSchema = z.object({
  enabled: z.boolean(),
  /** Uygulamaya iç ağdan istek atılan yol, ör. /health */
  path: z.string().trim().max(255).regex(/^\/[\x21-\x7e]*$/, "validation:healthPathFormat"),
  intervalSec: z.number().int().min(10).max(3600),
  timeoutSec: z.number().int().min(1).max(60),
  /** Arka arkaya bu kadar başarısız kontrolde "çöktü" sayılır */
  failureThreshold: z.number().int().min(1).max(20),
  /** Çöktü sayılınca container'ı yeniden başlat */
  autoRestart: z.boolean(),
});
export type HealthCheckSettings = z.infer<typeof healthCheckSchema>;
export const defaultHealthCheck: HealthCheckSettings = { enabled: true, path: "/", intervalSec: 60, timeoutSec: 5, failureThreshold: 3, autoRestart: false };
export const projectHealthSchema = z.object({ healthCheck: healthCheckSchema.nullable() });

export interface HealthResult {
  at: number;
  ok: boolean;
  /** HTTP durum kodu; bağlanılamadıysa null */
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}
export interface HealthStatus {
  state: "up" | "down" | "unknown";
  /** Bu duruma geçiş zamanı */
  since: number | null;
  last: HealthResult | null;
  /** Eskiden yeniye */
  history: HealthResult[];
}

// ---- PR önizlemeleri ----
export const previewSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Önizlemelere özel değişkenler: aynı isimli proje değişkenlerini ezer (ör. test veritabanı) */
  env: z
    .array(envVarSchema)
    .max(200)
    .refine((a) => new Set(a.map((e) => e.key)).size === a.length, "validation:envDuplicate"),
  /** Önizleme domainlerini kimler açabilir (pr-<no>-<proje>.<ana domain>) */
  access: domainAccessSchema,
});
export type PreviewSettings = z.infer<typeof previewSettingsSchema>;
export const defaultPreviewSettings: PreviewSettings = { enabled: false, env: [], access: { tailnet: true, ips: [] } };

// ---- Ortak değişken grupları ----
export const envGroupSchema = z.object({
  name: z.string().trim().min(1, "validation:nameRequired").max(64),
  env: z
    .array(envVarSchema)
    .max(200)
    .refine((a) => new Set(a.map((e) => e.key)).size === a.length, "validation:envDuplicate"),
});
export type EnvGroupInput = z.infer<typeof envGroupSchema>;
export interface EnvGroup {
  id: number;
  name: string;
  env: EnvVar[];
  projects: { id: number; name: string }[];
  updatedAt: number;
}
export const projectPinSchema = z.object({ pinned: z.boolean() });
export const projectEnvGroupsSchema = z.object({ groupIds: z.array(z.number().int().positive()).max(20) });

export interface PanelSettings {
  baseDomain: string;
  panelDomain: string | null;
  /** tailscale: panel internete kapalı, sadece tailnet'ten erişilir */
  panelAccess: "tailscale" | "public";
  webhookDomain: string | null;
  https: boolean;
  caddy: { reachable: boolean; error: string | null; lastSyncAt: number | null };
  /** Sadece Tailscale'den açılan domainler için durum */
  tailnet: TailnetInfo;
}

export interface TailnetInfo {
  /** Sunucunun Tailscale adresleri (.env: TAILSCALE_IPV4 / TAILSCALE_IPV6); yoksa özellik kapalı */
  ipv4: string | null;
  ipv6: string | null;
  /** Panelin DNS sunucusu çalışıyor mu */
  dnsRunning: boolean;
  dnsError: string | null;
  /** Tailscale'den gelen son DNS sorgusu (split DNS ayarlandı mı anlamak için) */
  lastQueryAt: number | null;
  lastQueryName: string | null;
  /** Tailscale yönetim panelinde split DNS eklenmesi gereken alan adları */
  zones: string[];
}

// ---- GitHub ----
export interface GithubInstallation {
  id: number;
  account: string;
  accountType: string;
  /** "all" veya "selected" */
  repositorySelection: string;
  manageUrl: string;
  /** App'in istediği ama bu kurulumda henüz onaylanmamış izin/olaylar (GitHub'da onay bekler) */
  missing: string[];
}

export interface GithubStatus {
  configured: boolean;
  app: { id: number; name: string; slug: string; htmlUrl: string; owner: string; installUrl: string } | null;
  installations: GithubInstallation[];
  /** Webhook aktif mi (internete açık bir webhook adresi varsa) */
  webhookActive: boolean;
  webhookUrl: string | null;
  /** App ayarlarında olmayan, panelin yeni özelliklerinin gerektirdiği izin/olaylar */
  appMissing: string[];
  /** App'in izin ayarları sayfası */
  permissionsUrl: string | null;
  error: string | null;
}

export interface GithubRepo {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  installationId: number;
  htmlUrl: string;
}

export interface GithubManifestStart {
  /** Formun POST edileceği GitHub adresi */
  url: string;
  manifest: string;
}

// ---- Veritabanları ----
export const dbEngines = ["postgres", "mysql", "mariadb", "mongo", "redis", "valkey", "orthanc"] as const;
export type DbEngine = (typeof dbEngines)[number];

export const dbEngineInfo: Record<DbEngine, { label: string; versions: string[]; port: number; envKey: string }> = {
  postgres: { label: "PostgreSQL", versions: ["18", "17", "16"], port: 5432, envKey: "DATABASE_URL" },
  mysql: { label: "MySQL", versions: ["8.4"], port: 3306, envKey: "DATABASE_URL" },
  mariadb: { label: "MariaDB", versions: ["11"], port: 3306, envKey: "DATABASE_URL" },
  mongo: { label: "MongoDB", versions: ["8", "7"], port: 27017, envKey: "MONGODB_URI" },
  redis: { label: "Redis", versions: ["8", "7"], port: 6379, envKey: "REDIS_URL" },
  valkey: { label: "Valkey", versions: ["8"], port: 6379, envKey: "REDIS_URL" },
  orthanc: { label: "Orthanc (DICOM)", versions: ["26.9.1"], port: 8042, envKey: "ORTHANC_URL" },
};

/** Veritabanı değil, veritabanları gibi kurulan altyapı servisleri */
export const isServiceEngine = (e: DbEngine) => e === "orthanc";

/** Orthanc görüntü depolaması: sunucunun diski ya da S3 uyumlu depo (dizin her zaman sunucuda) */
export const orthancOptionsSchema = z.discriminatedUnion("storage", [
  z.object({ storage: z.literal("local") }),
  z.object({
    storage: z.literal("s3"),
    endpoint: z.string().trim().url("validation:urlInvalid").max(300),
    region: z.string().trim().min(1).max(50).default("auto"),
    bucket: z
      .string()
      .trim()
      .min(3, "validation:bucketRequired")
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "validation:bucketFormat"),
    accessKeyId: z.string().trim().min(1, "validation:accessKeyRequired").max(200),
    secretAccessKey: z.string().trim().min(1, "validation:secretKeyRequired").max(200),
    /** Bucket içinde klasör (boş: kök) */
    rootPath: z
      .string()
      .trim()
      .max(100)
      .regex(/^[a-zA-Z0-9._/-]*$/, "validation:folderFormat")
      .default(""),
  }),
]);
export type OrthancOptions = z.infer<typeof orthancOptionsSchema>;

/** Tablo/SQL tabanlı motorlar ve anahtar-değer (Redis protokolü) motorları */
export type SqlEngine = "postgres" | "mysql" | "mariadb";
export type KvEngine = "redis" | "valkey";
export const isSqlEngine = (e: DbEngine): e is SqlEngine => e === "postgres" || e === "mysql" || e === "mariadb";
export const isKvEngine = (e: DbEngine): e is KvEngine => e === "redis" || e === "valkey";

export const createDatabaseSchema = z
  .object({
    name: slugSchema,
    engine: z.enum(dbEngines),
    version: z.string(),
    memoryMb: z.number().int().min(64).max(16384).nullable(),
    /** PostgreSQL: pgvector eklentisi (vektör / benzerlik araması) */
    vector: z.boolean().default(false),
    /** Orthanc: depolama ayarı */
    orthanc: orthancOptionsSchema.optional(),
  })
  .refine((v) => v.engine !== "orthanc" || !!v.orthanc, { message: "validation:orthancStorage", path: ["orthanc"] })
  .refine((v) => dbEngineInfo[v.engine].versions.includes(v.version), { message: "validation:versionUnsupported", path: ["version"] })
  .refine((v) => !v.vector || v.engine === "postgres", { message: "validation:vectorPostgresOnly", path: ["vector"] });
export type CreateDatabaseInput = z.infer<typeof createDatabaseSchema>;

const envKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "validation:envKeyInvalid");
export const linkDatabaseSchema = z.object({ projectId: z.number().int().positive(), envKey: envKeySchema });

export interface DatabaseInfo {
  id: number;
  name: string;
  engine: DbEngine;
  version: string;
  /** pgvector'lü PostgreSQL */
  vector: boolean;
  /** Orthanc: görüntülerin nerede durduğu (gizli anahtar hariç) */
  storage: { mode: "local" } | { mode: "s3"; endpoint: string; bucket: string; rootPath: string } | null;
  memoryMb: number | null;
  createdAt: number;
  container: { id: string; state: ContainerState; status: string; ip: string | null } | null;
  /** Diğer container'ların bağlandığı adres (panel-apps ağı içinde) */
  host: string;
  port: number;
  username: string | null;
  database: string | null;
  password: string;
  connectionUrl: string;
  lastBackup: { createdAt: number; status: BackupStatus } | null;
}

// ---- Yedekler ----
export type BackupKind = "database" | "panel" | "volume";
export type BackupStatus = "running" | "success" | "failed";

export interface BackupEntry {
  id: number;
  kind: BackupKind;
  targetName: string;
  engine: DbEngine | null;
  fileName: string | null;
  sizeBytes: number | null;
  status: BackupStatus;
  error: string | null;
  trigger: "manual" | "schedule" | "predeploy";
  createdAt: number;
  finishedAt: number | null;
  /** Panelden geri yüklenebilir mi (Redis ve panel yedekleri elle yüklenir) */
  restorable: boolean;
  /** Sunucu dışı kopya: null = gönderilmeyecek (kapalıyken alınmış) */
  remoteStatus: RemoteStatus | null;
  remoteError: string | null;
  remoteAt: number | null;
}

// ---- Sunucu dışı yedek kopyası (S3 uyumlu: Cloudflare R2, Backblaze B2, Hetzner…) ----
export type RemoteStatus = "pending" | "uploading" | "uploaded" | "failed";

export const offsiteSettingsSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().trim().url("validation:urlInvalid").max(300),
  region: z.string().trim().min(1).max(50).default("auto"),
  bucket: z
    .string()
    .trim()
    .min(3, "validation:bucketRequired")
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "validation:bucketFormat"),
  accessKeyId: z.string().trim().min(1, "validation:accessKeyRequired").max(200),
  /** Boş bırakılırsa kayıtlı olan kullanılır */
  secretAccessKey: z.string().trim().max(200).default(""),
  /** Nesne adlarının ön eki (aynı bucket'ı başka şeylerle paylaşmak için) */
  prefix: z
    .string()
    .trim()
    .max(100)
    .regex(/^([a-zA-Z0-9._-]+\/)*$/, "validation:prefixFolderFormat")
    .default("panel-backups/"),
  /** Buluttaki yedeklerin saklama süresi (her hedefin en son yedeği her zaman kalır) */
  retentionDays: z.number().int().min(1).max(3650).default(30),
  /** Yeni sunucuda eski yedekleri açmak için mevcut kurtarma anahtarı (base64 ya da e-postadaki PNLKEY1.… metni) */
  key: z.string().trim().max(1000).optional(),
  /** PNLKEY1.… metninin parolası */
  keyPassphrase: z.string().max(200).optional(),
});
export type OffsiteSettingsInput = z.infer<typeof offsiteSettingsSchema>;

export interface OffsiteStatus {
  configured: boolean;
  settings: Omit<OffsiteSettingsInput, "secretAccessKey" | "key"> | null;
  hasSecret: boolean;
  /** Kurtarma anahtarının parmak izi (anahtarın kendisi değil): hangi anahtarla şifrelendiğini ayırt etmek için */
  keyFingerprint: string | null;
  pending: number;
  failed: number;
  lastUploadAt: number | null;
  /** Şu anki kurtarma anahtarı panelden dışarı alındı mı (gösterildi / e-postalandı / içe aktarıldı). null: hiç alınmadı */
  keySaved: { at: number; via: "shown" | "emailed" | "imported" } | null;
}

export interface OffsiteObject {
  key: string;
  fileName: string;
  size: number;
  lastModified: number;
  /** Bu sunucuda yerel kopyası var mı */
  local: boolean;
}

export const offsiteRevealSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "validation:totpCode") });
export const offsiteEmailKeySchema = offsiteRevealSchema.extend({
  passphrase: z.string().min(12, "validation:passphraseMin").max(200),
});

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Yedek alınacak günler (0 = Pazar … 6 = Cumartesi). Hepsi = her gün */
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1, "validation:daysMin")
    .max(7)
    .transform((a) => [...new Set(a)].sort())
    .default([0, 1, 2, 3, 4, 5, 6]),
  /** Seçili günlerde bu saatte (sunucu saat dilimi) */
  hour: z.number().int().min(0).max(23),
  retentionDays: z.number().int().min(1).max(365),
  /** Süresi dolsa da her hedef için en az bu kadar yeni yedek silinmez (yerelde ve bulutta) */
  keepMin: z.number().int().min(1).max(50).default(3),
  includePanel: z.boolean(),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;

// ---- Bildirimler ----
export const notifyEvents = [
  "login",
  "securityAlert",
  "deployFailure",
  "deploySuccess",
  "backupFailure",
  "containerDown",
  "resources",
  "cronFailure",
  "healthCheck",
  "panelUpdate",
] as const;
export type NotifyEvent = (typeof notifyEvents)[number];
export const notificationSettingsSchema = z.object({
  email: z.object({
    enabled: z.boolean(),
    /** SMTP sunucusu (Gmail: smtp.gmail.com) */
    host: z.string().trim().max(200),
    port: z.number().int().min(1).max(65535),
    /** true: doğrudan TLS (465) · false: STARTTLS (587) */
    secure: z.boolean(),
    user: z.string().trim().max(200),
    /** Kaydedilmiş değeri korumak için maskeli değer (***xxxx) geri gönderilebilir */
    password: z.string().max(200),
    /** Bildirimlerin gideceği adres */
    to: z.string().trim().max(200).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "validation:emailInvalid"),
  }),
  telegram: z.object({
    enabled: z.boolean(),
    /** Kaydedilmiş değeri korumak için maskeli değer (***xxxx) geri gönderilebilir */
    botToken: z.string().trim().max(200),
    chatId: z.string().trim().max(64),
  }),
  discord: z.object({
    enabled: z.boolean(),
    webhookUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || v.startsWith("***") || /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(v), "validation:discordWebhookInvalid"),
  }),
  events: z.object(Object.fromEntries(notifyEvents.map((e) => [e, z.boolean()])) as Record<NotifyEvent, z.ZodBoolean>),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

// ---- Zamanlanmış görevler ----
export const cronJobSchema = z.object({
  name: z.string().trim().min(1, "validation:nameRequired").max(64),
  schedule: z.string().trim().min(9, "validation:cronInvalid").max(100),
  command: z.string().trim().min(1, "validation:commandRequired").max(4000),
  enabled: z.boolean().default(true),
});
export type CronJobInput = z.input<typeof cronJobSchema>;

export interface CronJob {
  id: number;
  projectId: number;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: "running" | "success" | "failed" | null;
  lastOutput: string | null;
  lastDurationMs: number | null;
}

// ---- Terminal (WebSocket) ----
/** İstemci → sunucu */
export type TerminalClientMessage = { t: "i"; d: string } | { t: "r"; c: number; r: number };
/** Sunucu → istemci */
export type TerminalServerMessage = { t: "o"; d: string } | { t: "x"; code: number | null } | { t: "e"; m: string };

// ---- Domain kontrolleri ----
export interface DomainOverview {
  /** Sunucunun internetteki IP adresleri (DNS kayıtları bunları göstermeli) */
  publicIps: string[];
  baseDomain: string;
  panelDomain: string | null;
  panelAccess: "tailscale" | "public";
  webhookDomain: string | null;
  https: boolean;
  domains: (DomainEntry & { projectId: number; projectName: string; primaryHostname: string | null })[];
}

export type DnsStatus = "ok" | "proxied" | "wrong" | "missing" | "unknown";

export interface DomainCheck {
  hostname: string;
  dns: { status: DnsStatus; addresses: string[]; message: string };
  /** HTTPS kapalıysa (geliştirme) null */
  tls: { ok: boolean; issuer: string | null; validTo: number | null; message: string } | null;
}

// ---- Güvenlik ----
export const securitySettingsSchema = z.object({
  /** Boşsa her IP'den giriş ekranına erişilebilir (2FA yine zorunlu) */
  ipAllowlist: z.array(ipOrCidrSchema).max(50),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, "validation:newPasswordMin").max(200),
  code: z.string().regex(/^\d{6}$/, "validation:totpCode"),
});

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  expiresAt: number;
  current: boolean;
}

export interface AuditEntry {
  id: number;
  action: string;
  details: string | null;
  ip: string | null;
  createdAt: number;
}

export interface SecurityOverview {
  currentIp: string;
  settings: SecuritySettings;
  /** Hesap kilidi aktifse bitiş zamanı */
  lockedUntil: number | null;
  failedLast15m: number;
  idleTimeoutHours: number;
  sessionDays: number;
  panelAccess: "tailscale" | "public";
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// ---- Disk temizliği ----
export const cleanupSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Bu kadar günden eski, kullanılmayan image'lar ve build önbelleği silinir */
  olderThanDays: z.number().int().min(1).max(90),
});
export type CleanupSettings = z.infer<typeof cleanupSettingsSchema>;

export interface CleanupResult {
  at: number;
  trigger: "manual" | "schedule" | "predeploy";
  reclaimedBytes: number;
  imagesDeleted: number;
  error: string | null;
}

export interface DiskUsage {
  images: { count: number; sizeBytes: number; reclaimableBytes: number };
  containers: { count: number; sizeBytes: number };
  volumes: { count: number; sizeBytes: number };
  buildCache: { sizeBytes: number; reclaimableBytes: number };
}

export interface CleanupOverview {
  settings: CleanupSettings;
  nextRunAt: number | null;
  running: boolean;
  last: CleanupResult | null;
  usage: DiskUsage | null;
}

// ---- Panel güncelleme ----
export interface UpdateCommit {
  sha: string;
  message: string;
  date: string;
}
export interface UpdateStatus {
  /** Sunucuda güncelleyici (systemd) kurulu mu */
  installed: boolean;
  state: "idle" | "running" | "done" | "failed";
  action: "check" | "update" | null;
  startedAt: number | null;
  finishedAt: number | null;
  branch: string | null;
  current: UpdateCommit | null;
  /** Uzak depoda olup sunucuda olmayan commit'ler (yeniden eskiye) */
  pending: UpdateCommit[];
  /** .env.example'da olup deploy/.env'de olmayan değişkenler */
  missingEnv: string[];
  log: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Veritabanı gezgini (panel içinden veri görme / düzenleme)
// ---------------------------------------------------------------------------

/** Gezgin, oturum başına 2FA koduyla açılır ve hareketsiz kalınca kilitlenir */
export const explorerUnlockSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "validation:totpCode") });
export interface ExplorerStatus {
  unlocked: boolean;
  /** Kilidin kendiliğinden kapanacağı an (her istekte uzar) */
  expiresAt: number | null;
  idleMinutes: number;
}

/** Sol ağaç: şemalar/veritabanları → tablolar/koleksiyonlar */
export interface ExplorerTree {
  engine: DbEngine;
  groups: { name: string; items: { name: string; kind: "table" | "view" | "collection" | "keys"; count: number | null }[] }[];
}

// ---- SQL (PostgreSQL, MariaDB) ----
/** Hücreler metin olarak taşınır (veritabanının kendi metin gösterimi): kayıpsız gidip gelir */
export type SqlCell = string | null;
export interface SqlColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  hasDefault: boolean;
  /** İkili veri vb.: gösterilir, düzenlenemez */
  editable: boolean;
}
const ident = z.string().min(1).max(128);
export const sqlFilterSchema = z.object({
  column: ident,
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "null", "notnull"]),
  value: z.string().max(10_000).default(""),
});
export type SqlFilter = z.infer<typeof sqlFilterSchema>;
export const sqlRowsSchema = z.object({
  schema: ident,
  table: ident,
  page: z.number().int().min(0).max(1_000_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
  sort: z.object({ column: ident, dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  filters: z.array(sqlFilterSchema).max(10).default([]),
});
export type SqlRowsRequest = z.infer<typeof sqlRowsSchema>;
export interface SqlRowsResult {
  columns: SqlColumn[];
  rows: SqlCell[][];
  /** Uzun hücreler listede kısaltılır; tam değer düzenlerken getirilir */
  truncated: boolean;
  total: number | null;
  /** Birincil anahtarı olan tablo: satır düzenlenebilir */
  editable: boolean;
  kind: "table" | "view";
}
const cellRecord = z.record(z.string().max(128), z.string().max(5_000_000).nullable());
export const sqlRowKeySchema = z.object({ schema: ident, table: ident, key: cellRecord });
export const sqlRowUpdateSchema = sqlRowKeySchema.extend({ values: cellRecord });
export const sqlRowInsertSchema = z.object({ schema: ident, table: ident, values: cellRecord });
export const sqlQuerySchema = z.object({
  sql: z.string().trim().min(1, "validation:queryEmpty").max(200_000),
  /** false: salt okunur (yanlışlıkla veri değişmesin) */
  write: z.boolean().default(false),
});
export interface SqlStatementResult {
  command: string;
  columns: string[] | null;
  rows: SqlCell[][] | null;
  rowCount: number | null;
  truncated: boolean;
}
export interface SqlQueryResult {
  statements: SqlStatementResult[];
  durationMs: number;
}

// ---- MongoDB ----
const mongoName = z.string().min(1).max(120).regex(/^[^\0$]+$/, "validation:nameInvalid");
/** JSON metinleri MongoDB Extended JSON (relaxed) biçimindedir: {"$oid": …}, {"$date": …} */
const ejson = z.string().max(16_000_000);
export const mongoFindSchema = z.object({
  db: mongoName,
  collection: mongoName,
  filter: ejson.default("{}"),
  sort: ejson.default("{}"),
  skip: z.number().int().min(0).max(10_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
});
export interface MongoFindResult {
  docs: string[];
  total: number | null;
}
export const mongoDocSchema = z.object({ db: mongoName, collection: mongoName, doc: ejson });
export const mongoIdSchema = z.object({ db: mongoName, collection: mongoName, id: ejson });
export const mongoReplaceSchema = mongoIdSchema.extend({ doc: ejson });

// ---- Redis ----
export type RedisType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "none" | string;
const redisDb = z.number().int().min(0).max(15);
const redisKey = z.string().min(1).max(10_000);
export const redisScanSchema = z.object({
  db: redisDb,
  pattern: z.string().max(1000).default("*"),
  cursor: z.string().max(40).default("0"),
});
export interface RedisScanResult {
  cursor: string;
  keys: { key: string; type: RedisType; ttlMs: number }[];
}
export const redisKeySchema = z.object({ db: redisDb, key: redisKey });
export interface RedisValue {
  key: string;
  type: RedisType;
  ttlMs: number;
  length: number;
  /** string: metin · hash: [alan, değer] · list/set: değerler · zset: [üye, skor] · stream: [id, alanlar] */
  value: string | string[] | [string, string][];
  truncated: boolean;
}
export const redisOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("hset"), field: z.string().min(1).max(10_000), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("hdel"), field: z.string().max(10_000) }),
  z.object({ op: z.literal("lset"), index: z.number().int(), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("rpush"), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("lrem"), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("sadd"), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("srem"), value: z.string().max(5_000_000) }),
  z.object({ op: z.literal("zadd"), member: z.string().max(5_000_000), score: z.number() }),
  z.object({ op: z.literal("zrem"), member: z.string().max(5_000_000) }),
  /** null: süresiz */
  z.object({ op: z.literal("expire"), seconds: z.number().int().min(1).max(10 * 365 * 86400).nullable() }),
  z.object({ op: z.literal("del") }),
]);
export type RedisOp = z.infer<typeof redisOpSchema>;
export const redisEditSchema = redisKeySchema.extend({ change: redisOpSchema });
export const redisCreateSchema = redisKeySchema.extend({
  type: z.enum(["string", "hash", "list", "set", "zset"]),
  /** string: değer · hash: alan=değer ilk alan · diğerleri: ilk eleman */
  value: z.string().max(5_000_000),
  field: z.string().max(10_000).default(""),
  score: z.number().default(0),
});

// ---------------------------------------------------------------------------
// Felaket kurtarma (panel yedeği yeni sunucuya açıldıktan sonra eksikleri tamamlama)
// ---------------------------------------------------------------------------
export interface RecoverySource {
  where: "local" | "remote";
  backupId: number | null;
  objectKey: string | null;
  fileName: string;
  createdAt: number;
}
export interface RecoveryPlan {
  /** Panelde kayıtlı ama container'ı olmayan veritabanları */
  databases: { id: number; name: string; engine: DbEngine; source: RecoverySource | null }[];
  /** Daha önce başarıyla deploy edilmiş ama container'ı sunucuda olmayan projeler (hiç deploy edilmemişler hariç) */
  projects: { id: number; name: string }[];
  /** Sunucuda hiç olmayan kalıcı klasörler */
  volumes: { projectId: number; project: string; volume: string; path: string; source: RecoverySource | null }[];
  remoteConfigured: boolean;
  remoteError: string | null;
}
export interface RecoveryStatus {
  state: "running" | "done" | "failed";
  startedAt: number;
  finishedAt: number | null;
  steps: { label: string; state: "running" | "done" | "failed" | "skipped"; detail: string | null }[];
  failed: number;
}
export const panelRestoreSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "validation:totpCode") });

/** Orthanc istatistikleri (panelde kartta gösterilir) */
export interface OrthancStats {
  patients: number;
  studies: number;
  series: number;
  instances: number;
  sizeMb: number;
}
