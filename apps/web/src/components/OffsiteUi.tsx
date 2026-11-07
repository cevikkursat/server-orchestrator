import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudOff, Copy, DownloadCloud, Eye, Loader2, Mail, RefreshCw } from "lucide-react";
import type { BackupEntry, OffsiteObject, OffsiteSettingsInput, OffsiteStatus } from "@panel/shared";
import { api, formatBytes } from "../lib/api";
import { copy } from "../lib/ops";
import { timeAgo } from "../lib/projects";
import { toast } from "../lib/toast";
import { alertDialog, confirmDialog, showError } from "../lib/dialog";
import { FormError } from "./AuthCard";
import { Dot, Panel, cmdBox, lede, panelBody } from "./MaintenanceUi";
import { t } from "../i18n";
import { fmtDateTime } from "../lib/format";

export const useOffsite = () =>
  useQuery({
    queryKey: ["offsite"],
    queryFn: () => api.get<OffsiteStatus>("/api/offsite"),
    refetchInterval: (q) => (q.state.data && q.state.data.pending > 0 ? 3000 : 30_000),
  });

/** Yedek listesindeki bulut simgesi (dar yerler için) */
export function RemoteBadge({ b }: { b: BackupEntry }) {
  if (!b.remoteStatus) return null;
  const map = {
    pending: { Icon: Cloud, cls: "text-subtle", tip: t("backups:remote.pending") },
    uploading: { Icon: Loader2, cls: "animate-spin text-info", tip: t("backups:remote.uploading") },
    uploaded: {
      Icon: Cloud,
      cls: "text-success",
      tip: b.remoteAt ? t("backups:remote.uploadedAt", { time: fmtDateTime(b.remoteAt) }) : t("backups:remote.uploaded"),
    },
    failed: { Icon: CloudOff, cls: "text-danger", tip: t("backups:remote.failed", { error: b.remoteError ?? "" }) },
  } as const;
  const { Icon, cls, tip } = map[b.remoteStatus];
  return (
    <span title={tip} className="inline-flex">
      <Icon className={`size-3.5 ${cls}`} />
    </span>
  );
}

/** Yedek listesindeki "Sunucu dışı" sütunu: ince çerçeveli etiket (bulut / sırada / gönderilemedi) */
export function RemoteTag({ b }: { b: BackupEntry }) {
  if (!b.remoteStatus) return <span className="text-muted">—</span>;
  const base = "inline-flex h-[22px] items-center gap-1.5 rounded-sm border px-2 text-[11px] font-medium whitespace-nowrap";
  switch (b.remoteStatus) {
    case "uploaded":
      return (
        <span className={`${base} border-success/30 text-success`} title={b.remoteAt ? fmtDateTime(b.remoteAt) : undefined}>
          <Cloud className="size-3" aria-hidden /> {t("backups:remote.tagUploaded")}
        </span>
      );
    case "uploading":
      return (
        <span className={`${base} border-info/30 text-info`}>
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> {t("backups:remote.tagUploading")}
        </span>
      );
    case "failed":
      return (
        <span className={`${base} border-danger/35 text-danger`} title={b.remoteError ?? undefined}>
          <Dot level="danger" /> {t("backups:remote.tagFailed")}
        </span>
      );
    default:
      return (
        <span className={`${base} border-line text-muted`}>
          <Dot level="none" /> {t("backups:remote.tagQueued")}
        </span>
      );
  }
}

const empty: OffsiteSettingsInput = {
  enabled: true,
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  prefix: "panel-backups/",
  retentionDays: 30,
};

export function OffsiteCard() {
  const qc = useQueryClient();
  const { data } = useOffsite();
  const [form, setForm] = useState<OffsiteSettingsInput>(empty);
  const [importKey, setImportKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [showObjects, setShowObjects] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm({ ...empty, ...data.settings, secretAccessKey: "" });
  }, [data?.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<OffsiteSettingsInput>) => {
    setForm((f) => ({ ...f, ...p }));
    setTestMsg(null);
  };
  const body = () => ({ ...form, key: importKey ? form.key : undefined, keyPassphrase: importKey ? form.keyPassphrase : undefined });

  async function test() {
    setBusy("test");
    setError(null);
    setTestMsg(null);
    try {
      await api.post("/api/offsite/test", body());
      setTestMsg(t("backups:offsite.testOk"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const first = !data?.keyFingerprint && !importKey;
    setBusy("save");
    setError(null);
    try {
      await api.put("/api/offsite", body());
      setImportKey(false);
      await qc.invalidateQueries({ queryKey: ["offsite"] });
      qc.invalidateQueries({ queryKey: ["backups"] });
      if (first) {
        void alertDialog({
          title: t("backups:offsite.keyCreated.title"),
          message: t("backups:offsite.keyCreated.message"),
          tone: "warning",
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    await api.post("/api/offsite/retry").catch(showError);
    qc.invalidateQueries({ queryKey: ["offsite"] });
    qc.invalidateQueries({ queryKey: ["backups"] });
  }

  const complete = form.endpoint && form.bucket && form.accessKeyId && (form.secretAccessKey || data?.hasSecret);

  const aside = !data ? null : !data.configured ? (
    <span className="flex items-center gap-2 text-warning">
      <Dot level="warning" /> {t("backups:offsite.notConfigured")}
    </span>
  ) : (
    <span className="flex items-center gap-2">
      <Dot level={data.settings?.enabled ? (data.failed ? "danger" : "ok") : "none"} />
      <span className={data.settings?.enabled ? "text-fg" : ""}>{data.settings?.enabled ? t("backups:offsite.on") : t("backups:offsite.off")}</span>
      {data.pending > 0 && <span className="text-warning">{t("backups:offsite.queued", { count: data.pending })}</span>}
      {data.pending === 0 && data.lastUploadAt && <span>{t("backups:offsite.lastUpload", { time: timeAgo(data.lastUploadAt) })}</span>}
    </span>
  );

  return (
    <Panel
      id="dis-kopya"
      title={t("backups:offsite.title")}
      aside={aside}
      footer={
        <>
          <button className="btn-secondary max-sm:flex-1" disabled={!complete || busy !== null} onClick={test}>
            {busy === "test" && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />} {t("backups:offsite.test")}
          </button>
          <button
            className="btn-secondary max-sm:flex-1"
            disabled={!complete || busy !== null || (importKey && (!form.key || (form.key.startsWith("PNLKEY1.") && !form.keyPassphrase)))}
            onClick={save}
          >
            {busy === "save" ? t("actions.saving") : t("actions.save")}
          </button>
          {data?.configured && (
            <button className="btn-ghost sm:ml-auto max-sm:w-full max-sm:justify-center" aria-expanded={showObjects} onClick={() => setShowObjects((v) => !v)}>
              <Cloud className="size-4" aria-hidden /> {t("backups:offsite.remoteBackups")} {showObjects ? "↑" : "→"}
            </button>
          )}
        </>
      }
    >
      <div className={panelBody}>
        <p className={lede}>
          {t("backups:offsite.intro")}
        </p>
        {data && data.failed > 0 && (
          <div className="flex items-start gap-2.5 rounded-md border border-danger/35 bg-danger/[0.05] px-3.5 py-2.5 text-xs leading-[18px] text-danger" role="alert">
            <Dot level="danger" className="mt-1.5" />
            <span>
              <b className="font-semibold text-fg">{t("backups:offsite.failed", { count: data.failed })}</b> {t("backups:offsite.failedReason")}{" "}
              <button type="button" className="min-h-8 underline underline-offset-2 hover:text-fg" onClick={retry}>
                {t("actions.retry")}
              </button>
            </span>
          </div>
        )}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block min-w-0 sm:col-span-2">
            <span className="label">{t("backups:offsite.endpoint")}</span>
            <input
              className="input font-mono text-xs"
              value={form.endpoint}
              onChange={(e) => set({ endpoint: e.target.value })}
              placeholder={t("backups:offsite.endpointPlaceholder")}
            />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.bucket")}</span>
            <input className="input font-mono text-xs" value={form.bucket} onChange={(e) => set({ bucket: e.target.value.trim() })} placeholder={t("backups:offsite.bucketPlaceholder")} />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.region")}</span>
            <input className="input font-mono text-xs" value={form.region} onChange={(e) => set({ region: e.target.value.trim() })} />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.accessKey")}</span>
            <input className="input font-mono text-xs" value={form.accessKeyId} onChange={(e) => set({ accessKeyId: e.target.value.trim() })} autoComplete="off" />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.secretKey")}</span>
            <input
              className="input font-mono text-xs"
              type="password"
              value={form.secretAccessKey}
              onChange={(e) => set({ secretAccessKey: e.target.value.trim() })}
              placeholder={data?.hasSecret ? t("backups:offsite.secretSaved") : ""}
              autoComplete="new-password"
            />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.prefix")}</span>
            <input className="input font-mono text-xs" value={form.prefix} onChange={(e) => set({ prefix: e.target.value.trim() })} />
          </label>
          <label className="block min-w-0">
            <span className="label">{t("backups:offsite.retention")}</span>
            <select className="input" value={form.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {t("backups:offsite.days", { count: d })}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col">
          <label className="check-row">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            {t("backups:offsite.enable")}
          </label>
          <label className="check-row text-muted">
            <input type="checkbox" checked={importKey} onChange={(e) => setImportKey(e.target.checked)} />
            {t("backups:offsite.importKey")}
          </label>
        </div>
        {importKey && (
          <div className="flex flex-col gap-2.5 rounded-md border border-dashed border-line p-3.5">
            <label className="block">
              <span className="label">{t("backups:offsite.keyLabel")}</span>
              <textarea
                className="input min-h-16 font-mono text-xs"
                value={form.key ?? ""}
                onChange={(e) => set({ key: e.target.value.replace(/\s+/g, "") })}
                placeholder={t("backups:offsite.keyPlaceholder")}
                spellCheck={false}
              />
            </label>
            {form.key?.startsWith("PNLKEY1.") && (
              <label className="block">
                <span className="label">{t("backups:offsite.keyPassphrase")}</span>
                <input className="input" type="password" value={form.keyPassphrase ?? ""} onChange={(e) => set({ keyPassphrase: e.target.value })} autoComplete="off" />
              </label>
            )}
          </div>
        )}

        {data?.keyFingerprint && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line px-3.5 py-3">
              <div className="min-w-[200px] flex-1">
                <div className="cap">{t("backups:offsite.keyLabel")}</div>
                <div className="text-xs text-muted">
                  {t("backups:offsite.fingerprintBefore")} <span className="font-mono text-fg">{data.keyFingerprint}</span> {t("backups:offsite.fingerprintAfter")}
                </div>
                <div className={`mt-1 flex items-center gap-2 text-xs ${data.keySaved ? "text-muted" : "text-warning"}`}>
                  <span className={`dot ${data.keySaved ? "dot-ok" : "dot-look"}`} aria-hidden />
                  {data.keySaved
                    ? `${t(`backups:offsite.savedVia.${data.keySaved.via}`)} · ${timeAgo(data.keySaved.at)}`
                    : t("backups:offsite.neverExported")}
                </div>
              </div>
              <button type="button" className="btn-secondary btn-sm max-sm:min-h-11 max-sm:flex-1" aria-expanded={revealing} aria-controls="key-reveal" onClick={() => setRevealing((v) => !v)}>
                <Eye className="size-3.5" aria-hidden /> {t("backups:offsite.show")}
              </button>
              <button type="button" className="btn-secondary btn-sm max-sm:min-h-11 max-sm:flex-1" aria-expanded={emailing} aria-controls="key-email" onClick={() => setEmailing((v) => !v)}>
                <Mail className="size-3.5" aria-hidden /> {t("backups:offsite.emailMe")}
              </button>
            </div>
            {revealing && <RevealKey />}
            {emailing && <EmailKey />}
          </>
        )}

        <details className="text-xs text-muted">
          <summary className="flex min-h-11 cursor-pointer items-center md:min-h-8 font-medium hover:text-fg">{t("backups:offsite.r2Help.title")}</summary>
          <ol className="mt-2 ml-4.5 flex list-decimal flex-col gap-1 pl-1">
            <li>{t("backups:offsite.r2Help.step1")}</li>
            <li>{t("backups:offsite.r2Help.step2")}</li>
            <li>{t("backups:offsite.r2Help.step3")}</li>
          </ol>
        </details>

        <FormError message={error} />
        {testMsg && (
          <p className="text-sm text-success" role="status">
            {testMsg}
          </p>
        )}
      </div>
      {showObjects && <RemoteObjects />}
    </Panel>
  );
}

/** 6 haneli doğrulama kodu alanı */
function OtpInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input text-center font-mono tracking-[0.4em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={6}
        placeholder="000000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </label>
  );
}

const inlineBox = "flex flex-col gap-3 rounded-md border border-dashed border-line p-3.5";

/** Anahtarı göster: önce 2FA kodu, sonra anahtar + kopyala (sunucu kodu doğrular) */
function RevealKey() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    try {
      setKey((await api.post<{ key: string }>("/api/offsite/key", { code })).key);
      qc.invalidateQueries({ queryKey: ["offsite"] });
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    }
  }
  if (key)
    return (
      <div id="key-reveal" className={inlineBox}>
        <div className={cmdBox}>
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-7 whitespace-nowrap text-fg/85 [overflow-wrap:normal]">{key}</code>
          <button
            type="button"
            className="btn-icon"
            title={t("actions.copy")}
            aria-label={t("backups:key.copyKey")}
            onClick={() => {
              copy(key);
              toast(t("backups:key.copied"));
            }}
          >
            <Copy className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-xs text-warning">
          {t("backups:key.storeWarning")}
        </p>
      </div>
    );
  return (
    <form
      id="key-reveal"
      className={inlineBox}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <OtpInput label={t("backups:key.revealCode")} value={code} onChange={setCode} autoFocus />
      <FormError message={error} />
      <div>
        <button className="btn-secondary max-sm:w-full" disabled={code.length !== 6}>
          <Eye className="size-4" aria-hidden /> {t("backups:offsite.show")}
        </button>
      </div>
    </form>
  );
}

/** Anahtarı parolayla şifreleyip bildirim e-postasına gönderir (2FA ister) */
function EmailKey() {
  const qc = useQueryClient();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ sentTo: string; fingerprint: string } | null>(null);
  const mismatch = pass2.length > 0 && pass !== pass2;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setSent(await api.post<{ sentTo: string; fingerprint: string }>("/api/offsite/key/email", { code, passphrase: pass }));
      qc.invalidateQueries({ queryKey: ["offsite"] });
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <div id="key-email" className={`${inlineBox} text-sm`} role="status">
        <p className="text-success">{t("backups:key.sentTo", { to: sent.sentTo })}</p>
        <p className={lede}>
          {t("backups:key.sentBefore")} <span className="font-mono text-fg">{sent.fingerprint}</span>
          {t("backups:key.sentAfter")}
        </p>
      </div>
    );
  return (
    <form
      id="key-email"
      className={inlineBox}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className={lede}>
        {t("backups:key.emailIntro")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t("backups:key.passphrase")}</span>
          <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" autoFocus />
        </label>
        <label className="block">
          <span className="label">{t("backups:key.passphrase2")}</span>
          <input className="input" type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" aria-invalid={mismatch || undefined} />
          {mismatch && <span className="mt-1 block text-xs text-danger">{t("backups:key.mismatch")}</span>}
        </label>
        <OtpInput label={t("backups:key.code")} value={code} onChange={setCode} />
        <div className="flex items-end">
          <button className="btn-secondary w-full" disabled={busy || pass.length < 12 || pass !== pass2 || code.length !== 6}>
            <Mail className="size-4" aria-hidden /> {busy ? t("backups:key.sending") : t("backups:key.send")}
          </button>
        </div>
      </div>
      <FormError message={error} />
    </form>
  );
}

function RemoteObjects() {
  const qc = useQueryClient();
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ["offsite-objects"], queryFn: () => api.get<OffsiteObject[]>("/api/offsite/objects"), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  async function importIt(o: OffsiteObject) {
    const ok = await confirmDialog({
      title: t("backups:objects.importConfirm.title"),
      message: t("backups:objects.importConfirm.message", { file: o.fileName }),
      confirmLabel: t("backups:objects.importConfirm.confirm"),
    });
    if (!ok) return;
    setBusy(o.key);
    try {
      await api.post("/api/offsite/import", { key: o.key });
      qc.invalidateQueries({ queryKey: ["backups"] });
      void refetch();
    } catch (err) {
      void showError(err, t("backups:objects.importFailed"));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-4 py-1.5 text-xs text-muted sm:px-5">
        <span>{data ? t("backups:objects.count", { count: data.length }) : t("backups:objects.loading")}</span>
        <button className="btn-icon" onClick={() => refetch()} title={t("actions.refresh")} aria-label={t("backups:objects.refreshLabel")}>
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
        </button>
      </div>
      {error && (
        <div className="px-4 pb-3 sm:px-5">
          <FormError message={(error as Error).message} />
        </div>
      )}
      <ul className="max-h-80 overflow-y-auto border-t border-line-soft">
        {data?.map((o) => (
          <li key={o.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-2.5 last:border-b-0 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs text-fg" title={o.fileName}>
                {o.fileName}
              </div>
              <div className="text-xs text-muted tabular-nums">
                {fmtDateTime(o.lastModified)} · {formatBytes(o.size)}
                {o.local && t("backups:objects.alsoLocal")}
              </div>
            </div>
            {!o.local && (
              <button className="btn-secondary btn-sm max-sm:min-h-11" disabled={busy !== null} onClick={() => importIt(o)}>
                {busy === o.key ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <DownloadCloud className="size-3.5" aria-hidden />}{" "}
                {t("backups:objects.download")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
