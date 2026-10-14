// Which grade a car needs in Colorado, and what buying a different one costs.
//
// Sources:
// - AAA: 85 octane "shouldn't be used in modern fuel-injected vehicles unless noted in your owner's manual."
// - AAA (2016-17 study): premium gave no benefit in cars designed for regular; in "premium recommended"
//   cars it improved fuel economy 2.7% on average, not enough to offset its higher price.
// The EPA lists only the fuel type (regular, premium...). Whether 85 is allowed, or premium is required
// vs recommended, comes from the owner's manual or fuel door, so we ask once (vehicles.fuel_req).
import { GRADES, type Grade, type Vehicle } from "./supabase";

export type FuelReq = "85_ok" | "87_min" | "91_required" | "91_recommended";
export type Question = { prompt: string; where: string; choices: { value: FuelReq; label: string }[] };
export type Advice = {
  need: Grade | null;          // grade slot to buy ("87" slot = 85 Regular, "89" = 87 Plus, "93" = 91 Premium, "D")
  title: string;
  detail: string;
  question: Question | null;   // asked when the EPA data can't settle it
};

const label = (g: Grade) => { const x = GRADES.find((y) => y.id === g)!; return g === "D" ? "Diesel" : `${x.label} ${x.name}`; };

export function octaneAdvice(v: Vehicle): Advice | null {
  const f = (v.epa_fuel ?? "").toLowerCase();
  const req = v.fuel_req as FuelReq | null;
  if (!f) return null;
  if (f.includes("diesel")) return { need: "D", title: "Diesel", detail: "Your car runs on diesel.", question: null };
  if (f.includes("electric") && !f.includes("gasoline")) return null;

  if (f.includes("premium")) {
    const question: Question = {
      prompt: "Does your fuel door or manual say premium is required or recommended?",
      where: "Look for a sticker inside the fuel door, or the Fuel section of the owner's manual.",
      choices: [{ value: "91_required", label: "Required" }, { value: "91_recommended", label: "Recommended" }],
    };
    if (req === "91_required") return { need: "93", title: `Buy ${label("93")}`, detail: "Your manual requires premium. Lower grades can cause engine knock and damage.", question: null };
    if (req === "91_recommended") return {
      need: "89", title: `${label("89")} is enough`,
      detail: `Premium is only recommended for your car. AAA's testing found premium improved mileage just 2.7% on average in cars like yours, far less than the price gap. 87 is fine for everyday driving; use premium for towing or hard driving.`,
      question: null,
    };
    return { need: "93", title: `Buy ${label("93")} until you check`, detail: "The EPA rates your car on premium but doesn't say if it's required or just recommended. If it's only recommended, you can likely save by buying 87.", question };
  }

  // EPA "Regular" means 87 octane. Colorado's 85 "Regular" is lower.
  const question: Question = {
    prompt: "Does your owner's manual allow 85 octane at high altitude?",
    where: "Check the Fuel section of the owner's manual. Many modern cars list 87 as the minimum.",
    choices: [{ value: "85_ok", label: "Yes, 85 is OK" }, { value: "87_min", label: "No, 87 minimum" }],
  };
  if (req === "85_ok") return { need: "87", title: `${label("87")} is fine`, detail: "Your manual allows 85 at altitude, so Colorado's cheapest grade works for your car.", question: null };
  if (req === "87_min") return { need: "89", title: `Buy ${label("89")}`, detail: "Your manual calls for 87 minimum. In Colorado that's Plus, not Regular. 85 can cause knock in engines tuned for 87.", question: null };
  return {
    need: "89", title: `${label("89")} until you check`,
    detail: "Your car is rated on 87 octane. In Colorado, Regular is 85. AAA says not to use 85 in modern fuel-injected cars unless the owner's manual allows it.",
    question,
  };
}

/** Grade order for comparing what you buy with what you need. */
const rank: Record<Grade, number> = { "87": 0, "89": 1, "93": 2, D: -1 };
export const gradeAbove = (a: Grade, b: Grade) => rank[a] > rank[b] && a !== "D" && b !== "D";
export const gradeLabel = label;
