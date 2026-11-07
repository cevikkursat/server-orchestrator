import { useEffect, useRef, type ReactNode } from "react";

/**
 * Sayfa sekmeleri. Alt çizgi taşma yapmadan (iç gölgeyle) çizilir; dar ekranda yatay kayar ama
 * kaydırma çubuğu görünmez, seçili sekme görünür alana getirilir.
 */
export function TabBar<T extends string>({ tabs, value, onChange, className = "" }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; className?: string }) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div role="tablist" className={`no-scrollbar flex gap-0.5 overflow-x-auto overflow-y-hidden pr-6 shadow-[inset_0_-1px_0_var(--color-line)] [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] md:pr-0 md:[mask-image:none] ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={t.id === value ? active : undefined}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={`relative flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 md:min-h-10 ${
            t.id === value
              ? "font-semibold text-fg after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent"
              : "text-muted hover:text-fg"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
