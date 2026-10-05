"""Ballpark + weather test. Fits total runs and total home runs on park (each venue its own effect), temperature and the wind's
component towards centre field (open-air games only), on 2021-2024. Then on 2025-2026 checks whether the weather part explains what
the closing total missed, and what betting the over/under on weather alone would have done."""
import json, math, re, collections, sys
import numpy as np

H = json.load(open("mlb_hist.json"))
V = H["venues"]; G = [g for g in H["games"] if g.get("hr") is not None and g.get("ar") is not None and (g.get("inn") or 9) >= 9]
COMP = {"out to cf": 1.0, "out to lf": 0.7, "out to rf": 0.7, "in from cf": -1.0, "in from lf": -0.7, "in from rf": -0.7}

def wx(g):
    w = g.get("w") or {}; cond = (w.get("condition") or "").lower()
    indoor = cond in ("dome", "roof closed")
    try: temp = float(w.get("temp"))
    except (TypeError, ValueError): temp = None
    m = re.match(r"\s*(\d+)\s*mph,\s*(.*)", w.get("wind") or ""); spd = float(m.group(1)) if m else 0.0; d = (m.group(2).strip().lower() if m else "")
    out = 0.0 if indoor else spd * COMP.get(d, 0.0)
    return indoor, temp, out, spd, d

def design(games, venues_ix):
    X, yr, yh, keep = [], [], [], []
    for g in games:
        indoor, temp, out, spd, d = wx(g)
        if temp is None or g["venue"] not in venues_ix: continue
        row = [0.0] * len(venues_ix); row[venues_ix[g["venue"]]] = 1.0
        t = 0.0 if indoor else (temp - 72) / 10
        row += [t, out / 10, (out / 10) * max(t, 0), 1.0 if indoor else 0.0, 1.0]
        X.append(row); yr.append(g["ar"] + g["hr"]); keep.append(g)
        h = g.get("hrs") or {}; yh.append(sum(h.values()) if len(h) == 2 else np.nan)
    return np.array(X), np.array(yr, float), np.array(yh, float), keep

def ridge(X, y, lam=5.0, nv=0):
    P = np.eye(X.shape[1]) * lam; P[nv:, nv:] = 0      # shrink only the park effects
    return np.linalg.solve(X.T @ X + P, X.T @ y)

if __name__ == "__main__":
    vids = sorted({g["venue"] for g in G if g["venue"] in V}); ix = {v: i for i, v in enumerate(vids)}; nv = len(vids)
    tr = [g for g in G if g["season"] <= 2024]; te = [g for g in G if g["season"] >= 2025]
    X, yr, yh, _ = design(tr, ix)
    br = ridge(X, yr, nv=nv); ok = ~np.isnan(yh); bh = ridge(X[ok], yh[ok], nv=nv)
    names = ["temp per 10F", "wind out per 10mph", "wind out x warm", "roof closed/dome", "intercept"]
    print("games train", len(tr), "test", len(te))
    print("RUNS  ", {n: round(float(b), 3) for n, b in zip(names, br[nv:])})
    print("HOMERS", {n: round(float(b), 3) for n, b in zip(names, bh[nv:])})
    park = sorted(((V[v]["name"], round(float(br[i]), 2), round(float(bh[i]), 2)) for v, i in ix.items()), key=lambda x: -x[1])
    print("park runs/HR (top & bottom):", park[:5], park[-5:])
    # does weather explain what the closing total missed?
    Xt, yrt, _, keep = design(te, ix)
    wpart = Xt[:, nv:nv + 3] @ br[nv:nv + 3]              # the weather-only part of the runs prediction (temp, wind)
    rows = [(k, w) for k, w in zip(keep, wpart) if k.get("odds") and k["odds"].get("t")]
    resid = np.array([k["ar"] + k["hr"] - k["odds"]["t"] for k, _ in rows]); wp = np.array([w for _, w in rows])
    slope = np.polyfit(wp, resid, 1)[0] if len(rows) > 50 else float("nan")
    print("test games with closing totals", len(rows), "| slope of (actual - close) on weather part:", round(float(slope), 3), "| mean resid", round(float(resid.mean()), 3))
    dec = lambda a: None if a is None else (1 + a / 100 if a > 0 else 1 + 100 / -a)
    for thr in (0.3, 0.5, 0.8):
        n = w = 0; u = 0.0
        for (k, wv) in rows:
            if abs(wv) < thr: continue
            tot = k["ar"] + k["hr"]; line = k["odds"]["t"]
            if tot == line: continue
            over = wv > 0; won = (tot > line) == over
            price = dec(k["odds"].get("o" if over else "u")) or 1.91
            n += 1; w += won; u += (price - 1) if won else -1
        print(f"bet weather side when |weather| >= {thr} runs: {n} bets, {w / max(n, 1) * 100:.1f}% won, {u:+.1f}u, ROI {u / max(n, 1) * 100:+.1f}%")
    json.dump(dict(venues={v: dict(V[v], park_runs=round(float(br[i]), 3), park_hr=round(float(bh[i]), 3)) for v, i in ix.items()},
                   runs=dict(zip(names, map(float, br[nv:]))), hrs=dict(zip(names, map(float, bh[nv:]))),
                   base_runs=round(float(np.mean(yr)), 3), base_hr=round(float(np.nanmean(yh)), 3)), open("mlb_weather_coef.json", "w"), indent=1)
