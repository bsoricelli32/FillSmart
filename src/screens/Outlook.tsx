import { useEffect, useMemo, useState } from "react";
import { Minus, TrendDown, TrendUp } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { gradeName, supabase } from "../lib/supabase";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";
import { fitHorizons, pathAt, type Obs } from "../lib/forecast";
import { PriceChart } from "../components/PriceChart";

type Pt = { t: number; v: number; band?: number };
const DAY = 86400000;

// EIA series per grade: Denver retail (weekly) and the Gulf Coast wholesale benchmark (daily).
const SERIES: Record<string, { retail: string; spot: string }> = {
  "87": { retail: "EMM_EPMR_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG" },
  "89": { retail: "EMM_EPMM_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG" },
  "93": { retail: "EMM_EPMP_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG" },
  D: { retail: "EMD_EPD2D_PTE_R40_DPG", spot: "EER_EPD2DXL0_PF4_RGC_DPG" },
};

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

  const [market, setMarket] = useState<{ retail: Obs[]; spot: Obs[] } | null>(null);
  useEffect(() => {
    const s = SERIES[grade];
    if (!s) return;
    const since = new Date(Date.now() - 2.5 * 365 * DAY).toISOString().slice(0, 10);
    supabase.from("market_prices").select("series,period,value").in("series", [s.retail, s.spot]).gte("period", since)
      .order("period").limit(1000)
      .then(({ data }) => {
        const pick = (id: string) => (data ?? []).filter((r) => r.series === id).map((r) => ({ t: new Date(r.period + "T00:00:00Z").getTime(), v: Number(r.value) }));
        setMarket({ retail: pick(s.retail), spot: pick(s.spot) });
      });
  }, [grade]);

  const daily = view === "daily";
  const model = useMemo(() => {
    if (!rows) return null;
    const bucket = daily ? DAY : 7 * DAY;
    const now = Date.now();

    // Wholesale-led forecast from EIA data, shifted to match prices near you.
    const hz = market && fitHorizons(market.retail, market.spot);
    if (market && hz) {
      const R = market.retail, lastT = R[R.length - 1].t;
      const denverNow = R[R.length - 1].v + pathAt(hz, lastT, now).change;
      const recent = rows.filter((r) => new Date(r.reported_at).getTime() >= now - 7 * DAY).map((r) => r.price);
      const local = recent.length >= 3 ? median(recent) : null;
      const offset = local != null ? local - denverNow : 0;

      // History: your area's daily medians when there are enough, otherwise the regional weekly series.
      const days = new Map<number, number[]>();
      for (const r of rows) {
        const t = Math.floor(new Date(r.reported_at).getTime() / DAY) * DAY;
        if (t < now - 14 * DAY) continue;
        if (!days.has(t)) days.set(t, []);
        days.get(t)!.push(r.price);
      }
      const localDaily: Pt[] = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v: median(v) }));
      const hist: Pt[] = daily && localDaily.length >= 4 ? localDaily
        : R.filter((p) => p.t >= now - (daily ? 42 : 182) * DAY).map((p) => ({ t: p.t, v: p.v + offset }));
      hist.push({ t: now, v: local ?? denverNow });

      const today = local ?? denverNow;
      const ahead = daily ? 7 : 4;
      const at = (t: number) => { const p = pathAt(hz, lastT, t), p0 = pathAt(hz, lastT, now); return { v: today + p.change - p0.change, band: Math.sqrt(Math.max(0, p.band ** 2 - p0.band ** 2)) }; };
      const fc: Pt[] = Array.from({ length: ahead }, (_, i) => { const t = now + (i + 1) * bucket; return { t, ...at(t) }; });
      const lat = at(now + (daily ? 3 : 14) * DAY);
      const later = lat.v;
      const change = Math.round((later - today) * 100);
      const range = [Math.round((later - lat.band - today) * 100), Math.round((later + lat.band - today) * 100)] as const;
      const signal = hz[daily ? 0 : 1].signal;
      const conf = (signal ? "Medium" : "Low") as "Medium" | "Low";
      return { hist, fc, today, later, change, range, conf, signal, local: local != null, market: true, enough: true as const };
    }

    // Fallback until EIA data arrives: straight trend line through prices near you.
    const span = daily ? 14 : 12;
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
    return { hist, fc, today, later, change, range: null, conf, signal: true, local: true, market: false, enough: true as const };
  }, [rows, daily, market]);

  const noSignal = model?.enough && !model.signal;
  const rising = model?.enough && !noSignal && model.change > 1;
  const falling = model?.enough && !noSignal && model.change < -1;
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
                <h2 id="vd" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{noSignal ? "No clear signal" : rising ? "Prices likely rising" : falling ? "Prices likely falling" : "Prices holding steady"}</h2>
                <p className="hint">{noSignal ? "Prices here swing week to week without a pattern we can predict. The range shows how much they usually move." : rising ? "Fill up soon if you can." : falling ? "If you can wait a few days, you may pay less." : "No reason to rush or wait."}</p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="rsunk" style={{ borderRadius: 16, padding: "10px 14px", display: "flex", flexDirection: "column" }}><span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>{model.local ? "LATEST AVERAGE" : "DENVER AVERAGE"}</span><PumpPrice price={model.today} size={22} /></div>
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
            <Section id="ch" title="Price trend" hint={model.market
              ? `Dark line is ${model.local ? "the price near you" : "the Denver average"}. ${model.signal ? "Red dashes are the forecast from wholesale prices" : "Red dashes hold today's price"}, with the likely range shaded. Drag across it to read any point.`
              : "Dark line is the middle price drivers saw. Red dashes are a simple trend estimate, with the likely range shaded. Drag across it to read any point."}>
              <div className="raised-sm" style={{ borderRadius: 22, padding: "12px 10px 6px" }}>
                <PriceChart hist={model.hist} fc={model.fc} label={`${gradeName(grade)} price history with a dashed forecast`} />
              </div>
            </Section>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>EXPECTED CHANGE</dt><dd className="tnum" style={{ fontSize: 17, fontWeight: 800 }}>{model.change > 0 ? "+" : ""}{model.change}¢</dd>{model.range && <dd className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>Range {model.range[0] > 0 ? "+" : ""}{model.range[0]} to {model.range[1] > 0 ? "+" : ""}{model.range[1]}¢</dd>}</div>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>CONFIDENCE</dt><dd style={{ fontSize: 17, fontWeight: 800 }}>{model.conf}</dd></div>
            </dl>
            {model.market && <p className="hint">Regional and wholesale prices come from the U.S. Energy Information Administration. The forecast can't see sudden events like a refinery outage.</p>}
          </>
        )}
      </main>
      <TabDock />
    </div>
  );
}
