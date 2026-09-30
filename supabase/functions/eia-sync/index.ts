// Pulls regional retail and wholesale fuel prices from the U.S. EIA into public.market_prices.
// Called daily by pg_cron with the project's anon key (verify_jwt on). It only stores public
// data and skips work if it already ran in the last hour, so extra calls are harmless.
import { createClient } from "npm:@supabase/supabase-js@2";

const START = "2016-01-01"; // long history so the forecast can learn seasonal patterns

// Retail, weekly. Denver for gasoline grades, Rocky Mountain region for diesel (no Denver series).
const RETAIL = [
  "EMM_EPMR_PTE_YDEN_DPG", // Denver regular
  "EMM_EPMM_PTE_YDEN_DPG", // Denver midgrade
  "EMM_EPMP_PTE_YDEN_DPG", // Denver premium
  "EMD_EPD2D_PTE_R40_DPG", // Rocky Mountain diesel
];
// Wholesale spot, daily. Gulf Coast is the closest free benchmark for Colorado supply.
const SPOT = [
  "EER_EPMRU_PF4_RGC_DPG", // Gulf Coast conventional regular gasoline
  "EER_EPD2DXL0_PF4_RGC_DPG", // Gulf Coast ultra-low-sulfur diesel
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function pull(route: string, frequency: string, series: string[], key: string) {
  const q = new URLSearchParams({ api_key: key, frequency, "data[0]": "value", start: START, length: "5000" });
  for (const s of series) q.append("facets[series][]", s);
  const res = await fetch(`https://api.eia.gov/v2/${route}/data/?${q}`);
  if (!res.ok) throw new Error(`eia ${route} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return (out?.response?.data ?? [])
    .map((r: { series: string; period: string; value: unknown }) => ({
      series: r.series, period: r.period, value: Number(r.value),
    }))
    .filter((r: { value: number }) => Number.isFinite(r.value) && r.value > 0);
}

Deno.serve(async () => {
  const key = Deno.env.get("EIA_API_KEY");
  if (!key) return json({ error: "eia_not_configured" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("market_prices").select("series", { count: "exact", head: true }).gte("fetched_at", hourAgo);
  if (count) return json({ skipped: "ran_recently" });

  try {
    const rows = [
      ...(await pull("petroleum/pri/gnd", "weekly", RETAIL, key)),
      // One request per spot series: each is ~2,700 daily rows and EIA caps a request at 5,000.
      ...(await pull("petroleum/pri/spt", "daily", [SPOT[0]], key)),
      ...(await pull("petroleum/pri/spt", "daily", [SPOT[1]], key)),
    ];
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await admin.from("market_prices").upsert(rows.slice(i, i + 1000).map((r) => ({ ...r, fetched_at: now })));
      if (error) throw new Error(error.message);
    }
    const bySeries: Record<string, number> = {};
    for (const r of rows) bySeries[r.series] = (bySeries[r.series] ?? 0) + 1;
    return json({ saved: rows.length, bySeries });
  } catch (e) {
    console.error(String(e));
    return json({ error: "eia_failed", detail: String(e) }, 502);
  }
});
