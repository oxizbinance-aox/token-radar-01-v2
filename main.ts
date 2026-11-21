// Token Radar v2 — entrypoint.
// Reads the sealed snapshot, fits the value model from its own figures,
// ranks the pre-token protocols, and writes the board + dashboard + dossier.
// Node 22, standard library only. Deterministic: two runs write identical bytes.
// Paths come from argv/env and import.meta.url only — never process.cwd().
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  type Snapshot,
  type SnapshotProtocol,
  type BoardRow,
  type MethodNumbers,
  stableStringify,
  isPreToken,
  isLiveComp,
  exclusionReason,
  fitModel,
  buildOddsContext,
  impliedValue,
  buildFarmPlan,
  farmVerdict,
  validateHeldOut,
  bootstrapRankRanges,
  ageDays,
  launchOdds,
} from './lib/model.ts';

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
const SEED = 20261114;

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) output = argv[++i];
  }
  return { input, output };
}

function resolveSnapshotPath(input: string): string {
  if (existsSync(input) && statSync(input).isDirectory()) return join(input, 'snapshot.json');
  return input;
}

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dst, entry);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshotPath = resolveSnapshotPath(input);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
  const asOf = new Date(snapshot.as_of + 'T00:00:00Z');
  const watchlist = new Set(snapshot.watchlist);

  const comps = snapshot.protocols.filter(isLiveComp);
  const preToken = snapshot.protocols.filter(isPreToken);
  const pool = preToken.filter((p) => exclusionReason(p) === null);
  const excluded = preToken
    .filter((p) => exclusionReason(p) !== null)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, reason: exclusionReason(p)! }));

  const model = fitModel(comps);
  const ctx = buildOddsContext(snapshot.protocols);
  const heldOut = validateHeldOut(comps);
  const ranges = bootstrapRankRanges(pool, comps, ctx, asOf, 200, SEED);

  const rows: BoardRow[] = pool
    .map((p) => {
      const { value, multiple, pLaunch, growth, maturity } = impliedValue(model, ctx, p, asOf);
      const plan = buildFarmPlan(p);
      const range = ranges.get(p.slug)!;
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: ageDays(p, asOf),
        rank: 0,
        implied_value_usd: value,
        multiple,
        p_launch: pLaunch,
        growth,
        maturity,
        rank_low: range.low,
        rank_high: range.high,
        verdict: farmVerdict(pLaunch, value, plan.totalCost),
        farm_cost_usd: plan.totalCost,
        farm_time_min: plan.totalMinutes,
        farm_steps: plan.steps,
        watchlist: watchlist.has(p.slug),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const method: MethodNumbers = {
    curve_a: model.a,
    curve_b: model.b,
    flat_median: model.flatMedian,
    winsor_low: model.winsorLow,
    winsor_high: model.winsorHigh,
    global_token_rate: ctx.globalRate,
    live_comps: comps.length,
    held_out: heldOut,
    mean_p_live: 0,
    mean_p_pre: 0,
  };

  // mean P(launch) sanity check: live-token protocols scored as-if-pre vs pre-token
  const meanLive = comps.reduce((s, p) => s + launchOdds(ctx, p, asOf), 0) / comps.length;
  const meanPre = preToken.reduce((s, p) => s + launchOdds(ctx, p, asOf), 0) / preToken.length;
  method.mean_p_live = meanLive;
  method.mean_p_pre = meanPre;

  const anchors = comps
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd! / p.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);
  const tokenNoMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null),
  ).length;
  const tokenUnusableMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd <= 0,
  ).length;

  const meta = {
    title: 'Token Radar v2 — pre-token launch radar',
    snapshot_as_of: snapshot.as_of,
    rows: rows.length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_covered: rows.filter((r) => watchlist.has(r.slug)).length,
    live_comps: comps.length,
    pre_token: preToken.length,
    excluded_pre_token: excluded.length,
    token_no_mcap: tokenNoMcap,
    token_unusable_mcap: tokenUnusableMcap,
    total_protocols: snapshot.protocols.length,
  };

  const board = { meta, rows: rows.map((r) => ({ ...r, farm_steps: r.farm_steps.map((s) => s.text) })) };
  const data = { meta, method, rows, anchors, excluded };

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), stableStringify(board) + '\n', 'utf8');
  writeFileSync(join(output, 'data.js'), 'window.TOKEN_RADAR_DATA = ' + stableStringify(data) + ';\n', 'utf8');
  copyDir(join(REPO_DIR, 'dashboard'), join(output, 'dashboard'));
  copyDir(join(REPO_DIR, 'screenshots'), join(output, 'screenshots'));
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65536 }));

  console.log(`rows=${rows.length} watchlist=${meta.watchlist_covered}/${meta.watchlist_total} comps=${comps.length}`);
  console.log(`top5=${rows.slice(0, 5).map((r) => r.name + ' $' + Math.round(r.implied_value_usd / 1e6) + 'M').join(' | ')}`);
  console.log(
    `held-out median log-err (A->B / B->A): flat ${heldOut.flat[0].toFixed(3)}/${heldOut.flat[1].toFixed(3)} ` +
      `cat-median ${heldOut.cat_median[0].toFixed(3)}/${heldOut.cat_median[1].toFixed(3)} ` +
      `curve ${heldOut.curve[0].toFixed(3)}/${heldOut.curve[1].toFixed(3)}`,
  );
  console.log(`mean P(launch): live-as-if-pre ${meanLive.toFixed(3)} vs pre-token ${meanPre.toFixed(3)}`);
  console.log(`verdicts: FARM ${rows.filter((r) => r.verdict === 'FARM').length}, THIN ${rows.filter((r) => r.verdict === 'THIN').length}, SKIP ${rows.filter((r) => r.verdict === 'SKIP').length}`);
}

main();
