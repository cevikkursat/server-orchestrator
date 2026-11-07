import nodemailer from "nodemailer";
import type { NotificationSettings, NotifyEvent } from "@panel/shared";
import { config } from "../../config.js";
import { getSecret, setSecret } from "../../lib/settings.js";
import { pt } from "../../lib/i18n.js";

/**
 * E-posta (SMTP), Telegram ve Discord bildirimleri; hepsi isteğe bağlı, varsayılan kapalı.
 * Ayarlar (SMTP şifresi, bot token, webhook URL) şifreli saklanır; arayüze maskeli döner.
 */

const KEY = "notifications";

const defaults: NotificationSettings = {
  email: { enabled: false, host: "smtp.gmail.com", port: 465, secure: true, user: "", password: "", to: "" },
  telegram: { enabled: false, botToken: "", chatId: "" },
  discord: { enabled: false, webhookUrl: "" },
  events: {
    login: true,
    securityAlert: true,
    deployFailure: true,
    deploySuccess: false,
    backupFailure: true,
    containerDown: true,
    resources: true,
    cronFailure: true,
    healthCheck: true,
    panelUpdate: true,
  },
};

function load(): NotificationSettings {
  const s = getSecret<NotificationSettings>(KEY);
  return s ? { ...defaults, ...s, email: { ...defaults.email, ...s.email }, events: { ...defaults.events, ...s.events } } : defaults;
}

const mask = (v: string) => (v ? `***${v.slice(-4)}` : "");

export function getMaskedSettings(): NotificationSettings {
  const s = load();
  return {
    ...s,
    email: { ...s.email, password: mask(s.email.password) },
    telegram: { ...s.telegram, botToken: mask(s.telegram.botToken) },
    discord: { ...s.discord, webhookUrl: mask(s.discord.webhookUrl) },
  };
}

export function saveSettings(input: NotificationSettings) {
  const cur = load();
  // Maskeli değer geldiyse kayıtlı olanı koru
  const keep = (incoming: string, existing: string) => (incoming.startsWith("***") ? existing : incoming);
  setSecret(KEY, {
    email: { ...input.email, password: keep(input.email.password, cur.email.password) },
    telegram: { ...input.telegram, botToken: keep(input.telegram.botToken, cur.telegram.botToken) },
    discord: { ...input.discord, webhookUrl: keep(input.discord.webhookUrl, cur.discord.webhookUrl) },
    events: input.events,
  } satisfies NotificationSettings);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendEmail(e: NotificationSettings["email"], title: string, body: string) {
  const transport = nodemailer.createTransport({
    host: e.host,
    port: e.port,
    secure: e.secure,
    auth: e.user ? { user: e.user, pass: e.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({
      from: { name: pt("messages:appName"), address: e.user || e.to },
      to: e.to,
      subject: title,
      text: `${body}\n\n— ${pt("messages:appName")}`,
    });
  } catch (err) {
    const x = err as Error & { code?: string };
    const known: Record<string, string> = {
      EAUTH: pt("errors:notify.smtpAuth"),
      ECONNREFUSED: pt("errors:notify.smtpRefused", { host: e.host, port: e.port }),
      ETIMEDOUT: pt("errors:notify.smtpTimeout"),
      ESOCKET: pt("errors:notify.smtpSocket"),
      EENVELOPE: pt("errors:notify.smtpEnvelope"),
    };
    throw new Error(pt("errors:notify.emailFailed", { reason: (x.code && known[x.code]) || x.message || x.code || pt("errors:notify.notSent") }));
  }
}

/** Bildirim e-posta adresine doğrudan gönderir (olay ayarlarından bağımsız). E-posta ayarlı değilse hata verir. */
export async function sendDirectEmail(title: string, body: string) {
  const s = load();
  if (!s.email.enabled || !s.email.host || !s.email.to) {
    throw new Error(pt("errors:notify.emailNotConfigured"));
  }
  await sendEmail(s.email, title, body);
  return s.email.to;
}

async function sendTelegram(token: string, chatId: string, title: string, body: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { description?: string };
    throw new Error(`Telegram: ${j.description ?? res.status}`);
  }
}

async function sendDiscord(url: string, title: string, body: string, level: Level) {
  const color = level === "error" ? 0xef4444 : level === "warning" ? 0xf59e0b : 0x10b981;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [{ title: title.slice(0, 256), description: body.slice(0, 4000), color }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord: HTTP ${res.status}`);
}

type Level = "info" | "warning" | "error";

async function deliver(s: NotificationSettings, title: string, body: string, level: Level) {
  const tasks: Promise<void>[] = [];
  if (s.email.enabled && s.email.host && s.email.to) tasks.push(sendEmail(s.email, title, body));
  if (s.telegram.enabled && s.telegram.botToken && s.telegram.chatId) {
    tasks.push(sendTelegram(s.telegram.botToken, s.telegram.chatId, title, body));
  }
  if (s.discord.enabled && s.discord.webhookUrl) tasks.push(sendDiscord(s.discord.webhookUrl, title, body, level));
  const results = await Promise.allSettled(tasks);
  return results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).message);
}

const prefix = () => (config.panelDomain ? `[${config.panelDomain}] ` : "");

/** Olay bildirimi. Hata fırlatmaz; bildirim sorunu asıl işi bozmamalı. */
export function notify(event: NotifyEvent, title: string, body: string, level: Level = "info") {
  const s = load();
  if (!s.events[event]) return;
  void deliver(s, prefix() + title, body, level).catch(() => {});
}

export async function sendTest() {
  const s = load();
  if (!(s.email.enabled || s.telegram.enabled || s.discord.enabled)) throw new Error(pt("errors:notify.noChannel"));
  const errors = await deliver(s, prefix() + pt("notify:test.title"), pt("notify:test.body"), "info");
  if (errors.length) throw new Error(errors.join(" · "));
}

/** Bota mesaj atmış sohbetleri listeler (chat id bulmak için) */
export async function telegramChats(tokenInput: string) {
  const token = tokenInput.startsWith("***") ? load().telegram.botToken : tokenInput;
  if (!token) throw new Error(pt("errors:notify.botTokenRequired"));
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(10_000) });
  const j = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message?: { chat: { id: number; title?: string; username?: string; first_name?: string; type: string } } }[];
  };
  if (!j.ok) throw new Error(`Telegram: ${j.description ?? pt("errors:notify.telegramError")}`);
  const chats = new Map<string, { id: string; name: string; type: string }>();
  for (const u of j.result ?? []) {
    const c = u.message?.chat;
    if (c) chats.set(String(c.id), { id: String(c.id), name: c.title ?? c.username ?? c.first_name ?? String(c.id), type: c.type });
  }
  return [...chats.values()];
}

