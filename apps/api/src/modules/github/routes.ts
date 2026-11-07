import type { FastifyInstance } from "fastify";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.js";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { enqueueDeploy } from "../deploy/runner.js";
import { handlePullRequest, type PullRequestPayload } from "../previews/service.js";
import * as gh from "./service.js";
import { rt } from "../../lib/i18n.js";

const manifestBody = z.object({ origin: z.string().url() });
const branchesQuery = z.object({
  installationId: z.coerce.number().int().positive(),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
});

export async function githubRoutes(app: FastifyInstance) {
  app.get("/api/github/status", async () => gh.githubStatus());

  app.get("/api/github/repos", async () => gh.listRepos());

  app.get("/api/github/branches", async (req, reply) => {
    const q = branchesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: rt(req, "errors:invalidRequest") });
    return gh.listBranches(q.data.installationId, q.data.repo);
  });

  // 1) Panel manifest üretir, tarayıcı bunu GitHub'a form ile gönderir
  app.post("/api/github/manifest", async (req, reply) => {
    const body = parseBody(manifestBody, req.body, reply);
    if (!body) return;
    return gh.startManifest(body.origin);
  });

  // 2) GitHub buraya geri yönlendirir. Çapraz site yönlendirmesi olduğu için oturum
  //    cookie'si (SameSite=Strict) gelmez; isteği tek kullanımlık `state` doğrular.
  app.get("/api/github/manifest/callback", async (req, reply) => {
    const q = z.object({ code: z.string().min(1).max(200), state: z.string().regex(/^[a-f0-9]{32}$/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: rt(req, "errors:invalidRequest") });
    try {
      const { app: created, origin } = await gh.completeManifest(q.data.code, q.data.state);
      audit("github.app_created", req.ip, { appId: created.id, slug: created.slug });
      // Sonraki adım: App'i kurup repo seçmek
      return reply.redirect(`${origin}/settings?github=created`);
    } catch (err) {
      return reply.code(400).type("text/html; charset=utf-8").send(
        `<p>${rt(req, "errors:github.appCreateFailed", { error: rt(req, String((err as Error).message), (err as { params?: Record<string, unknown> }).params) }).replace(/[<>&]/g, "")}</p><p><a href="/settings">${rt(req, "errors:github.backToPanel").replace(/[<>&]/g, "")}</a></p>`,
      );
    }
  });

  app.delete("/api/github/app", async (req) => {
    const existing = gh.getApp();
    gh.removeApp();
    audit("github.app_removed", req.ip, { slug: existing?.slug });
    return { ok: true, htmlUrl: existing?.htmlUrl ?? null };
  });

  // Webhook ham gövdeye ihtiyaç duyar (imza doğrulaması); ayrı kapsamda kendi parser'ı var
  await app.register(webhookRoute);
}

export interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { id: number; full_name: string };
  head_commit?: { message?: string } | null;
  forced?: boolean;
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
}

/**
 * Push'ta değişen dosyalar. Bilinemiyorsa null (zorla push, commit listesi yok/kesik): güvenli
 * tarafta kalıp deploy edilir. GitHub push bildiriminde en fazla 2048 commit listelenir.
 */
export function changedFiles(p: PushPayload): string[] | null {
  if (p.forced || !p.commits?.length || p.commits.length >= 2048) return null;
  const out = new Set<string>();
  for (const c of p.commits) for (const f of [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]) out.add(f);
  return [...out];
}

/** İzlenen klasörlerden birine dokunuyor mu (klasör: önek, dosya: tam eşleşme) */
export const touches = (files: string[], watch: string[]) => files.some((f) => watch.some((w) => f === w || f.startsWith(`${w}/`)));

// İşlenmiş bildirim kimlikleri (son 48 saat). Panel yeniden başlarsa DB'deki kayıtlardan yüklenir.
const seenDeliveries = new Map<string, number>();
const DELIVERY_TTL_MS = 48 * 3600_000;
function rememberDelivery(id: string) {
  const now = Date.now();
  seenDeliveries.set(id, now);
  db.insert(schema.auditLog).values({ action: "github.delivery", details: id, ip: null, createdAt: now }).run();
  if (seenDeliveries.size > 10_000) {
    for (const [k, t] of seenDeliveries) if (now - t > DELIVERY_TTL_MS) seenDeliveries.delete(k);
  }
}
function loadDeliveries() {
  const since = Date.now() - DELIVERY_TTL_MS;
  for (const r of db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "github.delivery"), gt(schema.auditLog.createdAt, since))).all()) {
    if (r.details) seenDeliveries.set(r.details, r.createdAt);
  }
  // Eski kimlik kayıtlarını temizle
  db.delete(schema.auditLog).where(and(eq(schema.auditLog.action, "github.delivery"), lt(schema.auditLog.createdAt, since))).run();
}

async function webhookRoute(app: FastifyInstance) {
  loadDeliveries();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  // İnternete açık tek panel yolu: IP başına dakikada en fazla 60 istek
  app.post("/api/github/webhook", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const raw = typeof req.body === "string" ? req.body : "";
    if (!gh.verifyWebhookSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      return reply.code(401).send({ error: rt(req, "errors:github.badSignature") });
    }
    // Tekrar gönderme (replay) engeli: GitHub her bildirime tekil bir kimlik verir; aynı
    // kimlikle gelen ikinci istek (ele geçirilip yeniden gönderilmiş olsa bile) işlenmez.
    const delivery = String(req.headers["x-github-delivery"] ?? "");
    if (!/^[0-9a-f-]{20,64}$/i.test(delivery)) return reply.code(400).send({ error: rt(req, "errors:invalidRequest") });
    if (seenDeliveries.has(delivery)) return { duplicate: true };
    rememberDelivery(delivery);

    const event = req.headers["x-github-event"];
    if (event === "ping") return { ok: true };
    if (event === "pull_request") {
      const payload = JSON.parse(raw) as PullRequestPayload;
      const result = await handlePullRequest(payload);
      if ("deployments" in result || "removed" in result) {
        audit("github.pull_request", req.ip, { repo: payload.repository?.full_name, pr: payload.number, action: payload.action, ...result });
      }
      return reply.code(202).send(result);
    }
    if (event !== "push") return { ignored: event };

    const p = JSON.parse(raw) as PushPayload;
    if (!p.ref?.startsWith("refs/heads/") || p.deleted || !p.repository) return { ignored: "ref" };
    const branch = p.ref.slice("refs/heads/".length);

    const projects = db.select().from(schema.projects).all();
    const candidates = projects.filter(
      (x) => !x.parentId && x.sourceType === "github" && x.github?.repoId === p.repository!.id && x.github.branch === branch && x.github.autoDeploy,
    );
    // Monorepo: izlenen klasörlerine dokunmayan push'ta o proje deploy edilmez
    const files = changedFiles(p);
    const skipped = candidates.filter((x) => files && x.github!.watchPaths?.length && !touches(files, x.github!.watchPaths));
    const targets = candidates.filter((x) => !skipped.includes(x));
    if (skipped.length) {
      audit("github.push_skipped", req.ip, {
        repo: p.repository.full_name,
        branch,
        commit: p.after?.slice(0, 7),
        projects: skipped.map((t) => t.name),
        reason: "changes outside watched paths",
      });
    }
    const deployments = targets.map((t) =>
      enqueueDeploy(t.id, "webhook", { commitSha: p.after ?? null, commitMessage: p.head_commit?.message ?? null }),
    );
    if (targets.length) {
      audit("github.push_deploy", req.ip, { repo: p.repository.full_name, branch, projects: targets.map((t) => t.name) });
    }
    return reply.code(202).send({ deployments, skipped: skipped.map((t) => t.name) });
  });
}
