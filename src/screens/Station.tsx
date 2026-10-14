import { FormEvent, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CaretLeft, Minus, NavigationArrow, Plus } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { Grade, GRADES, Station as StationT, supabase } from "../lib/supabase";
import { sourceLabel, timeAgo } from "../lib/util";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";
import { activeVehicle, effectiveMpg, ROAD_FACTOR, trueFillCost, usualFill } from "../lib/vehicle";

export default function Station() {
  const { placeId } = useParams();
  const { stations, searched, prefs, vehicles, fillups, reloadStations } = useStore();
  const car = activeVehicle(vehicles, prefs);
  const myMpg = effectiveMpg(fillups, car);
  const myFill = usualFill(fillups, car);
  const id = decodeURIComponent(placeId ?? "");
  const s = stations.find((x) => x.place_id === id) ?? searched.find((x) => x.place_id === id);
  const grade = prefs.preferred_grade;
  const [gal, setGal] = useState(() => Math.round(myFill?.gal ?? 10));
  const [reporting, setReporting] = useState(false);

  const mpg = myMpg?.mpg ?? 25; // 25 MPG is a typical US car when no vehicle is set
  // Compare with the best other option nearby: lowest total for this fill, counting the drive there and back.
  const best = useMemo(() => {
    let pick: { st: StationT; total: number } | null = null;
    for (const x of stations) {
      const p = priceFor(x, grade);
      if (x.place_id === s?.place_id || p == null) continue;
      const total = trueFillCost(x.distance_mi, p, gal, mpg);
      if (!pick || total < pick.total) pick = { st: x, total };
    }
    return pick;
  }, [stations, s, grade, gal, mpg]);

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
  const thisTotal = here != null ? trueFillCost(s.distance_mi, here, gal, mpg) : null;
  const net = thisTotal != null && best ? best.total - thisTotal : null; // > 0 means this station is cheaper overall
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
                <dt style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>{g.id === "D" ? g.name : `${g.label} ${g.name}`}</dt>
                <dd>{s.prices[g.id] ? <PumpPrice price={s.prices[g.id]!.price} size={18} /> : <span style={{ color: "var(--ink-2)" }}>--</span>}</dd>
              </div>
            ))}
          </dl>
          {here != null && myFill && (
            <p className="tnum" style={{ fontSize: 15, fontWeight: 700 }}>
              Your usual fill here: ${(here * myFill.gal).toFixed(2)}
              <span style={{ fontWeight: 500, color: "var(--ink-2)" }}> · {myFill.gal.toFixed(1)} gal{myFill.source === "tank" ? ", 3/4 of your tank" : ", from your recent fills"}</span>
            </p>
          )}
        </Section>

        {net != null && best && thisTotal != null && (
          <Section id="wtd" title="Worth the drive?" hint={`Compared with your best other option nearby, counting the gas to get there and back. ${myFill?.source === "history" ? "Starts at your usual fill" : "Set how much you'll pump"}.`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <button className="nb" aria-label="Fewer gallons" onClick={() => setGal(Math.max(1, gal - 1))}><Minus size={22} /></button>
              <div role="status" style={{ textAlign: "center", display: "flex", flexDirection: "column" }}>
                <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>{gal} gallons</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: net >= 0.005 ? "#1F7A4A" : "#A8170F" }}>
                  {net >= 0.005 ? `Best deal, $${net.toFixed(2)} less` : `${best.st.name.split(" ").slice(0, 2).join(" ")} saves $${Math.abs(net).toFixed(2)}`}
                </span>
                <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)" }}>Here ${thisTotal.toFixed(2)} · {best.st.name.length > 18 ? best.st.name.slice(0, 17) + "…" : best.st.name} ${best.total.toFixed(2)}</span>
              </div>
              <button className="nb" aria-label="More gallons" onClick={() => setGal(Math.min(40, gal + 1))}><Plus size={22} /></button>
            </div>
            <p className="hint">
              {car && myMpg ? `For your ${car.name} at ${myMpg.mpg.toFixed(1)} MPG (${myMpg.source === "measured" ? "measured from your fill-ups" : "EPA rating"})` : "For a typical 25 MPG car. Add your vehicle in Garage for your real numbers"}
              {`. Here is ${(s.distance_mi * 2 * ROAD_FACTOR).toFixed(1)} road miles there and back, ${best.st.name} ${(best.st.distance_mi * 2 * ROAD_FACTOR).toFixed(1)}.`}
            </p>
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
              <span className="n" style={{ fontSize: 18 }}>{g.label}</span><span className="s">{g.name}</span>
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
