import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Hassas verileri (ortam değişkenleri, ileride token'lar) şifrelemek için anahtar.
 * Öncelik: PANEL_SECRET (base64, 32 bayt) > data/secret.key > yeni üret.
 * DİKKAT: Bu dosya kaybolursa şifreli veriler çözülemez; yedeklerde mutlaka olmalı.
 */
function loadKey(): Buffer {
  if (process.env.PANEL_SECRET) {
    const k = Buffer.from(process.env.PANEL_SECRET, "base64");
    if (k.length !== 32) throw new Error("PANEL_SECRET must be 32 bytes, base64-encoded");
    return k;
  }
  const file = path.join(config.dataDir, "secret.key");
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  fs.mkdirSync(config.dataDir, { recursive: true });
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k.toString("base64"), { mode: 0o600 });
  return k;
}

const key = loadKey();

/** AES-256-GCM. Çıktı: v1:iv:tag:şifreli (base64) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unknown encryption format");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
