// Search for a town (to set location) or for gas stations by name anywhere (not limited to nearby).
//   { mode: "towns", q, session, lat, lng }  -> { towns: [{ place_id, name, detail }] }   (Autocomplete, billed per session)
//   { mode: "town", place_id, session }      -> { lat, lng }                               (Place Details, ends the session)
//   { mode: "stations", q, lat, lng }        -> { stations: Station[] }                    (Text Search with fuel prices)
import { adminClient, allowedUser, cors, json } from "./common.ts";

type Grade = "87" | "89" | "93" | "D";
type PriceEntry = { price: number; updated_at: string; source: "google" | "photo" | "manual" };

const FUEL_MAP: Record<string, Grade> = {
  REGULAR_UNLEADED: "87", MIDGRADE: "89", PREMIUM: "93", SP91: "93", SP95: "93", DIESEL: "D",
};
const API = "https://places.googleapis.com/v1";

function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function google(path: string, key: string, mask: string, body?: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.error("places error", path.split("?")[0], res.status, await res.text());
    return null;
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const who = await allowedUser(req);
  if (!who) return json({ error: "not_allowed" }, 403);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return json({ error: "google_not_configured" }, 503);

  let b: { mode?: string; q?: string; session?: string; place_id?: string; lat?: number; lng?: number };
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const q = (b.q ?? "").trim().slice(0, 80);
  const lat = Number(b.lat), lng = Number(b.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
  const bias = hasLoc ? { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } } : undefined;

  if (b.mode === "towns") {
    if (q.length < 2) return json({ towns: [] });
    const out = await google("places:autocomplete", key,
      "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
      { input: q, sessionToken: b.session, includedPrimaryTypes: ["(regions)"], includedRegionCodes: ["us"], locationBias: bias });
    if (!out) return json({ error: "search_failed" }, 502);
    const towns = (out.suggestions ?? []).map((s: any) => s.placePrediction).filter(Boolean).map((p: any) => ({
      place_id: p.placeId, name: p.structuredFormat?.mainText?.text ?? "", detail: p.structuredFormat?.secondaryText?.text ?? "",
    }));
    return json({ towns });
  }

  if (b.mode === "town") {
    if (!b.place_id || !/^[\w-]+$/.test(b.place_id)) return json({ error: "bad_place" }, 400);
    const session = b.session ? `?sessionToken=${encodeURIComponent(b.session)}` : "";
    const out = await google(`places/${b.place_id}${session}`, key, "location");
    if (!out?.location) return json({ error: "search_failed" }, 502);
    return json({ lat: out.location.latitude, lng: out.location.longitude });
  }

  if (b.mode === "stations") {
    if (q.length < 2) return json({ stations: [] });
    const out = await google("places:searchText", key,
      "places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions",
      { textQuery: q, includedType: "gas_station", pageSize: 10, regionCode: "us", locationBias: bias });
    if (!out) return json({ error: "search_failed" }, 502);

    const stations = (out.places ?? []).map((p: any) => {
      const prices: Partial<Record<Grade, PriceEntry>> = {};
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
      const sLat = p.location?.latitude, sLng = p.location?.longitude;
      return {
        place_id: p.id, name: p.displayName?.text ?? "Gas station", address: p.formattedAddress ?? null,
        lat: sLat, lng: sLng, prices,
        distance_mi: hasLoc && Number.isFinite(sLat) ? +miles(lat, lng, sLat, sLng).toFixed(1) : null,
      };
    }).filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

    // Newer driver reports (last 48 hours) win over Google's price.
    if (stations.length) {
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: reports } = await adminClient().from("price_reports")
        .select("place_id,grade,price,source,reported_at")
        .in("place_id", stations.map((s: any) => s.place_id)).in("source", ["photo", "manual"]).gte("reported_at", since);
      for (const r of reports ?? []) {
        const s = stations.find((x: any) => x.place_id === r.place_id);
        const cur = s?.prices[r.grade as Grade];
        if (s && (!cur || r.reported_at > cur.updated_at)) {
          s.prices[r.grade as Grade] = { price: Number(r.price), updated_at: r.reported_at, source: r.source };
        }
      }
    }
    return json({ stations });
  }

  return json({ error: "bad_mode" }, 400);
});
