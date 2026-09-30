import { useEffect, useMemo, useState } from "react";
import { Minus, TrendDown, TrendUp } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { gradeName, supabase } from "../lib/supabase";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";

type Pt = { t: number; v: number };
const DAY = 86400000;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Least-squares line through the points. Returns slope per unit x, intercept, and r². */
function fit(pts: { x: number; y: number }[]) {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept: my - slope * mx, r2 };
}

export default function Outlook() {
  const { prefs, loc } = useStore();
  const grade = prefs.preferred_grade;
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const [rows, setRows] = useState<{ price: number; reported_at: string }[] | null>(null);

  useEffect(() => {
    const d = 0.25; // about 15 miles
    const since = new Date(Date.now() - 90 * DAY).toISOString();
    supabase.from("price_reports").select("price,reported_at").eq("grade", grade).gte("reported_at", since)
      .gte("lat", loc.lat - d).lte("lat", loc.lat + d).gte("lng", loc.lng - d).lte("lng", loc.lng + d)
      .order("reported_at").limit(5000)
      .then(({ data }) => setRows((data ?? []).map((r) => ({ price: Number(r.price), reported_at: r.reported_at }))));
  }, [grade, loc.lat, loc.lng]);

  const daily = view === "daily";
  const model = useMemo(() => {
    if (!rows) return null;
    const bucket = daily ? DAY : 7 * DAY;
    const span = daily ? 14 : 12;
    const now = Date.now();
    const start = Math.floor(now / bucket) * bucket - (span - 1) * bucket;
    const groups = new Map<number, number[]>();
    for (const r of rows) {
      const t = Math.floor(new Date(r.reported_at).getTime() / bucket) * bucket;
      if (t < start) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(r.price);
    }
    const hist: Pt[] = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v: median(v) }));
    if (hist.length < 4) return { hist, enough: false as const };

    const recent = hist.slice(-7).map((p) => ({ x: p.t / bucket, y: p.v }));
    const f = fit(recent);
    const ahead = daily ? 7 : 4;
    const lastT = hist[hist.length - 1].t;
    const fc: Pt[] = Array.from({ length: ahead }, (_, i) => {
      const t = lastT + (i + 1) * bucket;
      return { t, v: Math.max(0.5, f.slope * (t / bucket) + f.intercept) };
    });
    const today = hist[hist.length - 1].v;
    const later = fc[daily ? 2 : 1].v;
    const change = Math.round((later - today) * 100);
    const conf = recent.length >= 6 && f.r2 > 0.6 ? "Medium" : "Low";
    return { hist, fc, today, later, change, conf, enough: true as const };
  }, [rows, daily]);

  // Chart geometry
  const W = 330, H = 170, X0 = 40, X1 = 324, Y0 = 10, Y1 = 142;
  let chart: JSX.Element | null = null;
  if (model?.enough) {
    const all = [...model.hist, ...model.fc];
    const lo = Math.min(...all.map((p) => p.v)) - 0.04, hi = Math.max(...all.map((p) => p.v)) + 0.04;
    const t0 = all[0].t, t1 = all[all.length - 1].t;
    const x = (t: number) => X0 + ((X1 - X0) * (t - t0)) / Math.max(1, t1 - t0);
    const y = (v: number) => Y1 - ((Y1 - Y0) * (v - lo)) / (hi - lo);
    const last = model.hist[model.hist.length - 1];
    const fcLine = [last, ...model.fc];
    const band = [...fcLine.map((p, k) => `${x(p.t)},${y(p.v + 0.006 * k)}`), ...fcLine.map((p, k) => `${x(p.t)},${y(p.v - 0.006 * k)}`).reverse()].join(" ");
    const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    chart = (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${gradeName(grade)} price history with a dashed trend estimate`}>
        {[hi - 0.02, lo + 0.02].map((v, i) => (
          <g key={i}><path d={`M36 ${y(v)} H330`} stroke="#DDD7CD" /><text x="0" y={y(v) + 4} fill="#5E5750" fontSize="11">${v.toFixed(2)}</text></g>
        ))}
        <polygon points={band} fill="rgba(194,31,26,.12)" />
        <line x1={x(last.t)} y1="6" x2={x(last.t)} y2="144" stroke="#CBC4B9" />
        <text x={x(last.t)} y="163" fill="#2B2724" fontWeight="700" fontSize="12" textAnchor="middle">Latest</text>
        <text x={X0} y="163" fill="#5E5750" fontSize="11">{fmt(t0)}</text>
        <text x={X1 + 4} y="163" fill="#5E5750" fontSize="11" textAnchor="end">{fmt(t1)}</text>
        <polyline points={model.hist.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")} fill="none" stroke="#2B2724" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={fcLine.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")} fill="none" stroke="#C21F1A" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.v)} r="6" fill="#fff" stroke="#C21F1A" strokeWidth="3" />
      </svg>
    );
  }

  const rising = model?.enough && model.change > 1;
  const falling = model?.enough && model.change < -1;
  const Icon = rising ? TrendUp : falling ? TrendDown : Minus;

  return (
    <div className="screen">
      <div className="hero">
        <Bar title="Outlook" />
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6 }}>
          <div className="nseg" role="group" aria-label="Forecast range">
            <button className={daily ? "on" : ""} aria-pressed={daily} onClick={() => setView("daily")}>Daily</button>
            <button className={daily ? "" : "on"} aria-pressed={!daily} onClick={() => setView("weekly")}>Weekly</button>
          </div>
        </div>
        {model?.enough ? (
          <section aria-labelledby="vd" style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span className="nb accent" aria-hidden style={{ flex: "none" }}><Icon size={22} /></span>
              <div>
                <h2 id="vd" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{rising ? "Prices likely rising" : falling ? "Prices likely falling" : "Prices holding steady"}</h2>
                <p className="hint">{rising ? "Fill up soon if you can." : falling ? "If you can wait a few days, you may pay less." : "No reason to rush or wait."}</p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="rsunk" style={{ borderRadius: 16, padding: "10px 14px", display: "flex", flexDirection: "column" }}><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>LATEST AVERAGE</span><PumpPrice price={model.today} size={22} /></div>
              <div className="rsunk" style={{ borderRadius: 16, padding: "10px 14px", display: "flex", flexDirection: "column", color: "#B01C17" }}><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>{daily ? "IN 3 DAYS" : "IN 2 WEEKS"}</span><PumpPrice price={model.later} size={22} /></div>
            </div>
          </section>
        ) : null}
      </div>

      <main className="main" style={{ paddingTop: 18 }}>
        {!rows && <p className="hint" style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="spin" />Loading price history</p>}
        {rows && !model?.enough && (
          <div className="raised-sm empty">
            <h2 className="h2">Collecting data</h2>
            <p>The forecast needs at least 4 {daily ? "days" : "weeks"} of {gradeName(grade).toLowerCase()} prices near you. So far: {model?.hist.length ?? 0}. Prices from Google and your scans are saved automatically.</p>
          </div>
        )}
        {model?.enough && (
          <>
            <Section id="ch" title="Price trend" hint="Dark line is the middle price drivers saw. Red dashes are a simple trend estimate, with the likely range shaded.">
              <div className="raised-sm" style={{ borderRadius: 22, padding: "12px 10px 6px" }}>{chart}</div>
            </Section>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>EXPECTED CHANGE</dt><dd className="tnum" style={{ fontSize: 17, fontWeight: 800 }}>{model.change > 0 ? "+" : ""}{model.change}¢</dd></div>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>CONFIDENCE</dt><dd style={{ fontSize: 17, fontWeight: 800 }}>{model.conf}</dd></div>
            </dl>
          </>
        )}
      </main>
      <TabDock />
    </div>
  );
}
