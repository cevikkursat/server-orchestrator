import fs from "node:fs";
import path from "node:path";
import { run } from "../../lib/process.js";
import { pt } from "../../lib/i18n.js";

/**
 * Kaynak koddan image üretimi.
 *
 * 1. Repo `git clone --depth 1` ile çekilir. Token URL'ye değil, tek seferlik bir
 *    HTTP başlığına konur; .git klasörü build'den önce silinir (token/geçmiş image'a girmesin).
 * 2. Dockerfile varsa o kullanılır; yoksa dil algılanıp Dockerfile üretilir.
 * 3. `docker build` (BuildKit) çalıştırılır, çıktı deploy loguna akar.
 */

export type Log = (line: string) => void;

export async function cloneRepo(opts: {
  repoFullName: string;
  branch: string;
  token: string;
  dest: string;
  log: Log;
  /** Belirli bir commit (geri dönüş). Boşsa branch'in son hali. */
  sha?: string | null;
}): Promise<{ sha: string; message: string }> {
  const { repoFullName, branch, token, dest, log } = opts;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const gitOpts = { timeoutMs: 5 * 60_000, mask: [token, auth], env: { GIT_TERMINAL_PROMPT: "0" } };
  const url = `https://github.com/${repoFullName}.git`;
  if (opts.sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(opts.sha)) throw new Error(pt("messages:build.badCommit"));
    log(pt("messages:build.fetchingSha", { repo: repoFullName, sha: opts.sha.slice(0, 7) }));
    fs.mkdirSync(dest, { recursive: true });
    for (const args of [
      ["init", "-q"],
      ["-c", `http.extraHeader=Authorization: Basic ${auth}`, "fetch", "--depth", "1", "--no-tags", url, opts.sha],
      ["checkout", "-q", "FETCH_HEAD"],
    ]) {
      const r = await run("git", ["-C", dest, ...args], gitOpts);
      if (r.code !== 0) throw new Error(pt("messages:build.gitFailed", { command: args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? "", output: r.output.slice(-3).join(" | ") }));
    }
  } else {
    log(pt("messages:build.fetchingBranch", { repo: repoFullName, branch }));
    const res = await run(
      "git",
      ["-c", `http.extraHeader=Authorization: Basic ${auth}`, "clone", "--depth", "1", "--single-branch", "--branch", branch, "--no-tags", url, dest],
      gitOpts,
    );
    if (res.code !== 0) throw new Error(pt("messages:build.cloneFailed", { output: res.output.slice(-3).join(" | ") }));
  }

  const sha = (await run("git", ["-C", dest, "rev-parse", "HEAD"])).output[0]?.trim() ?? "";
  const message = (await run("git", ["-C", dest, "log", "-1", "--pretty=%s"])).output[0]?.trim() ?? "";
  fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });
  log(`Commit: ${sha.slice(0, 7)} ${message}`);
  return { sha, message };
}

// ---- Algılama ----
export type BuildKind = "dockerfile" | "node" | "node-static" | "python" | "go" | "static";

export interface BuildPlan {
  kind: BuildKind;
  /** Context'e göre göreli Dockerfile yolu */
  dockerfile: string;
  /** Üretilmişse içeriği (loga yazılır) */
  generated: string | null;
}

const exists = (dir: string, f: string) => fs.existsSync(path.join(dir, f));

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const GEN_DOCKERFILE = ".panel.Dockerfile";
const GEN_CADDYFILE = ".panel.Caddyfile";

// Statik siteleri sunan Caddy ayarı: SPA'lar için bilinmeyen yollar index.html'e düşer
const STATIC_CADDYFILE = `:{$PORT:80} {
\troot * /srv
\tencode zstd gzip
\ttry_files {path} {path}/ /index.html
\tfile_server
\theader /assets/* Cache-Control "public, max-age=31536000, immutable"
}
`;

const shJson = (cmd: string) => JSON.stringify(["sh", "-c", cmd]);

function nodePlan(dir: string, startCommand: string | null): { kind: BuildKind; dockerfile: string; extra?: Record<string, string> } {
  const pkg = readJson(path.join(dir, "package.json")) ?? {};
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;

  const pm = exists(dir, "pnpm-lock.yaml")
    ? { install: "pnpm install --frozen-lockfile", run: "pnpm run", start: "pnpm start", corepack: true }
    : exists(dir, "yarn.lock")
      ? { install: "yarn install", run: "yarn run", start: "yarn start", corepack: true }
      : exists(dir, "package-lock.json")
        ? { install: "npm ci", run: "npm run", start: "npm start", corepack: false }
        : { install: "npm install", run: "npm run", start: "npm start", corepack: false };

  const head = [
    "FROM node:lts-alpine AS build",
    "WORKDIR /app",
    // pnpm/yarn için corepack (package.json'daki packageManager sürümünü kullanır).
    // Node 25+ corepack'i birlikte getirmiyor, npm ile kuruluyor.
    ...(pm.corepack ? ["ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0", "RUN npm install -g corepack && corepack enable"] : []),
    "COPY . .",
    `RUN ${pm.install}`,
    ...(scripts.build ? [`RUN ${pm.run} build`] : []),
  ];

  const start = startCommand || (scripts.start ? pm.start : null);
  if (start) {
    return {
      kind: "node",
      dockerfile: [...head, "ENV NODE_ENV=production", `CMD ${shJson(start)}`].join("\n") + "\n",
    };
  }
  if (scripts.build) {
    // start script'i yok ama build var: statik site (Vite, CRA, Astro static…)
    return {
      kind: "node-static",
      dockerfile:
        [
          ...head,
          `RUN for d in dist build out public; do if [ -f "$d/index.html" ]; then cp -r "$d" /out && exit 0; fi; done; \\`,
          `    echo "${pt("messages:build.staticOutputMissing")}" && exit 1`,
          "",
          "FROM caddy:2-alpine",
          "COPY --from=build /out /srv",
          `COPY ${GEN_CADDYFILE} /etc/caddy/Caddyfile`,
        ].join("\n") + "\n",
      extra: { [GEN_CADDYFILE]: STATIC_CADDYFILE },
    };
  }
  throw new Error(pt("messages:build.nodeNoScript"));
}

function pythonPlan(dir: string, startCommand: string | null) {
  let start = startCommand;
  if (!start && exists(dir, "Procfile")) {
    const web = /^web:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, "Procfile"), "utf8"));
    start = web?.[1]?.trim() ?? null;
  }
  if (!start) {
    throw new Error(pt("messages:build.pythonNoStart"));
  }
  const install = exists(dir, "requirements.txt")
    ? "pip install --no-cache-dir -r requirements.txt"
    : "pip install --no-cache-dir .";
  return [
    "FROM python:3-slim",
    "ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1",
    "WORKDIR /app",
    "COPY . .",
    `RUN ${install}`,
    `CMD ${shJson(start)}`,
  ].join("\n") + "\n";
}

function goPlan(startCommand: string | null) {
  return [
    "FROM golang:1-alpine AS build",
    "WORKDIR /src",
    "COPY . .",
    "RUN go mod download",
    "RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/app .",
    "",
    "FROM alpine:3",
    "RUN apk add --no-cache ca-certificates tzdata",
    "COPY --from=build /out/app /app",
    `CMD ${startCommand ? shJson(startCommand) : '["/app"]'}`,
  ].join("\n") + "\n";
}

/**
 * Build planını çıkarır ve gerekiyorsa üretilen dosyaları context'e yazar.
 * @param contextDir rootDir uygulanmış klasör
 */
export function planBuild(contextDir: string, opts: { dockerfilePath: string; startCommand: string | null }): BuildPlan {
  if (!fs.existsSync(contextDir)) throw new Error(pt("messages:build.rootMissing"));

  if (opts.dockerfilePath) {
    if (!exists(contextDir, opts.dockerfilePath)) throw new Error(pt("messages:build.dockerfileMissing", { path: opts.dockerfilePath }));
    return { kind: "dockerfile", dockerfile: opts.dockerfilePath, generated: null };
  }
  if (exists(contextDir, "Dockerfile")) return { kind: "dockerfile", dockerfile: "Dockerfile", generated: null };

  let kind: BuildKind;
  let content: string;
  let extra: Record<string, string> = {};

  if (exists(contextDir, "package.json")) {
    const p = nodePlan(contextDir, opts.startCommand);
    kind = p.kind;
    content = p.dockerfile;
    extra = p.extra ?? {};
  } else if (exists(contextDir, "go.mod")) {
    kind = "go";
    content = goPlan(opts.startCommand);
  } else if (exists(contextDir, "requirements.txt") || exists(contextDir, "pyproject.toml")) {
    kind = "python";
    content = pythonPlan(contextDir, opts.startCommand);
  } else if (exists(contextDir, "index.html")) {
    kind = "static";
    content = ["FROM caddy:2-alpine", "COPY . /srv", `COPY ${GEN_CADDYFILE} /etc/caddy/Caddyfile`].join("\n") + "\n";
    extra = { [GEN_CADDYFILE]: STATIC_CADDYFILE };
  } else {
    throw new Error(pt("messages:build.undetected"));
  }

  fs.writeFileSync(path.join(contextDir, GEN_DOCKERFILE), content);
  for (const [f, c] of Object.entries(extra)) fs.writeFileSync(path.join(contextDir, f), c);
  return { kind, dockerfile: GEN_DOCKERFILE, generated: content };
}

/** Algılanan türün adı (panelin dilinde): messages:build.kind.<tür> */
const kindLabel = (k: BuildKind) => pt(`messages:build.kind.${k}`);

export async function buildImage(opts: {
  contextDir: string;
  plan: BuildPlan;
  tag: string;
  labels: Record<string, string>;
  log: Log;
  timeoutMs?: number;
}) {
  const { contextDir, plan, tag, labels, log } = opts;
  log(pt("messages:build.detected", { kind: kindLabel(plan.kind) }) + (plan.kind === "dockerfile" ? ` (${plan.dockerfile})` : ""));
  if (plan.generated) {
    log(pt("messages:build.generated"));
    for (const l of plan.generated.trimEnd().split("\n")) log(`  │ ${l}`);
  }
  log(pt("messages:build.building", { tag }));

  const res = await run(
    "docker",
    [
      "build",
      "--progress=plain",
      "-t",
      tag,
      "-f",
      path.join(contextDir, plan.dockerfile),
      ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
      contextDir,
    ],
    {
      env: { DOCKER_BUILDKIT: "1", BUILDKIT_PROGRESS: "plain" },
      timeoutMs: opts.timeoutMs ?? 30 * 60_000,
      onLine: (l) => {
        if (l.trim()) log(`  ${l}`);
      },
    },
  );
  if (res.code !== 0) {
    const tail = res.output.filter((l) => /error|ERROR|failed/.test(l)).slice(-3);
    throw new Error(pt("messages:build.failed") + (tail.length ? `: ${tail.join(" | ").slice(0, 400)}` : ""));
  }
  log(pt("messages:build.done"));
}
