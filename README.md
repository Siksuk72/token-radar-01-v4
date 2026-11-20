# token-radar-01-v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Siksuk72/token-radar-01-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Siksuk72/token-radar-01-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

*Token launch radar — entri untuk bounty make.fun `token-radar-01` ($1.325 — #1 = $1.000).*

Membaca snapshot segel DefiLlama, mengidentifikasi protocol yang **belum punya token**
(bukan wrapped/staked product dari token yang trading), dan merankingnya berdasarkan
**nilai yang akan dihasilkan peluncurannya** — lengkap dengan farm plan 7 langkah
yang jujur per protocol.

## Model (radar-v1)

```
implied = TVL × multiple_adj × growth × maturity × breadth
```

- **multiple_adj** — rasio MCap/TVL geomean dari *comps* satu kategori (protocol
  yang sudah punya token), di-*shrink* ke geomean global `n/(n+10)`, lalu
  *size-adjusted*: protocol yang lebih besar dari tipikal kategorinya dihargai
  pasar dengan multiple lebih rendah (`(refTVL/max(TVL,refTVL))^0.35`).
- **growth** — perubahan TVL 7 hari (selalu persen), clamp [−60%, +120%].
- **Token evidence** — `token_evidence.json` (CoinGecko top 10k by mcap,
  vendored, 21 Nov 2026): baris yang tokennya sudah trading di-cap THIN +
  risk #1; detail di DESIGN.md.
- **maturity** — usia listing tanpa token: `0.90 + 0.05·ln(1+bulan)`, clamp [0.90, 1.15].
- **breadth** — jumlah chain: `0.95 + 0.05·min(n_chains, 6)`.
- **Confidence** HIGH/MEDIUM/LOW dari kelengkapan data comps; **Verdict**
  FARM/THIN/SKIP dari implied + confidence + farmability kategori.
- Tanpa special-casing nama protocol. Heuristik wrapped/staked & keluarga
  protocol dalam satu fungsi yang mudah diaudit.

## Cara jalan

```bash
node main.ts /input/snapshot.json /output   # Node 22.18+ (TS jalan langsung)
```

Output:
- `board.json` — 569 baris ranked di snapshot segel (implied value + breakdown faktor + risiko + farm plan)
- `data.js` — data dashboard (`window.RADAR`)
- `dashboard/` — halaman statis **tanpa network** (board + detail + filter)
- `dossier.json` — via `vendor/makefun-board.ts` dari kit

## Dashboard

- **Board**: sortable, searchable, filter verdict/kategori/chain
- **Detail view**: breakdown tiap faktor implied value + risiko yang diakui + farm plan
- **Deep-link** untuk screenshot: `?detail=1`, `?verdict=FARM&cat=Lending`

## Struktur

```
main.ts              # pipeline (Node 22, stdlib saja)
dashboard/           # index.html + app.css + app.js (statis, tanpa network)
example/             # contoh snapshot
data-llama-protocols.json # kalibrasi (DefiLlama live dump 21 Nov 2026)
token_evidence.json  # bukti token trading (CoinGecko top 10k, 21 Nov 2026)
fetch-coingecko.py   # script pembangun token_evidence.json (sekali saja)
```

## Lisensi

MIT — lihat [LICENSE](LICENSE).

## Run it

```sh
node main.ts /input/snapshot.json /output
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=hz26ha21&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
