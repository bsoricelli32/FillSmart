import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";

export type ChartPt = { t: number; v: number; band?: number };

const W = 330, H = 196, X0 = 44, X1 = 322, Y0 = 12, Y1 = 164;
const INK = "#2B2724", INK2 = "#5E5750", GRID = "#E3DDD3", RED = "#C21F1A";
const DAY = 86400000;

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmt$ = (v: number) => `$${v.toFixed(2)}`;

/** Round price steps so gridlines land on clean numbers like $3.90, $4.00. */
function niceTicks(lo: number, hi: number) {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  const step = steps.find((s) => (hi - lo) / s <= 5) ?? 1;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(2));
  return { lo: a, hi: b, ticks };
}

/**
 * Price history (solid ink) and forecast (red dashes, shaded range).
 * Drag or use arrow keys to read any point; the readout above the plot shows date, price and range.
 */
export function PriceChart({ hist, fc, label }: { hist: ChartPt[]; fc: ChartPt[]; label: string }) {
  const last = hist[hist.length - 1];
  const fcLine: ChartPt[] = [{ ...last, band: 0 }, ...fc.map((p, k) => ({ ...p, band: p.band ?? 0.006 * (k + 1) }))];
  const pts = [...hist.map((p) => ({ ...p, future: false })), ...fcLine.slice(1).map((p) => ({ ...p, future: true }))];
  const todayIdx = hist.length - 1;

  const [sel, setSel] = useState(todayIdx);
  useEffect(() => setSel(todayIdx), [todayIdx, pts.length]);
  const svgRef = useRef<SVGSVGElement>(null);

  const vals = [...hist.map((p) => p.v), ...fcLine.flatMap((p) => [p.v - (p.band ?? 0), p.v + (p.band ?? 0)])];
  const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t: number) => X0 + ((X1 - X0) * (t - t0)) / Math.max(1, t1 - t0);
  const y = (v: number) => Y1 - ((Y1 - Y0) * (v - lo)) / Math.max(0.01, hi - lo);

  // Date ticks spread across the span, skipping any that would crowd the "Today" label.
  const xToday = x(last.t);
  const span = t1 - t0;
  const labelX = (t: number) => Math.min(X1 - 16, Math.max(X0 + 16, x(t)));
  const dateTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((t0 + f * span) / DAY) * DAY)
    .filter((t) => Math.abs(labelX(t) - xToday) > 44 && x(t) >= X0 - 1 && x(t) <= X1 + 1);

  const band = [...fcLine.map((p) => `${x(p.t)},${y(p.v + p.band!)}`), ...fcLine.map((p) => `${x(p.t)},${y(p.v - p.band!)}`).reverse()].join(" ");

  function pick(clientX: number) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.t) - vx) < Math.abs(x(pts[best].t) - vx)) best = i; });
    setSel(best);
  }
  const onDown = (e: PointerEvent<SVGSVGElement>) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX); };
  const onMove = (e: PointerEvent<SVGSVGElement>) => pick(e.clientX); // touch: while dragging; mouse: on hover
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowLeft") { setSel((i) => Math.max(0, i - 1)); e.preventDefault(); }
    if (e.key === "ArrowRight") { setSel((i) => Math.min(pts.length - 1, i + 1)); e.preventDefault(); }
  };

  const p = pts[Math.min(sel, pts.length - 1)];
  const when = sel === todayIdx ? "Today" : fmtDate(p.t);

  return (
    <div>
      <div aria-live="polite" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "2px 10px 6px", minHeight: 44 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: INK2 }}>{p.future ? `${when.toUpperCase()} · FORECAST` : when.toUpperCase()}</span>
          <span className="tnum" style={{ fontSize: 22, fontWeight: 800, color: p.future ? "#B01C17" : INK }}>{fmt$(p.v)}</span>
        </div>
        {p.future && p.band != null && (
          <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: INK2, textAlign: "right" }}>Likely {fmt$(p.v - p.band)} to {fmt$(p.v + p.band)}</span>
        )}
      </div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={`${label}. Use left and right arrow keys to read each point.`}
        onPointerDown={onDown} onPointerMove={onMove} onKeyDown={onKey}
        style={{ touchAction: "pan-y", cursor: "crosshair", outline: "none", display: "block", userSelect: "none", WebkitUserSelect: "none" }}>
        {ticks.map((v) => (
          <g key={v}>
            <path d={`M${X0 - 4} ${y(v)} H${X1}`} stroke={GRID} />
            <text x={X0 - 8} y={y(v) + 4} fill={INK2} fontSize="11" textAnchor="end" className="tnum">{fmt$(v)}</text>
          </g>
        ))}
        <polygon points={band} fill="rgba(194,31,26,.12)" />
        <line x1={xToday} y1={Y0 - 4} x2={xToday} y2={Y1} stroke="#CBC4B9" />
        <text x={xToday} y={H - 12} fill={INK} fontWeight="700" fontSize="12" textAnchor="middle">Today</text>
        {dateTicks.map((t) => (
          <g key={t}>
            <path d={`M${x(t)} ${Y1} v4`} stroke="#CBC4B9" />
            <text x={labelX(t)} y={H - 12} fill={INK2} fontSize="11" textAnchor="middle">{fmtDate(t)}</text>
          </g>
        ))}
        <polyline points={hist.map((q) => `${x(q.t)},${y(q.v)}`).join(" ")} fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={fcLine.map((q) => `${x(q.t)},${y(q.v)}`).join(" ")} fill="none" stroke={RED} strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
        {/* Readout crosshair */}
        <line x1={x(p.t)} y1={Y0 - 4} x2={x(p.t)} y2={Y1} stroke={p.future ? RED : INK} strokeWidth="1.5" strokeDasharray={p.future ? "3 3" : undefined} />
        <circle cx={x(p.t)} cy={y(p.v)} r="6" fill="#fff" stroke={p.future ? RED : INK} strokeWidth="3" />
      </svg>
    </div>
  );
}
