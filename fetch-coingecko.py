#!/usr/bin/env python3
"""Fetch CoinGecko market data for token-evidence matching.

Pulls the top 10,000 coins by market cap from the CoinGecko
``coins/markets`` endpoint (250 per page, pages 1-40) and writes a compact
evidence file mapping each uppercase ticker symbol to the list of coins
that use it:

    {"as_of": "2026-11-21",
     "source": "coingecko coins/markets (top 10k by mcap)",
     "entries": {"WELL": [{"id": "moonwell-artemis", "name": "Moonwell",
                           "rank": 1470, "market_cap": 5248115}, ...], ...}}

main.ts reads this file at runtime; a token the snapshot does not record
can still be caught here. Standard library only, no API key needed for the
public endpoint. Usage:

    python3 fetch-coingecko.py [output.json]
"""

import json
import sys
import time
import urllib.request
from datetime import date

API_URL = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}"
    "&sparkline=false&price_change_percentage=24h"
)
PAGES = 40
SLEEP_SECONDS = 4
USER_AGENT = "token-radar/1.0 (token launch radar; contact: make.fun bounty token-radar-01)"


def fetch_page(page: int) -> list:
    request = urllib.request.Request(
        API_URL.format(page=page), headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # The public endpoint rate-limits (429) if called too eagerly; wait
        # out the pause it asks for and try the same page once more.
        if error.code == 429:
            wait = int(error.headers.get("Retry-After", "60"))
            print(f"page {page}: rate-limited, waiting {wait}s and retrying", file=sys.stderr)
            time.sleep(wait)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        raise


def main() -> int:
    output_path = sys.argv[1] if len(sys.argv) > 1 else "token_evidence.json"
    entries: dict[str, list[dict]] = {}
    fetched = 0
    for page in range(1, PAGES + 1):
        coins = fetch_page(page)
        if not coins:
            print(f"page {page}: empty, stopping early", file=sys.stderr)
            break
        for index, coin in enumerate(coins):
            symbol = str(coin.get("symbol") or "").upper()
            if not symbol:
                continue
            rank = coin.get("market_cap_rank")
            if not isinstance(rank, int):
                rank = (page - 1) * 250 + index + 1
            entries.setdefault(symbol, []).append(
                {
                    "id": coin.get("id"),
                    "name": coin.get("name"),
                    "rank": rank,
                    "market_cap": coin.get("market_cap") or 0,
                }
            )
            fetched += 1
        print(f"page {page}: {len(coins)} coins, {fetched} total")
        if page < PAGES:
            time.sleep(SLEEP_SECONDS)
    evidence = {
        "as_of": date.today().isoformat(),
        "source": "coingecko coins/markets (top 10k by mcap)",
        "entries": entries,
    }
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    print(f"wrote {output_path}: {fetched} coins, {len(entries)} symbols")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
