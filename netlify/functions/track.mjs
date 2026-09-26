// Records visitor activity for the private dashboard and sends Telegram alerts.
import { getJSON, setJSON, telegram, parseUA, sourceOf, score, tier, HOT, who, orgOf, isCarrier, isBotNet, HEADLESS, esc, IST } from "../lib/core.mjs";

const EVS = new Set(["visit", "hb", "leave", "q", "ai", "call", "email", "linkedin", "cv", "card", "lang", "mic", "voice", "listen", "copy"]);
const clip = (s, n = 200) => String(s ?? "").slice(0, n);
const rate = new Map();

export default async (req, context) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const now = Date.now();
  const r = (rate.get(ip) || []).filter((t) => now - t < 60000);
  if (r.length >= 40) return new Response("slow down", { status: 429 });
  r.push(now); rate.set(ip, r);

  let b; try { b = JSON.parse(await req.text()); } catch (_) { return new Response("bad", { status: 400 }); }
  const ua = req.headers.get("user-agent") || "";
  if (/bot|crawler|spider|preview|facebookexternalhit|WhatsApp\//i.test(ua) || HEADLESS.test(ua)) return new Response(null, { status: 204 });
  const vid = String(b.vid || ""), sid = String(b.sid || "");
  if (!/^[A-Z0-9]{6,12}$/.test(vid) || !/^[A-Z0-9]{6,12}$/.test(sid)) return new Response("bad id", { status: 400 });
  const ev = String(b.ev || "");
  if (!EVS.has(ev)) return new Response("bad ev", { status: 400 });
  const data = b.data && typeof b.data === "object" ? b.data : {};
  const link = clip(b.link, 40) || "Main";
  const page = b.page === "hi" ? "hi" : "en";

  const g = context?.geo || {};
  const dev = parseUA(ua);
  const vKey = "v/" + vid, eKey = "e/" + vid;
  let v = await getJSON(vKey);
  const isNew = !v;
  if (!v) v = { vid, first: now, last: now, visits: 0, lastSid: "", counts: {}, secs: 0, lastPing: 0, label: "", flags: {}, sessions: {} };

  v.last = now; v.lastPing = now;
  v.city = g.city || v.city || ""; v.region = g.subdivision?.name || v.region || ""; v.country = g.country?.code || v.country || "";
  v.os = dev.os; v.browser = dev.browser; v.type = dev.type; v.link = link; v.page = page;
  v.counts = v.counts || {}; v.sessions = v.sessions || {}; v.flags = v.flags || {};

  const alerts = [];
  const events = ev === "hb" ? null : (await getJSON(eKey, []));
  const add = (e) => { if (events) { events.push({ t: now, sid, ev, link, page, ...e }); if (events.length > 400) events.splice(0, events.length - 400); } };
  const where = [v.city, v.country].filter(Boolean).join(", ") || "Unknown location";
  const tag = `${who(v)} · <b>${esc(link === "Main" ? "Main link" : link + " link")}</b>${page === "hi" ? " · Hindi" : ""}`;

  if (ev === "visit" && sid !== v.lastSid) {
    v.visits = (v.visits || 0) + 1; v.lastSid = sid;
    v.sessions[sid] = { start: now, qs: 0, summarized: 0 };
    const keys = Object.keys(v.sessions); if (keys.length > 30) delete v.sessions[keys[0]];
    const src = sourceOf(clip(b.ref, 300), ua); v.source = src;
    if (!v.org) { const org = await orgOf(ip); v.org = org; v.orgIsCarrier = isCarrier(org); }
    if (isBotNet(v.org)) v.bot = true;
    add({ data: { source: src, city: where, device: `${dev.os} · ${dev.browser}`, org: v.org || "" } });
    const orgLine = v.org && !v.orgIsCarrier ? `\n🏢 Network: <b>${esc(v.org)}</b>` : "";
    if (v.visits === 1) alerts.push(`👀 <b>New visitor</b>\n${tag}\n📍 ${esc(where)} · ${esc(dev.type)} · ${esc(dev.os)} · ${esc(dev.browser)}\n↪️ Came via: ${esc(src)}${orgLine}\n🕒 ${IST(now)} IST`);
    else alerts.push(`🔁 <b>${who(v)} is back</b> (visit #${v.visits})\n<b>${esc(link === "Main" ? "Main link" : link + " link")}</b> · 📍 ${esc(where)}${orgLine}\nLast seen before this: ${IST(v.prevLast || v.first)} IST\n🕒 ${IST(now)} IST`);
    v.prevLast = now;
  } else if (ev === "hb") {
    // heartbeat only updates lastPing (live-now indicator)
  } else if (ev === "leave") {
    const secs = Math.max(0, Math.min(1800, Number(data.secs) || 0));
    v.secs = (v.secs || 0) + secs;
    const s = v.sessions[sid];
    if (s) s.secs = (s.secs || 0) + secs;
    add({ data: { secs } });
    if (s && s.qs > (s.summarized || 0)) {
      const qs = (events || []).filter((e) => e.sid === sid && (e.ev === "q" || e.ev === "ai")).slice(s.summarized || 0).map((e) => e.data?.text).filter(Boolean);
      if (qs.length) alerts.push(`❓ <b>${who(v)} asked</b> (${esc(link)} link)\n${qs.slice(0, 12).map((q) => "• " + esc(q)).join("\n")}\n⏱️ Time on site this visit: ${Math.round((s.secs || 0) / 60)} min`);
      s.summarized = s.qs;
    }
  } else {
    const d = {};
    if (ev === "q") { d.text = clip(data.text, 200); d.k = clip(data.k, 20); v.counts.q = (v.counts.q || 0) + 1; }
    if (ev === "ai") { d.text = clip(data.text, 300); d.covered = data.covered !== false; d.failed = !!data.failed; d.topic = clip(data.topic, 20); d.model = clip(data.model, 10); v.counts.ai = (v.counts.ai || 0) + 1; }
    if (ev === "card" || ev === "lang" || ev === "mic" || ev === "voice" || ev === "listen" || ev === "copy") { d.what = clip(data.what, 40); v.counts.cards = (v.counts.cards || 0) + 1; }
    if (["call", "email", "linkedin", "cv"].includes(ev)) v.counts[ev] = (v.counts[ev] || 0) + 1;
    if ((ev === "q" || ev === "ai") && v.sessions[sid]) v.sessions[sid].qs = (v.sessions[sid].qs || 0) + 1;
    add({ data: d });
    const hi = { call: "📞 <b>tapped Call</b>", email: "✉️ <b>tapped Email</b>", linkedin: "🔗 <b>opened your LinkedIn</b>", cv: "📄 <b>opened your CV</b>" }[ev];
    if (hi) alerts.push(`${hi}\n${tag} · 📍 ${esc(where)}\n🕒 ${IST(now)} IST`);
  }

  const before = v.score || 0;
  v.score = score(v); v.tier = tier(v.score);
  if (v.score >= HOT && !v.flags.hot) {
    v.flags.hot = true;
    const c = v.counts;
    alerts.push(`🔥 <b>Hot visitor</b> — ${tag}\nScore ${v.score} · ${v.visits} visit(s) · ${(c.q || 0) + (c.ai || 0)} question(s)${c.cv ? " · opened CV" : ""}${c.call ? " · tapped Call" : ""}${c.email ? " · tapped Email" : ""}\n📍 ${esc(where)}${v.org && !v.orgIsCarrier ? " · 🏢 " + esc(v.org) : ""}`);
  }

  await setJSON(vKey, v);
  if (events) await setJSON(eKey, events);
  if (!v.bot) for (const a of alerts) await telegram(a);
  return new Response(JSON.stringify({ ok: true, score: v.score, tier: v.tier, isNew }), { headers: { "content-type": "application/json" } });
};
