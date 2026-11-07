import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

/**
 * Kısa bildirimler (kaydedildi, kopyalandı ...). Odak çalmaz, 4 sn sonra kendiliğinden kapanır;
 * ekran okuyucuya kibarca (polite) okunur. Her yerden çağrılabilir:
 *   toast("Ayarlar kaydedildi");
 *   toast("Yeniden başlatılıyor", "info");
 * <ToastHost /> uygulamanın kökünde bir kez bulunur.
 */

export type ToastTone = "success" | "info" | "warning" | "danger";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION = 4000;
let toasts: ToastEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function toast(message: string, tone: ToastTone = "success") {
  // En fazla 3 bildirim üst üste; eskisi düşer
  toasts = [...toasts.slice(-2), { id: nextId++, message, tone }];
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const toneIcon: Record<ToastTone, { Icon: typeof Info; cls: string }> = {
  success: { Icon: CheckCircle2, cls: "text-success" },
  info: { Icon: Info, cls: "text-info" },
  warning: { Icon: AlertTriangle, cls: "text-warning" },
  danger: { Icon: AlertTriangle, cls: "text-danger" },
};

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  // Canlı bölge her zaman sayfada durur; içerik değişince okunur
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-70 flex flex-col items-center gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
    >
      {list.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastItem({ t }: { t: ToastEntry }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), DURATION);
    return () => clearTimeout(timer);
  }, [t.id]);
  const { Icon, cls } = toneIcon[t.tone];
  return (
    <div className="anim-fade flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-line bg-overlay px-4 py-3 text-sm text-fg shadow-pop">
      <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden />
      <span className="min-w-0 text-pretty wrap-anywhere">{t.message}</span>
    </div>
  );
}
