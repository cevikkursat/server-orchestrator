import type { ReactNode } from "react";
import { BrandMark } from "./Brand";
import { LanguageButton } from "./LanguageSelect";
import { t } from "../i18n";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center p-4">
      <LanguageButton placement="down" className="absolute top-4 right-4 pt-[env(safe-area-inset-top)]" />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <BrandMark size={40} />
          <div className="text-base leading-tight font-bold tracking-[-0.005em]">{t("appName")}</div>
        </div>
        <div className="card p-6 sm:p-7">
          <h1 className="text-xl font-bold tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="notice notice-danger py-2.5">{message}</p>;
}
