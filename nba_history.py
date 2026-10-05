"""NBA history for the Chippy model: games since 2015-16 (ESPN), ESPN's stored closing moneyline/spread/total, and box scores
(who played, minutes and box stats) for the last five seasons. Re-runnable: finished games already saved are skipped.
Writes nba_hist.json {games:[...], box:{"<espn game id>": {"<team>": [[athleteId, min, pts, reb, ast, stl, blk, tov, fga, fgm, fta, ftm, pm], ...]}}}."""
import json, datetime, urllib.request, concurrent.futures as cf, time, sys, os

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            if i == tries - 1: print("fail", url, e, file=sys.stderr); return None
            time.sleep(1.5 * (i + 1))

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

def main():
    path = "nba_hist.json"
    H = json.load(open(path)) if os.path.exists(path) else {"games": [], "box": {}}
    games = {g["id"]: g for g in H["games"]}
    have_dates = {g["date"][:10] for g in games.values() if g.get("hg") is not None}
    start, end = datetime.date(2015, 10, 20), datetime.date.today() + datetime.timedelta(3)
    days = [start + datetime.timedelta(n) for n in range((end - start).days + 1) if (start + datetime.timedelta(n)).month not in (8, 9)]
    days = [d for d in days if d >= datetime.date.today() - datetime.timedelta(5) or str(d) not in have_dates]
    def day(d):
        j = get(f"{BASE}/scoreboard?dates={d:%Y%m%d}&limit=50") or {}
        out = []
        for e in j.get("events", []):
            if (e.get("season") or {}).get("type") not in (2, 3, 5): continue      # regular, playoffs, play-in
            c = e["competitions"][0]; st = c["status"]["type"]; side = {x["homeAway"]: x for x in c["competitors"]}
            out.append(dict(id=e["id"], date=e["date"], season=e["season"]["year"], stype=e["season"]["type"], neutral=bool(c.get("neutralSite")),
                            away=side["away"]["team"]["abbreviation"], home=side["home"]["team"]["abbreviation"],
                            ag=int(side["away"].get("score") or 0) if st.get("completed") else None, hg=int(side["home"].get("score") or 0) if st.get("completed") else None))
        return out
    with cf.ThreadPoolExecutor(12) as ex:
        for lst in ex.map(day, days):
            for g in lst:
                old = games.get(g["id"], {})
                for k in ("odds",):
                    if old.get(k): g[k] = old[k]
                games[g["id"]] = g
    print("games", len(games))
    def odds(g):
        j = get(f"https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/{g['id']}/competitions/{g['id']}/odds", tries=2) or {}
        for o in j.get("items", []):
            h, a = (o.get("homeTeamOdds") or {}), (o.get("awayTeamOdds") or {})
            hc, ac = (h.get("close") or {}), (a.get("close") or {})
            hm, am = (hc.get("moneyLine") or {}).get("decimal"), (ac.get("moneyLine") or {}).get("decimal")
            sp = (hc.get("pointSpread") or {}).get("american")
            if hm and am: return g["id"], dict(src=(o.get("provider") or {}).get("name"), h=hm, a=am, sp=float(sp) if sp not in (None, "", "EVEN") else None, t=o.get("overUnder"))
        return g["id"], None
    todo = [g for g in games.values() if g["date"] >= "2019-08-01" and g["hg"] is not None and "odds" not in g]
    with cf.ThreadPoolExecutor(12) as ex:
        for gid, o in ex.map(odds, todo): games[gid]["odds"] = o
    print("odds", sum(1 for g in games.values() if g.get("odds")))
    box = H.get("box", {})
    def summary(g):
        j = get(f"{BASE}/summary?event={g['id']}") or {}
        out = {}
        for t in (j.get("boxscore") or {}).get("players", []):
            team = t["team"]["abbreviation"]; rows = []
            for grp in t.get("statistics", [])[:1]:
                lab = grp.get("labels") or grp.get("keys") or []
                ix = {k: i for i, k in enumerate(lab)}
                for a in grp.get("athletes", []):
                    if a.get("didNotPlay") or not a.get("stats"): continue
                    s = a["stats"]; f = lambda k: s[ix[k]] if k in ix and ix[k] < len(s) else "0"
                    num = lambda v: float(v) if v not in ("", "--", None) and v.replace(".", "", 1).lstrip("+-").isdigit() else 0.0
                    fg, ft = f("FG").split("-") + ["0"], f("FT").split("-") + ["0"]
                    rows.append([a["athlete"]["id"], num(f("MIN")), num(f("PTS")), num(f("REB")), num(f("AST")), num(f("STL")), num(f("BLK")), num(f("TO")),
                                 num(fg[1]), num(fg[0]), num(ft[1]), num(ft[0]), num(f("+/-"))])
            out[team] = rows
        return g["id"], out
    todo = [g for g in games.values() if g["season"] >= 2021 and g["hg"] is not None and g["id"] not in box]
    print("box scores to fetch", len(todo))
    with cf.ThreadPoolExecutor(12) as ex:
        for gid, b in ex.map(summary, todo):
            if b: box[gid] = b
    json.dump(dict(asof=datetime.datetime.utcnow().isoformat() + "Z", games=sorted(games.values(), key=lambda g: g["date"]), box=box), open(path, "w"), separators=(",", ":"))

if __name__ == "__main__":
    main()
