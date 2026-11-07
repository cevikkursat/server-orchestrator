import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";
import type { DomainAccess, DomainTarget, GithubSource, HealthCheckSettings, ProjectVolume } from "@panel/shared";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret").notNull(),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  /** Son kabul edilen 2FA kodunun zaman adımı; aynı kod tekrar kullanılamaz */
  totpLastStep: integer("totp_last_step").notNull().default(0),
  /** Arayüz ve bildirim dili (tr, en …); null: tarayıcı dili */
  language: text("language"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  // Token'ın kendisi değil SHA-256 hash'i saklanır
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  lastSeenAt: integer("last_seen_at"),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sourceType: text("source_type", { enum: ["image", "github"] }).notNull().default("image"),
  /** image kaynağında image adı; github kaynağında boş */
  image: text("image").notNull(),
  /** github kaynağının ayarları (JSON: GithubSource) */
  github: text("github", { mode: "json" }).$type<GithubSource>(),
  startCommand: text("start_command"),
  port: integer("port").notNull(),
  envEncrypted: text("env_encrypted"),
  memoryMb: integer("memory_mb"),
  cpus: real("cpus"),
  /** Şu an trafiği alan container'ın adı (Caddy upstream'i) */
  currentContainer: text("current_container"),
  /** PR önizlemesiyse ana proje (silinince önizleme de silinir) */
  parentId: integer("parent_id"),
  prNumber: integer("pr_number"),
  prTitle: text("pr_title"),
  healthCheck: text("health_check", { mode: "json" }).$type<HealthCheckSettings>(),
  /** PreviewSettings (env alanı şifreli) */
  previewSettings: text("preview_settings"),
  /** Kalıcı klasörler */
  volumes: text("volumes", { mode: "json" }).$type<ProjectVolume[]>(),
  /** Deploy öncesi bağlı veritabanlarını yedekle */
  preDeployBackup: integer("pre_deploy_backup", { mode: "boolean" }).notNull().default(true),
  /** Listelerde en üstte durur */
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const domains = sqliteTable("domains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  hostname: text("hostname").notNull().unique(),
  kind: text("kind", { enum: ["route", "redirect"] }).notNull().default("route"),
  /** null: herkese açık */
  access: text("access", { mode: "json" }).$type<DomainAccess>(),
  /** null: projenin portuna */
  target: text("target", { mode: "json" }).$type<DomainTarget>(),
  createdAt: integer("created_at").notNull(),
});

export const envGroups = sqliteTable("env_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  envEncrypted: text("env_encrypted"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projectEnvGroups = sqliteTable("project_env_groups", {
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  groupId: integer("group_id")
    .notNull()
    .references(() => envGroups.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
});

export const deployments = sqliteTable("deployments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "running", "success", "failed"] }).notNull(),
  trigger: text("trigger", { enum: ["create", "manual", "update", "webhook", "rollback", "preview"] }).notNull(),
  image: text("image").notNull(),
  commitSha: text("commit_sha"),
  commitMessage: text("commit_message"),
  containerName: text("container_name"),
  log: text("log").notNull().default(""),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

export const databases = sqliteTable("databases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  engine: text("engine", { enum: ["postgres", "mysql", "mariadb", "mongo", "redis", "valkey", "orthanc"] }).notNull(),
  version: text("version").notNull(),
  vector: integer("vector", { mode: "boolean" }).notNull().default(false),
  /** Türe özel ayarlar (Orthanc S3 bilgileri vb.), şifreli JSON */
  optionsEncrypted: text("options_encrypted"),
  passwordEncrypted: text("password_encrypted").notNull(),
  memoryMb: integer("memory_mb"),
  createdAt: integer("created_at").notNull(),
});

export const backups = sqliteTable("backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["database", "panel", "volume"] }).notNull(),
  targetName: text("target_name").notNull(),
  engine: text("engine", { enum: ["postgres", "mysql", "mariadb", "mongo", "redis", "valkey", "orthanc"] }),
  fileName: text("file_name"),
  sizeBytes: integer("size_bytes"),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  error: text("error"),
  trigger: text("trigger", { enum: ["manual", "schedule", "predeploy"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  finishedAt: integer("finished_at"),
  /** Sunucu dışı kopya durumu */
  remoteStatus: text("remote_status", { enum: ["pending", "uploading", "uploaded", "failed"] }),
  remoteKey: text("remote_key"),
  remoteError: text("remote_error"),
  remoteAt: integer("remote_at"),
});

export const cronJobs = sqliteTable("cron_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  command: text("command").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at"),
  lastStatus: text("last_status", { enum: ["running", "success", "failed"] }),
  lastOutput: text("last_output"),
  lastDurationMs: integer("last_duration_ms"),
  createdAt: integer("created_at").notNull(),
});

export const metrics = sqliteTable("metrics", {
  ts: integer("ts").primaryKey(),
  cpu: real("cpu").notNull(),
  memUsed: integer("mem_used").notNull(),
  memTotal: integer("mem_total").notNull(),
  diskUsed: integer("disk_used"),
  diskTotal: integer("disk_total"),
  netRx: real("net_rx"),
  netTx: real("net_tx"),
  load1: real("load1").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  details: text("details"),
  ip: text("ip"),
  createdAt: integer("created_at").notNull(),
});
