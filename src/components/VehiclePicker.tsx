import { useEffect, useState } from "react";
import { callFn } from "../lib/supabase";

export type EpaVehicle = {
  epa_id: number; year: number; make: string; model: string;
  mpg_combined: number | null; mpg_city: number | null; mpg_highway: number | null;
  epa_fuel: string | null; engine: string; drive: string | null;
};
type Item = { value: string; text: string };

/** Year, make, model, then version (engine and transmission), from the official EPA fuel economy database. */
export function VehiclePicker({ onPick }: { onPick: (v: EpaVehicle) => void }) {
  const [years, setYears] = useState<Item[]>([]);
  const [makes, setMakes] = useState<Item[]>([]);
  const [models, setModels] = useState<Item[]>([]);
  const [options, setOptions] = useState<Item[]>([]);
  const [year, setYear] = useState(""), [make, setMake] = useState(""), [model, setModel] = useState(""), [option, setOption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(body: object): Promise<Item[]> {
    setBusy(true); setErr(null);
    const res = await callFn<{ items: Item[] }>("vehicle-lookup", body);
    setBusy(false);
    if (res.error || !res.data) { setErr("Couldn't reach the EPA vehicle list. You can still type the details below."); return []; }
    return res.data.items;
  }

  useEffect(() => { load({ step: "years" }).then(setYears); }, []);

  async function pickYear(y: string) {
    setYear(y); setMake(""); setModel(""); setOption(""); setMakes([]); setModels([]); setOptions([]);
    if (y) setMakes(await load({ step: "makes", year: y }));
  }
  async function pickMake(m: string) {
    setMake(m); setModel(""); setOption(""); setModels([]); setOptions([]);
    if (m) setModels(await load({ step: "models", year, make: m }));
  }
  async function pickModel(m: string) {
    setModel(m); setOption(""); setOptions([]);
    if (!m) return;
    const opts = await load({ step: "options", year, make, model: m });
    setOptions(opts);
    if (opts.length === 1) pickOption(opts[0].value);
  }
  async function pickOption(id: string) {
    setOption(id);
    if (!id) return;
    setBusy(true); setErr(null);
    const res = await callFn<{ vehicle: EpaVehicle }>("vehicle-lookup", { step: "vehicle", id });
    setBusy(false);
    if (res.error || !res.data) { setErr("Couldn't load that vehicle. Try again."); return; }
    onPick(res.data.vehicle);
  }

  const sel = (id: string, label: string, value: string, items: Item[], on: (v: string) => void, placeholder: string) => (
    <div className="sunk field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)} disabled={!items.length}>
        <option value="">{items.length ? placeholder : busy ? "Loading" : "--"}</option>
        {items.map((i) => <option key={i.value} value={i.value}>{i.text}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {sel("py", "Year", year, years, pickYear, "Choose")}
      {year && sel("pm", "Make", make, makes, pickMake, "Choose")}
      {make && sel("pd", "Model", model, models, pickModel, "Choose")}
      {model && options.length > 1 && sel("po", "Version", option, options, pickOption, "Engine and transmission")}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
