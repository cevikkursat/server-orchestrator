import validationTr from "./locales/validation.tr";
import validationEn from "./locales/validation.en";

/** Panelin desteklediği diller (web ve API aynı listeyi kullanır) */
export const panelLanguages = ["tr", "en"] as const;
export type PanelLanguage = (typeof panelLanguages)[number];
export const isPanelLanguage = (v: unknown): v is PanelLanguage => typeof v === "string" && (panelLanguages as readonly string[]).includes(v);

/** Ortak doğrulama mesajları: i18next'e "validation" ad alanı olarak eklenir */
export const validationMessages = { tr: validationTr, en: validationEn };
export type { Shape } from "./locales/types";
