export const money = (n: number, digits = 2) => `$${n.toFixed(digits)}`;

/** Splits 3.199 into "3.19" and "9" for the classic pump-price look. */
export function pumpPrice(p: number): { main: string; tenth: string } {
  const s = p.toFixed(3);
  return { main: s.slice(0, -1), tenth: s.slice(-1) };
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const sourceLabel = (s: string) =>
  s === "photo" ? "photo" : s === "manual" ? "report" : "Google";

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
export function daysInMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Shrinks a photo to at most `max` px on the long side and returns base64 JPEG. */
export async function resizeImage(file: File, max = 1400): Promise<{ base64: string; blob: Blob }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.82));
  const base64 = await new Promise<string>((r) => {
    const fr = new FileReader();
    fr.onload = () => r(String(fr.result).split(",")[1]);
    fr.readAsDataURL(blob);
  });
  return { base64, blob };
}

export const DEFAULT_LOCATION = { lat: 40.1672, lng: -105.1019, label: "Longmont" };
