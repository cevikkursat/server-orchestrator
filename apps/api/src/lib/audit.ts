import { db, schema } from "../db/index.js";

export function audit(action: string, ip: string | null, details?: Record<string, unknown>) {
  db.insert(schema.auditLog)
    .values({ action, ip, details: details ? JSON.stringify(details) : null, createdAt: Date.now() })
    .run();
}
