// Sends Telegram alerts when someone opens the résumé site or takes a high-intent action.
// Env vars (Netlify): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
const hits = new Map();
const E = { visit: "👀", call: "📞", cv: "📄", email: "✉️", linkedin: "🔗", summary: "❓" };
const T = {
  visit: "Someone opened your résumé",
  call: "Someone tapped <b>Call</b>",
  cv: "Someone opened your <b>CV</b>",
  email: "Someone tapped <b>Email</b>",
  linkedin: "Someone opened your <b>LinkedIn</b>",
  summary: "Questions they asked",
};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).slice(0, 300);

function device(ua) {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const app = /LinkedInApp/i.test(ua) ? "LinkedIn app" : /FBAN|FBAV|Instagram/i.test(ua) ? "Facebook/Instagram app" : /Edg\//i.test(ua) ? "Edge" : /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  return `${os} · ${app}`;
}
function source(ref, ua) {
  if (/LinkedInApp/i.test(ua) || /linkedin\./i.test(ref)) return "LinkedIn";
  if (/whatsapp/i.test(ref)) return "WhatsApp";
  if (/mail\.google|outlook|mail\./i.test(ref)) return "Email";
  if (/google\./i.test(ref)) return "Google search";
  if (ref) { try { return new URL(ref).hostname; } catch (_) { return "another site"; } }
  return "direct / WhatsApp / copied link";
}

export default async (req, context) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) return new Response("not configured", { status: 204 });

  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "anon";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 12) return new Response("slow down", { status: 429 });
  recent.push(now); hits.set(ip, recent);

  let b = {};
  try { b = JSON.parse(await req.text()); } catch (_) { return new Response("bad", { status: 400 }); }
  const ev = E[b.ev] ? b.ev : "visit";
  const ua = req.headers.get("user-agent") || "";
  if (/bot|crawler|spider|preview|facebookexternalhit|WhatsApp\//i.test(ua)) return new Response("bot", { status: 204 });

  const g = context?.geo || {};
  const place = [g.city, g.subdivision?.name, g.country?.code].filter(Boolean).join(", ") || "Unknown location";
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const link = b.link ? `<b>${esc(b.link)}</b> link` : "<b>Main link</b> (no company tag)";
  const tag = b.tag ? `\nTag: <b>${esc(b.tag)}</b>` : "";
  const page = b.page === "hi" ? " · Hindi page" : "";

  let text = `${E[ev]} ${T[ev]}\nLink: ${link}${page}${tag}`;
  if (ev === "visit") text += `\nFrom: ${esc(place)}\nDevice: ${esc(device(ua))}\nCame via: ${esc(source(b.ref || "", ua))}`;
  if (ev === "summary" && Array.isArray(b.qs) && b.qs.length) text += "\n" + b.qs.slice(0, 12).map((q) => "• " + esc(q)).join("\n");
  text += `\n🕒 ${when} IST`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) { console.error("telegram failed", e?.message); }
  return new Response("ok", { status: 200 });
};
