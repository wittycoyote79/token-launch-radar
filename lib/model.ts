// The token radar's model: one sealed snapshot in, one ranked board out.
//
// Selection. The board ranks every protocol the house's watchlist rule keeps,
// without the size floor: it records no token, it is not a wrapped, staked or
// bridged product of a token that already trades, it is not an exchange, and
// its name carries no version marker. The watchlist is the floor, never the
// ceiling: the same rule, run without the floor, is how the radar finds the
// early protocols below it. Protocols whose token already trades are kept
// apart as the live set and shown at the market's own value, never ranked.
//
// Implied value. Every figure comes from the snapshot itself:
//
//   multiple   the category's comparable multiple: the median mcap/TVL over
//              the live-token protocols of the same category (at least 3
//              comparables), else the whole market's median, clamped to
//              [0.05, 2.00]. It is derived from the snapshot on every run,
//              never a hardcoded constant.
//   base       tvl_usd * multiple
//   growth     1 + clamp(change_7d, -50, 150) / 100 * 0.6
//   maturity   0.55 + 0.45 * (1 - exp(-age_days / 540)); a protocol whose
//              listing date is unknown is scored at 365 days, the neutral
//              middle of the curve. Longer with no token, more of the base
//              counts, with diminishing returns.
//   breadth    1 + 0.04 * min(max(chains - 1, 0), 4): a protocol live on
//              more chains has more surface, capped at +16%.
//   implied    max(1, round(base * growth * maturity * breadth))
//
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard states the formula and the multiples it used.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_scale_days: 540,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 4,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  min_category_comparables: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-comparables';

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_basis: 'category' | 'market';
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The calibration the model derived from the snapshot, for the dashboard's Method view. */
export interface Calibration {
  market_multiple: number;
  market_comparables: number;
  categories: { category: string; multiple: number; comparables: number }[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  protocols_total: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The mcap/TVL ratios of the live-token protocols, grouped by category. */
function comparableRatios(protocols: SnapshotProtocol[]): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    byCategory.set(key, list);
  }
  return byCategory;
}

/**
 * The comparable multiple for one protocol: its category's median mcap/TVL
 * when the category holds enough live comparables, else the whole market's
 * median. Clamped to the model's floor and cap.
 */
export function comparableMultiple(
  protocol: SnapshotProtocol,
  ratios: Map<string, number[]>,
  marketMedian: number,
  model: ModelConstants,
): { multiple: number; basis: 'category' | 'market'; comparables: number } {
  const key = protocol.category ?? '';
  const list = ratios.get(key) ?? [];
  let multiple: number;
  let basis: 'category' | 'market';
  let comparables: number;
  if (list.length >= model.min_category_comparables) {
    multiple = median(list);
    basis = 'category';
    comparables = list.length;
  } else {
    multiple = marketMedian;
    basis = 'market';
    comparables = [...ratios.values()].reduce((n, l) => n + l.length, 0);
  }
  multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiple));
  return { multiple, basis, comparables };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratios: Map<string, number[]>,
  marketMedian: number,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  basis: 'category' | 'market';
  comparables: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  ageForModel: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const { multiple, basis, comparables } = comparableMultiple(protocol, ratios, marketMedian, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_scale_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, basis, comparables, growthPct, growthMult, maturityMult, breadthMult, age, ageForModel };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house rule treats as a wrapped, staked or bridged product of another protocol. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product's name may begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the radar may rank: the house watchlist rule
 * without the size floor. Pre-token, not a wrapped/staked/bridged product,
 * not an exchange, not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const ratios = comparableRatios(snapshot.protocols);
  const allRatios = [...ratios.values()].flat();
  const marketMedian = allRatios.length > 0 ? median(allRatios) : 0.25;
  const watchlist = new Set(snapshot.watchlist);

  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, ratios, marketMedian, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: s.v.multiple,
      multiple_basis: s.v.basis,
      comparables: s.v.comparables,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      breadth_multiplier: s.v.breadthMult,
      age_days: s.v.ageForModel,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The calibration summary the dashboard's Method view shows. */
export function calibrationOf(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios = comparableRatios(snapshot.protocols);
  const allRatios = [...ratios.values()].flat();
  const marketMedian = allRatios.length > 0 ? median(allRatios) : 0.25;
  const categories = [...ratios.entries()]
    .filter(([, list]) => list.length >= model.min_category_comparables)
    .map(([category, list]) => ({
      category: category === '' ? '(no category)' : category,
      multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, median(list)))),
      comparables: list.length,
    }))
    .sort((a, b) => b.comparables - a.comparables || (a.category < b.category ? -1 : 1));
  return {
    market_multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, marketMedian))),
    market_comparables: allRatios.length,
    categories,
  };
}

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  s = s.trim();
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Chains where a transaction costs under a dollar. */
const CHEAP_CHAINS = [
  'solana', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'bnb', 'avalanche', 'fantom',
  'gnosis', 'linea', 'scroll', 'zksync', 'blast', 'mode', 'mantle', 'berachain', 'unichain',
  'world chain', 'ink', 'abstract', 'soneium', 'sei', 'sui', 'aptos', 'near', 'cronos', 'celo',
  'moonbeam', 'aurora', 'metis', 'kava', 'evmos', 'opbnb', 'fraxtal', 'bob', 'lisk', 'redstone',
  'superseed', 'sanko', 'degen', 'apechain', 'gravity', 'hemi', 'tac', 'plasma', 'stable',
];

/** What gas costs on a chain, by its fee tier: the amount phrase the steps reuse. */
function gasAmount(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 to $25';
  if (CHEAP_CHAINS.some((n) => c.includes(n))) return 'under $1';
  return 'about $1 to $5';
}

/** A category's farming verbs: the opening position and the weekly repeat. */
interface CategoryPlay {
  match: (category: string) => boolean;
  open: string;
  weekly: string;
}

const PLAYS: CategoryPlay[] = [
  {
    match: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow'),
    open: 'Supply ${capital} of USDC to ${name} on ${chain} as a lender and leave the supply position open.',
    weekly: 'Borrow a small amount against the supply and repay it, so the position shows both sides of the market.',
  },
  {
    match: (c) => c.includes('dex') || c.includes('swap') || c.includes('liquidity manager') || c.includes('amm'),
    open: 'Add ${capital} of liquidity to ${name}’s deepest pool on ${chain}, in the pair the app routes the most volume through.',
    weekly: 'Swap a small amount through ${name} on ${chain} so the wallet shows trading activity as well as liquidity.',
  },
  {
    match: (c) => c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('leveraged farm') || c.includes('farm'),
    open: 'Deposit ${capital} into a ${name} vault on ${chain} and hold the vault shares.',
    weekly: 'Top the vault up with a small deposit each week so the position grows instead of sitting idle.',
  },
  {
    match: (c) => c.includes('bridge') || c.includes('cross chain'),
    open: 'Bridge ${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the destination app.',
    weekly: 'Bridge a small amount back or onward each week so the wallet shows repeated cross-chain use.',
  },
  {
    match: (c) => c.includes('stak') || c.includes('restak'),
    open: 'Stake ${capital} of the chain’s staking asset through ${name} on ${chain} and keep the receipt token.',
    weekly: 'Top the stake up with a small amount weekly so the staked balance keeps growing.',
  },
  {
    match: (c) => c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic'),
    open: 'Deposit ${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.',
    weekly: 'Open and close one small position a week, keeping size tiny so fees stay inside the farming budget.',
  },
  {
    match: (c) => c.includes('prediction'),
    open: 'Fund the account with ${capital} and take one position in an active market on ${name}.',
    weekly: 'Place one small position in a new market each week and let it resolve.',
  },
  {
    match: (c) => c.includes('rwa') || c.includes('real world'),
    open: 'Mint ${capital} of ${name}’s yield-bearing asset on ${chain} and hold it in the farming wallet.',
    weekly: 'Claim or compound the yield weekly so the position shows ongoing use.',
  },
  {
    match: (c) => c.includes('stable') || c.includes('algo'),
    open: 'Mint or deposit ${capital} of the stable asset through ${name} on ${chain} and hold the position.',
    weekly: 'Mint or redeem a small amount weekly to keep the position active.',
  },
  {
    match: (c) => c.includes('launchpad') || c.includes('launch'),
    open: 'Stake or lock ${capital} through ${name}’s allocation on ${chain} and join one sale.',
    weekly: 'Join each new allocation round with a small amount while the position is open.',
  },
  {
    match: (c) => c.includes('insurance'),
    open: 'Buy ${capital} of cover from ${name} on ${chain} and keep the policy for the full hold period.',
    weekly: 'Renew or extend the cover before it lapses so the wallet never shows a gap.',
  },
  {
    match: (c) => c.includes('payment') || c.includes('card'),
    open: 'Fund ${capital} through ${name} on ${chain} and make one real payment with it.',
    weekly: 'Route one payment a week through ${name} so usage is steady, not a single burst.',
  },
  {
    match: (c) => c.includes('index'),
    open: 'Buy ${capital} of ${name}’s index token on ${chain} and hold it.',
    weekly: 'Add a small amount to the index position weekly.',
  },
  {
    match: (c) => c.includes('nft') || c.includes('marketplace'),
    open: 'Make one trade through ${name} on ${chain} with ${capital} of capital and keep the activity on one wallet.',
    weekly: 'Make one marketplace action a week so the wallet shows repeat use.',
  },
  {
    match: (c) => c.includes('privacy'),
    open: 'Deposit ${capital} through ${name} on ${chain} and use the private balance for one real transfer.',
    weekly: 'Make one shielded transfer a week.',
  },
  {
    match: (c) => c.includes('ai ') || c.includes('agent') || c.includes('decentralized ai'),
    open: 'Deposit ${capital} into ${name} on ${chain} and run one agent task against the position.',
    weekly: 'Run one agent task a week and keep the position funded.',
  },
  {
    match: (c) => c.includes('governance') || c.includes('incentive') || c.includes('locker'),
    open: 'Lock or delegate ${capital} through ${name} on ${chain} and vote in one live proposal.',
    weekly: 'Vote in each new proposal while the position is open.',
  },
];

const DEFAULT_PLAY: CategoryPlay = {
  match: () => true,
  open: 'Deposit ${capital} of USDC into ${name} on ${chain} and keep the position open.',
  weekly: 'Make one qualifying action each week — a deposit, a swap, a borrow or a vote — so the wallet stays active.',
};

/** Fill a play template with the protocol's own facts. */
function fill(template: string, p: SnapshotProtocol, capital: number, chain: string): string {
  return template.replaceAll('${capital}', `$${capital}`).replaceAll('${name}', p.name).replaceAll('${chain}', chain);
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasAmount(chain);
  const category = (p.category ?? '').toLowerCase();
  const play = PLAYS.find((pl) => pl.match(category)) ?? DEFAULT_PLAY;
  return [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and keep that paper offline.',
      cost: `${gas} of gas for the first transaction`,
      time: '10 minutes',
    },
    {
      text: fill(play.open, p, capital, chain),
      cost: `$${capital} of capital plus ${gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: fill(play.weekly, p, capital, chain),
      cost: `${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: 'When the protocol opens a points or rewards page, check it from the protocol’s own site only, and never pay anyone to claim or connect a wallet from a direct message.',
      cost: 'nothing to check, and never pay to claim',
      time: '15 minutes',
    },
    {
      text: 'Keep a farm log with the wallet, the dates and every transaction hash, and unwind in two tranches at the end, leaving dust for gas.',
      cost: `${gas} of gas to unwind`,
      time: '10 minutes, plus the unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: calibrationOf(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    protocols_total: snapshot.protocols.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${byRank[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters once trimmed`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
