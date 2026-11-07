import { Fragment, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthStatus } from "@panel/shared";
import { api } from "../lib/api";
import { languages, onLanguageSaved, setLanguage, type Language } from "../i18n";
import { useAuthStatus } from "../lib/auth";

/**
 * Dil değişince bütün ağaç yeniden çizilir (bileşen dışındaki etiketler de güncellensin).
 * Sorgu önbelleği bu bileşenin dışında olduğundan veriler kaybolmaz.
 * Oturum açıkken: sunucudaki tercih uygulanır; kullanıcı dili değiştirince sunucuya yazılır
 * (bildirimler ve sunucu mesajları da o dilde gelir).
 */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const { data } = useAuthStatus();
  const saved = data?.user?.language;

  useEffect(() => {
    if (saved && saved !== i18n.language && (languages as readonly string[]).includes(saved)) void setLanguage(saved as Language, false);
    // Yalnız sunucudaki tercih değişince
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  useEffect(
    () =>
      onLanguageSaved((language) => {
        const status = qc.getQueryData<AuthStatus>(["auth-status"]);
        if (!status?.authenticated) return;
        void api.put("/api/auth/language", { language }).then(() => qc.invalidateQueries({ queryKey: ["auth-status"] }));
      }),
    [qc],
  );

  return <Fragment key={i18n.language}>{children}</Fragment>;
}
