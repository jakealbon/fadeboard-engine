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

def season_rows(sid, only_from=None):
    first = get(f"https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=true&start=0&limit=100&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2") or {}
    total = first.get("total", 0); pages = [first] + [None] * ((total - 1) // 100 if total else 0)
    def page(i): return get(f"https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=true&start={i*100}&limit=100&cayenneExp=seasonId={sid}%20and%20gameTypeId%3E=2") or {}
    with cf.ThreadPoolExecutor(8) as ex:
        for i, p in zip(range(1, len(pages)), ex.map(page, range(1, len(pages)))): pages[i] = p
    out = {}
    for p in pages:
        for x in (p or {}).get("data", []):
            k = f"{x['gameDate'][:10]}|{x['teamAbbrev']}"
            out.setdefault(k, []).append([x["playerId"], round((x.get("timeOnIcePerGame") or 0)), x.get("points") or 0, x.get("shots") or 0, x.get("positionCode") or ""])
    print(sid, total, len(out)); return out

def main():
    path = "nhl_skaters.json"
    data = json.load(open(path)) if os.path.exists(path) else {}
    today = datetime.date.today(); cur = today.year if today.month >= 8 else today.year - 1
    have = {k.split("|")[0][:4] for k in data}
    for y in range(2015, cur + 1):
        if y < cur and (str(y) in have and str(y + 1) in have): continue   # finished seasons only need fetching once
        data.update(season_rows(f"{y}{y+1}"))
    json.dump(data, open(path, "w"), separators=(",", ":"))

if __name__ == "__main__":
    main()
