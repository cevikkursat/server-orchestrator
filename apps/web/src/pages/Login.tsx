import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AuthCard, FormError } from "../components/AuthCard";
import { t } from "../i18n";

export function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { username, password, code });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("auth:login.title")}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block">
<span className="label">{t("auth:login.username")}</span>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("auth:login.password")}</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
</label>
        </div>
        <div>
          <label className="block">
<span className="label">{t("auth:login.code")}</span>
          <input
            className="input text-center font-mono tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
</label>
        </div>
        <FormError message={error} />
        <button className="btn w-full" disabled={busy || !username || !password || code.length !== 6}>
          {busy ? t("auth:login.submitting") : t("auth:login.submit")}
        </button>
      </form>
    </AuthCard>
  );
}
