"""Chippy model, NFL v1: power ratings from results (Elo with margin, home field, byes, season regression, starting-QB changes)
plus rolling offence/defence EPA per play from nflverse player stats. Fitted to final margins on every past season since 2017,
then used to price the upcoming games. Writes nfl.json: {asof, version, games: [{espn, game_id, gameday, away, home, line_home, p_home}], ratings}.
Data: nflverse (games.csv and weekly player stats), CC-BY 4.0. Run by a GitHub Action every few hours."""
import csv, io, json, math, collections, datetime, urllib.request
import numpy as np

def get(url):
    with urllib.request.urlopen(url, timeout=120) as r: return r.read().decode("utf-8")

ALIAS = {"OAK": "LV", "SD": "LAC", "STL": "LA"}
T = lambda t: ALIAS.get(t, t)
P = dict(K=16, HFA=48, REG=0.5, REST=25, QBPEN=70, QBN=4, MOVK=2.2, SCALE=23)
HL, EREG, SD = 8.0, 0.5, 13.5

def main():
    games = list(csv.DictReader(io.StringIO(get("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"))))
    games.sort(key=lambda r: (r["gameday"], r["gametime"] or "", r["game_id"]))
    now = datetime.date.today(); last = now.year if now.month >= 3 else now.year - 1
    epa = collections.defaultdict(lambda: [0.0, 0])
    for y in range(2016, last + 1):
        try: txt = get(f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv")
        except Exception as e: print("stats", y, e); continue
        for r in csv.DictReader(io.StringIO(txt)):
            f = lambda k: float(r.get(k) or 0)
            k = (r["game_id"], T(r["team"]))
            epa[k][0] += f("passing_epa") + f("rushing_epa")
            epa[k][1] += f("attempts") + f("carries") + f("sacks_suffered")
    elo = collections.defaultdict(lambda: 1505.0); qbs = collections.defaultdict(list)
    off = collections.defaultdict(lambda: [0.0, 0.0]); dfn = collections.defaultdict(lambda: [0.0, 0.0]); w = 0.5 ** (1 / HL)
    season = None; rows = []
    for g in games:
        s = int(g["season"])
        if s != season:
            season = s
            for t in list(elo): elo[t] = elo[t] * (1 - P["REG"]) + 1505 * P["REG"]
            for d in (off, dfn):
                for t in d: d[t][0] *= EREG; d[t][1] *= EREG
        a, h = T(g["away_team"]), T(g["home_team"])
        d = elo[h] - elo[a] + (0 if g["location"] == "Neutral" else P["HFA"])
        try: d += P["REST"] * ((int(g["home_rest"] or 7) >= 10) - (int(g["away_rest"] or 7) >= 10))
        except ValueError: pass
        for side, sgn, key in ((h, 1, "home_qb_id"), (a, -1, "away_qb_id")):
            qb, recent = g[key], qbs[side][-P["QBN"]:]
            if qb and len(recent) >= 2 and qb not in recent: d -= sgn * P["QBPEN"]
        rate = lambda dd, t: dd[t][0] / dd[t][1] if dd[t][1] > 0.5 else 0.0
        net = (rate(off, h) - rate(dfn, h)) - (rate(off, a) - rate(dfn, a))
        row = dict(g=g, elo_pts=d / P["SCALE"], net=net, s=s, a=a, h=h)
        if g["home_score"] == "": row["done"] = False; rows.append(row); continue
        mov = int(g["home_score"]) - int(g["away_score"]); res = 1 if mov > 0 else 0 if mov < 0 else 0.5
        p = 1 / (1 + 10 ** (-d / 400)); wd = d if mov > 0 else -d
        mult = math.log(abs(mov) + 1) * P["MOVK"] / (wd * 0.001 + P["MOVK"]) if mov else 1
        sh = P["K"] * mult * (res - p); elo[h] += sh; elo[a] -= sh
        for side, key in ((h, "home_qb_id"), (a, "away_qb_id")):
            if g[key]: qbs[side].append(g[key])
        for t, o in ((h, a), (a, h)):
            e = epa.get((g["game_id"], t))
            if e and e[1]:
                v = e[0] / e[1]
                off[t][0] = off[t][0] * w + v; off[t][1] = off[t][1] * w + 1
                dfn[o][0] = dfn[o][0] * w + v; dfn[o][1] = dfn[o][1] * w + 1
        row.update(done=True, mov=mov); rows.append(row)
    fit = [r for r in rows if r["done"] and r["s"] >= 2017 and int(r["g"]["week"]) > 1]
    X = np.array([[1, r["elo_pts"], r["net"]] for r in fit]); y = np.array([r["mov"] for r in fit])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    mae = float(np.mean(np.abs(X @ b - y)))
    cdf = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    soon = (now + datetime.timedelta(days=10)).isoformat()
    out = []
    for r in rows:
        g = r["g"]
        if r["done"] or g["gameday"] > soon or g["gameday"] < (now - datetime.timedelta(days=1)).isoformat(): continue
        m = float(b[0] + b[1] * r["elo_pts"] + b[2] * r["net"])
        out.append(dict(espn=g["espn"], game_id=g["game_id"], gameday=g["gameday"], away=r["a"], home=r["h"], line_home=round(-m, 1), p_home=round(cdf(m / SD), 4)))
    json.dump(dict(asof=datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z", version="nfl-1", coef=[round(float(x), 3) for x in b], fit_mae=round(mae, 2),
                   games=out, ratings={t: round(v, 1) for t, v in sorted(elo.items(), key=lambda x: -x[1])}), open("nfl.json", "w"), indent=1)
    print(len(out), "games priced; coef", b, "mae", mae)

if __name__ == "__main__":
    main()
