import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowCounterClockwise, Camera, Check, Image as ImageIcon, X } from "@phosphor-icons/react";
import { useStore } from "../lib/store";
import { callFn, Grade, GRADES, supabase } from "../lib/supabase";
import { resizeImage } from "../lib/util";
import { Bar } from "../components/TabDock";

type Ocr = { total: number | null; gallons: number | null; price_per_gal: number | null; grade: Grade | null; confidence: string; consistent: boolean | null };

export default function Scan() {
  const { userId, stations, vehicles, prefs, reloadFillups, reloadStations } = useStore();
  const nav = useNavigate();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [total, setTotal] = useState("");
  const [gallons, setGallons] = useState("");
  const [ppg, setPpg] = useState("");
  const [grade, setGrade] = useState<Grade>(prefs.preferred_grade);
  const byDistance = useMemo(() => [...stations].sort((a, b) => a.distance_mi - b.distance_mi), [stations]);
  const [placeId, setPlaceId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [odo, setOdo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!placeId && byDistance[0]) setPlaceId(byDistance[0].place_id); }, [byDistance, placeId]);
  useEffect(() => { if (!vehicleId && vehicles[0]) { setVehicleId(vehicles[0].id); setGrade(vehicles[0].grade); } }, [vehicles, vehicleId]);

  async function onPick(file?: File) {
    if (!file) return;
    setNote(null);
    setReading(true);
    try {
      const { base64, blob } = await resizeImage(file);
      setPreview(URL.createObjectURL(blob));
      const path = `${userId}/${Date.now()}.jpg`;
      const [up, ocr] = await Promise.all([
        supabase.storage.from("pump-photos").upload(path, blob, { contentType: "image/jpeg" }),
        callFn<Ocr>("scan-pump", { image: base64, media_type: "image/jpeg" }),
      ]);
      if (!up.error) setPhotoPath(path);
      if (ocr.data) {
        const r = ocr.data;
        if (r.total) setTotal(r.total.toFixed(2));
        if (r.gallons) setGallons(r.gallons.toFixed(3));
        if (r.price_per_gal) setPpg(r.price_per_gal.toFixed(3));
        if (r.grade) setGrade(r.grade);
        const got = [r.total, r.gallons, r.price_per_gal].filter(Boolean).length;
        setNote(got === 3 && r.consistent !== false
          ? { kind: "ok", text: "Read sale, gallons and price. Check them below." }
          : { kind: "err", text: "Couldn't read everything clearly. Fill in what's missing." });
      } else {
        setNote({ kind: "err", text: ocr.error === "ocr_not_configured" ? "Photo reading isn't switched on yet. Type the numbers below." : "Couldn't read that photo. Try again closer, or type the numbers." });
      }
    } catch {
      setNote({ kind: "err", text: "That photo didn't load. Try another." });
    }
    setReading(false);
  }

  // Keep the three numbers consistent when one is left blank.
  function fillThird() {
    const t = parseFloat(total), g = parseFloat(gallons), p = parseFloat(ppg);
    if (!t && g && p) setTotal((g * p).toFixed(2));
    else if (!g && t && p) setGallons((t / p).toFixed(3));
    else if (!p && t && g) setPpg((t / g).toFixed(3));
  }

  async function save() {
    const t = parseFloat(total), g = parseFloat(gallons), p = parseFloat(ppg);
    if (!(t > 0 && g > 0 && p > 0)) { setNote({ kind: "err", text: "Enter the sale total, gallons and price per gallon." }); return; }
    setSaving(true);
    const st = stations.find((s) => s.place_id === placeId);
    const { error } = await supabase.from("fillups").insert({
      vehicle_id: vehicleId || null, station_name: st?.name ?? null, place_id: st?.place_id ?? null, grade,
      gallons: g, price_per_gal: p, total: t, odometer: odo ? parseInt(odo.replace(/\D/g, ""), 10) : null, photo_path: photoPath,
    });
    if (error) { setSaving(false); setNote({ kind: "err", text: "Couldn't save. Try again." }); return; }
    if (st) {
      await supabase.from("price_reports").insert({ user_id: userId, place_id: st.place_id, station_name: st.name, lat: st.lat, lng: st.lng, grade, price: p, source: photoPath ? "photo" : "manual" });
      reloadStations();
    }
    await reloadFillups();
    nav("/spend");
  }

  function reset() {
    setPreview(null); setPhotoPath(null); setTotal(""); setGallons(""); setPpg(""); setOdo(""); setNote(null);
  }

  return (
    <div className="screen modal">
      <div className="hero">
        <Bar
          left={<Link to="/" className="nb" aria-label="Close scanner"><X size={22} /></Link>}
          title="Scan pump"
        />
        <section aria-labelledby="cam" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
          <div>
            <h2 id="cam" className="h2">Point at the pump screen</h2>
            <p className="hint">Take a photo that shows the sale total, gallons and price. Pumpline reads it for you.</p>
          </div>
          <button className="rsunk" onClick={() => camRef.current?.click()} aria-label="Take a photo of the pump" style={{ border: 0, borderRadius: 28, padding: 10, cursor: "pointer" }}>
            <div style={{ height: 200, borderRadius: 20, overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: preview ? `center/cover no-repeat url(${preview})` : "linear-gradient(145deg,#E4E1DA,#C8C3BA)" }}>
              {!preview && <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--ink-2)", fontWeight: 700 }}><Camera size={34} />Tap to open camera</span>}
              {reading && <span style={{ position: "absolute", bottom: 12, background: "rgba(255,255,255,.92)", borderRadius: 10, padding: "4px 10px", fontSize: 13, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}><span className="spin" />Reading the pump</span>}
            </div>
          </button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPick(e.target.files?.[0])} />
          <input ref={libRef} type="file" accept="image/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        </section>
      </div>

      <main className="main" style={{ paddingTop: 18 }}>
        <section aria-labelledby="chk" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <h2 id="chk" className="h2">Check your fill-up</h2>
            <p className="hint">Fix anything we misread. Add your odometer to track MPG.</p>
          </div>
          {note && <p className={note.kind} role="status">{note.text}</p>}
          <div className="sunk field"><label htmlFor="t">Sale total $</label><input id="t" inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} onBlur={fillThird} /></div>
          <div className="sunk field"><label htmlFor="g">Gallons</label><input id="g" inputMode="decimal" placeholder="0.000" value={gallons} onChange={(e) => setGallons(e.target.value)} onBlur={fillThird} /></div>
          <div className="sunk field"><label htmlFor="p">Price per gallon</label><input id="p" inputMode="decimal" placeholder="0.000" value={ppg} onChange={(e) => setPpg(e.target.value)} onBlur={fillThird} /></div>
          <div className="sunk field">
            <label htmlFor="gr">Grade</label>
            <select id="gr" value={grade} onChange={(e) => setGrade(e.target.value as Grade)}>
              {GRADES.map((g) => <option key={g.id} value={g.id}>{g.id === "D" ? "Diesel" : `${g.id} ${g.name}`}</option>)}
            </select>
          </div>
          <div className="sunk field">
            <label htmlFor="st">Station</label>
            <select id="st" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">Not listed</option>
              {byDistance.map((s) => <option key={s.place_id} value={s.place_id}>{s.name}</option>)}
            </select>
          </div>
          {vehicles.length > 0 && (
            <div className="sunk field">
              <label htmlFor="vh">Vehicle</label>
              <select id="vh" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          )}
          <div className="sunk field"><label htmlFor="odo">Odometer</label><input id="odo" inputMode="numeric" placeholder="optional" value={odo} onChange={(e) => setOdo(e.target.value)} /></div>
        </section>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 36, paddingTop: 8 }}>
          <button className="nb lg" aria-label="Clear and retake" onClick={() => { reset(); camRef.current?.click(); }}><ArrowCounterClockwise size={24} /></button>
          <button className="nb accent" aria-label="Save fill-up" onClick={save} disabled={saving} style={{ width: 84, height: 84, borderRadius: 42 }}>
            {saving ? <span className="spin" /> : <Check size={32} weight="bold" />}
          </button>
          <button className="nb lg" aria-label="Choose a saved photo" onClick={() => libRef.current?.click()}><ImageIcon size={24} /></button>
        </div>
      </main>
    </div>
  );
}
