# 🎨 Desain Token Radar — model v1 + dashboard

## Filosofi
1. **Jujur** — tiap angka punya penjelasan; confidence selalu ditampilkan; protocol
   dengan data tipis tidak diperlakukan sama dengan yang data-nya tebal.
2. **Tanpa special-casing** — tidak ada nama protocol yang di-hard-code; semua
   dari aturan yang sama.
3. **Dashboard = senjata utama** — AI judge membandingkan visual 2-per-2
   (pelajaran dari GTA6-01). Semua faktor model ditampilkan di detail view.

## Model implied value (v1)

```
implied = TVL × multiple_adj × growth × maturity × breadth
```

- **multiple_adj** = multiple TVL→MCap dari *comps* (protocol satu kategori yang
  sudah punya token & market cap):
  - ratio_i = mcap_i / tvl_i, clamp [1, 500]
  - geomean kategori di-*shrink* ke geomean global: `g^(n/(n+10)) × global^(10/(n+10))`
  - *size slope*: protokol yang lebih besar dari tipikal kategorinya dihargai
    pasar dengan multiple lebih rendah:
    `multiple_adj = multiple × (refTVL / max(TVL, refTVL))^0.35`
    (refTVL = median TVL comps kategori, fallback $100M)
- **growth** = `1 + clamp(change_7d/100, −0.6, +1.2)` — change_7d **selalu persen** di semua sumber (DefiLlama: -10.59 = -10.59%). Heuristik satuan |x|>2 → /100 dihapus 21 Nov 2026: salah baca untuk |x|≤2 (mis. +1.34% dibaca 1.34 → growth 2.2×).
- **maturity** = usia `listedAt` tanpa token: `0.90 + 0.05·ln(1 + usia_bulan)`,
  clamp [0.90, 1.15]
- **breadth** = `0.95 + 0.05·min(n_chains, 6)`

## Confidence & verdict
- **HIGH**: ≥3 comps kategori + mcap & change tersedia
- **MEDIUM**: ≥1 comp
- **LOW**: 0 comp / data tipis
- **FARM**: implied ≥ $75M dan confidence ≠ LOW, atau implied ≥ $150M
  (apa pun confidence-nya)
- **THIN**: implied ≥ $15M
- **SKIP**: sisanya

## Ranking & board (gate) — diubah 21 Nov 2026
- **Ranking = implied desc murni.** Rank 1 = implied terbesar; implied tidak
  boleh naik seiring rank (syarat gate `sorted_by_value`). Verdict
  (FARM/THIN/SKIP) jadi badge per baris, bukan urutan — sebelumnya FARM
  dulu lalu THIN lalu SKIP, yang melanggar gate begitu ada baris THIN
  (mis. Spark, $3.387M) dengan implied lebih besar dari FARM terbawah.
- **board.json**: `rows` = array baris (bukan hitungan); tiap baris membawa
  `slug`, `implied_value_usd`, `farm_steps` (7 langkah, tiap langkah 20-600
  karakter) sesuai syarat gate. Field model lain (`implied`, `plan`,
  `multiple`, `growth`, ...) tetap ada sebagai extra keys.
- **CEX/Bridge/Canonical Bridge/Infrastructure/Wallets tidak masuk board**
  — kalau masuk, Binance CEX ($29,7B implied) jadi rank 1 dan baris Bridge
  raksasa (LayerZero V2, Coinbase Bridge, WBTC, ...) mendominasi top-10
  sebagai SKIP. "Chain" TIDAK dikecualikan: 2 slug watchlist
  (hive-protocol, noble) berkategori Chain.

## Deteksi token keluarga & nama berversi (ditambah 21 Nov 2026)
- **Family key**: simbol uppercase (bukan "-") + nama dasar ternormalisasi (lowercase, tanpa tanda baca, tanpa akhiran versi). Kalau satu entri se-family punya bukti token (mcap>0 / cmc / gecko / field token), seluruh keluarga keluar dari pre-token — menangkap keluarga yang snapshot-nya MENCATAT bukti token (Aave, Sushi, ...). Untuk keluarga yang snapshot-nya tidak mencatat bukti apa pun (Morpho/MORPHO, Sky/SKY, Ethena/ENA, Uniswap/UNI, Compound/COMP), buktinya datang dari token evidence yang di-vendor (lihat bagian di bawah).
- **Variant**: nama cocok `/\bV[0-9]+(\.[0-9]+)?$/i` → `variant:true`, tidak dihitung watchlist, verdict maksimal THIN; entri nama dasar se-family tetap jadi baris utama.

## Token evidence (external, vendored) — ditambah 21 Nov 2026
**Kenapa:** snapshot segel tidak mencatat token — entri Morpho Blue, Sky
Lending, Ethena USDe, Uniswap V3, Compound V3 semuanya `gecko_id: null` /
`mcap: null`, dan dump DefiLlama mentah pun sama (entri induknya tidak ada
di data). Model tidak bisa melihat token yang sudah trading dari snapshot
saja.
**Sumber:** CoinGecko `coins/markets` (top 10.000 by market cap),
diambil 21 Nov 2026 via `fetch-coingecko.py` (paginasi 250/halaman, sleep
4 detik antar request, ~15 req/menit), disimpan ke `token_evidence.json`
dan ikut di-commit. **Program tetap offline/deterministik**: file dibaca
dari repo saat jalan, tanpa network.
**Matching** (per baris bersimbol): kandidat = `entries[SYMBOL]`.
Match **kuat** kalau kandidat unik, ATAU rank ≤ 500, ATAU nama kandidat
mirip nama protocol (lowercase, tanpa tanda baca, tanpa kata umum
v2/v3/finance/protocol/lab — tanpa exact-name wajib, mis. Morpho Blue ↔
Morpho). Match lemah/ambigu: tidak di-exclude, hanya risk note
"ticker X ambigu di data pasar".
**Aturan verdict** (match kuat): baris bukan pre-token — verdict di-cap
THIN (FARM→THIN; THIN/SKIP tidak naik), confidence turun satu tingkat,
risk #1 mencatat bukti (`Token <SYM> sudah diperdagangkan (evidence:
<id>, rank <N>, data pasar per <as_of>)`). `board.json` punya section
`already_trading` (ticker + evidence + protocol yang kena). Flag
WATCHLIST dibiarkan — itu definisi resmi bounty dari snapshot.

## Wrapped/staked exclusion (heuristik, di-tune saat snapshot asli tiba)
- `token` kosong → pre-token
- exclude: kategori "Liquid Staking"/"Restaking" yang produknya turunan token lain,
  atau nama/symbol cocok `^(wrapped|staked|st[a-z]?-?)` dengan base token trading.
  Semua aturan ada di satu fungsi `isWrappedOrStaked()` — mudah diaudit.

## Farm plan (7 langkah, digenerate per protocol)
Pakai data asli: chain utama, kategori, url, twitter. Contoh kerangka:
1. Kenali protocol (kriteria & risiko inti)
2. Pilih chain & deposit (chain terbesar menurut TVL)
3. Strategi yield (berdasar kategori: lending/DEX/perp/restaking)
4. Lacak poin/insentif (psn untuk airdrop)
5. Ukuran posisi & limit risiko
6. Pantau sinyal launch (announcements, testnet, token sale)
7. Rencana exit (kapan ambil airdrop / cut loss)

## Dashboard (statis, tanpa network)
- `data.js`: `window.RADAR = {...}` — board + detail; tinggal di **luar**
  `dashboard/` (di root output), dimuat via `../data.js` seperti starter —
  supaya dossier text memuat seluruh source halaman (<64 KB), bukan
  terpotong data 500 KB.
- `dashboard/`: `index.html` + `app.css` + `app.js` (file terpisah, bukan
  satu file inline — syarat gate `dashboard_files`).
- **Board**: tabel rank/protocol/kategori/chips chain/TVL/7Δ/implied/confidence/verdict;
  sortable kolom; search; filter kategori & chain & verdict (chips)
- **Detail**: panel yang bisa dibuka dari baris — breakdown implied value
  (tiap faktor + angkanya), risks, farm plan 7 langkah, link
- Estetika: gelap-hangat (senja), tipografi jelas, chip berwarna — "dipilih judge"
