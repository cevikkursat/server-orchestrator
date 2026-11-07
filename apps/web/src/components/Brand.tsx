import { t } from "../i18n";

/** "Raf yıldızı" işareti: üç sunucu katı, üstteki katın ışığı amber. favicon.svg ile aynı çizim. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="14" fill="#0b1020" stroke="#1f2a44" strokeWidth="2" />
      <rect x="13" y="16" width="38" height="8" rx="4" fill="#e8ecf6" opacity=".9" />
      <rect x="13" y="28" width="38" height="8" rx="4" fill="#e8ecf6" opacity=".9" />
      <rect x="13" y="40" width="38" height="8" rx="4" fill="#e8ecf6" opacity=".9" />
      <circle cx="45" cy="20" r="3" fill="#f0b44c" />
      <circle cx="45" cy="32" r="3" fill="#0b1020" />
      <circle cx="45" cy="44" r="3" fill="#0b1020" />
    </svg>
  );
}

/** Logo + yazı: kenar çubuğu ve giriş kartı */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="text-[15px] leading-tight font-bold tracking-[-0.005em] text-fg">{t("appName")}</div>
    </div>
  );
}
