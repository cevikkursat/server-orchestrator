import crypto from "node:crypto";
import type { GithubInstallation, GithubRepo, GithubStatus } from "@panel/shared";
import { config } from "../../config.js";
import { deleteSetting, getSecret, setSecret } from "../../lib/settings.js";
import { HttpError } from "../projects/service.js";
import { errorText, pt } from "../../lib/i18n.js";

/**
 * GitHub App entegrasyonu.
 *
 * Kurulum "manifest akışı" ile yapılır: panel bir manifest üretir, kullanıcı GitHub'da
 * onaylar, GitHub geri yönlendirir ve panel tek kullanımlık kodu App kimlik bilgileriyle
 * (private key, webhook secret) takas eder. Bunlar DB'de şifreli saklanır.
 *
 * API çağrıları için: private key ile 10 dk'lık JWT imzalanır → bununla kurulum (installation)
 * başına 1 saatlik token alınır → repo okuma / commit durumu yazma bu token ile yapılır.
 */

const API = "https://api.github.com";
const SETTING_KEY = "github_app";

export interface StoredApp {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  owner: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string | null;
  pem: string;
  webhookActive: boolean;
  /** GitHub'ın push bildirimlerini gönderdiği adres */
  webhookUrl?: string | null;
  /** App oluşturulurken kullanılan panel adresi */
  panelOrigin: string;
}

export const getApp = () => getSecret<StoredApp>(SETTING_KEY);

function requireApp(): StoredApp {
  const app = getApp();
  if (!app) throw new HttpError(400, "errors:github.notSetUp");
  return app;
}

// ---- Kimlik doğrulama ----
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function appJwt(app: Pick<StoredApp, "id" | "pem">) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat'i 60 sn geri al: sunucu saati biraz kaymış olabilir
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: app.id }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), app.pem);
  return `${header}.${payload}.${b64url(sig)}`;
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const app = requireApp();
  const r = await gh<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    auth: `Bearer ${appJwt(app)}`,
  });
  tokenCache.set(installationId, { token: r.token, expiresAt: Date.parse(r.expires_at) });
  return r.token;
}

async function gh<T>(path: string, opts: { method?: string; auth?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sunucu-paneli",
      ...(opts.auth ? { Authorization: opts.auth } : {}),
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new HttpError(res.status === 404 ? 404 : 502, "errors:github.apiError", { status: res.status, message: msg });
  }
  return (text ? JSON.parse(text) : null) as T;
}

const withToken = async <T>(installationId: number, path: string, opts: { method?: string; body?: unknown } = {}) =>
  gh<T>(path, { ...opts, auth: `token ${await installationToken(installationId)}` });

// ---- Manifest akışı ----
const pendingStates = new Map<string, { origin: string; hookUrl: string | null; expiresAt: number }>();

/**
 * Webhook adresi: panel internete kapalıysa (Tailscale) GitHub ona ulaşamaz; bu durumda
 * internete açık WEBHOOK_DOMAIN kullanılır (Caddy orada sadece webhook yolunu açar).
 */
function webhookUrlFor(origin: string) {
  if (config.webhookDomain) return `https://${config.webhookDomain}/api/github/webhook`;
  if (config.panelAccess === "public" && !isLocalOrigin(origin)) return `${origin}/api/github/webhook`;
  return null;
}

function isLocalOrigin(origin: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Panelin dışarıdan erişilen adresini doğrula (manifestteki URL'ler buna göre üretilir) */
export function validateOrigin(origin: string) {
  if (config.panelDomain && origin === `https://${config.panelDomain}`) return origin;
  if (!config.isProd && isLocalOrigin(origin)) return origin;
  throw new HttpError(400, "errors:github.badOrigin", { origin });
}

export function startManifest(origin: string) {
  if (getApp()) throw new HttpError(409, "errors:github.alreadySetUp");
  validateOrigin(origin);
  const state = crypto.randomBytes(16).toString("hex");
  const hookUrl = webhookUrlFor(origin);
  pendingStates.set(state, { origin, hookUrl, expiresAt: Date.now() + 60 * 60_000 });

  const suffix = crypto.randomBytes(2).toString("hex");
  const manifest = {
    name: `${pt("messages:appName")} ${suffix}`,
    url: origin,
    description: pt("messages:github.appDescription"),
    public: false,
    redirect_url: `${origin}/api/github/manifest/callback`,
    setup_url: `${origin}/settings?github=installed`,
    setup_on_update: true,
    // pull_requests: PR önizlemeleri için PR olaylarını almak
    default_permissions: { contents: "read", metadata: "read", statuses: "write", pull_requests: "read" },
    // Webhook'lar sadece internetten erişilebilen bir adrese gönderilebilir
    ...(hookUrl ? { hook_attributes: { url: hookUrl, active: true }, default_events: ["push", "pull_request"] } : { default_events: [] }),
  };
  return {
    url: `https://github.com/settings/apps/new?state=${state}`,
    manifest: JSON.stringify(manifest),
  };
}

export async function completeManifest(code: string, state: string) {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.expiresAt < Date.now()) throw new HttpError(400, "errors:github.stateExpired");

  const r = await gh<{
    id: number;
    slug: string;
    name: string;
    html_url: string;
    owner: { login: string };
    client_id: string;
    client_secret: string;
    webhook_secret: string | null;
    pem: string;
  }>(`/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST" });

  const app: StoredApp = {
    id: r.id,
    slug: r.slug,
    name: r.name,
    htmlUrl: r.html_url,
    owner: r.owner.login,
    clientId: r.client_id,
    clientSecret: r.client_secret,
    webhookSecret: r.webhook_secret,
    pem: r.pem,
    webhookActive: !!pending.hookUrl,
    webhookUrl: pending.hookUrl,
    panelOrigin: pending.origin,
  };
  setSecret(SETTING_KEY, app);
  tokenCache.clear();
  return { app, origin: pending.origin };
}

export function removeApp() {
  deleteSetting(SETTING_KEY);
  tokenCache.clear();
}

// ---- Okuma ----
/** Panelin özelliklerinin gerektirdiği App izinleri ve olayları */
const REQUIRED_PERMISSIONS: Record<string, "read" | "write"> = { contents: "read", metadata: "read", statuses: "write", pull_requests: "read" };
const REQUIRED_EVENTS = ["push", "pull_request"];
/** Okunur adlar (panelin dilinde): messages:github.permission.<izin/olay> */
const permissionLabel = (k: string) => pt(`messages:github.permission.${k}`);

/** Verilen izin/olay setinde eksik olanlar (okunur adlarıyla) */
function missingOf(permissions: Record<string, string> | undefined, events: string[] | undefined, checkEvents: boolean) {
  const out: string[] = [];
  for (const [k, need] of Object.entries(REQUIRED_PERMISSIONS)) {
    const have = permissions?.[k];
    if (!have || (need === "write" && have !== "write")) out.push(permissionLabel(k));
  }
  if (checkEvents) for (const e of REQUIRED_EVENTS) if (!events?.includes(e)) out.push(permissionLabel(e));
  return out;
}

export async function listInstallations(): Promise<GithubInstallation[]> {
  const app = requireApp();
  const list = await gh<
    {
      id: number;
      account: { login: string; type: string };
      repository_selection: string;
      html_url: string;
      permissions?: Record<string, string>;
      events?: string[];
    }[]
  >("/app/installations?per_page=100", { auth: `Bearer ${appJwt(app)}` });
  return list.map((i) => ({
    id: i.id,
    account: i.account.login,
    accountType: i.account.type,
    repositorySelection: i.repository_selection,
    manageUrl: i.html_url,
    missing: missingOf(i.permissions, i.events, app.webhookActive),
  }));
}

/** App'in kendi ayarlarında (GitHub → Developer settings) eksik olanlar */
async function appMissing(app: StoredApp) {
  const a = await gh<{ permissions?: Record<string, string>; events?: string[] }>("/app", { auth: `Bearer ${appJwt(app)}` });
  return missingOf(a.permissions, a.events, app.webhookActive);
}

export async function githubStatus(): Promise<GithubStatus> {
  const app = getApp();
  if (!app) {
    return { configured: false, app: null, installations: [], webhookActive: false, webhookUrl: null, appMissing: [], permissionsUrl: null, error: null };
  }
  const base = {
    configured: true,
    app: {
      id: app.id,
      name: app.name,
      slug: app.slug,
      htmlUrl: app.htmlUrl,
      owner: app.owner,
      installUrl: `https://github.com/apps/${app.slug}/installations/new`,
    },
    webhookActive: app.webhookActive,
    webhookUrl: app.webhookUrl ?? null,
    permissionsUrl: `https://github.com/settings/apps/${app.slug}/permissions`,
  };
  try {
    const [installations, missing] = await Promise.all([listInstallations(), appMissing(app)]);
    return { ...base, installations, appMissing: missing, error: null };
  } catch (err) {
    return { ...base, installations: [], appMissing: [], error: errorText(err) };
  }
}

export async function listRepos(): Promise<GithubRepo[]> {
  const installations = await listInstallations();
  const out: GithubRepo[] = [];
  for (const inst of installations) {
    for (let page = 1; page <= 10; page++) {
      const r = await withToken<{
        total_count: number;
        repositories: { id: number; full_name: string; private: boolean; default_branch: string; html_url: string }[];
      }>(inst.id, `/installation/repositories?per_page=100&page=${page}`);
      for (const repo of r.repositories) {
        out.push({
          id: repo.id,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          installationId: inst.id,
          htmlUrl: repo.html_url,
        });
      }
      if (out.length >= r.total_count || r.repositories.length < 100) break;
    }
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listBranches(installationId: number, repoFullName: string): Promise<string[]> {
  const r = await withToken<{ name: string }[]>(installationId, `/repos/${repoFullName}/branches?per_page=100`);
  return r.map((b) => b.name);
}

/** Commit'in yanında ✓ / ✗ / ● olarak görünen durum. Hata deploy'u bozmasın diye yutulur. */
export async function setCommitStatus(
  installationId: number,
  repoFullName: string,
  sha: string,
  state: "pending" | "success" | "failure" | "error",
  description: string,
  targetUrl: string | null,
  context = "sunucu-paneli/deploy",
) {
  try {
    await withToken(installationId, `/repos/${repoFullName}/statuses/${sha}`, {
      method: "POST",
      body: { state, description: description.slice(0, 140), context, ...(targetUrl ? { target_url: targetUrl } : {}) },
    });
  } catch {
    // Yetki yoksa veya GitHub erişilemezse deploy yine de devam eder
  }
}

// ---- Webhook ----
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  const app = getApp();
  if (!app?.webhookSecret || !signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", app.webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
