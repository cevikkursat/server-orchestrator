import { PassThrough } from "node:stream";
import type Dockerode from "dockerode";
import type {
  ContainerDetail,
  ContainerPort,
  ContainerState,
  ContainerStats,
  ContainerSummary,
  DockerSummary,
} from "@panel/shared";
import { docker, isConnError, isSelfContainer, isSystemContainer, toHttpError } from "../../lib/docker.js";

function dedupePorts(ports: Dockerode.Port[]): ContainerPort[] {
  // Docker IPv4 ve IPv6 için aynı portu iki kez döner
  const seen = new Map<string, ContainerPort>();
  for (const p of ports) {
    const key = `${p.PrivatePort}/${p.Type}/${p.PublicPort ?? ""}`;
    if (!seen.has(key)) seen.set(key, { privatePort: p.PrivatePort, publicPort: p.PublicPort, type: p.Type });
  }
  return [...seen.values()].sort((a, b) => a.privatePort - b.privatePort);
}

function toSummary(c: Dockerode.ContainerInfo): ContainerSummary {
  const name = (c.Names?.[0] ?? c.Id).replace(/^\//, "");
  return {
    id: c.Id,
    name,
    image: c.Image,
    state: c.State as ContainerState,
    status: c.Status,
    createdAt: c.Created * 1000,
    // Docker bu alanları bazen null döner (tiplerde zorunlu görünse de)
    ports: dedupePorts(c.Ports ?? []),
    composeProject: c.Labels?.["com.docker.compose.project"] ?? null,
    projectName: c.Labels?.["panel.project"] ?? null,
    isSelf: isSelfContainer(c.Id),
    isSystem: isSystemContainer(name),
  };
}

export async function listContainers(): Promise<ContainerSummary[]> {
  try {
    const list = await docker.listContainers({ all: true });
    return list.map(toSummary).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    throw toHttpError(err);
  }
}

export async function getContainer(id: string): Promise<ContainerDetail> {
  try {
    const c = await docker.getContainer(id).inspect();
    const name = c.Name.replace(/^\//, "");
    const portMap = c.NetworkSettings.Ports ?? {};
    const ports: ContainerPort[] = Object.entries(portMap).map(([key, bindings]) => {
      const [priv, type] = key.split("/");
      const pub = bindings?.[0]?.HostPort;
      return { privatePort: Number(priv), type: type ?? "tcp", publicPort: pub ? Number(pub) : undefined };
    });
    const nanoCpus = c.HostConfig.NanoCpus ?? 0;
    const finished = c.State.FinishedAt?.startsWith("0001") ? null : c.State.FinishedAt;
    return {
      id: c.Id,
      name,
      image: c.Config.Image,
      state: c.State.Status as ContainerState,
      status: c.State.Status,
      createdAt: Date.parse(c.Created),
      ports,
      composeProject: c.Config.Labels?.["com.docker.compose.project"] ?? null,
      projectName: c.Config.Labels?.["panel.project"] ?? null,
      isSelf: isSelfContainer(c.Id),
      isSystem: isSystemContainer(name),
      command: [c.Path, ...(c.Args ?? [])].join(" "),
      startedAt: c.State.StartedAt?.startsWith("0001") ? null : c.State.StartedAt,
      finishedAt: finished,
      exitCode: c.State.Running ? null : c.State.ExitCode,
      restartCount: c.RestartCount,
      restartPolicy: c.HostConfig.RestartPolicy?.Name || "no",
      health: c.State.Health?.Status ?? null,
      networks: Object.entries(c.NetworkSettings.Networks ?? {}).map(([n, v]) => ({ name: n, ip: v.IPAddress })),
      mounts: (c.Mounts ?? []).map((m) => ({
        type: m.Type,
        source: m.Name ?? m.Source,
        destination: m.Destination,
        readOnly: !m.RW,
      })),
      labels: c.Config.Labels ?? {},
      limits: {
        memoryBytes: c.HostConfig.Memory || null,
        cpus: nanoCpus ? nanoCpus / 1e9 : null,
      },
    };
  } catch (err) {
    throw toHttpError(err);
  }
}

export async function containerAction(id: string, action: "start" | "stop" | "restart") {
  const c = docker.getContainer(id);
  try {
    if (action === "start") await c.start();
    else if (action === "stop") await c.stop({ t: 10 });
    else await c.restart({ t: 10 });
  } catch (err) {
    const e = toHttpError(err);
    // 304: zaten istenen durumda; hata sayma
    if ((err as { statusCode?: number }).statusCode === 304) return;
    throw e;
  }
}

export async function getStats(id: string): Promise<ContainerStats> {
  try {
    // stream:false -> Docker iki örnek alıp precpu_stats'ı doldurur
    const s = (await docker.getContainer(id).stats({ stream: false })) as Dockerode.ContainerStats;
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage ?? 0);
    const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
    const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

    const ms = s.memory_stats as Dockerode.ContainerStats["memory_stats"] & { stats?: Record<string, number> };
    // `docker stats` ile aynı hesap: cache'i (inactive_file) düş
    const cache = ms.stats?.inactive_file ?? ms.stats?.total_inactive_file ?? 0;
    const memoryBytes = Math.max(0, (ms.usage ?? 0) - cache);

    let rx = 0;
    let tx = 0;
    for (const n of Object.values(s.networks ?? {})) {
      rx += n.rx_bytes;
      tx += n.tx_bytes;
    }
    return {
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryBytes,
      memoryLimitBytes: ms.limit ?? 0,
      networkRxBytes: rx,
      networkTxBytes: tx,
      pids: (s as unknown as { pids_stats?: { current?: number } }).pids_stats?.current ?? 0,
    };
  } catch (err) {
    throw toHttpError(err);
  }
}

export async function dockerSummary(): Promise<DockerSummary> {
  try {
    const [info, version] = await Promise.all([docker.info(), docker.version()]);
    return {
      available: true,
      version: version.Version,
      containers: { total: info.Containers, running: info.ContainersRunning },
      images: info.Images,
    };
  } catch (err) {
    if (isConnError(err)) return { available: false, version: null, containers: { total: 0, running: 0 }, images: 0 };
    throw toHttpError(err);
  }
}

/**
 * Container loglarını satır satır akıtır. Dönen fonksiyon akışı durdurur.
 * TTY'siz container'larda Docker stdout/stderr'i tek akışta çoklar (multiplex);
 * demuxStream ile ayırıyoruz.
 */
export async function streamLogs(
  id: string,
  opts: { tail: number },
  onLine: (stream: "stdout" | "stderr", ts: string | null, text: string) => void,
  onEnd: () => void,
): Promise<() => void> {
  const container = docker.getContainer(id);
  const info = await container.inspect().catch((err) => {
    throw toHttpError(err);
  });

  const raw = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: opts.tail,
    timestamps: true,
  })) as NodeJS.ReadableStream & { destroy?: () => void };

  const attach = (stream: NodeJS.ReadableStream, name: "stdout" | "stderr") => {
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) emit(name, line);
    });
    stream.on("end", () => {
      if (buf) emit(name, buf);
    });
  };

  const emit = (name: "stdout" | "stderr", line: string) => {
    const clean = line.replace(/\r$/, "");
    // timestamps:true -> "2026-11-04T10:00:00.123456789Z mesaj"
    const m = /^(\d{4}-\d{2}-\d{2}T\S+Z) ?(.*)$/s.exec(clean);
    onLine(name, m ? m[1]! : null, m ? m[2]! : clean);
  };

  if (info.Config.Tty) {
    attach(raw, "stdout");
  } else {
    const out = new PassThrough();
    const errS = new PassThrough();
    docker.modem.demuxStream(raw, out, errS);
    attach(out, "stdout");
    attach(errS, "stderr");
    raw.on("end", () => {
      out.end();
      errS.end();
    });
  }

  raw.on("end", onEnd);
  raw.on("error", onEnd);

  return () => raw.destroy?.();
}
