import { useEffect, useMemo, useState } from "react";
import { Crosshair, MagnifyingGlass, MapPin } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { callFn } from "../lib/supabase";

type Town = { place_id: string; name: string; detail: string };

/** Bottom sheet: search a town or ZIP and make it the price location, or go back to GPS. */
export function PlaceSheet({ onClose }: { onClose: () => void }) {
  const { loc, locate, setPlace } = useStore();
  const session = useMemo(() => crypto.randomUUID(), []); // one Google billing session per open
  const [q, setQ] = useState("");
  const [towns, setTowns] = useState<Town[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setTowns([]); setErr(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      setBusy(true);
      const res = await callFn<{ towns: Town[] }>("search-places", { mode: "towns", q: text, session, lat: loc.lat, lng: loc.lng });
      if (!live) return;
      setBusy(false);
      if (res.error) { setErr("Search isn't working right now. Try again."); return; }
      setErr(null);
      setTowns(res.data!.towns);
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, session, loc.lat, loc.lng]);

  async function pick(t: Town) {
    setBusy(true);
    const res = await callFn<{ lat: number; lng: number }>("search-places", { mode: "town", place_id: t.place_id, session });
    setBusy(false);
    if (res.error || !res.data) { setErr("Couldn't open that place. Try another."); return; }
    setPlace({ lat: res.data.lat, lng: res.data.lng, label: t.name });
    onClose();
  }

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-labelledby="ps" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 id="ps" className="h2">Choose a location</h2>
          <p className="hint">Search a town, neighborhood or ZIP to see its prices.</p>
        </div>
        <label className="sunk field" style={{ justifyContent: "flex-start" }}>
          <MagnifyingGlass size={18} color="var(--ink-2)" aria-hidden />
          <span className="sr-only">Town or ZIP</span>
          <input type="search" placeholder="Fort Collins or 80501" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            style={{ textAlign: "left", fontWeight: 600 }} />
          {busy && <span className="spin" aria-label="Searching" />}
        </label>
        <ul style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "40dvh", overflowY: "auto" }}>
          {!q.trim() && (
            <li>
              <button className="srow" onClick={() => { locate(); onClose(); }}>
                <span className="nb xs accent" aria-hidden><Crosshair size={18} weight="fill" /></span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>Use my location</span>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{loc.manual ? `Now showing ${loc.label}` : "Uses your phone's GPS"}</span>
                </span>
              </button>
            </li>
          )}
          {towns.map((t) => (
            <li key={t.place_id}>
              <button className="srow" onClick={() => pick(t)} disabled={busy}>
                <span className="nb xs" aria-hidden><MapPin size={18} /></span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                  <span style={{ fontSize: 13, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.detail}</span>
                </span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && !busy && !err && towns.length === 0 && <li className="hint" style={{ padding: "8px 14px" }}>No places match "{q.trim()}".</li>}
        </ul>
        {err && <p className="err" role="alert">{err}</p>}
        <button type="button" className="pillbtn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
