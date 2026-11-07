import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Table2 } from "lucide-react";
import { t as tr } from "../i18n";
import { fmtDate, fmtDateTime, fmtTime } from "../lib/format";

export interface Series {
  key: string;
  label: string;
  /** CSS rengi; rol değişkenlerinden biri (var(--viz-series-1) vb.) */
  color: string;
  values: (number | null)[];
}

interface Props {
  title: string;
  subtitle?: string;
  times: number[];
  series: Series[];
  bucketMs: number;
  format: (v: number) => string;
  /** Sabit üst sınır (yüzdeler için 100) */
  yMax?: number;
  /** "bytes": eksen 1024'lük birimlerde yuvarlak değerlere (2.5 / 5 / 7.5 MB) oturur */
  unit?: "bytes";
  /** Veri yenilenirken önceki çizim soluk kalsın */
  stale?: boolean;
  emptyText?: string;
  height?: number;
  /** Kart ve başlık olmadan yalnız çizim (Sunucu kartının içinde) */
  bare?: boolean;
}

const M = { top: 10, right: 12, bottom: 22 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/** Bayt değerlerinde yuvarlamayı gösterilen birimde (KB, MB…) yap */
function niceMaxBytes(v: number) {
  if (v <= 0) return 1024;
  const k = 1024 ** Math.max(0, Math.floor(Math.log(v) / Math.log(1024)));
  return niceMax(v / k) * k;
}

function timeLabel(t: number, spanMs: number) {
  const hm = fmtTime(t);
  return spanMs > 26 * 3600_000 ? `${fmtDate(t, { day: "2-digit", month: "2-digit" })} ${hm}` : hm;
}

/**
 * Zaman serisi çizgi grafiği: 2px çizgi, tek seride %10 alan dolgusu, ince ızgara,
 * en yakın zamana yapışan dikey çizgi + tüm serileri gösteren tooltip, klavye ile gezinme
 * ve tablo görünümü. Örnekleme aralığının çok üstündeki boşluklarda çizgi kırılır.
 */
export function TimeSeriesChart({ title, subtitle, times, series, bucketMs, format, yMax, unit, stale, emptyText, height = 170, bare }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const gradId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasData = times.length > 0 && series.some((s) => s.values.some((v) => v != null));

  // Üst sınır ve eksen etiketleri; sol boşluk en uzun etikete göre ayarlanır (kesilmesin)
  const { max, ticks, left } = useMemo(() => {
    const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))) * 1.1;
    const m = yMax ?? (unit === "bytes" ? niceMaxBytes(dataMax) : niceMax(dataMax));
    const t = (bare ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => f * m);
    const longest = Math.max(...t.map((v) => format(v).length));
    return { max: m, ticks: t, left: Math.max(bare ? 30 : 36, Math.ceil(longest * 6.6) + (bare ? 8 : 14)) };
  }, [series, yMax, unit, format, bare]);
  const M2 = { ...M, left };
  const innerW = width - M2.left - M2.right;
  const innerH = height - M2.top - M2.bottom;

  const geom = useMemo(() => {
    const t0 = times[0] ?? 0;
    const t1 = times[times.length - 1] ?? 1;
    const span = Math.max(1, t1 - t0);
    const x = (t: number) => left + ((t - t0) / span) * innerW;
    const y = (v: number) => M.top + innerH - (Math.min(v, max) / max) * innerH;
    const xTickCount = Math.max(2, Math.min(6, Math.floor(innerW / 110)));
    const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + (span * i) / (xTickCount - 1));

    const paths = series.map((s) => {
      let line = "";
      const areas: string[] = [];
      let seg: [number, number][] = [];
      const flush = () => {
        if (seg.length) {
          const base = y(0);
          areas.push(`M${seg[0]![0]},${base}L${seg.map(([a, b]) => `${a},${b}`).join("L")}L${seg[seg.length - 1]![0]},${base}Z`);
        }
        seg = [];
      };
      s.values.forEach((v, i) => {
        const t = times[i]!;
        const gap = i > 0 && t - times[i - 1]! > bucketMs * 2.5;
        if (v == null || gap) flush();
        if (v == null) return;
        const px = x(t);
        const py = y(v);
        line += `${seg.length === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
        seg.push([+px.toFixed(1), +py.toFixed(1)]);
      });
      flush();
      return { line, areas };
    });
    return { t0, span, x, y, ticks, xTicks, paths, max };
  }, [times, series, max, ticks, left, innerW, innerH, bucketMs]);

  function onMove(e: PointerEvent<SVGRectElement>) {
    if (!times.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = geom.t0 + ((e.clientX - rect.left) / rect.width) * geom.span;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
    setHover(best);
  }

  function onKey(e: KeyboardEvent) {
    if (!times.length) return;
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? times.length) - 1));
    else if (e.key === "ArrowRight") setHover((h) => Math.min(times.length - 1, (h ?? -1) + 1));
    else return;
    e.preventDefault();
  }

  const single = series.length === 1;
  const hx = hover != null ? geom.x(times[hover]!) : 0;

  return (
    <div className={bare ? "relative min-w-0" : "card relative min-w-0 p-4"}>
      {!bare && (
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="text-xs text-subtle">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {!single && (
            <ul className="flex gap-3 text-xs text-muted" aria-label={tr("chart.series")}>
              {series.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <button
            className={`btn-icon md:size-8 ${showTable ? "text-fg" : "text-subtle"}`}
            onClick={() => setShowTable((v) => !v)}
            title={showTable ? tr("chart.showChart") : tr("chart.showTable")}
            aria-pressed={showTable}
          >
            <Table2 className="size-3.5" />
          </button>
        </div>
      </div>
      )}

      <div ref={wrapRef} className={`relative transition-opacity duration-150 ${stale ? "opacity-60" : ""}`}>
        {showTable ? (
          <div className="max-h-[170px] overflow-auto text-xs">
            <table className="w-full tabular-nums">
              <thead className="sticky top-0 bg-raised text-left text-subtle">
                <tr>
                  <th className="py-1 font-medium">{tr("chart.time")}</th>
                  {series.map((s) => (
                    <th key={s.key} className="py-1 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-fg/85">
                {[...times.keys()].reverse().map((i) => (
                  <tr key={times[i]} className="border-t border-line/60">
                    <td className="py-0.5 text-muted">{fmtDateTime(times[i]!)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="py-0.5 text-right">
                        {s.values[i] != null ? format(s.values[i]!) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !hasData ? (
          <div className="grid place-items-center text-xs text-subtle" style={{ height }}>
            {emptyText ?? tr("chart.empty")}
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={tr("chart.label", { title })}
              tabIndex={0}
              onKeyDown={onKey}
              onBlur={() => setHover(null)}
              className="block outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <defs>
                <clipPath id={gradId}>
                  <rect x={M2.left} y={M.top - 4} width={innerW} height={innerH + 8} />
                </clipPath>
              </defs>
              {geom.ticks.map((v) => (
                <g key={v}>
                  <line x1={M2.left} x2={width - M.right} y1={geom.y(v)} y2={geom.y(v)} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
                  <text x={M2.left - 8} y={geom.y(v)} dy="0.32em" textAnchor="end" fontSize={bare ? 10 : 11} fill="var(--viz-muted)" className="font-mono tabular-nums">
                    {format(v)}
                  </text>
                </g>
              ))}
              {geom.xTicks.map((t, i) => (
                <text
                  key={t}
                  x={geom.x(t)}
                  y={height - 6}
                  textAnchor={i === 0 ? "start" : i === geom.xTicks.length - 1 ? "end" : "middle"}
                  fontSize={bare ? 10 : 11}
                  fill="var(--viz-muted)"
                  className="font-mono tabular-nums"
                >
                  {timeLabel(t, geom.span)}
                </text>
              ))}
              <g clipPath={`url(#${gradId})`}>
                {single &&
                  geom.paths[0]!.areas.map((d, i) => <path key={i} d={d} fill={series[0]!.color} fillOpacity={bare ? 0.07 : 0.1} />)}
                {geom.paths.map((p, i) => (
                  <path key={series[i]!.key} d={p.line} fill="none" stroke={series[i]!.color} strokeWidth={bare ? 1.5 : 2} strokeDasharray={bare && i > 0 ? "3 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                ))}
              </g>
              {hover != null && (
                <g pointerEvents="none">
                  <line x1={hx} x2={hx} y1={M.top} y2={M.top + innerH} stroke="var(--viz-muted)" strokeWidth={1} />
                  {series.map((s) =>
                    s.values[hover] != null ? (
                      <circle key={s.key} cx={hx} cy={geom.y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                    ) : null,
                  )}
                </g>
              )}
              <rect
                x={M2.left}
                y={M.top}
                width={innerW}
                height={innerH}
                fill="transparent"
                onPointerMove={onMove}
                onPointerDown={onMove}
                onPointerLeave={() => setHover(null)}
                style={{ touchAction: "pan-y" }}
              />
            </svg>
            {hover != null && (
              <div
                className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-line-strong bg-overlay px-3 py-2 text-xs shadow-pop"
                style={hx > width / 2 ? { right: width - hx + 12 } : { left: hx + 12 }}
                role="status"
              >
                <div className="mb-1 text-subtle">{fmtDateTime(times[hover]!)}</div>
                {series.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                    <span className="font-semibold text-fg tabular-nums">{s.values[hover] != null ? format(s.values[hover]!) : "—"}</span>
                    <span className="text-muted">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
