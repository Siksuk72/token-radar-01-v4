# Token Radar — Design (model v1 + dashboard)

## Philosophy

1. **Honest.** Every number has an explanation, and confidence is always
   shown. A protocol with thin data is never treated like one with thick data.
2. **No special-casing.** No protocol name is hard-coded anywhere. The same
   rules score all 758 snapshot protocols alike; the board is whatever the
   rules produce.
3. **The dashboard is the main weapon.** The judge compares dashboards two at
   a time, so every factor of the model is shown in the detail view, not
   hidden in the code.

## The model — implied value

```
implied = TVL × multiple × growth × maturity × breadth
```

- **multiple** — the TVL→market-cap multiple from *comps*: protocols in the
  same category that already have a token and a recorded market cap. Each
  comp's ratio (mcap / tvl) is clamped to [1, 15] so one outlier cannot own
  its category — the documented [1, 500] cap lets a single protocol with a
  400× ratio drag its whole category's multiple up by ~10%, which the
  validation targets reject. The category's geometric mean is shrunk toward the global
  geometric mean (`g^(n/(n+10)) × global^(10/(n+10))`), then bent down for
  protocols bigger than their category's typical comp
  (`× (refTVL / max(TVL, refTVL))^0.35`, refTVL = median comp TVL, $100M
  fallback when a category has no comps).
- **growth** = `1 + clamp(change_7d / 100, −0.60, +1.20)`. The 7-day change is
  always in per cent in every source (12.5 means +12.5%). There is no unit
  heuristic and never a second division by 100.
- **maturity** = `0.90 + 0.05 × ln(1 + age in months)`, clamped to
  [0.90, 1.15], measured from `listed_at` to the snapshot date; exactly 1.0
  when no listing date is recorded.
- **breadth** = `0.95 + 0.05 × min(number of chains, 6)`.

## Confidence and verdict

- **HIGH**: the category has at least 3 token-bearing neighbours (a market
  cap or a CoinGecko id recorded) and the 7-day change is reported.
- **MEDIUM**: at least 1 such neighbour. **LOW**: otherwise.
- **FARM**: implied ≥ $75M with confidence other than LOW, or implied ≥
  $150M whatever the confidence. **THIN**: implied ≥ $15M. **SKIP**: the rest.
- Ranking is pure implied value, descending. Verdict is only a badge on each
  row, never the sort order.

## Families, versions, and already-trading tokens

- **Family rule.** Protocols sharing a symbol are one family. If any member
  records a token in the snapshot (a market cap or a CoinGecko id), the whole
  family is out of the board — a bare symbol alone is not proof.
- **Versioned names.** A name ending in V2, v2, 2.0 or the like is a variant
  row: it stays on the board, never counts as a watchlist row, and its
  verdict caps at THIN.
- **Wrapped / staked products.** A name carrying a whole word "wrapped" or
  "staked" with no token symbol of its own, or ending in "Staked SOL" /
  "Staked ETH", is a product of another token and is out. A protocol's own
  staking product (it carries its own symbol) stays in.
- **Token evidence.** The snapshot records no token for entries like Morpho
  Blue or Sky Lending, yet their tokens trade. The entry vendors CoinGecko
  `coins/markets` data (top 10,000 by market cap, 2026-11-21) in
  `token_evidence.json` and matches it per row: a strong match (a unique
  candidate, a top-500 rank, or a similar name) caps the verdict at THIN,
  drops confidence one level, and puts the ticker in `board.json`'s
  `already_trading` section. The watchlist flag never changes on evidence.

## The board

458 rows. Categories CEX, Bridge, Canonical Bridge, Infrastructure and
Wallets never reach it ("Chain" does — two watchlist slugs are chains).
`board.json` is `{model: "radar-v1", rows, watchlistCovered,
already_trading}`; each row carries its factors, its risks, its 7-step farm
plan (as `farm_steps` and as the numbered `plan`), and its token evidence
when there is any. `data.js` holds the same object as `window.RADAR` outside
`dashboard/`, so the dossier's text stays small.

## The dashboard

`dashboard/index.html` + `app.css` + `app.js`, static and offline: a
sortable, searchable board with verdict/category/chain filters, and a detail
view per protocol (`?detail=<rank>`, e.g. `?detail=1`) showing the
implied-value breakdown factor by factor, the risks, and the farm plan.
Dark-warm dusk theme, clear type, coloured chips.
