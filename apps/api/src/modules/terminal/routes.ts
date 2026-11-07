import { StringDecoder } from "node:string_decoder";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TerminalClientMessage, TerminalServerMessage } from "@panel/shared";
import { audit } from "../../lib/audit.js";
import { docker } from "../../lib/docker.js";
import { isAllowedOrigin } from "../../lib/origin.js";
import { rt } from "../../lib/i18n.js";

/**
 * Tarayıcıdan container'a etkileşimli shell (docker exec, TTY).
 * Sadece container'lara açılır; sunucunun kendisine (host) shell verilmez.
 */

const idParam = z.object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/) });
// bash varsa onu, yoksa sh kullan
const SHELL = ["sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"];

export async function terminalRoutes(app: FastifyInstance) {
  app.get("/api/containers/:id/terminal", { websocket: true }, async (socket, req) => {
    const send = (m: TerminalServerMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
    const fail = (m: string) => {
      send({ t: "e", m });
      socket.close();
    };

    if (!isAllowedOrigin(req)) return socket.close(1008, "origin");
    const p = idParam.safeParse(req.params);
    if (!p.success) return fail(rt(req, "errors:container.invalid"));

    // exec hazırlanırken gelen ilk mesajlar (terminal boyutu, ilk tuşlar) kaybolmasın
    let handle: ((m: TerminalClientMessage) => void) | null = null;
    const pending: TerminalClientMessage[] = [];
    socket.on("message", (raw) => {
      let m: TerminalClientMessage;
      try {
        m = JSON.parse(raw.toString()) as TerminalClientMessage;
      } catch {
        return;
      }
      if (handle) handle(m);
      else if (pending.length < 100) pending.push(m);
    });

    try {
      const container = docker.getContainer(p.data.id);
      const info = await container.inspect();
      if (!info.State.Running) return fail(rt(req, "errors:container.notRunning"));

      const exec = await container.exec({
        Cmd: SHELL,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ["TERM=xterm-256color", "LANG=C.UTF-8"],
      });
      // Tty burada da verilmeli; yoksa Docker çıktıyı 8 baytlık başlıklarla çoklar (multiplex)
      const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as NodeJS.ReadWriteStream & {
        destroy: () => void;
      };
      audit("terminal.open", req.ip, { container: info.Name.replace(/^\//, ""), user: req.user?.username });

      // Çok baytlı UTF-8 karakterleri parçalar arasında bölünmesin
      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => send({ t: "o", d: decoder.write(chunk) }));
      stream.on("end", async () => {
        const r = await exec.inspect().catch(() => null);
        send({ t: "x", code: r?.ExitCode ?? null });
        socket.close();
      });
      stream.on("error", () => socket.close());

      handle = (m) => {
        if (m.t === "i" && typeof m.d === "string") stream.write(m.d);
        else if (m.t === "r" && Number.isInteger(m.c) && Number.isInteger(m.r) && m.c > 0 && m.r > 0 && m.c < 1000 && m.r < 1000) {
          exec.resize({ w: m.c, h: m.r }).catch(() => {});
        }
      };
      for (const m of pending.splice(0)) handle(m);
      socket.on("close", () => {
        // stdin kapanınca shell çıkar
        stream.end();
        setTimeout(() => stream.destroy(), 1000).unref();
      });
    } catch (err) {
      fail((err as Error).message);
    }
  });
}
