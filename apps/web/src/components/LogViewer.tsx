import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Pause, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import type { LogMessage } from "@panel/shared";
import { t } from "../i18n";
import { fmtDateTime } from "../lib/format";

type Line = Extract<LogMessage, { type: "line" }> & { n: number };
type Status = "connecting" | "live" | "ended" | "error";

const MAX_LINES = 5000;
/** Satır yüksekliği (leading-5 = 20px); pencereleme bu sabite dayanır, satırlar sarılmaz */
const ROW = 20;
/** Görünen pencerenin üstünde/altında fazladan çizilen satır */
const OVERSCAN = 30;
/** Kutunun dikey iç boşluğu (py-2) */
const PAD = 8;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function LogViewer({ containerId, live }: { containerId: string; live: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showTs, setShowTs] = useState(false);
  const [paused, setPaused] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [follow, setFollow] = useState(true);
  const [tail, setTail] = useState(300);
  const [conn, setConn] = useState(0); // yeniden bağlanmak için artır
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  const boxRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const pausedRef = useRef(paused);
  /** Duraklatılmışken biriken satırlar */
  const buffer = useRef<Line[]>([]);
  /** Henüz ekrana basılmamış satırlar (kare başına bir kez boşaltılır) */
  const pending = useRef<Line[]>([]);
  const flushTimer = useRef<number | null>(null);
  pausedRef.current = paused;

  const flush = useCallback(() => {
    flushTimer.current = null;
    const incoming = pending.current;
    if (!incoming.length) return;
    pending.current = [];
    if (pausedRef.current) {
      buffer.current.push(...incoming);
      if (buffer.current.length > MAX_LINES) buffer.current = buffer.current.slice(-MAX_LINES);
      setBuffered(buffer.current.length);
      return;
    }
    setLines((prev) => {
      const next = prev.concat(incoming);
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    setLines([]);
    setError(null);
    setStatus("connecting");
    buffer.current = [];
    pending.current = [];
    setBuffered(0);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/containers/${containerId}/logs?tail=${tail}`);

    ws.onopen = () => setStatus("live");
    ws.onmessage = (ev) => {
      const msgs = JSON.parse(ev.data) as LogMessage[];
      for (const m of msgs) {
        if (m.type === "line") pending.current.push({ ...m, text: m.text.replace(ANSI, ""), n: counter.current++ });
        else if (m.type === "end") setStatus("ended");
        else if (m.type === "error") {
          setError(m.message);
          setStatus("error");
        }
      }
      if (pending.current.length > MAX_LINES) pending.current = pending.current.slice(-MAX_LINES);
      // Satırlar 100 ms'de bir toplu basılır (yoğun akışta her mesajda yeniden çizim olmasın)
      if (pending.current.length && flushTimer.current === null) flushTimer.current = window.setTimeout(flush, 100);
    };
    ws.onerror = () => {
      setStatus("error");
      setError((e) => e ?? t("projects:logs.connError"));
    };
    ws.onclose = () => setStatus((s) => (s === "live" || s === "connecting" ? "ended" : s));

    return () => {
      ws.close();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    };
    // `live` değişince (container başladı/durdu) yeniden bağlan
  }, [containerId, tail, conn, live, flush]);

  // Duraklatma kalkınca biriken satırları ekle
  useEffect(() => {
    if (!paused && buffer.current.length) {
      const buf = buffer.current;
      buffer.current = [];
      setBuffered(0);
      setLines((prev) => prev.concat(buf).slice(-MAX_LINES));
    }
  }, [paused]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
  }, [lines, filter]);

  // Kutu yüksekliği (pencere boyutu değişince)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // En alttaysak yeni satırlarda aşağı kaydır
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (follow && el) {
      el.scrollTop = el.scrollHeight;
      setScrollTop(el.scrollTop);
    }
  }, [visible, follow]);

  const onScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollow(atBottom);
  }, []);

  // Sadece görünen pencere çizilir; üst ve alt boşluk sabit satır yüksekliğiyle tutulur
  const total = visible.length;
  const start = Math.max(0, Math.floor((scrollTop - PAD) / ROW) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop - PAD + viewH) / ROW) + OVERSCAN);
  const windowed = visible.slice(start, end);

  const statusUi: Record<Status, { label: string; dot: string }> = {
    connecting: { label: t("projects:logs.status.connecting"), dot: "dot-none" },
    live: { label: t("projects:logs.status.live"), dot: "dot-ok" },
    ended: { label: t("projects:logs.status.ended"), dot: "dot-none" },
    error: { label: t("projects:logs.status.error"), dot: "dot-urgent-solid" },
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 sm:px-4">
        <span className="flex items-center gap-2.5" aria-live="polite">
          <span className="cap">{t("projects:logs.title")}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`dot ${statusUi[status].dot}`} aria-hidden /> {statusUi[status].label}
            <span className="font-mono tabular-nums">· {t("projects:logs.lines", { count: lines.length })}</span>
          </span>
        </span>
        <div className="relative ml-auto min-w-36 flex-1 sm:max-w-56 sm:flex-none">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            className="input pl-9"
            placeholder={t("projects:logs.search")}
            aria-label={t("projects:logs.searchLabel")}
            spellCheck={false}
            autoCapitalize="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={tail} onChange={(e) => setTail(Number(e.target.value))} aria-label={t("projects:logs.tailLabel")} title={t("projects:logs.tailTitle")}>
          {[100, 300, 1000, 5000].map((n) => (
            <option key={n} value={n}>
              {t("projects:logs.tailOption", { n })}
            </option>
          ))}
        </select>
        <label className="check-row px-1 text-xs text-muted">
          <input type="checkbox" checked={showTs} onChange={(e) => setShowTs(e.target.checked)} />
          {t("projects:logs.timestamps")}
        </label>
        <button
          className={`btn-icon ${paused && buffered > 0 ? "w-auto gap-1 px-2 text-xs" : ""}`}
          onClick={() => setPaused((p) => !p)}
          title={paused ? t("projects:logs.resume") : t("projects:logs.pause")}
          aria-label={paused ? t("projects:logs.resume") : t("projects:logs.pause")}
          aria-pressed={paused}
        >
          <span className="inline-flex items-center gap-1">
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            {paused && buffered > 0 && <span className="tabular-nums">+{buffered}</span>}
          </span>
        </button>
        <button className="btn-icon" onClick={() => setLines([])} title={t("projects:logs.clear")} aria-label={t("projects:logs.clear")}>
          <Trash2 className="size-4" aria-hidden />
        </button>
        <button className="btn-icon" onClick={() => setConn((c) => c + 1)} title={t("projects:logs.reconnect")} aria-label={t("projects:logs.reconnect")}>
          <RefreshCw className="size-4" aria-hidden />
        </button>
      </div>

      {error && <div className="border-b border-danger/25 bg-danger/[0.06] px-3 py-2 font-mono text-xs leading-5 text-danger sm:px-4">{error}</div>}

      <div ref={boxRef} onScroll={onScroll} className="relative h-[60vh] overflow-auto py-2 font-mono text-xs leading-5" role="log" aria-label={t("projects:logs.boxLabel")}>
        <div className="w-max min-w-full px-3 sm:px-4">
          <div style={{ height: start * ROW }} aria-hidden />
          {windowed.map((l) => (
            <div key={l.n} className={`h-5 whitespace-pre ${l.stream === "stderr" ? "text-danger" : "text-meter"}`}>
              {showTs && l.ts && <span className="mr-3 select-none text-faint">{fmtDateTime(new Date(l.ts))}</span>}
              {l.text || " "}
            </div>
          ))}
          <div style={{ height: (total - end) * ROW }} aria-hidden />
          {status !== "connecting" && lines.length === 0 && !error && <div className="text-subtle">{t("projects:logs.empty")}</div>}
          {lines.length > 0 && total === 0 && <div className="text-subtle">{t("projects:logs.noMatch")}</div>}
        </div>
      </div>

      {!follow && (
        <div className="flex justify-center border-t border-line bg-raised py-1.5">
          <button
            className="btn-ghost btn-sm max-md:min-h-11"
            onClick={() => {
              setFollow(true);
              if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
            }}
          >
            <ArrowDownToLine className="size-4" aria-hidden /> {t("projects:logs.follow")}
          </button>
        </div>
      )}
    </div>
  );
}
