import { intlLocale, t } from "../i18n";

/**
 * Seçili dile göre sayı, tarih ve süre biçimleri. Ekranlarda "tr-TR" gibi sabit bölge
 * kodu yazılmaz; hep bu yardımcılar kullanılır.
 */

/** Sabit ondalıklı sayı: fmtNumber(0.5, 1) → "0,5" (tr) / "0.5" (en) */
export const fmtNumber = (v: number, digits = 0) =>
  v.toLocaleString(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Yüzde: Türkçede "%12", İngilizcede "12%" */
export const fmtPercent = (v: number, digits = 0) =>
  new Intl.NumberFormat(intlLocale(), { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v / 100);

export const fmtDate = (ts: number | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Date(ts).toLocaleDateString(intlLocale(), opts);

export const fmtDateTime = (ts: number | Date, opts?: Intl.DateTimeFormatOptions) => new Date(ts).toLocaleString(intlLocale(), opts);

export const fmtTime = (ts: number | Date, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) =>
  new Date(ts).toLocaleTimeString(intlLocale(), opts);

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutesAgo", { count: Math.floor(s / 60) });
  if (s < 86400) return t("time.hoursAgo", { count: Math.floor(s / 3600) });
  return t("time.daysAgo", { count: Math.floor(s / 86400) });
}

export function duration(start: number | null, end: number | null) {
  if (!start) return "—";
  const s = Math.round(((end ?? Date.now()) - start) / 1000);
  return s < 60 ? t("time.seconds", { count: s }) : t("time.minutesSeconds", { m: Math.floor(s / 60), s: s % 60 });
}

export function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && t("time.uptimeD", { count: d }), h && t("time.uptimeH", { count: h }), t("time.uptimeM", { count: m })].filter(Boolean).join(" ");
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${fmtNumber(v, i === 0 ? 0 : 1)} ${units[i]}`;
}
