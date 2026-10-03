const num = v => (v === null || v === undefined || v === "" || isNaN(+v)) ? null : +v;
const fmtLine = v => v === null ? "–" : (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
const dec = v => v === null || v === 0 ? null : (v > 0 ? 1 + v / 100 : 1 + 100 / -v);
const fmtOdds = v => { const d = dec(v); return d === null ? "–" : d.toFixed(2); };
const implied = o => o === null ? null : (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const started = g => g.kickoff && new Date(g.kickoff).getTime() < Date.now();
const graded = g => g.final && num(g.final.away) !== null && num(g.final.home) !== null;

function splitsFor(g, book){
  const sp = g.splits || {};
  if (book === "sharp"){
    const d = sp.dk || {}, c = sp.circa || {};
    return { spreadAwayBets: d.spreadAwayBets, spreadAwayHandle: c.spreadAwayHandle, overBets: d.overBets, overHandle: c.overHandle, mlAwayBets: d.mlAwayBets, mlAwayHandle: c.mlAwayHandle };
  }
  return sp[book] || {};
}
const HKEY = { spread:"spreadAwayHandle", total:"overHandle", ml:"mlAwayHandle" };
function circaShare(g, mk, side){
  const v = num(g.splits?.circa?.[HKEY[mk]]); if (v === null) return null;
  return (side === "away" || side === "over") ? v : 100 - v;
}
function signal(g, mk, book = S.book){
  const s = baseSignal(g, mk, book);
  if (s) s.circaPub = circaShare(g, mk, s.pub);
  return s;
}
function followSig(g, mk){
  const v = num(g.splits?.circa?.[HKEY[mk]]); if (v === null) return null;
  const first = mk === "total" ? "over" : "away", second = mk === "total" ? "under" : "home";
  const side = v >= 50 ? first : second, share = side === first ? v : 100 - v;
  if (share < S.circaMin) return null;
  const dv = num(g.splits?.dk?.[HKEY[mk]]);
  const dkShare = dv === null ? null : (side === first ? dv : 100 - dv);
  const split = dkShare !== null && dkShare <= 40;
  let fadeLine, label;
  if (mk === "spread"){ const c = num(g.spread?.cur); fadeLine = c === null ? null : (side === "home" ? c : -c); label = `${g[side]} ${fmtLine(fadeLine)}`; }
  else if (mk === "total"){ fadeLine = num(g.total?.cur); label = `${side === "over" ? "Over" : "Under"} ${fadeLine ?? "–"}`; }
  else { fadeLine = num(g.ml?.[side]); label = `${g[side]} ${fmtOdds(fadeLine)}`; }
  return { fade: side, fadeLine, share, dkShare, split, label };
}
function followPlan(g, mk, fs){
  const stake = fs.split ? 1.5 : 1;
  let ml = null;
  if (S.sprinkle && mk === "spread"){ const d = dec(num(g.ml?.[fs.fade])); if (d !== null && d >= 2) ml = { stake: +(stake * 0.25).toFixed(3), dec: d }; }
  return { stake, ml };
}
function priceMove(grp, side){
  if (!grp) return null;
  const o = num(grp[side + "Open"]), c = num(grp[side]);
  if (o === null || c === null) return null;
  return +((implied(o) - implied(c)) * 100).toFixed(1);
}
function withPriceMove(r, grp){
  if (r.move) return r;
  const pm = priceMove(grp, r.pub);
  if (pm === null || Math.abs(pm) < 2) return r;
  return { ...r, move: pm, rlm: pm > 0, steam: pm < 0, moveTxt: `price moved ${Math.abs(pm)}% in implied probability` };
}
function baseSignal(g, mk, book = S.book){
  const sp = splitsFor(g, book);
  if (mk === "spread"){
    const b = num(sp.spreadAwayBets); if (b === null) return null;
    const h = num(sp.spreadAwayHandle);
    const pub = b >= 50 ? "away" : "home";
    const pubBets = pub === "away" ? b : 100 - b;
    const pubHandle = h === null ? null : (pub === "away" ? h : 100 - h);
    const lineFor = (side, homeLine) => homeLine === null ? null : (side === "home" ? homeLine : -homeLine);
    const open = num(g.spread?.open), cur = num(g.spread?.cur);
    const move = (open !== null && cur !== null) ? +(lineFor(pub, cur) - lineFor(pub, open)).toFixed(1) : null;
    const fade = pub === "away" ? "home" : "away";
    const fadeLine = lineFor(fade, cur);
    return withPriceMove({ pub, pubBets, pubHandle, gap: pubHandle === null ? null : pubBets - pubHandle,
      move, rlm: move !== null && move > 0, steam: move !== null && move < 0,
      fade, fadeLine, pubLabel: g[pub], fadeLabel: `${g[fade]} ${fmtLine(fadeLine)}${g.spreadPrice?.[fade] != null ? " @ " + fmtOdds(num(g.spreadPrice[fade])) : ""}`, moveTxt: move ? `${Math.abs(move)} pt${Math.abs(move) === 1 ? "" : "s"}` : "" }, g.spreadPrice);
  }
  if (mk === "total"){
    const b = num(sp.overBets); if (b === null) return null;
    const h = num(sp.overHandle);
    const pub = b >= 50 ? "over" : "under";
    const pubBets = pub === "over" ? b : 100 - b;
    const pubHandle = h === null ? null : (pub === "over" ? h : 100 - h);
    const open = num(g.total?.open), cur = num(g.total?.cur);
    let move = null; if (open !== null && cur !== null) move = +(pub === "over" ? open - cur : cur - open).toFixed(1);
    const fade = pub === "over" ? "under" : "over";
    return withPriceMove({ pub, pubBets, pubHandle, gap: pubHandle === null ? null : pubBets - pubHandle,
      move, rlm: move !== null && move > 0, steam: move !== null && move < 0,
      fade, fadeLine: cur, pubLabel: pub === "over" ? "Over" : "Under", fadeLabel: `${fade === "over" ? "Over" : "Under"} ${cur ?? "–"}${g.totalPrice?.[fade] != null ? " @ " + fmtOdds(num(g.totalPrice[fade])) : ""}`, moveTxt: move ? `${Math.abs(move)} pt${Math.abs(move) === 1 ? "" : "s"}` : "" }, g.totalPrice);
  }
  const b = num(sp.mlAwayBets); if (b === null) return null;
  const h = num(sp.mlAwayHandle);
  const pub = b >= 50 ? "away" : "home";
  const pubBets = pub === "away" ? b : 100 - b;
  const pubHandle = h === null ? null : (pub === "away" ? h : 100 - h);
  const oOpen = num(g.ml?.[pub + "Open"]), oCur = num(g.ml?.[pub]);
  let move = null; if (oOpen !== null && oCur !== null) move = +((implied(oOpen) - implied(oCur)) * 100).toFixed(1);
  const fade = pub === "away" ? "home" : "away";
  const fadeOdds = num(g.ml?.[fade]);
  return { pub, pubBets, pubHandle, gap: pubHandle === null ? null : pubBets - pubHandle,
    move, rlm: move !== null && move > 0.5, steam: move !== null && move < -0.5,
    fade, fadeLine: fadeOdds, pubLabel: g[pub], fadeLabel: `${g[fade]} ${fmtOdds(fadeOdds)}`, moveTxt: move ? `price moved ${Math.abs(move)}% in implied probability` : "" };
}
function qualifies(sig){
  if (!sig) return false;
  if (sig.pubBets < S.minPct) return false;
  if (S.minGap > 0 && (sig.gap === null || sig.gap < S.minGap)) return false;
  if (S.rlm && !sig.rlm) return false;
  if (S.circaTie && sig.circaPub !== null && sig.circaPub >= 50) return false;
  return true;
}
function grade(g, mk, sig){
  if (!graded(g) || !sig) return null;
  const a = +g.final.away, h = +g.final.home;
  if (mk === "spread"){
    if (sig.fadeLine === null) return null;
    const m = (sig.fade === "home" ? h - a : a - h) + sig.fadeLine;
    return m > 0 ? "W" : m < 0 ? "L" : "P";
  }
  if (mk === "total"){
    if (sig.fadeLine === null) return null;
    const t = a + h; if (t === sig.fadeLine) return "P";
    return (sig.fade === "over") === (t > sig.fadeLine) ? "W" : "L";
  }
  if (a === h) return "P";
  return (sig.fade === "home") === (h > a) ? "W" : "L";
}
const TIERS = [0.5, 1, 1.5];
function stakePlan(g, mk, sig){
  const conf = (sig.gap !== null && sig.gap >= 10 ? 1 : 0) + (sig.rlm ? 1 : 0);
  const noCirca = S.circaTie && sig.circaPub === null;
  const stake = (S.tiered ? TIERS[conf] : 1) * (noCirca ? 0.5 : 1);
  let ml = null;
  if (S.sprinkle && mk === "spread"){
    const d = dec(num(g.ml?.[sig.fade]));
    if (d !== null && d >= 2) ml = { stake: +(stake * 0.25).toFixed(3), dec: d };
  }
  return { conf, stake, ml, noCirca };
}
function mlResult(g, side){
  const a = +g.final.away, h = +g.final.home;
  if (a === h) return "P";
  return (side === "home") === (h > a) ? "W" : "L";
}
function winPrice(g, mk, sig){
  if (mk === "ml") return dec(sig.fadeLine) ?? 1.91;
  const grp = mk === "spread" ? g?.spreadPrice : g?.totalPrice;
  return dec(num(grp?.[sig.fade])) ?? 1.91;
}
const units = (r, mk, sig, g) => r === "W" ? winPrice(g, mk, sig) - 1 : r === "L" ? -1 : 0;

/* ---------- verdict: one best bet per game per axis ---------- */
const NOWMS = () => (typeof NOW !== "undefined" ? NOW.getTime() : Date.now());
function verdict(g, groups){
  const axes = { side: {}, total: {} }, steam = {};
  const axisOf = mk => mk === "total" ? "total" : "side";
  const MKN = { spread: spreadName(g.league).toLowerCase(), total: "total", ml: "moneyline" };
  const add = (axis, dir, w, why0, mk) => { const why = `${MKN[mk][0].toUpperCase() + MKN[mk].slice(1)}: ${why0}`; const a = axes[axis][dir] = axes[axis][dir] || { score: 0, why: [], mk: {} }; a.score += w; a.why.push(why); a.mk[mk] = (a.mk[mk] || 0) + w; };
  for (const mk of ["spread", "total", "ml"]){
    const sig = signal(g, mk);
    if (qualifies(sig)) add(axisOf(mk), sig.fade, sig.circaPub === null ? 1 : 2, `fade the public (${sig.pubBets}% of tickets the other way)`, mk);
    const fs = followSig(g, mk);
    if (fs){
      add(axisOf(mk), fs.fade, fs.split ? 2.5 : 2, `Circa money ${fs.share}%${fs.split ? ", DK money the other way" : ""}`, mk);
      const dk = signal(g, mk, "dk");
      if (dk && dk.fade === fs.fade && dk.rlm) steam[axisOf(mk)] = { dir: fs.fade, mk, txt: dk.moveTxt };
    }
  }
  const hasModel = new Set();
  for (const gr of groups || []){
    if (!["spread", "total", "ml"].includes(gr.market)) continue;
    let w = 0, why = "";
    if (gr.model){ w = /^A/i.test(gr.grade || "") ? 1.5 : /^B/i.test(gr.grade || "") ? 1 : 0; why = `SportsLine model grade ${gr.grade}`; hasModel.add(gr.market); }
    else if (gr.sys){ w = 0.5 * gr.n; why = gr.n > 1 ? `${gr.n} systems` : "system"; }
    else { w = gr.n >= 2 ? Math.min(gr.n, 3) : 0.5; why = gr.n >= 2 ? `${gr.n} tipsters` : "1 tipster"; }
    if (w) add(axisOf(gr.market), gr.side, w, why, gr.market);
  }
  for (const mk of ["spread", "total", "ml"]){
    const m = g.model?.[mk]; if (!m || !m.side || hasModel.has(mk) || !/^[AB]/i.test(m.grade || "")) continue;
    add(axisOf(mk), m.side, /^A/i.test(m.grade) ? 1.5 : 1, `SportsLine model grade ${m.grade}`, mk);
  }
  for (const axis of ["side", "total"]){   // Pinnacle movement since it opened, stronger when it goes against the public
    const pm = typeof pinMove === "function" ? pinMove(g, axis) : null; if (!pm) continue;
    const pub = signal(g, pm.mk === "ml" ? "ml" : pm.mk, "dk") || signal(g, pm.mk);
    const rlm = pub && pub.pubBets >= 55 && pub.pub !== pm.dir;
    add(axis, pm.dir, rlm ? 2 : 1.5, rlm ? `Pinnacle moved against the public (${pm.txt})` : `Pinnacle moved this way (${pm.txt})`, pm.mk);
  }
  const hrs = g.kickoff ? (new Date(g.kickoff).getTime() - NOWMS()) / 36e5 : 99;
  const tf = hrs > 24 ? 0.6 : hrs > 8 ? 0.8 : 1;
  const early = typeof earlyInfo === "function" ? earlyInfo(g) : null;
  const out = {};
  for (const axis of ["side", "total"]){
    const dirs = Object.entries(axes[axis]).sort((a, b) => b[1].score - a[1].score);
    if (!dirs.length) continue;
    const [dir, top] = dirs[0], against = dirs[1] ? dirs[1][1].score : 0, againstWhy = dirs[1] ? [...new Set(dirs[1][1].why)] : [];
    const net = top.score - against, st = steam[axis] && steam[axis].dir === dir ? steam[axis] : null;
    let adj = net * tf * (early ? 0.7 : 1) + (st ? 1 : 0);
    const split = against >= 1.5 && net < 2;
    const rating = split ? "Split" : adj >= 4.5 ? "Strong" : adj >= 2.5 ? "Solid" : adj >= 1 ? "Lean" : "None";
    let mk = Object.entries(top.mk).sort((a, b) => b[1] - a[1] || (a[0] === "spread" ? -1 : 1))[0][0];
    if (axis === "side" && (g.league === "MLB" || g.league === "NHL") && num(g.ml?.[dir]) !== null) mk = "ml";
    let line = null, price = null, label = "";
    if (mk === "spread"){ const c = num(g.spread?.cur); line = c === null ? null : (dir === "home" ? c : -c); price = num(g.spreadPrice?.[dir]) ?? -110; label = `${g[dir]} ${fmtLine(line)}`; }
    else if (mk === "total"){ line = num(g.total?.cur); price = num(g.totalPrice?.[dir]) ?? -110; label = `${dir === "over" ? "Over" : "Under"} ${line ?? "–"}`; }
    else { price = num(g.ml?.[dir]); label = `${g[dir]} ML`; }
    out[axis] = { axis, dir, mk, line, price, label, score: +adj.toFixed(2), raw: +top.score.toFixed(2), against: +against.toFixed(2), againstWhy,
      rating, why: [...new Set(top.why)], split, steam: st, early, hrs, stake: rating === "Strong" ? 1.5 : rating === "Solid" ? 1 : rating === "Lean" ? 0.5 : 0 };
  }
  return out;
}
const RATING_ICON = { Strong: "🔥", Solid: "🎯", Lean: "👀", Split: "⚖️", None: "·" };

/* ---------- match context: venue, local time, travel ---------- */
const TZE = "America/New_York", TZC = "America/Chicago", TZM = "America/Denver", TZP = "America/Los_Angeles", TZAZ = "America/Phoenix";
const TEAM_TZ = (() => {
  const m = {}, add = (lg, tz, s) => s.split(" ").forEach(t => m[lg + "|" + t] = tz);
  add("NFL", TZE, "ATL BAL BUF CAR CIN CLE DET IND JAX MIA NE NYG NYJ PHI PIT TB WSH WAS"); add("NFL", TZC, "CHI DAL GB HOU KC MIN NO TEN"); add("NFL", TZM, "DEN"); add("NFL", TZAZ, "ARI"); add("NFL", TZP, "LV LAC LAR SF SEA");
  add("NBA", TZE, "ATL BOS BKN CHA CLE DET IND MIA NY NYK ORL PHI TOR WSH WAS"); add("NBA", TZC, "CHI DAL HOU MEM MIL MIN NO NOP OKC SA SAS"); add("NBA", TZM, "DEN UTAH UTA"); add("NBA", TZAZ, "PHX"); add("NBA", TZP, "GS GSW LAC LAL POR SAC");
  add("MLB", TZE, "ATL BAL BOS CIN CLE DET MIA NYM NYY PHI PIT TB TOR WSH WAS"); add("MLB", TZC, "CHC CHW CWS HOU KC MIL MIN STL TEX"); add("MLB", TZM, "COL"); add("MLB", TZAZ, "ARI"); add("MLB", TZP, "LAA LAD ATH OAK SD SF SEA");
  add("NHL", TZE, "BOS BUF CAR CBJ DET FLA MTL NJ NYI NYR OTT PHI PIT TB TOR WSH"); add("NHL", TZC, "CHI DAL MIN NSH STL WPG"); add("NHL", TZM, "COL UTA UTAH"); add("NHL", "America/Edmonton", "CGY EDM"); add("NHL", TZP, "ANA LA LAK SJ SEA VAN VGK");
  add("WNBA", TZE, "ATL CONN IND NY WSH TOR"); add("WNBA", TZC, "CHI DAL MIN"); add("WNBA", TZAZ, "PHX"); add("WNBA", TZP, "GS LV LA SEA POR");
  add("CFL", TZE, "HAM TOR OTT MTL"); add("CFL", TZC, "WPG"); add("CFL", "America/Regina", "SSK SAS"); add("CFL", "America/Edmonton", "CGY EDM"); add("CFL", "America/Vancouver", "BC");
  return m;
})();
const STATE_TZ = (() => {
  const m = {}, add = (tz, s) => s.split(" ").forEach(t => m[t] = tz);
  add(TZE, "CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV ON QC"); add(TZC, "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI MB"); add(TZM, "CO ID MT NM UT WY AB"); add(TZAZ, "AZ"); add(TZP, "CA NV OR WA BC");
  add("America/Regina", "SK"); add("America/Halifax", "NS NB"); add("America/Anchorage", "AK"); add("Pacific/Honolulu", "HI"); return m;
})();
const STATE_NAME = {"alabama":"AL","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY","alaska":"AK","hawaii":"HI","ontario":"ON","quebec":"QC","manitoba":"MB","saskatchewan":"SK","alberta":"AB","british columbia":"BC","nova scotia":"NS"};
const CITY_TZ = { "Knoxville": TZE, "Chattanooga": TZE, "Bowling Green": TZC, "El Paso": TZM, "Pensacola": TZC, "Moscow": TZP, "London": "Europe/London", "Dublin": "Europe/Dublin", "Berlin": "Europe/Berlin", "Frankfurt": "Europe/Berlin", "Munich": "Europe/Berlin", "Madrid": "Europe/Madrid", "Paris": "Europe/Paris", "Mexico City": "America/Mexico_City", "Sao Paulo": "America/Sao_Paulo", "São Paulo": "America/Sao_Paulo", "Melbourne": "Australia/Melbourne", "Sydney": "Australia/Sydney", "Tokyo": "Asia/Tokyo", "Seoul": "Asia/Seoul" };
function venueTz(c){
  if (!c) return null;
  if (c.tz) return c.tz;
  if (c.city && CITY_TZ[c.city]) return CITY_TZ[c.city];
  const st = c.state ? (STATE_NAME[String(c.state).toLowerCase()] || String(c.state).toUpperCase()) : null;
  if (st && STATE_TZ[st]) return STATE_TZ[st];
  return null;
}
function tzOff(tz, iso){   // UTC offset in hours at that moment
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(iso)).find(x => x.type === "timeZoneName").value;
    const m = p.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? +m[1] + (m[2] ? Math.sign(+m[1] || 1) * +m[2] / 60 : 0) : 0;
  } catch (e){ return null; }
}
const localClock = (tz, iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(/\s?(AM|PM)/, m => m.trim().toLowerCase());
const localHour = (tz, iso) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).split(":"); return +p[0] + +p[1] / 60; };
const TZ_NAME = { [TZE]: "Eastern", [TZC]: "Central", [TZM]: "Mountain", [TZAZ]: "Arizona", [TZP]: "Pacific", "America/Edmonton": "Mountain", "America/Vancouver": "Pacific", "America/Regina": "Central" };
let LEARNED_TZ = null;
function learnTeamTz(list){   // college teams: take the time zone of their own non-neutral home venue
  LEARNED_TZ = {};
  for (const g of list){ const tz = venueTz(g.ctx); if (tz && g.ctx && !g.ctx.neutral) LEARNED_TZ[g.league + "|" + g.home] = tz; }
}
const teamTz = (lg, team) => TEAM_TZ[lg + "|" + team] || (LEARNED_TZ && LEARNED_TZ[lg + "|" + team]) || null;
/* the travelling team, zones crossed and the body-clock start time */
function travelInfo(g){
  const vtz = venueTz(g.ctx); if (!vtz || !g.kickoff) return null;
  const vOff = tzOff(vtz, g.kickoff);
  const one = side => {
    const tz = teamTz(g.league, g[side]); if (!tz) return null;
    const zones = Math.round(vOff - tzOff(tz, g.kickoff));
    const body = localHour(tz, g.kickoff);
    const dir = zones >= 2 ? "east" : zones <= -2 ? "west" : null;
    const early = dir === "east" && body < 11.5, late = dir === "west" && body >= 21;
    return { side, team: g[side], tz, zones, dir, body, bodyTxt: localClock(tz, g.kickoff), early, late };
  };
  const away = one("away"), home = g.ctx?.neutral ? one("home") : null;
  const flag = [away, home].filter(x => x && x.dir);
  return { vtz, local: localClock(vtz, g.kickoff), away, home, flag, fade: !g.ctx?.neutral && away && away.dir ? away : null };
}
const travelTxt = t => `${t.team} travelling ${Math.abs(t.zones)} zones ${t.dir}, ${t.bodyTxt} body clock${t.early ? " (early start)" : t.late ? " (late start)" : ""}`;
function ctxLine(g){   // one line for Discord and the card: venue, local time, TV
  const c = g.ctx; if (!c) return null;
  const tr = g.kickoff ? travelInfo(g) : null, bits = [];
  if (c.venue) bits.push(`${c.venue}${c.city ? ", " + c.city + (c.state ? " " + c.state : "") : ""}`);
  if (tr) bits.push(`${tr.local} local`);
  if (c.tv && c.tv.length) bits.push(`📺 ${c.tv.join(", ")}`);
  return bits.length ? bits.join(" · ") : null;
}

const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = d => d == null ? "" : COMPASS[Math.round(((+d % 360) + 360) % 360 / 22.5) % 16];
const WIND_MPH = 15, GUST_MPH = 25, RAIN_PCT = 50;
function wxInfo(g){   // forecast at the start for outdoor games
  const c = g.ctx; if (!c || c.indoor === true || !c.wx) return null;
  const w = c.wx, windy = (w.ws != null && w.ws >= WIND_MPH) || (w.g != null && w.g >= GUST_MPH), wet = w.p != null && w.p >= RAIN_PCT;
  const txt = `${w.ws != null ? Math.round(w.ws) + "mph" : "?"} from ${compass(w.d)}${w.g != null ? " (gusts " + Math.round(w.g) + ")" : ""}${w.p != null ? ` · ${Math.round(w.p)}% rain` : ""}${w.temp != null ? ` · ${Math.round(w.temp)}°F` : ""}`;
  return { windy, wet, txt, w };
}
const isHoops = lg => lg === "NBA" || lg === "WNBA" || lg === "NCAAB";
function injSide(g, side){   // players out or doubtful, with what they're worth
  const list = (g.ctx?.inj?.[side] || []).filter(p => /out|doubt/i.test(p.st || ""));
  const pra = isHoops(g.league) ? list.reduce((a, p) => a + (p.s?.pra || 0), 0) : null;
  return { list, pra: pra ? Math.round(pra * 10) / 10 : 0, lt: g.ctx?.inj?.lt?.[side] || 0 };
}
const statTxt = (g, p) => !p.s ? "" : isHoops(g.league) ? (p.s.pra != null ? `${p.s.pra} PRA (${p.s.pts}/${p.s.reb}/${p.s.ast}), ${p.s.min} min` : "") : (p.s.line || "");
function injLine(g){   // short line for Discord
  const bits = [];
  for (const side of ["away", "home"]){
    const x = injSide(g, side); if (!x.list.length) continue;
    const names = x.list.slice(0, 3).map(p => `${p.n}${p.pos ? " (" + p.pos + ")" : ""}${isHoops(g.league) && p.s?.pra ? " " + p.s.pra : ""}`).join(", ");
    bits.push(`${g[side]} ${isHoops(g.league) && x.pra ? `missing ${x.pra} PRA: ` : "out: "}${names}${x.list.length > 3 ? ` +${x.list.length - 3}` : ""}`);
  }
  return bits.length ? `🩹 ${bits.join(" · ")}` : null;
}

/* ---------- Pinnacle and Aussie prices (OddsPapi) ---------- */
/* each book is [mlHome, mlAway, spreadLine(home), spHome, spAway, totalLine, over, under, changedAt] in decimal odds */
const AUBK = [["tab", "TAB"], ["pb", "PointsBet"], ["neds", "Neds"], ["uni", "Unibet"]];
const BKNAME = { pin: "Pinnacle", circa: "Circa", tab: "TAB", pb: "PointsBet", neds: "Neds", uni: "Unibet" };
const nv2 = (a, b) => (a && b) ? (1 / a) / ((1 / a) + (1 / b)) : null;
const pinNow = g => g.pin?.c || null, pinOpenArr = g => g.pin?.o || null;
function pinClose(g){
  if (!g.pin) return null;
  const ko = g.kickoff ? Date.parse(g.kickoff) / 1000 : Infinity;
  const hs = (g.pin.h || []).filter(x => x[0] <= ko);
  if (hs.length) return hs[hs.length - 1].slice(1);
  return (g.pin.t || 0) <= ko ? g.pin.c : null;
}
function bookQuote(arr, mk, side){
  if (!arr) return null;
  if (mk === "ml"){ const p = side === "home" ? arr[0] : arr[1]; return p ? { line: null, price: p } : null; }
  if (mk === "spread"){ if (arr[2] == null) return null; const p = side === "home" ? arr[3] : arr[4]; return p ? { line: side === "home" ? arr[2] : -arr[2], price: p } : null; }
  if (arr[5] == null) return null; const p = side === "over" ? arr[6] : arr[7]; return p ? { line: arr[5], price: p } : null;
}
function fairProb(arr, mk, side){
  if (!arr) return null;
  const [a, b] = mk === "ml" ? [arr[0], arr[1]] : mk === "spread" ? [arr[3], arr[4]] : [arr[6], arr[7]];
  const p = nv2(a, b); if (p == null) return null;
  return side === (mk === "total" ? "over" : "home") ? p : 1 - p;
}
/* how much better a line is for the side (positive = better for the bettor) */
const lineEdge = (mk, side, line, ref) => line == null || ref == null ? 0 : mk === "spread" ? line - ref : mk === "total" ? (side === "over" ? ref - line : line - ref) : 0;
function auQuotes(g, mk, side, line){   // Aussie books for this bet, best first
  const books = g.odds?.books || {}, out = [];
  for (const [k, name] of AUBK){
    const q = bookQuote(books[k], mk, side); if (!q) continue;
    out.push({ k, name, price: q.price, line: q.line, edge: lineEdge(mk, side, q.line, line) });
  }
  out.sort((a, b) => (b.edge - a.edge) || (b.price - a.price));
  return out;
}
const fmtQLine = (mk, side, line) => line == null ? "" : mk === "spread" ? fmtLine(line) : (side === "over" ? "o" : "u") + line;
function auLine(g, mk, side, line){   // one line for Discord and cards
  const q = auQuotes(g, mk, side, line); if (!q.length) return null;
  const top = q[0];
  return q.map((x, i) => `${i === 0 ? "**" : ""}${x.name} ${mk !== "ml" && x.line !== line ? fmtQLine(mk, side, x.line) + " " : ""}${x.price.toFixed(2)}${i === 0 ? "**" : ""}`).join(" · ");
}
function pinRef(g, mk, side){
  const c = pinNow(g), q = bookQuote(c, mk, side), fp = fairProb(c, mk, side);
  if (!q) return null;
  return { line: q.line, price: q.price, fair: fp ? 1 / fp : null };
}
/* which way Pinnacle has moved since a base snapshot */
const PIN_KEY = [3, 7];
function pinMove(g, axis, base, strict){
  const c = pinNow(g); base = base || pinOpenArr(g); if (!c || !base) return null;
  const lg = g.league, noSpread = lg === "MLB" || lg === "NHL";
  const foot = /NFL|NCAAF|CFL/.test(lg), hoops = /NBA|WNBA|NCAAB/.test(lg);
  if (axis === "total"){
    if (c[5] != null && base[5] != null && c[5] !== base[5]){
      const d = +(c[5] - base[5]).toFixed(1), need = strict ? (lg === "NFL" ? 1 : foot ? 1.5 : hoops ? 2 : 0.5) : (hoops ? 1 : 0.5);
      if (Math.abs(d) >= need) return { mk: "total", dir: d > 0 ? "over" : "under", txt: `total ${base[5]} → ${c[5]}`, size: Math.abs(d) };
      return null;
    }
    const p0 = nv2(base[6], base[7]), p1 = nv2(c[6], c[7]); if (p0 == null || p1 == null || c[5] == null) return null;
    const dp = p1 - p0, need = strict ? 0.05 : 0.03;
    if (Math.abs(dp) >= need) return { mk: "total", dir: dp > 0 ? "over" : "under", txt: `${dp > 0 ? "over" : "under"} ${c[5]} shortened ${(Math.abs(dp) * 100).toFixed(1)}%`, size: Math.abs(dp) * 10 };
    return null;
  }
  if (!noSpread && c[2] != null && base[2] != null && c[2] !== base[2]){
    const d = +(c[2] - base[2]).toFixed(1), crosses = PIN_KEY.some(k => (Math.abs(base[2]) - k) * (Math.abs(c[2]) - k) < 0 || Math.abs(c[2]) === k && Math.abs(base[2]) !== k);
    const need = strict ? (foot ? (crosses ? 0.5 : 1) : 1.5) : 0.5;
    if (Math.abs(d) >= need) { const dir = d < 0 ? "home" : "away"; return { mk: "spread", dir, txt: `${g.home} ${fmtLine(base[2])} → ${fmtLine(c[2])}`, size: Math.abs(d) }; }
    return null;
  }
  {
    const p0 = nv2(base[0], base[1]), p1 = nv2(c[0], c[1]); if (p0 == null || p1 == null) return null;
    const dp = p1 - p0, need = strict ? (noSpread ? 0.04 : 1) : 0.03;
    if (Math.abs(dp) >= need) { const dir = dp > 0 ? "home" : "away"; return { mk: "ml", dir, txt: `${g[dir]} ML ${(dir === "home" ? base[0] : base[1]).toFixed(2)} → ${(dir === "home" ? c[0] : c[1]).toFixed(2)}`, size: Math.abs(dp) * 10 }; }
  }
  return null;
}
/* closing line value for a bet taken at line/price (American) */
function clvFor(g, mk, side, line, price){
  const close = pinClose(g); if (!close) return null;
  const q = bookQuote(close, mk, side), fp = fairProb(close, mk, side), d = dec(num(price));
  if (!q || !fp || !d) return null;
  const pts = mk === "ml" ? 0 : +lineEdge(mk, side, line, q.line).toFixed(1);
  const pct = pts === 0 ? d * fp - 1 : null;
  return { pts, pct, beat: pts > 0 || (pts === 0 && pct > 0), close: q, fair: 1 / fp };
}
const clvTxt = c => !c ? "" : c.pts ? `${c.pts > 0 ? "+" : ""}${c.pts} pts v close` : `${c.pct >= 0 ? "+" : ""}${(c.pct * 100).toFixed(1)}% v close`;


const CTXJS = "/* Fade Board context collector. Runs in the built-in browser (javascript_tool) with JOBS embedded.\n   JOBS = [{key, league, away, home, kickoff, date(ET YYYY-MM-DD), inj:bool, wx:bool}]\n   Returns {ctx:{<key>:{...}}, unmatched:[keys], errors:[...]} */\nwindow.__fbctx = async (JOBS) => {\nconst SP = { NFL:\"football/nfl\", NCAAF:\"football/college-football\", NBA:\"basketball/nba\", WNBA:\"basketball/wnba\", NCAAB:\"basketball/mens-college-basketball\", MLB:\"baseball/mlb\", NHL:\"hockey/nhl\" };\nconst QS = { NCAAF:\"&groups=80&limit=300\", NCAAB:\"&groups=50&limit=400\" };\nconst AL = { WAS:\"WSH\", GSW:\"GS\", NYK:\"NY\", SAS:\"SA\", NOP:\"NO\", UTA:\"UTAH\", LAK:\"LA\", NJD:\"NJ\", SJS:\"SJ\", TBL:\"TB\", JAC:\"JAX\", CWS:\"CHW\", OAK:\"ATH\", KCR:\"KC\", SDP:\"SD\", SFG:\"SF\", TBR:\"TB\", WSN:\"WSH\", CON:\"CONN\" };\nconst nrm = s => String(s || \"\").toLowerCase().replace(/[^a-z0-9]/g, \"\");\nconst ab = s => { s = String(s || \"\").toUpperCase(); return AL[s] || s; };\nconst errors = [], out = {}, matched = new Set();\nconst getJ = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + \" \" + u); return r.json(); };\nconst teamHit = (t, name, college) => {\n  if (!t) return false;\n  if (!college) return ab(t.abbreviation) === ab(name);\n  const n = nrm(name);\n  return [t.location, t.shortDisplayName, t.abbreviation, t.displayName, t.name].some(x => nrm(x) === n) || nrm(t.displayName).startsWith(n);\n};\nconst groups = {};\nfor (const j of JOBS){ if (!SP[j.league]) continue; (groups[j.league + \"|\" + j.date] = groups[j.league + \"|\" + j.date] || []).push(j); }\nconst evById = {};\nawait Promise.all(Object.entries(groups).map(async ([gk, jobs]) => {\n  const [lg, date] = gk.split(\"|\");\n  try {\n    const sb = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[lg]}/scoreboard?dates=${date.replace(/-/g, \"\")}${QS[lg] || \"\"}`);\n    const college = lg === \"NCAAF\" || lg === \"NCAAB\";\n    for (const j of jobs){\n      const ev = (sb.events || []).find(e => { const c = e.competitions?.[0]?.competitors || []; const h = c.find(x => x.homeAway === \"home\"), a = c.find(x => x.homeAway === \"away\"); return teamHit(a?.team, j.away, college) && teamHit(h?.team, j.home, college); });\n      if (!ev) continue;\n      matched.add(j.key);\n      const c = ev.competitions[0], v = c.venue || {};\n      const tv = [...new Set((c.broadcasts || []).flatMap(b => b.names || []).concat((c.geoBroadcasts || []).map(b => b.media?.shortName).filter(Boolean)))];\n      out[j.key] = { venue: v.fullName || null, city: v.address?.city || null, state: v.address?.state || null, country: v.address?.country || null, indoor: typeof v.indoor === \"boolean\" ? v.indoor : null, neutral: !!c.neutralSite, tv, weather: ev.weather ? { txt: ev.weather.displayValue || null, temp: ev.weather.temperature ?? null } : null, espnId: ev.id, kickoff: ev.date ? new Date(ev.date).toISOString() : null, t: new Date().toISOString() };\n      evById[j.key] = { id: ev.id, lg, j };\n    }\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\n/* injuries with season averages */\nconst statCache = {};\nconst athStats = async (lg, id) => {\n  const k = lg + \"|\" + id; if (statCache[k]) return statCache[k];\n  statCache[k] = (async () => {\n    try {\n      const o = await getJ(`https://site.web.api.espn.com/apis/common/v3/sports/${SP[lg]}/athletes/${id}/overview`);\n      const st = o.statistics; if (!st || !st.splits || !st.splits.length) return null;\n      const sp = st.splits.find(s => /regular/i.test(s.displayName || \"\")) || st.splits[0];\n      const val = name => { const i = (st.names || []).indexOf(name); return i < 0 ? null : parseFloat(sp.stats[i]); };\n      if (lg === \"NBA\" || lg === \"WNBA\" || lg === \"NCAAB\"){\n        const p = val(\"avgPoints\"), r = val(\"avgRebounds\"), a = val(\"avgAssists\");\n        return { gp: val(\"gamesPlayed\"), min: val(\"avgMinutes\"), pts: p, reb: r, ast: a, pra: p != null && r != null && a != null ? Math.round((p + r + a) * 10) / 10 : null };\n      }\n      return { gp: val(\"gamesPlayed\"), line: (st.labels || []).slice(0, 6).map((l, i) => `${l} ${sp.stats[i]}`).join(\", \") };\n    } catch (e){ return null; }\n  })();\n  return statCache[k];\n};\nawait Promise.all(Object.entries(evById).filter(([k, x]) => x.j.inj).map(async ([k, x]) => {\n  try {\n    const s = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[x.lg]}/summary?event=${x.id}`);\n    const college = x.lg === \"NCAAF\" || x.lg === \"NCAAB\";\n    const inj = { away: [], home: [], lt: {} };\n    for (const t of s.injuries || []){\n      const side = teamHit(t.team, x.j.away, college) ? \"away\" : teamHit(t.team, x.j.home, college) ? \"home\" : null; if (!side) continue;\n      for (const i of t.injuries || []){\n        const st = i.status || i.type?.description || \"\"; if (!/out|doubt|question|day-to-day|injured reserve/i.test(st)) continue;\n        const ret = i.details?.returnDate || null;\n        const longTerm = ret ? (new Date(ret) - Date.now()) > 30 * 864e5 : false;\n        if (longTerm){ inj.lt[side] = (inj.lt[side] || 0) + 1; continue; }   // long-term absences are already in the price\n        inj[side].push({ id: i.athlete?.id || null, n: i.athlete?.displayName || \"\", pos: i.athlete?.position?.abbreviation || \"\", st, why: i.details?.type || null });\n      }\n    }\n    for (const side of [\"away\", \"home\"]){\n      inj[side] = inj[side].slice(0, 10);\n      await Promise.all(inj[side].map(async p => { if (p.id && /out|doubt/i.test(p.st)) p.s = await athStats(x.lg, p.id); }));\n    }\n    out[k].inj = inj; out[k].injT = new Date().toISOString();\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\n/* weather for outdoor games */\nconst geo = {};\nawait Promise.all(Object.entries(evById).filter(([k, x]) => x.j.wx && out[k].indoor !== true && out[k].city).map(async ([k, x]) => {\n  try {\n    const c = out[k], q = c.city + \"|\" + (c.state || c.country || \"\");\n    if (!geo[q]) geo[q] = getJ(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.city)}&count=10`).then(g => (g.results || []).find(r => !c.state || r.admin1_code === c.state || (r.admin1 || \"\").toLowerCase().startsWith(String(c.state).toLowerCase())) || (g.results || [])[0] || null);\n    const loc = await geo[q]; if (!loc) return;\n    const ko = new Date(c.kickoff || x.j.kickoff); if (isNaN(ko)) return;\n    const f = await getJ(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=7&timezone=UTC`);\n    const hr = ko.toISOString().slice(0, 13) + \":00\", i = f.hourly.time.indexOf(hr); if (i < 0) return;\n    const pick = a => a.slice(i, i + 3).filter(v => v != null);\n    const mx = a => { const v = pick(a); return v.length ? Math.max(...v) : null; };\n    c.wx = { ws: mx(f.hourly.wind_speed_10m), g: mx(f.hourly.wind_gusts_10m), d: f.hourly.wind_direction_10m[i], p: mx(f.hourly.precipitation_probability), mm: pick(f.hourly.precipitation).reduce((a, b) => a + b, 0), temp: f.hourly.temperature_2m[i], t: new Date().toISOString() };\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\nreturn JSON.stringify(({ ctx: out, unmatched: JOBS.filter(j => SP[j.league] && !matched.has(j.key)).map(j => j.key), errors: errors.slice(0, 10) }));\n};\n\"collector ready\"\n";
const ODDSJS = "\nwindow.__fbodds = async (league, full) => {\n  const T = { NFL: [31], NCAAF: [27653], CFL: [790], NBA: [132, 2382], WNBA: [486], NCAAB: [648], MLB: [109], NHL: [234, 957] };\n  const SPORT = { NFL: 14, NCAAF: 14, CFL: 14, NBA: 11, WNBA: 11, NCAAB: 11, MLB: 13, NHL: 15 };\n  const BK = full ? [\"pinnacle\", \"circasports\", \"tab.com.au\", \"pointsbet.com.au\", \"neds.com.au\", \"unibet.com.au\"] : [\"pinnacle\"];\n  const sid = SPORT[league]; if (!sid) return JSON.stringify({ error: \"unknown league \" + league });\n  let mm = null;\n  try { const c = JSON.parse(localStorage.getItem(\"fb-mk-\" + sid) || \"null\"); if (c && c.m) mm = c.m; } catch (e){}\n  if (!mm) return JSON.stringify({ error: `no market map cached for sport ${sid}; ask Claude in the chat to seed it` });\n  if (!document.getElementById(\"queryParams.tournamentId\")) return JSON.stringify({ error: \"not on the Fixtures Odds Main playground page\" });\n  if (!window.__fbWatch){\n    const of = window.fetch;\n    window.fetch = async function(input, init){\n      const r = await of.apply(this, arguments);\n      try { const url = typeof input === \"string\" ? input : input.url; if (/odds-api1\\.p\\.rapidapi\\.com\\/fixtures\\/odds\\/main/.test(url)){ const c = r.clone(); window.__fbRem = r.headers.get(\"x-ratelimit-requests-remaining\") || window.__fbRem; c.text().then(t => { window.__fbLast = { url, status: r.status, t }; }); } } catch (e){}\n      return r;\n    };\n    window.__fbWatch = true;\n  }\n  const setv = (id, v) => { const el = document.getElementById(id); if (!el) return false; const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, \"value\").set; s.call(el, v); el.dispatchEvent(new Event(\"input\", { bubbles: true })); el.dispatchEvent(new Event(\"change\", { bubbles: true })); return true; };\n  const run = async tid => {\n    setv(\"queryParams.fixtureIds\", \"\"); setv(\"queryParams.since\", \"0\"); setv(\"queryParams.tournamentId\", String(tid)); setv(\"queryParams.bookmakers\", BK.join(\",\"));\n    await new Promise(r => setTimeout(r, 300));\n    window.__fbLast = null;\n    const btn = document.querySelector('button[type=\"submit\"]'); if (!btn) throw new Error(\"Run button not found\");\n    btn.click();\n    for (let i = 0; i < 60; i++){ await new Promise(r => setTimeout(r, 500)); const l = window.__fbLast; if (l && l.url.includes(\"tournamentId=\" + tid)){ if (l.status !== 200) throw new Error(\"HTTP \" + l.status); return JSON.parse(l.t); } }\n    throw new Error(\"no response for tournament \" + tid);\n  };\n  const now = Date.now() / 1000, horizon = now + (full ? 168 : 36) * 3600, out = [];\n  for (const tid of T[league]){\n    let list;\n    try { list = await run(tid); } catch (e){ out.push({ error: String(e.message || e) }); continue; }\n    for (const f of list || []){\n      if (!f.startTime || f.startTime < now - 600 || f.startTime > horizon || (f.status && f.status.live)) continue;\n      const p = f.participants || {}, row = [f.fixtureId, f.startTime, p.participant1Abbr || \"\", p.participant1ShortName || p.participant1Name || \"\", p.participant2Abbr || \"\", p.participant2ShortName || p.participant2Name || \"\"];\n      const books = {};\n      for (const bk of BK){\n        const os = (f.odds || {})[bk]; if (!os) continue;\n        const by = {}; let last = 0;\n        for (const o of Object.values(os)){\n          const m = mm[o.outcomeId]; if (!m || !o.active || !o.price) continue;\n          const k = m[0] + \"|\" + m[3]; (by[k] = by[k] || { t: m[0], h: m[1], p: [] }).p[m[2]] = o.price;\n          last = Math.max(last, o.bookmakerChangedAt || o.changedAt || 0);\n        }\n        const flat = league === \"MLB\" || league === \"NHL\";   // run and puck lines are always 1.5, so their prices sit far apart\n        const fair = x => x.t === \"m\" || (flat && x.t === \"s\") || (x.p[0] >= 1.62 && x.p[0] <= 2.35 && x.p[1] >= 1.62 && x.p[1] <= 2.35);   // drop alternative lines\n        const pick = t => Object.values(by).filter(x => x.t === t && x.p[0] && x.p[1] && fair(x)).sort((a, b) => Math.abs(a.p[0] - a.p[1]) - Math.abs(b.p[0] - b.p[1]))[0] || null;\n        const ml = pick(\"m\"), sp = pick(\"s\"), to = pick(\"t\");\n        if (!ml && !sp && !to) continue;\n        books[bk] = [ml ? ml.p[0] : null, ml ? ml.p[1] : null, sp ? sp.h : null, sp ? sp.p[0] : null, sp ? sp.p[1] : null, to ? to.h : null, to ? to.p[0] : null, to ? to.p[1] : null, Math.round(last / 1000) || null];\n      }\n      if (!Object.keys(books).length) continue;\n      row.push(books); out.push(row);\n    }\n  }\n  return JSON.stringify({ league, t: Math.round(now), rem: window.__fbRem || null, f: out });\n};\n\"odds collector ready\"\n";
const COLLECTJS = "/* Fade Board collector: runs inside Jake's logged-in browser tabs and returns compact JSON, so the hourly run never reads whole pages.\n   window.__fb.vsin(plan) on a data.vsin.com tab: VSiN splits, VSiN Pro Picks, ESPN scoreboards, the Worker's odds, match context.\n   window.__fb.sl(plan) on a sportsline.com tab: SportsLine odds, public splits, model and expert picks.\n   Both return \"FBC1|<tag>|<nonce>|\" + JSON. Read-only: nothing here writes anywhere. */\n(function(){\nconst T = e => (e ? e.textContent : \"\").replace(/\\s+/g, \" \").trim();\nconst num = s => { s = String(s == null ? \"\" : s).replace(/,/g, \"\").replace(/%/g, \"\").trim(); if (/^(pk|ev|even)$/i.test(s)) return 0; const v = parseFloat(s); return isNaN(v) ? null : v; };\nconst sleep = ms => new Promise(r => setTimeout(r, ms));\nconst h32 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 5); };\nconst pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; try { out[k] = await fn(items[k]); } catch (e){ out[k] = { err: String(e && e.message || e) }; } } })); return out; };\nconst PARTS = {};   // big results go back in 40k pieces: window.__fb.part(tag, k)\nconst pack = (tag, nonce, o) => { const s = JSON.stringify(o), n = Math.max(1, Math.ceil(s.length / 40000)); PARTS[tag] = Array.from({ length: n }, (_, k) => `FBC1|${tag}|${nonce}|${k + 1}/${n}|` + s.slice(k * 40000, (k + 1) * 40000)); return PARTS[tag][0] + (n > 1 ? `\\n(${n} parts: run window.__fb.part(\"${tag}\", 2) to ${n})` : \"\"); };\nconst part = (tag, k) => (PARTS[tag] || [])[k - 1] || \"no such part\";\n\n/* ---- VSiN betting splits: one page per sport and book ---- */\nasync function splits(code, book, maxDate){\n  const html = await fetch(`/betting-splits/?source=${book}&sport=${code}`, { credentials: \"include\" }).then(r => r.text());\n  const doc = new DOMParser().parseFromString(html, \"text/html\"), out = [];\n  const rows = [...doc.querySelectorAll(\"table.sp-table tr.sp-row\")];\n  for (let i = 0; i + 1 < rows.length; i += 2){\n    const a = rows[i], h = rows[i + 1];\n    const gc = (a.querySelector(\"[data-gamecode]\") || h.querySelector(\"[data-gamecode]\") || {}).dataset?.gamecode || \"\";\n    const gh = (h.querySelector(\"[data-gamecode]\") || {}).dataset?.gamecode || gc;\n    if (gc && gh && gc !== gh){ i--; continue; }   // rows out of step: realign\n    if (/sp-game-live/.test(a.className + \" \" + h.className) || (maxDate && gc.slice(0, 8) > maxDate)) continue;   // started, or further out than this run looks\n    const cells = r => [...r.querySelectorAll(\"td\")].slice(2).map(td => num(T(td)));\n    const link = r => r.querySelector(\"a.sp-team-link\"), slug = r => ((link(r) || {}).getAttribute?.(\"href\") || \"\").split(\"/\").filter(Boolean).pop() || \"\";\n    const ca = cells(a), ch = cells(h), live = /sp-game-live/.test(a.className + \" \" + h.className) ? 1 : 0;\n    if (ca[0] == null && ch[0] == null && ca[3] == null) continue;   // no lines posted yet (small-college long tail)\n    // [gamecode, live, awayName, homeName, awaySlug, homeSlug, awaySpread, homeSpread, spreadHandleAway, spreadBetsAway, total, overHandle, overBets, mlAway, mlHome, mlHandleAway, mlBetsAway]\n    out.push([gc, live, T(link(a)), T(link(h)), slug(a), slug(h), ca[0], ch[0], ca[1], ca[2], ca[3] ?? ch[3], ca[4], ca[5], ca[6], ch[6], ca[7], ca[8]]);\n  }\n  return out;\n}\n/* ---- VSiN Pro Picks for one ET date (game picks only; skips ids already stored) ---- */\nfunction vsinParse(s){\n  s = String(s || \"\").replace(/\\s*\\|\\s*[\\d.]+% Edge.*$/, \"\").trim();\n  if (/^(Team Total|1st|First|F5|1H|2H|1Q|1P|REG|Parlay|\\d-Leg)/i.test(s) || /1st Half|First Half|1st Period|First 5|1st 5|Quarter|LIVE|SGP|Anytime/i.test(s)) return null;\n  const U = String.raw`(?:\\s*\\[(?!\\s*[\\d.]+\\s*units?\\s*\\]).*?\\])*(?:\\s*\\[\\s*([\\d.]+)\\s*units?\\s*\\])?\\s*$`, P = String.raw`\\(([+-]\\d+|EV)\\)`;\n  const bad = x => / - /.test(x);\n  let m = s.match(new RegExp(String.raw`^(.+?)\\s+(vs|at)\\s+(.+?)\\s*-\\s*(OVER|UNDER)\\s*\\(([\\d.]+)\\)\\s*` + P + U, \"i\"));\n  if (m) return bad(m[1]) || bad(m[3]) ? null : { market: \"total\", side: m[4].toLowerCase() };\n  m = s.match(new RegExp(String.raw`^(?:Money Line|Moneyline)\\s*-\\s*(.+?)\\s*` + P + String.raw`\\s+(vs|at)\\s+(.+?)` + U, \"i\"));\n  if (m) return bad(m[1]) || bad(m[4]) ? null : { market: \"ml\", side: m[3].toLowerCase() === \"at\" ? \"away\" : \"home\" };\n  m = s.match(new RegExp(String.raw`^(?:(?:Run Line|Puck Line|Spread)\\s*-\\s*)?(.+?)\\s*\\(([+-]?[\\d.]+|PK|EV)\\)\\s*` + P + String.raw`\\s+(vs|at)\\s+(.+?)` + U, \"i\"));\n  if (m) return bad(m[1]) || bad(m[5]) ? null : { market: \"spread\", side: m[4].toLowerCase() === \"at\" ? \"away\" : \"home\" };\n  return null;\n}\nasync function picks(date, done){\n  const html = await fetch(\"/propicks/eventdate/?eventdate=\" + date, { credentials: \"include\" }).then(r => r.text());\n  const doc = new DOMParser().parseFromString(html, \"text/html\"), out = [], skip = new Set(Array.isArray(done) ? done : String(done || \"\").split(\" \").filter(Boolean));\n  const slug = s => String(s || \"\").toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/^-|-$/g, \"\");\n  for (const a of doc.querySelectorAll('a[href*=\"/propicks/game/?gameid=\"]')){\n    const row = a.closest(\"tr\"), head = row && row.previousElementSibling; if (!head) continue;\n    const sport = T(head.querySelector('a[href*=\"sportid=\"]')); if (!/^(NFL|CFB|CFL|NBA|WNBA|MLB|NHL|CBB|NCAAB)$/.test(sport)) continue;\n    const pick = T(a), p = vsinParse(pick); if (!p) continue;\n    const ex = head.querySelector('a[href*=\"vsinexpertid\"]'), spans = head.querySelectorAll(\"span.fw-bold\"), divs = row.querySelectorAll(\"td:first-child div\");\n    const card = a.closest(\".card-body\"), tm = card && card.querySelector(\"span.font-11\"), gid = (a.getAttribute(\"href\").match(/gameid=([^&]+)/) || [])[1];\n    const res = T(divs[1]);\n    if (skip.has(h32(`vsin-${slug(T(ex))}-${String(gid).toLowerCase()}-${p.market}-${p.side}`)) && !/WIN|LOSS|PUSH/i.test(res)) continue;   // stored and still open: nothing new\n    if (skip.has(h32(`vsin-${slug(T(ex))}-${String(gid).toLowerCase()}-${p.market}-${p.side}|done`))) continue;   // stored and settled\n    out.push([date, sport, gid, T(ex), T(spans[0]), T(spans[1]), T(divs[0]), res, T(tm), pick]);\n  }\n  return out;\n}\n/* ---- ESPN scoreboards (public, CORS-open) ---- */\nconst ESPN = { NFL: \"football/nfl\", NCAAF: \"football/college-football\", NBA: \"basketball/nba\", WNBA: \"basketball/wnba\", NCAAB: \"basketball/mens-college-basketball\", MLB: \"baseball/mlb\", NHL: \"hockey/nhl\" };\nconst ESPNQ = { NCAAF: \"&groups=80&limit=300\", NCAAB: \"&groups=50&limit=400\" };\nasync function espn(lg, d){\n  const j = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${ESPN[lg]}/scoreboard?dates=${d}${ESPNQ[lg] || \"\"}`).then(r => r.json());\n  return (j.events || []).map(e => { const c = e.competitions?.[0] || {}, cs = c.competitors || [], A = cs.find(x => x.homeAway === \"away\") || {}, H = cs.find(x => x.homeAway === \"home\") || {}, st = c.status?.type || e.status?.type || {};\n    const tm = x => [x.team?.abbreviation || \"\", x.team?.location || \"\", x.team?.displayName || \"\", x.team?.shortDisplayName || \"\"];\n    return [e.id, st.state || \"\", st.completed ? 1 : 0, e.date || \"\", ...tm(A), ...tm(H), num(A.score), num(H.score)]; });\n}\n/* ---- the ChippyTips Worker's stored OddsPapi results ---- */\nasync function odds(leagues, key, token){\n  const r = await fetch(\"https://nnlhyjxsgtyuygevhwta.supabase.co/rest/v1/rpc/get_odds_raw\", { method: \"POST\", headers: { apikey: key, \"Content-Type\": \"application/json\" }, body: JSON.stringify({ p_token: token, p_leagues: leagues }) });\n  return { status: r.status, body: r.ok ? await r.json() : (await r.text()).slice(0, 200) };\n}\nasync function vsin(plan){\n  const out = { v: 1, t: new Date().toISOString(), splits: {}, picks: {}, espn: {}, odds: null, ctx: null, err: [] };\n  const dk = (plan.splits || []).map(([c]) => c), r0 = await pool(dk, 4, c => splits(c, \"DK\", plan.maxDate));\n  dk.forEach((c, i) => { if (r0[i]?.err) out.err.push(`splits ${c} DK: ${r0[i].err}`); else if (r0[i].length) out.splits[c + \"|DK\"] = r0[i]; });\n  const ci = (plan.splits || []).filter(([c, b]) => b.includes(\"CIRCA\") && out.splits[c + \"|DK\"]).map(([c]) => c), r1 = await pool(ci, 4, c => splits(c, \"CIRCA\", plan.maxDate));\n  ci.forEach((c, i) => { if (r1[i]?.err) out.err.push(`splits ${c} CIRCA: ${r1[i].err}`); else if (r1[i].length) out.splits[c + \"|CIRCA\"] = r1[i]; });\n  const pd = plan.picks || []; const r2 = await pool(pd, 3, ([d, done]) => picks(d, done));\n  pd.forEach(([d], i) => { if (r2[i]?.err) out.err.push(`picks ${d}: ${r2[i].err}`); else out.picks[d] = r2[i]; });\n  return pack(\"vsin\", plan.nonce, out);\n}\n/* ---- on Jake's own site (chippytips.com): ESPN scoreboards, the Worker's odds and match context. Kept off the VSiN tab,\n   which only ever reads VSiN's own pages ---- */\nasync function site(plan){\n  const out = { v: 1, t: new Date().toISOString(), espn: {}, odds: null, ctx: null, err: [] };\n  const ed = plan.espn || []; const r3 = await pool(ed, 4, ([lg, d]) => espn(lg, d));\n  ed.forEach(([lg, d], i) => { if (r3[i]?.err) out.err.push(`espn ${lg} ${d}: ${r3[i].err}`); else out.espn[lg + \"|\" + d] = r3[i]; });\n  if (plan.odds && plan.odds.leagues?.length){ try { out.odds = await odds(plan.odds.leagues, plan.odds.key, plan.odds.token);\n    const now = Date.now() / 1000, hz = (plan.odds.hz || 36) * 3600;   // keep only fixtures inside this run's window that Pinnacle or Circa price (drops the small-college long tail)\n    if (out.odds && out.odds.body && typeof out.odds.body === \"object\") for (const b of Object.values(out.odds.body)) if (b && Array.isArray(b.f)) b.f = b.f.filter(r => Array.isArray(r) && r[1] > now - 600 && r[1] < now + hz && r[6] && (r[6].pinnacle || r[6].circasports));\n  } catch (e){ out.err.push(\"odds: \" + e.message); } }\n  if (plan.ctx && plan.ctx.length && window.__fbctx){ try { let r = await window.__fbctx(plan.ctx); out.ctx = typeof r === \"string\" ? JSON.parse(r) : r; } catch (e){ out.err.push(\"ctx: \" + e.message); } }\n  return pack(\"site\", plan.nonce, out);\n}\n\n/* ---- SportsLine game pages (structured data inside the page's Next.js payload) ---- */\nfunction slPayload(html){\n  let all = \"\"; for (const m of html.matchAll(/self\\.__next_f\\.push\\(\\[1,\"((?:[^\"\\\\]|\\\\.)*)\"\\]\\)/g)){ try { all += JSON.parse('\"' + m[1] + '\"'); } catch (e){} }\n  return all;\n}\nfunction objAt(all, i){ let d = 0, s = false, e = false; for (let j = i; j < all.length; j++){ const c = all[j]; if (s){ if (e) e = false; else if (c === \"\\\\\") e = true; else if (c === '\"') s = false; continue; } if (c === '\"') s = true; else if (c === \"{\" || c === \"[\") d++; else if (c === \"}\" || c === \"]\"){ d--; if (!d){ try { return JSON.parse(all.slice(i, j + 1)); } catch (x){ return null; } } } } return null; }\nconst after = (all, key, from = 0) => { const i = all.indexOf(key, from); if (i < 0) return null; const k = i + key.length; return all[k] === \"{\" || all[k] === \"[\" ? objAt(all, k) : null; };\nconst before = (all, marker, open) => { const i = all.indexOf(marker); if (i < 0) return null; const k = all.lastIndexOf(open, i); return k < 0 ? null : objAt(all, k + open.length - 1); };\nconst sents = (s, n = 2, max = 240) => { s = String(s || \"\").replace(/\\s+/g, \" \").trim().replace(/(\\d)\\.(\\d)/g, \"$1\\u00a7$2\"); const p = s.match(/[^.!?]+[.!?]+(\\s|$)/g) || [s]; let o = p.slice(0, n).join(\"\").trim().replace(/\\u00a7/g, \".\"); return o.length > max ? o.slice(0, max - 1).replace(/\\s\\S*$/, \"\") + \"\u2026\" : o; };\nasync function slGame(path, abbr, known, recheck){\n  const html = await fetch(`/${path}/game-forecast/${abbr}/`, { credentials: \"include\" }).then(r => r.text());\n  const all = slPayload(html); if (!all) return { abbr, err: \"no payload\" };\n  const g = after(all, '\"providerProps\":') || {};\n  if (g.competitionStatus && !/SCHEDULED|PRE/i.test(g.competitionStatus) && !recheck) return { abbr, st: g.competitionStatus, skip: 1 };   // already under way: nothing to collect\n  const odds = before(all, '\"__typename\":\"GameOdds\"', '\"odds\":{') || before(all, '\"source\":\"MARKET\"', '\"odds\":{');\n  const bs = after(all, '\"bettingSplits\":');\n  const pr = after(all, '\"projection\":');\n  const ov = (o, k) => o && o[k] ? [num(o[k].openingValue), num(o[k].value), num(o[k].openingOutcomeOdds), num(o[k].outcomeOdds)] : null;\n  const sp = o => { const r = {}; for (const x of o?.outcomes || []) r[String(x.outcomeType).toLowerCase()] = [x.betPercentage, x.moneyPercentage]; return r; };\n  const impl = s => { const m = String(s || \"\").match(/implied probability of ([\\d.]+)%/); return m ? +m[1] : null; };\n  const mk = (o, k) => o && o[k] ? [o[k].recommendedBet || null, o[k].recommendedBetGrade || null, o[k].recommendedBetProb != null ? Math.round(o[k].recommendedBetProb * 1000) / 10 : null, impl(o[k].recommendedBetGradeNarrative), num(o[k].recommendedBetSpread ?? o[k].currentTotal ?? null)] : null;\n  const seen = new Set(), pk = []; let i = -1;\n  while ((i = all.indexOf('\"node\":{\"__typename\":\"SportsLineExpertPick\"', i + 1)) >= 0){\n    const n = objAt(all, i + 7); if (!n || seen.has(n.id) || !n.expert || !n.selection) continue; seen.add(n.id);\n    const s = n.selection, who = `${n.expert.firstName || \"\"} ${n.expert.lastName || \"\"}`.trim();\n    const key = h32(who + \"|\" + n.id);\n    if (known && known.has && known.has(key) && !/WIN|LOSS|PUSH/i.test(s.resultStatus || \"\")) continue;\n    const subj = s.subject?.id ? String(s.subject.id) : null, ctx = n.context || {};\n    const side = subj && ctx.homeTeam && String(ctx.homeTeam.id) === subj ? \"home\" : subj && ctx.awayTeam && String(ctx.awayTeam.id) === subj ? \"away\" : null;\n    // [id, expert, record, market, marketDisplay, label, odds, book, unit, side, result, note, typename]\n    pk.push([n.id, who, (n.expertStreaks || []).map(x => x.label).slice(0, 1).join(\"\"), s.market?.name || \"\", s.marketDisplayName || \"\", s.label || \"\", num(s.odds), s.sportsbookDisplayName || \"\", num(s.unit ?? n.unit), side, s.resultStatus || \"\", sents(n.analysis), String(s.__typename || \"\").replace(\"SportsLineExpertPickSelection\", \"\")]);\n  }\n  const tm = t => t ? [t.abbr || t.abbrev || \"\", t.location || \"\", t.mediumName || \"\", t.nickName || t.nickname || \"\"] : null;\n  return { abbr, ko: g.scheduledTime || null, st: g.competitionStatus || null, a: tm(g.awayTeam), h: tm(g.homeTeam), sc: g.competitionStatus === \"FINAL\" || /FINAL|COMPLETE/i.test(g.competitionStatus || \"\") ? [g.awayTeamScoreTotal, g.homeTeamScoreTotal] : null,\n    o: odds ? { sh: ov(odds.spread, \"home\"), sa: ov(odds.spread, \"away\"), mh: ov(odds.moneyLine, \"home\"), ma: ov(odds.moneyLine, \"away\"), ov: ov(odds.total, \"over\"), un: ov(odds.total, \"under\") } : null,\n    s: bs ? { sp: sp(bs.spread), ml: sp(bs.moneyLine), to: sp(bs.total) } : null,\n    m: pr ? { pa: pr.awayScore ?? null, ph: pr.homeScore ?? null, sp: mk(pr, \"spread\"), ml: mk(pr, \"moneyLine\"), to: mk(pr, \"total\") } : null,\n    p: pk };\n}\nasync function slIndex(path){\n  const html = await fetch(`/${path}/picks/`, { credentials: \"include\" }).then(r => r.text());\n  return [...new Set([...html.matchAll(/\\/game-forecast\\/([A-Z0-9]+_\\d{8}_[A-Z0-9]+@[A-Z0-9]+)\\//g)].map(m => m[1]))];\n}\nasync function sl(plan){\n  const out = { v: 1, t: new Date().toISOString(), games: [], err: [], idx: {} };\n  const dates = new Set(plan.dates || []), skip = new Set(plan.skip || []), want = [];\n  const idx = await pool(plan.paths || [], 3, p => slIndex(p));\n  (plan.paths || []).forEach((p, i) => { if (idx[i]?.err){ out.err.push(`index ${p}: ${idx[i].err}`); return; } const list = (idx[i] || []).filter(a => dates.has(a.split(\"_\")[1]) && !skip.has(a)); out.idx[p] = (idx[i] || []).length; for (const a of list) want.push([p, a]); });\n  for (const [p, a] of plan.recheck || []) if (!want.some(w => w[1] === a)) want.unshift([p, a]);\n  want.sort((x, y) => x[1].split(\"_\")[1].localeCompare(y[1].split(\"_\")[1]));\n  const per = { \"college-football\": 25, \"college-basketball\": 20 }, used = {}, rc = new Set((plan.recheck || []).map(x => x[1]));\n  const go = want.filter(([p, a]) => rc.has(a) || (used[p] = (used[p] || 0) + 1) <= (per[p] || 15)).slice(0, plan.cap || 60);\n  if (want.length > go.length) out.err.push(`capped ${want.length} -> ${go.length} pages`);\n  const known = new Set(String(plan.known || \"\").split(\" \").filter(Boolean)), r = await pool(go, 3, ([p, a]) => slGame(p, a, known, rc.has(a)));\n  r.forEach((g, i) => { if (g && g.skip) return; if (g && !g.err) out.games.push({ ...g, path: go[i][0] }); else out.err.push(`${go[i][1]}: ${g?.err}`); });\n  return pack(\"sl\", plan.nonce, out);\n}\nwindow.__fb = { vsin, sl, site, part, splits, picks, espn, slGame, slIndex, h32, ver: 1 };\nreturn \"collector ready\";\n})();\n\n/* Fade Board context collector. Runs in the built-in browser (javascript_tool) with JOBS embedded.\n   JOBS = [{key, league, away, home, kickoff, date(ET YYYY-MM-DD), inj:bool, wx:bool}]\n   Returns {ctx:{<key>:{...}}, unmatched:[keys], errors:[...]} */\nwindow.__fbctx = async (JOBS) => {\nconst SP = { NFL:\"football/nfl\", NCAAF:\"football/college-football\", NBA:\"basketball/nba\", WNBA:\"basketball/wnba\", NCAAB:\"basketball/mens-college-basketball\", MLB:\"baseball/mlb\", NHL:\"hockey/nhl\" };\nconst QS = { NCAAF:\"&groups=80&limit=300\", NCAAB:\"&groups=50&limit=400\" };\nconst AL = { WAS:\"WSH\", GSW:\"GS\", NYK:\"NY\", SAS:\"SA\", NOP:\"NO\", UTA:\"UTAH\", LAK:\"LA\", NJD:\"NJ\", SJS:\"SJ\", TBL:\"TB\", JAC:\"JAX\", CWS:\"CHW\", OAK:\"ATH\", KCR:\"KC\", SDP:\"SD\", SFG:\"SF\", TBR:\"TB\", WSN:\"WSH\", CON:\"CONN\" };\nconst nrm = s => String(s || \"\").toLowerCase().replace(/[^a-z0-9]/g, \"\");\nconst ab = s => { s = String(s || \"\").toUpperCase(); return AL[s] || s; };\nconst errors = [], out = {}, matched = new Set();\nconst getJ = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + \" \" + u); return r.json(); };\nconst teamHit = (t, name, college) => {\n  if (!t) return false;\n  if (!college) return ab(t.abbreviation) === ab(name);\n  const n = nrm(name);\n  return [t.location, t.shortDisplayName, t.abbreviation, t.displayName, t.name].some(x => nrm(x) === n) || nrm(t.displayName).startsWith(n);\n};\nconst groups = {};\nfor (const j of JOBS){ if (!SP[j.league]) continue; (groups[j.league + \"|\" + j.date] = groups[j.league + \"|\" + j.date] || []).push(j); }\nconst evById = {};\nawait Promise.all(Object.entries(groups).map(async ([gk, jobs]) => {\n  const [lg, date] = gk.split(\"|\");\n  try {\n    const sb = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[lg]}/scoreboard?dates=${date.replace(/-/g, \"\")}${QS[lg] || \"\"}`);\n    const college = lg === \"NCAAF\" || lg === \"NCAAB\";\n    for (const j of jobs){\n      const ev = (sb.events || []).find(e => { const c = e.competitions?.[0]?.competitors || []; const h = c.find(x => x.homeAway === \"home\"), a = c.find(x => x.homeAway === \"away\"); return teamHit(a?.team, j.away, college) && teamHit(h?.team, j.home, college); });\n      if (!ev) continue;\n      matched.add(j.key);\n      const c = ev.competitions[0], v = c.venue || {};\n      const tv = [...new Set((c.broadcasts || []).flatMap(b => b.names || []).concat((c.geoBroadcasts || []).map(b => b.media?.shortName).filter(Boolean)))];\n      out[j.key] = { venue: v.fullName || null, city: v.address?.city || null, state: v.address?.state || null, country: v.address?.country || null, indoor: typeof v.indoor === \"boolean\" ? v.indoor : null, neutral: !!c.neutralSite, tv, weather: ev.weather ? { txt: ev.weather.displayValue || null, temp: ev.weather.temperature ?? null } : null, espnId: ev.id, kickoff: ev.date ? new Date(ev.date).toISOString() : null, t: new Date().toISOString() };\n      evById[j.key] = { id: ev.id, lg, j };\n    }\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\n/* injuries with season averages */\nconst statCache = {};\nconst athStats = async (lg, id) => {\n  const k = lg + \"|\" + id; if (statCache[k]) return statCache[k];\n  statCache[k] = (async () => {\n    try {\n      const o = await getJ(`https://site.web.api.espn.com/apis/common/v3/sports/${SP[lg]}/athletes/${id}/overview`);\n      const st = o.statistics; if (!st || !st.splits || !st.splits.length) return null;\n      const sp = st.splits.find(s => /regular/i.test(s.displayName || \"\")) || st.splits[0];\n      const val = name => { const i = (st.names || []).indexOf(name); return i < 0 ? null : parseFloat(sp.stats[i]); };\n      if (lg === \"NBA\" || lg === \"WNBA\" || lg === \"NCAAB\"){\n        const p = val(\"avgPoints\"), r = val(\"avgRebounds\"), a = val(\"avgAssists\");\n        return { gp: val(\"gamesPlayed\"), min: val(\"avgMinutes\"), pts: p, reb: r, ast: a, pra: p != null && r != null && a != null ? Math.round((p + r + a) * 10) / 10 : null };\n      }\n      return { gp: val(\"gamesPlayed\"), line: (st.labels || []).slice(0, 6).map((l, i) => `${l} ${sp.stats[i]}`).join(\", \") };\n    } catch (e){ return null; }\n  })();\n  return statCache[k];\n};\nawait Promise.all(Object.entries(evById).filter(([k, x]) => x.j.inj).map(async ([k, x]) => {\n  try {\n    const s = await getJ(`https://site.api.espn.com/apis/site/v2/sports/${SP[x.lg]}/summary?event=${x.id}`);\n    const college = x.lg === \"NCAAF\" || x.lg === \"NCAAB\";\n    const inj = { away: [], home: [], lt: {} };\n    for (const t of s.injuries || []){\n      const side = teamHit(t.team, x.j.away, college) ? \"away\" : teamHit(t.team, x.j.home, college) ? \"home\" : null; if (!side) continue;\n      for (const i of t.injuries || []){\n        const st = i.status || i.type?.description || \"\"; if (!/out|doubt|question|day-to-day|injured reserve/i.test(st)) continue;\n        const ret = i.details?.returnDate || null;\n        const longTerm = ret ? (new Date(ret) - Date.now()) > 30 * 864e5 : false;\n        if (longTerm){ inj.lt[side] = (inj.lt[side] || 0) + 1; continue; }   // long-term absences are already in the price\n        inj[side].push({ id: i.athlete?.id || null, n: i.athlete?.displayName || \"\", pos: i.athlete?.position?.abbreviation || \"\", st, why: i.details?.type || null });\n      }\n    }\n    for (const side of [\"away\", \"home\"]){\n      inj[side] = inj[side].slice(0, 10);\n      await Promise.all(inj[side].map(async p => { if (p.id && /out|doubt/i.test(p.st)) p.s = await athStats(x.lg, p.id); }));\n    }\n    out[k].inj = inj; out[k].injT = new Date().toISOString();\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\n/* weather for outdoor games */\nconst geo = {};\nawait Promise.all(Object.entries(evById).filter(([k, x]) => x.j.wx && out[k].indoor !== true && out[k].city).map(async ([k, x]) => {\n  try {\n    const c = out[k], q = c.city + \"|\" + (c.state || c.country || \"\");\n    if (!geo[q]) geo[q] = getJ(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c.city)}&count=10`).then(g => (g.results || []).find(r => !c.state || r.admin1_code === c.state || (r.admin1 || \"\").toLowerCase().startsWith(String(c.state).toLowerCase())) || (g.results || [])[0] || null);\n    const loc = await geo[q]; if (!loc) return;\n    const ko = new Date(c.kickoff || x.j.kickoff); if (isNaN(ko)) return;\n    const f = await getJ(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=7&timezone=UTC`);\n    const hr = ko.toISOString().slice(0, 13) + \":00\", i = f.hourly.time.indexOf(hr); if (i < 0) return;\n    const pick = a => a.slice(i, i + 3).filter(v => v != null);\n    const mx = a => { const v = pick(a); return v.length ? Math.max(...v) : null; };\n    c.wx = { ws: mx(f.hourly.wind_speed_10m), g: mx(f.hourly.wind_gusts_10m), d: f.hourly.wind_direction_10m[i], p: mx(f.hourly.precipitation_probability), mm: pick(f.hourly.precipitation).reduce((a, b) => a + b, 0), temp: f.hourly.temperature_2m[i], t: new Date().toISOString() };\n  } catch (e){ errors.push(String(e.message || e)); }\n}));\nreturn JSON.stringify(({ ctx: out, unmatched: JOBS.filter(j => SP[j.league] && !matched.has(j.key)).map(j => j.key), errors: errors.slice(0, 10) }));\n};\n\"collector ready\"\n";

const spreadName = lg => lg === "MLB" ? "Run line" : lg === "NHL" ? "Puck line" : "Spread";
/* ===== Chippy Tips posting engine =====
   usage: node engine.js <dataDir> <mode: plays|daily|weekly> [nowISO]
   dataDir holds ArtifactData out_dir dumps: days/*.json, tips/*.json, posts/*.json, config/rules.json
   prints JSON {messages:[{key,content}], markers:{<etDate>:{<key>:marker}}, vlog:{<etDate>:{date, items:{<gameId|axis>:{m<epochMin>:entry}}}}} */
const fs = require("fs"), path = require("path");
const [,, DIR, MODE = "plays"] = process.argv;
const NOWARG = process.argv.slice(4).find(a => /^\d{4}-\d\d-\d\dT/.test(a)) || null;
const NOW = NOWARG ? new Date(NOWARG) : new Date();
const TZ = "Australia/Brisbane";
const readDir = sub => { const d = path.join(DIR, sub); if (!fs.existsSync(d)) return {}; const out = {};
  for (const f of fs.readdirSync(d)) if (f.endsWith(".json")){ const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); out[j.id || f.replace(/\.json$/, "")] = j.data || j; } return out; };
const days = readDir("days"), tipDocs = readDir("tips"), postDocs = readDir("posts"), cfg = readDir("config");
const S = Object.assign({ book:"dk", minPct:70, minGap:0, rlm:false, tiered:true, sprinkle:true, circaTie:true, circaMin:85 }, cfg.rules || {});
const games = []; for (const [dayId, d] of Object.entries(days)) for (const [id, g] of Object.entries(d.games || {})) if (g) games.push({ ...g, id, dayId, league: g.league || d.league, date: d.date });
const byId = Object.fromEntries(games.map(g => [g.id, g]));
learnTeamTz(games);
const posted = {}; for (const [date, d] of Object.entries(postDocs)) for (const [k, m] of Object.entries(d.items || {})) posted[k] = { ...m, date: m.date || date };
const etDate = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const bris = iso => iso ? new Date(iso).toLocaleString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).replace(/\s?(am|pm)/i, m => m.trim().toLowerCase()) + " AEST" : "time TBC";
const d2 = v => { const d = dec(num(v)); return d === null ? "–" : d.toFixed(2); };
const MK = { spread: "Spread", total: "Total", ml: "Moneyline" };
const LG_EMOJI = { NFL: "🏈", NCAAF: "🏈", CFL: "🏈", NBA: "🏀", NCAAB: "🏀", WNBA: "🏀", MLB: "⚾", NHL: "🏒" };
const BOOKN = { dk: "DraftKings", circa: "Circa", sl: "SportsLine", other: "CBS", an: "Action Network", sharp: "DraftKings" };
const upcoming = g => g.kickoff && !g.final && !g.inplay && new Date(g.kickoff) > NOW && (new Date(g.kickoff) - NOW) < 36 * 3600e3;

function earlyInfo(g){
  if (!g.kickoff || graded(g) || new Date(g.kickoff) <= NOW) return null;   // as the board: no early-market discount once a game has started
  const hrs = (new Date(g.kickoff) - NOW) / 36e5, out = [];
  const ts = [g.firstSeen, ...(g.snaps || []).map(s => s && s.t), ...Object.values(g.splits || {}).map(s => s && s.t)].filter(Boolean).sort();
  const age = ts[0] ? (NOW - new Date(ts[0])) / 36e5 : null;
  if (hrs > 48) out.push(`${Math.round(hrs / 24)} days out`);
  if (age !== null && age < 3 && hrs > 24) out.push("line only just seen");
  for (const b of ["dk", "circa"]){ const sp = g.splits?.[b]; if (!sp) continue;
    if (["spreadAwayHandle","overHandle","mlAwayHandle","spreadAwayBets","overBets","mlAwayBets"].map(k => num(sp[k])).some(v => v === 0 || v === 100)){ out.push(`thin ${BOOKN[b]} market (0% or 100% splits)`); break; } }
  return out.length ? out : null;
}
const earlyLine = g => { const e = earlyInfo(g); return e ? `⚠️ Early market: ${e.join(", ")}. Money can be skewed by low liquidity.` : null; };
/* tips */
const tipList = [], vsinList = []; for (const [date, d] of Object.entries(tipDocs)) for (const [id, t] of Object.entries(d.tips || {})) if (t) (t.kind === "vsin" ? vsinList : tipList).push({ ...t, id, date });   // VSiN picks are tracked on their own, not in consensus
const tipGame = t => (t.gameId && byId[t.gameId]) || games.find(g => g.league === t.league && g.away === t.away && g.home === t.home && etDate(g.kickoff || g.date + "T16:00:00Z") === t.date) || null;
const tipKey = t => { const base = t.gameId || `${t.league}|${t.game}|${t.date}`; return t.market === "prop" ? `${base}|prop|${String(t.selection || "").toLowerCase().replace(/\s+/g, " ").trim()}` : `${base}|${t.market}|${t.team || ""}|${t.side}`; };
const worstTip = (tips, side) => { const w = tips.filter(t => num(t.line) !== null); if (!w.length) return null; const hi = side === "over"; return w.reduce((b, t) => (hi ? num(t.line) > num(b.line) : num(t.line) < num(b.line)) ? t : b); };
function tipGroups(){
  const m = new Map();
  for (const t of tipList){ if (t.kind === "system") continue; const k = tipKey(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([key, tips]) => {
    const f = tips[0], g = tipGame(f), names = [...new Set(tips.map(t => t.tipster))];
    const decs = tips.map(t => dec(num(t.price))).filter(Boolean);
    return { key, tips, f, g, n: names.length, names, dec: decs.length ? decs.reduce((a, b) => a + b, 0) / decs.length : 1.91, kickoff: g?.kickoff || f.kickoff };
  });
}

/* tipsters on the other side of the same game and market (spread/ML: other team; totals: over v under) */
const OPP = { home: "away", away: "home", over: "under", under: "over" };
const oppKeyOf = key => { const i = key.lastIndexOf("|"), side = key.slice(i + 1); return OPP[side] && !/\|prop\|/.test(key) ? key.slice(0, i + 1) + OPP[side] : null; };
let _tgIdx = null;
function oppInfo(t){
  if (!_tgIdx){ _tgIdx = new Map(); for (const x of tipGroups()) _tgIdx.set(x.key, x); }
  const o = _tgIdx.get(oppKeyOf(t.key) || "");
  return o ? { n: o.n, names: o.names, key: o.key } : { n: 0, names: [], key: oppKeyOf(t.key) };
}
/* consensus stake: 1u plus 0.5u per extra tipster. Both sides can go out; a disagreement is flagged in the message, not blocked. */
const consStake = t => 1 + 0.5 * (t.n - 1);
const consOk = t => t.n >= 2;

/* verdict inputs: every tip group (incl. systems and SportsLine model) on this game */
function allGroupsFor(g){
  const mp = new Map();
  for (const t of tipList){ const tg = tipGame(t); if (!tg || tg.id !== g.id) continue; const k = tipKey(t); if (!mp.has(k)) mp.set(k, []); mp.get(k).push(t); }
  return [...mp.values()].map(ts => {
    const f = ts[0], model = ts.every(t => /^SportsLine model/i.test(t.tipster)), names = new Set(ts.map(t => t.tipster));
    return { market: f.market, side: f.side, n: names.size, sys: !model && ts.every(t => t.kind === "system"), model, grade: model ? (f.tipster.match(/grade ([A-F][+-]?)/i) || [])[1] : null };
  });
}
const verdictFor = g => verdict(g, allGroupsFor(g));
const RATING_TXT = { Strong: "🔥 **STRONG**", Solid: "🎯 **SOLID**" };
function priceLines(g, mk, side, line){   // Aussie best price and the Pinnacle reference for a bet
  if (!g || !["spread", "total", "ml"].includes(mk)) return [];
  const out = [], au = auLine(g, mk, side, line); if (au) out.push(`🇦🇺 ${au}`);
  const p = pinRef(g, mk, side);
  if (p) out.push(`📌 Pinnacle ${mk === "ml" ? "" : fmtQLine(mk, side, p.line) + " "}${p.price.toFixed(2)}${p.fair ? ` (fair ${p.fair.toFixed(2)})` : ""}`);
  return out;
}
function verdictMsg(g, v, flipFrom){
  const lines = [];
  if (flipFrom) lines.push(`🔄 **Update:** signals have flipped from ${flipFrom}`);
  lines.push(`${v.steam ? "⚡ **STEAM** · " : ""}${RATING_TXT[v.rating] || "👀 **LEAN**"} · ${LG_EMOJI[g.league] || ""} ${g.league}`);
  lines.push(`**${v.label} @ ${d2(v.price)}** · ${v.stake || 1}u`);
  lines.push(...priceLines(g, v.mk, v.dir, v.line));
  lines.push(`${g.away} @ ${g.home} · ${bris(g.kickoff)}`);
  lines.push(...ctxLines(g, v.dir));
  for (const w of v.why) lines.push(`• ${w}`);
  if (v.steam) lines.push(`• Line moving this way (${v.steam.txt})`);
  if (v.against) lines.push(`• Against: ${v.againstWhy.join(", ")}`);
  const mk = v.mk, s = signal(g, mk, "dk");
  if (s) lines.push(`• DraftKings: ${s.pub === v.dir ? s.pubBets : 100 - s.pubBets}% of tickets${s.pubHandle !== null ? `, ${s.pub === v.dir ? s.pubHandle : 100 - s.pubHandle}% of money` : ""} on this side`);
  const el = earlyLine(g); if (el) lines.push(el);
  let out = lines.join("\n"); if (out.length > 1900) out = out.slice(0, 1890) + "…"; return out;
}

/* plays currently qualifying */
function currentPlays(){
  const out = [];
  for (const g of games){
    if (!upcoming(g)) continue;
    for (const mk of ["spread", "total", "ml"]){
      const sig = signal(g, mk, S.book);
      if (qualifies(sig)){
        const plan = stakePlan(g, mk, sig);
        out.push({ type: "fade", key: `fade|${g.id}|${mk}|${sig.fade}`, g, mk, side: sig.fade, line: sig.fadeLine, price: mk === "ml" ? sig.fadeLine : (mk === "spread" ? g.spreadPrice?.[sig.fade] : g.totalPrice?.[sig.fade]) ?? -110, stake: plan.stake, ml: plan.ml, sig, noCirca: plan.noCirca });
      }
      const fsig = followSig(g, mk);
      if (fsig){
        const plan = followPlan(g, mk, fsig);
        out.push({ type: "circa", key: `circa|${g.id}|${mk}|${fsig.fade}`, g, mk, side: fsig.fade, line: fsig.fadeLine, price: mk === "ml" ? fsig.fadeLine : (mk === "spread" ? g.spreadPrice?.[fsig.fade] : g.totalPrice?.[fsig.fade]) ?? -110, stake: plan.stake, ml: plan.ml, sig: fsig });
      }
    }
  }
  return out;
}
const sideName = (g, mk, side) => mk === "total" ? (side === "over" ? "Over" : "Under") : g[side];
const selText = (g, mk, side, line) => mk === "ml" ? `${g[side]} ML` : mk === "total" ? `${sideName(g, mk, side)} ${line}` : `${g[side]} ${fmtLine(line)}`;
const tipsOn = (g, mk, side) => tipGroups().find(t => t.g && t.g.id === g.id && t.f.market === mk && t.f.side === side && t.n >= 1);

function ctxLines(g, side){
  if (!g) return [];
  const out = [], cl = ctxLine(g); if (cl) out.push(`📍 ${cl}`);
  const wx = wxInfo(g); if (wx && (wx.windy || wx.wet)) out.push(`${wx.windy ? "💨" : ""}${wx.wet ? "🌧️" : ""} ${wx.txt}`);
  const il = injLine(g); if (il) out.push(il);
  const tr = g.kickoff ? travelInfo(g) : null;
  if (tr) for (const t of tr.flag){
    const withIt = side && tr.fade && tr.fade.side === t.side ? (side === "home" ? " · we're on the right side of it" : side === "away" ? " · we're backing the travellers" : "") : "";
    out.push(`✈️ ${travelTxt(t)}${withIt}`);
  }
  return out;
}
function playMsg(p){
  const g = p.g, head = p.type === "fade" ? "🔻 **FADE THE PUBLIC**" : "💰 **FOLLOW CIRCA MONEY**";
  const agree = tipsOn(g, p.mk, p.side), siren = agree && agree.n >= 2 ? "🚨🚨 " : "";
  const lines = [`${siren}${head} · ${LG_EMOJI[g.league] || ""} ${g.league}`,
    `**${selText(g, p.mk, p.side, p.line)} @ ${d2(p.price)}** · ${p.stake}u${p.ml ? ` (+${p.ml.stake}u ${g[p.side]} ML @ ${p.ml.dec.toFixed(2)})` : ""}`,
    ...priceLines(g, p.mk, p.side, p.line), `${g.away} @ ${g.home} · ${bris(g.kickoff)}`, ...ctxLines(g, p.side)];
  if (p.type === "fade"){
    const s = p.sig;
    lines.push(`• Public: ${s.pubBets}% of ${BOOKN[S.book]} tickets on ${s.pubLabel}${s.pubHandle !== null ? `, only ${s.pubHandle}% of the money` : ""}`);
    if (s.circaPub !== null) lines.push(`• Circa money: ${100 - s.circaPub}% on ${sideName(g, p.mk, p.side)}`);
    else lines.push(`• No Circa data yet, so half stake`);
    if (s.rlm) lines.push(`• Line moved against the public (${s.moveTxt})`);
  } else {
    const s = p.sig;
    lines.push(`• Circa money: ${s.share}% on ${sideName(g, p.mk, p.side)}`);
    if (s.dkShare !== null) lines.push(`• DraftKings money: ${s.dkShare}% on the same side${s.split ? " (books split, stake up)" : ""}`);
  }
  if (agree) lines.push(`• Tipsters on this side: ${agree.names.join(", ")}`);
  const m = g.model?.[p.mk]; if (m && m.side === p.side && /^[AB]/i.test(m.grade || "")) lines.push(`• SportsLine model agrees (grade ${m.grade})`);
  const el = earlyLine(g); if (el) lines.push(el);
  return lines.join("\n");
}
function tipMsg(t, prevN){
  const g = t.g, f = t.f;
  const Vx = g && ["spread", "total", "ml"].includes(f.market) ? verdictFor(g)[f.market === "total" ? "total" : "side"] : null;
  const match = Vx && Vx.dir === f.side && (Vx.rating === "Strong" || Vx.rating === "Solid") ? { type: "best", v: Vx } : null;
  const siren = match ? "🚨🚨 " : "";
  const upd = prevN ? `➕ **Now ${t.n} tipsters** (was ${prevN})\n` : "";
  const op = oppInfo(t);
  const lines = [`${upd}${siren}🧠 **TIPSTER CONSENSUS** · ${op.n ? `${t.n} v ${op.n} tipsters` : `${t.n} tipsters`} · ${LG_EMOJI[f.league] || ""} ${f.league}`,
    `**${f.selection} @ ${t.dec.toFixed(2)}** · ${consStake(t)}u`,
    ...(g ? priceLines(g, f.market, f.side, num(f.line) ?? (f.market === "spread" ? (f.side === "home" ? num(g.spread?.cur) : -num(g.spread?.cur)) : f.market === "total" ? num(g.total?.cur) : null)) : []), `${f.game} · ${bris(t.kickoff)}`, ...ctxLines(g, f.side)];
  for (const tp of t.tips.slice(0, 5)) lines.push(`• **${tp.tipster}**${tp.record ? ` (${tp.record})` : ""}: ${String(tp.note || "").slice(0, 220)}`);
  if (op.n) lines.push(`• ⚖️ **Tipster disagreement** (${t.n} v ${op.n}): ${op.names.join(", ")} ${op.n === 1 ? "is" : "are"} on the other side. Both sides have backers, so consider sizing down.`);
  if (g){ const m = g.model?.[f.market]; if (m && m.side === f.side && /^[AB]/i.test(m.grade || "")) lines.push(`• SportsLine model agrees (grade ${m.grade}, ${m.prob}% v ${m.implied}% implied)`); }
  if (match) lines.push(`🚨 Agrees with our ${match.v.rating.toLowerCase()} verdict (${match.v.why.join(", ")})`);
  else if (g && ["spread", "total", "ml"].includes(f.market)){
    const bk = [S.book, "dk", "sl", "circa", "other"].find(b => signal(g, f.market, b)), sig = bk && signal(g, f.market, bk);
    if (sig) lines.push(`• Betting data: ${sig.pub === f.side ? "with" : "against"} the public (${sig.pub === f.side ? sig.pubBets : 100 - sig.pubBets}% of ${BOOKN[bk]} tickets on this side)${sig.circaPub !== null ? `, Circa money ${sig.pub === f.side ? sig.circaPub : 100 - sig.circaPub}% this side` : ""}`);
  }
  if (g){ const el = earlyLine(g); if (el) lines.push(el); }
  let s = lines.join("\n"); if (s.length > 1900) s = s.slice(0, 1890) + "…"; return s;
}

/* grading of posted markers */
function gradeMarker(m){
  if (m.result) return m.result;
  if (m.market === "prop"){ const tips = tipList.filter(t => tipKey(t) === m.groupKey && t.result); return tips[0]?.result || null; }
  const g = byId[m.gameId]; if (!g || !graded(g)) return null;
  const a = +g.final.away, h = +g.final.home, line = num(m.line);
  if (m.market === "ml") return a === h ? "P" : ((m.side === "home") === (h > a) ? "W" : "L");
  if (m.market === "spread"){ if (line === null) return null; const x = (m.side === "home" ? h - a : a - h) + line; return x > 0 ? "W" : x < 0 ? "L" : "P"; }
  if (m.market === "total"){ if (line === null) return null; const t = a + h; return t === line ? "P" : ((m.side === "over") === (t > line) ? "W" : "L"); }
  if (m.market === "teamtotal"){ if (line === null) return null; const sc = m.team === "home" ? h : a; return sc === line ? "P" : ((m.side === "over") === (sc > line) ? "W" : "L"); }
  if (m.market === "prop"){ const tips = tipList.filter(t => tipKey(t) === m.groupKey && t.result); return tips[0]?.result || null; }
  return null;
}
function markerUnits(m, r){
  let u = r === "W" ? (dec(num(m.price)) ?? 1.91) - 1 : r === "L" ? -1 : 0; u *= m.stake;
  if (m.ml && g0(m)){ const rr = gradeMarker({ ...m, market: "ml", ml: null }); u += rr === "W" ? (m.ml.dec - 1) * m.ml.stake : rr === "L" ? -m.ml.stake : 0; }
  return u;
}
function g0(m){ const g = byId[m.gameId]; return !!g && graded(g); }
function summary(dates, title){
  const ms = Object.entries(posted).filter(([, m]) => dates.includes(m.date) && ["best", "fade", "circa", "tips"].includes(m.type));
  if (!ms.length) return null;
  const T = { best: "🎯 Best bets", fade: "🔻 Fade the Public", circa: "💰 Follow Circa", tips: "🧠 Tipster consensus" };
  const rows = [], tot = { w: 0, l: 0, p: 0, u: 0, st: 0, open: 0 };
  for (const type of ["best", "fade", "circa", "tips"]){
    const a = { w: 0, l: 0, p: 0, u: 0, st: 0, open: 0 };
    for (const [, m] of ms.filter(([, m]) => m.type === type)){
      const r = gradeMarker(m); if (!r){ a.open++; continue; }
      a[r.toLowerCase()]++; a.u += markerUnits(m, r); a.st += m.stake + (m.ml ? m.ml.stake : 0);
    }
    if (a.w + a.l + a.p + a.open === 0) continue;
    for (const k in tot) tot[k] += a[k];
    rows.push(`${T[type]}: **${a.w}-${a.l}${a.p ? "-" + a.p : ""}**, ${(a.u >= 0 ? "+" : "") + a.u.toFixed(2)}u${a.open ? ` (${a.open} not settled)` : ""}`);
  }
  const best = ms.map(([, m]) => ({ m, r: gradeMarker(m) })).filter(x => x.r === "W").map(x => ({ ...x, u: markerUnits(x.m, "W") })).sort((a, b) => b.u - a.u)[0];
  const out = [`📊 **${title}**`, ...rows, `**Overall: ${tot.w}-${tot.l}${tot.p ? "-" + tot.p : ""}, ${(tot.u >= 0 ? "+" : "") + tot.u.toFixed(2)}u${tot.st ? `, ROI ${(tot.u / tot.st * 100).toFixed(1)}%` : ""}**`];
  if (best) out.push(`Best: ${best.m.selection} +${best.u.toFixed(2)}u`);
  const cl = ms.map(([, m]) => { const g = byId[m.gameId]; return g && ["spread", "total", "ml"].includes(m.market) ? clvFor(g, m.market, m.side, m.line, m.price) : null; }).filter(Boolean);
  if (cl.length){ const beat = cl.filter(c => c.beat).length, pc = cl.filter(c => c.pct != null); out.push(`📌 Beat Pinnacle's close on ${beat} of ${cl.length} plays${pc.length ? ` (price edge ${(pc.reduce((a, c) => a + c.pct, 0) / pc.length * 100 >= 0 ? "+" : "")}${(pc.reduce((a, c) => a + c.pct, 0) / pc.length * 100).toFixed(1)}% avg)` : ""}`); }
  return out.join("\n");
}
const briDate = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

const TEAM_NAMES = (() => { const m = {}, add = (lg, s) => s.split(";").forEach(x => { const [k, v] = x.split("="); m[lg + "|" + k.trim()] = v.trim(); });
  add("NFL", "ARI=Arizona Cardinals;ATL=Atlanta Falcons;BAL=Baltimore Ravens;BUF=Buffalo Bills;CAR=Carolina Panthers;CHI=Chicago Bears;CIN=Cincinnati Bengals;CLE=Cleveland Browns;DAL=Dallas Cowboys;DEN=Denver Broncos;DET=Detroit Lions;GB=Green Bay Packers;HOU=Houston Texans;IND=Indianapolis Colts;JAX=Jacksonville Jaguars;KC=Kansas City Chiefs;LV=Las Vegas Raiders;LAC=Los Angeles Chargers;LAR=Los Angeles Rams;MIA=Miami Dolphins;MIN=Minnesota Vikings;NE=New England Patriots;NO=New Orleans Saints;NYG=New York Giants;NYJ=New York Jets;PHI=Philadelphia Eagles;PIT=Pittsburgh Steelers;SF=San Francisco 49ers;SEA=Seattle Seahawks;TB=Tampa Bay Buccaneers;TEN=Tennessee Titans;WSH=Washington Commanders;WAS=Washington Commanders");
  add("NBA", "ATL=Atlanta Hawks;BOS=Boston Celtics;BKN=Brooklyn Nets;CHA=Charlotte Hornets;CHI=Chicago Bulls;CLE=Cleveland Cavaliers;DAL=Dallas Mavericks;DEN=Denver Nuggets;DET=Detroit Pistons;GS=Golden State Warriors;GSW=Golden State Warriors;HOU=Houston Rockets;IND=Indiana Pacers;LAC=LA Clippers;LAL=Los Angeles Lakers;MEM=Memphis Grizzlies;MIA=Miami Heat;MIL=Milwaukee Bucks;MIN=Minnesota Timberwolves;NO=New Orleans Pelicans;NOP=New Orleans Pelicans;NY=New York Knicks;NYK=New York Knicks;OKC=Oklahoma City Thunder;ORL=Orlando Magic;PHI=Philadelphia 76ers;PHX=Phoenix Suns;POR=Portland Trail Blazers;SAC=Sacramento Kings;SA=San Antonio Spurs;SAS=San Antonio Spurs;TOR=Toronto Raptors;UTAH=Utah Jazz;UTA=Utah Jazz;WSH=Washington Wizards");
  add("MLB", "ARI=Arizona Diamondbacks;ATL=Atlanta Braves;BAL=Baltimore Orioles;BOS=Boston Red Sox;CHC=Chicago Cubs;CHW=Chicago White Sox;CWS=Chicago White Sox;CIN=Cincinnati Reds;CLE=Cleveland Guardians;COL=Colorado Rockies;DET=Detroit Tigers;HOU=Houston Astros;KC=Kansas City Royals;LAA=Los Angeles Angels;LAD=Los Angeles Dodgers;MIA=Miami Marlins;MIL=Milwaukee Brewers;MIN=Minnesota Twins;NYM=New York Mets;NYY=New York Yankees;ATH=Athletics;OAK=Athletics;PHI=Philadelphia Phillies;PIT=Pittsburgh Pirates;SD=San Diego Padres;SF=San Francisco Giants;SEA=Seattle Mariners;STL=St. Louis Cardinals;TB=Tampa Bay Rays;TEX=Texas Rangers;TOR=Toronto Blue Jays;WSH=Washington Nationals");
  add("NHL", "ANA=Anaheim Ducks;BOS=Boston Bruins;BUF=Buffalo Sabres;CGY=Calgary Flames;CAR=Carolina Hurricanes;CHI=Chicago Blackhawks;COL=Colorado Avalanche;CBJ=Columbus Blue Jackets;DAL=Dallas Stars;DET=Detroit Red Wings;EDM=Edmonton Oilers;FLA=Florida Panthers;LA=Los Angeles Kings;MIN=Minnesota Wild;MTL=Montreal Canadiens;NSH=Nashville Predators;NJ=New Jersey Devils;NYI=New York Islanders;NYR=New York Rangers;OTT=Ottawa Senators;PHI=Philadelphia Flyers;PIT=Pittsburgh Penguins;SJ=San Jose Sharks;SEA=Seattle Kraken;STL=St. Louis Blues;TB=Tampa Bay Lightning;TOR=Toronto Maple Leafs;UTAH=Utah Mammoth;UTA=Utah Mammoth;VAN=Vancouver Canucks;VGK=Vegas Golden Knights;WSH=Washington Capitals;WPG=Winnipeg Jets");
  add("WNBA", "ATL=Atlanta Dream;CHI=Chicago Sky;CONN=Connecticut Sun;DAL=Dallas Wings;GS=Golden State Valkyries;IND=Indiana Fever;LV=Las Vegas Aces;LA=Los Angeles Sparks;MIN=Minnesota Lynx;NY=New York Liberty;PHX=Phoenix Mercury;SEA=Seattle Storm;WSH=Washington Mystics;TOR=Toronto Tempo;POR=Portland Fire");
  return m; })();
const fullName = (lg, t) => TEAM_NAMES[lg + "|" + t] || t;
/* ---------- VSiN Pro Picks (tracked on their own as kind "vsin"; not in consensus) ---------- */
function vsinParse(s){   // one VSiN pick line -> {market, side, line, price, units, away, home, pickTeam} | null (props, team totals, halves, parlays, live)
  s = String(s || "").replace(/\s*\|\s*[\d.]+% Edge.*$/, "").trim();
  if (/^(Team Total|1st|First|F5|1H|2H|1Q|1P|REG|Parlay|\d-Leg)/i.test(s) || /1st Half|First Half|1st Period|First 5|1st 5|Quarter|LIVE|SGP|Anytime/i.test(s)) return null;
  const U = String.raw`(?:\s*\[(?!\s*[\d.]+\s*units?\s*\]).*?\])*(?:\s*\[\s*([\d.]+)\s*units?\s*\])?\s*$`, P = String.raw`\(([+-]\d+|EV)\)`;
  const amer = x => /^ev$/i.test(x) ? 100 : +x, un = u => u ? +u : 1, bad = x => / - /.test(x);
  let m = s.match(new RegExp(String.raw`^(.+?)\s+(vs|at)\s+(.+?)\s*-\s*(OVER|UNDER)\s*\(([\d.]+)\)\s*` + P + U, "i"));
  if (m){ const [, a, vs, b, ou, ln, pr, u] = m; const [away, home] = vs.toLowerCase() === "at" ? [a, b] : [b, a]; if (bad(away) || bad(home)) return null;
    return { market: "total", side: ou.toLowerCase(), line: +ln, price: amer(pr), units: un(u), away, home }; }
  m = s.match(new RegExp(String.raw`^(?:Money Line|Moneyline)\s*-\s*(.+?)\s*` + P + String.raw`\s+(vs|at)\s+(.+?)` + U, "i"));
  if (m){ const [, t, pr, vs, o, u] = m; const at = vs.toLowerCase() === "at"; if (bad(t) || bad(o)) return null;
    return { market: "ml", side: at ? "away" : "home", line: null, price: amer(pr), units: un(u), away: at ? t : o, home: at ? o : t }; }
  m = s.match(new RegExp(String.raw`^(?:(?:Run Line|Puck Line|Spread)\s*-\s*)?(.+?)\s*\(([+-]?[\d.]+|PK|EV)\)\s*` + P + String.raw`\s+(vs|at)\s+(.+?)` + U, "i"));
  if (m){ const [, t, ln, pr, vs, o, u] = m; const at = vs.toLowerCase() === "at"; if (bad(t) || bad(o)) return null;
    return { market: "spread", side: at ? "away" : "home", line: /^(pk|ev)$/i.test(ln) ? 0 : +ln, price: amer(pr), units: un(u), away: at ? t : o, home: at ? o : t }; }
  return null;
}
const vsinSlug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const vsinId = (expert, gid, p) => `vsin-${vsinSlug(expert)}-${String(gid).toLowerCase()}-${p.market}-${p.side}`;
if (MODE === "vsinjs"){   // node engine.js <dir> vsinjs <outDir> -> {lib, calls}: browser calls that read VSiN Pro Picks for ET dates today-2 .. today+2
  const outDir = process.argv[4]; fs.mkdirSync(outDir, { recursive: true });
  const done = {}; for (const t of vsinList) if (t.result) (done[t.date] = done[t.date] || []).push(t.id);
  const lib = path.join(outDir, "vsin-lib.js");
  fs.writeFileSync(lib, `window.__vsinParse = ${vsinParse.toString()};
window.__vsinPicks = async function(date, done){
  const vsinSlug = ${vsinSlug.toString()}, vsinId = ${vsinId.toString()};
  const html = await fetch("/propicks/eventdate/?eventdate=" + date, { credentials: "include" }).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [], skip = new Set(done || []);
  const T = e => (e ? e.textContent : "").replace(/\\s+/g, " ").trim();
  for (const a of doc.querySelectorAll('a[href*="/propicks/game/?gameid="]')){
    const row = a.closest("tr"), head = row && row.previousElementSibling; if (!head) continue;
    const sport = T(head.querySelector('a[href*="sportid="]')); if (!/^(NFL|CFB|CFL|NBA|WNBA|MLB|NHL|CBB|NCAAB)$/.test(sport)) continue;
    const pick = T(a), p = window.__vsinParse(pick); if (!p) continue;
    const ex = head.querySelector('a[href*="vsinexpertid"]'), spans = head.querySelectorAll("span.fw-bold"), divs = row.querySelectorAll("td:first-child div");
    const card = a.closest(".card-body"), tm = card && card.querySelector("span.font-11"), gid = (a.getAttribute("href").match(/gameid=([^&]+)/) || [])[1];
    if (skip.has(vsinId(T(ex), gid, p))) continue;
    out.push([date, sport, gid, T(ex), T(spans[0]), T(spans[1]), T(divs[0]), T(divs[1]), T(tm), pick]);
  }
  return JSON.stringify(out);
};
"vsin ready"`);
  const calls = [];
  for (let i = -2; i <= 2; i++){
    const d = etDate(new Date(NOW.getTime() + i * 864e5).toISOString()), f = path.join(outDir, `vsin-${d}.js`);
    fs.writeFileSync(f, `await window.__vsinPicks(${JSON.stringify(d)}, ${JSON.stringify(done[d] || [])})`); calls.push(f);
  }
  process.stdout.write(JSON.stringify({ lib, calls })); process.exit(0);
}
if (MODE === "vsindocs"){   // node engine.js <dir> vsindocs <res.json> ... -> {<date>: {tips:{<id>: tip or {result,...}}}, stats}
  const files = process.argv.slice(4).filter(a => !/^\d{4}-\d\d-\d\dT/.test(a)), docs = {}, st = { new: 0, settled: 0, matched: 0, unmatched: 0 };
  const have = Object.fromEntries(vsinList.map(t => [t.id, t]));
  const codesIn = {}; for (const g of games) (codesIn[g.league] = codesIn[g.league] || new Set()).add(g.away), codesIn[g.league].add(g.home);
  const proCode = (lg, x) => { x = x.replace(/^Ny /, "New York ").trim().toLowerCase(); const c = Object.keys(TEAM_NAMES).filter(k => k.startsWith(lg + "|")).filter(k => { const v = TEAM_NAMES[k].toLowerCase(); return v === x || v.endsWith(" " + x) || v.startsWith(x + " "); }).map(k => k.split("|")[1]);
    return c.find(k => codesIn[lg]?.has(k)) || c[0] || null; };
  const cfb = x => [[/\bST\b/g, "State"], [/^C /, "Central "], [/^E /, "Eastern "], [/^W /, "Western "], [/^N /, "Northern "], [/^Miami FL$/, "Miami"], [/^Miami OH$/, "Miami (OH)"]].reduce((s, [a, b]) => s.replace(a, b), x);
  const nm = x => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/state/g, "st").trim();
  const LGS = { CFB: "NCAAF", CBB: "NCAAB" };
  for (const f of files){
    let rows = JSON.parse(fs.readFileSync(f, "utf8")); if (typeof rows === "string") rows = JSON.parse(rows);
    for (const [d, sport, gid, expert, show, postedAt, score, res, tm, pick] of rows){
      const p = vsinParse(pick); if (!p) continue;
      const id = vsinId(expert, gid, p), r = { WIN: "W", LOSS: "L", PUSH: "P" }[String(res).toUpperCase()] || null;
      const old = have[id] || docs[d]?.tips?.[id];
      if (old){ if (r && !old.result){ ((docs[d] = docs[d] || { tips: {} }).tips)[id] = { result: r, settledBy: "VSiN", score: score && score !== "-" ? score : null, settledAt: NOW.toISOString() }; st.settled++; } continue; }
      const lg = LGS[sport] || sport; let g = null, ac, hc;
      if (lg === "NCAAF"){
        const a = cfb(p.away), h = cfb(p.home), sc = x => (nm(x.away) === nm(a)) + (nm(x.home) === nm(h)) + 0.5 * (nm(x.away).includes(nm(a)) || nm(a).includes(nm(x.away))) + 0.5 * (nm(x.home).includes(nm(h)) || nm(h).includes(nm(x.home)));
        const cand = games.filter(x => x.league === "NCAAF" && x.kickoff && Math.abs(Date.parse(etDate(x.kickoff)) - Date.parse(d)) <= 864e5).sort((x, y) => sc(y) - sc(x));
        g = cand[0] && sc(cand[0]) >= 2 ? cand[0] : null; ac = g ? g.away : a; hc = g ? g.home : h;
      } else {
        ac = proCode(lg, p.away); hc = proCode(lg, p.home); if (!ac || !hc) continue;
        g = games.find(x => x.league === lg && x.away === ac && x.home === hc && x.kickoff && etDate(x.kickoff) === d) || null;
      }
      st[g ? "matched" : "unmatched"]++;
      let ko = g?.kickoff || null; const tmm = String(tm).match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!ko && tmm){ const hh = (+tmm[1] % 12) + (/pm/i.test(tmm[3]) ? 12 : 0); const guess = Date.parse(`${d}T${String(hh).padStart(2, "0")}:${tmm[2]}:00Z`) + 4 * 36e5; ko = new Date(guess).toISOString().replace(/\.\d+Z$/, "Z"); }
      const tc = p.side === "away" ? ac : hc;
      const sel = p.market === "total" ? `${p.side === "over" ? "Over" : "Under"} ${p.line}` : p.market === "ml" ? `${tc} ML` : p.line ? `${tc} ${p.line > 0 ? "+" : ""}${p.line}` : `${tc} PK`;
      ((docs[d] = docs[d] || { tips: {} }).tips)[id] = { tipster: expert, kind: "vsin", src: "VSiN", book: "VSiN", league: lg, gameId: g?.id || null, away: ac, home: hc, game: `${ac} @ ${hc}`, kickoff: ko,
        market: p.market, side: p.side, team: null, line: p.line, price: p.price, units: p.units, selection: sel, note: `${show} (VSiN Pro Picks)`, record: null,
        result: r, settledBy: r ? "VSiN" : null, score: score && score !== "-" ? score : null, vsinGid: gid, posted: postedAt, t: NOW.toISOString() };
      st.new++;
    }
  }
  process.stdout.write(JSON.stringify({ docs, stats: st })); process.exit(0);
}
if (MODE === "tipfix"){   // fixtures for the Chippy Tipping app: {docs:{<SPORT>-<season>-W<nn>: {...}}}
  const SPORTS = ["NFL", "NCAAF", "NBA", "NHL", "MLB", "WNBA", "AFL", "NRL"];
  const anchor = Date.UTC(2026, 8, 8);   // Tuesday 8 Sep 2026: NFL week 1 starts that week
  const rk = ko => { const d = etDate(ko), t = Date.parse(d + "T12:00:00Z"); const w = Math.floor((t - anchor) / (7 * 864e5)) + 1; const start = new Date(anchor + (w - 1) * 7 * 864e5); return { w, start: start.toISOString().slice(0, 10) }; };
  const docs = {}, lo = NOW.getTime() - 9 * 864e5, hi = NOW.getTime() + 13 * 864e5;
  for (const g of games){
    if (!SPORTS.includes(g.league) || (!g.kickoff && !g.date)) continue;
    const koIso = g.kickoff || g.date + "T17:00:00Z", ko = Date.parse(koIso); if (ko < lo || ko > hi) continue;
    const { w, start } = rk(koIso), id = `${g.league}-2026-W${String(w).padStart(2, "0")}`;
    const pc = g.pin?.c || null, books = g.odds?.books || {};
    const bestMl = side => { let best = null; for (const [k, name] of [["tab", "TAB"], ["pb", "PointsBet"], ["neds", "Neds"], ["uni", "Unibet"]]){ const a = books[k]; const p = a ? (side === "home" ? a[0] : a[1]) : null; if (p && (!best || p > best.p)) best = { p, b: name }; } return best; };
    const mlOf = side => { const b = bestMl(side); if (b) return { p: b.p, b: b.b }; const p = pc ? (side === "home" ? pc[0] : pc[1]) : dec(num(g.ml?.[side])); return p ? { p: +(+p).toFixed(2), b: pc ? "Pinnacle" : "DraftKings" } : null; };
    const spread = pc && pc[2] != null ? pc[2] : num(g.spread?.cur), total = pc && pc[5] != null ? pc[5] : num(g.total?.cur);
    const d = docs[id] = docs[id] || { sport: g.league, round: w, label: g.league === "NFL" ? `Week ${w}` : `Week of ${new Date(start + "T12:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`, start, games: {}, updatedAt: NOW.toISOString() };
    const etH = g.kickoff ? +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(g.kickoff)) : null;
    const c = g.ctx || {}, info = {};
    if (c.venue) info.venue = c.venue + (c.city ? ", " + c.city + (c.state ? " " + c.state : "") : "");
    if (c.tv && c.tv.length) info.tv = c.tv.slice(0, 4);
    const wx = wxInfo(g); if (wx) info.wx = { txt: wx.txt, windy: wx.windy, wet: wx.wet }; else if (c.indoor === true) info.wx = { txt: "Indoor" };
    const il = injLine(g); if (il) info.inj = il.replace(/^🩹 /, "");
    const tr = g.kickoff ? travelInfo(g) : null; if (tr && tr.flag.length) info.travel = tr.flag.map(travelTxt).join("; ");
    if (tr) info.local = tr.local;
    /* prices for tipping, per source: each pick is [line, decimal price, book] */
    const pick = (arr, mk, side, bk) => { const q = bookQuote(arr, mk, side); return q ? [q.line, +q.price.toFixed(3), bk] : null; };
    const fromArr = (arr, bk) => arr ? { sp: { home: pick(arr, "spread", "home", bk), away: pick(arr, "spread", "away", bk) }, to: { over: pick(arr, "total", "over", bk), under: pick(arr, "total", "under", bk) }, ml: { home: pick(arr, "ml", "home", bk), away: pick(arr, "ml", "away", bk) } } : null;
    const px = {};
    if (pc) px.pin = fromArr(pc, "Pinnacle");
    const au = {}, refSp = pc && pc[2] != null ? pc[2] : spread, refTo = pc && pc[5] != null ? pc[5] : total;
    for (const [mk, key, sides] of [["spread", "sp", ["home", "away"]], ["total", "to", ["over", "under"]], ["ml", "ml", ["home", "away"]]]){
      for (const side of sides){
        const ref = mk === "ml" ? null : mk === "spread" ? (refSp == null ? null : side === "home" ? refSp : -refSp) : refTo;
        const q = auQuotes(g, mk, side, ref)[0]; if (!q) continue;
        (au[key] = au[key] || {})[side] = [q.line, +q.price.toFixed(3), q.name];
      }
    }
    if (Object.keys(au).length) px.au = au;
    const dkMl = side => { const p = dec(num(g.ml?.[side])); return p ? [null, +p.toFixed(3), "DraftKings"] : null; };
    const dkPr = v => { const p = dec(num(v)); return p ? +p.toFixed(3) : 1.91; };
    px.dk = { sp: num(g.spread?.cur) === null ? null : { home: [num(g.spread.cur), dkPr(g.spreadPrice?.home), "DraftKings"], away: [-num(g.spread.cur), dkPr(g.spreadPrice?.away), "DraftKings"] },
      to: num(g.total?.cur) === null ? null : { over: [num(g.total.cur), dkPr(g.totalPrice?.over), "DraftKings"], under: [num(g.total.cur), dkPr(g.totalPrice?.under), "DraftKings"] },
      ml: { home: dkMl("home"), away: dkMl("away") } };
    const pxT = g.odds?.t || null;
    d.games[g.id] = { px, pxT, pinT: g.pin?.t || null, auT: g.odds?.ta || null, home: g.home, away: g.away, homeName: fullName(g.league, g.home), awayName: fullName(g.league, g.away), kickoff: g.kickoff || null, prime: etH !== null && etH >= 19, spread, total, ml: { home: mlOf("home"), away: mlOf("away") }, info, final: g.final && num(g.final.home) !== null ? { home: +g.final.home, away: +g.final.away } : null };
  }
  process.stdout.write(JSON.stringify({ docs }));
  process.exit(0);
}
/* main */
const BKKEY = { "pinnacle": "pin", "circasports": "circa", "tab.com.au": "tab", "pointsbet.com.au": "pb", "neds.com.au": "neds", "unibet.com.au": "uni" };
const OAL = { WAS: "WSH", GSW: "GS", NYK: "NY", SAS: "SA", NOP: "NO", UTA: "UTAH", LAK: "LA", NJD: "NJ", SJS: "SJ", TBL: "TB", JAC: "JAX", CWS: "CHW", OAK: "ATH", KCR: "KC", SDP: "SD", SFG: "SF", TBR: "TB", WSN: "WSH", CON: "CONN", LVA: "LV", NYL: "NY", LAS: "LA", PHO: "PHX", WAS: "WSH", LV: "LV", LVR: "LV", VGK: "VGK", MON: "MTL", CLB: "CBJ", NAS: "NSH", ARZ: "ARI", LAR: "LAR" };
const oab = s => { s = String(s || "").toUpperCase(); return OAL[s] || s; };
const onrm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/\bst\b\.?/g, "state").replace(/[^a-z0-9]/g, "");
function teamScore(board, abbr, name, college){
  if (!college) return oab(abbr) === oab(board) ? 3 : 0;
  const b = onrm(board), n = onrm(name), a = onrm(abbr);
  if (!b) return 0;
  if (b === n || b === a) return 3;
  if (n.startsWith(b) || b.startsWith(n)) return 1;
  return 0;
}
function matchFixture(lg, row){
  const [fid, start, hAbbr, hName, aAbbr, aName] = row, college = lg === "NCAAF" || lg === "NCAAB";
  const sdate = etDate(new Date(start * 1000).toISOString());
  let best = null, bestS = 0, tie = false;
  for (const g of games){
    if (g.league !== lg || g.final) continue;
    if (g.kickoff){ if (Math.abs(Date.parse(g.kickoff) / 1000 - start) > 3 * 3600) continue; }
    else if (g.date !== sdate) continue;
    const sh = teamScore(g.home, hAbbr, hName, college), sa = teamScore(g.away, aAbbr, aName, college);
    if (!sh || !sa) continue;
    const sc = sh + sa;
    if (sc > bestS){ best = g; bestS = sc; tie = false; } else if (sc === bestS) tie = true;
  }
  return tie ? null : best;
}
if (MODE === "oddsplan"){   // node engine.js <dir> oddsplan full|light -> which leagues to ask OddsPapi for
  const full = process.argv[4] === "full", hz = (full ? 168 : 36) * 3600e3, set = new Set();
  for (const g of games){
    if (g.final || g.inplay) continue;
    const ko = g.kickoff ? Date.parse(g.kickoff) : Date.parse((g.date || "") + "T23:00:00Z");
    if (!(ko > NOW.getTime() - 600e3 && ko < NOW.getTime() + hz)) continue;
    set.add(g.league);
  }
  const leagues = [...set].filter(l => ["NFL", "NCAAF", "CFL", "NBA", "WNBA", "NCAAB", "MLB", "NHL"].includes(l));
  process.stdout.write(JSON.stringify({ leagues, calls: leagues.map(l => `await window.__fbodds("${l}", ${full})`) }));
  process.exit(0);
}
if (MODE === "oddslib"){ process.stdout.write(ODDSJS); process.exit(0); }
if (MODE === "oddsdocs"){   // node engine.js <dir> oddsdocs <res.json> ... -> {dayId:{games:{key:{odds, pin}}}}
  const docs = {}, files = process.argv.slice(4).filter(a => !/^\d{4}-\d\d-\d\dT/.test(a)), unmatched = [];
  let matchedN = 0, rem = null;
  for (const f of files){
    let r = JSON.parse(fs.readFileSync(f, "utf8")); if (typeof r === "string") r = JSON.parse(r);
    if (!r || !r.f) continue; if (r.rem) rem = r.rem;
    for (const row of r.f){
      if (!Array.isArray(row)) continue;
      const g = matchFixture(r.league, row); if (!g){ unmatched.push(`${r.league} ${row[4] || row[5]} @ ${row[2] || row[3]}`); continue; }
      matchedN++;
      const books = {}; for (const [bk, arr] of Object.entries(row[6] || {})) if (BKKEY[bk]) books[BKKEY[bk]] = arr;
      const upd = { odds: { t: r.t, fid: row[0], books } };   // update merges nested objects, so a Pinnacle-only run keeps the Aussie books
      if (["tab", "pb", "neds", "uni"].some(k => books[k])) upd.odds.ta = r.t;   // when the Aussie prices were last fetched
      const pa = books.pin;
      if (pa){
        const c = pa.slice(0, 8), prev = g.pin || {}, h = [...(prev.h || [])];
        const last = h.length ? h[h.length - 1].slice(1) : null;
        if (!last || JSON.stringify(last) !== JSON.stringify(c)) h.push([r.t, ...c]);
        upd.pin = { c, t: r.t, h: h.slice(-24) };
        if (!prev.o) upd.pin.o = c;
      }
      ((docs[g.dayId] = docs[g.dayId] || { games: {} }).games)[g.id] = upd;
    }
  }
  process.stdout.write(JSON.stringify({ docs, matched: matchedN, unmatched: unmatched.slice(0, 30), remaining: rem }));
  process.exit(0);
}
if (MODE.startsWith("ctxjs")){   // node engine.js <dir> ctxjs[:LEAGUE] <outDir> -> writes <outDir>/ctx-NN.js (12 games each), prints the file list
  const only = MODE.split(":")[1] || null, out = [], outDir = process.argv[4];
  for (const g of games){
    if (only && g.league !== only) continue;
    if (g.final || g.inplay || g.league === "CFL") continue;
    const ko = g.kickoff ? new Date(g.kickoff) : null, hrs = ko ? (ko - NOW) / 36e5 : null;
    if (ko && (hrs < -1 || hrs > 54)) continue;
    if (!ko && (g.date < etDate(NOW.toISOString()) || g.date > etDate(new Date(NOW.getTime() + 2 * 864e5).toISOString()))) continue;
    const c = g.ctx, age = c && c.t ? (NOW - new Date(c.t)) / 36e5 : 999;
    if (c && age < 12 && !(hrs !== null && hrs < 6 && age > 1)) continue;
    if (g.league === "NCAAF" || g.league === "NCAAB"){   // college: only games with something on them
      const V = verdictFor(g), hasTip = tipGroups().some(t => t.g && t.g.id === g.id);
      if (!hasTip && !["side", "total"].some(a => V[a] && ["Strong", "Solid", "Lean"].includes(V[a].rating))) continue;
    }
    out.push({ key: g.id, league: g.league, away: g.away, home: g.home, kickoff: g.kickoff || null, date: g.date || etDate(g.kickoff),
      inj: ["NFL", "NBA", "WNBA", "NHL", "NCAAB"].includes(g.league) && hrs !== null && hrs < 48, wx: ["NFL", "NCAAF", "MLB"].includes(g.league) });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const files = [], lib = path.join(outDir, "ctx-lib.js");
  fs.writeFileSync(lib, CTXJS.replace(/\/\*[\s\S]*?\*\//g, ""));
  for (let i = 0; i < out.length; i += 12){
    const f = path.join(outDir, `ctx-${String(files.length + 1).padStart(2, "0")}.js`);
    fs.writeFileSync(f, `await window.__fbctx(${JSON.stringify(out.slice(i, i + 12).map(j => ({ key: j.key, league: j.league, away: j.away, home: j.home, kickoff: j.kickoff, date: j.date, inj: j.inj, wx: j.wx })))})`);
    files.push(f);
  }
  process.stdout.write(JSON.stringify({ games: out.length, lib, calls: files }));
  process.exit(0);
}
if (MODE === "ctxdocs"){   // node engine.js <dir> ctxdocs <result.json> [more.json ...] -> {dayId:{games:{key:{ctx, kickoff?}}}}
  const docs = {}, files = process.argv.slice(4).filter(a => !/^\d{4}-\d\d-\d\dT/.test(a));
  for (const f of files){
    let r = JSON.parse(fs.readFileSync(f, "utf8")); if (typeof r === "string") r = JSON.parse(r);
    const res = r.ctx || r;
    for (const [key, c] of Object.entries(res)){
      const g = byId[key]; if (!g || !c) continue;
      const { kickoff, ...ctx } = c, upd = { ctx };
      if (!g.kickoff && kickoff) upd.kickoff = kickoff;
      ((docs[g.dayId] = docs[g.dayId] || { games: {} }).games)[key] = upd;
    }
  }
  process.stdout.write(JSON.stringify(docs));
  process.exit(0);
}
/* ===== hourly run, collector edition =====
   The browser collector (collect.js + ctx.js, served at chippytips.com/fb/collector.js) gathers everything as compact JSON,
   so the scheduled run never reads whole pages. Modes:
     plan      -> {quiet, why, vsinJs, slJs, nonce}            what to collect this run (JS one-liners to paste into the two tabs)
     apply     -> {writes:[[...]], manual, stats}              reads the collector results from this session's transcript, merges them into
                                                               the local data files and prints the ArtifactData batch writes
     push      -> {js, n}                                      one browser call that posts to Discord and uploads to the ChippyTips site
     pushdone  -> {writes, tipapp, stats}                      records what posted, the run log and the sync hashes
   Read-only apart from files under the data dir and /tmp/fb. */
const RUN = (() => {
const crypto = require("crypto"), os = require("os"), cp = require("child_process");
const FB = path.dirname(DIR.replace(/\/+$/, "")) || "/tmp/fb";
const W = path.join(FB, "w");
const runMode = (m, args = []) => {   // run another engine mode; its output goes through a file because a pipe can cut big outputs short
  fs.mkdirSync(FB, { recursive: true }); const f = path.join(FB, `.mode-${m}-${process.pid}.json`), fd = fs.openSync(f, "w");
  try { cp.execFileSync(process.execPath, [process.argv[1], DIR, m, ...args, NOW.toISOString()], { stdio: ["ignore", fd, "pipe"], maxBuffer: 64e6 }); } finally { fs.closeSync(fd); }
  const out = JSON.parse(fs.readFileSync(f, "utf8")); fs.unlinkSync(f); return out;
};
const COLLECT_BASE = "https://raw.githubusercontent.com/jakealbon/fadeboard-engine/main/collectors/";   // public engine repo, one file per version (named by its hash), so no stale caches and no site deploy needed
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const h5 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 5); };
const slugS = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const brisHour = () => +new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "numeric", hourCycle: "h23" }).format(NOW);
const brisDay = () => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short" }).format(NOW);
const etHour = iso => +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(iso));
const ymd = d => d.replace(/-/g, "");
const dayPlus = n => etDate(new Date(NOW.getTime() + n * 864e5).toISOString());
const LEN = { NFL: 3.5, NCAAF: 3.75, CFL: 3.25, NHL: 3, MLB: 3.25, NBA: 2.5, WNBA: 2.5, NCAAB: 2.25 };
const over = g => g.kickoff && NOW - Date.parse(g.kickoff) > (LEN[g.league] || 3.5) * 36e5;
const VS = { NFL: "NFL", NCAAF: "CFB", CFL: "CFL", NBA: "NBA", NCAAB: "CBB", WNBA: "WNBA", MLB: "MLB", NHL: "NHL" };
const VSL = Object.fromEntries(Object.entries(VS).map(([k, v]) => [v, k]));
const SLP = { NFL: "nfl", NCAAF: "college-football", NBA: "nba", NCAAB: "college-basketball", MLB: "mlb", NHL: "nhl", WNBA: "wnba" };
const SLL = Object.fromEntries(Object.entries(SLP).map(([k, v]) => [v, k]));
const TEAM_CFL = { BC: "BC Lions", CGY: "Calgary Stampeders", EDM: "Edmonton Elks", SSK: "Saskatchewan Roughriders", WPG: "Winnipeg Blue Bombers", HAM: "Hamilton Tiger-Cats", TOR: "Toronto Argonauts", OTT: "Ottawa Redblacks", MTL: "Montreal Alouettes" };
const ESPNL = ["NFL", "NCAAF", "NBA", "WNBA", "NCAAB", "MLB", "NHL"];
const college = lg => lg === "NCAAF" || lg === "NCAAB";

/* ---- the collector bundle and the bootstrap that loads it (hash-checked, so only this exact code runs) ---- */
const BUNDLE = COLLECTJS;
const boot = (fn, plan) => `const s = await (await fetch("${COLLECT_BASE}${sha(BUNDLE).slice(0, 12)}.js", { cache: "no-store" })).text(); const d = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join(""); d !== "${sha(BUNDLE)}" ? "collector mismatch" : ((0, eval)(s), await window.__fb.${fn}(${JSON.stringify(plan)}))`;

/* ---- reading this session's own transcript (tool results land there), so big results never have to be retyped ---- */
function transcriptTexts(){
  const roots = [path.join(os.homedir(), ".claude", "projects")], files = [];
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e){ return; } for (const e of es){ const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(jsonl|txt|json)$/.test(e.name)) files.push(p); } };
  roots.forEach(walk);
  try { for (const f of fs.readdirSync(path.join(FB, "res"))) files.push(path.join(FB, "res", f)); } catch (e){}   // fallback: results saved by hand
  const recent = files.map(f => ({ f, t: fs.statSync(f).mtimeMs })).filter(x => Date.now() - x.t < 6 * 36e5).sort((a, b) => a.t - b.t);
  const texts = [];
  for (const { f } of recent){
    const raw = fs.readFileSync(f, "utf8");
    if (f.endsWith(".jsonl")){ for (const line of raw.split("\n")){ if (!line.includes("FBC1|") && !line.includes("version")) continue; try { const j = JSON.parse(line);
      if (j.type === "assistant" || j.message?.role === "assistant") continue;   // only tool results, never the calls that contain the same markers
      const walkS = o => { if (typeof o === "string") texts.push(o); else if (Array.isArray(o)) o.forEach(walkS); else if (o && typeof o === "object") Object.values(o).forEach(walkS); };
      const pick = o => { if (Array.isArray(o)) o.forEach(pick); else if (o && typeof o === "object"){ if (o.type === "tool_result") walkS(o.content); else Object.values(o).forEach(pick); } };
      pick(j.message); if (j.toolUseResult) walkS(j.toolUseResult); } catch (e){} } }
    else texts.push(raw);
  }
  return texts;
}
function grab(tag, nonce){
  const parts = {}; let n = 0;
  for (const t of transcriptTexts()){
    let i = -1;
    while ((i = t.indexOf("FBC1|" + tag + "|" + nonce + "|", i + 1)) >= 0){
      let s = t.slice(i);
      if (t[i - 1] === '"'){ let j = i, e = false; for (; j < t.length; j++){ const c = t[j]; if (e) e = false; else if (c === "\\") e = true; else if (c === '"') break; } try { s = JSON.parse('"' + t.slice(i, j) + '"'); } catch (x){ continue; } }
      const m = s.match(/^FBC1\|[^|]+\|[^|]+\|(\d+)\/(\d+)\|/); if (!m || s.length <= m[0].length + 1) continue;
      parts[+m[1]] = s.slice(m[0].length).replace(/\n\(\d+ parts: run window\.__fb\.part[^\n]*\)$/, ""); n = +m[2];
    }
  }
  if (!n) return null;
  for (let k = 1; k <= n; k++) if (parts[k] == null) throw new Error(`collector result ${tag} part ${k} of ${n} missing: run window.__fb.part("${tag}", ${k}) in the tab`);
  return JSON.parse(Array.from({ length: n }, (_, k) => parts[k + 1]).join(""));
}
function versions(){   // latest version the tools reported for each collection/doc, from ArtifactData results in the transcript
  const v = {};
  for (const t of transcriptTexts()){
    let m, coll = null;
    const head = t.match(/documents? from collection "([^"]+)"/); if (head) coll = head[1];
    if (coll) for (m of t.matchAll(/- "([^"]+)"\s+\d+ bytes\s+version (\d+)/g)) v[coll + "/" + m[1]] = +m[2];
    for (m of t.matchAll(/(?:set|update|delete) "([^"]+)"\/"([^"]+)" \(version (\d+)\)/g)) v[m[1] + "/" + m[2]] = +m[3];
    for (m of t.matchAll(/Database (?:set|update|str_replace) committed: "([^"]+)"\/"([^"]+)"[\s\S]{0,300}?now at version (\d+)/g)) v[m[1] + "/" + m[2]] = +m[3];
  }
  return v;
}

/* ---- local data files (the run's working copy) ---- */
const docPath = (coll, id) => path.join(DIR, coll, id + ".json");
const readDoc = (coll, id) => { try { const j = JSON.parse(fs.readFileSync(docPath(coll, id), "utf8")); return j.data || j; } catch (e){ return null; } };
const merge = (a, b) => { if (!a || typeof a !== "object" || Array.isArray(a) || !b || typeof b !== "object" || Array.isArray(b)) return b; const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = merge(a[k], v); return o; };
function writePlan(changes, sets = {}){   // changes: {"coll/id": patch} -> local merge + batch entries; sets: {"coll/id": whole doc} replaced outright
  fs.mkdirSync(W, { recursive: true });
  const ver = versions(), entries = [];
  for (const [k, doc] of Object.entries(sets)){
    const [coll, id] = k.split("/"), cur = readDoc(coll, id);
    fs.mkdirSync(path.join(DIR, coll), { recursive: true }); fs.writeFileSync(docPath(coll, id), JSON.stringify(doc));
    const f = path.join(W, `${coll}-${id}.json`); fs.writeFileSync(f, JSON.stringify(doc));
    const e = { op: "set", collection: coll, doc_id: id, file_path: f };
    if (cur){ if (ver[k] == null) e.if_version = "GET"; else e.if_version = ver[k]; }
    entries.push(e);
  }
  for (const [k, patch] of Object.entries(changes)){
    const [coll, id] = k.split("/"), cur = readDoc(coll, id), next = cur ? merge(cur, patch) : patch;
    fs.mkdirSync(path.join(DIR, coll), { recursive: true }); fs.writeFileSync(docPath(coll, id), JSON.stringify(next));
    const f = path.join(W, `${coll}-${id}.json`); fs.writeFileSync(f, JSON.stringify(cur ? patch : next));
    const e = { op: cur ? "update" : "set", collection: coll, doc_id: id, file_path: f };
    if (cur){ if (ver[k] == null) e.if_version = "GET"; else e.if_version = ver[k]; }
    entries.push(e);
  }
  const batches = []; let cur = [], size = 0;
  for (const e of entries){ const sz = fs.statSync(e.file_path).size; if (cur.length >= 50 || size + sz > 900000){ batches.push(cur); cur = []; size = 0; } cur.push(e); size += sz; }
  if (cur.length) batches.push(cur);
  return batches;
}

/* ---- team and game matching ---- */
const NAME2CODE = {};   // "NFL|washington-commanders" -> "WSH"
for (const [k, v] of Object.entries(TEAM_NAMES)){ const [lg, code] = k.split("|"); const s = slugS(v); if (!NAME2CODE[lg + "|" + s]) NAME2CODE[lg + "|" + s] = code; }
const nick = (lg, word) => { const w = slugS(word); if (!w) return null; const hits = [...new Set(Object.entries(TEAM_NAMES).filter(([k, v]) => k.startsWith(lg + "|") && (slugS(v).endsWith("-" + w) || slugS(v) === w)).map(([k]) => k.split("|")[1]))]; return hits.length === 1 ? hits[0] : null; };
const ESPNCODE = { WAS: "WSH" };
const boardCodes = {}; for (const g of games) (boardCodes[g.league] = boardCodes[g.league] || new Set()).add(g.away), boardCodes[g.league].add(g.home);
const canon = (lg, code) => { if (!code) return code; const seen = boardCodes[lg] || new Set(); if (seen.has(code)) return code; for (const c of seen) if (oab(c) === oab(code)) return c; return code; };   // the spelling the board already uses (UTA v UTAH)
function proCode0(lg, cands){
  for (const c of cands){ if (!c) continue; const s = slugS(c); if (NAME2CODE[lg + "|" + s]) return NAME2CODE[lg + "|" + s]; }
  for (const c of cands){ if (!c || /\s/.test(c) || c.length > 5) continue; const a = oab(c.toUpperCase()); if (TEAM_NAMES[lg + "|" + a]) return a; }
  for (const c of cands){ if (!c) continue; const parts = String(c).trim().split(/\s+/); for (let k = 1; k <= Math.min(2, parts.length); k++){ const hit = nick(lg, parts.slice(-k).join(" ")); if (hit) return hit; } }
  return null;
}
const proCode = (lg, cands) => canon(lg, proCode0(lg, cands));
/* college names: VSiN ("Middle Tenn ST Blue Raiders"), SportsLine ("Miss. State") and ESPN ("Mississippi State") all differ, so match on words */
const CTOK = { st: "state", c: "central", w: "western", e: "eastern", n: "north", s: "south", fl: "florida", ga: "georgia", miss: "mississippi", tenn: "tennessee", conn: "connecticut", la: "louisiana", mich: "michigan", so: "southern", intl: "international" };
const CALIAS = [[/\bconnecticut\b/g, "uconn"], [/\bmassachusetts\b/g, "umass"], [/\btexas san antonio\b/g, "utsa"], [/\b(?:louisiana|ul) monroe\b/g, "ul monroe"], [/\bmiami fl\b/g, "miami"], [/\bhawai i\b/g, "hawaii"], [/\bfla\b/g, "florida"]];
const ctoks = x => { let t = String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map(w => CTOK[w] || w).join(" "); for (const [a, b] of CALIAS) t = t.replace(a, b); return t.split(" ").filter(Boolean); };
const cplain = x => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['\u02bb\u2019]/g, "").trim();
function cscore(names, side){   // side: ESPN [abbr, location, displayName, short]
  const loc = ctoks(side[1]), disp = ctoks(side[2]); let best = 0;
  for (const n of names){ const t = ctoks(n); if (!t.length) continue; const set = new Set(t);
    const cover = loc.length && loc.every(w => set.has(w)) || ctoks(side[3]).length && ctoks(side[3]).every(w => set.has(w)) || (side[0] && t.length === 1 && t[0] === String(side[0]).toLowerCase());
    if (!cover) continue; const inter = disp.filter(w => set.has(w)).length; best = Math.max(best, 10 + inter / new Set([...disp, ...t]).size); }
  return best;
}
const cnorm = s => cplain(s).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/st$/, "state");
function collegeHit(board, cands){ const b = cnorm(board); if (!b) return 0; let best = 0; for (const c of cands){ const n = cnorm(c); if (!n) continue; if (n === b) return 3; if (n.startsWith(b) || b.startsWith(n)) best = Math.max(best, 1); } return best; }
const newGames = {};   // created this run: id -> game
const allGames = () => [...games, ...Object.values(newGames)];
function findGame(lg, date, A, H, ko){   // A/H: {code (pro) | names (college)}
  let best = null, bs = 0, tie = false;
  for (const g of allGames()){
    if (g.league !== lg) continue;
    const gd = g.kickoff ? etDate(g.kickoff) : g.date;
    if (gd !== date && !(ko && g.kickoff && Math.abs(Date.parse(g.kickoff) - Date.parse(ko)) < 3 * 36e5)) continue;
    let s;
    if (college(lg)){ const a = collegeHit(g.away, A.names), h = collegeHit(g.home, H.names); if (!a || !h) continue; s = a + h; }
    else { if (oab(g.away) !== oab(A.code) || oab(g.home) !== oab(H.code)) continue; s = 6; }
    if (lg === "MLB" && ko && g.kickoff && Math.abs(Date.parse(g.kickoff) - Date.parse(ko)) > 2 * 36e5) continue;
    if (s > bs){ best = g; bs = s; tie = false; } else if (s === bs) tie = true;
  }
  if (tie && lg === "MLB" && ko){ const c = allGames().filter(g => g.league === lg && g.away === A.code && g.home === H.code && g.kickoff); c.sort((x, y) => Math.abs(Date.parse(x.kickoff) - Date.parse(ko)) - Math.abs(Date.parse(y.kickoff) - Date.parse(ko))); return c[0] || null; }
  return tie ? null : best;
}
function makeGame(lg, date, away, home, ko){
  const hh = lg === "MLB" ? "-" + (ko ? String(etHour(ko)).padStart(2, "0") : "00") : "";
  const id = `${lg}-${date}-${away}-${home}${hh}`, dayId = `${lg}-${date}`;
  if (byId[id]) return byId[id];
  if (newGames[id]) return newGames[id];
  const g = { id, dayId, league: lg, date, away, home, kickoff: ko || null, final: null, sources: [], snaps: [], firstSeen: NOW.toISOString(), _new: true };
  newGames[id] = g; return g;
}

/* ---- the plan ---- */
function ctxJobs(){
  const out = [];
  for (const g of games){
    if (g.final || g.inplay || g.league === "CFL") continue;
    const ko = g.kickoff ? new Date(g.kickoff) : null, hrs = ko ? (ko - NOW) / 36e5 : null;
    if (ko && (hrs < -1 || hrs > 54)) continue;
    if (!ko && (g.date < dayPlus(0) || g.date > dayPlus(2))) continue;
    const c = g.ctx, age = c && c.t ? (NOW - new Date(c.t)) / 36e5 : 999;
    if (c && age < 12 && !(hrs !== null && hrs < 6 && age > 1)) continue;
    if (college(g.league)){ const V = verdictFor(g), hasTip = tipGroups().some(t => t.g && t.g.id === g.id); if (!hasTip && !["side", "total"].some(a => V[a] && ["Strong", "Solid", "Lean"].includes(V[a].rating))) continue; }
    out.push({ key: g.id, league: g.league, away: g.away, home: g.home, kickoff: g.kickoff || null, date: g.date || etDate(g.kickoff), inj: ["NFL", "NBA", "WNBA", "NHL", "NCAAB"].includes(g.league) && hrs !== null && hrs < 48, wx: ["NFL", "NCAAF", "MLB"].includes(g.league) });
  }
  return out.slice(0, 36);
}
const allTips = () => [...tipList, ...vsinList];
function plan(){
  const H = brisHour(), nonce = NOW.getTime().toString(36);
  const soon = games.filter(g => !g.final && g.kickoff && Date.parse(g.kickoff) > NOW - 36e5 && Date.parse(g.kickoff) < NOW.getTime() + 6 * 36e5);
  const toSettle = games.filter(g => !g.final && g.league !== "CFL" && (g.kickoff ? over(g) : g.date < dayPlus(0)) && g.date >= dayPlus(-10));
  const tipsOpen = allTips().filter(t => !t.result && t.kickoff && NOW - Date.parse(t.kickoff) > 3 * 36e5 && Date.parse(t.kickoff) > NOW - 2 * 864e5);
  const why = [];
  if (soon.length) why.push(`${soon.length} games within 6h`);
  if (toSettle.length) why.push(`${toSettle.length} games to settle`);
  if (tipsOpen.length) why.push(`${tipsOpen.length} tips to settle`);
  if (H % 3 === 0) why.push("3-hourly sweep");
  if (H === 13 || H === 14) why.push("daily results");
  if (H === 10) why.push("week-ahead snapshot");
  if (!why.length) return { quiet: true, hour: H, why: "nothing kicks off within 6 hours and nothing to settle" };
  /* VSiN splits: how far ahead this run looks (as before: 12h every run, 30h on 3-hourly runs, the whole week at 10am) */
  const horizon = H === 10 ? 8 : H % 3 === 0 ? 1 : 0, maxD = ymd(dayPlus(horizon + (horizon === 0 ? 1 : 0)));
  const splits = Object.values(VS).map(c => [c, ["DK", "CIRCA"]]);
  /* VSiN Pro Picks: last two days and the next two, skipping what we already have */
  const pk = [];
  /* VSiN Pro Picks: switched off 3 Oct 2026 (about 5% ROI, not worth the run time); VSiN splits stay */
  for (let i = -1; i <= 2; i++){ const d = dayPlus(i); const ids = vsinList.filter(t => t.date === d).map(t => t.result ? h5(t.id + "|done") : h5(t.id)); pk.push([d, ids.join(" ")]); }
  /* ESPN: settlement days, kickoff gaps, today and tomorrow for leagues on the board */
  const es = new Set();
  for (const g of toSettle) if (ESPNL.includes(g.league)) es.add(g.league + "|" + ymd(g.kickoff ? etDate(g.kickoff) : g.date));
  for (const g of games) if (!g.final && !g.kickoff && ESPNL.includes(g.league) && g.date >= dayPlus(0) && g.date <= dayPlus(4)) es.add(g.league + "|" + ymd(g.date));
  for (const g of games) if (!g.final && ESPNL.includes(g.league) && (g.date === dayPlus(0) || g.date === dayPlus(1))) es.add(g.league + "|" + ymd(g.date));
  for (const t of tipsOpen) if (ESPNL.includes(t.league) && !(t.gameId && byId[t.gameId])) es.add(t.league + "|" + ymd(etDate(t.kickoff)));
  if (H === 10) for (let i = 2; i <= 8; i++) for (const lg of ["NFL", "NCAAF"]) es.add(lg + "|" + ymd(dayPlus(i)));   // week-ahead snapshot can add games, so it needs ESPN's names
  const espnL = [...es].map(x => x.split("|")).slice(0, 36);
  /* odds from the Worker */
  const ol = [...new Set(games.filter(g => !g.final && !g.inplay && (() => { const ko = g.kickoff ? Date.parse(g.kickoff) : Date.parse((g.date || "") + "T23:00:00Z"); return ko > NOW - 600e3 && ko < NOW.getTime() + 168 * 36e5; })()).map(g => g.league))].filter(l => l in VS);
  const oHz = H === 10 ? 192 : H % 3 === 0 ? 36 : 12;
  const vplan = { nonce, splits, maxDate: maxD, picks: [] }, siteplan = { nonce, espn: espnL, odds: ol.length ? { hz: oHz, leagues: ol, key: "sb_publishable_mDquQa9SCMxEvO2AefqRgg_eqA4uvxf", token: process.env.FB_TOKEN || "__FB_TOKEN__" } : null, ctx: ctxJobs() };
  /* SportsLine: next 30 hours, fresh games skipped, finished games with open picks rechecked */
  const dates = [ymd(dayPlus(0)), ymd(dayPlus(1))];
  const skip = games.filter(g => g.slAbbr && g.splits?.sl?.t && NOW - Date.parse(g.splits.sl.t) < 5 * 36e5 && g.kickoff && Date.parse(g.kickoff) - NOW > 3 * 36e5).map(g => g.slAbbr);
  const rc = new Map();
  for (const t of tipList) if (!t.result && t.slAbbr && t.kickoff && over({ league: t.league, kickoff: t.kickoff }) && Date.parse(t.kickoff) > NOW - 4 * 864e5 && SLP[t.league]) rc.set(t.slAbbr, SLP[t.league]);
  const known = tipList.filter(t => t.slId && !t.result).map(t => h5(t.tipster + "|" + t.slId));
  const splan = { nonce, paths: Object.values(SLP), dates, skip, recheck: [...rc.entries()].slice(0, 12).map(([a, p]) => [p, a]), known: known.join(" "), cap: 60 };
  return { quiet: false, hour: H, why: why.join(", "), nonce, vsinJs: boot("vsin", vplan), slJs: boot("sl", splan), siteJs: boot("site", siteplan), bundleHash: sha(BUNDLE).slice(0, 12) };
}

/* ---- apply: collector results -> updates ---- */
function apply(nonce){
  const V0 = grab("vsin", nonce), L = grab("sl", nonce), S = grab("site", nonce);
  const V = V0 || S ? { ...(V0 || {}), espn: S?.espn || V0?.espn, odds: S?.odds || V0?.odds, ctx: S?.ctx || V0?.ctx, err: [...(V0?.err || []), ...(S?.err || [])] } : null;
  if (!V && !L) throw new Error("no collector results found in this session for nonce " + nonce);
  const ch = {}, put = (coll, id, patch) => { ch[coll + "/" + id] = merge(ch[coll + "/" + id] || {}, patch); };
  const gput = (g, patch) => { Object.assign(g, merge(g, patch)); put("days", g.dayId, { games: { [g.id]: patch } }); };
  const stats = { vsinGames: {}, slGames: 0, slTips: 0, modelTips: 0, vsinPicks: 0, finals: 0, kickoffs: 0, tipsSettled: 0, ctx: 0, odds: 0, newGames: 0, unmatched: [], errors: [...(V?.err || []), ...(L?.err || [])] };
  const now = NOW.toISOString(), H = brisHour();
  /* ESPN index */
  const ev = {};   // "LG|yyyymmdd" -> [{id, state, done, ko, a:[abbr,loc,disp,short], h:[...], sa, sh}]
  for (const [k, list] of Object.entries(V?.espn || {})) ev[k] = list.map(r => ({ id: r[0], state: r[1], done: !!r[2], ko: r[3] ? new Date(r[3]).toISOString().replace(/\.\d+Z$/, "Z") : null, a: r.slice(4, 8), h: r.slice(8, 12), sa: r[12], sh: r[13] }));
  const espnFor = (lg, date) => ev[lg + "|" + ymd(date)] || [];
  const espnPair = (lg, date, aNames, hNames, ko) => {   // best ESPN event for two teams named any which way
    let best = null, bs = 0;
    for (const e of espnFor(lg, date)){
      if (ko && e.ko && Math.abs(Date.parse(e.ko) - Date.parse(ko)) > 4 * 36e5) continue;
      let s;
      if (college(lg)){ const a = cscore(aNames, e.a), h = cscore(hNames, e.h); if (!a || !h) continue; s = a + h; }
      else { const a = proCode(lg, aNames), h = proCode(lg, hNames); if (!a || !h || oab(proCode(lg, [e.a[0], e.a[2]])) !== oab(a) || oab(proCode(lg, [e.h[0], e.h[2]])) !== oab(h)) continue; s = 30; }
      if (s > bs){ best = e; bs = s; }
    }
    return best;
  };
  const viaEspn = (lg, date, e) => findGame(lg, date, { names: [e.a[1], e.a[3], e.a[0], e.a[2]], code: college(lg) ? null : proCode(lg, [e.a[0], e.a[2]]) }, { names: [e.h[1], e.h[3], e.h[0], e.h[2]], code: college(lg) ? null : proCode(lg, [e.h[0], e.h[2]]) }, e.ko);
  const findEspn = (g) => {
    const list = espnFor(g.league, g.kickoff ? etDate(g.kickoff) : g.date);
    for (const e of list){
      if (college(g.league)){ if (collegeHit(g.away, [e.a[1], e.a[3], e.a[0], e.a[2]]) && collegeHit(g.home, [e.h[1], e.h[3], e.h[0], e.h[2]])) { if (g.league === "MLB" && g.kickoff && e.ko && Math.abs(Date.parse(g.kickoff) - Date.parse(e.ko)) > 2 * 36e5) continue; return e; } }
      else { const a = proCode(g.league, [e.a[0], e.a[2]]), h = proCode(g.league, [e.h[0], e.h[2]]); if (a === g.away && h === g.home){ if (g.league === "MLB" && g.kickoff && e.ko && Math.abs(Date.parse(g.kickoff) - Date.parse(e.ko)) > 2 * 36e5) continue; return e; } }
    }
    return null;
  };
  /* 1. VSiN splits */
  const due = g => { if (!g.kickoff) return true; const hrs = (Date.parse(g.kickoff) - NOW) / 36e5; if (hrs < 0) return false; if (hrs <= 12) return true; if (hrs <= 30) return H % 3 === 0; return H === 10; };
  for (const [k, rows] of Object.entries(V?.splits || {})){
    const [code, book] = k.split("|"), lg = VSL[code], b = book === "DK" ? "dk" : "circa"; if (!lg) continue;
    for (const r of rows){
      const [gc, live, an, hn, as, hs, spA, spH, shA, sbA, tot, oh, ob, mlA, mlH, mhA, mbA] = r;
      if (live) continue;
      const date = `${gc.slice(0, 4)}-${gc.slice(4, 6)}-${gc.slice(6, 8)}`;
      if (date < dayPlus(0)) continue;
      const espnE = lg === "CFL" ? null : espnPair(lg, date, [an, as.replace(/-/g, " ")], [hn, hs.replace(/-/g, " ")]);
      let A, Hh;
      const cfl = n => Object.keys(TEAM_CFL).find(c => collegeHit(TEAM_CFL[c], [n]) || slugS(TEAM_CFL[c]).split("-").some(w => w.length > 3 && slugS(n).split("-").includes(w))) || null;
      if (college(lg)){ A = { names: [an, espnE?.a[1], espnE?.a[3]].filter(Boolean) }; Hh = { names: [hn, espnE?.h[1], espnE?.h[3]].filter(Boolean) }; }
      else { A = { code: lg === "CFL" ? cfl(an) : proCode(lg, [as.replace(/-/g, " "), an]) }; Hh = { code: lg === "CFL" ? cfl(hn) : proCode(lg, [hs.replace(/-/g, " "), hn]) }; if (!A.code || !Hh.code){ stats.unmatched.push(`${code} ${an} @ ${hn}`); continue; } }
      let g = (espnE && viaEspn(lg, date, espnE)) || findGame(lg, date, A, Hh, espnE?.ko);
      if (!g){
        if (b !== "dk") continue;   // only DK creates games
        if (college(lg) && !espnE){ stats.unmatched.push(`${code} ${an} @ ${hn}`); continue; }   // college: only games ESPN lists (FBS / D1), named as ESPN names them
        const ac = college(lg) ? cplain(espnE.a[1]) : A.code, hc = college(lg) ? cplain(espnE.h[1]) : Hh.code;
        g = makeGame(lg, date, ac, hc, espnE?.ko || null);
      }
      if (!due(g) && !g._new) continue;
      const sp = { spreadAwayBets: sbA, spreadAwayHandle: shA, overBets: ob, overHandle: oh, mlAwayBets: mbA, mlAwayHandle: mhA, t: now };
      const snap = { t: now, b, sh: spH, sb: sbA, sm: shA, tl: tot, ob, om: oh, ma: mlA, mb: mbA, mm: mhA };
      const patch = { league: lg, away: g.away, home: g.home, splits: { [b]: sp }, snaps: [...(g.snaps || []), snap].slice(-8), sources: [...new Set([...(g.sources || []), b === "dk" ? "VSiN (DraftKings)" : "VSiN (Circa)"])], updatedAt: now };
      if (g._new){ patch.final = null; patch.firstSeen = g.firstSeen; patch.kickoff = g.kickoff; }
      if (!g.kickoff && espnE?.ko) patch.kickoff = espnE.ko;
      if (b === "dk" && !(g.sources || []).includes("SportsLine")){
        if (spH != null){ patch.spread = { cur: spH }; if (g.spread?.open == null) patch.spread.open = spH; }
        if (tot != null){ patch.total = { cur: tot }; if (g.total?.open == null) patch.total.open = tot; }
        if (mlA != null || mlH != null){ patch.ml = { away: mlA, home: mlH }; if (g.ml?.awayOpen == null) patch.ml.awayOpen = mlA; if (g.ml?.homeOpen == null) patch.ml.homeOpen = mlH; }
      }
      gput(g, patch); stats.vsinGames[lg] = (stats.vsinGames[lg] || 0) + 1;
    }
  }
  /* 2. SportsLine games, model and expert picks */
  const pkey = (who, gid, market, side, line) => [who, gid, market, side, market === "prop" ? String(num(line)) : ""].join("|");   // props: same tipster, game, side and line is the same pick whatever the wording
  const tipIdx = new Map(); for (const t of tipList) tipIdx.set(pkey(t.tipster, t.gameId || t.game, t.market, t.side, t.line), t);
  const tipById = new Map(tipList.map(t => [t.id, t])), slTip = new Map(tipList.filter(t => t.slId).map(t => [t.slId, t]));
  const RES = { WIN: "W", WON: "W", LOSS: "L", LOST: "L", LOSE: "L", PUSH: "P", VOID: "P", CANCELLED: "P", CANCELED: "P" };
  for (const s of L?.games || []){
    const lg = SLL[s.path]; if (!lg || !s.ko) continue;
    const date = etDate(s.ko);
    const A = college(lg) ? { names: [s.a?.[2], s.a?.[1], s.a?.[0]].filter(Boolean) } : { code: proCode(lg, [`${s.a?.[1]} ${s.a?.[3]}`, `${s.a?.[2]} ${s.a?.[3]}`, s.a?.[0], s.a?.[3]]) };
    const Hh = college(lg) ? { names: [s.h?.[2], s.h?.[1], s.h?.[0]].filter(Boolean) } : { code: proCode(lg, [`${s.h?.[1]} ${s.h?.[3]}`, `${s.h?.[2]} ${s.h?.[3]}`, s.h?.[0], s.h?.[3]]) };
    if (!college(lg) && (!A.code || !Hh.code)){ stats.unmatched.push(`SL ${s.abbr}`); continue; }
    const slA = [s.a?.[1], s.a?.[2], `${s.a?.[1]} ${s.a?.[3]}`, `${s.a?.[2]} ${s.a?.[3]}`, s.a?.[0]].filter(Boolean), slH = [s.h?.[1], s.h?.[2], `${s.h?.[1]} ${s.h?.[3]}`, `${s.h?.[2]} ${s.h?.[3]}`, s.h?.[0]].filter(Boolean);
    const espnS = espnPair(lg, date, slA, slH, s.ko);
    let g = (espnS && viaEspn(lg, date, espnS)) || findGame(lg, date, A, Hh, s.ko);
    const started = Date.parse(s.ko) < NOW;
    if (!g){ if (started || (college(lg) && !espnS)) { stats.unmatched.push(`SL ${s.abbr}`); continue; } g = makeGame(lg, date, college(lg) ? cplain(espnS.a[1]) : A.code, college(lg) ? cplain(espnS.h[1]) : Hh.code, s.ko); }
    const patch = { slAbbr: s.abbr };
    if (!started){
      patch.kickoff = s.ko.replace(/\.\d+Z$/, "Z");
      const o = s.o || {};
      if (o.sh){ patch.spread = { cur: o.sh[1] }; if (g.spread?.open == null && o.sh[0] != null) patch.spread.open = o.sh[0]; patch.spreadPrice = { away: o.sa?.[3] ?? null, home: o.sh[3] }; if (g.spreadPrice?.awayOpen == null) patch.spreadPrice.awayOpen = o.sa?.[2] ?? null; if (g.spreadPrice?.homeOpen == null) patch.spreadPrice.homeOpen = o.sh[2]; }
      if (o.ma || o.mh){ patch.ml = { away: o.ma?.[3] ?? null, home: o.mh?.[3] ?? null }; if (g.ml?.awayOpen == null) patch.ml.awayOpen = o.ma?.[2] ?? null; if (g.ml?.homeOpen == null) patch.ml.homeOpen = o.mh?.[2] ?? null; }
      if (o.ov){ patch.total = { cur: o.ov[1] }; if (g.total?.open == null && o.ov[0] != null) patch.total.open = o.ov[0]; patch.totalPrice = { over: o.ov[3], under: o.un?.[3] ?? null }; if (g.totalPrice?.overOpen == null) patch.totalPrice.overOpen = o.ov[2]; if (g.totalPrice?.underOpen == null) patch.totalPrice.underOpen = o.un?.[2] ?? null; }
      if (s.s && (s.s.sp?.away || s.s.ml?.away || s.s.to?.over)){
        const sp = { spreadAwayBets: s.s.sp?.away?.[0] ?? null, spreadAwayHandle: s.s.sp?.away?.[1] ?? null, overBets: s.s.to?.over?.[0] ?? null, overHandle: s.s.to?.over?.[1] ?? null, mlAwayBets: s.s.ml?.away?.[0] ?? null, mlAwayHandle: s.s.ml?.away?.[1] ?? null, t: now };
        patch.splits = { sl: sp };
        patch.snaps = [...(g.snaps || []), { t: now, b: "sl", sh: o.sh?.[1] ?? null, sb: sp.spreadAwayBets, sm: sp.spreadAwayHandle, tl: o.ov?.[1] ?? null, ob: sp.overBets, om: sp.overHandle, ma: o.ma?.[3] ?? null, mb: sp.mlAwayBets, mm: sp.mlAwayHandle }].slice(-8);
      }
      if (s.m){
        const cur = (k, side) => k === "sp" ? (side === "home" ? o.sh?.[1] : o.sa?.[1]) : k === "to" ? o.ov?.[1] : null;
        const mm = (k, label) => { const x = s.m[k]; if (!x || !x[0]) return null; const side = String(x[0]).toLowerCase(), line = k === "sp" ? (cur("sp", side) ?? (side === "home" ? x[4] : x[4] != null ? -x[4] : null)) : k === "to" ? (x[4] ?? cur("to")) : null;
          const team = side === "home" ? g.home : g.away, price = k === "ml" ? (side === "home" ? o.mh?.[3] : o.ma?.[3]) : null;
          const pick = k === "to" ? `${side === "over" ? "Over" : "Under"} ${line}` : k === "sp" ? `${team} ${line > 0 ? "+" : ""}${line}` : `${team} ML`;
          return { pick, side, grade: x[1], prob: x[2], implied: x[3], ...(k !== "ml" ? { line } : {}), ...(price != null ? { price } : {}) }; };
        patch.model = { projAway: s.m.pa, projHome: s.m.ph, spread: mm("sp"), ml: mm("ml"), total: mm("to") };
        for (const [k, mk] of [["spread", "spread"], ["ml", "ml"], ["total", "total"]]){
          const x = patch.model[k]; if (!x || !["A", "B"].includes(x.grade)) continue;
          const id = slugS(`sl-model-${g.away} @ ${g.home}-${mk}`).slice(0, 150), old = tipById.get(id);
          if (old && old.side === x.side && old.result) continue;
          const price = mk === "ml" ? x.price : mk === "spread" ? (x.side === "home" ? o.sh?.[3] : o.sa?.[3]) : (x.side === "over" ? o.ov?.[3] : o.un?.[3]);
          const t = { tipster: `SportsLine model (grade ${x.grade})`, record: `${x.prob}% v ${x.implied}% implied`, kind: "system", book: "SportsLine", league: lg, gameId: g.id, away: g.away, home: g.home, game: `${g.away} @ ${g.home}`, kickoff: patch.kickoff, market: mk, side: x.side, team: null, line: mk === "ml" ? null : x.line, price: price ?? null, units: 1, selection: x.pick, note: `Simulation probability ${x.prob}% v market ${x.implied}%.`, t: now, result: null, slAbbr: s.abbr };
          if (old && old.side === t.side && old.price === t.price && old.line === t.line && old.tipster === t.tipster) continue;
          put("tips", date, { date, tips: { [id]: t } }); stats.modelTips++;
        }
      }
      patch.sources = [...new Set([...(g.sources || []), "SportsLine"])]; patch.updatedAt = now;
      if (g._new){ patch.final = null; patch.firstSeen = g.firstSeen; patch.league = lg; patch.away = g.away; patch.home = g.home; }
      stats.slGames++;
    }
    gput(g, patch);
    for (const p of s.p || []){
      const [slId, who, rec, mname, mdisp, label, odds, book, unit, side0, rstat, note, typ] = p;
      const res = RES[String(rstat || "").toUpperCase()] || null;
      const lab = String(label || "").replace(/\s[+-]\d+$/, "").trim();
      let market = /PlayerProp/i.test(typ) ? "prop" : /TeamTotal/i.test(typ) || /team total/i.test(mdisp) ? "teamtotal" : /spread|run line|puck line/i.test(mname + " " + mdisp) || /Spread/i.test(typ) ? "spread" : /money/i.test(mname + " " + mdisp) || /MoneyLine/i.test(typ) ? "ml" : /total|over/i.test(mname + " " + mdisp) || /OverUnder/i.test(typ) ? "total" : "prop";
      const ou = /\bover\b/i.test(lab) ? "over" : /\bunder\b/i.test(lab) ? "under" : null;
      const side = market === "spread" || market === "ml" ? side0 : ou; if (!side) continue;
      const nums = lab.match(/[+-]?\d+(\.\d+)?/g) || [];
      const line = market === "ml" ? null : market === "spread" ? (+(nums[nums.length - 1] ?? 0)) : nums.length ? +nums[nums.length - 1] : null;
      const tc = side0 === "home" ? g.home : side0 === "away" ? g.away : null;
      const selection = market === "spread" ? (line === 0 ? `${tc} PK` : `${tc} ${line > 0 ? "+" : ""}${line}`) : market === "ml" ? `${tc} ML` : market === "total" ? `${ou === "over" ? "Over" : "Under"} ${line}` : lab;
      const prior = slTip.get(slId) || tipIdx.get(pkey(who, g.id, market, side, line)) || tipIdx.get(pkey(who, `${g.away} @ ${g.home}`, market, side, line));
      if (prior){
        const upd = {};
        if (res && !prior.result){ upd.result = res; upd.settledBy = "SportsLine"; upd.settledAt = now; stats.tipsSettled++; }
        if (!prior.slId){ upd.slId = slId; upd.slAbbr = s.abbr; }
        if (!started && !prior.result && odds != null && prior.price !== odds) upd.price = odds;
        if (Object.keys(upd).length) put("tips", prior.date, { date: prior.date, tips: { [prior.id]: upd } });
        continue;
      }
      if (started && !res) continue;
      const id = slugS(`${who}-${g.away} @ ${g.home}-${market}-${selection}`).slice(0, 150);
      const t = { tipster: who, record: rec || null, kind: "tipster", book: book || null, league: lg, gameId: g.id, away: g.away, home: g.home, game: `${g.away} @ ${g.home}`, kickoff: (s.ko || "").replace(/\.\d+Z$/, "Z"), market, side, team: market === "teamtotal" ? side0 : null, line, price: odds, units: unit || 1, selection, note: note || "", t: now, result: res, ...(res ? { settledBy: "SportsLine", settledAt: now } : {}), slId, slAbbr: s.abbr };
      put("tips", date, { date, tips: { [id]: t } }); tipIdx.set(pkey(who, g.id, market, side, line), { ...t, id, date }); stats.slTips++;
    }
  }
  /* 3. VSiN Pro Picks (tracking only) */
  if (V?.picks){
    fs.mkdirSync(path.join(FB, "vsin"), { recursive: true });
    const f = path.join(FB, "vsin", "res-run.json"); fs.writeFileSync(f, JSON.stringify(Object.values(V.picks).flat()));
    const out = runMode("vsindocs", [f]);
    for (const [d, doc] of Object.entries(out.docs || {})) put("tips", d, { date: d, tips: doc.tips });
    stats.vsinPicks = out.stats;
  }
  /* 4. ESPN: finals, kickoffs, then tips with no board game */
  const finals = {};
  for (const g of allGames()){
    if (g.league === "CFL") continue;
    const e = findEspn(g); if (!e) continue;
    const patch = {};
    if (!g.final && e.done && e.state === "post" && e.sa != null && e.sh != null){ patch.final = { away: e.sa, home: e.sh }; patch.gradedAt = now; stats.finals++; finals[g.id] = patch.final; }
    if (!g.kickoff && e.ko){ patch.kickoff = e.ko; stats.kickoffs++; }
    if (Object.keys(patch).length) gput(g, patch);
  }
  const grade = (t, fa, fh) => { const line = num(t.line);
    if (t.market === "ml") return fa === fh ? "P" : (t.side === "home") === (fh > fa) ? "W" : "L";
    if (t.market === "spread"){ if (line === null) return null; const m = (t.side === "home" ? fh - fa : fa - fh) + line; return m > 0 ? "W" : m < 0 ? "L" : "P"; }
    if (t.market === "total"){ if (line === null) return null; const tot = fa + fh; return tot === line ? "P" : (t.side === "over") === (tot > line) ? "W" : "L"; }
    if (t.market === "teamtotal"){ if (line === null || !t.team) return null; const sc = t.team === "home" ? fh : fa; return sc === line ? "P" : (t.side === "over") === (sc > line) ? "W" : "L"; }
    return null; };
  for (const t of tipList){
    if (t.result || !t.kickoff || !["ml", "spread", "total", "teamtotal"].includes(t.market) || (t.gameId && byId[t.gameId]) || !ESPNL.includes(t.league)) continue;
    if (!over({ league: t.league, kickoff: t.kickoff })) continue;
    const e = findEspn({ league: t.league, kickoff: t.kickoff, date: t.date, away: t.away, home: t.home }); if (!e || !e.done) continue;
    const r = grade(t, e.sa, e.sh); if (!r) continue;
    put("tips", t.date, { date: t.date, tips: { [t.id]: { result: r, settledBy: "ESPN score", settledAt: now } } }); stats.tipsSettled++;
  }
  /* 5. Worker odds (Pinnacle, Circa, Aussie books) */
  if (V?.odds?.status === 200 && V.odds.body && typeof V.odds.body === "object"){
    fs.mkdirSync(path.join(FB, "odds"), { recursive: true }); const files = [];
    for (const [lg, b] of Object.entries(V.odds.body)) if (b && b.t && Date.now() / 1000 - b.t < 6 * 3600){ const f = path.join(FB, "odds", `res-${lg}.json`); fs.writeFileSync(f, JSON.stringify(b)); files.push(f); }
    if (files.length){ const out = runMode("oddsdocs", files);
      for (const [d, doc] of Object.entries(out.docs || {})){ put("days", d, doc); stats.odds += Object.keys(doc.games || {}).length; }
      stats.oddsRemaining = out.remaining; stats.oddsUnmatched = (out.unmatched || []).length; }
  } else if (V?.odds) stats.errors.push("odds fetch: " + JSON.stringify(V.odds).slice(0, 120));
  /* 6. match context */
  if (V?.ctx){ fs.mkdirSync(path.join(FB, "ctx"), { recursive: true }); const f = path.join(FB, "ctx", "res-run.json"); fs.writeFileSync(f, JSON.stringify(V.ctx));
    const out = runMode("ctxdocs", [f]);
    for (const [d, doc] of Object.entries(out)){ put("days", d, doc); stats.ctx += Object.keys(doc.games || {}).length; } }
  /* new games: full day docs or game entries */
  for (const g of Object.values(newGames)){ stats.newGames++; const k = "days/" + g.dayId; if (!readDoc("days", g.dayId)) ch[k] = merge({ league: g.league, date: g.date, games: {} }, ch[k] || {}); }
  const manual = games.filter(g => g.league === "CFL" && !g.final && g.kickoff && over(g)).map(g => ({ id: g.id, dayId: g.dayId, game: `${g.away} @ ${g.home}`, date: etDate(g.kickoff) }));
  const batches = writePlan(ch);
  stats.unmatched = stats.unmatched.slice(0, 15);
  return { batches, manual, stats };
}

/* ---- posting and site uploads: only what changed since the last good upload, in small self-checking browser calls ----
   Each part is plain JSON the run types into the tab as printed; the part checks its own fingerprint first, so a copying
   slip is caught (copy:false) instead of posting garbage. Pinnacle and Aussie prices are left to the site's odds Worker. */
const PART_MAX = 5000, PARTS_MAX = 6;
const r05 = v => typeof v === "number" ? Math.round(v * 20) / 20 : v;
const steamSig = x => JSON.stringify(x, (k, v) => k === "price" ? r05(v) : v);   // small price wobbles don't count as a change
const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
function push(){
  const H = brisHour(), modes = ["plays"]; if (H === 13 || H === 14) modes.push("daily"); if ((H === 13 || H === 14) && brisDay() === "Tue") modes.push("weekly");
  const run = (m, extra = []) => runMode(m, extra);
  const summaries = readDoc("posts", "summaries")?.items || {};
  const msgs = [], marks = {}; let vl = {};
  for (const m of modes){ const o = run(m); for (const x of o.messages || []) if (m === "plays" || !summaries[x.key]) msgs.push({ ...x, mode: m }); if (m === "plays"){ Object.assign(marks, o.markers || {}); vl = o.vlog || {}; } }
  const sync = readDoc("config", "pushsync") || {};
  /* fixtures, game by game, without the Pinnacle/Aussie prices (the Worker fills those) */
  const tf = run("tipfix").docs || {}, fxOld = sync.fxg || {}, fxNew = {}, fxOps = [], seed = { fx: {}, sh: {} };
  for (const [id, d] of Object.entries(tf)) for (const [gid, g] of Object.entries(d.games || {})){
    const slim = { ...g, px: g.px && g.px.dk ? { dk: g.px.dk } : {} }; delete slim.pxT; delete slim.pinT; delete slim.auT;
    const near = Date.parse(g.kickoff || "2100-01-01") < NOW.getTime() + 24 * 3600e3;   // weather and injury notes only count inside a day
    const hk = id + "|" + gid, h = h32(JSON.stringify(slim, (k, v) => k === "info" && !near ? undefined : typeof v === "number" ? r05(v) : v)); fxNew[hk] = h;
    if (!sync.fxg && Date.parse(g.kickoff || "2100-01-01") < NOW.getTime() - 48 * 3600e3){ seed.fx[hk] = h; continue; }   // first run: older games are already on the site
    if (Date.parse(g.kickoff || "2100-01-01") > NOW.getTime() + 4 * 864e5){ if (fxOld[hk]) fxNew[hk] = fxOld[hk]; continue; }   // further out waits until it's within 4 days
    if (fxOld[hk] !== h) fxOps.push({ t: "fx", id, meta: { sport: d.sport, round: d.round, label: d.label, start: d.start }, gid, g: slim, hk, h, ko: g.kickoff || "9" });
  }
  /* Chippy's Best, item by item: live plays added, changed or gone, and newly graded results */
  const steam = run("steam"), sOld = sync.sh || {}, sNew = {}, stOps = [];
  for (const x of steam.items || []){ const k = x.kind === "graded" ? "g|" + x.k : "l|" + x.key, h = h32(steamSig(x)); sNew[k] = h; if (!sync.sh && x.kind === "graded" && (x.d || "") < etDate(new Date(NOW.getTime() - 48 * 3600e3).toISOString())){ seed.sh[k] = h; continue; } if (sOld[k] !== h) stOps.push({ t: "st", x, hk: k, h, ko: x.kind === "graded" ? "z" : x.kickoff || "9" }); }
  for (const k of Object.keys(sOld)) if (k.startsWith("l|") && !sNew[k]) stOps.push({ t: "rm", key: k.slice(2), hk: k, h: null, ko: "0" });
  /* order: posts first, then whatever kicks off soonest */
  fxOps.sort((a, b) => a.ko.localeCompare(b.ko)); stOps.sort((a, b) => (a.t === "rm" ? -1 : 0) - (b.t === "rm" ? -1 : 0) || a.ko.localeCompare(b.ko));
  const rest = [...stOps.filter(o => o.t !== "rm"), ...fxOps].sort((a, b) => a.ko.localeCompare(b.ko));   // plays and fixtures together, soonest first, results last
  const ops = [...msgs.map((m, i) => ({ t: "msg", i, c: m.content })), ...stOps.filter(o => o.t === "rm"), ...rest];
  const parts = []; let cur = [], len = 0, held = 0;
  for (const o of ops){
    const wire = o.t === "msg" ? { m: o.c } : o.t === "rm" ? { r: o.key } : o.t === "st" ? { s: o.x } : { f: o.id, d: o.meta, k: o.gid, g: o.g };
    const n = JSON.stringify(wire).length;
    if (cur.length && len + n > PART_MAX){ parts.push(cur); cur = []; len = 0; }
    if (parts.length >= PARTS_MAX){ held++; continue; }   // the rest goes next hour (hashes stay old, so it's resent)
    cur.push({ o, wire }); len += n;
  }
  if (cur.length && parts.length < PARTS_MAX) parts.push(cur);
  const hook = process.env.FB_HOOK || "__FB_HOOK__", token = process.env.FB_TOKEN || "__FB_TOKEN__", nonce = NOW.getTime().toString(36);
  fs.mkdirSync(FB, { recursive: true });
  for (const f of fs.readdirSync(FB)) if (/^push-\d+\.js$/.test(f)) fs.unlinkSync(path.join(FB, f));
  const files = parts.map((p, k) => {
    const W = p.map(x => x.wire), tag = "p" + (k + 1), body = JSON.stringify(W);
    const js = [`const W = ${body};`,
      `const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };`,
      `const tag = "FBC1|${tag}|${nonce}|1/1|";`,
      `if (h32(JSON.stringify(W)) !== "${h32(body)}") tag + JSON.stringify({ copy: false });`,
      `else { const out = { copy: true, r: [] }, wait = ms => new Promise(r => setTimeout(r, ms));`,
      ` const sb = (fn, b) => fetch("https://nnlhyjxsgtyuygevhwta.supabase.co/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: "sb_publishable_mDquQa9SCMxEvO2AefqRgg_eqA4uvxf", "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status).catch(() => 0);`,
      ` const post = c => fetch("${hook}?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Chippy Tips", content: c }) });`,
      ` const fx = {}, up = [], rm = [];`,
      ` for (const w of W){ if (w.m){ let r = await post(w.m).catch(() => null); if (r && r.status === 429){ const j = await r.json().catch(() => ({})); await wait(((j.retry_after || 2) * 1000) + 200); r = await post(w.m).catch(() => null); } out.r.push(r ? r.status : 0); await wait(1500); }`,
      `   else if (w.f){ const d = fx[w.f] = fx[w.f] || { ...w.d, games: {} }; d.games[w.k] = w.g; } else if (w.s) up.push(w.s); else if (w.r) rm.push(w.r); }`,
      ` out.fx = Object.keys(fx).length ? await sb("push_fixture_games", { p_token: "${token}", p_docs: fx }) : null;`,
      ` out.st = up.length || rm.length ? await sb("push_feed_diff", { p_token: "${token}", p_name: "steam", p_up: up, p_rm: rm }) : null;`,
      ` tag + JSON.stringify(out); }`].join("\n");
    const file = path.join(FB, `push-${k + 1}.js`); fs.writeFileSync(file, js); return file;
  });
  fs.writeFileSync(path.join(FB, "push-state.json"), JSON.stringify({ nonce, msgs: msgs.map(m => ({ key: m.key, mode: m.mode })), marks, vlog: vl,
    parts: parts.map(p => p.map(x => ({ t: x.o.t, i: x.o.i, hk: x.o.hk, h: x.o.h, id: x.o.id }))), fxKeep: Object.keys(tf), sNew, seed }));
  return { nonce, parts: parts.length, files, messages: msgs.length, fixtureGames: fxOps.length, steamChanges: stOps.length, heldForNextHour: held, chars: parts.map(p => p.reduce((a, x) => a + JSON.stringify(x.wire).length, 0)) };
}
function pushdone(nonce){
  let st = { msgs: [], marks: {}, vlog: {}, parts: [] }; try { st = JSON.parse(fs.readFileSync(path.join(FB, "push-state.json"), "utf8")); } catch (e){}
  const now = NOW.toISOString(), ch = {};
  const put = (coll, id, patch) => { ch[coll + "/" + id] = merge(ch[coll + "/" + id] || {}, patch); };
  const sync = readDoc("config", "pushsync") || {}, fxg = { ...(sync.fxg || {}) }, sh = { ...(sync.sh || {}) };
  const msgOk = {}, res = [], fxDocs = new Set();
  if (st.nonce === nonce && st.seed){ Object.assign(fxg, st.seed.fx || {}); Object.assign(sh, st.seed.sh || {}); }
  if (nonce !== "none" && st.nonce === nonce) st.parts.forEach((p, k) => {
    let R = null; try { R = grab("p" + (k + 1), nonce); } catch (e){}
    res.push(R ? (R.copy ? { fx: R.fx, st: R.st, d: R.r } : "copy slip") : "missing");
    if (!R || !R.copy) return;
    let mi = 0;
    for (const o of p){
      if (o.t === "msg"){ const s = R.r[mi++]; if (s === 200 || s === 204) msgOk[o.i] = true; }
      else if (o.t === "fx"){ if (R.fx === 200){ fxg[o.hk] = o.h; fxDocs.add(o.id); } }
      else if (R.st === 200){ if (o.h) sh[o.hk] = o.h; else delete sh[o.hk]; }
    }
  });
  let posted = 0;
  st.msgs.forEach((m, i) => { if (!msgOk[i]) return; posted++;
    if (m.mode === "plays"){ for (const [d, items] of Object.entries(st.marks)) if (items[m.key]) put("posts", d, { date: d, items: { [m.key]: items[m.key] } }); }
    else put("posts", "summaries", { items: { [m.key]: { t: now } } }); });
  for (const [d, o] of Object.entries(st.vlog || {})) put("vlog", d, readDoc("vlog", d) ? { items: o.items } : o);
  /* forget fixture weeks and plays that are no longer produced, so the record stays small */
  const keep = new Set(st.fxKeep || []); for (const k of Object.keys(fxg)) if (!keep.has(k.split("|")[0])) delete fxg[k];
  if (st.sNew) for (const k of Object.keys(sh)) if (k.startsWith("g|") && !st.sNew[k]) delete sh[k];
  const ns = { ...sync, t: now, fxg, sh }; delete ns.fx; delete ns.steam;
  const rf = readDoc("config", "refresh") || {}; put("config", "refresh", { last: now, runs: [...(rf.runs || []), now].slice(-40), browser: true });
  const batches = writePlan(ch, { "config/pushsync": ns });
  /* the tipping app's own copy of the fixtures (a separate artifact): whole weeks that changed */
  const tipapp = []; const ver = versions(), tf = fxDocs.size ? runMode("tipfix").docs || {} : {};
  for (const id of fxDocs){ const d = tf[id]; if (!d) continue; const f = path.join(W, `fixtures-${id}.json`); fs.writeFileSync(f, JSON.stringify(d)); const e = { op: "set", collection: "fixtures", doc_id: id, file_path: f }; if (ver["fixtures/" + id]) e.if_version = ver["fixtures/" + id]; tipapp.push(e); }
  return { batches, tipapp, stats: { posted, of: st.msgs.length, parts: res } };
}
return { plan, apply, push, pushdone, grab, versions };
})();
if (MODE === "plan"){ process.stdout.write(JSON.stringify(RUN.plan(), null, 1)); process.exit(0); }
if (MODE === "apply"){ process.stdout.write(JSON.stringify(RUN.apply(process.argv[4]), null, 1)); process.exit(0); }
if (MODE === "push"){ process.stdout.write(JSON.stringify(RUN.push(), null, 1)); process.exit(0); }
if (MODE === "pushdone"){ process.stdout.write(JSON.stringify(RUN.pushdone(process.argv[4]), null, 1)); process.exit(0); }
if (MODE === "versions"){ process.stdout.write(JSON.stringify(RUN.versions(), null, 1)); process.exit(0); }

const messages = [], markers = {}, vlog = {};
const mark = (date, key, body) => { (markers[date] = markers[date] || {})[key] = { ...body, t: NOW.toISOString() }; };
if (MODE === "steam"){   // Chippy's Best for the ChippyTips website: board verdicts (all) + tipster consensus (2+), {items:[...], t}
  const items = [];
  const quotes = (g, mk, dir, line) => {
    if (!g || !["spread", "total", "ml"].includes(mk)) return { au: null, pin: null };
    const au = auQuotes(g, mk, dir, mk === "ml" ? null : line)[0] || null, pq = g.pin?.c ? bookQuote(g.pin.c, mk, dir) : null;
    return { au: au ? { book: au.name, line: au.line, price: +au.price.toFixed(3) } : null, pin: pq ? { line: pq.line, price: +pq.price.toFixed(3) } : null };
  };
  for (const g of games){
    if (!g.kickoff || g.final || g.inplay || new Date(g.kickoff) <= NOW) continue;
    const V = verdictFor(g);
    for (const axis of ["side", "total"]){
      const v = V[axis]; if (!v || !["Strong", "Solid", "Lean"].includes(v.rating)) continue;
      items.push({ kind: "verdict", key: `best|${g.id}|${axis}|${v.dir}`, league: g.league, gameId: g.id, away: g.away, home: g.home,
        awayName: fullName(g.league, g.away), homeName: fullName(g.league, g.home), kickoff: g.kickoff,
        rating: v.rating, stake: v.stake || 1, market: v.mk, side: v.dir, line: v.mk === "ml" ? null : v.line,
        label: v.label, price: dec(num(v.price)) ? +dec(num(v.price)).toFixed(3) : null,
        why: (v.why || []).slice(0, 4), steam: !!v.steam, steamTxt: v.steam && typeof v.steam === "object" ? (v.steam.txt || "") : "",
        ...quotes(g, v.mk, v.dir, v.line) });
    }
  }
  for (const t of tipGroups()){
    if (t.n < 2 || !t.kickoff || new Date(t.kickoff) <= NOW) continue;
    if (!consOk(t, null)) continue;
    const f = t.f, g = t.g;
    let agrees = null;
    if (g && ["spread", "total", "ml"].includes(f.market)){
      const V = verdictFor(g)[f.market === "total" ? "total" : "side"];
      if (V && V.dir !== f.side && (V.rating === "Strong" || V.rating === "Solid" || V.rating === "Split")) continue;
      if (V && V.dir === f.side && ["Strong", "Solid", "Lean"].includes(V.rating)) agrees = V.rating;
    }
    const wt = worstTip(t.tips, f.side), line = (wt ? num(wt.line) : null) ?? (g && f.market === "spread" ? (f.side === "home" ? num(g.spread?.cur) : -num(g.spread?.cur)) : g && f.market === "total" ? num(g.total?.cur) : null);
    items.push({ kind: "consensus", key: `tips|${t.key}`, league: f.league, gameId: g?.id || null, away: g?.away || f.away || "", home: g?.home || f.home || "",
      awayName: g ? fullName(g.league, g.away) : "", homeName: g ? fullName(g.league, g.home) : "", game: f.game || "", kickoff: t.kickoff,
      n: t.n, opp: oppInfo(t).n, oppNames: oppInfo(t).names.slice(0, 6), names: t.names.slice(0, 8), stake: consStake(t), market: f.market, side: f.side, line, label: wt ? wt.selection : f.selection,
      price: +t.dec.toFixed(3), agrees,
      notes: t.tips.slice(0, 4).map(tp => ({ who: tp.tipster, rec: tp.record || "", note: String(tp.note || "").slice(0, 160) })),
      ...quotes(g, f.market, f.side, line) });
  }
  items.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  /* graded results, worked out exactly as the Fade Board's Strategy tab does (board verdicts on every graded game, and 2+ tipster
     groups at the group stake), so the website and the board agree. v:2 marks this method; the website ignores older rows. */
  const SK = { Strong: "strong", Solid: "solid", Lean: "lean" };
  const tipRes = (t, g) => { if (t.result) return t.result; if (!g || !graded(g)) return null;
    const a = +g.final.away, h = +g.final.home, line = num(t.line);
    if (t.market === "ml"){ if (a === h) return "P"; return (t.side === "home") === (h > a) ? "W" : "L"; }
    if (t.market === "spread"){ if (line === null) return null; const m = (t.side === "home" ? h - a : a - h) + line; return m > 0 ? "W" : m < 0 ? "L" : "P"; }
    if (t.market === "total"){ if (line === null) return null; const tot = a + h; if (tot === line) return "P"; return (t.side === "over") === (tot > line) ? "W" : "L"; }
    if (t.market === "teamtotal"){ if (line === null || !t.team) return null; const sc = t.team === "home" ? h : a; if (sc === line) return "P"; return (t.side === "over") === (sc > line) ? "W" : "L"; }
    return null; };
  const gName = g => `${g.away} @ ${g.home}`, gScore = g => graded(g) ? `${g.final.away}-${g.final.home}` : "";
  for (const g of games){
    if (!graded(g) || g.preseason || g.inplay) continue;
    const V = verdictFor(g);
    for (const axis of ["side", "total"]){
      const x = V[axis]; if (!x || !SK[x.rating]) continue;
      const r = grade(g, x.mk, { fade: x.dir, fadeLine: x.mk === "ml" ? x.price : x.line }); if (!r) continue;
      const d = dec(num(x.price)) || 1.91, st = x.stake || 1;
      items.push({ kind: "graded", v: 2, k: `v|${g.id}|${axis}`, s: SK[x.rating], d: etDate(g.kickoff || g.date + "T16:00:00Z"), kick: g.kickoff || null, r,
        u: +(r === "W" ? (d - 1) * st : r === "L" ? -st : 0).toFixed(3), st, sel: x.label || "", pr: +d.toFixed(3), lg: g.league, game: gName(g), sc: gScore(g) });
    }
  }
  { const mp = new Map(); for (const t of tipList){ const k = tipKey(t); if (!mp.has(k)) mp.set(k, []); mp.get(k).push(t); }
    for (const [key, ts] of mp){
      const f = ts[0], n = new Set(ts.map(t => t.tipster)).size, sys = ts.filter(t => t.kind === "system").length;
      if (n < 2 || sys === n || ts.every(t => /^SportsLine model/i.test(t.tipster))) continue;
      const g = tipGame(f), lines = ts.map(x => num(x.line)).filter(x => x !== null);
      const wt = worstTip(ts, f.side); let line = wt ? num(wt.line) : null; const selW = wt ? wt.selection : f.selection;
      if (line === null && g){ if (f.market === "spread"){ const c = num(g.spread?.cur); if (c !== null) line = f.side === "home" ? c : -c; } else if (f.market === "total"){ const c = num(g.total?.cur); if (c !== null) line = c; } }
      const r = ts.find(x => x.result)?.result || tipRes({ ...f, line }, g); if (!["W", "L", "P"].includes(r)) continue;
      const decs = ts.map(x => dec(num(x.price))).filter(Boolean), d = decs.length ? decs.reduce((a, b) => a + b, 0) / decs.length : 1.91, st = 1 + 0.5 * (n - 1);
      const kick = g?.kickoff || f.kickoff || null;
      items.push({ kind: "graded", v: 2, k: "c|" + key, s: "cons", d: kick ? etDate(kick) : f.date, kick, r, u: +(r === "W" ? (d - 1) * st : r === "L" ? -st : 0).toFixed(3), st,
        sel: selW || "", pr: +d.toFixed(3), lg: f.league || g?.league || "", game: g ? gName(g) : (f.game || ""), sc: g ? gScore(g) : "", who: [...new Set(ts.map(t => t.tipster))].slice(0, 6).join(", ") });
    }
  }
  process.stdout.write(JSON.stringify({ items, t: NOW.toISOString() }));
  process.exit(0);
}
if (MODE === "board"){   // the board's own records, slimmed, for the website copy: only what changed since the last upload
  const cut = new Date(NOW.getTime() - 3 * 864e5).toISOString(), until = new Date(NOW.getTime() + 8 * 864e5).toISOString();
  const today3 = etDate(cut);
  const FULL = process.argv.includes("full");
  let prev = {}; if (!FULL) try { const f = path.join(DIR, "config", "boardsync.json"); if (fs.existsSync(f)){ const j = JSON.parse(fs.readFileSync(f, "utf8")); prev = (j.data || j).h || {}; } } catch (e){}
  const hash = o => { const str = JSON.stringify(o); let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const outG = {}, outT = {}, outP = {}, hashes = {};
  for (const [dayId, d] of Object.entries(days)) for (const [id, g0] of Object.entries(d.games || {})){
    if (!g0) continue;
    const ko = g0.kickoff || (d.date ? d.date + "T16:00:00Z" : null); if (!ko || ko < cut || ko > until) continue;
    const g = { ...g0, dayId, league: g0.league || d.league, date: d.date };
    if (Array.isArray(g.snaps)) g.snaps = g.snaps.slice(-3);
    if (g.pin && Array.isArray(g.pin.h)) g.pin = { ...g.pin, h: g.pin.h.slice(-6) };
    const h = hash(g); hashes["g:" + id] = h; if (prev["g:" + id] !== h) outG[id] = g;
  }
  for (const [date, d] of Object.entries(tipDocs)){
    if (date < today3) continue;
    for (const [id, t] of Object.entries(d.tips || {})){ if (!t) continue; const o = { ...t, date }; const h = hash(o); hashes["t:" + id] = h; if (prev["t:" + id] !== h) outT[id] = o; }
  }
  for (const [date, d] of Object.entries(postDocs)){
    if (!/^\d{4}-/.test(date) || date < today3) continue;
    const o = { date, items: d.items || {} }; const h = hash(o); hashes["p:" + date] = h; if (prev["p:" + date] !== h) outP[date] = o;
  }
  const rules = cfg.rules || null, rh = hash(rules); hashes.rules = rh;
  if (FULL){   // whole board as the website reads it: {days:{dayId:{league,date,games}}, tips:{date:{date,tips}}, posts, rules, refresh, t}
    const D = {}, T = {};
    for (const [id, g] of Object.entries(outG)){ const { dayId, ...rest } = g; const d = D[dayId] = D[dayId] || { league: g.league, date: g.date, games: {} }; d.games[id] = rest; }
    for (const [id, t] of Object.entries(outT)){ const d = T[t.date] = T[t.date] || { date: t.date, tips: {} }; d.tips[id] = t; }
    process.stdout.write(JSON.stringify({ days: D, tips: T, posts: outP, rules, refresh: cfg.refresh || null, t: NOW.toISOString(), n: { games: Object.keys(outG).length, tips: Object.keys(outT).length } }));
    process.exit(0);
  }
  /* split into chunks of about 45KB so each upload stays small */
  const chunks = []; let cur = { games: {}, tips: {}, posts: {} }, size = 0;
  const add = (k, id, o) => { const n = JSON.stringify(o).length; if (size && size + n > 45000){ chunks.push(cur); cur = { games: {}, tips: {}, posts: {} }; size = 0; } cur[k][id] = o; size += n; };
  for (const [id, g] of Object.entries(outG)) add("games", id, g);
  for (const [id, t] of Object.entries(outT)) add("tips", id, t);
  for (const [id, p] of Object.entries(outP)) add("posts", id, p);
  if (size) chunks.push(cur);
  process.stdout.write(JSON.stringify({ chunks, meta: { rules, refresh: cfg.refresh || null }, sync: { h: hashes, t: NOW.toISOString() }, n: { games: Object.keys(outG).length, tips: Object.keys(outT).length, posts: Object.keys(outP).length, chunks: chunks.length } }));
  process.exit(0);
}
if (MODE === "plays"){
  for (const g of games){
    if (!upcoming(g)) continue;
    const V = verdictFor(g);
    for (const axis of ["side", "total"]){
      const v = V[axis]; if (!v) continue;
      if (!(v.rating === "Strong" || v.rating === "Solid") || (v.stake || 1) < 1) continue;   // Discord gets plays of 1 nut or more only
      const key = `best|${g.id}|${axis}|${v.dir}`;
      const RANK = { Lean: 1, Solid: 2, Strong: 3 }, prev = posted[key];
      if (prev && (RANK[v.rating] || 0) <= (RANK[prev.rating] || 0)) continue;   // already posted at this level or higher
      const prevOpp = Object.keys(posted).find(k => k.startsWith(`best|${g.id}|${axis}|`) && k !== key);
      const up = prev ? `⬆️ **Upgraded** from ${prev.rating || "Lean"} to ${v.rating}\n` : "";
      messages.push({ key, content: up + verdictMsg(g, { ...v, stake: v.stake || 1 }, prevOpp ? posted[prevOpp].selection : null) });
      mark(etDate(g.kickoff), key, { type: "best", gameId: g.id, league: g.league, market: v.mk, side: v.dir, line: v.line, price: v.price, stake: v.stake || 1, ml: null, selection: v.label, rating: v.rating, steam: !!v.steam });
    }
  }
  /* Pinnacle move alerts: switched off as posts of their own (3 Oct 2026, Jake: only plays of 1 nut or more). The move still
     feeds the board's verdicts and the steam flag on plays. */
  if (false) for (const g of games){
    if (!upcoming(g) || !g.pin || !g.pin.c || !g.pin.t || NOW / 1000 - g.pin.t > 3 * 3600) continue;
    for (const axis of ["side", "total"]){
      const mkKeys = Object.keys(posted).filter(k => k.startsWith(`pin|${g.id}|${axis}|`)).sort((a, b) => (posted[a].t || "").localeCompare(posted[b].t || ""));
      const lastM = mkKeys.length ? posted[mkKeys[mkKeys.length - 1]] : null;
      const base = lastM && lastM.arr ? lastM.arr : g.pin.o;
      const pm = pinMove(g, axis, base, true); if (!pm) continue;
      const key = `pin|${g.id}|${axis}|${g.pin.t}`;
      if (posted[key]) continue;
      const V = verdictFor(g)[axis], sig = signal(g, pm.mk === "ml" ? "ml" : pm.mk, "dk");
      const q = bookQuote(g.pin.c, pm.mk, pm.dir), lab = pm.mk === "ml" ? `${g[pm.dir]} ML` : pm.mk === "spread" ? `${g[pm.dir]} ${fmtLine(q ? q.line : null)}` : `${pm.dir === "over" ? "Over" : "Under"} ${q ? q.line : ""}`;
      const lines = [`📈 **PINNACLE MOVE** · ${LG_EMOJI[g.league] || ""} ${g.league}`, `**${pm.txt}** · money on **${lab}**${q ? ` (now ${q.price.toFixed(2)})` : ""}`, `${g.away} @ ${g.home} · ${bris(g.kickoff)}`];
      const au = auQuotes(g, pm.mk, pm.dir, q ? q.line : null);
      if (au.length){ const old = au.filter(x => x.edge > 0); lines.push(`🇦🇺 ${auLine(g, pm.mk, pm.dir, q ? q.line : null)}${old.length ? ` · ⏳ ${old.map(x => x.name).join(", ")} still on the old number` : ""}`); }
      if (sig) lines.push(`• DraftKings tickets: ${sig.pub === pm.dir ? sig.pubBets : 100 - sig.pubBets}% on this side${sig.pub !== pm.dir && sig.pubBets >= 55 ? " (against the public)" : ""}`);
      if (V && V.rating !== "None") lines.push(`• Board verdict: ${RATING_TXT[V.rating] || V.rating} ${V.label}${V.dir === pm.dir ? " (same side)" : " (other side)"}`);
      messages.push({ key, content: lines.join("\n") });
      mark(etDate(g.kickoff), key, { type: "pin", gameId: g.id, league: g.league, market: pm.mk, side: pm.dir, line: q ? q.line : null, price: q ? q.price : null, selection: lab, arr: g.pin.c, txt: pm.txt });
    }
  }
  for (const t of tipGroups()){
    const key = `tips|${t.key}`, prev = posted[key];
    if (!prev || !t.kickoff || new Date(t.kickoff) <= NOW || posted["split|" + t.key]) continue;
    const o = oppInfo(t); if (o.n < t.n) continue;
    messages.push({ key: "split|" + t.key, content: `⚖️ **SPLIT CALL** · ${LG_EMOJI[t.f.league] || ""} ${t.f.league}\n**${prev.selection || t.f.selection}** is now ${t.n} v ${o.n} tipsters (${o.names.join(", ")} on the other side).\n${t.f.game} · ${bris(t.kickoff)}\n${o.n > t.n ? "The majority has moved to the other side, so this one is withdrawn: pass if you haven't bet it." : "No edge either way now: pass if you haven't bet it."}` });
    mark(etDate(t.kickoff), "split|" + t.key, { type: "split", gameId: t.g?.id || null, groupKey: t.key, n: t.n, opp: o.n });
  }
  for (const t of tipGroups()){
    if (t.n < 2 || !t.kickoff || new Date(t.kickoff) <= NOW) continue;
    if (!consOk(t, posted)) continue;
    const key = `tips|${t.key}`, prev = posted[key];
    if (prev && prev.n >= t.n) continue;
    if (t.g && ["spread", "total", "ml"].includes(t.f.market)){
      const V = verdictFor(t.g)[t.f.market === "total" ? "total" : "side"];
      if (V && V.dir !== t.f.side && (V.rating === "Strong" || V.rating === "Solid" || V.rating === "Split")) continue;
    }
    messages.push({ key, content: tipMsg(t, prev ? prev.n : 0) });
    const f = t.f;
    mark(etDate(t.kickoff), key, { type: "tips", gameId: t.g?.id || null, groupKey: t.key, league: f.league, market: f.market, side: f.side, team: f.team || null, line: num(f.line) ?? (t.g && f.market === "spread" ? (f.side === "home" ? num(t.g.spread?.cur) : -num(t.g.spread?.cur)) : t.g && f.market === "total" ? num(t.g.total?.cur) : null), price: num(f.price) ?? -110, stake: consStake(t), ml: null, n: t.n, opp: oppInfo(t).n, selection: f.selection });
  }
  /* timing log: verdicts on every game up to 7 days out. Every run inside 6 hours of kickoff, every 2 hours inside a day,
     every 6 hours further out, and one doc per date, league and market so busy days stay under the size limit */
  const mkey = k => String(k).replace(/[.\/$#\[\]]/g, "_");
  const stamp = "m" + Math.floor(NOW.getTime() / 60000), hourUtc = NOW.getUTCHours();
  for (const g of games){
    if (!g.kickoff || g.final || g.inplay) continue;
    const hrs = (new Date(g.kickoff) - NOW) / 36e5; if (hrs <= 0 || hrs > 168) continue;
    if ((hrs > 24 && hourUtc % 6 !== 0) || (hrs > 6 && hrs <= 24 && hourUtc % 2 !== 0)) continue;
    const V = verdictFor(g), date = etDate(g.kickoff);
    for (const axis of ["side", "total"]){
      const v = V[axis]; if (!v) continue;
      const id = `${date}-${g.league}-${axis}`;
      const doc = vlog[id] = vlog[id] || { date, league: g.league, axis, items: {} };
      (doc.items[mkey(`${g.id}|${axis}`)] = {})[stamp] = { h: +hrs.toFixed(2), r: v.rating, d: v.dir, mk: v.mk, s: v.score, p: v.price, l: v.line, st: v.steam ? 1 : 0 };
    }
  }
} else if (MODE === "sheet"){
  /* rows for the Google Sheet: every tip and every posted play, with results */
  const dd = v => { const d = dec(num(v)); return d === null ? "" : +d.toFixed(2); };
  const bDate = iso => iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : "";
  const bTime = iso => iso ? new Date(iso).toLocaleTimeString("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  const MKN = { ml: "Moneyline", spread: "Spread", total: "Total", teamtotal: "Team total", prop: "Player prop" };
  const groupN = {}; for (const t of tipList){ const k = tipKey(t); (groupN[k] = groupN[k] || new Set()).add(t.tipster); }
  const tipsRows = tipList.map(t => {
    const g = tipGame(t), ko = g?.kickoff || t.kickoff;
    let line = num(t.line);
    if (line === null && g && t.market === "spread" && num(g.spread?.cur) !== null) line = t.side === "home" ? num(g.spread.cur) : -num(g.spread.cur);
    if (line === null && g && t.market === "total") line = num(g.total?.cur);
    const r = t.result || gradeMarker({ market: t.market, side: t.side, team: t.team, line, gameId: g?.id, groupKey: tipKey(t) });
    const d = dec(num(t.price)) ?? 1.91, u = num(t.units) || 1;
    const pl = r === "W" ? +((d - 1) * u).toFixed(2) : r === "L" ? -u : r === "P" ? 0 : "";
    const model = /^SportsLine model/i.test(t.tipster);
    return [bDate(ko) || t.date, bTime(ko), t.league || "", t.game || "", t.tipster || "", model ? "Model" : t.kind === "system" ? "System" : "Tipster", MKN[t.market] || t.market || "", t.selection || "", line === null ? "" : line, dd(t.price), u, groupN[tipKey(t)].size, r || (g && graded(g) ? "Check" : "Open"), pl, t.book || "", t.record || "", t.id];
  }).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const TY = { best: "Board verdict", fade: "Fade the public", circa: "Follow Circa", tips: "Tipster consensus" };
  const playRows = Object.entries(posted).map(([k, m]) => {
    const g = byId[m.gameId], r = gradeMarker(m), ko = g?.kickoff;
    return [bDate(ko) || m.date, bTime(ko), m.league || g?.league || "", g ? `${g.away} @ ${g.home}` : "", TY[m.type] || m.type, m.rating || (m.n ? `${m.n} tipsters` : ""), m.selection || "", dd(m.price), m.stake + (m.ml ? m.ml.stake : 0), r || "Open", r ? +markerUnits(m, r).toFixed(2) : "", bDate(m.t) + " " + bTime(m.t), k];
  }).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  /* Summary tab: formulas over the Tips (A:Q) and Board plays (A:M) tabs */
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const sum = [["Fade Board: tips and results", "", "", "", "", "", "", "", ""], [`Updated ${bDate(NOW.toISOString())} ${bTime(NOW.toISOString())} Brisbane. Profit in units at the tipster's price; Open = not settled yet, Check = game over but result not found yet.`, "", "", "", "", "", "", "", ""], []];
  const hdr = ["", "Bets", "W", "L", "P", "Win %", "Units", "ROI", "Open"];
  const block = (title, items, tab, resCol, unitCol, stakeCol) => {
    sum.push([title, ...hdr.slice(1)]);
    for (const [name, crit] of items){
      const r = sum.length + 1, c = crit ? crit + "," : "";
      const ci = x => `COUNTIFS(${c}'${tab}'!$${resCol}:$${resCol},"${x}")`;
      const st = `(SUMIFS('${tab}'!$${stakeCol}:$${stakeCol},${c}'${tab}'!$${resCol}:$${resCol},"W")+SUMIFS('${tab}'!$${stakeCol}:$${stakeCol},${c}'${tab}'!$${resCol}:$${resCol},"L")+SUMIFS('${tab}'!$${stakeCol}:$${stakeCol},${c}'${tab}'!$${resCol}:$${resCol},"P"))`;
      sum.push([name, `=C${r}+D${r}+E${r}`, `=${ci("W")}`, `=${ci("L")}`, `=${ci("P")}`, `=IFERROR(C${r}/(C${r}+D${r}),"")`, `=ROUND(SUMIFS('${tab}'!$${unitCol}:$${unitCol}${crit ? "," + crit : ""}),2)`, `=IFERROR(G${r}/${st},"")`, `=${ci("Open")}+${ci("Check")}`]);
    }
    sum.push([]);
  };
  const T = (col, v) => `'Tips'!$${col}:$${col},${q(v)}`;
  block("All tips", [["Everything", `'Tips'!$A:$A,"<>Date"`], ["Tipsters", T("F", "Tipster")], ["2+ tipsters on the same pick", T("F", "Tipster") + `,'Tips'!$L:$L,">=2"`], ["SportsLine model", T("F", "Model")], ["Systems", T("F", "System")]], "Tips", "M", "N", "K");
  const mkts = ["Moneyline", "Spread", "Total", "Team total", "Player prop"];
  block("By market (tipsters only)", mkts.map(m => [m, T("F", "Tipster") + "," + T("G", m)]), "Tips", "M", "N", "K");
  const TYS = ["Board verdict", "Fade the public", "Follow Circa", "Tipster consensus"];
  block("Plays posted to Discord", [["All posted plays", `'Board plays'!$A:$A,"<>Date"`], ...TYS.map(t => [t, `'Board plays'!$E:$E,${q(t)}`])], "Board plays", "J", "K", "I");
  /* tipster x market grid */
  const names = [...new Set(tipList.filter(t => t.kind !== "system" && !/^SportsLine model/i.test(t.tipster)).map(t => t.tipster))].sort();
  sum.push(["Tipster by market (record, units)", "Overall", "", ...mkts.flatMap(m => [m, ""])]);
  sum.push(["", "W-L", "Units", ...mkts.flatMap(() => ["W-L", "Units"])]);
  for (const n of names){
    const crit = [["", T("E", n)], ...mkts.map(m => [m, T("E", n) + "," + T("G", m)])];
    sum.push([n, ...crit.flatMap(([, c]) => [`=COUNTIFS(${c},'Tips'!$M:$M,"W")&"-"&COUNTIFS(${c},'Tips'!$M:$M,"L")`, `=ROUND(SUMIFS('Tips'!$N:$N,${c}),2)`])]);
  }
  const W = Math.max(...sum.map(r => r.length)); for (const r of sum) while (r.length < W) r.push("");
  process.stdout.write(JSON.stringify({ tips: tipsRows, plays: playRows, summary: sum }));
  process.exit(0);
} else {
  const today = etDate(NOW.toISOString());
  const back = n => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  if (MODE === "daily"){ const d = back(1); const s = summary([d], `Daily results · games of ${briDate(d)} (US)`); if (s) messages.push({ key: `daily|${d}`, content: s }); }
  if (MODE === "weekly"){ const ds = [1, 2, 3, 4, 5, 6, 7].map(back); const s = summary(ds, `Weekly results · ${briDate(ds[6])} to ${briDate(ds[0])} (US game days)`); if (s) messages.push({ key: `weekly|${ds[0]}`, content: s }); }
}
process.stdout.write(JSON.stringify({ messages, markers, vlog }, null, 1));
