import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useOverlay } from "./overlay";
import { t } from "../i18n";

/**
 * Panelin kendi onay / bilgi pencereleri (tarayıcının confirm/alert/prompt kutuları yerine).
 * Her yerden çağrılabilir; Promise döner:
 *   if (!(await confirmDialog({ title: "Silinsin mi?", danger: true }))) return;
 *   await alertDialog({ title: "Hata", message: err.message, tone: "error" });
 * <DialogHost /> uygulamanın kökünde bir kez bulunur.
 */

type Tone = "info" | "success" | "error" | "warning";

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Kırmızı onay butonu (silme vb.) */
  danger?: boolean;
  /** Onaylamak için bu metnin yazılması gerekir (geri dönüşü olmayan işlemler) */
  typeToConfirm?: string;
}
interface AlertOptions {
  title: string;
  message?: ReactNode;
  tone?: Tone;
  okLabel?: string;
}

type Entry =
  | ({ id: number; kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOptions)
  | ({ id: number; kind: "alert"; resolve: () => void } & AlertOptions);

// Basit kuyruk: aynı anda tek pencere, sıradakiler arkadan gelir
let queue: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: nextId++, kind: "confirm", resolve }];
    emit();
  });
}

export function alertDialog(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: nextId++, kind: "alert", resolve }];
    emit();
  });
}

/** Hata mesajını pencerede göster (catch bloklarında kısa yol) */
export const showError = (err: unknown, title: string = t("errors.actionFailed")) =>
  alertDialog({ title, message: err instanceof Error ? err.message : String(err), tone: "error" });

function close(e: Entry, value: boolean) {
  queue = queue.filter((x) => x.id !== e.id);
  emit();
  if (e.kind === "confirm") e.resolve(value);
  else e.resolve();
}

const toneIcon: Record<Tone, { Icon: typeof Info; cls: string }> = {
  info: { Icon: Info, cls: "text-info bg-info/10" },
  success: { Icon: CheckCircle2, cls: "text-success bg-success/10" },
  error: { Icon: AlertTriangle, cls: "text-danger bg-danger/10" },
  warning: { Icon: AlertTriangle, cls: "text-warning bg-warning/10" },
};

export function DialogHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  if (!current) return null;
  return <Dialog key={current.id} e={current} />;
}

function Dialog({ e }: { e: Entry }) {
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isConfirm = e.kind === "confirm";
  const needsText = isConfirm && !!e.typeToConfirm;
  const canConfirm = !needsText || typed === e.typeToConfirm;
  const tone: Tone = isConfirm ? (e.danger ? "error" : "warning") : (e.tone ?? "info");
  const { Icon, cls } = toneIcon[tone];

  const formRef = useRef<HTMLFormElement>(null);
  // Odak içeri / geri, Tab tuzağı, Escape (sadece en üst katman), arka plan kilidi
  useOverlay(formRef, () => close(e, false), { initialFocus: needsText ? inputRef : confirmRef });

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-black/65" onClick={() => close(e, false)} aria-hidden />
      <form
        ref={formRef}
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`dlg-${e.id}-title`}
        className="anim-pop relative w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-pop"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (canConfirm) close(e, true);
        }}
      >
        <button type="button" className="btn-icon absolute top-2 right-2" onClick={() => close(e, false)} aria-label={t("actions.close")}>
          <X className="size-4" />
        </button>
        <div className="flex gap-3 pr-6">
          <div className={`grid size-9 shrink-0 place-items-center rounded-full ${cls}`}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={`dlg-${e.id}-title`} className="font-semibold">
              {e.title}
            </h2>
            {e.message && <div className="mt-1.5 text-sm break-words whitespace-pre-line text-muted">{e.message}</div>}
            {needsText && (
              <div className="mt-4">
                <label className="block">
<span className="label">
                  {t("dialog.typeToConfirmBefore")}
                  <span className="font-mono text-fg">{e.typeToConfirm}</span>
                  {t("dialog.typeToConfirmAfter")}
                </span>
                <input ref={inputRef} className="input font-mono" value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" spellCheck={false} />
</label>
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {isConfirm && (
            <button type="button" className="btn-secondary" onClick={() => close(e, false)}>
              {e.cancelLabel ?? t("actions.cancel")}
            </button>
          )}
          <button
            ref={confirmRef}
            type="submit"
            disabled={!canConfirm}
            className={isConfirm && e.danger ? "btn-danger-solid" : "btn"}
          >
            {isConfirm ? (e.confirmLabel ?? t("actions.confirm")) : (e.okLabel ?? t("actions.ok"))}
          </button>
        </div>
      </form>
    </div>
  );
}
