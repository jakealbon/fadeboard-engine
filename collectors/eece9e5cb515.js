/* Fade Board collector: runs inside Jake's logged-in browser tabs and returns compact JSON, so the hourly run never reads whole pages.
   window.__fb.vsin(plan) on a data.vsin.com tab: VSiN splits, VSiN Pro Picks, ESPN scoreboards, the Worker's odds, match context.
   window.__fb.sl(plan) on a sportsline.com tab: SportsLine odds, public splits, model and expert picks.
   Both return "FBC1|<tag>|<nonce>|" + JSON. Read-only: nothing here writes anywhere. */
(function(){
const T = e => (e ? e.textContent : "").replace(/\s+/g, " ").trim();
const num = s => { s = String(s == null ? "" : s).replace(/,/g, "").replace(/%/g, "").trim(); if (/^(pk|ev|even)$/i.test(s)) return 0; const v = parseFloat(s); return isNaN(v) ? null : v; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const h32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 5); };
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; try { out[k] = await fn(items[k]); } catch (e){ out[k] = { err: String(e && e.message || e) }; } } })); return out; };
const PARTS = {};   // big results go back in 40k pieces: window.__fb.part(tag, k)
const pack = (tag, nonce, o) => { const s = JSON.stringify(o), n = Math.max(1, Math.ceil(s.length / 40000)); PARTS[tag] = Array.from({ length: n }, (_, k) => `FBC1|${tag}|${nonce}|${k + 1}/${n}|` + s.slice(k * 40000, (k + 1) * 40000)); return PARTS[tag][0] + (n > 1 ? `\n(${n} parts: run window.__fb.part("${tag}", 2) to ${n})` : ""); };
const part = (tag, k) => (PARTS[tag] || [])[k - 1] || "no such part";

/* ---- VSiN betting splits: one page per sport and book ---- */
async function splits(code, book, maxDate){
  const html = await fetch(`https://data.vsin.com/betting-splits/?source=${book}&sport=${code}`, { credentials: "include" }).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
  const rows = [...doc.querySelectorAll("table.sp-table tr.sp-row")];
  for (let i = 0; i + 1 < rows.length; i += 2){
    const a = rows[i], h = rows[i + 1];
    const gc = (a.querySelector("[data-gamecode]") || h.querySelector("[data-gamecode]") || {}).dataset?.gamecode || "";
    const gh = (h.querySelector("[data-gamecode]") || {}).dataset?.gamecode || gc;
    if (gc && gh && gc !== gh){ i--; continue; }   // rows out of step: realign
    if (/sp-game-live/.test(a.className + " " + h.className) || (maxDate && gc.slice(0, 8) > maxDate)) continue;   // started, or further out than this run looks
    const cells = r => [...r.querySelectorAll("td")].slice(2).map(td => num(T(td)));
    const link = r => r.querySelector("a.sp-team-link"), slug = r => ((link(r) || {}).getAttribute?.("href") || "").split("/").filter(Boolean).pop() || "";
    const ca = cells(a), ch = cells(h), live = /sp-game-live/.test(a.className + " " + h.className) ? 1 : 0;
    if (ca[0] == null && ch[0] == null && ca[3] == null) continue;   // no lines posted yet (small-college long tail)
    // [gamecode, live, awayName, homeName, awaySlug, homeSlug, awaySpread, homeSpread, spreadHandleAway, spreadBetsAway, total, overHandle, overBets, mlAway, mlHome, mlHandleAway, mlBetsAway]
    out.push([gc, live, T(link(a)), T(link(h)), slug(a), slug(h), ca[0], ch[0], ca[1], ca[2], ca[3] ?? ch[3], ca[4], ca[5], ca[6], ch[6], ca[7], ca[8]]);
  }
  return out;
}
/* ---- VSiN Pro Picks for one ET date (game picks only; skips ids already stored) ---- */
function vsinParse(s){
  s = String(s || "").replace(/\s*\|\s*[\d.]+% Edge.*$/, "").trim();
  if (/^(Team Total|1st|First|F5|1H|2H|1Q|1P|REG|Parlay|\d-Leg)/i.test(s) || /1st Half|First Half|1st Period|First 5|1st 5|Quarter|LIVE|SGP|Anytime/i.test(s)) return null;
  const U = String.raw`(?:\s*\[(?!\s*[\d.]+\s*units?\s*\]).*?\])*(?:\s*\[\s*([\d.]+)\s*units?\s*\])?\s*$`, P = String.raw`\(([+-]\d+|EV)\)`;
  const bad = x => / - /.test(x);
  let m = s.match(new RegExp(String.raw`^(.+?)\s+(vs|at)\s+(.+?)\s*-\s*(OVER|UNDER)\s*\(([\d.]+)\)\s*` + P + U, "i"));
  if (m) return bad(m[1]) || bad(m[3]) ? null : { market: "total", side: m[4].toLowerCase() };
  m = s.match(new RegExp(String.raw`^(?:Money Line|Moneyline)\s*-\s*(.+?)\s*` + P + String.raw`\s+(vs|at)\s+(.+?)` + U, "i"));
  if (m) return bad(m[1]) || bad(m[4]) ? null : { market: "ml", side: m[3].toLowerCase() === "at" ? "away" : "home" };
  m = s.match(new RegExp(String.raw`^(?:(?:Run Line|Puck Line|Spread)\s*-\s*)?(.+?)\s*\(([+-]?[\d.]+|PK|EV)\)\s*` + P + String.raw`\s+(vs|at)\s+(.+?)` + U, "i"));
  if (m) return bad(m[1]) || bad(m[5]) ? null : { market: "spread", side: m[4].toLowerCase() === "at" ? "away" : "home" };
  return null;
}
async function picks(date, done){
  const html = await fetch("/propicks/eventdate/?eventdate=" + date, { credentials: "include" }).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [], skip = new Set(Array.isArray(done) ? done : String(done || "").split(" ").filter(Boolean));
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const a of doc.querySelectorAll('a[href*="/propicks/game/?gameid="]')){
    const row = a.closest("tr"), head = row && row.previousElementSibling; if (!head) continue;
    const sport = T(head.querySelector('a[href*="sportid="]')); if (!/^(NFL|CFB|CFL|NBA|WNBA|MLB|NHL|CBB|NCAAB)$/.test(sport)) continue;
    const pick = T(a), p = vsinParse(pick); if (!p) continue;
    const ex = head.querySelector('a[href*="vsinexpertid"]'), spans = head.querySelectorAll("span.fw-bold"), divs = row.querySelectorAll("td:first-child div");
    const card = a.closest(".card-body"), tm = card && card.querySelector("span.font-11"), gid = (a.getAttribute("href").match(/gameid=([^&]+)/) || [])[1];
    const res = T(divs[1]);
    if (skip.has(h32(`vsin-${slug(T(ex))}-${String(gid).toLowerCase()}-${p.market}-${p.side}`)) && !/WIN|LOSS|PUSH/i.test(res)) continue;   // stored and still open: nothing new
    if (skip.has(h32(`vsin-${slug(T(ex))}-${String(gid).toLowerCase()}-${p.market}-${p.side}|done`))) continue;   // stored and settled
    out.push([date, sport, gid, T(ex), T(spans[0]), T(spans[1]), T(divs[0]), res, T(tm), pick]);
  }
  return out;
}
/* ---- ESPN scoreboards (public, CORS-open) ---- */
const ESPN = { NFL: "football/nfl", NCAAF: "football/college-football", NBA: "basketball/nba", WNBA: "basketball/wnba", NCAAB: "basketball/mens-college-basketball", MLB: "baseball/mlb", NHL: "hockey/nhl" };
const ESPNQ = { NCAAF: "&groups=80&limit=300", NCAAB: "&groups=50&limit=400" };
async function espn(lg, d){
  const j = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN[lg]}/scoreboard?dates=${d}${ESPNQ[lg] || ""}`).then(r => r.json());
  return (j.events || []).map(e => { const c = e.competitions?.[0] || {}, cs = c.competitors || [], A = cs.find(x => x.homeAway === "away") || {}, H = cs.find(x => x.homeAway === "home") || {}, st = c.status?.type || e.status?.type || {};
    const tm = x => [x.team?.abbreviation || "", x.team?.location || "", x.team?.displayName || "", x.team?.shortDisplayName || ""];
    return [e.id, st.state || "", st.completed ? 1 : 0, e.date || "", ...tm(A), ...tm(H), num(A.score), num(H.score)]; });
}
/* ---- the ChippyTips Worker's stored OddsPapi results ---- */
async function odds(leagues, key, token){
  const r = await fetch("https://nnlhyjxsgtyuygevhwta.supabase.co/rest/v1/rpc/get_odds_raw", { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ p_token: token, p_leagues: leagues }) });
  return { status: r.status, body: r.ok ? await r.json() : (await r.text()).slice(0, 200) };
}
async function vsin(plan){
  const out = { v: 1, t: new Date().toISOString(), splits: {}, picks: {}, espn: {}, odds: null, ctx: null, err: [] };
  const dk = (plan.splits || []).map(([c]) => c), r0 = await pool(dk, 4, c => splits(c, "DK", plan.maxDate));
  dk.forEach((c, i) => { if (r0[i]?.err) out.err.push(`splits ${c} DK: ${r0[i].err}`); else if (r0[i].length) out.splits[c + "|DK"] = r0[i]; });
  const ci = (plan.splits || []).filter(([c, b]) => b.includes("CIRCA") && out.splits[c + "|DK"]).map(([c]) => c), r1 = await pool(ci, 4, c => splits(c, "CIRCA", plan.maxDate));
  ci.forEach((c, i) => { if (r1[i]?.err) out.err.push(`splits ${c} CIRCA: ${r1[i].err}`); else if (r1[i].length) out.splits[c + "|CIRCA"] = r1[i]; });
  const pd = plan.picks || []; const r2 = await pool(pd, 3, ([d, done]) => picks(d, done));
  pd.forEach(([d], i) => { if (r2[i]?.err) out.err.push(`picks ${d}: ${r2[i].err}`); else out.picks[d] = r2[i]; });
  return pack("vsin", plan.nonce, out);
}
/* ---- on Jake's own site (chippytips.com): ESPN scoreboards, the Worker's odds and match context. Kept off the VSiN tab,
   which only ever reads VSiN's own pages ---- */
async function site(plan){
  const out = { v: 1, t: new Date().toISOString(), espn: {}, odds: null, ctx: null, err: [] };
  const ed = plan.espn || []; const r3 = await pool(ed, 4, ([lg, d]) => espn(lg, d));
  ed.forEach(([lg, d], i) => { if (r3[i]?.err) out.err.push(`espn ${lg} ${d}: ${r3[i].err}`); else out.espn[lg + "|" + d] = r3[i]; });
  if (plan.odds && plan.odds.leagues?.length){ try { out.odds = await odds(plan.odds.leagues, plan.odds.key, plan.odds.token);
    const now = Date.now() / 1000, hz = (plan.odds.hz || 36) * 3600;   // keep only fixtures inside this run's window that Pinnacle or Circa price (drops the small-college long tail)
    if (out.odds && out.odds.body && typeof out.odds.body === "object") for (const b of Object.values(out.odds.body)) if (b && Array.isArray(b.f)) b.f = b.f.filter(r => Array.isArray(r) && r[1] > now - 600 && r[1] < now + hz && r[6] && (r[6].pinnacle || r[6].circasports));
  } catch (e){ out.err.push("odds: " + e.message); } }
  if (plan.ctx && plan.ctx.length && window.__fbctx){ try { let r = await window.__fbctx(plan.ctx); out.ctx = typeof r === "string" ? JSON.parse(r) : r; } catch (e){ out.err.push("ctx: " + e.message); } }
  return pack("site", plan.nonce, out);
}

/* ---- SportsLine game pages (structured data inside the page's Next.js payload) ---- */
function slPayload(html){
  let all = ""; for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)){ try { all += JSON.parse('"' + m[1] + '"'); } catch (e){} }
  return all;
}
function objAt(all, i){ let d = 0, s = false, e = false; for (let j = i; j < all.length; j++){ const c = all[j]; if (s){ if (e) e = false; else if (c === "\\") e = true; else if (c === '"') s = false; continue; } if (c === '"') s = true; else if (c === "{" || c === "[") d++; else if (c === "}" || c === "]"){ d--; if (!d){ try { return JSON.parse(all.slice(i, j + 1)); } catch (x){ return null; } } } } return null; }
const after = (all, key, from = 0) => { const i = all.indexOf(key, from); if (i < 0) return null; const k = i + key.length; return all[k] === "{" || all[k] === "[" ? objAt(all, k) : null; };
const before = (all, marker, open) => { const i = all.indexOf(marker); if (i < 0) return null; const k = all.lastIndexOf(open, i); return k < 0 ? null : objAt(all, k + open.length - 1); };
const sents = (s, n = 2, max = 240) => { s = String(s || "").replace(/\s+/g, " ").trim().replace(/(\d)\.(\d)/g, "$1\u00a7$2"); const p = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [s]; let o = p.slice(0, n).join("").trim().replace(/\u00a7/g, "."); return o.length > max ? o.slice(0, max - 1).replace(/\s\S*$/, "") + "…" : o; };
async function slGame(path, abbr, known, recheck){
  const html = await fetch(`/${path}/game-forecast/${abbr}/`, { credentials: "include" }).then(r => r.text());
  const all = slPayload(html); if (!all) return { abbr, err: "no payload" };
  const g = after(all, '"providerProps":') || {};
  if (g.competitionStatus && !/SCHEDULED|PRE/i.test(g.competitionStatus) && !recheck) return { abbr, st: g.competitionStatus, skip: 1 };   // already under way: nothing to collect
  const odds = before(all, '"__typename":"GameOdds"', '"odds":{') || before(all, '"source":"MARKET"', '"odds":{');
  const bs = after(all, '"bettingSplits":');
  const pr = after(all, '"projection":');
  const ov = (o, k) => o && o[k] ? [num(o[k].openingValue), num(o[k].value), num(o[k].openingOutcomeOdds), num(o[k].outcomeOdds)] : null;
  const sp = o => { const r = {}; for (const x of o?.outcomes || []) r[String(x.outcomeType).toLowerCase()] = [x.betPercentage, x.moneyPercentage]; return r; };
  const impl = s => { const m = String(s || "").match(/implied probability of ([\d.]+)%/); return m ? +m[1] : null; };
  const mk = (o, k) => o && o[k] ? [o[k].recommendedBet || null, o[k].recommendedBetGrade || null, o[k].recommendedBetProb != null ? Math.round(o[k].recommendedBetProb * 1000) / 10 : null, impl(o[k].recommendedBetGradeNarrative), num(o[k].recommendedBetSpread ?? o[k].currentTotal ?? null)] : null;
  const seen = new Set(), pk = []; let i = -1;
  while ((i = all.indexOf('"node":{"__typename":"SportsLineExpertPick"', i + 1)) >= 0){
    const n = objAt(all, i + 7); if (!n || seen.has(n.id) || !n.expert || !n.selection) continue; seen.add(n.id);
    const s = n.selection, who = `${n.expert.firstName || ""} ${n.expert.lastName || ""}`.trim();
    const key = h32(who + "|" + n.id);
    if (known && known.has && known.has(key) && !/WIN|LOSS|PUSH/i.test(s.resultStatus || "")) continue;
    const subj = s.subject?.id ? String(s.subject.id) : null, ctx = n.context || {};
    const side = subj && ctx.homeTeam && String(ctx.homeTeam.id) === subj ? "home" : subj && ctx.awayTeam && String(ctx.awayTeam.id) === subj ? "away" : null;
    // [id, expert, record, market, marketDisplay, label, odds, book, unit, side, result, note, typename]
    pk.push([n.id, who, (n.expertStreaks || []).map(x => x.label).slice(0, 1).join(""), s.market?.name || "", s.marketDisplayName || "", s.label || "", num(s.odds), s.sportsbookDisplayName || "", num(s.unit ?? n.unit), side, s.resultStatus || "", sents(n.analysis), String(s.__typename || "").replace("SportsLineExpertPickSelection", "")]);
  }
  const tm = t => t ? [t.abbr || t.abbrev || "", t.location || "", t.mediumName || "", t.nickName || t.nickname || ""] : null;
  return { abbr, ko: g.scheduledTime || null, st: g.competitionStatus || null, a: tm(g.awayTeam), h: tm(g.homeTeam), sc: g.competitionStatus === "FINAL" || /FINAL|COMPLETE/i.test(g.competitionStatus || "") ? [g.awayTeamScoreTotal, g.homeTeamScoreTotal] : null,
    o: odds ? { sh: ov(odds.spread, "home"), sa: ov(odds.spread, "away"), mh: ov(odds.moneyLine, "home"), ma: ov(odds.moneyLine, "away"), ov: ov(odds.total, "over"), un: ov(odds.total, "under") } : null,
    s: bs ? { sp: sp(bs.spread), ml: sp(bs.moneyLine), to: sp(bs.total) } : null,
    m: pr ? { pa: pr.awayScore ?? null, ph: pr.homeScore ?? null, sp: mk(pr, "spread"), ml: mk(pr, "moneyLine"), to: mk(pr, "total") } : null,
    p: pk };
}
async function slIndex(path){
  const html = await fetch(`/${path}/picks/`, { credentials: "include" }).then(r => r.text());
  return [...new Set([...html.matchAll(/\/game-forecast\/([A-Z0-9]+_\d{8}_[A-Z0-9]+@[A-Z0-9]+)\//g)].map(m => m[1]))];
}
async function sl(plan){
  const out = { v: 1, t: new Date().toISOString(), games: [], err: [], idx: {} };
  const dates = new Set(plan.dates || []), skip = new Set(plan.skip || []), want = [];
  const idx = await pool(plan.paths || [], 3, p => slIndex(p));
  (plan.paths || []).forEach((p, i) => { if (idx[i]?.err){ out.err.push(`index ${p}: ${idx[i].err}`); return; } const list = (idx[i] || []).filter(a => dates.has(a.split("_")[1]) && !skip.has(a)); out.idx[p] = (idx[i] || []).length; for (const a of list) want.push([p, a]); });
  for (const [p, a] of plan.recheck || []) if (!want.some(w => w[1] === a)) want.unshift([p, a]);
  want.sort((x, y) => x[1].split("_")[1].localeCompare(y[1].split("_")[1]));
  const per = { "college-football": 25, "college-basketball": 20 }, used = {}, rc = new Set((plan.recheck || []).map(x => x[1]));
  const go = want.filter(([p, a]) => rc.has(a) || (used[p] = (used[p] || 0) + 1) <= (per[p] || 15)).slice(0, plan.cap || 60);
  if (want.length > go.length) out.err.push(`capped ${want.length} -> ${go.length} pages`);
  const known = new Set(String(plan.known || "").split(" ").filter(Boolean)), r = await pool(go, 3, ([p, a]) => slGame(p, a, known, rc.has(a)));
  r.forEach((g, i) => { if (g && g.skip) return; if (g && !g.err) out.games.push({ ...g, path: go[i][0] }); else out.err.push(`${go[i][1]}: ${g?.err}`); });
  return pack("sl", plan.nonce, out);
}
window.__fb = { vsin, sl, site, part, splits, picks, espn, slGame, slIndex, h32, ver: 1 };
return "collector ready";
})();

/* Fade Board context collector. Runs in the built-in browser (javascript_tool) with JOBS embedded.
   JOBS = [{key, league, away, home, kickoff, date(ET YYYY-MM-DD), inj:bool, wx:bool}]
   Returns {ctx:{<key>:{...}}, unmatched:[keys], errors:[...]} */
window.__fbctx = async (JOBS) => {
const SP = { NFL:"football/nfl", NCAAF:"football/college-football", NBA:"basketball/nba", WNBA:"basketball/wnba", NCAAB:"basketball/mens-college-basketball", MLB:"baseball/mlb", NHL:"hockey/nhl" };
const QS = { NCAAF:"&groups=80&limit=300", NCAAB:"&groups=50&limit=400" };
const AL = { WAS:"WSH", GSW:"GS", NYK:"NY", SAS:"SA", NOP:"NO", UTA:"UTAH", LAK:"LA", NJD:"NJ", SJS:"SJ", TBL:"TB", JAC:"JAX", CWS:"CHW", OAK:"ATH", KCR:"KC", SDP:"SD", SFG:"SF", TBR:"TB", WSN:"WSH", CON:"CONN" };
const nrm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ab = s => { s = String(s || "").toUpperCase(); return AL[s] || s; };
const errors = [], out = {}, matched = new Set();
const getJ = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); };
const teamHit = (t, name, college) => {
  if (!t) return false;
  if (!college) return ab(t.abbreviation) === ab(name);
  const n = nrm(name);
  return [t.location, t.shortDisplayName, t.abbreviation, t.displayName, t.name].some(x => nrm(x) === n) || nrm(t.displayName).startsWith(n);
};
const groups = {};
for (const j of JOBS){ if (!SP[j.league]) continue; (groups[j.league + "|" + j.date] = groups[j.league + "|" + j.date] || []).push(j); }
const evById = {};
await Promise.all(Object.entries(groups).map(async ([gk, jobs]) => {
  const [lg, date] = gk.split("|");
  try {
    const sb = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[lg]}/scoreboard?dates=${date.replace(/-/g, "")}${QS[lg] || ""}`);
    const college = lg === "NCAAF" || lg === "NCAAB";
    for (const j of jobs){
      const ev = (sb.events || []).find(e => { const c = e.competitions?.[0]?.competitors || []; const h = c.find(x => x.homeAway === "home"), a = c.find(x => x.homeAway === "away"); return teamHit(a?.team, j.away, college) && teamHit(h?.team, j.home, college); });
      if (!ev) continue;
      matched.add(j.key);
      const c = ev.competitions[0], v = c.venue || {};
      const tv = [...new Set((c.broadcasts || []).flatMap(b => b.names || []).concat((c.geoBroadcasts || []).map(b => b.media?.shortName).filter(Boolean)))];
      out[j.key] = { venue: v.fullName || null, city: v.address?.city || null, state: v.address?.state || null, country: v.address?.country || null, indoor: typeof v.indoor === "boolean" ? v.indoor : null, neutral: !!c.neutralSite, tv, weather: ev.weather ? { txt: ev.weather.displayValue || null, temp: ev.weather.temperature ?? null } : null, espnId: ev.id, kickoff: ev.date ? new Date(ev.date).toISOString() : null, t: new Date().toISOString() };
      evById[j.key] = { id: ev.id, lg, j };
    }
  } catch (e){ errors.push(String(e.message || e)); }
}));
/* injuries with season averages */
const statCache = {};
const athStats = async (lg, id) => {
  const k = lg + "|" + id; if (statCache[k]) return statCache[k];
  statCache[k] = (async () => {
    try {
      const o = await getJ(`https://site.web.api.espn.com/apis/common/v3/sports/${SP[lg]}/athletes/${id}/overview`);
      const st = o.statistics; if (!st || !st.splits || !st.splits.length) return null;
      const sp = st.splits.find(s => /regular/i.test(s.displayName || "")) || st.splits[0];
      const val = name => { const i = (st.names || []).indexOf(name); return i < 0 ? null : parseFloat(sp.stats[i]); };
      if (lg === "NBA" || lg === "WNBA" || lg === "NCAAB"){
        const p = val("avgPoints"), r = val("avgRebounds"), a = val("avgAssists");
        return { gp: val("gamesPlayed"), min: val("avgMinutes"), pts: p, reb: r, ast: a, pra: p != null && r != null && a != null ? Math.round((p + r + a) * 10) / 10 : null };
      }
      return { gp: val("gamesPlayed"), line: (st.labels || []).slice(0, 6).map((l, i) => `${l} ${sp.stats[i]}`).join(", ") };
    } catch (e){ return null; }
  })();
  return statCache[k];
};
await Promise.all(Object.entries(evById).filter(([k, x]) => x.j.inj).map(async ([k, x]) => {
  try {
    const s = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[x.lg]}/summary?event=${x.id}`);
    const college = x.lg === "NCAAF" || x.lg === "NCAAB";
    const inj = { away: [], home: [], lt: {} };
    for (const t of s.injuries || []){
      const side = teamHit(t.team, x.j.away, college) ? "away" : teamHit(t.team, x.j.home, college) ? "home" : null; if (!side) continue;
      for (const i of t.injuries || []){
        const st = i.status || i.type?.description || ""; if (!/out|doubt|question|day-to-day|injured reserve/i.test(st)) continue;
        const ret = i.details?.returnDate || null;
        const longTerm = ret ? (new Date(ret) - Date.now()) > 30 * 864e5 : false;
        if (longTerm){ inj.lt[side] = (inj.lt[side] || 0) + 1; continue; }   // long-term absences are already in the price
        inj[side].push({ id: i.athlete?.id || null, n: i.athlete?.displayName || "", pos: i.athlete?.position?.abbreviation || "", st, why: i.details?.type || null });
      }
    }
    for (const side of ["away", "home"]){
      inj[side] = inj[side].slice(0, 10);
      await Promise.all(inj[side].map(async p => { if (p.id && /out|doubt/i.test(p.st)) p.s = await athStats(x.lg, p.id); }));
    }
    out[k].inj = inj; out[k].injT = new Date().toISOString();
  } catch (e){ errors.push(String(e.message || e)); }
}));
/* weather for outdoor games */
const geo = {};
await Promise.all(Object.entries(evById).filter(([k, x]) => x.j.wx && out[k].indoor !== true && out[k].city).map(async ([k, x]) => {
  try {
    const c = out[k], q = c.city + "|" + (c.state || c.country || "");
    if (!geo[q]) geo[q] = getJ(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.city)}&count=10`).then(g => (g.results || []).find(r => !c.state || r.admin1_code === c.state || (r.admin1 || "").toLowerCase().startsWith(String(c.state).toLowerCase())) || (g.results || [])[0] || null);
    const loc = await geo[q]; if (!loc) return;
    const ko = new Date(c.kickoff || x.j.kickoff); if (isNaN(ko)) return;
    const f = await getJ(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=7&timezone=UTC`);
    const hr = ko.toISOString().slice(0, 13) + ":00", i = f.hourly.time.indexOf(hr); if (i < 0) return;
    const pick = a => a.slice(i, i + 3).filter(v => v != null);
    const mx = a => { const v = pick(a); return v.length ? Math.max(...v) : null; };
    c.wx = { ws: mx(f.hourly.wind_speed_10m), g: mx(f.hourly.wind_gusts_10m), d: f.hourly.wind_direction_10m[i], p: mx(f.hourly.precipitation_probability), mm: pick(f.hourly.precipitation).reduce((a, b) => a + b, 0), temp: f.hourly.temperature_2m[i], t: new Date().toISOString() };
  } catch (e){ errors.push(String(e.message || e)); }
}));
return JSON.stringify(({ ctx: out, unmatched: JOBS.filter(j => SP[j.league] && !matched.has(j.key)).map(j => j.key), errors: errors.slice(0, 10) }));
};
"collector ready"
