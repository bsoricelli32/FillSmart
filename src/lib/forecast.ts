// Driver-based pump price forecast.
//
// What moves pump prices, and what this model looks at each week:
//   1. Wholesale: the move in the wholesale (spot) price over the last 2 weeks. Stations pass
//      these on with a lag of 1 to 2 weeks (raises fast, cuts slowly).
//   2. Margin: how far the pump price sits over wholesale compared with the past year.
//      Unusual gaps tend to close. Capped to the range seen in training so an odd week
//      can't produce a wild forecast.
//   3. Momentum: last week's move at the pump.
//   4. Season: how prices usually moved over the same weeks in the past 4 years
//      (summer blend, driving season, the fall switch to winter blend).
// For each horizon h (weeks) a least-squares fit on the last 5 years learns how much each
// driver matters. We then replay the last 2 years week by week, fitting only on earlier data,
// to measure how often it called the direction right and how big its misses were.
// Tested 2024-2026: direction right about 62% of the time for Denver gasoline and about 70%
// for Rocky Mountain diesel at 1 to 2 weeks. Beyond 2 weeks the drivers stop agreeing, so
// the forecast stops at 2 weeks.

export type Obs = { t: number; v: number };
export type DriverKey = "wholesale" | "margin" | "momentum" | "season" | "weekday";
export type Driver = { key: DriverKey; fact: string; cents: number };
export type Horizon = {
  h: number;
  change: number;        // predicted move in $/gal from the latest retail week
  band: number;          // 80% of replayed misses were within this, $/gal
  hits: number;          // replay: direction called right (weeks with a move of 3¢ or more)
  calls: number;         // replay: weeks with a move of 3¢ or more
  drivers: Driver[];     // what adds up to `change`, biggest first
};

const DAY = 86400000;
export const HORIZONS = [1, 2];
const MARGIN_WEEKS = 52; // "usual" margin = average over the past year
const TRAIN_WEEKS = 260; // 5 years
const REPLAY_WEEKS = 104; // 2 years
const FIRST = 56; // need a year of history for the seasonal driver

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Least squares with a tiny ridge so rarely-moving drivers can't blow up. */
function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0) + (i === j && i > 0 ? 1e-4 : 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((a, r, n) => a + r[i] * y[n], 0));
  return solve(XtX, Xty);
}

/** Average spot price over the 7 days before each retail week date, carried forward over gaps. */
function weeklySpot(retail: Obs[], spot: Obs[]): number[] {
  let last = spot[0]?.v ?? 0, j = 0;
  return retail.map((r) => {
    while (j < spot.length && spot[j].t < r.t - 7 * DAY) j++;
    let sum = 0, n = 0;
    for (let k = j; k < spot.length && spot[k].t < r.t; k++) { sum += spot[k].v; n++; }
    if (n) last = sum / n;
    return last;
  });
}

const p80 = (xs: number[]) => { const a = xs.map(Math.abs).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.8))] ?? 0; };
const c = (v: number) => Math.round(Math.abs(v) * 100);

/**
 * Forecast for every horizon. `place` names the retail series in driver text (e.g. "Denver").
 * Returns null when there is not enough history.
 */
export function forecast(retail: Obs[], spot: Obs[], place: string, fuel: "gas" | "diesel" = "gas"): Horizon[] | null {
  if (retail.length < FIRST + REPLAY_WEEKS + 60 || spot.length < 200) return null;
  const r = retail.map((p) => p.v), s = weeklySpot(retail, spot);
  const last = r.length - 1;

  const season = (i: number, h: number) => {
    let sum = 0, n = 0;
    for (let k = 1; k <= 4; k++) { const j = i - 52 * k; if (j >= 0 && j + h <= i) { sum += r[j + h] - r[j]; n++; } }
    return n ? sum / n : 0;
  };
  // Margin gap vs the past year's average, known at week i.
  const gap = r.map((_, i) => {
    const lo = Math.max(0, i - MARGIN_WEEKS + 1);
    let m = 0;
    for (let k = lo; k <= i; k++) m += r[k] - s[k];
    return r[i] - s[i] - m / (i - lo + 1);
  });
  const feats = (i: number, h: number, gLo: number, gHi: number) => [
    1, s[i] - s[i - 2], Math.min(gHi, Math.max(gLo, gap[i])), r[i] - r[i - 1], season(i, h),
  ];
  /** Fit using only weeks whose outcome was known by week T, then predict week T. */
  const fitAt = (T: number, h: number) => {
    const lo = Math.max(FIRST, T - TRAIN_WEEKS);
    const seen = gap.slice(lo, T - h + 1).sort((a, z) => a - z);
    const gLo = seen[Math.floor(seen.length * 0.05)], gHi = seen[Math.floor(seen.length * 0.95)];
    const X: number[][] = [], y: number[] = [];
    for (let i = lo; i + h <= T; i++) { X.push(feats(i, h, gLo, gHi)); y.push(r[i + h] - r[i]); }
    if (X.length < 52) return null;
    const b = ols(X, y);
    if (!b) return null;
    const f = feats(T, h, gLo, gHi);
    return { b, f, pred: f.reduce((a, v, k) => a + v * b[k], 0) };
  };

  // Facts for the driver list.
  const lastSpot = spot[spot.length - 1];
  const spot2wk = spot.filter((p) => p.t <= lastSpot.t - 14 * DAY).pop();
  const wholesaleMove = spot2wk ? lastSpot.v - spot2wk.v : s[last] - s[last - 2];

  const out: Horizon[] = [];
  for (const h of HORIZONS) {
    const errs: number[] = [];
    let hits = 0, calls = 0;
    for (let T = last - REPLAY_WEEKS; T + h <= last; T++) {
      const fit = fitAt(T, h);
      if (!fit) continue;
      const act = r[T + h] - r[T];
      errs.push(fit.pred - act);
      if (Math.abs(act) >= 0.03) { calls++; if (Math.sign(fit.pred) === Math.sign(act)) hits++; }
    }
    const now = fitAt(last, h);
    if (!now || errs.length < 20) return null;
    const { b, f } = now;
    const part = (from: number, to: number) => { let a = 0; for (let k = from; k <= to; k++) a += b[k] * f[k]; return a; };
    const g = gap[last], lastWeek = f[3], seas = f[4];
    const weeks = h === 1 ? "week" : `${h} weeks`;
    const widen = g < 0;
    const drivers: Driver[] = [
      { key: "wholesale", cents: part(1, 1), fact: c(wholesaleMove) === 0 ? `Wholesale ${fuel} held steady over the last 2 weeks.` : `Wholesale ${fuel} ${wholesaleMove < 0 ? "fell" : "rose"} ${c(wholesaleMove)}¢ in the last 2 weeks. Stations usually pass that on within 1 to 2 weeks.` },
      { key: "margin", cents: part(2, 2), fact: widen
        ? `Pump prices are ${c(g)}¢ closer to wholesale than usual this past year. That gap tends to widen back out.`
        : `Pump prices are ${c(g)}¢ further above wholesale than usual this past year. That gap tends to close.` },
      { key: "momentum", cents: part(3, 3), fact: c(lastWeek) === 0 ? `${place} prices held steady in the latest week.` : `${place} prices ${lastWeek < 0 ? "fell" : "rose"} ${c(lastWeek)}¢ in the latest week.` },
      { key: "season", cents: part(4, 4), fact: `In past years, ${place} prices ${seas < 0 ? "fell" : "rose"} about ${c(seas)}¢ over these same ${weeks === "week" ? "7 days" : weeks}.` },
    ];
    drivers.sort((a, z) => Math.abs(z.cents) - Math.abs(a.cents));
    out.push({ h, change: now.pred, band: Math.max(p80(errs), p80(errs.slice(-13))), hits, calls, drivers });
  }
  return out;
}

/** Predicted change and range at time t, measured from the latest retail week. Linear between fitted weeks. */
export function pathAt(hz: Horizon[], lastT: number, t: number): { change: number; band: number } {
  const w = Math.max(0, (t - lastT) / (7 * DAY));
  const pts = [{ h: 0, change: 0, band: 0 }, ...hz];
  for (let i = 1; i < pts.length; i++) {
    if (w <= pts[i].h) {
      const a = pts[i - 1], b = pts[i], f = (w - a.h) / (b.h - a.h);
      return { change: a.change + f * (b.change - a.change), band: a.band + f * (b.band - a.band) };
    }
  }
  const e = pts[pts.length - 1];
  return { change: e.change, band: e.band };
}
