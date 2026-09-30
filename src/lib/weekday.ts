// Learns the day-of-week price pattern near you from station prices (Google and driver reports).
//
// For each station and day we take its price that day (its latest price, carried forward up to
// 7 days), compare it with the same station's average over the surrounding week, and average
// those differences by weekday across all stations and weeks. Comparing each station with itself
// removes the gap between cheap and expensive stations, and the surrounding week removes the
// overall trend, so what is left is the weekly rhythm.

export type Report = { place_id: string; price: number; reported_at: string };
export type WeekdayPattern = {
  offsets: number[];   // $/gal vs a typical day, index 0 = Sunday
  weeks: number;       // distinct weeks of data behind it
  stations: number;
};

const DAY = 86400000;
export const MIN_DAYS = 21;
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const trimmedMean = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), cut = Math.floor(s.length * 0.1), mid = s.slice(cut, s.length - cut); return mid.reduce((a, v) => a + v, 0) / mid.length; };
/** Local calendar day number (days since epoch in the phone's time zone). */
const dayNum = (t: number) => { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };

/** Days of price history collected so far (first report to today). */
export function daysCollected(rows: Report[], now = Date.now()): number {
  if (!rows.length) return 0;
  // Ignore a few very old prices from stations that rarely update.
  const times = rows.map((r) => new Date(r.reported_at).getTime()).sort((a, b) => a - b);
  const first = times[Math.floor(times.length * 0.1)];
  return dayNum(now) - dayNum(first) + 1;
}

/** Null until there are 3 weeks of data from at least 5 stations. */
export function weekdayPattern(rows: Report[], now = Date.now()): WeekdayPattern | null {
  if (daysCollected(rows, now) < MIN_DAYS) return null;
  const today = dayNum(now);

  // Each station's price at the end of each day, carried forward up to 7 days.
  const byStation = new Map<string, { d: number; price: number }[]>();
  for (const r of rows) {
    const list = byStation.get(r.place_id) ?? [];
    list.push({ d: dayNum(new Date(r.reported_at).getTime()), price: r.price });
    byStation.set(r.place_id, list);
  }
  const buckets: number[][] = Array.from({ length: 7 }, () => []);
  const weeksSeen = new Set<number>();
  let stations = 0;
  for (const list of byStation.values()) {
    list.sort((a, b) => a.d - b.d);
    const daily = new Map<number, number>();
    let k = 0, cur: { d: number; price: number } | null = null;
    for (let d = list[0].d; d <= today; d++) {
      while (k < list.length && list[k].d <= d) cur = list[k++];
      if (cur && d - cur.d <= 7) daily.set(d, cur.price);
    }
    let used = false;
    for (const [d, p] of daily) {
      const around: number[] = [];
      for (let j = d - 3; j <= d + 3; j++) { const v = daily.get(j); if (v != null) around.push(v); }
      if (around.length < 7) continue; // need the full surrounding week
      const avg = around.reduce((a, v) => a + v, 0) / around.length;
      const wd = new Date(d * DAY + 12 * 3600_000).getUTCDay();
      buckets[wd].push(p - avg);
      weeksSeen.add(Math.floor(d / 7));
      used = true;
    }
    if (used) stations++;
  }
  if (stations < 5 || buckets.some((b) => b.length < 10)) return null;
  // Trimmed mean: most station-days show no change, so a median would hide a real pattern;
  // dropping the top and bottom 10% keeps one odd price from dominating.
  const raw = buckets.map(trimmedMean);
  const mean = raw.reduce((a, v) => a + v, 0) / 7;
  return { offsets: raw.map((v) => v - mean), weeks: weeksSeen.size, stations };
}
