import { adminClient, allowedUser, cors, json } from "./common.ts";

type Grade = "87" | "89" | "93" | "D";
type PriceEntry = { price: number; updated_at: string; source: "google" | "photo" | "manual" };
type Station = {
  place_id: string; name: string; address: string | null; lat: number; lng: number;
  prices: Partial<Record<Grade, PriceEntry>>;
};

const CACHE_MINUTES = 45;
const FUEL_MAP: Record<string, Grade> = {
  REGULAR_UNLEADED: "87", MIDGRADE: "89", PREMIUM: "93", SP91: "93", SP95: "93", DIESEL: "D",
};

function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchGoogle(lat: number, lng: number, radius: number, key: string): Promise<Station[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions",
    },
    body: JSON.stringify({
      includedTypes: ["gas_station"],
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    }),
  });
  if (!res.ok) {
    console.error("places error", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return (data.places ?? []).map((p: any): Station => {
    const prices: Station["prices"] = {};
    for (const fp of p.fuelOptions?.fuelPrices ?? []) {
      const g = FUEL_MAP[fp.type];
      if (!g || !fp.price) continue;
      const price = Number(fp.price.units ?? 0) + Number(fp.price.nanos ?? 0) / 1e9;
      if (!(price > 0)) continue;
      const prev = prices[g];
      if (!prev || fp.updateTime > prev.updated_at) {
        prices[g] = { price: +price.toFixed(3), updated_at: fp.updateTime ?? new Date().toISOString(), source: "google" };
      }
    }
    return {
      place_id: p.id, name: p.displayName?.text ?? "Gas station", address: p.formattedAddress ?? null,
      lat: p.location?.latitude, lng: p.location?.longitude, prices,
    };
  }).filter((s: Station) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

/**
 * Google returns at most the 20 closest stations per search. Up to about 5 miles one search is enough;
 * wider areas are covered by 7 overlapping circles (center plus a ring of 6) and merged.
 */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const who = await allowedUser(req);
  if (!who) return json({ error: "not_allowed" }, 403);

  let body: { lat?: number; lng?: number; radius_m?: number; refresh?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: "bad_location" }, 400);
  }
  const radius = Math.min(Math.max(Number(body.radius_m) || 8000, 1000), 33000); // up to about 20 miles
  const dLat = radius / 111_000, dLng = radius / (111_000 * Math.cos(lat * Math.PI / 180));

  const admin = adminClient();
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const freshSince = new Date(Date.now() - CACHE_MINUTES * 60_000).toISOString();

  const { data: cached } = await admin.from("station_cache")
    .select("place_id,name,address,lat,lng,prices,fetched_at")
    .gte("lat", lat - dLat).lte("lat", lat + dLat)
    .gte("lng", lng - dLng).lte("lng", lng + dLng);

  let stations: Station[] = (cached ?? []).map((c) => ({
    place_id: c.place_id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, prices: c.prices ?? {},
  }));
  // Fresh only if a Google fetch in the last 45 minutes covered this whole circle.
  // (A wider search must not reuse a smaller area's results.)
  const { data: fetches } = await admin.from("nearby_fetches").select("lat,lng,radius_m").gte("fetched_at", freshSince);
  const isFresh = (fetches ?? []).some((f) => miles(lat, lng, f.lat, f.lng) * 1609.34 + radius <= f.radius_m + 300);

  if (key && (!isFresh || body.refresh)) {
    const fresh = await fetchArea(lat, lng, radius, key);
    if (fresh.length) {
      const now = new Date().toISOString();
      await admin.from("station_cache").upsert(fresh.map((s) => ({ ...s, fetched_at: now })));
      await admin.from("nearby_fetches").insert({ lat, lng, radius_m: radius });
      await admin.from("nearby_fetches").delete().lt("fetched_at", new Date(Date.now() - 86400_000).toISOString());

      // Keep price history for the Outlook screen: log Google prices that changed.
      const oldById = new Map(stations.map((s) => [s.place_id, s]));
      const history: any[] = [];
      for (const s of fresh) {
        for (const [g, e] of Object.entries(s.prices) as [Grade, PriceEntry][]) {
          const old = oldById.get(s.place_id)?.prices?.[g];
          if (!old || old.price !== e.price || old.updated_at !== e.updated_at) {
            history.push({ user_id: null, place_id: s.place_id, station_name: s.name, lat: s.lat, lng: s.lng, grade: g, price: e.price, source: "google", reported_at: e.updated_at });
          }
        }
      }
      if (history.length) await admin.from("price_reports").insert(history);

      const byId = new Map(stations.map((s) => [s.place_id, s]));
      for (const s of fresh) byId.set(s.place_id, s);
      stations = [...byId.values()];
    }
  }

  // Merge in driver reports from the last 48 hours; newest price wins per grade.
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: reports } = await admin.from("price_reports")
    .select("place_id,station_name,lat,lng,grade,price,source,reported_at")
    .in("source", ["photo", "manual"]).gte("reported_at", since)
    .gte("lat", lat - dLat).lte("lat", lat + dLat)
    .gte("lng", lng - dLng).lte("lng", lng + dLng)
    .order("reported_at", { ascending: false }).limit(500);

  const byId = new Map(stations.map((s) => [s.place_id, s]));
  for (const r of reports ?? []) {
    let s = byId.get(r.place_id);
    if (!s) {
      if (r.lat == null || r.lng == null) continue;
      s = { place_id: r.place_id, name: r.station_name ?? "Gas station", address: null, lat: r.lat, lng: r.lng, prices: {} };
      byId.set(r.place_id, s);
    }
    const g = r.grade as Grade;
    const cur = s.prices[g];
    if (!cur || r.reported_at > cur.updated_at) {
      s.prices[g] = { price: Number(r.price), updated_at: r.reported_at, source: r.source };
    }
  }

  const out = [...byId.values()]
    .map((s) => ({ ...s, distance_mi: +miles(lat, lng, s.lat, s.lng).toFixed(1) }))
    .filter((s) => s.distance_mi <= radius / 1609.34 + 0.5)
    .sort((a, b) => a.distance_mi - b.distance_mi);

  return json({ stations: out, google_configured: Boolean(key) });
});
