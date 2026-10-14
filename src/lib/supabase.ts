import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Internal ids stay "87"/"89"/"93" (saved in the database). Google only reports regular, midgrade
// and premium, never octane, so `label` is what pumps in Colorado and other high-altitude states show.
export type Grade = "87" | "89" | "93" | "D";
export const GRADES: { id: Grade; label: string; name: string }[] = [
  { id: "87", label: "85", name: "Regular" },
  { id: "89", label: "87", name: "Plus" },
  { id: "93", label: "91", name: "Premium" },
  { id: "D", label: "D", name: "Diesel" },
];
export const gradeName = (g: Grade) => GRADES.find((x) => x.id === g)?.name ?? "Regular";

export type PriceEntry = { price: number; updated_at: string; source: "google" | "photo" | "manual" };
export type Station = {
  place_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distance_mi: number;
  prices: Partial<Record<Grade, PriceEntry>>;
};
export type Vehicle = {
  id: string; name: string; tank_gal: number | null; grade: Grade; plate: string | null; created_at: string;
  // Official EPA data (null when the vehicle was typed in by hand).
  year: number | null; make: string | null; model: string | null; epa_id: number | null; engine: string | null;
  mpg_combined: number | null; mpg_city: number | null; mpg_highway: number | null; epa_fuel: string | null;
  fuel_req: "85_ok" | "87_min" | "91_required" | "91_recommended" | null; // from the owner's manual / fuel door
};
export type Fillup = {
  id: string; vehicle_id: string | null; station_name: string | null; place_id: string | null; grade: Grade;
  gallons: number; price_per_gal: number; total: number; odometer: number | null; photo_path: string | null; filled_at: string;
};
export type Prefs = {
  monthly_budget: number; weekly_budget: number; vehicle_id: string | null; search_radius_mi: 2 | 5 | 10 | 20; preferred_grade: Grade; price_alert: number | null;
  price_alert_on: boolean; weekly_report_on: boolean;
};

/** Calls a server function with the signed-in user's token. */
export async function callFn<T>(name: string, body: unknown): Promise<{ data?: T; error?: string; status: number }> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${token ?? key}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { error: out.error ?? `http_${res.status}`, status: res.status };
    return { data: out as T, status: res.status };
  } catch {
    return { error: "network", status: 0 };
  }
}
