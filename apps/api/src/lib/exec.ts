import { PassThrough, type Readable, type Writable } from "node:stream";
import { docker } from "./docker.js";

/**
 * Bir container içinde komut çalıştırır (docker exec).
 * - `stdout` verilirse çıktı oraya akar (ör. yedek dosyası), verilmezse metin olarak toplanır.
 * - `stdin` verilirse komuta beslenir (ör. geri yükleme).
 */
export async function execInContainer(
  containerId: string,
  cmd: string[],
  opts: { env?: string[]; stdin?: Readable; stdout?: Writable; timeoutMs?: number; maxOutput?: number; user?: string } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    Env: opts.env,
    ...(opts.user ? { User: opts.user } : {}),
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: !!opts.stdin,
    Tty: false,
  });
  const stream = (await exec.start({ hijack: true, stdin: !!opts.stdin })) as NodeJS.ReadWriteStream & {
    destroy: () => void;
    end: () => void;
  };

  const max = opts.maxOutput ?? 64 * 1024;
  let stdout = "";
  let stderr = "";
  const out = new PassThrough();
  const err = new PassThrough();
  if (opts.stdout) out.pipe(opts.stdout);
  else out.on("data", (c: Buffer) => (stdout = (stdout + c.toString("utf8")).slice(-max)));
  err.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-max)));
  docker.modem.demuxStream(stream, out, err);

  if (opts.stdin) {
    opts.stdin.on("data", (c) => stream.write(c));
    // stdin bitince yazma yönünü kapat; komut EOF görür
    opts.stdin.on("end", () => stream.end());
  }

  let timedOut = false;
  await new Promise<void>((resolve, reject) => {
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stream.destroy();
          resolve();
        }, opts.timeoutMs)
      : null;
    stream.on("end", () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    stream.on("close", () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    stream.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
  });
  out.end();
  err.end();
  // Çıktının hedefe tamamen yazılmasını bekle
  if (opts.stdout) await new Promise<void>((r) => (opts.stdout!.writableFinished ? r() : opts.stdout!.once("finish", () => r())));

  // Exit kodu stream bittikten kısa süre sonra kesinleşir
  let exitCode: number | null = null;
  for (let i = 0; i < 20; i++) {
    const info = await exec.inspect();
    if (!info.Running) {
      exitCode = info.ExitCode;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { exitCode, stdout, stderr, timedOut };
}
