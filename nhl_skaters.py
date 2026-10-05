"""NHL skater game logs since 2015-16 (who played, ice time, points, shots) for the Chippy model's lineup layer.
Writes nhl_skaters.json: {"<date>|<team>": [[playerId, toi_seconds, points, shots, "C/L/R/D"], ...]}. Re-run tops up the current season."""
import json, datetime, urllib.request, concurrent.futures as cf, time, sys, os

def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r: return json.loads(r.read())
        except Exception as e:
            if i == tries - 1: print("fail", url, e, file=sys.stderr); return None
            time.sleep(2 * (i + 1))

NAMES = {}

def season_rows(sid):
    """A month at a time: the NHL stats API stops at 10,000 rows per query."""
    y = int(sid[:4]); months = [(y, m) for m in range(9, 13)] + [(y + 1, m) for m in range(1, 8)]
    def month(ym):
        yy, mm = ym; last = (datetime.date(yy + (mm == 12), mm % 12 + 1, 1) - datetime.timedelta(1)).day
        rng = f"%20and%20gameDate%3E=%22{yy}-{mm:02d}-01%22%20and%20gameDate%3C=%22{yy}-{mm:02d}-{last}%2023:59:59%22"
        rows, start, total = [], 0, 1
        while start < total:
            j = get(f"https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=true&start={start}&limit=100&sort=%5B%7B%22property%22:%22gameId%22,%22direction%22:%22ASC%22%7D,%7B%22property%22:%22playerId%22,%22direction%22:%22ASC%22%7D%5D&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2{rng}") or {}
            total = j.get("total", 0); start += 100; rows += j.get("data", [])
        return rows
    out = {}; n = 0
    with cf.ThreadPoolExecutor(6) as ex:
        for rows in ex.map(month, months):
            for x in rows:
                n += 1; k = f"{x['gameDate'][:10]}|{x['teamAbbrev']}"
                NAMES[str(x["playerId"])] = x.get("skaterFullName") or ""
                if any(r[0] == x["playerId"] for r in out.get(k, [])): continue
                out.setdefault(k, []).append([x["playerId"], round((x.get("timeOnIcePerGame") or 0)), x.get("points") or 0, x.get("shots") or 0, x.get("positionCode") or ""])
    print(sid, n, len(out)); return out

def main():
    path = "nhl_skaters.json"
    data = json.load(open(path)) if os.path.exists(path) else {}
    if data.get("_v") != 2: data = {}   # earlier builds paged without a fixed order (rows missed or doubled): start again
    today = datetime.date.today(); cur = today.year if today.month >= 8 else today.year - 1
    done = set(data.get("_done", []))
    for y in range(2015, cur + 1):
        if y < cur and y in done: continue   # finished seasons only need fetching once
        data.update(season_rows(f"{y}{y+1}"))
        if y < cur: done.add(y)
    data["_done"] = sorted(done); data["_v"] = 2
    data["_names"] = {**data.get("_names", {}), **NAMES}
    json.dump(data, open(path, "w"), separators=(",", ":"))

if __name__ == "__main__":
    main()
