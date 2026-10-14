import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CaretLeft, DownloadSimple, Plus } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { supabase } from "../lib/supabase";
import { Bar, Section, TabDock } from "../components/TabDock";
import { activeVehicle, effectiveMpg } from "../lib/vehicle";
import { cents, exportCsv, IRS_RATES, Purpose, PURPOSES, summarize, toCsv, Trip, yearOf } from "../lib/mileage";

const DAY = 86400000;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const pname = (p: Purpose) => PURPOSES.find((x) => x.id === p)!.name;

export async function loadTrips(): Promise<Trip[]> {
  const { data } = await supabase.from("trips").select("*").order("trip_date", { ascending: false }).order("created_at", { ascending: false });
  return (data ?? []).map((t) => ({ ...t, miles: Number(t.miles) }));
}

export default function Mileage() {
  const { vehicles, fillups, prefs, stations } = useStore();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [editing, setEditing] = useState<Trip | "new" | null>(null);
  const reload = useCallback(async () => setTrips(await loadTrips()), []);
  useEffect(() => { reload(); }, [reload]);

  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([thisYear, ...(trips ?? []).map(yearOf)])].sort((a, b) => b - a).slice(0, 3), [trips, thisYear]);
  const [year, setYear] = useState(thisYear);
  const s = summarize(trips ?? [], year);
  const vName = (id: string | null) => vehicles.find((v) => v.id === id)?.name ?? "";

  // What the gas alone cost for business miles: your MPG and what you've paid per gallon lately.
  const car = activeVehicle(vehicles, prefs);
  const mpg = effectiveMpg(fillups, car);
  const recentFills = fillups.filter((f) => new Date(f.filled_at).getTime() > Date.now() - 90 * DAY && (!car || f.vehicle_id === car.id));
  const paid = recentFills.length ? recentFills.reduce((a, f) => a + f.total, 0) / recentFills.reduce((a, f) => a + f.gallons, 0) : null;
  const nearby = stations.map((x) => priceFor(x, prefs.preferred_grade)).filter((p): p is number => p != null).sort((a, b) => a - b);
  const gasPrice = paid ?? (nearby.length ? nearby[Math.floor(nearby.length / 2)] : null);
  const biz = s.rows.find((r) => r.purpose === "business");
  const gasPerMile = mpg && gasPrice ? gasPrice / mpg.mpg : null;

  const shown = (trips ?? []).filter((t) => yearOf(t) === year);
  const months = new Map<string, Trip[]>();
  for (const t of shown) { const k = t.trip_date.slice(0, 7); months.set(k, [...(months.get(k) ?? []), t]); }

  return (
    <div className="screen">
      <Bar left={<Link to="/garage" className="nb" aria-label="Back to Garage"><CaretLeft size={22} /></Link>} title="Mileage log" />
      <main className="main">
        {years.length > 1 && (
          <div className="nseg" role="group" aria-label="Year" style={{ alignSelf: "center" }}>
            {years.map((y) => <button key={y} className={y === year ? "on" : ""} aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}
          </div>
        )}

        <Section id="ms" title={`${year} at IRS rates`} hint={IRS_RATES[year] ? `IRS standard rates for ${year}: business ${cents(IRS_RATES[year].business)}, medical ${cents(IRS_RATES[year].medical)}, charity ${cents(IRS_RATES[year].charity)} a mile.` : `The IRS rate for ${year} isn't in FillSmart yet.`}>
          <div className="raised-sm" style={{ borderRadius: 20, padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{money(s.deductible)}</span>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Business, medical and charity miles at the standard rate</span>
            </div>
            {s.rows.length ? (
              <dl style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {s.rows.map((r) => (
                  <div key={r.purpose} className="tnum" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
                    <dt style={{ fontWeight: 700 }}>{pname(r.purpose)}</dt>
                    <dd style={{ color: "var(--ink-2)", textAlign: "right" }}>
                      {r.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi{r.rate != null ? <> × {cents(r.rate)} = <strong style={{ color: "var(--ink)" }}>{money(r.amount!)}</strong></> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : <p className="hint">No trips logged for {year} yet.</p>}
            {biz && gasPerMile != null && (
              <p style={{ fontSize: 14, lineHeight: 1.45 }}>
                Gas for your business miles cost about <strong className="tnum">{money(biz.miles * gasPerMile)}</strong> ({cents(gasPerMile)} a mile at {mpg!.mpg.toFixed(1)} MPG and ${gasPrice!.toFixed(2)} a gallon). The standard rate also covers wear, insurance and depreciation.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="pillbtn accent" style={{ flexGrow: 1 }} onClick={() => setEditing("new")}><Plus size={18} weight="bold" />Add trip</button>
            <button className="pillbtn" disabled={!shown.length} onClick={() => exportCsv(toCsv(trips ?? [], year, vName), `FillSmart mileage ${year}.csv`)}><DownloadSimple size={18} />CSV</button>
          </div>
          <p className="hint">Keep the date, miles, where you went and why for each trip. The CSV has all of it, ready for your tax preparer. FillSmart isn't tax advice.</p>
        </Section>

        {[...months.entries()].map(([m, ts]) => (
          <Section key={m} id={`m${m}`} title={new Date(m + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}>
            <ul>
              {ts.map((t) => {
                const r = s.rows.find((x) => x.purpose === t.purpose)?.rate ?? null;
                return (
                  <li key={t.id}>
                    <button onClick={() => setEditing(t)} style={{ width: "100%", border: 0, background: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: "1px solid var(--lo)", textAlign: "left", color: "var(--ink)", font: "inherit" }}>
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.destination || t.note || pname(t.purpose)}</span>
                        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{new Date(t.trip_date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {pname(t.purpose)}</span>
                      </span>
                      <span className="tnum" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
                        <span style={{ fontWeight: 800 }}>{t.miles.toFixed(1)} mi</span>
                        {r != null && <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{money(t.miles * r)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
      </main>
      {editing && <TripSheet trip={editing === "new" ? null : editing} trips={trips ?? []} onClose={async (changed) => { setEditing(null); if (changed) await reload(); }} />}
      <TabDock />
    </div>
  );
}

function TripSheet({ trip, trips, onClose }: { trip: Trip | null; trips: Trip[]; onClose: (changed: boolean) => void }) {
  const { vehicles, fillups, prefs } = useStore();
  const [vehicleId, setVehicleId] = useState<string | null>(trip?.vehicle_id ?? activeVehicle(vehicles, prefs)?.id ?? null);
  const [date, setDate] = useState(trip?.trip_date ?? today());
  const [purpose, setPurpose] = useState<Purpose>(trip?.purpose ?? (trips[0]?.purpose ?? "business"));
  const [useOdo, setUseOdo] = useState(trip ? trip.odo_start != null : false);
  const [miles, setMiles] = useState(trip ? String(trip.miles) : "");
  const [roundTrip, setRoundTrip] = useState(false);
  const [odoStart, setOdoStart] = useState(trip?.odo_start != null ? String(trip.odo_start) : "");
  const [odoEnd, setOdoEnd] = useState(trip?.odo_end != null ? String(trip.odo_end) : "");
  const [origin, setOrigin] = useState(trip?.origin ?? "");
  const [dest, setDest] = useState(trip?.destination ?? "");
  const [note, setNote] = useState(trip?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Starting odometer: where your last trip or fill-up with this car left off.
  function startOdo() {
    if (odoStart) return;
    const lastTrip = trips.filter((t) => t.vehicle_id === vehicleId && t.odo_end != null).map((t) => t.odo_end!);
    const lastFill = fillups.filter((f) => f.vehicle_id === vehicleId && f.odometer != null).map((f) => f.odometer!);
    const best = Math.max(0, ...lastTrip, ...lastFill);
    if (best > 0) setOdoStart(String(best));
  }

  const odoMiles = useOdo && odoStart && odoEnd ? parseInt(odoEnd) - parseInt(odoStart) : null;
  const total = useOdo ? odoMiles : (parseFloat(miles) || 0) * (roundTrip ? 2 : 1);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!total || !(total > 0)) { setErr(useOdo ? "Ending odometer must be higher than the start." : "Enter the miles you drove."); return; }
    if (total >= 5000) { setErr("That's more than 5,000 miles. Log long trips one day at a time."); return; }
    if (purpose === "business" && !note.trim()) { setErr("Add the business purpose. The IRS asks for it on every business trip."); return; }
    setBusy(true);
    const row = {
      vehicle_id: vehicleId, trip_date: date, purpose, miles: Math.round(total * 10) / 10,
      odo_start: useOdo ? parseInt(odoStart) : null, odo_end: useOdo ? parseInt(odoEnd) : null,
      origin: origin.trim() || null, destination: dest.trim() || null, note: note.trim() || null,
    };
    const { error } = trip ? await supabase.from("trips").update(row).eq("id", trip.id) : await supabase.from("trips").insert(row);
    setBusy(false);
    if (error) setErr("Couldn't save. Try again."); else onClose(true);
  }
  async function remove() {
    if (!trip || !confirm("Delete this trip?")) return;
    await supabase.from("trips").delete().eq("id", trip.id);
    onClose(true);
  }

  return (
    <div className="sheet-bg" onClick={() => onClose(false)}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-labelledby="ts">
        <h2 id="ts" className="h2">{trip ? "Edit trip" : "Log a trip"}</h2>
        <div className="nseg" role="group" aria-label="Purpose">
          {PURPOSES.map((p) => <button type="button" key={p.id} className={p.id === purpose ? "on" : ""} aria-pressed={p.id === purpose} onClick={() => setPurpose(p.id)} style={{ flex: 1, padding: "0 4px" }}>{p.name}</button>)}
        </div>
        <div className="sunk field"><label htmlFor="td">Date</label><input id="td" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></div>
        {vehicles.length > 1 && (
          <div className="sunk field"><label htmlFor="tv">Vehicle</label>
            <select id="tv" value={vehicleId ?? ""} onChange={(e) => setVehicleId(e.target.value || null)}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          </div>
        )}
        <div className="nseg" role="group" aria-label="Distance from">
          <button type="button" className={!useOdo ? "on" : ""} aria-pressed={!useOdo} onClick={() => setUseOdo(false)} style={{ flex: 1 }}>Miles</button>
          <button type="button" className={useOdo ? "on" : ""} aria-pressed={useOdo} onClick={() => { setUseOdo(true); startOdo(); }} style={{ flex: 1 }}>Odometer</button>
        </div>
        {useOdo ? (
          <>
            <div className="sunk field"><label htmlFor="to1">Start</label><input id="to1" inputMode="numeric" value={odoStart} onChange={(e) => setOdoStart(e.target.value.replace(/\D/g, ""))} placeholder="odometer" /></div>
            <div className="sunk field"><label htmlFor="to2">End</label><input id="to2" inputMode="numeric" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value.replace(/\D/g, ""))} placeholder="odometer" /></div>
          </>
        ) : (
          <>
            <div className="sunk field"><label htmlFor="tm">Miles</label><input id="tm" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} placeholder="12.4" /></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 }}>
              <span id="rt" style={{ fontSize: 15, fontWeight: 700 }}>Round trip (doubles the miles)</span>
              <button type="button" className={"switch" + (roundTrip ? " on" : "")} role="switch" aria-checked={roundTrip} aria-labelledby="rt" onClick={() => setRoundTrip(!roundTrip)}><span className="cap" /></button>
            </div>
          </>
        )}
        <div className="sunk field"><label htmlFor="tf">From</label><input id="tf" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="optional" /></div>
        <div className="sunk field"><label htmlFor="tt">To</label><input id="tt" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Client office, Boulder" /></div>
        <div className="sunk field"><label htmlFor="tn">{purpose === "business" ? "Business purpose" : "Note"}</label><input id="tn" value={note} onChange={(e) => setNote(e.target.value)} placeholder={purpose === "business" ? "Site visit" : "optional"} /></div>
        {total != null && total > 0 && <p className="hint tnum" role="status">{(Math.round(total * 10) / 10).toFixed(1)} miles{purpose !== "personal" && IRS_RATES[Number(date.slice(0, 4))] ? `, ${money(total * IRS_RATES[Number(date.slice(0, 4))][purpose])} at the IRS rate` : ""}</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <div style={{ display: "flex", gap: 12 }}>
          {trip ? <button type="button" className="pillbtn" onClick={remove}>Delete</button> : <button type="button" className="pillbtn" onClick={() => onClose(false)}>Cancel</button>}
          <button type="submit" className="pillbtn accent" style={{ flexGrow: 1 }} disabled={busy}>{busy ? "Saving" : "Save trip"}</button>
        </div>
      </form>
    </div>
  );
}
