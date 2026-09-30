import { allowedUser, cors, json } from "./common.ts";

const MODEL = "claude-haiku-4-5-20251001";
const GRADES = ["87", "89", "93", "D"];

const PROMPT = `This is a phone photo of a gas pump display.
Read the sale total in dollars, the gallons dispensed, and the price per gallon.
If a fuel grade is visibly selected or lit, report it as "87", "89", "93" (use "93" for any premium 91-94), or "D" for diesel.
Reply with only a JSON object, no other text:
{"total": number|null, "gallons": number|null, "price_per_gal": number|null, "grade": "87"|"89"|"93"|"D"|null, "confidence": "high"|"medium"|"low"}
Use null for anything you cannot read clearly.`;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const who = await allowedUser(req);
  if (!who) return json({ error: "not_allowed" }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ocr_not_configured" }, 503);

  let body: { image?: string; media_type?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const image = (body.image ?? "").replace(/^data:[^,]+,/, "");
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body.media_type ?? "") ? body.media_type! : "image/jpeg";
  if (!image || image.length > 7_000_000) return json({ error: "image_missing_or_too_large" }, 400);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) {
    console.error("anthropic error", res.status, await res.text());
    return json({ error: "ocr_failed" }, 502);
  }
  const out = await res.json();
  const text: string = out?.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return json({ error: "unreadable" }, 422);

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(match[0]); } catch { return json({ error: "unreadable" }, 422); }

  let total = num(parsed.total);
  let gallons = num(parsed.gallons);
  let ppg = num(parsed.price_per_gal);

  // Fill in one missing value from the other two.
  if (!total && gallons && ppg) total = +(gallons * ppg).toFixed(2);
  if (!gallons && total && ppg) gallons = +(total / ppg).toFixed(3);
  if (!ppg && total && gallons) ppg = +(total / gallons).toFixed(3);

  // Sanity check: the three numbers should agree within a few cents.
  let consistent = null as boolean | null;
  if (total && gallons && ppg) consistent = Math.abs(gallons * ppg - total) <= Math.max(0.1, total * 0.01);

  const grade = GRADES.includes(String(parsed.grade)) ? String(parsed.grade) : null;
  const confidence = ["high", "medium", "low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "low";

  return json({ total, gallons, price_per_gal: ppg, grade, confidence, consistent });
});
