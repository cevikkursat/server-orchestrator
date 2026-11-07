import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LogMessage } from "@panel/shared";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { isAllowedOrigin } from "../../lib/origin.js";
import * as svc from "./service.js";
import { rt } from "../../lib/i18n.js";

const idParam = z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/) });
const actionParam = idParam.extend({ action: z.enum(["start", "stop", "restart"]) });
const logsQuery = z.object({ tail: z.coerce.number().int().min(0).max(5000).default(300) });

function parseParams<T extends z.ZodType>(schema: T, req: FastifyRequest): z.infer<T> {
  const r = schema.safeParse(req.params);
  if (!r.success) throw Object.assign(new Error("errors:container.invalidId"), { statusCode: 400 });
  return r.data;
}

export async function containerRoutes(app: FastifyInstance) {
  app.get("/api/docker", async () => svc.dockerSummary());

  app.get("/api/containers", async () => svc.listContainers());

  app.get("/api/containers/:id", async (req) => {
    const { id } = parseParams(idParam, req);
    return svc.getContainer(id);
  });

  app.get("/api/containers/:id/stats", async (req) => {
    const { id } = parseParams(idParam, req);
    return svc.getStats(id);
  });

  app.post("/api/containers/:id/:action", async (req, reply) => {
    const { id, action } = parseParams(actionParam, req);
    const c = await svc.getContainer(id);
    if (c.isSelf && action === "stop") {
      return reply.code(409).send({ error: rt(req, "errors:container.cantStopSelf") });
    }
    await svc.containerAction(c.id, action);
    audit(`container.${action}`, req.ip, { id: c.id.slice(0, 12), name: c.name });
    return { ok: true };
  });

  // Canlı loglar: ws(s)://.../api/containers/:id/logs?tail=300
  app.get("/api/containers/:id/logs", { websocket: true }, async (socket, req) => {
    // Protokol: her mesaj bir LogMessage dizisidir
    const send = (m: LogMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify([m]));

    if (!isAllowedOrigin(req)) {
      socket.close(1008, "origin");
      return;
    }
    const params = idParam.safeParse(req.params);
    const query = logsQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      send({ type: "error", message: rt(req, "errors:invalidRequest") });
      socket.close();
      return;
    }

    let stop: (() => void) | null = null;
    // Satırları küçük paketler halinde gönder; yoğun logda tarayıcıyı boğmasın
    let batch: LogMessage[] = [];
    const flush = () => {
      if (batch.length && socket.readyState === socket.OPEN) socket.send(JSON.stringify(batch));
      batch = [];
    };
    const timer = setInterval(flush, 100);

    socket.on("close", () => {
      clearInterval(timer);
      stop?.();
    });

    try {
      stop = await svc.streamLogs(
        params.data.id,
        { tail: query.data.tail },
        (stream, ts, text) => {
          batch.push({ type: "line", stream, ts, text });
          if (batch.length >= 500) flush();
        },
        () => {
          flush();
          send({ type: "end" });
        },
      );
      if (socket.readyState !== socket.OPEN) stop();
    } catch (err) {
      send({ type: "error", message: (err as Error).message });
      socket.close();
    }
  });
}
