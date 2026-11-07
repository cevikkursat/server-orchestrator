import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { notifyEvents, type NotificationSettings as Settings } from "@panel/shared";
import { api } from "../lib/api";
import { useNotifications } from "../lib/ops";
import { FormError } from "./AuthCard";
import { Panel, Switch, lede } from "./MaintenanceUi";
import { t } from "../i18n";

/** Kanal sütunu: telefonda ve dar ekranda alt alta, geniş ekranda yan yana */
const channelCol = "flex min-w-0 flex-col gap-3 border-line-soft px-4 py-4 sm:px-5 max-xl:border-b xl:border-r xl:last:border-r-0";
const presetBtn = "chip min-h-11 md:min-h-6 md:px-2 md:text-[11px]";

export function NotificationSettings() {
  const qc = useQueryClient();
  const { data } = useNotifications();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [chats, setChats] = useState<{ id: string; name: string; type: string }[] | null>(null);
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (!s) return null;

  const dirty = JSON.stringify(s) !== JSON.stringify(data);
  const setTg = (p: Partial<Settings["telegram"]>) => setS({ ...s, telegram: { ...s.telegram, ...p } });
  const setDc = (p: Partial<Settings["discord"]>) => setS({ ...s, discord: { ...s.discord, ...p } });
  const setEm = (p: Partial<Settings["email"]>) => setS({ ...s, email: { ...s.email, ...p } });

  async function act(fn: () => Promise<string>) {
    setError(null);
    setInfo(null);
    try {
      setInfo(await fn());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const save = () =>
    act(async () => {
      const r = await api.put<Settings>("/api/notifications", s);
      qc.setQueryData(["notifications"], r);
      return t("settings:notifications.saved");
    });

  const test = () =>
    act(async () => {
      if (dirty) await api.put("/api/notifications", s).then((r) => qc.setQueryData(["notifications"], r));
      await api.post("/api/notifications/test");
      return t("settings:notifications.testSent");
    });

  const findChats = () =>
    act(async () => {
      const list = await api.post<{ id: string; name: string; type: string }[]>("/api/notifications/telegram/chats", { botToken: s.telegram.botToken });
      setChats(list);
      return list.length ? t("settings:notifications.pickChat") : t("settings:notifications.noChats");
    });

  const anyOn = s.email.enabled || s.telegram.enabled || s.discord.enabled;

  return (
    <Panel
      id="bildirimler"
      title={t("settings:notifications.title")}
      aside={<span>{anyOn ? t("settings:notifications.asideOn") : t("settings:notifications.asideOff")}</span>}
      footer={
        <>
          <button className="btn-secondary max-sm:w-full" onClick={save} disabled={!dirty}>
            {t("actions.save")}
          </button>
          <button className="btn-secondary max-sm:w-full" onClick={test} disabled={!anyOn}>
            <Send className="size-4" aria-hidden /> {t("settings:notifications.test")}
          </button>
          <span className="text-xs text-muted" role="status">
            {info ? <span className="text-success">{info}</span> : dirty ? t("settings:notifications.unsaved") : ""}
          </span>
        </>
      }
    >
      <div className="grid border-b border-line-soft xl:grid-cols-3">
        {/* E-posta */}
        <div className={channelCol}>
          <Switch checked={s.email.enabled} onChange={(v) => setEm({ enabled: v })}>
            {t("settings:notifications.email")}
          </Switch>
          {s.email.enabled ? (
            <>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                {t("settings:notifications.presets")}
                <button type="button" className={presetBtn} onClick={() => setEm({ host: "smtp.gmail.com", port: 465, secure: true })}>
                  Gmail
                </button>
                <button type="button" className={presetBtn} onClick={() => setEm({ host: "smtp.office365.com", port: 587, secure: false })}>
                  Outlook
                </button>
                <button type="button" className={presetBtn} onClick={() => setEm({ host: "smtp.yandex.com", port: 465, secure: true })}>
                  Yandex
                </button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3">
                <label className="block min-w-0">
                  <span className="label">{t("settings:notifications.smtpHost")}</span>
                  <input className="input font-mono text-xs" value={s.email.host} onChange={(e) => setEm({ host: e.target.value })} />
                </label>
                <label className="block min-w-0">
                  <span className="label">{t("settings:notifications.port")}</span>
                  <input
                    className="input font-mono text-xs"
                    type="number"
                    inputMode="numeric"
                    value={s.email.port}
                    onChange={(e) => setEm({ port: Number(e.target.value), secure: Number(e.target.value) === 465 })}
                  />
                </label>
                <label className="col-span-2 block min-w-0">
                  <span className="label">{t("settings:notifications.user")}</span>
                  <input className="input" autoComplete="off" value={s.email.user} onChange={(e) => setEm({ user: e.target.value })} placeholder={t("settings:notifications.emailPlaceholder")} />
                </label>
                <label className="col-span-2 block min-w-0">
                  <span className="label">{t("settings:notifications.password")}</span>
                  <input className="input" type="password" autoComplete="new-password" value={s.email.password} onChange={(e) => setEm({ password: e.target.value })} />
                </label>
                <label className="col-span-2 block min-w-0">
                  <span className="label">{t("settings:notifications.to")}</span>
                  <input className="input" value={s.email.to} onChange={(e) => setEm({ to: e.target.value })} placeholder={t("settings:notifications.emailPlaceholder")} />
                </label>
              </div>
              <p className={lede}>
                {t("settings:notifications.gmailBefore")} <b className="font-semibold text-fg">{t("settings:notifications.gmailApp")}</b>
                {t("settings:notifications.gmailAfter")}
              </p>
            </>
          ) : (
            <p className="text-xs text-faint">{t("settings:notifications.emailOff")}</p>
          )}
        </div>

        {/* Telegram */}
        <div className={channelCol}>
          <Switch checked={s.telegram.enabled} onChange={(v) => setTg({ enabled: v })}>
            Telegram
          </Switch>
          {s.telegram.enabled ? (
            <>
              <label className="block min-w-0">
                <span className="label">{t("settings:notifications.botToken")}</span>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  autoComplete="off"
                  value={s.telegram.botToken}
                  onChange={(e) => setTg({ botToken: e.target.value })}
                  placeholder="123456:ABC-DEF…"
                />
              </label>
              <div className="min-w-0">
                <div className="label" id="tg-chat-label">
                  {t("settings:notifications.chatId")}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-labelledby="tg-chat-label"
                    className="input min-w-[10rem] flex-1 font-mono text-xs"
                    value={s.telegram.chatId}
                    onChange={(e) => setTg({ chatId: e.target.value })}
                  />
                  <button type="button" className="btn-secondary shrink-0" onClick={findChats} disabled={!s.telegram.botToken}>
                    {t("settings:notifications.findChat")}
                  </button>
                </div>
              </div>
              {chats && chats.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("settings:notifications.foundChats")}>
                  {chats.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className="chip min-h-11 md:min-h-8"
                      onClick={() => {
                        setTg({ chatId: c.id });
                        setChats(null);
                      }}
                    >
                      {c.name} <span className="ml-1 text-faint">({c.type})</span>
                    </button>
                  ))}
                </div>
              )}
              <p className={lede}>
                {t("settings:notifications.tgBefore")} <b className="font-semibold text-fg">@BotFather</b>
                {t("settings:notifications.tgMid")} <code className="font-mono text-fg">/newbot</code> {t("settings:notifications.tgAfter")}
              </p>
            </>
          ) : (
            <p className="text-xs text-faint">{t("settings:notifications.optional")}</p>
          )}
        </div>

        {/* Discord */}
        <div className={channelCol}>
          <Switch checked={s.discord.enabled} onChange={(v) => setDc({ enabled: v })}>
            Discord
          </Switch>
          {s.discord.enabled ? (
            <>
              <label className="block min-w-0">
                <span className="label">{t("settings:notifications.webhookUrl")}</span>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  autoComplete="off"
                  value={s.discord.webhookUrl}
                  onChange={(e) => setDc({ webhookUrl: e.target.value })}
                  placeholder="https://discord.com/api/webhooks/…"
                />
              </label>
              <p className={lede}>{t("settings:notifications.discordHint")}</p>
            </>
          ) : (
            <p className="text-xs text-faint">{t("settings:notifications.discordOff")}</p>
          )}
        </div>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2 px-4 py-4 sm:px-5">
        <legend className="label float-left mb-2 w-full">{t("settings:notifications.eventsLegend")}</legend>
        <div className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
          {notifyEvents.map((e) => (
            <label key={e} className="check-row text-fg/90">
              <input type="checkbox" checked={s.events[e]} onChange={(ev) => setS({ ...s, events: { ...s.events, [e]: ev.target.checked } })} />
              {t(`settings:notifications.events.${e}`)}
            </label>
          ))}
        </div>
        <FormError message={error} />
      </fieldset>
    </Panel>
  );
}
