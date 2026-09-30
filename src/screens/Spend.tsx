import { useMemo, useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { daysInMonth, startOfMonth, startOfWeek } from "../lib/util";
import { Bar, Section, TabDock } from "../components/TabDock";

const DAY = 86400000;

export default function Spend() {
  const { fillups, prefs, setPrefs } = useStore();
  const [period, setPeriod] = useState<"week" | "month">("month");
  const month = period === "month";
  const now = new Date();

  const { spent, gallons, count, bars, compare } = useMemo(() => {
    const from = month ? startOfMonth(now) : startOfWeek(now);
    const inRange = fillups.filter((f) => new Date(f.filled_at) >= from);
    const spent = inRange.reduce((a, f) => a + f.total, 0);
    const gallons = inRange.reduce((a, f) => a + f.gallons, 0);

    let bars: { x: string; v: number }[];
    if (month) {
      const weeks = Math.ceil((daysInMonth(now) + ((from.getDay() + 6) % 7)) / 7);
      bars = Array.from({ length: weeks }, (_, i) => ({ x: `Wk ${i + 1}`, v: 0 }));
      for (const f of inRange) {
        const d = new Date(f.filled_at);
        const idx = Math.floor((d.getDate() - 1 + ((from.getDay() + 6) % 7)) / 7);
        if (bars[idx]) bars[idx].v += f.total;
      }
    } else {
      bars = ["M", "T", "W", "T", "F", "S", "S"].map((x) => ({ x, v: 0 }));
      for (const f of inRange) {
        const idx = Math.floor((new Date(f.filled_at).getTime() - from.getTime()) / DAY);
        if (bars[idx]) bars[idx].v += f.total;
      }
    }

    // Compare with the same stretch of the previous period.
    const prevFrom = month ? new Date(from.getFullYear(), from.getMonth() - 1, 1) : new Date(from.getTime() - 7 * DAY);
    const elapsed = now.getTime() - from.getTime();
    const prev = fillups.filter((f) => { const t = new Date(f.filled_at).getTime(); return t >= prevFrom.getTime() && t < prevFrom.getTime() + elapsed; })
      .reduce((a, f) => a + f.total, 0);
    let compare = "";
    if (prev > 0) {
      const pct = Math.round(((spent - prev) / prev) * 100);
      compare = pct === 0 ? `Same as last ${period}` : `${Math.abs(pct)}% ${pct < 0 ? "less" : "more"} than last ${period}`;
    }
    return { spent, gallons, count: inRange.length, bars, compare };
  }, [fillups, month, period]);

  // Separate limits: weekly and monthly are set independently.
  const budgetKey = month ? "monthly_budget" : "weekly_budget";
  const budget = prefs[budgetKey];
  const cap = budget;
  const stepBy = month ? 10 : 5;
  const left = cap - spent;
  const frac = cap > 0 ? Math.min(spent / cap, 1) : 0;
  const circ = 2 * Math.PI * 82;
  const max = Math.max(...bars.map((b) => b.v), 1);
  const latestIdx = bars.reduce((last, b, i) => (b.v > 0 ? i : last), -1);
  const recent = fillups.slice(0, 4);

  return (
    <div className="screen">
      <div className="hero" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Bar title="Spend" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "0 20px", marginTop: -10 }}>
          <div className="nseg" role="group" aria-label="Report period">
            <button className={month ? "" : "on"} aria-pressed={!month} onClick={() => setPeriod("week")}>Week</button>
            <button className={month ? "on" : ""} aria-pressed={month} onClick={() => setPeriod("month")}>Month</button>
          </div>
          <p className="hint" style={{ textAlign: "center" }}>
            {now.toLocaleString("en-US", { month: "long" })}{month ? "" : `, this week`}, {count} fill-up{count === 1 ? "" : "s"}. Every scan adds here.
          </p>
        </div>
        <figure aria-label={`Spent $${spent.toFixed(2)} of $${cap} budget`} style={{ display: "flex", justifyContent: "center" }}>
          <div className="rsunk" style={{ width: 196, height: 196, borderRadius: 98, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="196" height="196" viewBox="0 0 196 196" aria-hidden style={{ position: "absolute", inset: 0 }}>
              <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F0625A" /><stop offset="1" stopColor="#9E1612" /></linearGradient></defs>
              <circle cx="98" cy="98" r="82" fill="none" stroke="#E4DFD7" strokeWidth="12" />
              <circle cx="98" cy="98" r="82" fill="none" stroke="url(#rg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`} transform="rotate(-90 98 98)" />
            </svg>
            <div className="dome" style={{ width: 140, height: 140, borderRadius: 70, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span className="tnum" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>${spent.toFixed(2)}</span>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>of ${cap} budget</span>
              <span className="tnum" style={{ fontSize: 12, color: "var(--ink-2)" }}>{gallons.toFixed(1)} gal</span>
            </div>
          </div>
        </figure>
      </div>

      <main className="main" style={{ paddingTop: 18 }}>
        <Section id="bl" title={month ? "Monthly budget" : "Weekly budget"} hint="Use − and + to set your limit. The ring shows how much you've used."
          right={<span className="tnum" style={{ fontSize: 14, fontWeight: 700, color: left >= 0 ? "#1F7A4A" : "#A8170F", paddingTop: 2, whiteSpace: "nowrap" }}>{left >= 0 ? `$${left.toFixed(2)} left` : `$${Math.abs(left).toFixed(2)} over`}</span>}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button className="nb" aria-label={`Lower budget by $${stepBy}`} onClick={() => setPrefs({ [budgetKey]: Math.max(0, budget - stepBy) })}><Minus size={22} /></button>
            <output className="tnum" style={{ fontSize: 24, fontWeight: 800 }}>${budget.toFixed(0)}</output>
            <button className="nb" aria-label={`Raise budget by $${stepBy}`} onClick={() => setPrefs({ [budgetKey]: budget + stepBy })}><Plus size={22} /></button>
          </div>
        </Section>

        <Section id="ct" title={month ? "By week" : "By day"} hint={latestIdx >= 0 ? `The red bar is your latest ${month ? "week" : "fill-up day"}.` : "Bars fill in as you log fill-ups."}
          right={compare ? <span style={{ fontSize: 13, color: "var(--ink-2)", paddingTop: 3 }}>{compare}</span> : undefined}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: 118 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div className="sunk" title={`$${b.v.toFixed(2)}`} style={{ width: 22, height: 92, borderRadius: 11, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 3, right: 3, bottom: 3, height: b.v > 0 ? Math.max(8, Math.round((b.v / max) * 86)) : 0, borderRadius: 8, background: i === latestIdx ? "linear-gradient(180deg,#E23A2E,#9E1612)" : "linear-gradient(180deg,#D6D0C6,#CBC4B9)" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>{b.x}</span>
              </div>
            ))}
          </div>
        </Section>

        {recent.length > 0 && (
          <Section id="rc" title="Recent fill-ups">
            <ul>
              {recent.map((f) => (
                <li key={f.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 2px", borderBottom: "1px solid var(--lo)" }}>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 700 }}>{f.station_name ?? "Fill-up"}</span>
                    <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{new Date(f.filled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {f.gallons.toFixed(1)} gal · ${f.price_per_gal.toFixed(3)}</span>
                  </span>
                  <span className="tnum" style={{ fontWeight: 800 }}>${f.total.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>
      <TabDock />
    </div>
  );
}
