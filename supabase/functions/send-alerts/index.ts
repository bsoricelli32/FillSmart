// Push alerts. Runs hourly from pg_cron (with the job token) and on demand from the app's "Send a test".
// - Price drop: cheapest nearby price for the user's grade falls to or under their alert price.
//   Sent once when it crosses, again only if it falls another 3 cents, and re-armed when the
//   price goes back above the alert. Only 7am to 9pm local time.
// - Weekly report: Sunday after 6pm local time, once a week. Spend Monday to Sunday, budget,
//   what the user paid versus the area average, and month to date.
import webpush from "npm:web-push@3.6.7";
import { adminClient, allowedUser, cors, json } from "./common.ts";
import { Grade, loadArea, Station } from "./area.ts";

const LABEL: Record<Grade, string> = { "87": "85 Regular", "89": "87 Plus", "93": "91 Premium", D: "Diesel" };
const DEFAULT_TZ = "America/Denver";
const PRICE_MAX_AGE_H = 72; // ignore prices older than this
const AREA_MAX_AGE_MIN = 180; // reuse Google results up to 3 hours old
const HOUR = 3600_000, DAY = 24 * HOUR;

type Prefs = {
  user_id: string; preferred_grade: Grade; price_alert: number | null; price_alert_on: boolean; weekly_report_on: boolean;
  weekly_budget: number | null; monthly_budget: number | null; search_radius_mi: number | null; vehicle_id: string | null;
  alert_lat: number | null; alert_lng: number | null; alert_label: string | null; tz: string | null;
};
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; url: string; tag: string; ttl: number };

const money = (n: number) => `$${n.toFixed(2)}`;
const budget = (n: number) => (Number.isInteger(n) ? `$${n}` : money(n));
const price = (n: number) => { const s = n.toFixed(3); return "$" + (s.endsWith("0") ? n.toFixed(2) : s); };

function validTz(tz: string | null): string {
  try { if (tz) { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } } catch { /* fall through */ }
  return DEFAULT_TZ;
}
function local(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
/** UTC instant of local midnight on the given local calendar date. */
function midnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const l = local(new Date(guess), tz);
  return new Date(guess - (Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - guess));
}
function weekStart(now: Date, tz: string): Date {
  const l = local(now, tz);
  const mon = new Date(Date.UTC(l.y, l.m - 1, l.d - ((l.wd + 6) % 7)));
  return midnight(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate(), tz);
}
function monthStart(now: Date, tz: string): Date { const l = local(now, tz); return midnight(l.y, l.m, 1, tz); }

/** Cheapest fresh price for a grade; ties go to the closer station. */
function cheapest(stations: Station[], g: Grade) {
  let best: { s: Station; p: number } | null = null;
  const cutoff = new Date(Date.now() - PRICE_MAX_AGE_H * HOUR).toISOString();
  for (const s of stations) {
    const e = s.prices[g];
    if (!e || e.updated_at < cutoff) continue;
    if (!best || e.price < best.p - 1e-9 || (Math.abs(e.price - best.p) < 1e-9 && s.distance_mi! < best.s.distance_mi!)) best = { s, p: e.price };
  }
  return best;
}

async function usualFill(admin: ReturnType<typeof adminClient>, p: Prefs): Promise<number | null> {
  const { data: vs } = await admin.from("vehicles").select("id,tank_gal").eq("user_id", p.user_id).order("created_at");
  const v = (vs ?? []).find((x) => x.id === p.vehicle_id) ?? vs?.[0];
  if (!v) return null;
  const { data: f } = await admin.from("fillups").select("gallons").eq("vehicle_id", v.id).gt("gallons", 0).order("filled_at", { ascending: false }).limit(6);
  const g = (f ?? []).map((x) => Number(x.gallons)).sort((a, b) => a - b);
  if (g.length >= 2) { const m = Math.floor(g.length / 2); return g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2; }
  return v.tank_gal ? Math.round(Number(v.tank_gal) * 0.75 * 10) / 10 : null;
}

/** Postgres numeric columns arrive as strings. */
const num = (x: unknown) => (x == null ? null : Number(x));
const norm = (p: any): Prefs => ({ ...p, price_alert: num(p.price_alert), weekly_budget: num(p.weekly_budget), monthly_budget: num(p.monthly_budget), search_radius_mi: num(p.search_radius_mi) });

const radiusM = (p: Prefs) => Math.round((p.search_radius_mi ?? 5) * 1609.34);

async function dropMessage(admin: ReturnType<typeof adminClient>, p: Prefs, stations: Station[]) {
  const best = cheapest(stations, p.preferred_grade);
  if (!best) return null;
  const fill = await usualFill(admin, p);
  const body = `${best.s.name}, ${best.s.distance_mi!.toFixed(1)} mi away. Your alert price is ${price(p.price_alert!)}.` +
    (fill ? ` Your usual ${fill.toFixed(1)} gal fill there: ${money(best.p * fill)}.` : "");
  const msg: Msg = { title: `${LABEL[p.preferred_grade]} is ${price(best.p)} nearby`, body, url: `/station/${encodeURIComponent(best.s.place_id)}`, tag: "price-drop", ttl: 4 * HOUR / 1000 };
  return { best, msg };
}

async function reportMessage(admin: ReturnType<typeof adminClient>, p: Prefs, stations: Station[], now: Date): Promise<Msg> {
  const tz = validTz(p.tz);
  const wk = weekStart(now, tz), mo = monthStart(now, tz);
  const from = wk < mo ? wk : mo;
  const { data } = await admin.from("fillups").select("grade,gallons,price_per_gal,total,filled_at").eq("user_id", p.user_id)
    .gte("filled_at", from.toISOString()).lte("filled_at", now.toISOString());
  const all = (data ?? []).map((f) => ({ ...f, gallons: Number(f.gallons), price_per_gal: Number(f.price_per_gal), total: Number(f.total) }));
  const week = all.filter((f) => new Date(f.filled_at) >= wk);
  const monthSpent = all.filter((f) => new Date(f.filled_at) >= mo).reduce((a, f) => a + f.total, 0);
  const monthLine = p.monthly_budget ? ` Month so far: ${money(monthSpent)} of ${budget(Number(p.monthly_budget))}.` : ` Month so far: ${money(monthSpent)}.`;

  if (!week.length) {
    const best = cheapest(stations, p.preferred_grade);
    return {
      title: "This week: no fill-ups logged",
      body: `Log a fill-up with Scan to track it.${monthLine}` + (best ? ` Cheapest ${LABEL[p.preferred_grade]} nearby now: ${price(best.p)} at ${best.s.name}.` : ""),
      url: "/spend", tag: "weekly-report", ttl: 24 * HOUR / 1000,
    };
  }

  const spent = week.reduce((a, f) => a + f.total, 0), gal = week.reduce((a, f) => a + f.gallons, 0);
  let body = `${week.length} fill-up${week.length > 1 ? "s" : ""}, ${gal.toFixed(1)} gal at ${price(spent / gal)} avg.`;
  const wb = Number(p.weekly_budget);
  if (wb > 0) body += spent <= wb ? ` ${money(wb - spent)} under your ${budget(wb)} weekly budget.` : ` ${money(spent - wb)} over your ${budget(wb)} weekly budget.`;

  // Area average this week per grade: each station's average, then the average across stations (3+ stations).
  if (p.alert_lat != null && p.alert_lng != null) {
    const r = radiusM(p), dLat = r / 111_000, dLng = r / (111_000 * Math.cos(p.alert_lat * Math.PI / 180));
    const { data: hist } = await admin.from("price_reports").select("place_id,grade,price")
      .gte("reported_at", new Date(wk.getTime() - 3 * DAY).toISOString()).lte("reported_at", now.toISOString())
      .gte("lat", p.alert_lat - dLat).lte("lat", p.alert_lat + dLat).gte("lng", p.alert_lng - dLng).lte("lng", p.alert_lng + dLng).limit(5000);
    const per = new Map<string, Map<string, number[]>>();
    for (const h of hist ?? []) {
      const g = per.get(h.grade) ?? new Map(); per.set(h.grade, g);
      const a = g.get(h.place_id) ?? []; a.push(Number(h.price)); g.set(h.place_id, a);
    }
    const avg = (g: string) => {
      const st = per.get(g); if (!st || st.size < 3) return null;
      const means = [...st.values()].map((a) => a.reduce((x, y) => x + y, 0) / a.length);
      return means.reduce((x, y) => x + y, 0) / means.length;
    };
    let saved = 0, covered = 0;
    for (const f of week) { const a = avg(f.grade); if (a != null) { saved += (a - f.price_per_gal) * f.gallons; covered += f.gallons; } }
    if (covered >= gal * 0.8) {
      const cents = Math.round((saved / covered) * 100);
      if (Math.abs(cents) < 1) body += " You paid about the area average.";
      else if (cents > 0) body += ` You paid ${cents}¢ a gallon under the area average, saving ${money(saved)}.`;
      else body += ` You paid ${-cents}¢ a gallon over the area average, ${money(-saved)} extra.`;
    }
  }
  return { title: `This week: ${money(spent)} on gas`, body: body + monthLine, url: "/spend", tag: "weekly-report", ttl: 24 * HOUR / 1000 };
}

async function send(admin: ReturnType<typeof adminClient>, subs: Sub[], msg: Msg) {
  let sent = 0;
  const errors: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag }), { TTL: msg.ttl, urgency: "normal" });
      sent++;
    } catch (e: any) {
      // 404/410: the phone or browser dropped this subscription.
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      errors.push(`${e?.statusCode ?? "error"} ${String(e?.body ?? e?.message ?? e).slice(0, 120)}`);
    }
  }
  return { sent, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = adminClient();
  const { data: cfg } = await admin.from("push_config").select("*").single();
  if (!cfg) return json({ error: "push_not_configured" }, 503);
  webpush.setVapidDetails(cfg.subject, cfg.public_key, cfg.private_key);
  const body = await req.json().catch(() => ({}));
  const now = new Date();

  // Scheduled run (or a forced run for one user, for testing).
  if (req.headers.get("x-job-token") === cfg.job_token) {
    const force: "drop" | "report" | undefined = body.force;
    const { data: subs } = await admin.from("push_subscriptions").select("endpoint,user_id,p256dh,auth");
    const byUser = new Map<string, Sub[]>();
    for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
    const ids = force ? [body.user_id] : [...byUser.keys()];
    if (!ids.length) return json({ users: 0 });
    const { data: prefs } = await admin.from("user_prefs").select("*").in("user_id", ids);
    const { data: states } = await admin.from("alert_state").select("*").in("user_id", ids);
    const stateBy = new Map((states ?? []).map((s) => [s.user_id, s]));
    const log: unknown[] = [];

    for (const p of (prefs ?? []).map(norm)) {
      const mine = byUser.get(p.user_id) ?? [];
      if (!mine.length || p.alert_lat == null || p.alert_lng == null) continue;
      const tz = validTz(p.tz), l = local(now, tz), st: any = stateBy.get(p.user_id) ?? {};
      const wantDrop = force === "drop" || (!force && p.price_alert_on && p.price_alert != null && l.h >= 7 && l.h < 21);
      const wantReport = force === "report" || (!force && p.weekly_report_on && l.wd === 0 && l.h >= 18 &&
        (!st.last_report_at || now.getTime() - new Date(st.last_report_at).getTime() > 5 * DAY));
      if (!wantDrop && !wantReport) continue;

      const stations = await loadArea(admin, p.alert_lat, p.alert_lng, radiusM(p), AREA_MAX_AGE_MIN);
      if (wantDrop) {
        const d = await dropMessage(admin, p, stations);
        const under = !!d && p.price_alert != null && d.best.p <= p.price_alert + 1e-9;
        const armed = st.last_alert_price == null;
        const newLow = !!d && !armed && d.best.p <= Number(st.last_alert_price) - 0.03 + 1e-9;
        if (d && !under && !armed && !force) await admin.from("alert_state").upsert({ user_id: p.user_id, last_alert_price: null });
        if (d && (force || (under && (armed || newLow)))) {
          const r = await send(admin, mine, d.msg);
          if (r.sent && !force) await admin.from("alert_state").upsert({ user_id: p.user_id, last_alert_price: d.best.p, last_alert_place: d.best.s.place_id, last_alert_at: now.toISOString() });
          log.push({ user: p.user_id, kind: "drop", ...d.msg, ...r });
        }
      }
      if (wantReport) {
        const msg = await reportMessage(admin, p, stations, now);
        const r = await send(admin, mine, msg);
        if (r.sent && !force) await admin.from("alert_state").upsert({ user_id: p.user_id, last_report_at: now.toISOString() });
        log.push({ user: p.user_id, kind: "report", ...msg, ...r });
      }
    }
    return json({ users: ids.length, log });
  }

  // "Send a test" from the app: shows exactly what this user's alerts look like right now.
  const who = await allowedUser(req);
  if (!who) return json({ error: "not_allowed" }, 403);
  const { data: row } = await admin.from("user_prefs").select("*").eq("user_id", who.userId).maybeSingle();
  const p = row ? norm(row) : null;
  const { data: mine } = await admin.from("push_subscriptions").select("endpoint,user_id,p256dh,auth").eq("user_id", who.userId);
  if (!p || !mine?.length) return json({ error: "no_subscription" }, 400);
  if (p.alert_lat == null || p.alert_lng == null) return json({ error: "no_location" }, 400);
  const stations = await loadArea(admin, p.alert_lat, p.alert_lng, radiusM(p), AREA_MAX_AGE_MIN);
  const best = cheapest(stations, p.preferred_grade);
  const status: Msg = {
    title: "Alerts are on",
    body: best
      ? `Cheapest ${LABEL[p.preferred_grade]} within ${p.search_radius_mi ?? 5} mi: ${price(best.p)} at ${best.s.name}.` +
        (p.price_alert_on && p.price_alert != null ? ` You'll get an alert when it's ${price(p.price_alert)} or less.` : "")
      : `No recent ${LABEL[p.preferred_grade]} prices within ${p.search_radius_mi ?? 5} mi yet.`,
    url: best ? `/station/${encodeURIComponent(best.s.place_id)}` : "/", tag: "test", ttl: 600,
  };
  const out = [await send(admin, mine, status)];
  let report: Msg | null = null;
  if (p.weekly_report_on) {
    report = await reportMessage(admin, p, stations, now);
    report = { ...report, title: `Preview · ${report.title}` };
    out.push(await send(admin, mine, report));
  }
  return json({ sent: out.reduce((a, r) => a + r.sent, 0), errors: out.flatMap((r) => r.errors), status, report });
});
