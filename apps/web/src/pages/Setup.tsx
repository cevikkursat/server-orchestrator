import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SetupStartResult } from "@panel/shared";
import { api } from "../lib/api";
import { AuthCard, FormError } from "../components/AuthCard";
import { Check, Copy } from "lucide-react";
import { copy } from "../lib/ops";
import { t } from "../i18n";

export function SetupPage() {
  const qc = useQueryClient();
  const [setupToken, setSetupToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<SetupStartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function start(e: FormEvent) {
    e.preventDefault();
    if (password !== password2) return setError(t("auth:setup.mismatch"));
    run(async () => setQr(await api.post<SetupStartResult>("/api/auth/setup/start", { setupToken, username, password })));
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api.post("/api/auth/setup/verify", { setupToken, code });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
    });
  }

  if (qr) {
    const grouped = qr.secret.replace(/(.{4})(?=.)/g, "$1 ");
    return (
      <AuthCard
        title={t("auth:setup.totp.title")}
        subtitle={t("auth:setup.totp.subtitle")}
      >
        <form onSubmit={verify} className="space-y-4">
          <div className="flex flex-col items-stretch gap-4 min-[421px]:flex-row min-[421px]:items-center">
            {/* QR kodu açık zeminde okunur; tek beyaz yüzey bu */}
            <img src={qr.qrDataUrl} alt={t("auth:setup.totp.qrAlt")} className="size-[132px] shrink-0 self-center rounded-md bg-fg p-2" width={132} height={132} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs text-muted">{t("auth:setup.totp.manualKey")}</span>
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-line-soft bg-canvas py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 font-mono text-xs leading-5 tracking-[0.08em] break-all text-fg/85">{grouped}</code>
                <button
                  type="button"
                  className="btn-icon"
                  title={t("actions.copy")}
                  aria-label={t("auth:setup.totp.copyKey")}
                  onClick={() => {
                    copy(qr.secret);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                </button>
              </div>
              <span className="text-xs text-muted">
                {t("auth:setup.totp.accountName")} <span className="font-mono text-fg">{username}</span>
              </span>
            </div>
          </div>
          <label className="block">
            <span className="label">{t("auth:setup.totp.code")}</span>
            <input
              className="input text-center font-mono tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </label>
          <FormError message={error} />
          <button className="btn w-full" disabled={busy || code.length !== 6}>
            {busy ? t("auth:setup.totp.verifying") : t("auth:setup.totp.verify")}
          </button>
          <p className="text-xs text-pretty text-muted">
            {t("auth:setup.totp.lostBefore")} <span className="font-mono text-fg">reset-admin</span> {t("auth:setup.totp.lostAfter")}
          </p>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth:setup.title")} subtitle={t("auth:setup.subtitle")}>
      <form onSubmit={start} className="space-y-4">
        <div>
          <label className="block">
<span className="label">{t("auth:setup.token")}</span>
          <input className="input font-mono" value={setupToken} onChange={(e) => setSetupToken(e.target.value.trim())} autoFocus />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("auth:setup.username")}</span>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("auth:setup.password")}</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("auth:setup.password2")}</span>
          <input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
</label>
        </div>
        <FormError message={error} />
        <button className="btn w-full" disabled={busy || !setupToken || !username || password.length < 12}>
          {t("auth:setup.continue")}
        </button>
      </form>
    </AuthCard>
  );
}
