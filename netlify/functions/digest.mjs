// Daily 9:00 AM IST Telegram digest + 90-day data retention.
import { getJSON, listKeys, del, telegram, istDay, esc, isBotNet } from "../lib/core.mjs";

export const config = { schedule: "30 3 * * *" }; // 03:30 UTC = 09:00 IST

export default async () => {
  const keys = await listKeys("v/");
  const now = Date.now();
  const yesterday = istDay(now - 864e5);
  let visits = 0, newV = 0, qs = 0, cv = 0, contact = 0, hot = []; const links = {}; const qc = {};
  for (const k of keys) {
    const v = await getJSON(k); if (!v) continue;
    if (now - (v.last || 0) > 90 * 864e5) { await del(k); await del("e/" + v.vid); continue; } // retention
    if (v.bot || isBotNet(v.org || "")) continue;
    const e = await getJSON("e/" + v.vid, []);
    const y = e.filter((x) => istDay(x.t) === yesterday);
    if (!y.length) continue;
    const vis = y.filter((x) => x.ev === "visit").length;
    visits += vis; if (istDay(v.first) === yesterday) newV++;
    y.forEach((x) => { if (x.ev === "visit") links[x.link] = (links[x.link] || 0) + 1; if (x.ev === "q" || x.ev === "ai") { qs++; const t = x.data?.text; if (t) qc[t] = (qc[t] || 0) + 1; } if (x.ev === "cv") cv++; if (["call", "email", "linkedin"].includes(x.ev)) contact++; });
    if (v.tier === "hot") hot.push(`#${v.vid.slice(0, 4)}${v.label ? " (" + esc(v.label) + ")" : ""}`);
  }
  if (!visits) { await telegram(`☀️ <b>Daily digest</b> (${yesterday})\nNo visits yesterday.`); return new Response("ok"); }
  const topQ = Object.entries(qc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `• ${esc(t)}${n > 1 ? ` ×${n}` : ""}`).join("\n");
  const linkLine = Object.entries(links).map(([l, n]) => `${esc(l)}: ${n}`).join(" · ");
  await telegram(`☀️ <b>Daily digest</b> (${yesterday})\n👀 ${visits} visit(s) · ${newV} new visitor(s)\n🔗 ${linkLine}\n❓ ${qs} question(s) · 📄 ${cv} CV view(s) · 📞 ${contact} contact tap(s)${hot.length ? `\n🔥 Hot: ${hot.join(", ")}` : ""}${topQ ? `\nTop questions:\n${topQ}` : ""}\n\nOpen dashboard: purusottam-singh.netlify.app/dashboard`);
  return new Response("ok");
};
