import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createProjectSchema,
  domainAccessUpdateSchema,
  domainTargetUpdateSchema,
  domainInputSchema,
  previewSettingsSchema,
  projectEnvGroupsSchema,
  projectHealthSchema,
  projectPinSchema,
  updateProjectSchema,
  type GithubSource,
  type PanelSettings,
} from "@panel/shared";
import { listRepos } from "../github/service.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { caddyStatus, syncCaddy } from "../caddy/service.js";
import { enqueueDeploy, rollbackTo } from "../deploy/runner.js";
import { setProjectGroups } from "../envgroups/service.js";
import { checkSoon } from "../health/service.js";
import { clearHealth } from "../health/state.js";
import { invalidateDnsCache, tailnetInfo } from "../tailnet/dns.js";
import * as svc from "./service.js";
import { errorText } from "../../lib/i18n.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const domainParams = idParams.extend({ domainId: z.coerce.number().int().positive() });

function params<T extends z.ZodType>(schema: T, req: FastifyRequest): z.infer<T> {
  const r = schema.safeParse(req.params);
  if (!r.success) throw new svc.HttpError(400, "errors:common.invalidId");
  return r.data;
}

/** Seçilen repo gerçekten App kurulumunda erişilebilir mi (yanlış/eski kimlikleri yakala) */
async function assertRepoAccessible(src: GithubSource) {
  const repos = await listRepos();
  const repo = repos.find((r) => r.id === src.repoId && r.installationId === src.installationId);
  if (!repo) throw new svc.HttpError(400, "errors:project.repoNoAccess", { repo: src.repoFullName });
  // Repo yeniden adlandırılmış olabilir: güncel adı kullan
  src.repoFullName = repo.fullName;
}

/** Domain değişikliklerinde Caddy'yi güncelle; hata olursa kullanıcıya uyarı olarak dön */
async function trySync(): Promise<string | null> {
  try {
    await syncCaddy();
    return null;
  } catch (err) {
    return errorText(err);
  }
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/settings", async (): Promise<PanelSettings> => ({
    baseDomain: config.baseDomain,
    panelDomain: config.panelDomain,
    panelAccess: config.panelAccess,
    webhookDomain: config.webhookDomain,
    https: config.caddy.https,
    caddy: caddyStatus(),
    tailnet: tailnetInfo(),
  }));

  app.post("/api/caddy/sync", async (req) => {
    await syncCaddy();
    audit("caddy.sync", req.ip);
    return { ok: true, caddy: caddyStatus() };
  });

  // ---- Projeler ----
  app.get("/api/projects", async () => svc.listProjects());

  app.post("/api/projects", async (req, reply) => {
    const body = parseBody(createProjectSchema, req.body, reply);
    if (!body) return;
    if (body.source.type === "github") await assertRepoAccessible(body.source);
    const p = svc.createProject(body);
    audit("project.create", req.ip, { name: p.name, source: body.source });
    const deploymentId = body.deploy ? enqueueDeploy(p.id, "create") : null;
    const warning = deploymentId ? null : await trySync();
    return reply.code(201).send({ id: p.id, deploymentId, warning });
  });

  app.get("/api/projects/:id", async (req) => svc.getProject(params(idParams, req).id));

  app.put("/api/projects/:id", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(updateProjectSchema, req.body, reply);
    if (!body) return;
    if (svc.getProjectRow(id).parentId) throw new svc.HttpError(400, "errors:project.previewSettingsInherited");
    if (body.source.type === "github") await assertRepoAccessible(body.source);
    svc.updateProject(id, body);
    audit("project.update", req.ip, { id, source: body.source, envKeys: body.env.map((e) => e.key) });
    return { ok: true };
  });

  app.delete("/api/projects/:id", async (req) => {
    const p = await svc.deleteProject(params(idParams, req).id);
    audit("project.delete", req.ip, { name: p.name });
    return { ok: true, warning: await trySync() };
  });

  app.post("/api/projects/:id/deploy", async (req) => {
    const { id } = params(idParams, req);
    const deploymentId = enqueueDeploy(id, "manual");
    audit("project.deploy", req.ip, { id, deploymentId });
    return { deploymentId };
  });

  // ---- Sabitleme (listelerde üstte) ----
  app.put("/api/projects/:id/pin", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(projectPinSchema, req.body, reply);
    if (!body) return;
    svc.setPinned(id, body.pinned);
    audit("project.pin", req.ip, { id, pinned: body.pinned });
    return { ok: true };
  });

  // ---- Ortak değişken grupları ----
  app.put("/api/projects/:id/env-groups", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(projectEnvGroupsSchema, req.body, reply);
    if (!body) return;
    svc.getProjectRow(id);
    setProjectGroups(id, body.groupIds);
    audit("project.env_groups", req.ip, { id, groupIds: body.groupIds });
    return { ok: true };
  });

  // ---- Sağlık kontrolü ----
  app.put("/api/projects/:id/health", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(projectHealthSchema, req.body, reply);
    if (!body) return;
    svc.setHealthCheck(id, body.healthCheck);
    clearHealth(id);
    checkSoon(id);
    audit("project.health", req.ip, { id, ...body });
    return { ok: true };
  });

  // ---- PR önizlemeleri ----
  app.get("/api/projects/:id/previews", async (req) => svc.listProjects({ parentId: params(idParams, req).id }));

  app.put("/api/projects/:id/previews", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(previewSettingsSchema, req.body, reply);
    if (!body) return;
    const p = svc.getProjectRow(id);
    if (p.parentId) throw new svc.HttpError(400, "errors:project.previewOfPreview");
    if (body.enabled && (p.sourceType !== "github" || p.github?.compose)) {
      throw new svc.HttpError(400, "errors:project.previewUnsupported");
    }
    svc.setPreviewSettings(id, body);
    invalidateDnsCache();
    audit("project.previews", req.ip, { id, enabled: body.enabled, access: body.access, envKeys: body.env.map((e) => e.key) });
    return { ok: true, warning: await trySync() };
  });

  // ---- Domainler ----
  app.post("/api/projects/:id/domains", async (req, reply) => {
    const { id } = params(idParams, req);
    const body = parseBody(domainInputSchema, req.body, reply);
    if (!body) return;
    svc.addDomain(id, body);
    invalidateDnsCache();
    audit("domain.add", req.ip, { projectId: id, hostname: body.hostname, redirectWww: body.redirectWww });
    return { ok: true, warning: await trySync() };
  });

  app.put("/api/projects/:id/domains/:domainId/access", async (req, reply) => {
    const { id, domainId } = params(domainParams, req);
    const body = parseBody(domainAccessUpdateSchema, req.body, reply);
    if (!body) return;
    svc.setDomainAccess(id, domainId, body.access);
    invalidateDnsCache();
    audit("domain.access", req.ip, { projectId: id, domainId, access: body.access });
    return { ok: true, warning: await trySync() };
  });

  app.put("/api/projects/:id/domains/:domainId/target", async (req, reply) => {
    const { id, domainId } = params(domainParams, req);
    const body = parseBody(domainTargetUpdateSchema, req.body, reply);
    if (!body) return;
    svc.setDomainTarget(id, domainId, body.target);
    audit("domain.target", req.ip, { projectId: id, domainId, target: body.target });
    return { ok: true, warning: await trySync() };
  });

  app.delete("/api/projects/:id/domains/:domainId", async (req) => {
    const { id, domainId } = params(domainParams, req);
    svc.removeDomain(id, domainId);
    audit("domain.remove", req.ip, { projectId: id, domainId });
    return { ok: true, warning: await trySync() };
  });

  // ---- Deploylar ----
  app.get("/api/projects/:id/deployments", async (req) =>
    svc.listDeployments({ projectId: params(idParams, req).id, limit: 30 }),
  );
  app.get("/api/deployments", async () => svc.listDeployments({ limit: 100 }));
  app.get("/api/deployments/:id", async (req) => svc.getDeployment(params(idParams, req).id));

  app.post("/api/deployments/:id/rollback", async (req) => {
    const { id } = params(idParams, req);
    const deploymentId = rollbackTo(id);
    audit("project.rollback", req.ip, { fromDeployment: id, deploymentId });
    return { deploymentId };
  });
}
