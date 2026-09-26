// Private dashboard API. Protected by DASHBOARD_PASSWORD (Netlify env var).
import { getJSON, setJSON, listKeys, istDay, tier } from "../lib/core.mjs";

const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bump = (m, k) => { if (!k) k = "Unknown"; m[k] = (m[k] || 0) + 1; };
const top = (m, n = 10) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);

async function loadAll() {
  const keys = await listKeys("v/");
  const vs = (await Promise.all(keys.map((k) => getJSON(k)))).filter(Boolean);
  const evs = await Promise.all(vs.map((v) => getJSON("e/" + v.vid, [])));
  return vs.map((v, i) => ({ v, e: evs[i] || [] }));
}

export default async (req) => {
  const pass = (process.env.DASHBOARD_PASSWORD || "").trim();
  if (!pass) return J({ error: "Set DASHBOARD_PASSWORD in Netlify environment variables first." }, 503);
  if ((req.headers.get("x-dash-key") || "") !== pass) return J({ error: "Wrong password" }, 401);
  const url = new URL(req.url);

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b.action === "label" && /^[A-Z0-9]{6,12}$/.test(b.vid || "")) {
      const v = await getJSON("v/" + b.vid); if (!v) return J({ error: "not found" }, 404);
      v.label = String(b.label || "").slice(0, 60); v.note = String(b.note || "").slice(0, 500);
      await setJSON("v/" + b.vid, v); return J({ ok: true });
    }
    return J({ error: "bad action" }, 400);
  }

  const view = url.searchParams.get("view") || "summary";
  if (view === "visitor") {
    const vid = url.searchParams.get("vid") || "";
    const v = await getJSON("v/" + vid); if (!v) return J({ error: "not found" }, 404);
    return J({ visitor: v, events: await getJSON("e/" + vid, []) });
  }

  const all = await loadAll();
  const now = Date.now(), today = istDay(now);
  if (view === "csv") {
    const rows = [["time_ist", "visitor", "label", "link", "page", "event", "detail", "city", "device", "source", "network"]];
    for (const { v, e } of all) for (const x of e) {
      const d = x.data || {};
      rows.push([new Date(x.t + 5.5 * 3600e3).toISOString().replace("T", " ").slice(0, 19), v.vid, v.label || "", x.link, x.page, x.ev,
        d.text || d.what || d.source || (d.secs != null ? d.secs + "s" : ""), [v.city, v.country].filter(Boolean).join(" "), `${v.os} ${v.browser}`, v.source || "", v.org || ""]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=resume-activity.csv" } });
  }

  const ov = { visitors: all.length, visits: 0, today: 0, week: 0, questions: 0, cv: 0, calls: 0, emails: 0 };
  const funnel = {}; const qCount = {}; const qText = {}; const gaps = {}; const city = {}, device = {}, source = {}, org = {}, link = {};
  const feed = [];
  for (const { v, e } of all) {
    ov.visits += v.visits || 0;
    ov.cv += v.counts?.cv || 0; ov.calls += v.counts?.call || 0; ov.emails += v.counts?.email || 0;
    bump(city, [v.city, v.country].filter(Boolean).join(", ")); bump(device, `${v.type || ""} · ${v.os} · ${v.browser}`); bump(source, v.source); bump(link, v.link);
    if (v.org && !v.orgIsCarrier) bump(org, v.org);
    const f = (funnel[v.link || "Main"] ||= { opened: 0, asked: 0, cv: 0, contact: 0 });
    f.opened++; if ((v.counts?.q || 0) + (v.counts?.ai || 0) > 0) f.asked++; if (v.counts?.cv) f.cv++; if (v.counts?.call || v.counts?.email || v.counts?.linkedin) f.contact++;
    for (const x of e) {
      if (x.ev === "visit") { if (istDay(x.t) === today) ov.today++; if (now - x.t < 7 * 864e5) ov.week++; }
      if (x.ev === "q" || x.ev === "ai") { ov.questions++; const t = (x.data?.text || "").trim(); if (t) { const k = t.toLowerCase().replace(/[?.!]+$/, ""); qText[k] ||= t; bump(qCount, k); } }
      if (x.ev === "ai" && (x.data?.covered === false || x.data?.failed)) {
        const t = (x.data?.text || "").trim().toLowerCase();
        if (t) { gaps[t] ||= { text: x.data.text, count: 0, last: 0, failed: false }; gaps[t].count++; gaps[t].last = Math.max(gaps[t].last, x.t); gaps[t].failed ||= !!x.data.failed; }
      }
      if (x.ev !== "leave") feed.push({ t: x.t, vid: v.vid, label: v.label, ev: x.ev, link: x.link, data: x.data });
    }
  }
  const visitors = all.map(({ v }) => ({
    vid: v.vid, label: v.label || "", first: v.first, last: v.last, visits: v.visits || 0, score: v.score || 0, tier: v.tier || tier(v.score || 0),
    city: [v.city, v.country].filter(Boolean).join(", "), device: `${v.os} · ${v.browser}`, type: v.type, source: v.source || "", link: v.link || "Main",
    org: v.org && !v.orgIsCarrier ? v.org : "", questions: (v.counts?.q || 0) + (v.counts?.ai || 0), cv: v.counts?.cv || 0,
    contact: (v.counts?.call || 0) + (v.counts?.email || 0), secs: v.secs || 0, live: now - (v.lastPing || 0) < 75000,
  })).sort((a, b) => b.last - a.last);
  feed.sort((a, b) => b.t - a.t);
  return J({
    overview: ov, live: visitors.filter((x) => x.live), funnel, visitors,
    topQuestions: top(qCount, 15).map(([k, n]) => [qText[k] || k, n]), gaps: Object.values(gaps).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 20),
    breakdowns: { city: top(city), device: top(device), source: top(source), network: top(org), link: top(link) },
    feed: feed.slice(0, 40), generated: now,
  });
};
