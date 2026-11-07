import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { cronJobSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { HttpError } from "../projects/service.js";
import * as svc from "./service.js";

const params = (req: FastifyRequest) => {
  const r = z
    .object({ id: z.coerce.number().int().positive(), jobId: z.coerce.number().int().positive().optional() })
    .safeParse(req.params);
  if (!r.success) throw new HttpError(400, "errors:common.invalidId");
  return r.data;
};

export async function cronRoutes(app: FastifyInstance) {
  app.get("/api/projects/:id/cron", async (req) => svc.listJobs(params(req).id));

  // Arayüzde ifadeyi yazarken bir sonraki çalışma zamanını göster
  app.get("/api/cron/preview", async (req) => {
    const q = z.object({ schedule: z.string().max(100) }).parse(req.query);
    return { nextRunAt: svc.validateSchedule(q.schedule).getTime() };
  });

  app.post("/api/projects/:id/cron", async (req, reply) => {
    const body = parseBody(cronJobSchema, req.body, reply);
    if (!body) return;
    const job = svc.createJob(params(req).id, body);
    audit("cron.create", req.ip, { projectId: job.projectId, name: job.name, schedule: job.schedule });
    return reply.code(201).send(job);
  });

  app.put("/api/projects/:id/cron/:jobId", async (req, reply) => {
    const { id, jobId } = params(req);
    const body = parseBody(cronJobSchema, req.body, reply);
    if (!body) return;
    const job = svc.updateJob(id, jobId!, body);
    audit("cron.update", req.ip, { projectId: id, jobId, schedule: job.schedule, enabled: job.enabled });
    return job;
  });

  app.delete("/api/projects/:id/cron/:jobId", async (req) => {
    const { id, jobId } = params(req);
    svc.deleteJob(id, jobId!);
    audit("cron.delete", req.ip, { projectId: id, jobId });
    return { ok: true };
  });

  app.post("/api/projects/:id/cron/:jobId/run", async (req) => {
    const { id, jobId } = params(req);
    const jobs = svc.listJobs(id);
    if (!jobs.some((j) => j.id === jobId)) throw new HttpError(404, "errors:cron.notFound");
    audit("cron.run", req.ip, { projectId: id, jobId });
    return svc.runJob(jobId!);
  });
}
