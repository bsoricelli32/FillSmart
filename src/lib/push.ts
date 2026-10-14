// Web Push: ask permission, subscribe this phone or browser, and save the subscription for the alert job.
import { supabase } from "./supabase";

// Public half of the VAPID key pair (the private half is only on the server).
const VAPID_PUBLIC = "BMKZcmgJ66M4BFi1hU3SVNREe4IU0bhQG5WoRhcMd-9nV3DOwyo1zOaOdjmhiHW8CWOBRXEIG9jNO-ZK85eJMgc";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

function keyBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: j.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth, user_agent: navigator.userAgent.slice(0, 200),
  });
  return !error;
}

export async function pushState(): Promise<PushState> {
  // iPhone only allows notifications from an app added to the Home Screen (iOS 16.4 or later).
  if (isIOS() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Asks permission (must run from a tap) and saves the subscription. */
export async function enablePush(): Promise<PushState> {
  const st = await pushState();
  if (st === "unsupported" || st === "ios-install" || st === "denied") return st;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  return (await ensureSaved(await navigator.serviceWorker.ready, true)) ? "on" : "off";
}

/** Saves this device's subscription. If it can't be saved (it belonged to another account), starts a fresh one. */
async function ensureSaved(reg: ServiceWorkerRegistration, create: boolean): Promise<boolean> {
  const fresh = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) { if (!create) return false; sub = await fresh(); }
  if (await save(sub)) return true;
  await sub.unsubscribe();
  return save(await fresh());
}

/** Stops alerts on this device (also used on sign out, so the next person doesn't get them). */
export async function disablePush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** On app start: make sure the server has this device's current subscription (browsers can rotate it). */
export async function syncPush() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    await ensureSaved(await navigator.serviceWorker.ready, false);
  } catch { /* best effort */ }
}
