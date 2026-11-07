import i18next from "i18next";
import type { FastifyRequest } from "fastify";
import { isPanelLanguage, validationMessages, type PanelLanguage } from "@panel/shared";
import { tr } from "../locales/tr/index.js";
import { en } from "../locales/en/index.js";
import { db, schema } from "../db/index.js";
import { config } from "../config.js";

/**
 * Sunucu tarafı çeviri.
 * - İstek cevapları (hatalar) isteğin diliyle: web her istekte Accept-Language gönderir.
 * - İstek dışı metinler (bildirimler, deploy logu, yedek hataları) panelin diliyle:
 *   yöneticinin seçtiği dil → PANEL_LANGUAGE → İngilizce.
 * Anahtar bulunamazsa metin olduğu gibi döner; henüz çevrilmemiş düz metinler de çalışır.
 */
const i18n = i18next.createInstance();
void i18n.init({
  resources: {
    tr: { ...tr, validation: validationMessages.tr },
    en: { ...en, validation: validationMessages.en },
  },
  lng: "en",
  fallbackLng: "en",
  ns: ["errors", "notify", "messages", "validation"],
  defaultNS: "errors",
  interpolation: { escapeValue: false },
  initAsync: false,
});

export type Params = Record<string, unknown>;

/** Anahtarı verilen dile çevirir; anahtar değilse (düz metin) aynen döner */
export function translate(lng: PanelLanguage, keyOrText: string, params?: Params): string {
  return i18n.t(keyOrText, { lng, ...params, defaultValue: keyOrText }) as string;
}

/** Accept-Language'den desteklenen ilk dil */
export function requestLanguage(req: Pick<FastifyRequest, "headers">): PanelLanguage {
  const header = req.headers["accept-language"] ?? "";
  for (const part of header.split(",")) {
    const base = part.trim().split(";")[0]!.toLowerCase().split("-")[0];
    if (isPanelLanguage(base)) return base;
  }
  return panelLanguage();
}

let cached: { at: number; lng: PanelLanguage } | null = null;
/** İstek dışı metinlerin dili: yöneticinin seçtiği dil (tek kullanıcılı panel) */
export function panelLanguage(): PanelLanguage {
  if (cached && Date.now() - cached.at < 10_000) return cached.lng;
  const env = process.env.PANEL_LANGUAGE;
  let lng: PanelLanguage = isPanelLanguage(env) ? env : "en";
  try {
    const u = db.select({ language: schema.users.language }).from(schema.users).orderBy(schema.users.id).limit(1).get();
    if (isPanelLanguage(u?.language)) lng = u.language;
  } catch {
    /* tablo henüz yoksa varsayılan */
  }
  cached = { at: Date.now(), lng };
  return lng;
}
export const invalidatePanelLanguage = () => {
  cached = null;
};

/** Panelin dilinde (bildirim, log, kayıtlı hata metni) */
export const pt = (keyOrText: string, params?: Params) => translate(panelLanguage(), keyOrText, params);

/**
 * Yakalanan hatanın metni panelin dilinde. HttpError anahtar taşır ("errors:…"); kaydedilen ya da
 * bildirimle giden hata metinleri anahtar olarak kalmasın diye burada çevrilir.
 */
export const errorText = (err: unknown) =>
  pt((err as Error)?.message ?? String(err), (err as { params?: Params } | null)?.params);

/** İsteğin dilinde (route içinde doğrudan gönderilen metinler) */
export const rt = (req: Pick<FastifyRequest, "headers">, keyOrText: string, params?: Params) => translate(requestLanguage(req), keyOrText, params);

/** Dilin tarih biçimi (tr-TR / en-US) */
export const localeOf = (lng: PanelLanguage) => (lng === "tr" ? "tr-TR" : "en-US");
/** Panel dilinde, panelin saat diliminde tarih + saat */
export const panelDateTime = (d: Date | number | string) =>
  new Date(d).toLocaleString(localeOf(panelLanguage()), { timeZone: config.timezone });
/** Panel dilinde, panelin saat diliminde tarih */
export const panelDate = (d: Date | number | string) =>
  new Date(d).toLocaleDateString(localeOf(panelLanguage()), { timeZone: config.timezone });
