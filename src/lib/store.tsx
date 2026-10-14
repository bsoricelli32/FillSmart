import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { callFn, Fillup, Grade, Prefs, Station, supabase, Vehicle } from "./supabase";
import { DEFAULT_LOCATION } from "./util";
import { syncPush } from "./push";

type Loc = { lat: number; lng: number; label: string; precise: boolean; manual?: boolean };

type Store = {
  userId: string;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  vehicles: Vehicle[];
  reloadVehicles: () => Promise<void>;
  fillups: Fillup[];
  reloadFillups: () => Promise<void>;
  loc: Loc;
  locate: () => void;
  setPlace: (p: { lat: number; lng: number; label: string }) => void;
  /** Stations found by search (can be anywhere). The Station screen looks here too. */
  searched: Station[];
  setSearched: (s: Station[]) => void;
  stations: Station[];
  stationsLoading: boolean;
  stationsError: string | null;
  googleConfigured: boolean;
  reloadStations: (refresh?: boolean) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

const DEFAULT_PREFS: Prefs = { monthly_budget: 220, weekly_budget: 50, vehicle_id: null, search_radius_mi: 5, preferred_grade: "87", price_alert: 3.1, price_alert_on: true, weekly_report_on: true, alert_lat: null, alert_lng: null, alert_label: null, tz: null };

export function StoreProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [loc, setLoc] = useState<Loc>(() => {
    try {
      const saved = localStorage.getItem("pl_loc");
      if (saved) return JSON.parse(saved);
    } catch { /* storage unavailable */ }
    return { ...DEFAULT_LOCATION, precise: false };
  });
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [searched, setSearched] = useState<Station[]>([]);
  const saveTimer = useRef<number>();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    supabase.from("user_prefs").select("*").maybeSingle().then(async ({ data }) => {
      if (data) setPrefsState({ ...DEFAULT_PREFS, ...data, tz: tz || data.tz, monthly_budget: Number(data.monthly_budget), weekly_budget: Number(data.weekly_budget ?? 50), search_radius_mi: Number(data.search_radius_mi ?? 5) as Prefs["search_radius_mi"], price_alert: data.price_alert == null ? null : Number(data.price_alert) });
      else { setPrefsState((cur) => ({ ...cur, tz })); await supabase.from("user_prefs").insert({}); }
      // Keep the time zone current for the Sunday report.
      if (tz && data?.tz !== tz) await supabase.from("user_prefs").update({ tz }).eq("user_id", userId);
    });
    syncPush();
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "push-resubscribe") syncPush(); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [userId]);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        supabase.from("user_prefs").upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() });
      }, 500);
      return next;
    });
  }, [userId]);

  const reloadVehicles = useCallback(async () => {
    const { data } = await supabase.from("vehicles").select("*").order("created_at");
    const n = (x: unknown) => (x == null ? null : Number(x));
    setVehicles((data ?? []).map((v) => ({ ...v, tank_gal: n(v.tank_gal), mpg_combined: n(v.mpg_combined), mpg_city: n(v.mpg_city), mpg_highway: n(v.mpg_highway) })));
  }, []);

  const reloadFillups = useCallback(async () => {
    const since = new Date(); since.setMonth(since.getMonth() - 13);
    const { data } = await supabase.from("fillups").select("*").gte("filled_at", since.toISOString()).order("filled_at", { ascending: false });
    setFillups((data ?? []).map((f) => ({ ...f, gallons: Number(f.gallons), price_per_gal: Number(f.price_per_gal), total: Number(f.total) })));
  }, []);

  const reloadStations = useCallback(async (refresh = false) => {
    setStationsLoading(true);
    setStationsError(null);
    const res = await callFn<{ stations: Station[]; google_configured: boolean }>("nearby-prices", { lat: loc.lat, lng: loc.lng, radius_m: Math.round(prefs.search_radius_mi * 1609.34), refresh });
    setStationsLoading(false);
    if (res.error) { setStationsError(res.error); return; }
    setStations(res.data!.stations);
    setGoogleConfigured(res.data!.google_configured);
  }, [loc.lat, loc.lng, prefs.search_radius_mi]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Near you", precise: true };
        setLoc(next);
        try { localStorage.setItem("pl_loc", JSON.stringify(next)); } catch { /* ignore */ }
      },
      () => { /* denied: keep current location */ },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  /** A town or ZIP the user picked. Stays until they tap "Use my location". */
  const setPlace = useCallback((p: { lat: number; lng: number; label: string }) => {
    const next = { ...p, precise: false, manual: true };
    setLoc(next);
    try { localStorage.setItem("pl_loc", JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    reloadVehicles(); reloadFillups();
    if (!loc.manual) locate();
    // Only on first load: a picked place should not be replaced by GPS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadVehicles, reloadFillups, locate]);
  useEffect(() => { reloadStations(); }, [reloadStations]);

  return (
    <Ctx.Provider value={{ userId, prefs, setPrefs, vehicles, reloadVehicles, fillups, reloadFillups, loc, locate, setPlace, searched, setSearched, stations, stationsLoading, stationsError, googleConfigured, reloadStations }}>
      {children}
    </Ctx.Provider>
  );
}

export const priceFor = (s: Station, g: Grade) => s.prices[g]?.price;
