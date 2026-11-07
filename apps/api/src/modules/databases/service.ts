import crypto from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { dbEngineInfo, type CreateDatabaseInput, type DatabaseInfo, type DbEngine, type ContainerState, type OrthancOptions } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { docker } from "../../lib/docker.js";
import { execInContainer } from "../../lib/exec.js";
import { HttpError, MANAGED_LABEL } from "../projects/service.js";
import { pt } from "../../lib/i18n.js";

/**
 * Tek tıkla veritabanı: resmi image ile `db-<isim>` container'ı, kalıcı `panel-db-<isim>`
 * volume'ü ve rastgele şifre. Sadece panel-apps ağında erişilebilir; dışarıya port açılmaz.
 */

export const DB_LABEL = "panel.database";
export type DatabaseRow = typeof schema.databases.$inferSelect;

const containerName = (name: string) => `db-${name}`;
const volumeName = (name: string) => `panel-db-${name}`;

interface EngineSpec {
  image: (v: string, vector?: boolean) => string;
  /** Volume'ün bağlanacağı yer */
  dataDir: (v: string) => string;
  env: (pw: string) => string[];
  cmd?: (pw: string) => string[];
  user: string | null;
  database: string | null;
  url: (host: string, pw: string) => string;
  healthcheck: (pw: string) => string[];
}

export const engines: Record<DbEngine, EngineSpec> = {
  postgres: {
    // pgvector: eklentinin resmi imajı (Debian tabanlı resmi postgres imajı + vector)
    image: (v, vector) => (vector ? `pgvector/pgvector:pg${v}` : `postgres:${v}-alpine`),
    // PostgreSQL 18+ veriyi sürüm alt klasöründe tutar; üst klasör bağlanmalı
    dataDir: (v) => (Number(v) >= 18 ? "/var/lib/postgresql" : "/var/lib/postgresql/data"),
    env: (pw) => ["POSTGRES_USER=app", `POSTGRES_PASSWORD=${pw}`, "POSTGRES_DB=app"],
    user: "app",
    database: "app",
    url: (h, pw) => `postgresql://app:${pw}@${h}:5432/app`,
    healthcheck: () => ["CMD-SHELL", "pg_isready -U app -d app"],
  },
  mysql: {
    image: (v) => `mysql:${v}`,
    dataDir: () => "/var/lib/mysql",
    env: (pw) => [`MYSQL_ROOT_PASSWORD=${pw}`, "MYSQL_DATABASE=app", "MYSQL_USER=app", `MYSQL_PASSWORD=${pw}`],
    user: "app",
    database: "app",
    url: (h, pw) => `mysql://app:${pw}@${h}:3306/app`,
    healthcheck: () => ["CMD-SHELL", 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'],
  },
  mariadb: {
    image: (v) => `mariadb:${v}`,
    dataDir: () => "/var/lib/mysql",
    env: (pw) => [`MARIADB_ROOT_PASSWORD=${pw}`, "MARIADB_DATABASE=app", "MARIADB_USER=app", `MARIADB_PASSWORD=${pw}`],
    user: "app",
    database: "app",
    url: (h, pw) => `mysql://app:${pw}@${h}:3306/app`,
    healthcheck: () => ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"],
  },
  redis: {
    image: (v) => `redis:${v}-alpine`,
    dataDir: () => "/data",
    env: () => [],
    cmd: (pw) => ["redis-server", "--requirepass", pw, "--appendonly", "yes"],
    user: null,
    database: null,
    url: (h, pw) => `redis://:${pw}@${h}:6379`,
    healthcheck: (pw) => ["CMD", "redis-cli", "-a", pw, "--no-auth-warning", "ping"],
  },
  orthanc: {
    image: (v) => `orthancteam/orthanc:${v}`,
    // Dizin (SQLite) ve disk modunda görüntüler burada
    dataDir: () => "/var/lib/orthanc/db",
    env: (pw) => [
      "ORTHANC__NAME=panel-orthanc",
      "ORTHANC__AUTHENTICATION_ENABLED=true",
      `ORTHANC__REGISTERED_USERS=${JSON.stringify({ app: pw })}`,
      "ORTHANC__DICOM_WEB__ENABLE=true",
      "VERBOSE_ENABLED=false",
    ],
    user: "app",
    database: null,
    url: (h, pw) => `http://app:${pw}@${h}:8042`,
    // İmajda curl yok; python3 var
    healthcheck: (pw) => [
      "CMD",
      "python3",
      "-c",
      `import urllib.request,base64;urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8042/system",headers={"Authorization":"Basic "+base64.b64encode(b"app:${pw}").decode()}),timeout=4)`,
    ],
  },
  valkey: {
    image: (v) => `valkey/valkey:${v}-alpine`,
    dataDir: () => "/data",
    env: () => [],
    cmd: (pw) => ["valkey-server", "--requirepass", pw, "--appendonly", "yes"],
    user: null,
    database: null,
    url: (h, pw) => `redis://:${pw}@${h}:6379`,
    healthcheck: (pw) => ["CMD", "valkey-cli", "-a", pw, "--no-auth-warning", "ping"],
  },
  mongo: {
    image: (v) => `mongo:${v}`,
    dataDir: () => "/data/db",
    env: (pw) => ["MONGO_INITDB_ROOT_USERNAME=app", `MONGO_INITDB_ROOT_PASSWORD=${pw}`],
    user: "app",
    database: null,
    url: (h, pw) => `mongodb://app:${pw}@${h}:27017/?authSource=admin`,
    healthcheck: () => ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"],
  },
};

export function getDatabaseRow(id: number): DatabaseRow {
  const d = db.select().from(schema.databases).where(eq(schema.databases.id, id)).get();
  if (!d) throw new HttpError(404, "errors:database.notFound");
  return d;
}

export const passwordOf = (d: DatabaseRow) => decrypt(d.passwordEncrypted);
export const orthancOptionsOf = (d: DatabaseRow): OrthancOptions | null =>
  d.optionsEncrypted ? (JSON.parse(decrypt(d.optionsEncrypted)) as OrthancOptions) : null;

/** Orthanc S3 modu: görüntüler doğrudan S3 uyumlu depoya (resmi AWS S3 eklentisi) */
function orthancStorageEnv(d: DatabaseRow): string[] {
  const o = orthancOptionsOf(d);
  if (d.engine !== "orthanc" || o?.storage !== "s3") return [];
  return [
    `ORTHANC__AWS_S3_STORAGE__BUCKET_NAME=${o.bucket}`,
    `ORTHANC__AWS_S3_STORAGE__REGION=${o.region}`,
    `ORTHANC__AWS_S3_STORAGE__ACCESS_KEY=${o.accessKeyId}`,
    `ORTHANC__AWS_S3_STORAGE__SECRET_KEY=${o.secretAccessKey}`,
    `ORTHANC__AWS_S3_STORAGE__ENDPOINT=${o.endpoint}`,
    "ORTHANC__AWS_S3_STORAGE__VIRTUAL_ADDRESSING=false",
    ...(o.rootPath ? [`ORTHANC__AWS_S3_STORAGE__ROOT_PATH=${o.rootPath}`] : []),
  ];
}

/** Projeye bağlarken yazılacak değişkenler */
export function linkEnv(d: DatabaseRow, envKey: string): { key: string; value: string }[] {
  if (d.engine === "orthanc") {
    const base = envKey.replace(/_URL$/, "") || "ORTHANC";
    return [
      { key: `${base}_URL`, value: `http://${containerName(d.name)}:8042` },
      { key: `${base}_USERNAME`, value: "app" },
      { key: `${base}_PASSWORD`, value: passwordOf(d) },
    ];
  }
  return [{ key: envKey, value: connectionUrl(d) }];
}

export async function findContainer(d: Pick<DatabaseRow, "name">) {
  const list = await docker.listContainers({ all: true, filters: { label: [`${DB_LABEL}=${d.name}`] } });
  return list[0] ?? null;
}

export function connectionUrl(d: DatabaseRow) {
  return engines[d.engine].url(containerName(d.name), passwordOf(d));
}

async function toInfo(d: DatabaseRow): Promise<DatabaseInfo> {
  const c = await findContainer(d).catch(() => null);
  const spec = engines[d.engine];
  const pw = passwordOf(d);
  const last = db
    .select({ createdAt: schema.backups.createdAt, status: schema.backups.status })
    .from(schema.backups)
    .where(and(eq(schema.backups.kind, "database"), eq(schema.backups.targetName, d.name)))
    .orderBy(desc(schema.backups.id))
    .limit(1)
    .get();
  return {
    id: d.id,
    name: d.name,
    engine: d.engine,
    version: d.version,
    vector: d.vector,
    storage: (() => {
      if (d.engine !== "orthanc") return null;
      const o = orthancOptionsOf(d);
      return o?.storage === "s3" ? { mode: "s3" as const, endpoint: o.endpoint, bucket: o.bucket, rootPath: o.rootPath } : { mode: "local" as const };
    })(),
    memoryMb: d.memoryMb,
    createdAt: d.createdAt,
    container: c
      ? {
          id: c.Id,
          state: c.State as ContainerState,
          status: c.Status,
          ip: c.NetworkSettings?.Networks?.[config.docker.appsNetwork]?.IPAddress || null,
        }
      : null,
    host: containerName(d.name),
    port: dbEngineInfo[d.engine].port,
    username: spec.user,
    database: spec.database,
    password: pw,
    connectionUrl: spec.url(containerName(d.name), pw),
    lastBackup: last ?? null,
  };
}

export async function listDatabases() {
  const rows = db.select().from(schema.databases).orderBy(schema.databases.name).all();
  return Promise.all(rows.map(toInfo));
}

export const getDatabase = async (id: number) => toInfo(getDatabaseRow(id));

async function pullIfMissing(image: string) {
  if (await docker.getImage(image).inspect().catch(() => null)) return;
  const stream = await docker.pull(image);
  await new Promise<void>((res, rej) => docker.modem.followProgress(stream, (e) => (e ? rej(e) : res())));
}

async function ensureNetwork(name: string) {
  const nets = await docker.listNetworks({ filters: { name: [name] } });
  if (!nets.some((n) => n.Name === name)) await docker.createNetwork({ Name: name, Driver: "bridge" });
}

export async function createDatabase(input: CreateDatabaseInput) {
  if (db.select().from(schema.databases).where(eq(schema.databases.name, input.name)).get()) {
    throw new HttpError(409, "errors:database.nameTaken");
  }
  if (await docker.getContainer(containerName(input.name)).inspect().catch(() => null)) {
    throw new HttpError(409, "errors:database.containerTaken", { name: containerName(input.name) });
  }

  // URL içinde sorun çıkarmayan, yeterince uzun şifre
  const password = crypto.randomBytes(24).toString("hex");
  const spec = engines[input.engine];
  const image = spec.image(input.version, input.vector);

  await ensureNetwork(config.docker.appsNetwork);
  await pullIfMissing(image);

  const { orthanc, ...rest } = input;
  const row = db
    .insert(schema.databases)
    .values({
      ...rest,
      optionsEncrypted: input.engine === "orthanc" && orthanc ? encrypt(JSON.stringify(orthanc)) : null,
      passwordEncrypted: encrypt(password),
      createdAt: Date.now(),
    })
    .returning()
    .get();

  try {
    await startContainer(row, password);
    if (input.vector) void enableVector(row.id);
  } catch (err) {
    db.delete(schema.databases).where(eq(schema.databases.id, row.id)).run();
    await docker.getContainer(containerName(input.name)).remove({ force: true }).catch(() => {});
    throw err;
  }
  return row;
}

/** start: false → oluşturulur ama başlatılmaz (geri yüklemede veri önce yerleştirilir) */
export async function startContainer(d: DatabaseRow, password: string, start = true) {
  const spec = engines[d.engine];
  const c = await docker.createContainer({
    name: containerName(d.name),
    Image: spec.image(d.version, d.vector),
    Env: [...spec.env(password), ...orthancStorageEnv(d)],
    ...(spec.cmd ? { Cmd: spec.cmd(password) } : {}),
    Labels: { [MANAGED_LABEL]: "true", [DB_LABEL]: d.name, "panel.engine": d.engine },
    Healthcheck: { Test: spec.healthcheck(password), Interval: 10e9, Timeout: 5e9, Retries: 5, StartPeriod: 30e9 },
    HostConfig: {
      NetworkMode: config.docker.appsNetwork,
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`${volumeName(d.name)}:${spec.dataDir(d.version)}`],
      ...(d.memoryMb ? { Memory: d.memoryMb * 1024 * 1024 } : {}),
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
      SecurityOpt: ["no-new-privileges"],
    },
  });
  if (start) await c.start();
  return c;
}

export { containerName as databaseContainerName, volumeName as databaseVolumeName };

/** Container sağlıklı olana kadar bekler (en fazla timeoutMs) */
export async function waitDatabaseHealthy(d: Pick<DatabaseRow, "name">, timeoutMs = 180_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const info = await docker.getContainer(containerName(d.name)).inspect().catch(() => null);
    if (info?.State.Health?.Status === "healthy") return;
    if (info && !info.State.Running) throw new Error(pt("messages:database.notRunningStatus", { name: containerName(d.name), status: info.State.Status }));
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(pt("messages:database.notReady", { name: containerName(d.name), count: Math.round(timeoutMs / 1000) }));
}

/**
 * Felaket kurtarma: panel kaydı duran ama container'ı olmayan veritabanını AYNI isim, sürüm ve
 * şifreyle yeniden kurar (projelerdeki bağlantı adresleri değişmeden çalışsın). Veri boş başlar;
 * ardından yedekten geri yüklenir.
 */
export async function recreateDatabase(id: number) {
  const d = getDatabaseRow(id);
  if (await findContainer(d)) throw new HttpError(409, "errors:database.containerExists", { name: containerName(d.name) });
  await ensureNetwork(config.docker.appsNetwork);
  await pullIfMissing(engines[d.engine].image(d.version, d.vector));
  await startContainer(d, passwordOf(d));
  await waitDatabaseHealthy(d);
  if (d.vector) await enableVector(d.id);
  return d;
}

/** pgvector: veritabanı hazır olunca eklentiyi uygulamanın veritabanında etkinleştir */
async function enableVector(id: number) {
  const d = getDatabaseRow(id);
  for (let i = 0; i < 90; i++) {
    const info = await docker.getContainer(containerName(d.name)).inspect().catch(() => null);
    if (!info) return;
    if (info.State.Health?.Status === "healthy") {
      await execInContainer(info.Id, ["psql", "-U", "app", "-d", "app", "-c", "CREATE EXTENSION IF NOT EXISTS vector"], {
        env: [`PGPASSWORD=${passwordOf(d)}`],
        timeoutMs: 60_000,
      }).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function deleteDatabase(id: number, keepVolume: boolean) {
  const d = getDatabaseRow(id);
  const c = await findContainer(d);
  if (c) await docker.getContainer(c.Id).remove({ force: true });
  if (!keepVolume) await docker.getVolume(volumeName(d.name)).remove().catch(() => {});
  db.delete(schema.databases).where(eq(schema.databases.id, id)).run();
  return d;
}

export async function requireRunningContainer(d: DatabaseRow) {
  const c = await findContainer(d);
  if (!c || c.State !== "running") throw new HttpError(409, "errors:database.notRunning", { name: d.name });
  return c.Id;
}
