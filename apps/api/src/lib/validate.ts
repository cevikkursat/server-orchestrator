import type { FastifyReply } from "fastify";
import type { z } from "zod";
import { requestLanguage, translate } from "./i18n.js";

/** Gövdeyi doğrular; hatalıysa 400 döner ve null verir. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send({ error: translate(requestLanguage(reply.request), result.error.issues[0]?.message ?? "errors:invalidRequest"), details: result.error.issues });
    return null;
  }
  return result.data;
}
