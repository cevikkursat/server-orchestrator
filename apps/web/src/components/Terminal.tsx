import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { RefreshCw } from "lucide-react";
import type { TerminalClientMessage, TerminalServerMessage } from "@panel/shared";
import { t } from "../i18n";

type Status = "connecting" | "open" | "closed";

/** Container içinde etkileşimli shell (docker exec, TTY) */
export function Terminal({ containerId }: { containerId: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!boxRef.current) return;
    setStatus("connecting");
    setMessage(null);

    const term = new XTerm({
      cursorBlink: true,
      // xterm CSS değişkeni okumaz: renkler burada sabit (gece zemini + amber imleç)
      fontFamily: "\"JetBrains Mono Variable\", ui-monospace, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#05080f", foreground: "#d5dbea", cursor: "#f0b44c", cursorAccent: "#05080f", selectionBackground: "#2c3a5c" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/containers/${containerId}/terminal`);
    const send = (m: TerminalClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

    ws.onopen = () => {
      setStatus("open");
      send({ t: "r", c: term.cols, r: term.rows });
      term.focus();
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as TerminalServerMessage;
      if (m.t === "o") term.write(m.d);
      else if (m.t === "x") setMessage(t("containers:terminal.sessionEnded", { code: m.code ?? "?" }));
      else if (m.t === "e") setMessage(m.m);
    };
    ws.onclose = () => setStatus("closed");

    const onData = term.onData((d) => send({ t: "i", d }));
    const onResize = term.onResize(({ cols, rows }) => send({ t: "r", c: cols, r: rows }));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(boxRef.current);

    return () => {
      ro.disconnect();
      onData.dispose();
      onResize.dispose();
      ws.close();
      term.dispose();
    };
  }, [containerId, session]);

  const dot = { connecting: "dot-none", open: "dot-ok", closed: "dot-none" }[status];
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#05080f]">
      <div className="flex items-center gap-3 border-b border-line bg-raised px-3 py-2 text-xs text-muted">
        <span className={`dot ${dot}`} aria-hidden />
        {status === "open" ? t("containers:terminal.connected") : status === "connecting" ? t("containers:terminal.connecting") : t("containers:terminal.closed")}
        {message && <span className="text-subtle">· {message}</span>}
        <span className="ml-auto text-faint max-sm:hidden">{t("containers:terminal.hint")}</span>
        {status === "closed" && (
          <button className="btn-secondary btn-sm max-sm:ml-auto" onClick={() => setSession((s) => s + 1)}>
            <RefreshCw className="size-3.5" /> {t("containers:terminal.reconnect")}
          </button>
        )}
      </div>
      <div ref={boxRef} className="h-[60vh] p-2" />
    </div>
  );
}
