/**
 * TOKEN RADAR — main.ts (Node 22, runs as-is via type stripping)
 * Bounty: make.fun/bounty/token-radar-01
 *
 * Reads a sealed DefiLlama snapshot (/input/snapshot.json), finds pre-token
 * protocols, ranks them by implied launch value, writes:
 *   /output/board.json        — ranked rows (implied value + 7-step farm plan)
 *   /output/data.js           — dashboard data (window.RADAR)
 *   /output/dashboard/        — static offline dashboard
 *   /output/dossier.json      — via vendor buildDossier when available
 *
 * Deterministic: no Date.now()/Math.random() — all randomness-free.
 * Model design: see DESIGN.md. Tunables marked TUNE.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

// ---------------- input ----------------
const inputPath = process.argv[2] ?? "/input/snapshot.json";
const outDir = process.argv[3] ?? "/output";
const raw = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
const list: any[] = Array.isArray(raw) ? raw
  : Array.isArray(raw.protocols) ? raw.protocols
  : Array.isArray(raw.data) ? raw.data
  : Object.values(raw.protocols ?? {});
if (!list.length) throw new Error("no protocols found in snapshot");

// ---------------- schema (defensif; DefiLlama dump) ----------------
interface P { [k: string]: any }
const num = (v: any): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

// ---- adaptasi field snapshot segel -> field kanonik (parser saja; model tidak berubah) ----
// Snapshot segel memakai tvl_usd / mcap_usd / listed_at ("YYYY-MM-DD");
// dump mentah DefiLlama memakai tvl / mcap / listedAt (unix detik).
// Semua kode di bawah tetap membaca p.tvl / p.mcap / p.listedAt.
const parseDate = (s: any): number | null => {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s);
  return isFinite(ms) ? Math.floor(ms / 1000) : null;
};
for (const p of list) {
  if (num(p.tvl) === null && num(p.tvl_usd) !== null) p.tvl = p.tvl_usd;
  if (num(p.mcap) === null && num(p.mcap_usd) !== null) p.mcap = p.mcap_usd;
  if (num(p.listedAt) === null) {
    const d = parseDate(p.listed_at);
    if (d !== null) p.listedAt = d;
  }
}

// ---- token evidence (external, vendored) ----
// token_evidence.json dibangun SEKALI dari CoinGecko (top 10k by mcap,
// 21 Nov 2026, lihat fetch-coingecko.py) dan ikut di-commit; program
// membacanya offline — tetap deterministik, tanpa network saat jalan.
// Kalau file tidak ada, matching dilewati (board tetap jalan).
interface TokenEv { id: string; name: string; rank: number | null; market_cap: number | null }
let tokenEvidenceMap: Record<string, TokenEv[]> = {};
let evidenceAsOf = "";
try {
  const evPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "token_evidence.json");
  if (fs.existsSync(evPath)) {
    const ev = JSON.parse(fs.readFileSync(evPath, "utf-8"));
    tokenEvidenceMap = ev.entries ?? {};
    evidenceAsOf = String(ev.as_of ?? "");
  }
} catch { /* evidence opsional — board tetap jalan tanpa itu */ }

// ---------------- helpers ----------------
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const median = (a: number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const geomean = (a: number[]): number =>
  a.length ? Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length) : NaN;

// ---------------- wrapped / staked exclusion ----------------
// Aturan tunggal, mudah diaudit (DESIGN.md). Di-tune pada data DefiLlama asli 21 Nov.
const WRAP_CATS = new Set(["Liquid Staking", "Restaking", "Wrapped Tokens", "Staking"]);
const NON_FARM_CATS = new Set(["CEX", "Bridge", "Canonical Bridge", "Infrastructure", "Wallets", "Chain"]);

// ---- family key: token yang sudah trading terlihat lewat keluarga ----
// (a) simbol uppercase non-placeholder, (b) nama dasar ternormalisasi
// (lowercase, buang tanda baca, buang akhiran versi).
// Kalau ENTRI MANA PUN se-family menunjukkan bukti token (mcap>0 / cmc /
// gecko / field token), seluruh entri se-family itu sudah punya token —
// keluar dari pre-token. Menangkap Morpho/MORPHO, Sky/SKY, Ethena/ENA,
// Uniswap/UNI, Compound/COMP yang snapshot-nya sendiri tidak mencatat
// mcap/gecko untuk entri turunannya.
const normBaseName = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/v\d+(\.\d+)?$/, "");
const tokenEvidence = (p: P): boolean =>
  (num(p.mcap) ?? 0) > 0 || Boolean(p.cmcId || p.gecko_id || (p as any).token);
const familyKeys = (p: P): string[] => {
  const keys: string[] = [];
  const sym = String(p.symbol ?? "").toUpperCase();
  if (sym && sym !== "-" && sym.length >= 2) keys.push("sym:" + sym);
  const base = normBaseName(String(p.name ?? ""));
  if (base.length >= 3) keys.push("name:" + base);
  return keys;
};
const familyHasToken = new Map<string, boolean>();
for (const p of list) {
  if (!tokenEvidence(p)) continue;
  for (const k of familyKeys(p)) familyHasToken.set(k, true);
}
function hasToken(p: P): boolean {
  if (tokenEvidence(p)) return true;
  return familyKeys(p).some((k) => familyHasToken.get(k) === true);
}
function hasTokenRaw(p: P): boolean {
  return tokenEvidence(p);
}

// nama berversi, selaras aturan watchlist resmi: V2/V3/… di akhir nama
const VARIANT_RE = /\bV[0-9]+(\.[0-9]+)?$/i;
const isVariant = (p: P): boolean => VARIANT_RE.test(String(p.name ?? ""));

// ---- matching token evidence (vendored) ----
// Normalisasi nama: lowercase, buang tanda baca, buang kata umum.
const normNameLoose = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["v2", "v3", "v4", "finance", "protocol", "lab", "labs"].includes(w))
    .join("");
const nameSimilar = (a: string, b: string): boolean => {
  const x = normNameLoose(a), y = normNameLoose(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
};
function matchTokenEvidence(p: P): { strong: boolean; ev: TokenEv | null; ambiguous: boolean } {
  const sym = String(p.symbol ?? "").toUpperCase();
  if (!sym || sym === "-") return { strong: false, ev: null, ambiguous: false };
  const cands = tokenEvidenceMap[sym];
  if (!cands || !cands.length) return { strong: false, ev: null, ambiguous: false };
  const sorted = [...cands].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const best = sorted[0];
  if (cands.length === 1) return { strong: true, ev: best, ambiguous: false };
  if (best.rank !== null && best.rank <= 500) return { strong: true, ev: best, ambiguous: false };
  const sim = sorted.find((c) => nameSimilar(c.name, String(p.name ?? "")));
  if (sim) return { strong: true, ev: sim, ambiguous: false };
  return { strong: false, ev: best, ambiguous: true };
}
function isWrappedOrStaked(p: P): boolean {
  const name = String(p.name ?? "");
  const sym = String(p.symbol ?? "");
  const cat = String(p.category ?? "");
  if (WRAP_CATS.has(cat)) {
    return /^(wrapped|staked|st[A-Z]|w[A-Z]{2,})/.test(sym)
      || /(^|[^a-z])(wrapped|staked)([^a-z]|$)/i.test(name);
  }
  return /^(wrapped|staked)([^a-z]|$)/i.test(name)
    || /^st[A-Z]/.test(sym) && sym.length <= 6
    || /^W[A-Z0-9]{3,}$/.test(sym); // WBTC, WSTETH, ... wrapped er
}

// ---------------- split: pre-token vs comps ----------------
const pre: P[] = [];
const comps: P[] = [];
for (const p of list) {
  if (hasTokenRaw(p)) comps.push(p);
  else if (!hasToken(p) && !isWrappedOrStaked(p)) pre.push(p);
}

// ---------------- comps model ----------------
const globalRatios: number[] = [];
const byCat = new Map<string, { ratios: number[]; tvls: number[] }>();
for (const c of comps) {
  const m = num(c.mcap), t = num(c.tvl);
  if (m === null || t === null || t <= 0) continue;
  const r = clamp(m / t, 1, 500);
  globalRatios.push(r);
  const cat = String(c.category ?? "Unknown");
  const b = byCat.get(cat) ?? { ratios: [], tvls: [] };
  b.ratios.push(r); b.tvls.push(t);
  byCat.set(cat, b);
}
const globalG = geomean(globalRatios) || 2;
const catInfo = new Map<string, { multiple: number; refTVL: number; n: number }>();
for (const [cat, b] of byCat) {
  const g = geomean(b.ratios);
  const n = b.ratios.length;
  const shrink = n / (n + 10);                     // TUNE
  catInfo.set(cat, {
    multiple: Math.exp(Math.log(g) * shrink + Math.log(globalG) * (1 - shrink)),
    refTVL: median(b.tvls) || 100e6,
    n,
  });
}
const globalRefTVL = median(globalRatios.map(() => 100e6)); // fallback konstanta

function multipleFor(cat: string, tvl: number): { m: number; comps: number } {
  const info = catInfo.get(cat);
  if (!info) return { m: globalG, comps: 0 };
  const sizeFactor = Math.pow(info.refTVL / Math.max(tvl, info.refTVL), 0.35); // TUNE slope
  return { m: clamp(info.multiple * sizeFactor, 0.05, 3), comps: info.n };
}

// ---------------- growth / maturity / breadth ----------------
function change7dFrac(p: P): number | null {
  // change_7d SELALU persen di semua sumber (DefiLlama: -10.59 = -10.59%).
  // Heuristik lama (|x|>2 -> /100) dihapus 21 Nov 2026: salah baca satuan
  // untuk |x|<=2 (mis. +1.34% dibaca 1.34 -> growth 2.2x).
  let c = num(p.change_7d);
  if (c === null) c = num(p.change_7d_pct);
  if (c === null) return null;
  return c / 100;
}
function growth(p: P): number {
  const c = change7dFrac(p);
  if (c === null) return 1;
  return 1 + clamp(c, -0.6, 1.2);
}
// snapshot reference date: dari field tanggal snapshot, atau proxy max(listedAt)
// snapshot reference date: argv[4] (unix detik) > field tanggal > proxy max(listedAt)
const refDate: number =
  (num(process.argv[4]) ?? num(raw.date) ?? num(raw.timestamp) ?? num(raw.snapshot_time) ??
    parseDate(raw.as_of) ??
    Math.max(...list.map((p: P) => num(p.listedAt) ?? 0))) ||
  Math.floor(Date.UTC(2026, 10, 14) / 1000); // tanggal snapshot segel bila tak ada
const DAY = 86400, MONTH = 30.4 * DAY;
function maturity(p: P): number {
  const listed = num(p.listedAt);
  if (listed === null) return 1.0;
  const months = Math.max(0, (refDate - listed) / MONTH);
  return clamp(0.90 + 0.05 * Math.log1p(months), 0.90, 1.15);
}
const breadth = (p: P): number =>
  0.95 + 0.05 * Math.min((p.chains ?? []).length, 6);

// ---------------- scoring ----------------
const WATCHLIST_FLOOR = 50e6;
const MIN_TVL = 1e6; // TUNE: baris di bawah $1M TVL tidak meaningful — buang (board tetap ≥100 baris)
const rows = pre.map((p) => {
  const tvl = num(p.tvl) ?? 0;
  const cat = String(p.category ?? "Unknown");
  const { m, comps: nComps } = multipleFor(cat, tvl);
  const g = growth(p), mat = maturity(p), br = breadth(p);
  const implied = tvl * m * g * mat * br;
  const conf: "HIGH" | "MEDIUM" | "LOW" =
    nComps >= 3 && num(p.change_7d) !== null ? "HIGH" : nComps >= 1 ? "MEDIUM" : "LOW";
  const chains: string[] = Array.isArray(p.chains) ? p.chains.map(String) : [];
  const row = {
    rank: 0,
    slug: String(p.slug ?? ""),
    name: String(p.name ?? "(unnamed)"),
    symbol: String(p.symbol ?? ""),
    category: cat,
    chains,
    tvl,
    change7d: change7dFrac(p),
    multiple: +m.toFixed(3),
    growth: +g.toFixed(3),
    maturity: +mat.toFixed(3),
    breadth: +br.toFixed(3),
    implied: Math.round(implied),
    implied_value_usd: Math.round(implied),
    confidence: conf,
    verdict: "",
    variant: isVariant(p),
    watchlist: tvl >= WATCHLIST_FLOOR && !isVariant(p),
    risks: risksOf(p, nComps),
    plan: [] as string[],
    farm_steps: [] as string[],
  };
  return row;
});

function risksOf(p: P, nComps: number): string[] {
  const r: string[] = [];
  if (nComps === 0) r.push("Tidak ada comps satu kategori — multiple pakai global");
  if (num(p.change_7d) === null) r.push("Data perubahan TVL 7 hari tidak tersedia");
  if ((num(p.tvl) ?? 0) < 10e6) r.push("TVL kecil — insentif farming bisa tipis");
  if (!p.url && !p.twitter) r.push("Kanal resmi tidak terdata — verifikasi manual");
  return r;
}

// verdict
for (const r of rows) {
  const nonFarm = NON_FARM_CATS.has(r.category);
  if (nonFarm) r.risks.push(`Kategori "${r.category}" tidak farmable DeFi — diprioritaskan rendah`);
  r.verdict = (!nonFarm && ((r.implied >= 75e6 && r.confidence !== "LOW") || r.implied >= 150e6)) ? "FARM"
    : !nonFarm && r.implied >= 15e6 ? "THIN" : "SKIP";
  if (r.variant && r.verdict === "FARM") {
    r.verdict = "THIN";
    r.risks.push("Nama berversi (V2/V3/…) — verdict maksimal THIN, selaras aturan watchlist resmi");
  }
  // token evidence (vendored): token sudah trading -> bukan pre-token.
  // Verdict di-cap THIN (FARM->THIN; THIN/SKIP tidak naik), confidence
  // turun satu tingkat, risk #1 mencatat buktinya.
  const m = matchTokenEvidence(r);
  if (m.strong && m.ev) {
    (r as any).tokenEvidence = { symbol: r.symbol, id: m.ev.id, name: m.ev.name, rank: m.ev.rank, market_cap: m.ev.market_cap };
    if (r.verdict === "FARM") r.verdict = "THIN";
    r.confidence = r.confidence === "HIGH" ? "MEDIUM" : r.confidence === "MEDIUM" ? "LOW" : "LOW";
    r.risks.unshift(`Token ${r.symbol} sudah diperdagangkan (evidence: ${m.ev.id}, rank ${m.ev.rank === null || m.ev.rank === undefined ? "n/a" : m.ev.rank}, data pasar per ${evidenceAsOf})`);
  } else if (m.ambiguous) {
    r.risks.push(`Ticker ${r.symbol} ambigu di data pasar`);
  }
}

// farm plan: dibuat SETELAH verdict supaya "risiko inti" (langkah 1)
// merujuk ke risk #1 final (termasuk bukti token kalau ada).
for (const r of rows) { r.plan = farmPlan(r); r.farm_steps = r.plan.map(normStep); }

// Kategori yang tidak masuk board sama sekali (bukan cuma SKIP):
// CEX/Bridge/Canonical Bridge/Infrastructure/Wallets — kalau masuk,
// baris Bridge raksasa (LayerZero V2, Coinbase Bridge, WBTC, ...) akan
// mendominasi top-10 sebagai SKIP. "Chain" TIDAK dikecualikan: 2 slug
// watchlist (hive-protocol, noble) berkategori Chain.
const BOARD_EXCLUDE_CATS = new Set(["CEX", "Bridge", "Canonical Bridge", "Infrastructure", "Wallets"]);

// ranking: implied desc MURNI (gate: implied tidak boleh naik seiring rank).
// Verdict (FARM/THIN/SKIP) tetap jadi badge per baris, bukan urutan rank.
rows.sort((a, b) => (b.implied - a.implied) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
rows.forEach((r, i) => (r.rank = i + 1));
const keep = rows.filter((r) => r.tvl >= MIN_TVL && !BOARD_EXCLUDE_CATS.has(r.category));
keep.forEach((r, i) => (r.rank = i + 1));

// farm plan (7 langkah, digenerate dari data asli)
function farmPlan(r: (typeof rows)[0]): string[] {
  const chain = r.chains[0] ?? "chain terbesar (cek DefiLlama)";
  const byCatPlan: Record<string, string> = {
    "Dexes": "Sediakan likuiditas di pool utama; imbangi risiko IL",
    "Lending": "Deposit di market paling likuid; awasi utilisasi & rate",
    "Perpetuals": "Coba trading kecil; cek fee rebate / points trading",
    "Yield": "Masuk vault utama; pahami strategi underlying",
    "Bridge": "Jadilah user bridge; catat volume transaksi",
    "RWA": "Cek syarat KYC & minimum deposit",
    "Liquid Staking": "Bagi deposit bertahap; pantau rate stake",
  };
  const s3 = byCatPlan[r.category] ?? "Deposit ke fitur utamanya; mulai kecil";
  return [
    `1. Kenali protocol: baca dokumen & audit; risiko inti: ${r.risks[0] ?? "standar"}`,
    `2. Pilih chain: mulai dari ${chain}${r.chains.length > 1 ? ` (juga aktif di ${r.chains.slice(1, 3).join(", ")})` : ""}`,
    `3. Strategi: ${s3}`,
    `4. Lacak insentif: pantau X/Discord resmi untuk program poin/token`,
    `5. Ukuran posisi: maks ${r.tvl >= 100e6 ? "0.5–1%" : "1–2%"} dari porto (TVL ${fmt$(r.tvl)})`,
    `6. Sinyal launch: pantua governance/snapshot; siapkan wallet yang dipakai farming`,
    `7. Exit: jual airdrop terhadap rencana; kelurk deposit bertahap`,
  ];
}
function fmt$(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n)}`;
}
// farm_steps (gate): 3-12 string, tiap string 20-600 karakter setelah trim.
// Prefix "N. " dibuang (array sudah berurutan); yang kepanjangan dipotong,
// yang kependekan dilengkapi — mengikuti stepText starter.
function normStep(s: string): string {
  let t = s.replace(/^\d+\.\s*/, "").trim();
  if (t.length > 600) t = t.slice(0, 597).trimEnd() + "...";
  if (t.length < 20) t = t + " Hold the position and check the protocol's own page.";
  return t;
}

// ---------------- outputs ----------------
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "dashboard"), { recursive: true });

// already_trading: ticker + evidence yang kena aturan token evidence
// (hanya baris yang tampil di board) — transparansi penuh.
const atMap = new Map<string, { symbol: string; id: string; name: string; rank: number | null; market_cap: number | null; protocols: string[] }>();
for (const r of keep) {
  const te = (r as any).tokenEvidence;
  if (!te) continue;
  const key = String(te.symbol).toUpperCase();
  const cur = atMap.get(key) ?? { symbol: key, id: te.id, name: te.name, rank: te.rank, market_cap: te.market_cap, protocols: [] as string[] };
  if (!cur.protocols.includes(r.name)) cur.protocols.push(r.name);
  atMap.set(key, cur);
}
const alreadyTrading = [...atMap.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));

const board = {
  model: "radar-v1 (DESIGN.md)",
  rows: keep,
  watchlistCovered: keep.filter((r) => r.watchlist).length,
  already_trading: alreadyTrading,
};
fs.writeFileSync(path.join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n");

const dataJs = "// generated by main.ts — data for dashboard/index.html\n" +
  "window.RADAR = " + JSON.stringify({
    model: board.model,
    rows: keep,
    stats: {
      total: keep.length,
      watchlist: board.watchlistCovered,
      farm: keep.filter((r) => r.verdict === "FARM").length,
      thin: keep.filter((r) => r.verdict === "THIN").length,
      skip: keep.filter((r) => r.verdict === "SKIP").length,
    },
  }) + ";\n";
fs.writeFileSync(path.join(outDir, "data.js"), dataJs);
// data.js HANYA di out/data.js (bukan di dashboard/): dashboard memuatnya
// via ../data.js (seperti starter) supaya dossier text memuat seluruh
// source halaman, bukan terpotong data 500 KB.

// dashboard statis: salin SELURUH isi dashboard/ (index.html + app.css + app.js)
const dashDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard");
if (fs.existsSync(path.join(dashDir, "index.html"))) {
  for (const f of fs.readdirSync(dashDir)) {
    const src = path.join(dashDir, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(outDir, "dashboard", f));
  }
} else {
  // fallback: tulis versi minimal agar out/ tetap valid
  fs.writeFileSync(path.join(outDir, "dashboard", "index.html"),
    "<!doctype html><meta charset=utf-8><title>Token Radar</title>" +
    "<script src='../data.js'></script><p>Board: lihat board.json (dashboard lengkap: taruh dashboard/index.html di sebelah main.ts)</p>");
}

// screenshots: salin ke out/ (dibutuhkan buildDossier)
const shotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
if (fs.existsSync(shotsDir)) {
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  for (const f of fs.readdirSync(shotsDir)) {
    const src = path.join(shotsDir, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(outDir, "screenshots", f));
  }
}

// dossier: byte-for-byte apa yang buildDossier tulis dari out/dashboard/ +
// out/screenshots/ (caps = starter). Gagal di sini tidak mematikan board.
try {
  fs.writeFileSync(path.join(outDir, "dossier.json"), buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  }));
} catch (e) {
  console.warn(`[token-radar] dossier gagal: ${e instanceof Error ? e.message : String(e)}`);
}

console.log(`[token-radar] rows=${rows.length} watchlist=${board.watchlistCovered} ` +
  `FARM=${rows.filter((r) => r.verdict === "FARM").length} already_trading=${alreadyTrading.length} -> ${outDir}`);
