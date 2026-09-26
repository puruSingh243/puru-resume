// Shared helpers for the tracker: storage, Telegram, formatting, scoring.
import { getStore } from "@netlify/blobs";

export const store = () => globalThis.__MEMSTORE || getStore({ name: "tracker", consistency: "strong" });
export async function getJSON(key, fallback = null) {
  try { const v = await store().get(key, { type: "json" }); return v ?? fallback; } catch (_) { return fallback; }
}
export async function setJSON(key, val) { await store().setJSON(key, val); }
export async function del(key) { try { await store().delete(key); } catch (_) {} }
export async function listKeys(prefix) {
  const out = [];
  const r = await store().list({ prefix });
  for (const b of r.blobs || []) out.push(b.key);
  return out;
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export const IST = (t = Date.now(), opt = {}) =>
  new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...opt });
export const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function telegram(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return r.ok;
  } catch (e) { console.error("telegram", e?.message); return false; }
}

export function parseUA(ua = "") {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Other";
  const browser = /LinkedInApp/i.test(ua) ? "LinkedIn app" : /FBAN|FBAV|Instagram/i.test(ua) ? "Facebook/Instagram app" : /Edg\//i.test(ua) ? "Edge" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Other";
  const type = /Mobi|Android|iPhone/i.test(ua) ? "Mobile" : /iPad|Tablet/i.test(ua) ? "Tablet" : "Desktop";
  return { os, browser, type };
}
export function sourceOf(ref = "", ua = "") {
  if (/LinkedInApp/i.test(ua) || /linkedin\./i.test(ref)) return "LinkedIn";
  if (/whatsapp/i.test(ref)) return "WhatsApp";
  if (/mail\.google|outlook|mail\./i.test(ref)) return "Email";
  if (/google\./i.test(ref)) return "Google";
  if (ref) { try { const h = new URL(ref).hostname; if (/netlify\.app$/.test(h)) return "Direct / WhatsApp / copied link"; return h; } catch (_) { return "Other site"; } }
  return "Direct / WhatsApp / copied link";
}

// Hot-lead scoring
export const HOT = 30, WARM = 12;
export function score(v) {
  const c = v.counts || {};
  return 2 + Math.max(0, (v.visits || 1) - 1) * 6 + (c.q || 0) * 3 + (c.ai || 0) * 4 + (c.cv || 0) * 10 + (c.call || 0) * 20 +
    (c.email || 0) * 12 + (c.linkedin || 0) * 5 + Math.min(10, c.cards || 0) + Math.min(15, Math.floor((v.secs || 0) / 60) * 2);
}
export const tier = (s) => (s >= HOT ? "hot" : s >= WARM ? "warm" : "cold");
export const who = (v) => `Visitor ${v.vid.slice(0, 4)}${v.label ? ` (${esc(v.label)})` : ""}`;

// Company network lookup (organisation that owns the IP; works mainly on office Wi-Fi)
export async function orgOf(ip) {
  if (!ip || ip === "anon" || /^(127\.|10\.|192\.168\.|::1)/.test(ip)) return "";
  const key = "ip/" + ip.replace(/[^0-9a-f.:]/gi, "_");
  const cached = await getJSON(key);
  if (cached && cached.t > Date.now() - 30 * 864e5) return cached.org || "";
  let org = "";
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,connection`, { signal: ctl.signal });
    clearTimeout(to);
    const d = await r.json();
    if (d && d.success !== false) org = d.connection?.org || d.connection?.isp || "";
  } catch (_) {}
  await setJSON(key, { org, t: Date.now() });
  return org;
}
// Mobile carriers and big ISPs don't reveal a company, so we flag them.
export const isCarrier = (org = "") => /jio|reliance|airtel|bharti|vodafone|idea|vi\b|bsnl|act fibernet|hathway|tata (play|sky)|excitel|spectra|you broadband|google|cloudflare|amazon|microsoft|comcast|t-mobile|verizon/i.test(org);

// Data-centre / proxy / hosting networks: visits from these are almost always bots and scanners.
export const isBotNet = (org = "") => /amazon|aws|google cloud|google llc|googlebot|microsoft|azure|digitalocean|ovh|hetzner|m247|code200|linode|akamai|vultr|choopa|contabo|leaseweb|oracle|alibaba|tencent|scaleway|datacamp|cdn77|psychz|quadranet|colocrossing|hostinger|hostwinds|kamatera|zenlayer|g-core|gcore|fastly|cloudflare|servers\.com|ionos|hurricane electric|equinix|cogent|tzulo|hosting|datacenter|data center|vpn|proxy|\bvps\b/i.test(org);
export const HEADLESS = /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Lighthouse|python|curl|wget|node-fetch|axios|Go-http|okhttp|Java\//i;
