// Official EPA fuel economy data (fueleconomy.gov) for the Garage vehicle picker.
//   { step: "years" }                          -> { items: [{ value, text }] }
//   { step: "makes", year }                    -> { items }
//   { step: "models", year, make }             -> { items }
//   { step: "options", year, make, model }     -> { items: [{ value: epaId, text }] }
//   { step: "vehicle", id }                    -> { vehicle: {...EPA record subset} }
// Public government data, no key needed. Called with the app's anon key.

const API = "https://www.fueleconomy.gov/ws/rest/vehicle";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function get(path: string) {
  const headers = { Accept: "application/json", "User-Agent": "FillSmart/1.0 (fuel price app; https://fill-smart.vercel.app)" };
  let res = await fetch(`${API}/${path}`, { headers });
  if (res.status === 503) { await new Promise((r) => setTimeout(r, 800)); res = await fetch(`${API}/${path}`, { headers }); }
  if (!res.ok) throw new Error(`epa ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** EPA menus return one object instead of an array when there is a single choice. */
function menu(data: any): { value: string; text: string }[] {
  const items = data?.menuItem;
  if (!items) return [];
  return (Array.isArray(items) ? items : [items]).map((m: any) => ({ value: String(m.value), text: String(m.text) }));
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const q = encodeURIComponent;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: { step?: string; year?: string; make?: string; model?: string; id?: string };
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  try {
    if (b.step === "years") return json({ items: menu(await get("menu/year")) });
    if (b.step === "makes" && b.year) return json({ items: menu(await get(`menu/make?year=${q(b.year)}`)) });
    if (b.step === "models" && b.year && b.make) return json({ items: menu(await get(`menu/model?year=${q(b.year)}&make=${q(b.make)}`)) });
    if (b.step === "options" && b.year && b.make && b.model) {
      return json({ items: menu(await get(`menu/options?year=${q(b.year)}&make=${q(b.make)}&model=${q(b.model)}`)) });
    }
    if (b.step === "vehicle" && b.id && /^\d+$/.test(b.id)) {
      const v = await get(b.id);
      if (!v) return json({ error: "not_found" }, 404);
      return json({
        vehicle: {
          epa_id: Number(v.id), year: Number(v.year), make: v.make, model: v.model,
          // Unrounded values are more precise when present.
          mpg_combined: num(v.comb08U) ?? num(v.comb08), mpg_city: num(v.city08U) ?? num(v.city08), mpg_highway: num(v.highway08U) ?? num(v.highway08),
          epa_fuel: v.fuelType1 ?? v.fuelType ?? null, // e.g. "Regular Gasoline", "Premium Gasoline", "Diesel"
          engine: [v.displ ? `${v.displ} L` : null, v.cylinders ? `${v.cylinders} cyl` : null, v.trany ?? null].filter(Boolean).join(", "),
          drive: v.drive ?? null, atv_type: v.atvType ?? null,
        },
      });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    console.error(String(e));
    return json({ error: "epa_unavailable" }, 502);
  }
});
