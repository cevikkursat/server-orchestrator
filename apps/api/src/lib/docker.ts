import os from "node:os";
import Docker from "dockerode";
import { pt } from "./i18n.js";

// Linux'ta /var/run/docker.sock, Windows'ta //./pipe/docker_engine otomatik seçilir.
export const docker = new Docker();

/** Container içinde çalışıyorsak hostname = kendi container id'mizin kısa hali */
const selfHostname = os.hostname();

export function isSelfContainer(id: string) {
  return id.startsWith(selfHostname) && /^[a-f0-9]{12}$/.test(selfHostname);
}

const SYSTEM_NAMES = new Set(["panel", "caddy"]);
export const isSystemContainer = (name: string) => SYSTEM_NAMES.has(name);

/** Docker'a ulaşılamadığında anlaşılır bir hata */
export class DockerUnavailableError extends Error {
  statusCode = 503;
  constructor() {
    super(pt("errors:docker.unavailable"));
  }
}

export function isConnError(err: unknown) {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "EACCES" || code === "EPIPE";
}

/** dockerode hata kodunu HTTP hatasına çevirir */
export function toHttpError(err: unknown): Error & { statusCode: number } {
  if (isConnError(err)) return new DockerUnavailableError();
  const e = err as { statusCode?: number; json?: { message?: string }; message?: string };
  const out = new Error(e.json?.message ?? e.message ?? pt("errors:docker.generic")) as Error & { statusCode: number };
  out.statusCode = e.statusCode === 404 ? 404 : e.statusCode === 304 ? 409 : (e.statusCode ?? 500);
  return out;
}
