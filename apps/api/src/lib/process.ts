import { spawn } from "node:child_process";
import { pt } from "./i18n.js";

/**
 * Bir komutu çalıştırıp çıktısını satır satır iletir.
 * `mask` içindeki değerler (token vb.) çıktıda *** ile gizlenir.
 */
export function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** false: panelin kendi ortam değişkenleri aktarılmaz (sadece PATH/HOME + env) */
    inheritEnv?: boolean;
    timeoutMs?: number;
    mask?: string[];
    onLine?: (line: string) => void;
  } = {},
): Promise<{ code: number; output: string[] }> {
  const mask = (opts.mask ?? []).filter((m) => m.length >= 6);
  const clean = (s: string) => mask.reduce((acc, m) => acc.split(m).join("***"), s);

  return new Promise((resolve, reject) => {
    const base =
      opts.inheritEnv === false
        ? Object.fromEntries(["PATH", "HOME", "DOCKER_HOST"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
        : process.env;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...base, ...opts.env }, windowsHide: true });
    const output: string[] = [];
    const handle = (stream: NodeJS.ReadableStream) => {
      let buf = "";
      stream.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split(/\r?\n|\r/);
        buf = lines.pop() ?? "";
        for (const l of lines) emit(l);
      });
      stream.on("end", () => buf && emit(buf));
    };
    const emit = (l: string) => {
      const c = clean(l);
      output.push(c);
      if (output.length > 2000) output.shift();
      opts.onLine?.(c);
    };
    handle(child.stdout);
    handle(child.stderr);

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(pt("messages:process.timeout", { cmd, count: Math.round(opts.timeoutMs! / 60000) })));
        }, opts.timeoutMs)
      : null;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject((err as NodeJS.ErrnoException).code === "ENOENT" ? new Error(pt("messages:process.notFound", { cmd })) : err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}
