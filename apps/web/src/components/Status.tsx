import { useEffect, useId, useRef, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { t } from "../i18n";

/** Durum tonları (renk anlamı tüm panelde sabit; bkz. DESIGN.md) */
export type Tone = "success" | "info" | "warning" | "danger" | "neutral" | "special";
/** Rengin yanında şekil: renk görmeyen de durumu ayırt etsin */
export type DotShape = "dot" | "hollow" | "spin" | "x" | "pause";

function Mark({ shape }: { shape: DotShape }) {
  switch (shape) {
    case "spin":
      return <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />;
    case "hollow":
      return <span className="size-[7px] rounded-full ring-[1.5px] ring-current ring-inset" aria-hidden />;
    case "x":
      return (
        <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "pause":
      return (
        <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
          <path d="M2.5 1.5v5M5.5 1.5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span className="size-[7px] rounded-full bg-current" aria-hidden />;
  }
}

export function StatusBadge({ tone, shape = "dot", label, title }: { tone: Tone; shape?: DotShape; label: ReactNode; title?: string }) {
  return (
    <span className={`status tone-${tone}`} title={title}>
      <Mark shape={shape} />
      {label}
    </span>
  );
}

/**
 * İlk sayfa yüklemesinde başlığa odaklanılmaz (tarayıcı odağı doğal yerinde kalsın);
 * sonraki her sayfa geçişinde odak yeni başlığa taşınır ki ekran okuyucu ve klavye
 * kullanıcısı sayfanın değiştiğini anlasın.
 */
let firstPageRendered = false;

/** Sayfa başlığı: başlık + açıklama solda, eylemler sağda (telefonda alta iner) */
export function PageHeader({
  title,
  description,
  actions,
  back,
  docTitle,
  flush,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  /** Sekme başlığı; `title` metin değilse verilir */
  docTitle?: string;
  /** Alt boşluk yok (sayfa kendi aralığını veriyor) */
  flush?: boolean;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const tabTitle = docTitle ?? (typeof title === "string" ? title : undefined);

  useEffect(() => {
    if (tabTitle) document.title = `${tabTitle} · ${t("appName")}`;
  }, [tabTitle]);

  useEffect(() => {
    if (firstPageRendered) h1.current?.focus({ preventScroll: true });
    // Bayrak bir kare sonra açılır: StrictMode'un çift effect çağrısı ilk yüklemede odak çalmasın
    else requestAnimationFrame(() => (firstPageRendered = true));
  }, []);

  return (
    <div className={flush ? "" : "mb-6"}>
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 ref={h1} id={id} tabIndex={-1} className="page-title outline-none">
            {title}
          </h1>
          {description && <p className="page-desc">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>}
      </div>
    </div>
  );
}

/** Boş durum: ne olduğu + ne yapılacağı */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-1 grid size-10 place-items-center rounded-lg bg-raised text-subtle ring-1 ring-line ring-inset">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Yükleniyor iskeleti: son içeriğin şekline yakın satırlar */
export function SkeletonRows({ rows = 3, className = "h-16" }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={t("states.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton ${className}`} />
      ))}
    </div>
  );
}

/** Sayfa düzeyinde hata: ne oldu + tekrar dene */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice notice-danger" role="alert">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t("states.loadFailed")}</div>
        <div className="mt-0.5 text-danger/80">{(error as Error)?.message ?? String(error)}</div>
      </div>
      {onRetry && (
        <button className="btn-secondary btn-sm" onClick={onRetry}>
          {t("actions.retry")}
        </button>
      )}
    </div>
  );
}
