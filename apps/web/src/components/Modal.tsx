import { useId, useRef, type ReactNode } from "react";
import { useOverlay } from "../lib/overlay";
import { X } from "lucide-react";
import { t } from "../i18n";

/** Panelin genel pencere bileşeni (form / düzenleyici içerikli) */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Odak içeri / geri, Tab tuzağı, Escape (sadece en üst katman), arka plan kilidi
  useOverlay(ref, onClose);

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-black/65" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`anim-sheet sm:anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop sm:rounded-xl sm:pb-0 ${wide ? "sm:max-w-4xl" : "sm:max-w-xl"}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line py-2 pr-2 pl-5">
          <h2 id={titleId} className="min-w-0 truncate font-semibold">{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t("actions.close")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}
