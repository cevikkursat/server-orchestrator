import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../config.js";
import * as schema from "./schema.js";

fs.mkdirSync(config.dataDir, { recursive: true });

const sqlite = new Database(path.join(config.dataDir, "panel.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Basit sürüm tabanlı migration: her eleman bir kez ve sırayla çalışır.
// Yeni tablo/kolon için listenin sonuna yeni bir eleman ekle, eskileri değiştirme.
const migrations: string[] = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     totp_secret TEXT NOT NULL,
     totp_enabled INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     ip TEXT,
     user_agent TEXT
   );
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     action TEXT NOT NULL,
     details TEXT,
     ip TEXT,
     created_at INTEGER NOT NULL
   );`,
  // v2: projeler, domainler, deploylar
  `CREATE TABLE projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     image TEXT NOT NULL,
     port INTEGER NOT NULL,
     env_encrypted TEXT,
     memory_mb INTEGER,
     cpus REAL,
     current_container TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE domains (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     hostname TEXT NOT NULL UNIQUE,
     kind TEXT NOT NULL DEFAULT 'route',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE deployments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     trigger TEXT NOT NULL,
     image TEXT NOT NULL,
     container_name TEXT,
     log TEXT NOT NULL DEFAULT '',
     error TEXT,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     finished_at INTEGER
   );
   CREATE INDEX deployments_project ON deployments(project_id, id DESC);`,
  // v3: GitHub kaynakları, commit bilgisi, anahtar-değer ayarlar
  `ALTER TABLE projects ADD COLUMN source_type TEXT NOT NULL DEFAULT 'image';
   ALTER TABLE projects ADD COLUMN github TEXT;
   ALTER TABLE projects ADD COLUMN start_command TEXT;
   ALTER TABLE deployments ADD COLUMN commit_sha TEXT;
   ALTER TABLE deployments ADD COLUMN commit_message TEXT;
   CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // v4: veritabanı servisleri, yedekler, zamanlanmış görevler
  `CREATE TABLE databases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     engine TEXT NOT NULL,
     version TEXT NOT NULL,
     password_encrypted TEXT NOT NULL,
     memory_mb INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE backups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     target_name TEXT NOT NULL,
     engine TEXT,
     file_name TEXT,
     size_bytes INTEGER,
     status TEXT NOT NULL,
     error TEXT,
     trigger TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     finished_at INTEGER
   );
   CREATE INDEX backups_target ON backups(kind, target_name, id DESC);
   CREATE TABLE cron_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     schedule TEXT NOT NULL,
     command TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     last_run_at INTEGER,
     last_status TEXT,
     last_output TEXT,
     last_duration_ms INTEGER,
     created_at INTEGER NOT NULL
   );`,
  // v5: sunucu metrik geçmişi (15 sn'de bir, 7 gün)
  `CREATE TABLE metrics (
     ts INTEGER PRIMARY KEY,
     cpu REAL NOT NULL,
     mem_used INTEGER NOT NULL,
     mem_total INTEGER NOT NULL,
     disk_used INTEGER,
     disk_total INTEGER,
     net_rx REAL,
     net_tx REAL,
     load1 REAL NOT NULL
   );`,
  // v6: 2FA kodu tekrar kullanımı engeli, oturum hareketsizlik süresi
  `ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
   CREATE INDEX audit_action_time ON audit_log(action, created_at);`,
  // v7: domain erişim kısıtı, PR önizlemeleri, sağlık kontrolü, ortak değişken grupları
  `ALTER TABLE domains ADD COLUMN access TEXT;
   ALTER TABLE projects ADD COLUMN parent_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
   ALTER TABLE projects ADD COLUMN pr_number INTEGER;
   ALTER TABLE projects ADD COLUMN pr_title TEXT;
   ALTER TABLE projects ADD COLUMN health_check TEXT;
   ALTER TABLE projects ADD COLUMN preview_settings TEXT;
   CREATE UNIQUE INDEX projects_preview ON projects(parent_id, pr_number) WHERE parent_id IS NOT NULL;
   CREATE TABLE env_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     env_encrypted TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE project_env_groups (
     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     group_id INTEGER NOT NULL REFERENCES env_groups(id) ON DELETE CASCADE,
     position INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (project_id, group_id)
   );`,
  // v8: projelerin kalıcı klasörleri
  `ALTER TABLE projects ADD COLUMN volumes TEXT;`,
  // v9: deploy öncesi veritabanı yedeği (varsayılan açık)
  `ALTER TABLE projects ADD COLUMN pre_deploy_backup INTEGER NOT NULL DEFAULT 1;`,
  // v10: pgvector'lü PostgreSQL
  `ALTER TABLE databases ADD COLUMN vector INTEGER NOT NULL DEFAULT 0;`,
  // v11: sunucu dışı yedek kopyası
  `ALTER TABLE backups ADD COLUMN remote_status TEXT;
   ALTER TABLE backups ADD COLUMN remote_key TEXT;
   ALTER TABLE backups ADD COLUMN remote_error TEXT;
   ALTER TABLE backups ADD COLUMN remote_at INTEGER;`,
  // v12: veritabanı/servis türüne özel ayarlar (Orthanc S3 vb.)
  `ALTER TABLE databases ADD COLUMN options_encrypted TEXT;`,
  // v13: domain hedefi (port, yol önekine göre başka proje)
  `ALTER TABLE domains ADD COLUMN target TEXT;`,
  // v14: listelerde üstte duran (sabitlenmiş) projeler
  `ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  // v15: kullanıcının dili. Dil desteğinden önceki kurulumlar Türkçeydi.
  `ALTER TABLE users ADD COLUMN language TEXT;
   UPDATE users SET language = 'tr';`,
];

function migrate() {
  const current = sqlite.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    sqlite.transaction(() => {
      sqlite.exec(migrations[v]!);
      sqlite.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

export const db = drizzle(sqlite, { schema });
/** Ham bağlantı (canlı yedekleme için) */
export { sqlite, schema };
