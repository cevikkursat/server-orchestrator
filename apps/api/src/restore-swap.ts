import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Panel yedeğinden geri dönüşün ikinci yarısı: index.ts'de diğer her şeyden (veritabanı ve şifreleme
 * anahtarı yüklenmeden) önce çalışır. data/restore-pending/ varsa panel.db ve secret.key'i yerine koyar;
 * mevcut olanlar data/before-restore-<zaman>/ altına taşınır (gerekirse elle geri dönülebilsin).
 */
const pending = path.join(config.dataDir, "restore-pending");
if (fs.existsSync(path.join(pending, "panel.db")) && fs.existsSync(path.join(pending, "secret.key"))) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const keep = path.join(config.dataDir, `before-restore-${stamp}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const f of ["panel.db", "panel.db-wal", "panel.db-shm", "secret.key"]) {
    const src = path.join(config.dataDir, f);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(keep, f));
  }
  fs.renameSync(path.join(pending, "panel.db"), path.join(config.dataDir, "panel.db"));
  fs.renameSync(path.join(pending, "secret.key"), path.join(config.dataDir, "secret.key"));
  fs.chmodSync(path.join(config.dataDir, "secret.key"), 0o600);
  fs.rmSync(pending, { recursive: true, force: true });
  console.log(`[panel] Panel backup restored. Previous files: ${keep}`);
}
