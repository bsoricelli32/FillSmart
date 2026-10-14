import { useEffect, useState } from "react";
import { BellRinging } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { callFn, GRADES } from "../lib/supabase";
import { enablePush, pushState, PushState } from "../lib/push";
import { miles } from "../lib/util";
import { Section } from "./TabDock";

const fmt = (n: number) => { const s = n.toFixed(3); return "$" + (s.endsWith("0") ? n.toFixed(2) : s); };

/** Price drop alert and Sunday report, delivered as real push notifications. */
export function Alerts() {
  const { prefs, setPrefs, loc, stations } = useStore();
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { pushState().then(setSt); }, []);
  const watching = prefs.alert_lat != null && prefs.alert_lng != null;
  // Alerts already on (from another visit) but no place saved yet: watch the current place.
  useEffect(() => { if (st === "on" && !watching) setPrefs({ alert_lat: loc.lat, alert_lng: loc.lng, alert_label: loc.label }); }, [st, watching]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = GRADES.find((x) => x.id === prefs.preferred_grade)!;
  const gName = g.id === "D" ? "Diesel" : `${g.label} ${g.name}`;
  const placeName = (label: string | null) => (!label || label === "Near you" ? "your location" : label);
  const moved = watching && miles(prefs.alert_lat!, prefs.alert_lng!, loc.lat, loc.lng) > 1;

  // What prices look like now, so the alert price is realistic.
  const now = stations.map((s) => priceFor(s, prefs.preferred_grade)).filter((p): p is number => p != null).sort((a, b) => a - b);
  const typical = now.length ? now[Math.floor(now.length / 2)] : null;

  const here = () => ({ alert_lat: loc.lat, alert_lng: loc.lng, alert_label: loc.label });

  async function turnOn(extra: Partial<typeof prefs> = {}) {
    setBusy(true); setNote("");
    const next = await enablePush();
    setSt(next);
    if (next === "on") setPrefs({ ...(watching ? {} : here()), ...extra });
    else if (next === "off") setNote("Notifications weren't allowed. Tap again to retry.");
    setBusy(false);
  }
  function toggle(key: "price_alert_on" | "weekly_report_on") {
    if (st !== "on") { turnOn({ [key]: true }); return; }
    setPrefs({ [key]: !prefs[key] });
  }
  async function test() {
    setBusy(true); setNote("");
    await new Promise((r) => setTimeout(r, 700)); // let a just-changed setting save first
    const r = await callFn<{ sent: number }>("send-alerts", {});
    setBusy(false);
    setNote(r.error ? (r.error === "no_location" ? "Set where to watch prices first." : "Couldn't send. Try again.") : r.data!.sent ? "Sent. Check your notifications." : "Couldn't reach this device. Turn alerts off and on again.");
  }

  const on = st === "on";
  const blocked =
    st === "ios-install" ? "On iPhone, alerts only work from the Home Screen app. In Safari, tap Share, then Add to Home Screen, then open FillSmart from your Home Screen." :
    st === "unsupported" ? "This browser can't show alerts. Use Chrome, or the Home Screen app on iPhone." :
    st === "denied" ? "Notifications are blocked for FillSmart. Allow them in your phone's settings for this app, then come back." : null;

  return (
    <Section id="nt" title="Notifications" hint={on ? `Watching prices within ${prefs.search_radius_mi} mi of ${placeName(prefs.alert_label)}.` : "Get a push notification when prices drop, and a spend report every Sunday."}>
      {blocked && <p className="raised-sm" style={{ borderRadius: 18, padding: 14, fontSize: 14, lineHeight: 1.45 }}>{blocked}</p>}
      <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <li style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span id="l1" style={{ fontSize: 16, fontWeight: 700 }}>Price drop alert</span>
            <label style={{ fontSize: 13, color: "var(--ink-2)", display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
              When {gName} is&nbsp;<span style={{ fontWeight: 700, color: "var(--ink)" }}>$</span>
              <input key={prefs.price_alert ?? "none"} aria-label="Alert price" inputMode="decimal" placeholder="3.50" defaultValue={prefs.price_alert?.toFixed(2) ?? ""} onBlur={(e) => { const n = parseFloat(e.target.value); setPrefs({ price_alert: n > 0.5 && n < 15 ? n : null }); }} style={{ width: "4.2ch", padding: 0, border: 0, borderBottom: "1.5px solid var(--ink-2)", background: "transparent", font: "inherit", fontWeight: 700, color: "var(--ink)" }} />
              &nbsp;or less
            </label>
            {typical != null && <span className="tnum" style={{ fontSize: 13, color: "var(--ink-2)" }}>Now: lowest {fmt(now[0])}, typical {fmt(typical)}</span>}
          </div>
          <button className={"switch" + (on && prefs.price_alert_on ? " on" : "")} role="switch" aria-checked={on && prefs.price_alert_on} aria-labelledby="l1" disabled={busy || !!blocked} onClick={() => toggle("price_alert_on")}><span className="cap" /></button>
        </li>
        <li style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56 }}>
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span id="l2" style={{ fontSize: 16, fontWeight: 700 }}>Weekly spend report</span>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Sunday evening: your spend, budget, and prices vs the area</span>
          </div>
          <button className={"switch" + (on && prefs.weekly_report_on ? " on" : "")} role="switch" aria-checked={on && prefs.weekly_report_on} aria-labelledby="l2" disabled={busy || !!blocked} onClick={() => toggle("weekly_report_on")}><span className="cap" /></button>
        </li>
      </ul>
      {st === "off" && <button className="pillbtn accent" disabled={busy} onClick={() => turnOn()}><BellRinging size={18} weight="fill" />Turn on alerts</button>}
      {on && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="pillbtn" disabled={busy} onClick={test}>Send a test</button>
          {moved && <button className="linkbtn" onClick={() => setPrefs(here())}>Watch {placeName(loc.label)} instead</button>}
        </div>
      )}
      {note && <p className="hint" role="status">{note}</p>}
    </Section>
  );
}
