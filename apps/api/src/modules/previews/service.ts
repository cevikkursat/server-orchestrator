import { and, eq } from "drizzle-orm";
import { config } from "../../config.js";
import { db, schema } from "../../db/index.js";
import { syncCaddy } from "../caddy/service.js";
import { enqueueDeploy } from "../deploy/runner.js";
import { deleteProject, getPreviewSettings, type ProjectRow } from "../projects/service.js";
import { pt } from "../../lib/i18n.js";

/**
 * PR önizlemeleri: önizlemesi açık bir projenin reposunda, projenin branch'ine bir PR
 * açılınca PR'ın branch'i ayrı bir container'da yayınlanır:
 *     pr-<no>-<proje>.<ana domain>
 * Domain varsayılan olarak sadece Tailscale cihazlarına açıktır (proje ayarından değişir).
 * PR'a yeni commit gelince yeniden deploy edilir, PR kapanınca (merge dahil) her şey silinir.
 *
 * Güvenlik: fork'tan gelen PR'lar deploy EDİLMEZ (başkasının kodu sunucuda çalışmasın).
 */

const MAX_PREVIEWS_PER_PROJECT = 10;

export interface PullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    title?: string;
    head?: { ref?: string; sha?: string; repo?: { id: number } | null };
    base?: { ref?: string };
  };
  repository?: { id: number; full_name: string };
}

export const previewName = (parent: string, pr: number) => `${parent}-pr-${pr}`;
export const previewHostname = (parent: string, pr: number) => `pr-${pr}-${parent}.${config.baseDomain}`;

function parentsFor(repoId: number, baseRef: string) {
  return db
    .select()
    .from(schema.projects)
    .all()
    .filter(
      (p) =>
        !p.parentId &&
        p.sourceType === "github" &&
        p.github?.repoId === repoId &&
        p.github.branch === baseRef &&
        !p.github.compose &&
        getPreviewSettings(p).enabled,
    );
}

const findPreview = (parentId: number, pr: number) =>
  db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.parentId, parentId), eq(schema.projects.prNumber, pr)))
    .get();

function upsertPreview(parent: ProjectRow, pr: number, headRef: string, title: string | null): ProjectRow | { skipped: string } {
  const existing = findPreview(parent.id, pr);
  const github = { ...parent.github!, branch: headRef, autoDeploy: false };
  const now = Date.now();
  if (existing) {
    db.update(schema.projects).set({ github, prTitle: title, updatedAt: now }).where(eq(schema.projects.id, existing.id)).run();
    return { ...existing, github, prTitle: title };
  }

  const open = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.parentId, parent.id)).all();
  if (open.length >= MAX_PREVIEWS_PER_PROJECT) return { skipped: pt("messages:previews.limit", { count: MAX_PREVIEWS_PER_PROJECT }) };
  const name = previewName(parent.name, pr);
  if (db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.name, name)).get()) {
    return { skipped: pt("messages:previews.nameTaken", { name }) };
  }
  const hostname = previewHostname(parent.name, pr);
  if (db.select({ id: schema.domains.id }).from(schema.domains).where(eq(schema.domains.hostname, hostname)).get()) {
    return { skipped: pt("messages:previews.hostTaken", { hostname }) };
  }

  return db.transaction((tx) => {
    const p = tx
      .insert(schema.projects)
      .values({
        name,
        sourceType: "github",
        image: "",
        github,
        startCommand: parent.startCommand,
        port: parent.port,
        // Değişkenler deploy anında ana projeden + önizleme ayarlarından birleştirilir
        envEncrypted: null,
        memoryMb: parent.memoryMb,
        cpus: parent.cpus,
        parentId: parent.id,
        prNumber: pr,
        prTitle: title,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.insert(schema.domains)
      .values({ projectId: p.id, hostname, kind: "route", access: getPreviewSettings(parent).access, createdAt: now })
      .run();
    return p;
  });
}

/** GitHub `pull_request` olayı */
export async function handlePullRequest(payload: PullRequestPayload) {
  const { action, number: pr, pull_request: pull, repository: repo } = payload;
  if (!action || !pr || !pull || !repo || !pull.base?.ref) return { ignored: "payload" };
  const parents = parentsFor(repo.id, pull.base.ref);
  if (!parents.length) return { ignored: pt("messages:previews.noProject") };

  if (action === "closed") {
    const removed: string[] = [];
    for (const parent of parents) {
      const p = findPreview(parent.id, pr);
      if (!p) continue;
      await deleteProject(p.id);
      removed.push(p.name);
    }
    if (removed.length) await syncCaddy().catch(() => {});
    return { removed };
  }

  if (action === "edited") {
    for (const parent of parents) {
      const p = findPreview(parent.id, pr);
      if (p) db.update(schema.projects).set({ prTitle: pull.title ?? null }).where(eq(schema.projects.id, p.id)).run();
    }
    return { updated: true };
  }

  if (!["opened", "reopened", "synchronize"].includes(action)) return { ignored: action };
  if (!pull.head?.ref || !pull.head.sha) return { ignored: "head" };
  if (pull.head.repo?.id !== repo.id) return { ignored: pt("messages:previews.fork") };

  const deployments: number[] = [];
  const skipped: string[] = [];
  for (const parent of parents) {
    const r = upsertPreview(parent, pr, pull.head.ref, pull.title ?? null);
    if ("skipped" in r) {
      skipped.push(`${parent.name}: ${r.skipped}`);
      continue;
    }
    deployments.push(enqueueDeploy(r.id, "preview", { commitSha: pull.head.sha, commitMessage: pull.title ?? null }));
  }
  return { deployments, skipped };
}
