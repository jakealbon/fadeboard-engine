"""MLB ballpark + weather history for the Chippy model: every stadium (bearing to centre field, coordinates, elevation, roof, fences)
and every game since 2021 with MLB's recorded game-time weather (temperature, wind speed and direction relative to the field,
roof/dome), runs and home runs per team, plus ESPN's closing total for 2025-2026. Writes mlb_hist.json. Data: MLB Stats API, ESPN."""
import json, datetime, urllib.request, concurrent.futures as cf, time, sys, os

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=90) as r: return json.loads(r.read())
        except Exception as e:
            if i == tries - 1: print("fail", url, e, file=sys.stderr); return None
            time.sleep(2 * (i + 1))

API = "https://statsapi.mlb.com/api/v1"

def main():
    today = datetime.date.today()
    v = get(f"{API}/venues?sportId=1&hydrate=location,fieldInfo&season={today.year}") or {}
    venues = {}
    for x in v.get("venues", []):
        loc, fi = x.get("location") or {}, x.get("fieldInfo") or {}
        c = loc.get("defaultCoordinates") or {}
        if loc.get("azimuthAngle") is None or not c: continue
        venues[str(x["id"])] = dict(name=x["name"], lat=c.get("latitude"), lon=c.get("longitude"), az=loc.get("azimuthAngle"), elev=loc.get("elevation"), roof=fi.get("roofType"),
                                    tz=(x.get("timeZone") or {}).get("id"), lf=fi.get("leftLine"), cf=fi.get("center"), rf=fi.get("rightLine"))
    print("venues", len(venues))
    games = {}
    for y in range(2021, today.year + 1):
        j = get(f"{API}/schedule?sportId=1&startDate={y}-03-01&endDate={y}-11-30&gameType=R,F,D,L,W&hydrate=weather,linescore,venue,team") or {}
        for d in j.get("dates", []):
            for g in d.get("games", []):
                st = (g.get("status") or {}).get("abstractGameState"); ls = g.get("linescore") or {}; t = g.get("teams") or {}
                games[str(g["gamePk"])] = dict(pk=g["gamePk"], date=g.get("gameDate"), day=d.get("date"), season=y, type=g.get("gameType"), venue=str((g.get("venue") or {}).get("id")),
                    away=(t.get("away") or {}).get("team", {}).get("abbreviation"), home=(t.get("home") or {}).get("team", {}).get("abbreviation"),
                    aid=(t.get("away") or {}).get("team", {}).get("id"), hid=(t.get("home") or {}).get("team", {}).get("id"),
                    ar=((ls.get("teams") or {}).get("away") or {}).get("runs") if st == "Final" else None, hr_=None,
                    hr=((ls.get("teams") or {}).get("home") or {}).get("runs") if st == "Final" else None, inn=ls.get("currentInning"),
                    w=g.get("weather") or {})
        print("season", y, len(games))
    # home runs per team per game from team game logs
    teams = sorted({g["hid"] for g in games.values() if g["hid"]})
    def logs(args):
        tid, y, gt = args
        j = get(f"{API}/teams/{tid}/stats?stats=gameLog&group=hitting&season={y}&gameType={gt}") or {}
        return [(str((s.get("game") or {}).get("gamePk")), tid, (s.get("stat") or {}).get("homeRuns")) for st in j.get("stats", []) for s in st.get("splits", [])]
    jobs = [(t, y, gt) for t in teams for y in range(2021, today.year + 1) for gt in ("R", "P")]
    with cf.ThreadPoolExecutor(10) as ex:
        for rows in ex.map(logs, jobs):
            for pk, tid, hr in rows:
                g = games.get(pk)
                if g and hr is not None: g.setdefault("hrs", {})[str(tid)] = hr
    # ESPN closing totals, 2025 onwards
    def espn_day(d):
        j = get(f"https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates={d.replace('-', '')}&limit=40") or {}
        return [(d, e["id"], {x["homeAway"]: x["team"]["abbreviation"] for x in e["competitions"][0]["competitors"]}) for e in j.get("events", [])]
    days = sorted({g["day"] for g in games.values() if g["season"] >= 2025 and g["hr"] is not None})
    emap = {}
    with cf.ThreadPoolExecutor(10) as ex:
        for lst in ex.map(espn_day, days):
            for d, eid, side in lst: emap.setdefault((d, side.get("home")), []).append(eid)
    ALIAS = {"AZ": "ARI", "CWS": "CHW", "KC": "KC", "SD": "SD", "SF": "SF", "TB": "TB", "WSH": "WSH", "ATH": "ATH", "OAK": "ATH"}
    def odds(args):
        pk, eid = args
        j = get(f"https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/{eid}/competitions/{eid}/odds", tries=2) or {}
        for o in j.get("items", []):
            if o.get("overUnder") is None: continue
            ov, un = (o.get("overOdds"), o.get("underOdds"))
            return pk, dict(src=(o.get("provider") or {}).get("name"), t=o["overUnder"], o=ov, u=un)
        return pk, None
    jobs = []
    for g in games.values():
        if g["season"] < 2025 or g["hr"] is None: continue
        ids = emap.get((g["day"], ALIAS.get(g["home"], g["home"]))) or emap.get((g["day"], g["home"])) or []
        if len(ids) == 1: jobs.append((str(g["pk"]), ids[0]))
    with cf.ThreadPoolExecutor(10) as ex:
        for pk, o in ex.map(odds, jobs):
            if o: games[pk]["odds"] = o
    print("with odds", sum(1 for g in games.values() if g.get("odds")))
    json.dump(dict(asof=datetime.datetime.utcnow().isoformat() + "Z", venues=venues, games=sorted(games.values(), key=lambda g: g["date"] or "")), open("mlb_hist.json", "w"), separators=(",", ":"))

if __name__ == "__main__":
    main()
