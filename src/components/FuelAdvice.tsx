import { useState } from "react";
import { GasPump, Warning } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { Grade, supabase, Vehicle } from "../lib/supabase";
import { FuelReq, gradeAbove, gradeLabel, octaneAdvice } from "../lib/octane";
import { usualFill } from "../lib/vehicle";
import { Section } from "./TabDock";

const DAY = 86400000;

/** Middle price nearby for a grade, from the stations currently loaded. */
function medianPrice(prices: number[]): number | null {
  if (!prices.length) return null;
  const s = [...prices].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** "Fuel for this car": the grade it needs here, one question when the EPA can't tell, and the money at stake. */
export function FuelAdvice({ v }: { v: Vehicle }) {
  const { stations, fillups, prefs, setPrefs, reloadVehicles } = useStore();
  const [busy, setBusy] = useState(false);
  const advice = octaneAdvice(v);
  if (!advice) {
    return (
      <Section id="fuel" title="Fuel for this car" hint="Pick your car from the list (tap the pencil) to see which grade it needs.">
        <p className="hint">FillSmart uses the EPA's fuel rating plus your owner's manual to tell you which grade to buy.</p>
      </Section>
    );
  }

  const price = (g: Grade) => medianPrice(stations.map((s) => priceFor(s, g)).filter((p): p is number => p != null));
  const fill = usualFill(fillups, v);
  const recent = fillups.filter((f) => f.vehicle_id === v.id && new Date(f.filled_at).getTime() > Date.now() - 90 * DAY).length;
  const fillsPerYear = recent >= 2 ? (recent * 365) / 90 : null;

  const usual = v.grade;
  const need = advice.need;
  const pu = price(usual), pn = need ? price(need) : null;
  const perFill = need && pu != null && pn != null && fill ? (pu - pn) * fill.gal : null;

  async function answer(req: FuelReq) {
    setBusy(true);
    await supabase.from("vehicles").update({ fuel_req: req }).eq("id", v.id);
    await reloadVehicles();
    setBusy(false);
  }
  async function useGrade(g: Grade) {
    setBusy(true);
    await supabase.from("vehicles").update({ grade: g }).eq("id", v.id);
    setPrefs({ preferred_grade: g });
    await reloadVehicles();
    setBusy(false);
  }

  return (
    <Section id="fuel" title="Fuel for this car" hint={`Based on the EPA rating for your ${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}${v.fuel_req ? " and your owner's manual" : ""}.`.replace(/\s+/g, " ")}>
      <div className="raised-sm" style={{ borderRadius: 18, padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="nb xs accent" aria-hidden style={{ flex: "none" }}><GasPump size={18} weight="fill" /></span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <strong style={{ fontSize: 17 }}>{advice.title}</strong>
            <p style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>{advice.detail}</p>
          </div>
        </div>

        {advice.question && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 700 }}>{advice.question.prompt}</p>
            <p className="hint">{advice.question.where}</p>
            <div style={{ display: "flex", gap: 10 }}>
              {advice.question.choices.map((c) => (
                <button key={c.value} className="pillbtn" style={{ flex: 1 }} disabled={busy} onClick={() => answer(c.value)}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {need && need !== "D" && usual !== need && (
          gradeAbove(usual, need) ? (
            <p style={{ fontSize: 14, lineHeight: 1.45 }}>
              You usually buy <strong>{gradeLabel(usual)}</strong>.
              {perFill != null && perFill > 0
                ? <> At today's prices nearby, {gradeLabel(need)} saves about <strong className="tnum">${perFill.toFixed(2)}</strong> a fill{fillsPerYear ? <>, about <strong className="tnum">${Math.round(perFill * fillsPerYear)}</strong> a year at your pace</> : null}.</>
                : null}
            </p>
          ) : advice.question ? null : (
            <p role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: "#7A4B00" }}>
              <Warning size={18} weight="fill" style={{ flex: "none", marginTop: 1 }} />
              <span>You usually buy {gradeLabel(usual)}, which is below what your car needs.</span>
            </p>
          )
        )}
        {need && need !== "D" && (usual !== need || prefs.preferred_grade !== need) && !advice.question && (
          <button className="pillbtn accent" disabled={busy} onClick={() => useGrade(need)}>Use {gradeLabel(need)} for prices</button>
        )}
        {v.fuel_req && <button className="linkbtn" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => answer(null as unknown as FuelReq)}>Change my answer</button>}
        <p className="hint">Sources: EPA fueleconomy.gov rating, AAA fuel research.</p>
      </div>
    </Section>
  );
}
