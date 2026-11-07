import type { HealthResult } from "@panel/shared";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { docker } from "../../lib/docker.js";
import { notify } from "../notify/service.js";
import { healthEntry, pushResult } from "./state.js";
import { pt } from "../../lib/i18n.js";

/**
 * Uygulama sağlık kontrolü: projenin yayındaki container'ına iç ağdan HTTP isteği atılır
 * (http://<container>:<port><yol>). 2xx/3xx = sağlıklı. Arka arkaya N başarısızlıkta
 * "yanıt vermiyor" bildirimi gider, istenirse container yeniden başlatılır (çökme
 * dönemi başına bir kez). Düzelince "tekrar yanıt veriyor" bildirimi gider.
 */

const TICK_MS = 5000;
const lastRun = new Map<number, number>();
const running = new Set<number>();

/** Tek bir HTTP kontrolü. Yönlendirme takip edilmez (3xx da sağlıklı sayılır). */
export async function probeHttp(host: string, port: number, path: string, timeoutMs: number): Promise<HealthResult> {
  const started = Date.now();
  try {
    const res = await fetch(`http://${host}:${port}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "sunucu-paneli-healthcheck" },
    });
    await res.body?.cancel().catch(() => {});
    const ok = res.status < 400;
    return { at: started, ok, status: res.status, latencyMs: Date.now() - started, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const msg =
      e.name === "TimeoutError"
        ? pt("messages:health.timeout", { count: timeoutMs / 1000 })
        : e.cause?.code === "ECONNREFUSED"
          ? pt("messages:health.refused")
          : e.cause?.code === "ENOTFOUND" || e.cause?.code === "EAI_AGAIN"
            ? pt("messages:health.containerMissing")
            : (e.cause?.code ?? e.message);
    return { at: started, ok: false, status: null, latencyMs: null, error: msg };
  }
}

async function check(p: typeof schema.projects.$inferSelect) {
  const hc = p.healthCheck!;
  const s = healthEntry(p.id, p.currentContainer);
  const label = p.parentId ? pt("notify:health.previewLabel", { name: p.name }) : p.name;

  const r = config.docker.panelInDocker
    ? await probeHttp(p.currentContainer!, p.port, hc.path, hc.timeoutSec * 1000)
    : { at: Date.now(), ok: false, status: null, latencyMs: null, error: pt("messages:health.devUnreachable") };
  // Kontrol sürerken deploy yeni container'a geçtiyse bu sonucu yok say
  if (s !== healthEntry(p.id, p.currentContainer)) return;
  pushResult(s, r);
  if (!config.docker.panelInDocker) return;

  if (r.ok) {
    s.failures = 0;
    if (s.state !== "up") {
      const wasDown = s.state === "down";
      Object.assign(s, { state: "up", since: Date.now(), restarted: false });
      if (wasDown) notify("healthCheck", pt("notify:health.upTitle", { label }), `${hc.path} → HTTP ${r.status} (${r.latencyMs} ms)`, "info");
    }
    return;
  }

  s.failures++;
  if (s.failures < hc.failureThreshold || s.state === "down") return;
  Object.assign(s, { state: "down", since: Date.now() });
  let extra = "";
  if (hc.autoRestart && !s.restarted) {
    s.restarted = true;
    try {
      await docker.getContainer(p.currentContainer!).restart({ t: 10 });
      extra = "\n" + pt("notify:health.restarted");
    } catch (err) {
      extra = "\n" + pt("notify:health.restartFailed", { error: (err as Error).message });
    }
  }
  notify(
    "healthCheck",
    pt("notify:health.downTitle", { label }),
    pt("notify:health.downBody", { count: hc.failureThreshold, path: hc.path, error: r.error }) + extra,
    "error",
  );
}

function tick() {
  const now = Date.now();
  const projects = db.select().from(schema.projects).all();
  for (const p of projects) {
    const hc = p.healthCheck;
    if (!hc?.enabled || !p.currentContainer || running.has(p.id)) continue;
    if (now - (lastRun.get(p.id) ?? 0) < hc.intervalSec * 1000) continue;
    lastRun.set(p.id, now);
    running.add(p.id);
    void check(p)
      .catch(() => {})
      .finally(() => running.delete(p.id));
  }
}

/** Ayar değişince hemen kontrol edilsin */
export function checkSoon(projectId: number) {
  lastRun.delete(projectId);
}

export function startHealthChecks() {
  setInterval(tick, TICK_MS).unref();
}
