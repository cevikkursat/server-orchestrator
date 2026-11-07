import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { envGroupSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { HttpError } from "../../lib/errors.js";
import { parseBody } from "../../lib/validate.js";
import { enqueueDeploy } from "../deploy/runner.js";
import * as svc from "./service.js";

const id = (req: FastifyRequest) => {
  const r = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!r.success) throw new HttpError(400, "errors:common.invalidId");
  return r.data.id;
};

export async function envGroupRoutes(app: FastifyInstance) {
  app.get("/api/env-groups", async () => svc.listGroups());

  app.post("/api/env-groups", async (req, reply) => {
    const body = parseBody(envGroupSchema, req.body, reply);
    if (!body) return;
    const g = svc.createGroup(body);
    audit("envgroup.create", req.ip, { name: g.name, keys: body.env.map((e) => e.key) });
    return reply.code(201).send({ id: g.id });
  });

  app.put("/api/env-groups/:id", async (req, reply) => {
    const body = parseBody(envGroupSchema, req.body, reply);
    if (!body) return;
    const projects = svc.updateGroup(id(req), body);
    audit("envgroup.update", req.ip, { id: id(req), name: body.name, keys: body.env.map((e) => e.key) });
    return { ok: true, projects };
  });

  app.delete("/api/env-groups/:id", async (req) => {
    const r = svc.deleteGroup(id(req));
    audit("envgroup.delete", req.ip, { id: id(req), name: r.name });
    return { ok: true, projects: r.projects };
  });

  // Gruptaki değişiklik ancak yeniden deploy ile container'lara geçer
  app.post("/api/env-groups/:id/redeploy", async (req) => {
    const projects = svc.linkedProjectIds(id(req));
    const deployments = projects.map((p) => enqueueDeploy(p, "update"));
    audit("envgroup.redeploy", req.ip, { id: id(req), projects });
    return { deployments };
  });
}
