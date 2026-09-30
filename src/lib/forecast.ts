// Wholesale-led retail forecast that only speaks up when it has proven it can.
// For each horizon h (weeks), a least-squares fit on weekly regional data:
//   retail[w+h] - retail[w] = b0 + b1*(spot move last week) + b2*(spot move the week before)
//                             + b3*(retail margin above normal) + b4*(retail move last week)
// Before trusting it, we replay the past year week by week (fitting only on earlier data)
// and compare its misses with simply predicting "no change". If it is not clearly better,
// the forecast is "no clear signal". The range is how far off 80% of those replayed calls were.

export type Obs = { t: number; v: number };
/** change: predicted move in $/gal (0 when there is no signal). band: 80% of replayed misses were within this. */
export type Horizon = { h: number; change: number; band: number; signal: boolean };

const DAY = 86400000;
export const HORIZONS = [1, 2, 3, 4, 5, 6];
const REPLAY_WEEKS = 52;
const MIN_GAIN = 0.9; // model's typical miss must be at most 90% of "no change"

/** Solves A x = b for a small square system (Gaussian elimination with partial pivoting). */
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

/** Ordinary least squares coefficients. */
function ols(X: number[][], y: number[]): number[] | null {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((a, r, n) => a + r[i] * y[n], 0));
  return solve(XtX, Xty);
}

/** Average spot price over the 7 days before each retail week date, carried forward over gaps. */
function weeklySpot(retail: Obs[], spot: Obs[]): number[] | null {
  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const r of retail) {
    const xs = spot.filter((s) => s.t < r.t && s.t >= r.t - 7 * DAY).map((s) => s.v);
    if (xs.length) last = xs.reduce((a, v) => a + v, 0) / xs.length;
    out.push(last);
  }
  const first = out.find((v) => v != null);
  if (first == null) return null;
  return out.map((v, i) => v ?? out.slice(0, i).reverse().find((x) => x != null) ?? first);
}

const mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);
const p80 = (xs: number[]) => { const a = xs.map(Math.abs).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.8))]; };

/** Fits every horizon and checks it against "no change". Returns null when there is not enough history. */
export function fitHorizons(retail: Obs[], spot: Obs[]): Horizon[] | null {
  if (retail.length < REPLAY_WEEKS + 30 || spot.length < 60) return null;
  const s = weeklySpot(retail, spot);
  if (!s) return null;
  const r = retail.map((p) => p.v);
  const normal = mean(r.map((v, i) => v - s[i]));
  const feats = (i: number) => [1, s[i] - s[i - 1], s[i - 1] - s[i - 2], r[i] - s[i] - normal, r[i] - r[i - 1]];

  /** Prediction for week T at horizon h, fitted only on data known by week T. */
  const predict = (T: number, h: number): number | null => {
    const X: number[][] = [], y: number[] = [];
    for (let i = 2; i + h <= T; i++) { X.push(feats(i)); y.push(r[i + h] - r[i]); }
    if (X.length < 20) return null;
    const b = ols(X, y);
    return b ? feats(T).reduce((a, v, k) => a + v * b[k], 0) : null;
  };

  const last = r.length - 1;
  const out: Horizon[] = [];
  for (const h of HORIZONS) {
    const modelErr: number[] = [], naiveErr: number[] = [];
    for (let T = last - REPLAY_WEEKS - h + 1; T + h <= last; T++) {
      const p = predict(T, h);
      if (p == null) continue;
      const act = r[T + h] - r[T];
      modelErr.push(p - act);
      naiveErr.push(act);
    }
    if (modelErr.length < 20) return null;
    const now = predict(last, h);
    const signal = now != null && rms(modelErr) <= MIN_GAIN * rms(naiveErr);
    // Range: the wider of the full replay and the last 13 weeks, so it widens quickly when prices get jumpy.
    const errs = signal ? modelErr : naiveErr;
    out.push({ h, change: signal ? now! : 0, band: Math.max(p80(errs), p80(errs.slice(-13))), signal });
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
