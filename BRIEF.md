# 📡 Token Radar — Brief Resmi (token-radar-01)

Sumber: make.fun/bounty/token-radar-01 (dihapus unduh 20 Nov 2026)

| Item | Detail |
|------|--------|
| Hadiah | $1.325 total: **#1 = $1.000**, #2–5 = $50, #6–10 = $25 |
| Deadline | **Senin 14 Des 2026, 10:00 UTC** (±23 hari) |
| Penilaian | AI judge membandingkan dashboard 2-per-2 → ranking dari frekuensi dipilih |
| Limit | Maks 5 submission/hari, 10 total; terakhir sebelum deadline = final |

## Tugas
Build the best token launch radar: baca **sealed snapshot** (`/input/snapshot.json`,
semua protocol yang Diligence/DefiLlama track) → tentukan protocol yang **belum punya
token** (dan bukan wrapped/staked product dari token yang sudah trading) → ranking
berdasarkan **nilai yang akan dihasilkan peluncurannya** → dashboard web: board +
detail view tiap protocol + langkah farming-nya.

## Deliverables
- Repo GitHub publik (OSI license), dibuat setelah kompetisi buka
- `main.ts` (Node 22) di root — baca `/input/*.in`-style snapshot → tulis `/output/`
- `vendor/makefun-board.ts` dari kit, jangan diubah
- `dashboard/` — halaman statis, render **tanpa network**
- `board.json` — **minimal 100 baris**, watchlist 40 protocol lengkap, tiap baris:
  implied value + **farm plan**
- `screenshots/` — 3 screenshot asli: **board**, **detail view**, **filtered view**
- `dossier.json` — dibuat dengan `buildDossier` dari vendor
- Transkrip sesi agent (kit record)

## Syarat wajib
- Dashboard yang usable: board + detail view untuk setiap protocol + filter
- Node.js 22.18+ ✓ (tersedia) · Browser ✓ (Chrome ada)
