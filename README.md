# token-radar-01-v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Siksuk72/token-radar-01-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Siksuk72/token-radar-01-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar is a token launch radar: it reads a sealed snapshot of the DeFi
protocol universe, works out what each protocol's token would be worth if its
record stayed as it is, and ranks the protocols worth farming — with a
seven-step farm plan for every row. It does not predict whether or when a
token will be issued; the implied values are the radar's own claim, never a
promise. The board covers 460 protocols, including the full 40-protocol house
watchlist, and flags the 113 tickers whose tokens already trade (checked
against vendored CoinGecko market data) so no one farms a launch that already
happened.

## Run it

```sh
node main.ts input/snapshot.json out
# then open out/dashboard/index.html in a browser (no server needed)
```

`main.ts` runs on Node.js 22 with the standard library only. It reads the
snapshot (default `/input/snapshot.json`) and the vendored
`token_evidence.json` beside it, and writes `board.json`, `data.js`, the
dashboard, the screenshots and `dossier.json` into the output directory
(default `/output`). The run is deterministic: the same snapshot always
produces byte-identical outputs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hz26ha21&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
