import { useEffect, useMemo, useState } from "react";
import { Minus, TrendDown, TrendUp } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { gradeName, supabase } from "../lib/supabase";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";
import { forecast, pathAt, type Obs } from "../lib/forecast";
import { PriceChart } from "../components/PriceChart";
import { DAY_NAMES, MIN_DAYS, daysCollected, weekdayPattern } from "../lib/weekday";

type Pt = { t: number; v: number; band?: number };
const DAY = 86400000;

// EIA series per grade: Denver retail (weekly) and the Gulf Coast wholesale benchmark (daily).
const SERIES: Record<string, { retail: string; spot: string; place: string }> = {
  "87": { retail: "EMM_EPMR_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG", place: "Denver" },
  "89": { retail: "EMM_EPMM_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG", place: "Denver" },
  "93": { retail: "EMM_EPMP_PTE_YDEN_DPG", spot: "EER_EPMRU_PF4_RGC_DPG", place: "Denver" },
  D: { retail: "EMD_EPD2D_PTE_R40_DPG", spot: "EER_EPD2DXL0_PF4_RGC_DPG", place: "Rocky Mountain" },
};

type Report = { place_id: string; price: number; reported_at: string };
const weekdayOf = (t: number) => new Date(t).getDay();

/** Middle price across stations, each at its latest price in the 7 days before `t`. Null if too few stations. */
function stationIndex(rows: Report[], t: number, minStations: number): number | null {
  const latest = new Map<string, { at: string; price: number }>();
  const from = new Date(t - 7 * DAY).toISOString(), to = new Date(t).toISOString();
  for (const r of rows) {
    if (r.reported_at > to || r.reported_at < from) continue;
    const cur = latest.get(r.place_id);
    if (!cur || r.reported_at > cur.at) latest.set(r.place_id, { at: r.reported_at, price: r.price });
  }
  return latest.size >= minStations ? median([...latest.values()].map((x) => x.price)) : null;
}

/** Reads every row of one market series (the API returns at most 1,000 per request). */
async function readSeries(id: string, since: string): Promise<Obs[]> {
  const out: Obs[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("market_prices").select("period,value").eq("series", id).gte("period", since).order("period").range(from, from + 999);
    const page = (data ?? []).map((r) => ({ t: new Date(r.period + "T00:00:00Z").getTime(), v: Number(r.value) }));
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

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
  const [rows, setRows] = useState<Report[] | null>(null);

  useEffect(() => {
    const d = 0.25; // about 15 miles
    const since = new Date(Date.now() - 56 * DAY).toISOString(); // 8 weeks, for the day-of-week pattern
    let live = true;
    (async () => {
      // Newest first, in pages of 1,000 (the API cap), up to 5,000 prices.
      const all: Report[] = [];
      for (let from = 0; from < 5000; from += 1000) {
        const { data } = await supabase.from("price_reports").select("place_id,price,reported_at").eq("grade", grade).gte("reported_at", since)
          .gte("lat", loc.lat - d).lte("lat", loc.lat + d).gte("lng", loc.lng - d).lte("lng", loc.lng + d)
          .order("reported_at", { ascending: false }).range(from, from + 999);
        const page = (data ?? []).map((r) => ({ place_id: r.place_id, price: Number(r.price), reported_at: r.reported_at }));
        all.push(...page);
        if (page.length < 1000) break;
      }
      if (live) setRows(all.reverse());
    })();
    return () => { live = false; };
  }, [grade, loc.lat, loc.lng]);
  const pattern = useMemo(() => (rows ? weekdayPattern(rows) : null), [rows]);

  const [market, setMarket] = useState<{ retail: Obs[]; spot: Obs[] } | null>(null);
  useEffect(() => {
    const s = SERIES[grade];
    if (!s) return;
    let live = true;
    setMarket(null);
    Promise.all([readSeries(s.retail, "2016-01-01"), readSeries(s.spot, "2018-01-01")])
      .then(([retail, spot]) => { if (live) setMarket({ retail, spot }); });
    return () => { live = false; };
  }, [grade]);
  const hz = useMemo(() => (market ? forecast(market.retail, market.spot, SERIES[grade]?.place ?? "Denver", grade === "D" ? "diesel" : "gas") : null), [market, grade]);

  const daily = view === "daily";
  const model = useMemo(() => {
    if (!rows) return null;
    const bucket = daily ? DAY : 7 * DAY;
    const now = Date.now();

    // Driver-based forecast from EIA data, shifted to match prices near you.
    if (market && hz) {
      const R = market.retail, lastT = R[R.length - 1].t;
      const denverNow = R[R.length - 1].v + pathAt(hz, lastT, now).change;
      const local = stationIndex(rows, now, 3);
      const offset = local != null ? local - denverNow : 0;

      // History: your area's daily price level when enough stations report, otherwise the regional weekly series.
      const localDaily: Pt[] = [];
      for (let k = 13; k >= 1; k--) {
        const t = Math.floor(now / DAY) * DAY - (k - 1) * DAY;
        const v = stationIndex(rows, t, 5);
        if (v != null) localDaily.push({ t, v });
      }
      const hist: Pt[] = daily && localDaily.length >= 4 ? localDaily
        : R.filter((p) => p.t >= now - (daily ? 42 : 84) * DAY).map((p) => ({ t: p.t, v: p.v + offset }));
      hist.push({ t: now, v: local ?? denverNow });

      const today = local ?? denverNow;
      const ahead = daily ? 7 : 2; // the forecast stops at 2 weeks
      // Day-of-week rhythm near you (daily view only; weekly points land on the same weekday).
      const dow = (t: number) => (daily && pattern ? pattern.offsets[weekdayOf(t)] - pattern.offsets[weekdayOf(now)] : 0);
      const at = (t: number) => { const p = pathAt(hz, lastT, t), p0 = pathAt(hz, lastT, now); return { v: today + p.change - p0.change + dow(t), band: Math.sqrt(Math.max(0, p.band ** 2 - p0.band ** 2)) }; };
      const fc: Pt[] = Array.from({ length: ahead }, (_, i) => { const t = now + (i + 1) * bucket; return { t, ...at(t) }; });
      const lat = at(now + (daily ? 3 : 14) * DAY);
      const later = lat.v;
      const change = Math.round((later - today) * 100);
      const range = [Math.round((later - lat.band - today) * 100), Math.round((later + lat.band - today) * 100)] as const;
      const hz0 = hz[daily ? 0 : 1];
      const rate = hz0.calls ? hz0.hits / hz0.calls : 0;
      const conf = rate >= 0.72 ? "Good" : rate >= 0.6 ? "Fair" : "Low";
      const record = `Right ${Math.round(rate * 10)} of 10 times`;
      const drivers = [...hz0.drivers];
      if (daily && pattern) {
        const t3 = now + 3 * DAY, o = pattern.offsets;
        const lo = o.indexOf(Math.min(...o)), hi = o.indexOf(Math.max(...o));
        drivers.push({ key: "weekday", cents: dow(t3),
          fact: `Near you, ${DAY_NAMES[lo]}s run ${Math.round(Math.abs(o[lo]) * 100)}¢ below a typical day and ${DAY_NAMES[hi]}s ${Math.round(Math.abs(o[hi]) * 100)}¢ above. In 3 days it's ${DAY_NAMES[weekdayOf(t3)]}.` });
        drivers.sort((a, z) => Math.abs(z.cents) - Math.abs(a.cents));
      }
      return { hist, fc, today, later, change, range, conf, record, drivers, local: local != null, market: true, enough: true as const };
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
    return { hist, fc, today, later, change, range: null, conf, record: null, drivers: null, local: true, market: false, enough: true as const };
  }, [rows, daily, market, hz, pattern]);

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
              ? `Dark line is ${model.local ? "the price near you" : `the ${SERIES[grade]?.place ?? "Denver"} average`}. Red dashes are the forecast, with the likely range shaded. Drag across it to read any point.`
              : "Dark line is the middle price drivers saw. Red dashes are a simple trend estimate, with the likely range shaded. Drag across it to read any point."}>
              <div className="raised-sm" style={{ borderRadius: 22, padding: "12px 10px 6px" }}>
                <PriceChart hist={model.hist} fc={model.fc} label={`${gradeName(grade)} price history with a dashed forecast`} />
              </div>
            </Section>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>EXPECTED CHANGE</dt><dd className="tnum" style={{ fontSize: 17, fontWeight: 800 }}>{model.change > 0 ? "+" : ""}{model.change}¢</dd>{model.range && <dd className="tnum" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>Range {model.range[0] > 0 ? "+" : ""}{model.range[0]} to {model.range[1] > 0 ? "+" : ""}{model.range[1]}¢</dd>}</div>
              <div className="raised-sm" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>CONFIDENCE</dt><dd style={{ fontSize: 17, fontWeight: 800 }}>{model.conf}</dd>{model.record && <dd style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>{model.record}</dd>}</div>
            </dl>
            {model.drivers && (
              <Section id="why" title="What's driving it" hint={`What each factor adds to the price over the next ${daily ? "week" : "2 weeks"}, biggest first.`}>
                <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {model.drivers.map((d) => {
                    const cents = Math.round(d.cents * 100);
                    const DIcon = cents > 0 ? TrendUp : cents < 0 ? TrendDown : Minus;
                    return (
                      <li key={d.key} className="raised-sm" style={{ borderRadius: 18, padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <span className="nb xs" aria-hidden style={{ flex: "none" }}><DIcon size={18} /></span>
                        <p style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.4 }}>{d.fact}</p>
                        <span className="tnum" style={{ flex: "none", fontSize: 16, fontWeight: 800, paddingTop: 2 }}>{cents > 0 ? "+" : cents < 0 ? "\u2212" : ""}{Math.abs(cents)}¢</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}
            <Section id="dow" title="Best day to fill up" hint={pattern
              ? `How prices near you usually differ by day, from ${pattern.weeks} weeks of prices at ${pattern.stations} stations.`
              : "Learning which days are cheapest near you from local station prices."}>
              {pattern ? (
                <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                  {pattern.offsets.map((o, i) => {
                    const best = o === Math.min(...pattern.offsets);
                    const cents = Math.round(o * 100);
                    return (
                      <div key={i} role="listitem" className={best ? "" : "raised-sm"} aria-label={`${DAY_NAMES[i]}: ${cents === 0 ? "typical" : `${Math.abs(cents)} cents ${cents < 0 ? "below" : "above"} typical`}${best ? ", cheapest" : ""}`}
                        style={{ borderRadius: 14, padding: "8px 2px", textAlign: "center", display: "flex", flexDirection: "column", gap: 2, ...(best ? { background: "linear-gradient(145deg,#E23A2E,#C21F1A)", color: "#fff", boxShadow: "0 6px 14px rgba(194,31,26,.3)" } : {}) }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: best ? "#fff" : "var(--ink-2)" }}>{DAY_NAMES[i].slice(0, 3)}</span>
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>{cents > 0 ? "+" : cents < 0 ? "\u2212" : ""}{Math.abs(cents)}¢</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="raised-sm empty">
                  <p>Needs 3 weeks of daily prices from stations near you. {rows ? `${Math.min(daysCollected(rows), MIN_DAYS)} of ${MIN_DAYS} days collected so far.` : ""} Prices around Longmont save every 6 hours, and anywhere else whenever the app loads stations.</p>
                </div>
              )}
            </Section>
            {model.market && <p className="hint">Tested week by week on the last 2 years of prices. Regional and wholesale prices come from the U.S. Energy Information Administration. The forecast can't see sudden events like a refinery outage.</p>}
          </>
        )}
      </main>
      <TabDock />
    </div>
  );
}
