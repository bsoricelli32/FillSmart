// Saves current Google fuel prices for a fixed home area every 6 hours (pg_cron), so the
// day-of-week pattern has steady daily data even on days nobody opens the app.
// Called with the project's anon key. Takes no input, and skips if it ran in the last 5 hours,
// so extra calls cost nothing.
import { createClient } from "npm:@supabase/supabase-js@2";

type Grade = "87" | "89" | "93" | "D";
type PriceEntry = { price: number; updated_at: string; source: "google" };

const AREA = { lat: 40.1672, lng: -105.1019, radius: 8047 }; // Longmont, 5 miles
const FUEL_MAP: Record<string, Grade> = {
  REGULAR_UNLEADED: "87", MIDGRADE: "89", PREMIUM: "93", SP91: "93", SP95: "93", DIESEL: "D",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return json({ error: "google_not_configured" }, 503);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const since = new Date(Date.now() - 5 * 3600_000).toISOString();
  const { data: recent } = await admin.from("nearby_fetches").select("lat,lng,radius_m")
    .eq("lat", AREA.lat).eq("lng", AREA.lng).eq("radius_m", AREA.radius).gte("fetched_at", since).limit(1);
  if (recent?.length) return json({ skipped: "ran_recently" });

  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions",
    },
    body: JSON.stringify({
      includedTypes: ["gas_station"], maxResultCount: 20, rankPreference: "DISTANCE",
      locationRestriction: { circle: { center: { latitude: AREA.lat, longitude: AREA.lng }, radius: AREA.radius } },
    }),
  });
  if (!res.ok) { console.error("places error", res.status, await res.text()); return json({ error: "google_failed" }, 502); }
  const places = (await res.json()).places ?? [];

  const stations = places.map((p: any) => {
    const prices: Partial<Record<Grade, PriceEntry>> = {};
    for (const fp of p.fuelOptions?.fuelPrices ?? []) {
      const g = FUEL_MAP[fp.type];
      if (!g || !fp.price) continue;
      const price = Number(fp.price.units ?? 0) + Number(fp.price.nanos ?? 0) / 1e9;
      if (!(price > 0)) continue;
      const prev = prices[g];
      if (!prev || fp.updateTime > prev.updated_at) prices[g] = { price: +price.toFixed(3), updated_at: fp.updateTime ?? new Date().toISOString(), source: "google" };
    }
    return { place_id: p.id, name: p.displayName?.text ?? "Gas station", address: p.formattedAddress ?? null, lat: p.location?.latitude, lng: p.location?.longitude, prices };
  }).filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  // Log prices that changed since the last save, for the Outlook history.
  const { data: old } = await admin.from("station_cache").select("place_id,prices").in("place_id", stations.map((s: any) => s.place_id));
  const oldById = new Map((old ?? []).map((o) => [o.place_id, o.prices ?? {}]));
  const history: any[] = [];
  for (const s of stations) {
    for (const [g, e] of Object.entries(s.prices) as [Grade, PriceEntry][]) {
      const prev = oldById.get(s.place_id)?.[g];
      if (!prev || prev.price !== e.price || prev.updated_at !== e.updated_at) {
        history.push({ user_id: null, place_id: s.place_id, station_name: s.name, lat: s.lat, lng: s.lng, grade: g, price: e.price, source: "google", reported_at: e.updated_at });
      }
    }
  }
  const now = new Date().toISOString();
  if (stations.length) await admin.from("station_cache").upsert(stations.map((s: any) => ({ ...s, fetched_at: now })));
  if (history.length) await admin.from("price_reports").insert(history);
  await admin.from("nearby_fetches").insert({ lat: AREA.lat, lng: AREA.lng, radius_m: AREA.radius });
  return json({ stations: stations.length, logged: history.length });
});
