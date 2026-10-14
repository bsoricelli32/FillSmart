import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "@phosphor-icons/react";
import { summarize, Trip } from "../lib/mileage";
import { loadTrips } from "../screens/Mileage";
import { Section } from "./TabDock";

/** Garage entry point to the mileage log, with this year's totals. */
export function MileageCard() {
  const nav = useNavigate();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  useEffect(() => { loadTrips().then(setTrips); }, []);
  const year = new Date().getFullYear();
  const s = summarize(trips ?? [], year);
  const biz = s.rows.find((r) => r.purpose === "business");
  const line = !trips ? " " : s.rows.length
    ? `${year}: ${biz ? `${biz.miles.toLocaleString("en-US", { maximumFractionDigits: 0 })} business miles, ` : ""}$${s.deductible.toFixed(2)} at IRS rates`
    : "Log trips for business, medical or charity. Get the IRS deduction and a CSV for taxes.";
  return (
    <Section id="mi" title="Mileage log" hint={line}>
      <button className="pillbtn" onClick={() => nav("/mileage")}><Path size={18} />Open mileage log</button>
    </Section>
  );
}
