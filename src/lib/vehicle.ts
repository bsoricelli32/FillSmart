// Personal fuel math: what fills and detours cost in *your* car.
import type { Fillup, Prefs, Vehicle } from "./supabase";

const DAY = 86400000;
/** Roads wind; straight-line distance under-counts the drive. 1.3 is a common planning factor for city driving. */
export const ROAD_FACTOR = 1.3;

/** The vehicle used for prices: the one picked in Garage, else the first. */
export function activeVehicle(vehicles: Vehicle[], prefs: Prefs): Vehicle | null {
  return vehicles.find((v) => v.id === prefs.vehicle_id) ?? vehicles[0] ?? null;
}

/** MPG measured from odometer readings (needs two fills with odometer). Miles-weighted over the last 90 days, else the last 3 legs. */
export function measuredMpg(fillups: Fillup[], v: Vehicle): number | null {
  const mine = fillups.filter((f) => f.vehicle_id === v.id && f.odometer != null).sort((a, b) => a.odometer! - b.odometer!);
  const legs: { miles: number; gal: number; at: number }[] = [];
  for (let i = 1; i < mine.length; i++) {
    const miles = mine[i].odometer! - mine[i - 1].odometer!;
    if (miles > 0 && miles < 1500 && mine[i].gallons > 0) legs.push({ miles, gal: mine[i].gallons, at: new Date(mine[i].filled_at).getTime() });
  }
  if (!legs.length) return null;
  const recent = legs.filter((l) => l.at > Date.now() - 90 * DAY);
  const use = recent.length >= 2 ? recent : legs.slice(-3);
  const mpg = use.reduce((a, l) => a + l.miles, 0) / use.reduce((a, l) => a + l.gal, 0);
  return mpg > 3 && mpg < 150 ? mpg : null;
}

export type Mpg = { mpg: number; source: "measured" | "epa" };
/** Your real MPG when known, else the EPA combined rating. */
export function effectiveMpg(fillups: Fillup[], v: Vehicle | null): Mpg | null {
  if (!v) return null;
  const m = measuredMpg(fillups, v);
  if (m) return { mpg: m, source: "measured" };
  if (v.mpg_combined) return { mpg: v.mpg_combined, source: "epa" };
  return null;
}

export type Fill = { gal: number; source: "history" | "tank" };
/** How much you usually pump: the middle of your last 6 fills, else 75% of the tank. */
export function usualFill(fillups: Fillup[], v: Vehicle | null): Fill | null {
  if (!v) return null;
  const g = fillups.filter((f) => f.vehicle_id === v.id && f.gallons > 0).slice(0, 6).map((f) => f.gallons).sort((a, b) => a - b);
  if (g.length >= 2) { const m = Math.floor(g.length / 2); return { gal: g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2, source: "history" }; }
  if (v.tank_gal) return { gal: Math.round(v.tank_gal * 0.75 * 10) / 10, source: "tank" };
  return null;
}

/** Largest single fill if it is more than the saved tank size (so the tank size must be wrong). */
export function tankTooSmall(fillups: Fillup[], v: Vehicle): number | null {
  if (!v.tank_gal) return null;
  const max = Math.max(0, ...fillups.filter((f) => f.vehicle_id === v.id).map((f) => f.gallons));
  return max > v.tank_gal + 0.3 ? max : null;
}

/** Fuel cost of driving to a station and back, at that station's price. */
export function roundTripCost(distanceMi: number, price: number, mpg: number): number {
  return ((2 * distanceMi * ROAD_FACTOR) / mpg) * price;
}

/** What a fill really costs: the fuel you pump plus the fuel burned getting there and back. */
export function trueFillCost(distanceMi: number, price: number, gal: number, mpg: number): number {
  return price * gal + roundTripCost(distanceMi, price, mpg);
}
