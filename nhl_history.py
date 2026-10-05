"""One-off (and re-runnable) NHL history for the Chippy model: every regular season and playoff game since 2015-16 from ESPN
(teams, score, OT/shootout), each team's starting goalie from the NHL stats API, and ESPN's stored closing moneyline/total.
Writes nhl_hist.json. Run by the 'Chippy NHL history' workflow."""
import json, datetime, urllib.request, concurrent.futures as cf, time, sys

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            if i == tries - 1: print("fail", url, e, file=sys.stderr); return None
            time.sleep(1.5 * (i + 1))

def season_of(d): return d.year if d.month >= 8 else d.year - 1

def main():
    start, end = datetime.date(2015, 10, 1), datetime.date.today()
    days = [start + datetime.timedelta(n) for n in range((end - start).days + 1) if (start + datetime.timedelta(n)).month not in (7, 8, 9)]
    games = {}
    def day(d):
        j = get(f"https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d:%Y%m%d}&limit=50")
        out = []
        for e in (j or {}).get("events", []):
            if (e.get("season") or {}).get("type") not in (2, 3): continue
            c = e["competitions"][0]; st = c["status"]["type"]
            side = {x["homeAway"]: x for x in c["competitors"]}
            out.append(dict(an=side["away"]["team"].get("displayName"), hn=side["home"]["team"].get("displayName"), id=e["id"], date=e["date"], season=(e.get("season") or {}).get("year"), stype=e["season"]["type"], away=side["away"]["team"]["abbreviation"], home=side["home"]["team"]["abbreviation"],
                            ag=int(side["away"].get("score") or 0) if st.get("completed") else None, hg=int(side["home"].get("score") or 0) if st.get("completed") else None,
                            ot=("OT" in (st.get("shortDetail") or "")), so=("SO" in (st.get("shortDetail") or ""))))
        return out
    with cf.ThreadPoolExecutor(12) as ex:
        for lst in ex.map(day, days):
            for g in lst: games[g["id"]] = g
    print("games", len(games))
    # starting goalies, per NHL season
    starters = {}
    for y in range(2015, end.year + (1 if end.month >= 8 else 0)):
        sid = f"{y}{y+1}"; startrow = 0; total = 1
        while startrow < total:
            j = get(f"https://api.nhle.com/stats/rest/en/goalie/summary?isAggregate=false&isGame=true&start={startrow}&limit=100&sort=%5B%7B%22property%22:%22gameId%22,%22direction%22:%22ASC%22%7D,%7B%22property%22:%22playerId%22,%22direction%22:%22ASC%22%7D%5D&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2") or {}
            total = j.get("total", 0); startrow += 100
            for x in j.get("data", []):
                if x.get("gamesStarted"): starters[(x["gameDate"][:10], x["teamAbbrev"])] = dict(id=x["playerId"], name=x.get("goalieFullName"), sa=x.get("shotsAgainst"), ga=x.get("goalsAgainst"))
        print("goalies", sid, total)
    # team shots per game (shots are a steadier guide to team quality than goals)
    shots = {}
    for y in range(2015, end.year + (1 if end.month >= 8 else 0)):
        sid = f"{y}{y+1}"; startrow = 0; total = 1
        while startrow < total:
            j = get(f"https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=true&start={startrow}&limit=100&sort=%5B%7B%22property%22:%22gameId%22,%22direction%22:%22ASC%22%7D,%7B%22property%22:%22teamId%22,%22direction%22:%22ASC%22%7D%5D&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2") or {}
            total = j.get("total", 0); startrow += 100
            for x in j.get("data", []):
                if x.get("gameDate") and x.get("teamFullName"):
                    shots[f"{x['gameDate'][:10]}|{x['teamFullName']}"] = dict(sf=x.get("shotsForPerGame"), sa=x.get("shotsAgainstPerGame"), pp=x.get("powerPlayPct"), pk=x.get("penaltyKillPct"))
        print("team shots", sid, total)
    # ESPN closing odds (kept for recent seasons)
    def odds(g):
        j = get(f"https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/{g['id']}/competitions/{g['id']}/odds", tries=2) or {}
        for o in j.get("items", []):
            h, a = (o.get("homeTeamOdds") or {}), (o.get("awayTeamOdds") or {})
            hc, ac = (h.get("close") or {}).get("moneyLine") or {}, (a.get("close") or {}).get("moneyLine") or {}
            if hc.get("decimal") and ac.get("decimal"): return g["id"], dict(src=(o.get("provider") or {}).get("name"), h=hc["decimal"], a=ac["decimal"], t=o.get("overUnder"))
        return g["id"], None
    recent = [g for g in games.values() if g["date"] >= "2019-08-01" and g["hg"] is not None]
    with cf.ThreadPoolExecutor(12) as ex:
        for gid, o in ex.map(odds, recent):
            if o: games[gid]["odds"] = o
    print("with odds", sum(1 for g in games.values() if g.get("odds")))
    json.dump(dict(asof=datetime.datetime.utcnow().isoformat() + "Z", games=sorted(games.values(), key=lambda g: g["date"]),
                   starters={f"{d}|{t}": v for (d, t), v in starters.items()}, shots=shots), open("nhl_hist.json", "w"))

if __name__ == "__main__":
    main()
