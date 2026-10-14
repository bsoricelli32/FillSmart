// Mileage log math: IRS standard mileage rates, yearly totals, and the CSV export.
//
// IRS rates in dollars per mile (IR-2025-128 / Notice 2026-10 for 2026; IR-2024-312 for 2025).
// Charity is set by law at 14 cents. Moving is left out: it only applies to active-duty military.
export type Purpose = "business" | "medical" | "charity" | "personal";
export type Trip = {
  id: string; vehicle_id: string | null; trip_date: string; purpose: Purpose; miles: number;
  odo_start: number | null; odo_end: number | null; origin: string | null; destination: string | null; note: string | null;
};

export const IRS_RATES: Record<number, Record<Exclude<Purpose, "personal">, number>> = {
  2025: { business: 0.7, medical: 0.21, charity: 0.14 },
  2026: { business: 0.725, medical: 0.205, charity: 0.14 },
};
export const PURPOSES: { id: Purpose; name: string }[] = [
  { id: "business", name: "Business" },
  { id: "medical", name: "Medical" },
  { id: "charity", name: "Charity" },
  { id: "personal", name: "Personal" },
];

export const yearOf = (t: Trip) => Number(t.trip_date.slice(0, 4));
export function rateFor(year: number, p: Purpose): number | null {
  if (p === "personal") return null;
  return IRS_RATES[year]?.[p] ?? null;
}
export const cents = (r: number) => `${+(r * 100).toFixed(1)}¢`;

export type YearSummary = {
  year: number;
  rows: { purpose: Purpose; miles: number; rate: number | null; amount: number | null; trips: number }[];
  deductible: number; // business + medical + charity, at IRS rates
  missingRate: boolean; // a year FillSmart doesn't have the IRS rate for
};

export function summarize(trips: Trip[], year: number): YearSummary {
  const mine = trips.filter((t) => yearOf(t) === year);
  const rows = PURPOSES.map(({ id }) => {
    const ts = mine.filter((t) => t.purpose === id);
    const miles = ts.reduce((a, t) => a + t.miles, 0);
    const rate = rateFor(year, id);
    return { purpose: id, miles, rate, amount: rate != null ? Math.round(miles * rate * 100) / 100 : null, trips: ts.length };
  }).filter((r) => r.trips > 0);
  return {
    year, rows,
    deductible: rows.reduce((a, r) => a + (r.amount ?? 0), 0),
    missingRate: rows.some((r) => r.purpose !== "personal" && r.rate == null),
  };
}

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A spreadsheet-ready log for one year: every trip, then totals by purpose. */
export function toCsv(trips: Trip[], year: number, vehicleName: (id: string | null) => string): string {
  const head = ["Date", "Vehicle", "Purpose", "From", "To", "Business purpose / notes", "Odometer start", "Odometer end", "Miles", "IRS rate ($/mi)", "Amount ($)"];
  const lines = [head.join(",")];
  const mine = trips.filter((t) => yearOf(t) === year).sort((a, b) => a.trip_date.localeCompare(b.trip_date));
  for (const t of mine) {
    const r = rateFor(year, t.purpose);
    lines.push([t.trip_date, vehicleName(t.vehicle_id), PURPOSES.find((p) => p.id === t.purpose)!.name, t.origin, t.destination, t.note,
      t.odo_start, t.odo_end, t.miles.toFixed(1), r ?? "", r != null ? (t.miles * r).toFixed(2) : ""].map(esc).join(","));
  }
  const s = summarize(trips, year);
  lines.push("");
  for (const row of s.rows) {
    lines.push(["", "", `Total ${PURPOSES.find((p) => p.id === row.purpose)!.name}`, "", "", `${row.trips} trip${row.trips === 1 ? "" : "s"}`, "", "", row.miles.toFixed(1), row.rate ?? "", row.amount != null ? row.amount.toFixed(2) : ""].map(esc).join(","));
  }
  lines.push(["", "", `IRS standard mileage rates for ${year}. Source: irs.gov`].map(esc).join(","));
  return lines.join("\r\n");
}

/** Saves or shares the CSV (share sheet on phones, download elsewhere). */
export async function exportCsv(csv: string, filename: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv" });
  const file = new File([blob], filename, { type: "text/csv" });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
