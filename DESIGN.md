# Token Radar v2 — Design

Target: beat the Token Radar top-10 line (dev 0.9605, leader 0.9668) from our
round-2 final (dev 0.8587, rank 8,033). The judge is an AI that compares two
dossiers on five criteria, in order: (1) working radar, (2) value model,
(3) farm plans, (4) dashboard as a page, (5) looks made. Every design choice
below serves one of those criteria, and every number the dashboard shows is
computed from the sealed snapshot at run time — nothing is hardcoded.

## What was wrong with round 2 (dev 0.8587, 11W/1L)

1. **Hand-picked constants, never fitted.** FDV uplift 2.0x, P(launch) table
   by category (0.30–0.85), growth weight 0.4, maturity formula — all chosen
   by hand. The judge's criterion 2 asks for a model that "follows from the
   snapshot's own figures". Round 2 derived only its category multiple from
   the snapshot.
2. **Thin board.** 178 rows (40 watchlist + 138). The snapshot holds 342
   pre-token protocols; 141 of them are bridges/CEXs/wrapped products that
   round 2 ranked anyway as "early" rows, so the top of its board mixed real
   launch candidates with products that can never launch.
3. **Farm plans were templates.** Six steps from category/chains/TVL/age,
   but no per-row costing that nets to a verdict, no deposit sizing, no
   total cost or time.
4. **No validation, no uncertainty.** No held-out test, no rank ranges, no
   method evidence on the page. The top-15 titles all brag about exactly
   this: "fitted and tested held-out twice", "walk-forward-tested",
   "comps curve tested blind", "rank ranges from 200 refits".

## The v2 model (all terms computed from the snapshot)

Snapshot: 758 protocols (as of 2026-11-14), 128 live-token comps with a
usable market cap and TVL, 342 pre-token, 40 on the watchlist.

**Ranked pool (200 rows).** Pre-token protocols that pass the watchlist's own
exclusion rule: not Bridge / Canonical Bridge / Cross Chain Bridge /
Liquid Staking / Liquid Restaking / Restaked BTC / CEX, name does not start
with an exchange, no version marker, no whole word wrapped/staked/staking.
All 40 watchlist protocols are in the pool. The other 142 pre-token protocols
(bridges, CEXs, wrapped products) are NOT ranked as launch candidates; the
dashboard lists them separately with the reason each is excluded, so all 758
protocols are accounted for (200 ranked + 142 excluded + 128 traded comps as
anchors + 272 token-recorded without a market cap in the snapshot + 16
token-recorded but with no usable market cap, mcap 0 or negative).

**Implied value** = TVL x multiple x P(launch) x growth x maturity.

- **multiple — fitted comps curve, tested held-out twice.** Log-log OLS of
  log(mcap/TVL) on log(TVL) over the 128 live comps, log-multiples winsorized
  at p5/p95, times a category residual factor: median(actual/curve) per
  category, shrunk toward 1.0 with pseudo-count 3, clamped to [0.3, 3].
  Final multiple clamped to [0.02, 5]. Held-out test: deterministic
  split-half by slug (sorted, alternating), fit on half A and test on B,
  then swap. Variants compared on median absolute log-error: flat global
  median, flat category median, curve x category. The dashboard prints all
  three errors for both directions and keeps the winner. Prototype numbers:
  curve wins both directions (1.293 / 1.073) vs flat (1.632 / 1.699).
- **P(launch) — token odds from the peers' record.** Base = the category's
  token rate (live / all in category), shrunk toward the global token rate
  (129/758 = 0.170) with pseudo-count 5. Adjusted by no-token age
  (exp(-0.08 x years since listing)) and 7-day growth
  (1 + 0.3 x clamped growth, clamped [0.5, 1.3]). Final P clamped to
  [0.05, 0.95]. Sanity check printed on the dashboard: mean P for
  live-token protocols scored as-if-pre vs pre-token protocols.
- **growth** = 1 + 0.4 x clamp(change_7d, -50, 100)/100; null change = 1.0.
  Stated assumption, not fitted (a static snapshot cannot fit it).
- **maturity** = 0.7 + 0.3 x min(age_days, 1095)/1095; unknown age = 365 days.
  Age is time listed with no token: track record if it launches (different
  meaning from the age decay inside P, which is odds it ever launches).

**Rank ranges from 200 refits.** Bootstrap the 128 live comps (seeded PRNG,
fixed seed 20261114), refit the curve and category factors each time,
recompute every implied value and rank, record each row's rank p10–p90.
Shown in the detail view as "rank 12 (range 9–18)". Deterministic: same
snapshot always gives the same bytes.

**Farm plans — costed, deposit-sized, netted to a verdict.** Six steps per
row from the protocol's category template, naming its real chains. Deposit
size by TVL band: >=$1B $500, $100M–$1B $250, $25M–$100M $100, <$25M $50.
Gas per step: $18 if a step touches Ethereum, $3 otherwise. Every step
carries its cost and time; each row shows total cost and total time.
Verdict: net = P(launch) x implied value x 0.1% (stated farmer-share
assumption) - total cost. FARM if net > 0 and P >= 0.15, THIN if net > 0
and P < 0.15, SKIP if net <= 0. The assumption is printed on the page.

## Dashboard (source budget: whole dashboard under 64 KB)

Dark radar theme, one accent. KPI strip on top: rows ranked, comps fitted,
held-out errors, watchlist coverage 40/40, snapshot date. Method section
with the validation table (all three variants, both directions) and the
assumptions list. Board table: sortable columns, search, category / chain /
verdict filters, watchlist-only toggle. Detail view per protocol (hash
#detail=<slug>): factor breakdown (TVL, multiple with comp count, P with
components, growth, maturity), implied value, rank range, farm plan with
per-step cost/time, totals, verdict. Anchors section: the 128 traded-token
comps with their actual mcap/TVL. Excluded section: the 141 with reasons.
No network anywhere: no URLs in attributes, imports or CSS; system fonts.

## Screenshots (1440x900)

1-board.png — the board with KPI strip. 2-detail.png — a protocol detail
view (#detail=steakhouse-financial). 3-filtered.png — a filtered view
(#category=Lending). Rendered with headless Chrome from a local server.

## Gate compliance

- board.json: 200 rows, ranks 1..200, implied values non-increasing,
  every watchlist slug covered, farm_steps 6 strings of 20–600 chars.
- dashboard/ under 4 MiB, no network addresses; source under 64 KB so the
  dossier shows it whole.
- screenshots 3 PNGs, 1440x900, each under 512 KiB.
- dossier.json byte-for-byte from buildDossier, under 1.5 MiB.
- Program runs twice with identical bytes (seeded PRNG, stable JSON,
  no timestamps in outputs). Paths resolved via import.meta.url and
  env/args only — never process.cwd() (the grader runs from /).
