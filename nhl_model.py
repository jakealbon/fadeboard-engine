"""Chippy model, NHL v1: Elo on goals (home ice, back-to-backs, season regression) + recent shot share + the starting goalie's
recent save % against the league. Logistic fit on every finished game since 2016-17, then prices the next few days.
Keeps nhl_hist.json up to date (new results, goalies, shots), writes nhl.json for the website. Data: ESPN, NHL stats API."""
import json, math, collections, datetime, unicodedata, urllib.request, concurrent.futures as cf, time, sys
import numpy as np

SORT = "&sort=%5B%7B%22property%22:%22gameId%22,%22direction%22:%22ASC%22%7D,%7B%22property%22:%22playerId%22,%22direction%22:%22ASC%22%7D%5D"
TSORT = "&sort=%5B%7B%22property%22:%22gameId%22,%22direction%22:%22ASC%22%7D,%7B%22property%22:%22teamId%22,%22direction%22:%22ASC%22%7D%5D"
P = dict(K=4, HFA=15, REG=0.4, B2B=35, PRIOR=4, GHL=25.0, SHL=20.0)
NHLC = {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL", "UTAH": "UTA"}
ALIAS = {"ARI": "UTAH", "UTA": "UTAH", "PHX": "UTAH"}
T = lambda t: ALIAS.get(t, t)
asc = lambda s: unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            if i == tries - 1: print("fail", url, e, file=sys.stderr); return None
            time.sleep(1.5 * (i + 1))

def refresh(H):
    """New and upcoming games from ESPN (with probable goalies), this season's starters and team shots from the NHL."""
    today = datetime.date.today(); games = {g["id"]: g for g in H["games"]}; probs = {}
    def day(d):
        j = get(f"https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d:%Y%m%d}&limit=50") or {}
        out = []
        for e in j.get("events", []):
            if (e.get("season") or {}).get("type") not in (2, 3): continue
            c = e["competitions"][0]; st = c["status"]["type"]; side = {x["homeAway"]: x for x in c["competitors"]}
            g = dict(an=side["away"]["team"].get("displayName"), hn=side["home"]["team"].get("displayName"), id=e["id"], date=e["date"], season=e["season"]["year"], stype=e["season"]["type"],
                     away=side["away"]["team"]["abbreviation"], home=side["home"]["team"]["abbreviation"],
                     ag=int(side["away"].get("score") or 0) if st.get("completed") else None, hg=int(side["home"].get("score") or 0) if st.get("completed") else None,
                     ot="OT" in (st.get("shortDetail") or ""), so="SO" in (st.get("shortDetail") or ""))
            pr = {ha: ((side[ha].get("probables") or [{}])[0].get("athlete") or {}).get("displayName") for ha in ("away", "home")}
            out.append((g, pr))
        return out
    with cf.ThreadPoolExecutor(8) as ex:
        for lst in ex.map(day, [today + datetime.timedelta(n) for n in range(-4, 4)]):
            for g, pr in lst:
                old = games.get(g["id"]);
                if old and old.get("odds"): g["odds"] = old["odds"]
                games[g["id"]] = g; probs[g["id"]] = pr
    y = today.year if today.month >= 8 else today.year - 1; sid = f"{y}{y+1}"
    for kind in ("goalie", "team"):
        startrow, total = 0, 1
        while startrow < total:
            j = get(f"https://api.nhle.com/stats/rest/en/{kind}/summary?isAggregate=false&isGame=true&start={startrow}&limit=100{SORT if kind == 'goalie' else TSORT}&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2") or {}
            total = j.get("total", 0); startrow += 100
            for x in j.get("data", []):
                if kind == "goalie" and x.get("gamesStarted"): H["starters"][f"{x['gameDate'][:10]}|{x['teamAbbrev']}"] = dict(id=x["playerId"], name=x.get("goalieFullName"), sa=x.get("shotsAgainst"), ga=x.get("goalsAgainst"))
                if kind == "team" and x.get("teamFullName"): H["shots"][f"{x['gameDate'][:10]}|{x['teamFullName']}"] = dict(sf=x.get("shotsForPerGame"), sa=x.get("shotsAgainstPerGame"))
    H["games"] = sorted(games.values(), key=lambda g: g["date"]); H["asof"] = datetime.datetime.utcnow().isoformat() + "Z"
    return probs

def build(H, probs):
    ST = H["starters"]; TEAMS = {k.split("|")[1] for k in ST}
    SH = {}
    for k, v in H["shots"].items():
        d, n = k.split("|", 1); n = asc(n)
        if v.get("sf") is not None and v.get("sa") is not None: SH[(d, n)] = v; SH[(d, n.split()[-1])] = v
    shots_of = lambda d, name: SH.get((d, asc(name))) or SH.get((d, asc(name).split()[-1] if name else ""))
    byname = {}
    for k, v in ST.items(): byname[asc(v.get("name"))] = v["id"]
    recent = collections.defaultdict(list)
    day = lambda g: (datetime.datetime.fromisoformat(g["date"].replace("Z", "+00:00")) - datetime.timedelta(hours=10)).date()
    elo = collections.defaultdict(lambda: 1500.0); last = {}; season = None
    gsv = collections.defaultdict(lambda: [0.0, 0.0]); lg = [0.0, 0.0]; w = 0.5 ** (1 / P["GHL"])
    shs = collections.defaultdict(lambda: [0.0, 0.0]); ws = 0.5 ** (1 / P["SHL"]); rows = []
    for g in H["games"]:
        if NHLC.get(g["away"], g["away"]) not in TEAMS or NHLC.get(g["home"], g["home"]) not in TEAMS: continue
        s = g["season"]
        if s != season:
            season = s
            for t in list(elo): elo[t] = elo[t] * (1 - P["REG"]) + 1500 * P["REG"]
            for t in shs: shs[t][0] *= 0.5; shs[t][1] *= 0.5
        a, h, d0 = T(g["away"]), T(g["home"]), day(g)
        diff = elo[h] - elo[a] + P["HFA"] + P["B2B"] * ((last.get(a) == d0 - datetime.timedelta(1)) - (last.get(h) == d0 - datetime.timedelta(1)))
        lgsv = lg[0] / lg[1] if lg[1] else 0.905
        def gq(code, ha):
            c = NHLC.get(code, code)
            x = ST.get(f"{d0}|{c}") or ST.get(f"{d0 - datetime.timedelta(1)}|{c}") or ST.get(f"{d0 + datetime.timedelta(1)}|{c}")
            gid = x["id"] if x else None; name = None
            if not gid and g["hg"] is None:
                name = (probs.get(g["id"]) or {}).get(ha)
                gid = byname.get(asc(name)) if name else None
                if not gid and recent[c]: gid = collections.Counter(recent[c][-5:]).most_common(1)[0][0]   # usual starter
            if not gid: return 0.0, x, None
            sv, sh = gsv[gid]; rate = (sv + P["PRIOR"] * 28 * lgsv) / (sh + P["PRIOR"] * 28)
            return (rate - lgsv) * 30, x, gid
        gh, xh, idh = gq(g["home"], "home"); ga, xa, ida = gq(g["away"], "away")
        ssh = lambda t: (shs[t][0] + 0.5 * 5) / (shs[t][1] + 5)
        rows.append(dict(g=g, f=[1.0, diff / 100, gh - ga, (ssh(h) - ssh(a)) * 10], season=s, gh=idh, ga=ida))
        if g["hg"] is None: continue
        mov = g["hg"] - g["ag"]; res = 1 if mov > 0 else 0; p = 1 / (1 + 10 ** (-diff / 400))
        mult = math.log(abs(mov) + 1) if not (g.get("ot") or g.get("so")) else 0.6
        sh_ = P["K"] * mult * (res - p); elo[h] += sh_; elo[a] -= sh_; last[h] = last[a] = d0
        for x, code in ((xh, g["home"]), (xa, g["away"])):
            if x and x.get("sa"):
                v = gsv[x["id"]]; v[0] = v[0] * w + (x["sa"] - x["ga"]); v[1] = v[1] * w + x["sa"]
                lg[0] = lg[0] * 0.999 + (x["sa"] - x["ga"]); lg[1] = lg[1] * 0.999 + x["sa"]
                recent[NHLC.get(code, code)].append(x["id"])
        for t, nm in ((h, g.get("hn")), (a, g.get("an"))):
            x = shots_of(str(d0), nm)
            if x and (x["sf"] + x["sa"]) > 0: shs[t][0] = shs[t][0] * ws + x["sf"] / (x["sf"] + x["sa"]); shs[t][1] = shs[t][1] * ws + 1
    return rows, elo

def fit(rows):
    tr = [r for r in rows if r["g"]["hg"] is not None and r["season"] >= 2017]
    X = np.array([r["f"] for r in tr]); y = np.array([1.0 if r["g"]["hg"] > r["g"]["ag"] else 0.0 for r in tr]); b = np.zeros(X.shape[1])
    for _ in range(25):
        p = 1 / (1 + np.exp(-X @ b)); W = p * (1 - p)
        b += np.linalg.solve(X.T @ (X * W[:, None]) + 1e-6 * np.eye(len(b)), X.T @ (y - p))
    return b

def main():
    H = json.load(open("nhl_hist.json")); H.setdefault("shots", {})
    probs = refresh(H)
    json.dump(H, open("nhl_hist.json", "w"))
    rows, elo = build(H, probs); b = fit(rows)
    now = datetime.datetime.utcnow(); soon = (now + datetime.timedelta(days=3)).isoformat()
    out = []
    for r in rows:
        g = r["g"]
        if g["hg"] is not None or g["date"] > soon or g["date"] < (now - datetime.timedelta(hours=12)).isoformat(): continue
        p = 1 / (1 + math.exp(-float(np.dot(b, r["f"]))))
        out.append(dict(espn=g["id"], date=g["date"], away=g["away"], home=g["home"], p_home=round(p, 4), goalies=[r["ga"], r["gh"]]))
    json.dump(dict(asof=now.isoformat(timespec="seconds") + "Z", version="nhl-1", coef=[round(float(x), 3) for x in b], games=out,
                   ratings={t: round(v, 1) for t, v in sorted(elo.items(), key=lambda x: -x[1])}), open("nhl.json", "w"), indent=1)
    print(len(out), "NHL games priced", b)

if __name__ == "__main__":
    main()
