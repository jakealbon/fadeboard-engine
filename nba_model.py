"""Chippy model, NBA v1: Elo on margins (home court, back-to-backs, season regression) + regulars missing (box-score value per minute
above replacement x usual minutes). Fitted on every season with box scores, prices the next few days. ESPN data.
Reads nba_hist.json (kept current by nba_history.py), writes nba.json."""
import json, math, collections, datetime, urllib.request, sys
import numpy as np

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return json.loads(r.read())
    except Exception as e: print("fail", url, e, file=sys.stderr); return None

def injuries():
    j = get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries") or {}; out = {}
    for t in j.get("injuries", []):
        for x in t.get("injuries", []):
            st = (x.get("status") or "").lower(); pid = str((x.get("athlete") or {}).get("id") or "")
            w = 1.0 if ("out" in st or "injured" in st or "suspen" in st) else 0.75 if "doubt" in st else 0.4 if ("question" in st or "day" in st) else 0.0
            if pid and w: out[pid] = max(w, out.get(pid, 0))
    return out

day = lambda g: (datetime.datetime.fromisoformat(g["date"].replace("Z", "+00:00")) - datetime.timedelta(hours=10)).date()

def gscore(r):   # Hollinger game score from what we keep: id, min, pts, reb, ast, stl, blk, tov, fga, fgm, fta, ftm, pm
    _, mn, pts, reb, ast, stl, blk, tov, fga, fgm, fta, ftm, pm = r
    return pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.5 * reb + 0.7 * ast + stl + 0.7 * blk - tov

class Players:
    def __init__(self, REPL=0.25, HL=25.0):
        self.REPL = REPL; self.w = 0.5 ** (1 / HL)
        self.st = {}; self.games = collections.defaultdict(list); self.played = collections.defaultdict(lambda: collections.defaultdict(list))
    def value(self, pid):   # points of margin a game: (game score per minute above replacement) x usual minutes
        x = self.st.get(pid)
        if not x or x[1] < 1: return 0.0
        gpm = (x[0] + self.REPL * 30) / (x[1] + 30)
        return max(0.0, gpm - self.REPL) * (x[1] / max(x[2], 1e-9))
    def regulars(self, team):
        last = self.games[team][-10:]
        if len(last) < 5: return []
        ls = set(last)
        return [p for p, ds in self.played[team].items() if ds and ds[-1] >= last[0] and sum(1 for d in ds[-10:] if d in ls) >= 6 and self.st[p][1] / max(self.st[p][2], 1e-9) >= 15]
    def missing(self, team, here):
        return sum(self.value(p) for p in self.regulars(team) if p not in here)
    def update(self, team, d, rows):
        self.games[team].append(d)
        for r in rows:
            p = r[0]; self.played[team][p].append(d)
            x = self.st.setdefault(p, [0.0, 0.0, 0.0]); x[0] = x[0] * self.w + gscore(r); x[1] = x[1] * self.w + r[1]; x[2] = x[2] * self.w + 1

def build(GAMES, BOX, INJ, K=16, HFA=50, REG=0.4, B2B=50, SCALE=28.0, REPL=0.3):
    elo = collections.defaultdict(lambda: 1500.0); last = {}; season = None; PL = Players(REPL=REPL); rows = []
    for g in GAMES:
        s = g["season"]
        if s != season:
            season = s
            for t in list(elo): elo[t] = elo[t] * (1 - REG) + 1500 * REG
        a, h, d0 = g["away"], g["home"], day(g)
        diff = elo[h] - elo[a] + (0 if g.get("neutral") else HFA) + B2B * ((last.get(a) == d0 - datetime.timedelta(1)) - (last.get(h) == d0 - datetime.timedelta(1)))
        b = BOX.get(g["id"]) or {}
        if g["hg"] is None:      # upcoming: regulars on ESPN's injury list (out 1, doubtful 0.75, questionable/day-to-day 0.4)
            mh = sum(PL.value(p) * INJ.get(p, 0) for p in PL.regulars(h)); ma = sum(PL.value(p) * INJ.get(p, 0) for p in PL.regulars(a))
        else:
            mh = PL.missing(h, {r[0] for r in b.get(h, [])}) if b.get(h) else 0.0
            ma = PL.missing(a, {r[0] for r in b.get(a, [])}) if b.get(a) else 0.0
        rows.append(dict(g=g, s=s, elo_pts=diff / SCALE, miss=mh - ma, has_box=bool(b), mh=round(mh, 1), ma=round(ma, 1)))
        if g["hg"] is None: continue
        mov = g["hg"] - g["ag"]; res = 1 if mov > 0 else 0; p = 1 / (1 + 10 ** (-diff / 400))
        wd = diff if mov > 0 else -diff; mult = ((abs(mov) + 3) ** 0.8) / (7.5 + 0.006 * wd)
        sh = K * mult * (res - p); elo[h] += sh; elo[a] -= sh; last[h] = last[a] = d0
        for t in (h, a):
            if b.get(t): PL.update(t, d0, b[t])
    return rows


feats = lambda r: [1.0, r["elo_pts"], r["miss"]]

def main():
    H = json.load(open("nba_hist.json")); INJ = injuries()
    rows = build(H["games"], H["box"], INJ)
    tr = [r for r in rows if r["g"]["hg"] is not None and r["has_box"] and r["s"] >= 2022]
    X = np.array([feats(r) for r in tr]); y = np.array([r["g"]["hg"] - r["g"]["ag"] for r in tr], float)
    bm, *_ = np.linalg.lstsq(X, y, rcond=None); sd = float(np.std(X @ bm - y))
    cdf = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))
    now = datetime.datetime.utcnow(); soon = (now + datetime.timedelta(days=3)).isoformat(); out = []
    for r in rows:
        g = r["g"]
        if g["hg"] is not None or g["date"] > soon or g["date"] < (now - datetime.timedelta(hours=12)).isoformat(): continue
        m = float(np.dot(bm, feats(r)))
        out.append(dict(espn=g["id"], date=g["date"], away=g["away"], home=g["home"], line_home=round(-m, 1), p_home=round(cdf(m / sd), 4), missing=[r["ma"], r["mh"]]))
    json.dump(dict(asof=now.isoformat(timespec="seconds") + "Z", version="nba-1", coef=[round(float(x), 3) for x in bm], sd=round(sd, 2), games=out), open("nba.json", "w"), indent=1)
    print(len(out), "NBA games priced", bm, sd, len(INJ), "injured")

if __name__ == "__main__":
    main()
