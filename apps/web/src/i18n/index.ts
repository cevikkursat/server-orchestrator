import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { tr, type Messages } from "../locales/tr";
import { en } from "../locales/en";
import { validationMessages } from "@panel/shared";

/**
 * Dil desteği (i18next).
 *
 * - Kaynak dil Türkçe: `locales/tr/<alan>.ts`. Diğer diller aynı anahtarları taşımak zorunda
 *   (`satisfies Shape<…>`), eksik anahtar derlemede hata verir.
 * - Çoğul anahtarlar her dilde `_one` / `_other` ekiyle yazılır.
 * - Yeni dil: `locales/<kod>/` klasörünü `en`'den kopyala, çevir, aşağıdaki `resources`
 *   ve `languages` listesine ekle.
 * - Bileşen dışındaki kod da (durum etiketleri, zaman biçimleri) `t`'yi doğrudan kullanır;
 *   dil değişince uygulama yeniden çizilir (bkz. main.tsx'teki LanguageRoot).
 */
export const languages = ["tr", "en"] as const;
export type Language = (typeof languages)[number];

const STORAGE_KEY = "panel.lang";

/** Kayıtlı seçim → tarayıcı dili → İngilizce */
function detect(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (languages as readonly string[]).includes(saved)) return saved as Language;
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.toLowerCase().split("-")[0];
    if ((languages as readonly string[]).includes(base!)) return base as Language;
  }
  return "en";
}

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: Messages & { validation: typeof validationMessages.tr };
  }
}

void i18n.use(initReactI18next).init({
  resources: { tr: { ...tr, validation: validationMessages.tr }, en: { ...en, validation: validationMessages.en } },
  lng: detect(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: [...Object.keys(tr), "validation"],
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = i18n.language;

export const t = i18n.t.bind(i18n);
export const currentLanguage = () => i18n.language as Language;

/** Intl biçimleri için bölge kodu */
export const intlLocale = () => ({ tr: "tr-TR", en: "en-US" })[currentLanguage()] ?? "en-US";

type Listener = (l: Language) => void;
const listeners = new Set<Listener>();
/** Dil değişince (ör. oturum açınca sunucudaki tercih gelince) haber ver */
export function onLanguageSaved(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Dili değiştir. `persist` true ise (kullanıcı seçti) oturum açıksa sunucuya da yazılır;
 * bildirimler ve sunucu mesajları da bu dilde gelir.
 */
export async function setLanguage(l: Language, persist = true) {
  localStorage.setItem(STORAGE_KEY, l);
  document.documentElement.lang = l;
  await i18n.changeLanguage(l);
  if (persist) listeners.forEach((fn) => fn(l));
}

export default i18n;
