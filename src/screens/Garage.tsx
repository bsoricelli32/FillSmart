import { FormEvent, useMemo, useState } from "react";
import { CarProfile, PencilSimple, Plus, SignOut, Warning } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { Grade, GRADES, supabase, Vehicle } from "../lib/supabase";
import { Bar, Section, TabDock } from "../components/TabDock";

export default function Garage() {
  const { vehicles, fillups, prefs, setPrefs, reloadVehicles } = useStore();
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [vi, setVi] = useState(0);
  const v = vehicles[vi] ?? vehicles[0];

  const stats = useMemo(() => {
    if (!v) return null;
    const mine = fillups.filter((f) => f.vehicle_id === v.id && f.odometer != null).sort((a, b) => a.odometer! - b.odometer!);
    const legs: { mpg: number; miles: number; cost: number; at: number }[] = [];
    for (let i = 1; i < mine.length; i++) {
      const miles = mine[i].odometer! - mine[i - 1].odometer!;
      if (miles > 0 && miles < 1500) legs.push({ mpg: miles / mine[i].gallons, miles, cost: mine[i].total, at: new Date(mine[i].filled_at).getTime() });
    }
    if (!legs.length) return { lastOdo: mine[mine.length - 1]?.odometer ?? null, mpg: null, cpm: null, drop: null };
    const recent = legs.filter((l) => l.at > Date.now() - 30 * 86400000);
    const use = recent.length ? recent : legs.slice(-3);
    const miles = use.reduce((a, l) => a + l.miles, 0);
    const mpg = miles / use.reduce((a, l) => a + l.miles / l.mpg, 0);
    const cpm = use.reduce((a, l) => a + l.cost, 0) / miles;
    const all = legs.reduce((a, l) => a + l.miles, 0) / legs.reduce((a, l) => a + l.miles / l.mpg, 0);
    const last = legs[legs.length - 1].mpg;
    return { lastOdo: mine[mine.length - 1].odometer, mpg, cpm, drop: legs.length >= 3 && all - last >= 1 ? all - last : null };
  }, [v, fillups]);

  return (
    <div className="screen">
      <div className="hero">
        <Bar title="Garage" right={<button className="nb" aria-label="Add vehicle" onClick={() => setEditing("new")}><Plus size={22} /></button>} />
        {v ? (
          <section aria-label={v.name} style={{ padding: "0 20px 8px", display: "flex", gap: 14, alignItems: "center" }}>
            <div className="dome" style={{ width: 64, height: 64, borderRadius: 32, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#C21F1A" }}><CarProfile size={30} weight="fill" /></div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800 }}>{v.name}</h2>
              <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{[v.tank_gal ? `${v.tank_gal} gal tank` : null, GRADES.find((g) => g.id === v.grade)?.name].filter(Boolean).join(" · ")}</span>
              <span className="tnum" style={{ fontSize: 14, color: "var(--ink-2)" }}>{[stats?.lastOdo ? `${stats.lastOdo.toLocaleString()} mi` : null, v.plate].filter(Boolean).join(" · ") || "Add your odometer when you scan"}</span>
            </div>
            <button className="nb xs" aria-label={`Edit ${v.name}`} onClick={() => setEditing(v)}><PencilSimple size={18} /></button>
          </section>
        ) : (
          <div style={{ padding: "0 20px 8px" }}>
            <div className="raised-sm empty">
              <p>Add your vehicle to track MPG and cost per mile.</p>
              <button className="pillbtn accent" onClick={() => setEditing("new")}><Plus size={18} />Add vehicle</button>
            </div>
          </div>
        )}
        {vehicles.length > 1 && (
          <div className="nseg" role="group" aria-label="Choose vehicle" style={{ margin: "6px 20px 0", overflowX: "auto" }}>
            {vehicles.map((x, i) => <button key={x.id} className={i === vi ? "on" : ""} aria-pressed={i === vi} onClick={() => setVi(i)}>{x.name}</button>)}
          </div>
        )}
      </div>

      <main className="main" style={{ paddingTop: 18 }}>
        {v && (
          <Section id="eff" title="Efficiency" hint="Enter your odometer each time you scan. MPG assumes you fill the tank.">
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div className="sunk" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>MPG · 30 DAYS</dt><dd className="tnum" style={{ fontSize: 24, fontWeight: 800 }}>{stats?.mpg ? stats.mpg.toFixed(1) : "--"}</dd></div>
              <div className="sunk" style={{ borderRadius: 18, padding: "10px 14px" }}><dt style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>COST PER MILE</dt><dd className="tnum" style={{ fontSize: 24, fontWeight: 800 }}>{stats?.cpm ? `$${stats.cpm.toFixed(2)}` : "--"}</dd></div>
            </dl>
            {stats?.drop && (
              <p role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: "#7A4B00" }}>
                <Warning size={18} weight="fill" style={{ flex: "none", marginTop: 1 }} />
                <span>Your last tank was {stats.drop.toFixed(1)} MPG below your average. Check tire pressure and the air filter.</span>
              </p>
            )}
            {!stats?.mpg && <p className="hint">MPG shows up after two fill-ups with odometer readings.</p>}
          </Section>
        )}

        <Section id="nt" title="Notifications" hint="FillSmart saves these now. Alerts start arriving in a later update.">
          <ul>
            <li style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
              <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
                <span id="l1" style={{ fontSize: 16, fontWeight: 700 }}>Price drop alert</span>
                <label style={{ fontSize: 13, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4 }}>
                  When {GRADES.find((g) => g.id === prefs.preferred_grade)?.name.toLowerCase()} nearby is under $
                  <input aria-label="Alert price" inputMode="decimal" defaultValue={prefs.price_alert?.toFixed(2) ?? ""} onBlur={(e) => { const n = parseFloat(e.target.value); setPrefs({ price_alert: n > 0 ? n : null }); }} style={{ width: 52, border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: "var(--ink)" }} />
                </label>
              </div>
              <button className={"switch" + (prefs.price_alert_on ? " on" : "")} role="switch" aria-checked={prefs.price_alert_on} aria-labelledby="l1" onClick={() => setPrefs({ price_alert_on: !prefs.price_alert_on })}><span className="cap" /></button>
            </li>
            <li style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
              <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
                <span id="l2" style={{ fontSize: 16, fontWeight: 700 }}>Weekly spend report</span>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Sunday evening</span>
              </div>
              <button className={"switch" + (prefs.weekly_report_on ? " on" : "")} role="switch" aria-checked={prefs.weekly_report_on} aria-labelledby="l2" onClick={() => setPrefs({ weekly_report_on: !prefs.weekly_report_on })}><span className="cap" /></button>
            </li>
          </ul>
        </Section>

        <button className="pillbtn" onClick={() => supabase.auth.signOut()}><SignOut size={18} />Sign out</button>
      </main>

      {editing && <VehicleSheet vehicle={editing === "new" ? null : editing} onClose={async (changed) => { setEditing(null); if (changed) await reloadVehicles(); }} />}
      <TabDock />
    </div>
  );
}

function VehicleSheet({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: (changed: boolean) => void }) {
  const [name, setName] = useState(vehicle?.name ?? "");
  const [tank, setTank] = useState(vehicle?.tank_gal?.toString() ?? "");
  const [grade, setGrade] = useState<Grade>(vehicle?.grade ?? "87");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Give your vehicle a name, like 2019 Toyota Tacoma."); return; }
    const row = { name: name.trim(), tank_gal: tank ? parseFloat(tank) : null, grade, plate: plate.trim() || null };
    const { error } = vehicle ? await supabase.from("vehicles").update(row).eq("id", vehicle.id) : await supabase.from("vehicles").insert(row);
    if (error) setErr("Couldn't save. Try again."); else onClose(true);
  }

  async function remove() {
    if (!vehicle || !confirm(`Remove ${vehicle.name}? Its fill-ups stay in your spend history.`)) return;
    await supabase.from("vehicles").delete().eq("id", vehicle.id);
    onClose(true);
  }

  return (
    <div className="sheet-bg" onClick={() => onClose(false)}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-labelledby="vs">
        <div>
          <h2 id="vs" className="h2">{vehicle ? "Edit vehicle" : "Add a vehicle"}</h2>
          <p className="hint">Tank size helps the Worth the drive? calculator.</p>
        </div>
        <div className="sunk field"><label htmlFor="vn">Name</label><input id="vn" value={name} onChange={(e) => setName(e.target.value)} placeholder="2019 Toyota Tacoma" autoFocus /></div>
        <div className="sunk field"><label htmlFor="vt">Tank size (gal)</label><input id="vt" inputMode="decimal" value={tank} onChange={(e) => setTank(e.target.value)} placeholder="21" /></div>
        <div className="sunk field">
          <label htmlFor="vg">Usual grade</label>
          <select id="vg" value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>{GRADES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </div>
        <div className="sunk field"><label htmlFor="vp">Plate</label><input id="vp" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="optional" /></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div style={{ display: "flex", gap: 12 }}>
          {vehicle ? <button type="button" className="pillbtn" onClick={remove}>Remove</button> : <button type="button" className="pillbtn" onClick={() => onClose(false)}>Cancel</button>}
          <button type="submit" className="pillbtn accent" style={{ flexGrow: 1 }}>Save</button>
        </div>
      </form>
    </div>
  );
}
