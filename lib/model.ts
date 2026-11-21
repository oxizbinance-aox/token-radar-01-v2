// Token Radar v2 — value model, fitted from the sealed snapshot.
// Every term is computed from the snapshot's own figures at run time.
// No hardcoded protocol names, no network, standard library only.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmStep {
  text: string;
  cost_usd: number;
  minutes: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  multiple: number;
  p_launch: number;
  growth: number;
  maturity: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_time_min: number;
  farm_steps: FarmStep[];
}

export interface HeldOut {
  flat: [number, number];
  cat_median: [number, number];
  curve: [number, number];
}

export interface MethodNumbers {
  curve_a: number;
  curve_b: number;
  flat_median: number;
  winsor_low: number;
  winsor_high: number;
  global_token_rate: number;
  live_comps: number;
  held_out: HeldOut;
  mean_p_live: number;
  mean_p_pre: number;
}

// --- deterministic PRNG (mulberry32) ---
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- stable JSON: sorted keys, fixed formatting, no timestamps ---
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_RE = /\s(V2|v2|2\.0|V3|v3|3\.0)\s*$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return p.category + ' category';
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(ex)) return 'exchange-prefixed name';
  }
  if (VERSION_RE.test(p.name)) return 'versioned pool';
  if (WRAPPED_RE.test(p.name)) return 'wrapped / staked product';
  return null;
}

export function isLiveComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

export function ageDays(p: SnapshotProtocol, asOf: Date): number {
  if (!p.listed_at) return 365;
  const parts = p.listed_at.split('-').map(Number);
  const listed = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const days = Math.floor((asOf.getTime() - listed) / 86400000);
  return Math.max(0, days);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function logReg(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

export interface FittedModel {
  a: number;
  b: number;
  winsorLow: number;
  winsorHigh: number;
  flatMedian: number;
  catFactor: Map<string, number>;
}

export function fitModel(comps: SnapshotProtocol[]): FittedModel {
  const logMults = comps.map((p) => Math.log(p.mcap_usd! / p.tvl_usd)).sort((a, b) => a - b);
  const n = logMults.length;
  const winsorLow = logMults[Math.floor(n / 20)];
  const winsorHigh = logMults[Math.floor((19 * n) / 20)];
  const winsor = (x: number) => clamp(x, winsorLow, winsorHigh);
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => winsor(Math.log(p.mcap_usd! / p.tvl_usd)));
  const { a, b } = logReg(xs, ys);
  const flatMedian = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const pred = Math.exp(a + b * Math.log(p.tvl_usd));
    const key = p.category ?? '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(p.mcap_usd! / p.tvl_usd / pred);
  }
  const catFactor = new Map<string, number>();
  for (const [key, vals] of byCat) {
    const med = median(vals);
    catFactor.set(key, (vals.length * med + 3 * 1.0) / (vals.length + 3));
  }
  return { a, b, winsorLow, winsorHigh, flatMedian, catFactor };
}

export function predictMultiple(model: FittedModel, p: SnapshotProtocol): number {
  const curve = Math.exp(model.a + model.b * Math.log(p.tvl_usd));
  const f = clamp(model.catFactor.get(p.category ?? '') ?? 1.0, 0.3, 3.0);
  return clamp(curve * f, 0.02, 5.0);
}

export function growthFactor(p: SnapshotProtocol): number {
  if (p.change_7d === null) return 1.0;
  return 1 + 0.4 * (clamp(p.change_7d, -50, 100) / 100);
}

export function maturityFactor(ageDaysValue: number): number {
  return 0.7 + 0.3 * (Math.min(ageDaysValue, 1095) / 1095);
}

// --- part 2: launch odds, implied value, farm plans, validation ---

export interface OddsContext {
  globalRate: number;
  catTotal: Map<string, number>;
  catLive: Map<string, number>;
}

export function buildOddsContext(all: SnapshotProtocol[]): OddsContext {
  const catTotal = new Map<string, number>();
  const catLive = new Map<string, number>();
  let liveCount = 0;
  for (const p of all) {
    const key = p.category ?? '';
    catTotal.set(key, (catTotal.get(key) ?? 0) + 1);
    if (p.mcap_usd !== null && p.mcap_usd > 0) {
      liveCount++;
      catLive.set(key, (catLive.get(key) ?? 0) + 1);
    }
  }
  return { globalRate: liveCount / all.length, catTotal, catLive };
}

export function launchOdds(ctx: OddsContext, p: SnapshotProtocol, asOf: Date): number {
  const key = p.category ?? '';
  const n = ctx.catTotal.get(key) ?? 0;
  const live = ctx.catLive.get(key) ?? 0;
  const base = (live + 5 * ctx.globalRate) / (n + 5);
  const yrs = ageDays(p, asOf) / 365.25;
  const ageFactor = Math.exp(-0.08 * yrs);
  const g = p.change_7d;
  const growthAdj = g === null ? 1.0 : clamp(1 + 0.3 * (clamp(g, -50, 100) / 100), 0.5, 1.3);
  return clamp(base * ageFactor * growthAdj, 0.05, 0.95);
}

export function impliedValue(
  model: FittedModel,
  ctx: OddsContext,
  p: SnapshotProtocol,
  asOf: Date,
): { value: number; multiple: number; pLaunch: number; growth: number; maturity: number } {
  const multiple = predictMultiple(model, p);
  const pLaunch = launchOdds(ctx, p, asOf);
  const growth = growthFactor(p);
  const maturity = maturityFactor(ageDays(p, asOf));
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * pLaunch * growth * maturity));
  return { value, multiple, pLaunch, growth, maturity };
}

// --- farm plans: costed, deposit-sized, netted to a verdict ---
const FARMER_SHARE = 0.001; // stated assumption: a farmer captures 0.1% of launch value

function depositFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 100_000_000) return 250;
  if (tvl >= 25_000_000) return 100;
  return 50;
}

function gasFor(chains: string[]): number {
  return chains.includes('Ethereum') ? 18 : 3;
}

interface StepSpec {
  text: string;
  cost: number;
  minutes: number;
}

type StepFn = (name: string, chain: string, deposit: number, gas: number) => StepSpec;

const CATEGORY_STEPS: Record<string, StepFn[]> = {
  Lending: [
    (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and open ${n} (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Supply $${d} to the ${n} lending pool and keep the receipt token (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Borrow 40% of the supplied value against it and hold the loan for 30 days (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Repay the loan in full and re-supply once to prove the round trip (~$${g * 2} gas, ~10 min).`, cost: g * 2, minutes: 10 }),
    (n, c, d, g) => ({ text: `Keep the health factor above 2.0 and top up collateral if it slips (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
  Dexs: [
    (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and split it into two halves (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Swap half for the paired asset on ${n} at 0.3% slippage (~$${g + Math.round(d * 0.003)} gas and fee, ~5 min).`, cost: g + Math.round(d * 0.003), minutes: 5 }),
    (n, c, d, g) => ({ text: `Add both halves as liquidity and hold the LP position for 30 days (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Claim trading fees once a week and restake them into the pool (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Run one limit order to test the order book depth (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the LP range, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
  Yield: [
    (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and open the ${n} vault page (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Deposit $${d} into the vault and confirm the share tokens arrive (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Enable auto-compound and leave the position for 30 days (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Compare the vault APY against holding the asset directly once a week (~$0, ~10 min).`, cost: 0, minutes: 10 }),
    (n, c, d, g) => ({ text: `Withdraw a $10 test amount to prove the exit works (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
  RWA: [
    (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and finish any verification ${n} asks for (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Mint $${d} of the tokenized asset and hold it for 30 days (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Read the redemption terms and confirm the underlying custodian (~$0, ~15 min).`, cost: 0, minutes: 15 }),
    (n, c, d, g) => ({ text: `Redeem a $10 test amount to prove the exit works (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Track the asset price against its off-chain reference weekly (~$0, ~5 min).`, cost: 0, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
  Derivatives: [
    (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and open ${n} (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Open a small hedged position of $${d} notional with a stop-loss (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Hold through one funding cycle and record the funding paid (~$0, ~10 min).`, cost: 0, minutes: 10 }),
    (n, c, d, g) => ({ text: `Close the position and reopen it once to prove the round trip (~$${g * 2} gas, ~10 min).`, cost: g * 2, minutes: 10 }),
    (n, c, d, g) => ({ text: `Check open interest and liquidations for your market weekly (~$0, ~5 min).`, cost: 0, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
  CDP: [
    (n, c, d, g) => ({ text: `Bridge $${d} of collateral to ${c} and open ${n} (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
    (n, c, d, g) => ({ text: `Lock the collateral and mint stablecoins at 200% collateral ratio (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Use the minted stablecoins in a low-risk pool for 30 days (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Repay half the debt to prove the unwind path (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
    (n, c, d, g) => ({ text: `Watch the liquidation price and top up collateral if it nears it (~$0, ~5 min).`, cost: 0, minutes: 5 }),
    (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
  ],
};

const GENERIC_STEPS: StepFn[] = [
  (n, c, d, g) => ({ text: `Bridge $${d} to ${c} and open ${n} (~$${g + 4} gas and bridge fee, ~15 min).`, cost: g + 4, minutes: 15 }),
  (n, c, d, g) => ({ text: `Use the core product with $${d} and keep the receipt or position token (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
  (n, c, d, g) => ({ text: `Repeat the core action once a week for four weeks (~$${g} gas each, ~5 min each).`, cost: g, minutes: 5 }),
  (n, c, d, g) => ({ text: `Test a $10 withdrawal to prove the exit works (~$${g} gas, ~5 min).`, cost: g, minutes: 5 }),
  (n, c, d, g) => ({ text: `Join the community, vote once if a vote is live, and give feedback (~$0, ~15 min).`, cost: 0, minutes: 15 }),
  (n, c, d, g) => ({ text: `Log the position, set a 30-day reminder and check for a points page (~$0, ~10 min).`, cost: 0, minutes: 10 }),
];

export function buildFarmPlan(p: SnapshotProtocol): {
  steps: FarmStep[];
  totalCost: number;
  totalMinutes: number;
} {
  const deposit = depositFor(p.tvl_usd);
  const gas = gasFor(p.chains);
  const chain = p.chains[0] ?? 'Ethereum';
  const fns = CATEGORY_STEPS[p.category ?? ''] ?? GENERIC_STEPS;
  const steps: FarmStep[] = fns.map((fn) => {
    const st = fn(p.name, chain, deposit, gas);
    return { text: st.text, cost_usd: st.cost, minutes: st.minutes };
  });
  const totalCost = steps.reduce((s, st) => s + st.cost_usd, 0);
  const totalMinutes = steps.reduce((s, st) => s + st.minutes, 0);
  return { steps, totalCost, totalMinutes };
}

export function farmVerdict(pLaunch: number, implied: number, totalCost: number): 'FARM' | 'THIN' | 'SKIP' {
  const net = pLaunch * implied * FARMER_SHARE - totalCost;
  if (net <= 0) return 'SKIP';
  return pLaunch >= 0.15 ? 'FARM' : 'THIN';
}

// --- held-out validation: split-half by slug, both directions ---
function medianAbsLogErr(
  predict: (p: SnapshotProtocol) => number,
  items: SnapshotProtocol[],
): number {
  const errs = items.map((p) => Math.abs(Math.log(predict(p)) - Math.log(p.mcap_usd! / p.tvl_usd)));
  errs.sort((a, b) => a - b);
  const n = errs.length;
  return n % 2 === 1 ? errs[(n - 1) / 2] : (errs[n / 2 - 1] + errs[n / 2]) / 2;
}

function splitHalf(items: SnapshotProtocol[]): [SnapshotProtocol[], SnapshotProtocol[]] {
  const sorted = [...items].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const a: SnapshotProtocol[] = [];
  const b: SnapshotProtocol[] = [];
  sorted.forEach((p, i) => (i % 2 === 0 ? a : b).push(p));
  return [a, b];
}

export function validateHeldOut(comps: SnapshotProtocol[]): HeldOut {
  const [halfA, halfB] = splitHalf(comps);
  const run = (train: SnapshotProtocol[], test: SnapshotProtocol[]) => {
    const flat = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
    const flatTrain = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    const byCat = new Map<string, number[]>();
    for (const p of train) {
      const key = p.category ?? '';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(p.mcap_usd! / p.tvl_usd);
    }
    const catMed = (p: SnapshotProtocol) => {
      const vals = byCat.get(p.category ?? '');
      if (!vals) return flatTrain;
      return (vals.length * median(vals) + 3 * flatTrain) / (vals.length + 3);
    };
    const model = fitModel(train);
    const curve = (p: SnapshotProtocol) => predictMultiple(model, p);
    void flat;
    return {
      flat: medianAbsLogErr(() => flatTrain, test),
      cat_median: medianAbsLogErr(catMed, test),
      curve: medianAbsLogErr(curve, test),
    };
  };
  const r1 = run(halfA, halfB);
  const r2 = run(halfB, halfA);
  return {
    flat: [r1.flat, r2.flat],
    cat_median: [r1.cat_median, r2.cat_median],
    curve: [r1.curve, r2.curve],
  };
}

// --- bootstrap rank ranges: 200 refits, fixed seed ---
export function bootstrapRankRanges(
  pool: SnapshotProtocol[],
  comps: SnapshotProtocol[],
  ctx: OddsContext,
  asOf: Date,
  refits = 200,
  seed = 20261114,
): Map<string, { low: number; high: number }> {
  const rand = mulberry32(seed);
  const ranksBySlug = new Map<string, number[]>();
  for (const p of pool) ranksBySlug.set(p.slug, []);
  for (let r = 0; r < refits; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]);
    const model = fitModel(sample);
    const scored = pool.map((p) => ({ slug: p.slug, v: impliedValue(model, ctx, p, asOf).value }));
    scored.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => ranksBySlug.get(s.slug)!.push(i + 1));
  }
  const out = new Map<string, { low: number; high: number }>();
  for (const [slug, ranks] of ranksBySlug) {
    const sorted = [...ranks].sort((a, b) => a - b);
    out.set(slug, {
      low: sorted[Math.floor(0.1 * sorted.length)],
      high: sorted[Math.floor(0.9 * sorted.length)],
    });
  }
  return out;
}
