import { useEffect, useRef, type RefObject } from "react";

/**
 * Üst üste açılan katmanlar (pencere, onay kutusu, telefon alt sayfası) için ortak davranış:
 * - açılınca odak katmanın içine gider, kapanınca açan öğeye geri döner
 * - Tab katmanın dışına çıkmaz
 * - Escape sadece en üstteki katmanı kapatır
 * - arka plan kaymaz (iç içe açılsa da kilit doğru sayılır)
 */
const stack: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = "";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: { initialFocus?: RefObject<HTMLElement | null> } = {}) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol("overlay");
    stack.push(id);
    const before = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    // İlk odak: istenen öğe, yoksa ilk alan / buton, yoksa katmanın kendisi
    const el = ref.current;
    const target = opts.initialFocus?.current ?? el?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    if (el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(id), 1);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      // Açan öğe hâlâ sayfadaysa odağı ona geri ver
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
