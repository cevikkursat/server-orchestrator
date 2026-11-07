import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notificationSettingsSchema } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { parseBody } from "../../lib/validate.js";
import { HttpError } from "../projects/service.js";
import * as svc from "./service.js";

export async function notifyRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async () => svc.getMaskedSettings());

  app.put("/api/notifications", async (req, reply) => {
    const body = parseBody(notificationSettingsSchema, req.body, reply);
    if (!body) return;
    svc.saveSettings(body);
    audit("notifications.update", req.ip, { telegram: body.telegram.enabled, discord: body.discord.enabled });
    return svc.getMaskedSettings();
  });

  app.post("/api/notifications/test", async () => {
    try {
      await svc.sendTest();
      return { ok: true };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post("/api/notifications/telegram/chats", async (req) => {
    const { botToken } = z.object({ botToken: z.string().max(200) }).parse(req.body);
    try {
      return await svc.telegramChats(botToken);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });
}
