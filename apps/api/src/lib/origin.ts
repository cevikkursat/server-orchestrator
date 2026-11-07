import type { FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * WebSocket'ler için: tarayıcı başka bir siteden bağlanmaya çalışıyorsa reddet
 * (Cross-Site WebSocket Hijacking). SameSite=Strict cookie'ye ek savunma.
 */
export function isAllowedOrigin(req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin) return true; // tarayıcı dışı istemciler (curl vb.)
  try {
    const host = new URL(origin).host;
    if (host === req.headers.host) return true;
    if (config.panelDomain && host === config.panelDomain) return true;
    if (!config.isProd && /^localhost(:\d+)?$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}
