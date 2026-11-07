import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { decrypt, encrypt } from "./crypto.js";

/** Şifreli anahtar-değer ayarları (GitHub App anahtarları vb.) */
export function getSecret<T>(key: string): T | null {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? (JSON.parse(decrypt(row.value)) as T) : null;
}

export function setSecret(key: string, value: unknown) {
  const v = encrypt(JSON.stringify(value));
  db.insert(schema.settings)
    .values({ key, value: v, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: Date.now() } })
    .run();
}

export function deleteSetting(key: string) {
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
}
