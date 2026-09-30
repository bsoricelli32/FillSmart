import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CaretLeft, Minus, NavigationArrow, Plus } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { Grade, GRADES, supabase } from "../lib/supabase";
import { sourceLabel, timeAgo } from "../lib/util";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";

export default function Station() {
  const { placeId } = useParams();
  const { stations, searched, prefs, vehicles, reloadStations } = useStore();
  const id = decodeURIComponent(placeId ?? "");
  const s = stations.find((x) => x.place_id === id) ?? searched.find((x) => x.place_id === id);
  const grade = prefs.preferred_grade;
  const [gal, setGal] = useState(() => Math.round((vehicles[0]?.tank_gal ?? 14) * 0.8));
  const [reporting, setReporting] = useState(false);

  // Compare against the closest other station that has a price for this grade.
  const nearest = useMemo(() => {
    return stations.filter((x) => x.place_id !== s?.place_id && priceFor(x, grade) != null).sort((a, b) => a.distance_mi - b.distance_mi)[0];
  }, [stations, s, grade]);

  if (!s) {
    return (
      <div className="screen">
        <Bar left={<Link to="/" className="nb" aria-label="Back to prices"><CaretLeft size={22} /></Link>} title="Station" />
        <main className="main"><div className="raised-sm empty"><p>This station isn't loaded. Go back to Prices and try again.</p></div></main>
        <TabDock />
      </div>
    );
  }

  const here = priceFor(s, grade);
  const there = nearest ? priceFor(nearest, grade)! : undefined;
  const extraMiles = nearest ? Math.max(0, (s.distance_mi - nearest.distance_mi) * 2) : 0;
  const mpg = 22;
  const save = here != null && there != null ? (there - here) * gal : null;
  const driveCost = here != null ? (extraMiles / mpg) * here : 0;
  const net = save != null ? save - driveCost : null;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&destination_place_id=${encodeURIComponent(s.place_id)}`;
  const newest = Object.values(s.prices).sort((a, b) => (b!.updated_at > a!.updated_at ? 1 : -1))[0];

  return (
    <div className="screen">
      <div className="hero">
        <Bar left={<Link to="/" className="nb" aria-label="Back to prices"><CaretLeft size={22} /></Link>} title="Station" />
        <div style={{ textAlign: "center", padding: "4px 20px 12px" }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.2 }}>{s.name}</h1>
          <p style={{ fontSize: 15, color: "var(--ink-2)" }}>{[s.address?.split(",")[0], `${s.distance_mi} mi`].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      <main className="main" style={{ paddingTop: 8 }}>
        <Section id="pp" title="Posted prices" hint={newest ? `Updated ${timeAgo(newest.updated_at)} from ${sourceLabel(newest.source)}. Tap Report price if one looks wrong.` : "No prices yet. Be the first to report one."}>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {GRADES.map((g) => (
              <div key={g.id} className="raised-sm" style={{ borderRadius: 20, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <dt style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>{g.name}</dt>
                <dd>{s.prices[g.id] ? <PumpPrice price={s.prices[g.id]!.price} size={18} /> : <span style={{ color: "var(--ink-2)" }}>--</span>}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {here != null && there != null && nearest && nearest.distance_mi < s.distance_mi && here < there && (
          <Section id="wtd" title="Worth the drive?" hint={`Compared with ${nearest.name}, ${nearest.distance_mi} mi away. Set how much you'll pump.`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <button className="nb" aria-label="Fewer gallons" onClick={() => setGal(Math.max(2, gal - 2))}><Minus size={22} /></button>
              <div role="status" style={{ textAlign: "center", display: "flex", flexDirection: "column" }}>
                <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>{gal} gallons</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: net! > 0 ? "#1F7A4A" : "#A8170F" }}>
                  {net! > 0 ? `Worth it, $${net!.toFixed(2)} ahead` : `Skip it, $${Math.abs(net!).toFixed(2)} behind`}
                </span>
                <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)" }}>Save ${Math.max(0, save!).toFixed(2)} · extra drive ${driveCost.toFixed(2)}</span>
              </div>
              <button className="nb" aria-label="More gallons" onClick={() => setGal(Math.min(40, gal + 2))}><Plus size={22} /></button>
            </div>
          </Section>
        )}

        <div style={{ display: "flex", gap: 14 }}>
          <a href={directions} target="_blank" rel="noreferrer" className="pillbtn accent" style={{ flexGrow: 1 }}><NavigationArrow size={18} weight="fill" aria-hidden />Directions</a>
          <button className="pillbtn" onClick={() => setReporting(true)}>Report price</button>
        </div>
      </main>

      {reporting && <ReportSheet stationId={s.place_id} name={s.name} lat={s.lat} lng={s.lng} defaultGrade={grade} onClose={(saved) => { setReporting(false); if (saved) reloadStations(); }} />}
      <TabDock />
    </div>
  );
}

function ReportSheet({ stationId, name, lat, lng, defaultGrade, onClose }: { stationId: string; name: string; lat: number; lng: number; defaultGrade: Grade; onClose: (saved: boolean) => void }) {
  const { userId } = useStore();
  const [grade, setGrade] = useState<Grade>(defaultGrade);
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = parseFloat(price);
    if (!(p > 0.5 && p < 15)) { setErr("Enter the price per gallon, like 3.199."); return; }
    setBusy(true);
    const { error } = await supabase.from("price_reports").insert({ user_id: userId, place_id: stationId, station_name: name, lat, lng, grade, price: p, source: "manual" });
    setBusy(false);
    if (error) setErr("Couldn't save. Try again."); else onClose(true);
  }

  return (
    <div className="sheet-bg" onClick={() => onClose(false)}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-labelledby="rp">
        <div>
          <h2 id="rp" className="h2">Report a price</h2>
          <p className="hint">Enter what the sign or pump shows at {name}.</p>
        </div>
        <div role="group" aria-label="Grade" style={{ display: "flex", gap: 10 }}>
          {GRADES.map((g) => (
            <button type="button" key={g.id} className={"grade" + (g.id === grade ? " on" : "")} aria-pressed={g.id === grade} onClick={() => setGrade(g.id)} style={{ height: 56 }}>
              <span className="n" style={{ fontSize: 18 }}>{g.id}</span><span className="s">{g.name}</span>
            </button>
          ))}
        </div>
        <div className="sunk field">
          <label htmlFor="rpp">Price per gallon</label>
          <input id="rpp" inputMode="decimal" placeholder="3.199" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" className="pillbtn" onClick={() => onClose(false)}>Cancel</button>
          <button type="submit" className="pillbtn accent" style={{ flexGrow: 1 }} disabled={busy}>{busy ? "Saving" : "Save price"}</button>
        </div>
      </form>
    </div>
  );
}
