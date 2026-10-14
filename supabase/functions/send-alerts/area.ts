// Stations and prices around a point, the same way the app's Prices screen builds them
// (Google prices from the shared cache, refreshed when stale, plus driver reports from the last 48 hours).
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Grade = "87" | "89" | "93" | "D";
type PriceEntry = { price: number; updated_at: string; source: string };
export type Station = {
  place_id: string; name: string; address: string | null; lat: number; lng: number;
  prices: Partial<Record<Grade, PriceEntry>>; distance_mi?: number;
};

const FUEL_MAP: Record<string, Grade> = {
  REGULAR_UNLEADED: "87", MIDGRADE: "89", PREMIUM: "93", SP91: "93", SP95: "93", DIESEL: "D",
};

export function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchGoogle(lat: number, lng: number, radius: number, key: string): Promise<Station[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions",
    },
    body: JSON.stringify({
      includedTypes: ["gas_station"], maxResultCount: 20, rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    }),
  });
  if (!res.ok) { console.error("places error", res.status, await res.text()); return []; }
  return ((await res.json()).places ?? []).map((p: any): Station => {
    const prices: Station["prices"] = {};
    for (const fp of p.fuelOptions?.fuelPrices ?? []) {
      const g = FUEL_MAP[fp.type];
      if (!g || !fp.price) continue;
      const price = Number(fp.price.units ?? 0) + Number(fp.price.nanos ?? 0) / 1e9;
      if (!(price > 0)) continue;
      const prev = prices[g];
      if (!prev || fp.updateTime > prev.updated_at) prices[g] = { price: +price.toFixed(3), updated_at: fp.updateTime ?? new Date().toISOString(), source: "google" };
    }
    return { place_id: p.id, name: p.displayName?.text ?? "Gas station", address: p.formattedAddress ?? null, lat: p.location?.latitude, lng: p.location?.longitude, prices };
  }).filter((s: Station) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

async function fetchArea(lat: number, lng: number, radius: number, key: string): Promise<Station[]> {
  if (radius <= 8100) return fetchGoogle(lat, lng, radius, key);
  const ring = radius * 0.65, sub = Math.round(radius * 0.55);
  const centers = [[lat, lng], ...Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3;
    return [lat + (ring * Math.cos(a)) / 111_000, lng + (ring * Math.sin(a)) / (111_000 * Math.cos(lat * Math.PI / 180))];
  })];
  const parts = await Promise.all(centers.map(([a, b]) => fetchGoogle(a, b, sub, key)));
  const byId = new Map<string, Station>();
  for (const s of parts.flat()) if (!byId.has(s.place_id)) byId.set(s.place_id, s);
  return [...byId.values()];
}

/** Stations within `radius` meters, sorted by distance. Calls Google only if no fetch covered this circle in `maxAgeMin`. */
export async function loadArea(admin: SupabaseClient, lat: number, lng: number, radius: number, maxAgeMin: number): Promise<Station[]> {
  const dLat = radius / 111_000, dLng = radius / (111_000 * Math.cos(lat * Math.PI / 180));
  const { data: cached } = await admin.from("station_cache").select("place_id,name,address,lat,lng,prices")
    .gte("lat", lat - dLat).lte("lat", lat + dLat).gte("lng", lng - dLng).lte("lng", lng + dLng);
  let stations: Station[] = (cached ?? []).map((c) => ({ ...c, prices: c.prices ?? {} }));

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const { data: fetches } = await admin.from("nearby_fetches").select("lat,lng,radius_m")
    .gte("fetched_at", new Date(Date.now() - maxAgeMin * 60_000).toISOString());
  const fresh = (fetches ?? []).some((f) => miles(lat, lng, f.lat, f.lng) * 1609.34 + radius <= f.radius_m + 300);
  if (key && !fresh) {
    const got = await fetchArea(lat, lng, radius, key);
    if (got.length) {
      const now = new Date().toISOString();
      await admin.from("station_cache").upsert(got.map((s) => ({ ...s, fetched_at: now })));
      await admin.from("nearby_fetches").insert({ lat, lng, radius_m: radius });
      const oldById = new Map(stations.map((s) => [s.place_id, s]));
      const history: any[] = [];
      for (const s of got) for (const [g, e] of Object.entries(s.prices) as [Grade, PriceEntry][]) {
        const old = oldById.get(s.place_id)?.prices?.[g];
        if (!old || old.price !== e.price || old.updated_at !== e.updated_at) {
          history.push({ user_id: null, place_id: s.place_id, station_name: s.name, lat: s.lat, lng: s.lng, grade: g, price: e.price, source: "google", reported_at: e.updated_at });
        }
      }
      if (history.length) await admin.from("price_reports").insert(history);
      const byId = new Map(stations.map((s) => [s.place_id, s]));
      for (const s of got) byId.set(s.place_id, s);
      stations = [...byId.values()];
    }
  }

  const { data: reports } = await admin.from("price_reports")
    .select("place_id,station_name,lat,lng,grade,price,source,reported_at")
    .in("source", ["photo", "manual"]).gte("reported_at", new Date(Date.now() - 48 * 3600_000).toISOString())
    .gte("lat", lat - dLat).lte("lat", lat + dLat).gte("lng", lng - dLng).lte("lng", lng + dLng)
    .order("reported_at", { ascending: false }).limit(500);
  const byId = new Map(stations.map((s) => [s.place_id, s]));
  for (const r of reports ?? []) {
    let s = byId.get(r.place_id);
    if (!s) {
      if (r.lat == null || r.lng == null) continue;
      s = { place_id: r.place_id, name: r.station_name ?? "Gas station", address: null, lat: r.lat, lng: r.lng, prices: {} };
      byId.set(r.place_id, s);
    }
    const g = r.grade as Grade, cur = s.prices[g];
    if (!cur || r.reported_at > cur.updated_at) s.prices[g] = { price: Number(r.price), updated_at: r.reported_at, source: r.source };
  }
  return [...byId.values()]
    .map((s) => ({ ...s, distance_mi: +miles(lat, lng, s.lat, s.lng).toFixed(1) }))
    .filter((s) => s.distance_mi! <= radius / 1609.34 + 0.5)
    .sort((a, b) => a.distance_mi! - b.distance_mi!);
}
