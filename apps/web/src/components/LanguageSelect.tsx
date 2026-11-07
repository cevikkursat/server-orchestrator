import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Globe } from "lucide-react";
import { languages, setLanguage, t, currentLanguage, type Language } from "../i18n";

/** Dil adları her zaman kendi dilinde yazılır (Türkçe, English) */
const name = (l: Language) => t(`language.${l}`);

/** Ayarlar sayfası: etiketli açılır liste */
export function LanguageSelect({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex items-center gap-2 text-xs text-muted ${className}`}>
      <span className={compact ? "sr-only" : ""}>{t("language.label")}</span>
      <select id={id} className="input min-h-9 w-auto py-1 text-xs md:min-h-8" value={currentLanguage()} onChange={(e) => void setLanguage(e.target.value as Language)}>
        {languages.map((l) => (
          <option key={l} value={l}>
            {name(l)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Küçük dil düğmesi (dünya simgesi + "TR"): yan menünün kullanıcı satırında ve giriş ekranının
 * köşesinde. Tıklayınca kısa bir liste açılır; ok tuşları, Escape ve dışarı tıklama çalışır.
 * placement: listenin düğmenin üstünde mi altında mı açılacağı.
 */
export function LanguageButton({ placement = "up", className = "" }: { placement?: "up" | "down"; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = currentLanguage();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    // Açılınca seçili dile odaklan
    requestAnimationFrame(() => items.current[Math.max(0, languages.indexOf(current))]?.focus());
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, current]);

  function close(focusButton = true) {
    setOpen(false);
    if (focusButton) button.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    const i = items.current.findIndex((el) => el === document.activeElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: languages.length - 1 }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (next !== undefined) {
      e.preventDefault();
      items.current[(next + languages.length) % languages.length]?.focus();
    }
  }

  // className konum verirse (absolute) o geçerli; yoksa relative: menü düğmeye göre konumlanır
  return (
    <div ref={wrap} className={className.includes("absolute") ? className : `relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t("language.label")}: ${name(current)}`}
        title={t("language.label")}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border px-2 font-mono text-xs font-semibold uppercase transition-colors duration-150 md:min-h-8 ${
          open ? "border-accent/50 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg"
        }`}
      >
        <Globe className="size-3.5" aria-hidden />
        {current}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("language.label")}
          onKeyDown={onMenuKey}
          className={`anim-fade absolute right-0 z-40 min-w-40 rounded-lg border border-line-strong bg-overlay p-1 shadow-pop ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          <div className="cap px-2.5 pt-1.5 pb-1">{t("language.label")}</div>
          {languages.map((l, i) => (
            <button
              key={l}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={l === current}
              lang={l}
              onClick={() => {
                close();
                if (l !== current) void setLanguage(l);
              }}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover md:min-h-9 ${
                l === current ? "font-semibold text-accent" : "text-fg"
              }`}
            >
              {name(l)}
              {l === current && <span className="dot bg-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Telefon "Diğer" sayfasındaki satır: "Dil · Türkçe ›". Dokununca telefonun kendi seçicisi
 * açılır (görünmez bir select satırın tamamını kaplar).
 */
export function LanguageRow({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <div className={`relative flex min-h-11 items-center justify-between rounded-lg border border-line bg-surface px-3 text-sm ${className}`}>
      <label htmlFor={id} className="flex items-center gap-2.5 text-muted">
        <Globe className="size-4" aria-hidden />
        {t("language.label")}
      </label>
      <span className="flex items-center gap-1 text-fg" aria-hidden>
        {name(currentLanguage())}
        <ChevronRight className="size-4 text-subtle" />
      </span>
      <select
        id={id}
        className="absolute inset-0 cursor-pointer opacity-0"
        value={currentLanguage()}
        onChange={(e) => void setLanguage(e.target.value as Language)}
      >
        {languages.map((l) => (
          <option key={l} value={l}>
            {name(l)}
          </option>
        ))}
      </select>
    </div>
  );
}
