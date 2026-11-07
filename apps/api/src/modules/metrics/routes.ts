import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hostnameSchema, metricRanges, type MetricRange } from "@panel/shared";
import { checkDomain, overview } from "../domains/service.js";
import { containerUsage, history } from "./service.js";

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/metrics/history", async (req) => {
    const { range } = z
      .object({ range: z.enum(Object.keys(metricRanges) as [MetricRange, ...MetricRange[]]).default("1h") })
      .parse(req.query);
    return history(range);
  });

  app.get("/api/metrics/containers", async () => containerUsage());

  // ---- Domainler ----
  app.get("/api/domains", async () => overview());

  app.get("/api/domains/check", async (req) => {
    const { hostname } = z.object({ hostname: hostnameSchema }).parse(req.query);
    return checkDomain(hostname);
  });
}
