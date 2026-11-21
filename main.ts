// Token Radar — main.ts
//
// Build the best token launch radar (make.fun bounty token-radar-01).
// Reads a sealed DefiLlama snapshot of the protocol universe plus a vendored
// CoinGecko evidence file, scores every protocol, and writes a ranked board
// (board.json), the dashboard's data (data.js), a copy of dashboard/ and
// screenshots/, and a dossier (dossier.json) into the output directory.
//
// The program is offline and deterministic: the same input bytes always
// produce byte-identical outputs. Node.js 22, standard library only.
//
// Usage: node main.ts [snapshot-path] [output-dir]
//   snapshot-path defaults to /input/snapshot.json
//   output-dir    defaults to /output
// The evidence file token_evidence.json is read from this file's own
// directory (the repository root).

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

// ---------------------------------------------------------------------------
// Tunables (calibrated; see DESIGN.md for why each value is what it is)
// ---------------------------------------------------------------------------

// TVL -> market-cap ratios are wild (a few protocols sit at 20-40x), so the
// ratio is clamped before any averaging. A 15x cap keeps one outlier from
// owning its whole category's multiple while leaving ordinary ratios alone.
const RATIO_MIN = 1;
const RATIO_MAX = 15;
// How strongly a category's own multiple is trusted over the global one:
// shrunk = category^(n/(n+PRIOR)) * global^(PRIOR/(n+PRIOR)).
const SHRINK_PRIOR = 10;
// Size slope: bigger protocols earn a lower multiple than their category's
// typical one. multiple *= (refTVL / max(TVL, refTVL)) ^ SLOPE.
const SIZE_SLOPE = 0.35;
// Median TVL used when a category has no comps at all.
const FALLBACK_REF_TVL = 100_000_000;
// Verdict thresholds, in whole US dollars.
const FARM_MIN = 75_000_000;
const FARM_MIN_ANY_CONFIDENCE = 150_000_000;
const THIN_MIN = 15_000_000;
// A row is a "small TVL" row below this line.
const SMALL_TVL = 10_000_000;
// Position-size bands switch at this TVL.
const BIG_POSITION_TVL = 100_000_000;

// Categories that never reach the board: exchanges, bridges and wallets are
// not pre-token protocols waiting on a launch of their own.
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Infrastructure',
  'Wallets',
]);

// A name ends in a version marker: a space followed by V2, v2, 2.0 or the
// like. Such rows are variants, never the main row of their family.
const VERSION_SUFFIX = /\bV[0-9]+(\.[0-9]+)?$/i;
// Whole words that mark a wrapped / staked product of another token.
const WRAPPED_WORD = /\b(wrapped|staked)\b/i;
const STAKED_BASE_ASSET = /\bStaked (SOL|ETH)\b/;

// Words that carry no meaning when comparing a protocol name with a token
// name (dropped before the similarity check).
const GENERIC_WORDS = new Set([
  'v2',
  'v3',
  'finance',
  'protocol',
  'labs',
  'lab',
  'network',
  'token',
  'app',
  'exchange',
  'dex',
  'platform',
]);

// Dossier caps from the kit (see the competition's requirements).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  dashboard: { max_files: 993, max_bytes: 50331648 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

interface EvidenceCandidate {
  id: string;
  name: string;
  rank: number;
  market_cap: number;
}

interface EvidenceFile {
  as_of: string;
  source: string;
  entries: Record<string, EvidenceCandidate[]>;
}

interface TokenEvidence {
  symbol: string;
  id: string;
  name: string;
  rank: number;
  market_cap: number;
}

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  symbol: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  multiple: number;
  growth: number;
  maturity: number;
  breadth: number;
  implied: number;
  implied_value_usd: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  verdict: 'FARM' | 'THIN' | 'SKIP';
  variant: boolean;
  watchlist: boolean;
  risks: string[];
  plan: string[];
  farm_steps: string[];
  tokenEvidence: TokenEvidence | null;
}

interface Board {
  model: string;
  rows: BoardRow[];
  watchlistCovered: number;
  already_trading: AlreadyTrading[];
}

interface AlreadyTrading {
  symbol: string;
  id: string;
  name: string;
  rank: number;
  market_cap: number;
  protocols: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function geomean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += Math.log(value);
  return Math.exp(sum / values.length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function isVariant(name: string): boolean {
  return VERSION_SUFFIX.test(name);
}

/**
 * Is this protocol a wrapped / staked product of another token, rather than
 * a protocol of its own? Two shapes: the name carries a whole word
 * "wrapped" or "staked" and the protocol records no token symbol of its own
 * (its symbol, if any, is the product it wraps), or the name ends in a
 * staked base asset ("Staked SOL", "Staked ETH"). A protocol whose name
 * says "staking" but which carries its own symbol is its own staking
 * product and stays in.
 */
function isWrappedOrStaked(protocol: SnapshotProtocol): boolean {
  if (!protocol.symbol && WRAPPED_WORD.test(protocol.name)) return true;
  if (STAKED_BASE_ASSET.test(protocol.name)) return true;
  return false;
}

/**
 * Normalise a name for comparison: lowercase, drop punctuation, drop
 * generic words and bare version words, then join with no separator.
 * "Morpho Blue" and "Morpho" then share the string "morpho".
 */
function comparableName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !GENERIC_WORDS.has(word))
    .filter((word) => !/^v\d+$/.test(word));
  return words.join('');
}

/** "$2.8B" / "$1.6B" / "$8.2M": one decimal, rounded. */
function shortDollars(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${(value / 1_000).toFixed(1)}K`;
}

// ---------------------------------------------------------------------------
// Input loading
// ---------------------------------------------------------------------------

function loadSnapshot(path: string): Snapshot {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  return parsed;
}

function loadEvidence(path: string): EvidenceFile {
  if (!existsSync(path)) return { as_of: '', source: '', entries: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as EvidenceFile;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

interface CategoryStats {
  // Comps for the multiple: same-category protocols that already have a
  // token AND a recorded market cap, so a ratio mcap/tvl exists.
  compRatios: number[];
  compTvls: number[];
  // Token-bearers for confidence: same-category protocols that record any
  // token at all (a market cap or a CoinGecko id). A category can record a
  // token without recording its market cap, and that still counts as a
  // neighbour to learn from.
  tokenBearers: number;
}

/**
 * The implied value of a protocol's eventual token, from the model in
 * DESIGN.md: TVL x multiple x growth x maturity x breadth.
 *
 * multiple: the category's TVL->market-cap multiple, shrunk toward the
 * global multiple, then bent down for protocols bigger than their
 * category's typical comp. growth: the 7-day TVL change, always in per
 * cent in every source (12.5 means +12.5%, never a fraction). maturity:
 * older pre-token protocols are worth a little more. breadth: more chains
 * are worth a little more.
 */
function buildCategoryStats(protocols: SnapshotProtocol[]): Map<string, CategoryStats> {
  const stats = new Map<string, CategoryStats>();
  for (const protocol of protocols) {
    if (protocol.category === null) continue;
    let entry = stats.get(protocol.category);
    if (!entry) {
      entry = { compRatios: [], compTvls: [], tokenBearers: 0 };
      stats.set(protocol.category, entry);
    }
    if (protocol.tvl_usd > 0 && (protocol.mcap_usd !== null || protocol.gecko_id !== null)) {
      entry.tokenBearers += 1;
    }
    if (protocol.tvl_usd > 0 && protocol.mcap_usd !== null && protocol.mcap_usd > 0) {
      entry.compRatios.push(clamp(protocol.mcap_usd / protocol.tvl_usd, RATIO_MIN, RATIO_MAX));
      entry.compTvls.push(protocol.tvl_usd);
    }
  }
  return stats;
}

function globalMultiple(protocols: SnapshotProtocol[]): number {
  const ratios: number[] = [];
  for (const protocol of protocols) {
    if (protocol.tvl_usd > 0 && protocol.mcap_usd !== null && protocol.mcap_usd > 0) {
      ratios.push(clamp(protocol.mcap_usd / protocol.tvl_usd, RATIO_MIN, RATIO_MAX));
    }
  }
  return ratios.length > 0 ? geomean(ratios) : 1;
}

function multipleFor(
  protocol: SnapshotProtocol,
  stats: CategoryStats | undefined,
  global: number,
): number {
  if (!stats || stats.compRatios.length === 0) {
    // No comps in this category: the global multiple, bent by the fallback
    // reference TVL.
    return global * Math.pow(FALLBACK_REF_TVL / Math.max(protocol.tvl_usd, FALLBACK_REF_TVL), SIZE_SLOPE);
  }
  const n = stats.compRatios.length;
  const category = geomean(stats.compRatios);
  const shrunk = Math.pow(category, n / (n + SHRINK_PRIOR)) * Math.pow(global, SHRINK_PRIOR / (n + SHRINK_PRIOR));
  const refTvl = median(stats.compTvls);
  return shrunk * Math.pow(refTvl / Math.max(protocol.tvl_usd, refTvl), SIZE_SLOPE);
}

function growthFor(protocol: SnapshotProtocol): number {
  if (protocol.change_7d === null) return 1;
  // change_7d is in per cent. Never divide by 100 twice: +1.34 means
  // +1.34%, not a 1.34x move.
  return 1 + clamp(protocol.change_7d / 100, -0.6, 1.2);
}

function maturityFor(protocol: SnapshotProtocol, asOf: string): number {
  if (protocol.listed_at === null) return 1;
  const listed = Date.parse(`${protocol.listed_at}T00:00:00Z`);
  const ref = Date.parse(`${asOf}T00:00:00Z`);
  const ageMonths = Math.max(0, (ref - listed) / 86_400_000 / 30);
  return clamp(0.9 + 0.05 * Math.log(1 + ageMonths), 0.9, 1.15);
}

function breadthFor(protocol: SnapshotProtocol): number {
  return 0.95 + 0.05 * Math.min(protocol.chains.length, 6);
}

// ---------------------------------------------------------------------------
// Token evidence
// ---------------------------------------------------------------------------

type EvidenceMatch = { kind: 'strong'; candidate: EvidenceCandidate } | { kind: 'ambiguous' } | { kind: 'none' };

/**
 * Does the vendored CoinGecko evidence say this protocol's token already
 * trades? A match is strong when the ticker has exactly one candidate, or
 * any candidate sits in the top 500 by market cap, or a candidate's name is
 * similar to the protocol's name (one comparable name contains the other).
 * Several candidates and none of those: ambiguous, which is only a risk
 * note, never evidence.
 */
function matchEvidence(protocol: SnapshotProtocol, evidence: EvidenceFile): EvidenceMatch {
  const symbol = (protocol.symbol ?? '').toUpperCase();
  if (symbol === '') return { kind: 'none' };
  const candidates = evidence.entries[symbol];
  if (!candidates || candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'strong', candidate: candidates[0]! };
  const ranked = [...candidates].sort((a, b) => a.rank - b.rank);
  for (const candidate of ranked) {
    if (candidate.rank <= 500) return { kind: 'strong', candidate };
  }
  const protocolName = comparableName(protocol.name);
  for (const candidate of ranked) {
    const candidateName = comparableName(candidate.name);
    if (candidateName !== '' && protocolName !== '' && (candidateName.includes(protocolName) || protocolName.includes(candidateName))) {
      return { kind: 'strong', candidate };
    }
  }
  return { kind: 'ambiguous' };
}

// ---------------------------------------------------------------------------
// Risks and the farm plan
// ---------------------------------------------------------------------------

function strategyFor(category: string | null): string {
  switch (category) {
    case 'Lending':
      return 'Deposit di market paling likuid; awasi utilisasi & rate';
    case 'Liquid Staking':
      return 'Bagi deposit bertahap; pantau rate stake';
    case 'RWA':
      return 'Cek syarat KYC & minimum deposit';
    case 'Yield':
      return 'Masuk vault utama; pahami strategi underlying';
    default:
      return 'Deposit ke fitur utamanya; mulai kecil';
  }
}

function buildRisks(
  protocol: SnapshotProtocol,
  evidence: EvidenceMatch,
  candidate: EvidenceCandidate | null,
  evidenceAsOf: string,
  compCount: number,
  variant: boolean,
  floorUsd: number,
): string[] {
  const risks: string[] = [];
  if (evidence.kind === 'strong' && candidate !== null) {
    risks.push(
      `Token ${(protocol.symbol ?? '').toUpperCase()} sudah diperdagangkan (evidence: ${candidate.id}, rank ${candidate.rank}, data pasar per ${evidenceAsOf})`,
    );
  }
  if (protocol.tvl_usd < SMALL_TVL) {
    risks.push('TVL kecil — insentif farming bisa tipis');
  }
  if (compCount === 0) {
    risks.push('Tidak ada comps satu kategori — multiple pakai global');
  }
  if (protocol.change_7d === null) {
    risks.push('Data perubahan TVL 7 hari tidak tersedia');
  }
  // The snapshot carries no official-channel data for any protocol.
  risks.push('Kanal resmi tidak terdata — verifikasi manual');
  if (variant && protocol.tvl_usd >= floorUsd) {
    risks.push('Nama berversi (V2/V3/…) — verdict maksimal THIN, selaras aturan watchlist resmi');
  }
  if (protocol.category === 'Chain') {
    risks.push('Kategori "Chain" tidak farmable DeFi — diprioritaskan rendah');
  }
  if (evidence.kind === 'ambiguous') {
    risks.push(`Ticker ${(protocol.symbol ?? '').toUpperCase()} ambigu di data pasar`);
  }
  return risks;
}

function buildFarmSteps(protocol: SnapshotProtocol, risks: string[]): string[] {
  const firstRisk = risks.length > 0 ? risks[0]! : 'Kanal resmi tidak terdata — verifikasi manual';
  const chains = protocol.chains;
  let chainStep = `Pilih chain: mulai dari ${chains[0] ?? 'Ethereum'}`;
  if (chains.length > 1) {
    chainStep += ` (juga aktif di ${chains.slice(1, 3).join(', ')})`;
  }
  const band = protocol.tvl_usd >= BIG_POSITION_TVL ? '0.5–1%' : '1–2%';
  return [
    `Kenali protocol: baca dokumen & audit; risiko inti: ${firstRisk}`,
    chainStep,
    `Strategi: ${strategyFor(protocol.category)}`,
    'Lacak insentif: pantau X/Discord resmi untuk program poin/token',
    `Ukuran posisi: maks ${band} dari porto (TVL ${shortDollars(protocol.tvl_usd)})`,
    'Sinyal launch: pantua governance/snapshot; siapkan wallet yang dipakai farming',
    'Exit: jual airdrop terhadap rencana; kelurk deposit bertahap',
  ];
}

function downgrade(confidence: BoardRow['confidence']): BoardRow['confidence'] {
  if (confidence === 'HIGH') return 'MEDIUM';
  if (confidence === 'MEDIUM') return 'LOW';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

function buildBoard(snapshot: Snapshot, evidence: EvidenceFile): Board {
  const floor = snapshot.floor_usd;

  // Families: one token, one family. If any member of a family records a
  // token in the snapshot (a market cap or a CoinGecko id), the whole family
  // is out of the board — a bare symbol alone is not proof.
  const proofSymbols = new Set<string>();
  for (const protocol of snapshot.protocols) {
    if ((protocol.mcap_usd !== null && protocol.mcap_usd > 0) || protocol.gecko_id !== null) {
      if (protocol.symbol) proofSymbols.add(protocol.symbol.toUpperCase());
    }
  }

  const included = snapshot.protocols.filter((protocol) => {
    if (protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category)) return false;
    if (protocol.symbol && proofSymbols.has(protocol.symbol.toUpperCase())) return false;
    if (isWrappedOrStaked(protocol)) return false;
    return true;
  });

  const categoryStats = buildCategoryStats(snapshot.protocols);
  const global = globalMultiple(snapshot.protocols);

  const rows: BoardRow[] = [];
  const tradingById = new Map<string, AlreadyTrading>();

  for (const protocol of included) {
    const stats = protocol.category === null ? undefined : categoryStats.get(protocol.category);
    const compCount = stats ? stats.compRatios.length : 0;
    const multiple = round3(multipleFor(protocol, stats, global));
    const growth = round3(growthFor(protocol));
    const maturity = round3(maturityFor(protocol, snapshot.as_of));
    const breadth = round3(breadthFor(protocol));
    const implied = Math.round(protocol.tvl_usd * multiple * growth * maturity * breadth);

    const variant = isVariant(protocol.name);
    const match = matchEvidence(protocol, evidence);
    const candidate = match.kind === 'strong' ? match.candidate : null;
    const tokenEvidence: TokenEvidence | null =
      candidate === null
        ? null
        : {
            symbol: (protocol.symbol ?? '').toUpperCase(),
            id: candidate.id,
            name: candidate.name,
            rank: candidate.rank,
            market_cap: candidate.market_cap,
          };

    // Confidence: HIGH needs at least 3 token-bearing neighbours in the
    // category plus a reported 7-day change; MEDIUM needs at least 1;
    // otherwise LOW. A strong evidence match drops it one level: a token
    // that already trades is not a pre-token bet any more.
    const bearers = stats ? stats.tokenBearers : 0;
    let confidence: BoardRow['confidence'] =
      bearers >= 3 && protocol.change_7d !== null ? 'HIGH' : bearers >= 1 ? 'MEDIUM' : 'LOW';
    if (tokenEvidence !== null) confidence = downgrade(confidence);

    // Verdict: FARM is a big implied value with usable confidence (or a
    // very big implied value whatever the confidence); THIN is a mid-sized
    // one; the rest is SKIP. Variants and already-trading rows cap at THIN,
    // and chains are forced to SKIP: a chain is not farmable DeFi.
    let verdict: BoardRow['verdict'];
    if ((implied >= FARM_MIN && confidence !== 'LOW') || implied >= FARM_MIN_ANY_CONFIDENCE) {
      verdict = 'FARM';
    } else if (implied >= THIN_MIN) {
      verdict = 'THIN';
    } else {
      verdict = 'SKIP';
    }
    if ((variant || tokenEvidence !== null) && verdict === 'FARM') verdict = 'THIN';
    if (protocol.category === 'Chain') verdict = 'SKIP';

    const risks = buildRisks(protocol, match, candidate, evidence.as_of, compCount, variant, floor);
    const farmSteps = buildFarmSteps(protocol, risks);
    const plan = farmSteps.map((step, index) => `${index + 1}. ${step}`);

    if (tokenEvidence !== null) {
      let entry = tradingById.get(tokenEvidence.id);
      if (!entry) {
        entry = {
          symbol: tokenEvidence.symbol,
          id: tokenEvidence.id,
          name: tokenEvidence.name,
          rank: tokenEvidence.rank,
          market_cap: tokenEvidence.market_cap,
          protocols: [],
        };
        tradingById.set(tokenEvidence.id, entry);
      }
      entry.protocols.push(protocol.name);
    }

    rows.push({
      rank: 0,
      slug: protocol.slug,
      name: protocol.name,
      symbol: protocol.symbol ?? '',
      category: protocol.category,
      chains: protocol.chains,
      tvl: protocol.tvl_usd,
      change7d: protocol.change_7d === null ? null : protocol.change_7d / 100,
      multiple,
      growth,
      maturity,
      breadth,
      implied,
      implied_value_usd: implied,
      confidence,
      verdict,
      variant,
      // The watchlist flag is the snapshot's own definition: at/above the
      // floor and not a versioned variant. Evidence never changes it.
      watchlist: protocol.tvl_usd >= floor && !variant,
      risks,
      plan,
      farm_steps: farmSteps,
      tokenEvidence,
    });
  }

  // Ranking is pure implied value, descending. Verdict is only a badge.
  rows.sort((a, b) => b.implied - a.implied);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  // The already-trading section lists each evidenced ticker once, biggest
  // market cap first, with the board rows that matched it (in rank order).
  const rankByName = new Map(rows.map((row) => [row.name, row.rank]));
  const alreadyTrading = [...tradingById.values()].sort((a, b) => b.market_cap - a.market_cap);
  for (const entry of alreadyTrading) {
    entry.protocols.sort((a, b) => (rankByName.get(a) ?? 0) - (rankByName.get(b) ?? 0));
  }

  return {
    model: 'radar-v1',
    rows,
    watchlistCovered: rows.filter((row) => row.watchlist).length,
    already_trading: alreadyTrading,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const snapshotPath = process.argv[2] ?? '/input/snapshot.json';
  const outDir = process.argv[3] ?? '/output';

  const snapshot = loadSnapshot(snapshotPath);
  const evidence = loadEvidence(join(repoRoot, 'token_evidence.json'));
  const board = buildBoard(snapshot, evidence);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });

  // Compact single-line JSON: board.json is machine-generated data; pretty-
  // printing it would add ~24,000 lines of whitespace without changing a value.
  const boardJson = `${JSON.stringify(board)}\n`;
  writeFileSync(join(outDir, 'board.json'), boardJson);
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(board)};\n`);

  // The dashboard is static and offline; copy it as-is.
  cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });

  // Screenshots are rendered separately (see README) and copied in when
  // they exist. The dossier needs them; without them the run still writes
  // the board, the data and the dashboard, and says so.
  const shotsDir = join(repoRoot, 'screenshots');
  const shotNames = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((name) => !name.startsWith('.')).sort()
    : [];
  if (shotNames.length > 0) {
    mkdirSync(join(outDir, 'screenshots'), { recursive: true });
    cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
    const dossier = buildDossier(outDir, DOSSIER_CAPS);
    writeFileSync(join(outDir, 'dossier.json'), dossier);
    console.log(`dossier.json written (${dossier.length} bytes)`);
  } else {
    console.log('no screenshots/ yet: dossier.json skipped (render them first, then re-run)');
  }

  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  const confidences = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of board.rows) {
    verdicts[row.verdict] += 1;
    confidences[row.confidence] += 1;
  }
  const watchlistSlugs = new Set(snapshot.watchlist);
  const watchlistPresent = board.rows.filter((row) => watchlistSlugs.has(row.slug)).length;
  console.log(`rows=${board.rows.length} watchlist=${watchlistPresent}/${snapshot.watchlist.length} covered=${board.watchlistCovered}`);
  console.log(`verdicts FARM=${verdicts.FARM} THIN=${verdicts.THIN} SKIP=${verdicts.SKIP}`);
  console.log(`confidence HIGH=${confidences.HIGH} MEDIUM=${confidences.MEDIUM} LOW=${confidences.LOW}`);
  console.log(`already_trading=${board.already_trading.length} evidence_rows=${board.rows.filter((row) => row.tokenEvidence !== null).length}`);
  console.log('top 10:');
  for (const row of board.rows.slice(0, 10)) {
    console.log(`  ${row.rank}. ${row.name} $${row.implied.toLocaleString('en-US')} ${row.verdict}`);
  }
}

main();
