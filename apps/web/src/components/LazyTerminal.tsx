import { lazy, Suspense } from "react";
import { t } from "../i18n";

// xterm.js büyük; sadece terminal sekmesi açılınca yüklensin
const TerminalImpl = lazy(() => import("./Terminal").then((m) => ({ default: m.Terminal })));

export function Terminal({ containerId }: { containerId: string }) {
  return (
    <Suspense fallback={<div className="card text-sm text-subtle">{t("containers:terminal.loading")}</div>}>
      <TerminalImpl containerId={containerId} />
    </Suspense>
  );
}
