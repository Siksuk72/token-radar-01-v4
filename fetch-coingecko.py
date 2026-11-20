#!/usr/bin/env python3
"""Fetch CoinGecko top-10k tokens (coins/markets, by mcap) -> token_evidence.json.

Rate-limit friendly: 250/page, 40 pages, 4s sleep between requests (~15/min).
On 429/5xx: wait 60s, retry once; if still failing, stop and build from
what was fetched. Writes token_evidence.json next to this script's repo dir.
"""
import json
import os
import sys
import time
import urllib.request

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(OUT_DIR, ".coingecko-raw")
os.makedirs(RAW_DIR, exist_ok=True)

BASE = ("https://api.coingecko.com/api/v3/coins/markets"
        "?vs_currency=usd&per_page=250&page={page}")
SLEEP = 4
MAX_PAGE = 40


def fetch_page(page):
    url = BASE.format(page=page)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "token-radar-evidence-builder/1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    all_coins = []
    seen_ids = set()
    last_ok = 0
    for page in range(1, MAX_PAGE + 1):
        if page > 1:
            time.sleep(SLEEP)
        try:
            data = fetch_page(page)
        except Exception as e:
            print(f"page {page}: ERROR {e} -> wait 60s, retry once", flush=True)
            time.sleep(60)
            try:
                data = fetch_page(page)
            except Exception as e2:
                print(f"page {page}: RETRY FAILED {e2} -> stop here", flush=True)
                break
        if not isinstance(data, list) or not data:
            print(f"page {page}: empty/non-list response -> stop", flush=True)
            break
        with open(os.path.join(RAW_DIR, f"page-{page:02d}.json"), "w") as f:
            json.dump(data, f)
        new = 0
        for c in data:
            cid = c.get("id")
            if not cid or cid in seen_ids:
                continue
            seen_ids.add(cid)
            all_coins.append(c)
            new += 1
        last_ok = page
        print(f"page {page}: {len(data)} coins ({new} new), total {len(all_coins)}", flush=True)

    entries = {}
    for c in all_coins:
        sym = (c.get("symbol") or "").upper()
        if not sym or sym == "-":
            continue
        entries.setdefault(sym, []).append({
            "id": c.get("id"),
            "name": c.get("name"),
            "rank": c.get("market_cap_rank"),
            "market_cap": c.get("market_cap"),
        })
    for sym in entries:
        entries[sym].sort(key=lambda e: (e["rank"] is None, e["rank"] or 10 ** 9))

    out = {
        "as_of": "2026-11-21",
        "source": "coingecko coins/markets (top 10k by mcap)",
        "entries": entries,
    }
    out_path = os.path.join(OUT_DIR, "token_evidence.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"DONE pages={last_ok} coins={len(all_coins)} tickers={len(entries)} -> {out_path}")
    print(f"file bytes: {os.path.getsize(out_path)}")


if __name__ == "__main__":
    main()
