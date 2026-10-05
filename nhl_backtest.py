"""Chippy NHL model: Elo on goal difference + home ice + back-to-backs + season regression, plus a starting-goalie rating
(recent save % against the league, weighted by recent starts). Logistic fit on wins; backtest against ESPN's stored closing moneylines."""
import json, math, collections, datetime, itertools, sys
import numpy as np

H = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "nhl_hist.json"))
NHLC = {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL", "UTAH": "UTA"}
TEAMS = {k.split("|")[1] for k in H["starters"]}
GAMES = [g for g in H["games"] if g["hg"] is not None and NHLC.get(g["away"], g["away"]) in TEAMS and NHLC.get(g["home"], g["home"]) in TEAMS]
ST = H["starters"]
ALIAS = {"ARI": "UTAH", "UTA": "UTAH", "PHX": "UTAH"}
T = lambda t: ALIAS.get(t, t)
day = lambda g: (datetime.datetime.fromisoformat(g["date"].replace("Z", "+00:00")) - datetime.timedelta(hours=10)).date()   # US date of the game

import unicodedata
SH = {}
for k, v in H.get("shots", {}).items():
    d, n = k.split("|", 1); n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    if v.get("sf") is not None and v.get("sa") is not None: SH[(d, n)] = v; SH[(d, n.split()[-1])] = v
def shots_of(d, name):
    n = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return SH.get((d, n)) or SH.get((d, n.split()[-1] if n else ""))

def build(K=6.0, HFA=25, REG=0.35, B2B=30, MOVK=1.0, GHL=25.0, PRIOR=8.0, SHL=20.0):
    elo = collections.defaultdict(lambda: 1500.0); last = {}; season = None
    gsv = collections.defaultdict(lambda: [0.0, 0.0])        # goalie: weighted saves, weighted shots
    lg = [0.0, 0.0]; w = 0.5 ** (1 / GHL); rows = []
    shs = collections.defaultdict(lambda: [0.0, 0.0]); ws = 0.5 ** (1 / SHL)
    for g in GAMES:
        s = g["season"]
        if s != season:
            season = s
            for t in list(elo): elo[t] = elo[t] * (1 - REG) + 1500 * REG
            for t in shs: shs[t][0] *= 0.5; shs[t][1] *= 0.5
        a, h, d0 = T(g["away"]), T(g["home"]), day(g)
        ra, rh = g["away"], g["home"]
        diff = elo[h] - elo[a] + HFA
        b2b_h = last.get(h) == d0 - datetime.timedelta(1); b2b_a = last.get(a) == d0 - datetime.timedelta(1)
        diff += B2B * (b2b_a - b2b_h)
        lgsv = lg[0] / lg[1] if lg[1] else 0.905
        def gq(team):   # goals saved per game above league, shrunk towards average by PRIOR starts' worth of shots
            c = NHLC.get(team, team)
            x = ST.get(f"{d0}|{c}") or ST.get(f"{d0 - datetime.timedelta(1)}|{c}") or ST.get(f"{d0 + datetime.timedelta(1)}|{c}")
            if not x: return 0.0, None
            sv, sh = gsv[x["id"]]
            sh_eff = sh + PRIOR * 28
            rate = (sv + PRIOR * 28 * lgsv) / sh_eff
            return (rate - lgsv) * 30, x
        gh, xh = gq(rh); ga, xa = gq(ra)
        ssh = lambda t: (shs[t][0] + 0.5 * 5) / (shs[t][1] + 5)
        rows.append(dict(g=g, diff=diff, gq=gh - ga, b2b=(b2b_a - b2b_h), season=s, ss=ssh(h) - ssh(a)))
        for t, nm_ in ((h, g.get("hn")), (a, g.get("an"))):
            x = shots_of(str(d0), nm_)
            if x and (x["sf"] + x["sa"]) > 0: shs[t][0] = shs[t][0] * ws + x["sf"] / (x["sf"] + x["sa"]); shs[t][1] = shs[t][1] * ws + 1
        # update
        mov = g["hg"] - g["ag"]; res = 1 if mov > 0 else 0
        p = 1 / (1 + 10 ** (-diff / 400)); wd = diff if mov > 0 else -diff
        mult = (math.log(abs(mov) + 1) * MOVK + (1 - MOVK)) if not (g.get("ot") or g.get("so")) else 0.6
        sh_ = K * mult * (res - p); elo[h] += sh_; elo[a] -= sh_
        last[h] = last[a] = d0
        for x in (xh, xa):
            if x and x.get("sa"):
                v = gsv[x["id"]]; v[0] = v[0] * w + (x["sa"] - x["ga"]); v[1] = v[1] * w + x["sa"]
                lg[0] = lg[0] * 0.999 + (x["sa"] - x["ga"]); lg[1] = lg[1] * 0.999 + x["sa"]
    return rows

def logit_fit(X, y, iters=25):
    """Newton's method logistic regression (converges properly, unlike a few hundred gradient steps)."""
    X = np.array(X, float); y = np.array(y, float); b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ b)); W = p * (1 - p)
        b += np.linalg.solve(X.T @ (X * W[:, None]) + 1e-6 * np.eye(len(b)), X.T @ (y - p))
    return b

def feats(r): return [1.0, r["diff"] / 100, r["gq"], r.get("ss", 0) * 10]

def evaluate(rows, b, lo, hi, edges=(0.02, 0.04, 0.06)):
    ok = lambda o: o and 1.0 < 1 / o["h"] + 1 / o["a"] < 1.10   # ESPN's stored 2023-24 "closing" prices are broken (overround ~0.82)
    rs = [r for r in rows if lo <= r["season"] <= hi and ok(r["g"].get("odds"))]
    ll_m = ll_k = 0; out = {"n": len(rs)}
    bets = {e: [0, 0, 0.0] for e in edges}
    for r in rs:
        o = r["g"]["odds"]; ih, ia = 1 / o["h"], 1 / o["a"]; pm = ih / (ih + ia)
        p = 1 / (1 + math.exp(-np.dot(b, feats(r))))
        y = 1 if r["g"]["hg"] > r["g"]["ag"] else 0
        ll_k -= math.log(p if y else 1 - p); ll_m -= math.log(pm if y else 1 - pm)
        for e in edges:
            if p - pm >= e: side, price, won = "h", o["h"], y == 1
            elif pm - p >= e: side, price, won = "a", o["a"], y == 0
            else: continue
            bets[e][0] += 1; bets[e][1] += won; bets[e][2] += (price - 1) if won else -1
    out["logloss_model"] = round(ll_k / len(rs), 4); out["logloss_market"] = round(ll_m / len(rs), 4)
    for e, (n, w, u) in bets.items(): out[f"edge{int(e*100)}"] = (n, round(w / max(n, 1) * 100, 1), round(u, 1), round(u / max(n, 1) * 100, 1))
    return out

if __name__ == "__main__":
    print("games", len(GAMES), "with odds", sum(1 for g in GAMES if g.get("odds")), "seasons", sorted({g["season"] for g in GAMES}))
    best = None
    for K, HFA, REG, B2B, PRIOR in itertools.product([4, 6, 8], [15, 25, 35], [0.25, 0.4], [20, 35], [4, 10]):
        rows = build(K=K, HFA=HFA, REG=REG, B2B=B2B, PRIOR=PRIOR)
        tr = [r for r in rows if 2017 <= r["season"] <= 2023]
        b = logit_fit([feats(r) for r in tr], [1 if r["g"]["hg"] > r["g"]["ag"] else 0 for r in tr])
        ps = [1 / (1 + math.exp(-np.dot(b, feats(r)))) for r in tr]
        ll = -np.mean([math.log(p if r["g"]["hg"] > r["g"]["ag"] else 1 - p) for p, r in zip(ps, tr)])
        if best is None or ll < best[0]: best = (ll, dict(K=K, HFA=HFA, REG=REG, B2B=B2B, PRIOR=PRIOR), b)
    print("best train logloss", round(best[0], 4), best[1], [round(x, 3) for x in best[2]])
    rows = build(**best[1])
    print("train 2020-23 vs market", evaluate(rows, best[2], 2020, 2023))
    print("test 2024-26 vs market", evaluate(rows, best[2], 2024, 2026))
