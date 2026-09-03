/**
 * Claim what settled: the other half of a trading agent, and the half people
 * forget to write.
 *
 *   npm run redeem            claims every resolved market this agent holds
 *   npm run redeem -- --dry   lists what is claimable and signs nothing
 *
 * A market ends three ways and only one of them has a winner:
 *
 *   Settled          one side won. `redeem` pays the winning side at `1/pᵢ`.
 *   Failed / Voided  nobody won. `liquidate` pays BOTH sides at their own
 *                    marginal price — a different function and a different
 *                    arithmetic. It is what makes an unanswerable question
 *                    survivable rather than a total loss.
 *
 * Both work while the protocol is paused. Pause never blocks an exit; the
 * contracts have a test saying so.
 *
 * THE REPORTING TRAP THIS FILE EXISTS TO AVOID. `Claim.sharesBefore` counts
 * TRADABLE PLUS SEED. Seed shares are a liquidity provider's stake, held by the
 * Market itself rather than by OutcomeShares, so `getPosition` cannot see them
 * while `redeem` pays for them regardless — and a market's creator is usually
 * its own largest winner. Dividing the proceeds by the tradable balance alone
 * printed an implied rate of 21.01× for a market whose real rate was 1.3689×.
 * The rate below is computed against `sharesBefore`, and both halves are printed
 * so that the number can be checked by eye.
 */
import {argv} from "node:process";
import {pathToFileURL} from "node:url";
import {WAD, toWad} from "@0g-brier/protocol";
import type {BrierClient, MarketView, Outcome} from "@0g-brier/agent-kit";
import {connect, pct, shareAmount, times, tokenAmount, type AgentConfig} from "./config.js";

/**
 * What to do with one market.
 *
 * An explicit non-nullable return type and NO `default` branch, so the compiler
 * refuses this function if `MarketStatus` ever grows a case — the same
 * discipline the frontend's `Query<T>` uses. A new status that silently fell
 * through to "skip" would be an exit path nobody noticed had gone missing.
 */
export type Plan =
  | {kind: "redeem"; winner: Outcome}
  | {kind: "liquidate"}
  | {kind: "skip"; why: string};

export function planFor(market: MarketView): Plan {
  switch (market.status) {
    case "Settled":
      // The compound guard cannot prove to the type checker that a Settled
      // market has a winner, and an explicit check beats a cast: were this ever
      // to fire, the chain had recorded a settlement with no outcome, and saying
      // so is a better answer than indexing a price array with null.
      return market.winningOutcome === null
        ? {kind: "skip", why: "settled with no recorded outcome — refusing to guess which side won"}
        : {kind: "redeem", winner: market.winningOutcome};
    case "Failed":
    case "Voided":
      return {kind: "liquidate"};
    case "Open":
    case "Closed":
    case "Proposed":
    case "Disputed":
      return {kind: "skip", why: `${market.status} — not resolved, nothing to claim yet`};
  }
}

async function main(): Promise<void> {
  // `sizesOrders: false` — a claim is whatever the chain already owes, so this
  // run needs no DRY_BUDGET. Without it, `npm run redeem -- --dry` aborted.
  const {config, client} = await connect(undefined, {sizesOrders: false});

  console.log(config.dryRun ? "brier example-agent — claims, DRY RUN" : "brier example-agent — claims");
  console.log(`  chain     ${config.chainId} (${config.network}) via ${config.rpcUrl}`);
  console.log(`  wallet    ${client.canWrite ? client.address : "read-only — no key was loaded"}`);
  if (config.dryRun) {
    // The honest limit of a keyless run. A read-only client's every balance
    // question is answered for the zero address, so this pass can say which
    // markets are claimable but not whether YOU hold anything in them.
    console.log(
      `\n  A dry run has no wallet, so holdings cannot be read. What follows is which\n` +
        `  markets are claimable, not which ones are yours.`,
    );
  }

  const markets = await client.listMarkets();
  const only = config.onlyMarket === null ? null : config.onlyMarket.toLowerCase();
  const scope = only === null ? markets : markets.filter((m) => m.address.toLowerCase() === only);
  if (only !== null && scope.length === 0) {
    console.log(`\nMARKET ${config.onlyMarket} is not on this factory.`);
    return;
  }

  let claimed = 0;
  for (const market of scope) {
    if (await settle(market, config, client)) claimed += 1;
  }
  console.log(`\n── ${claimed} claim${claimed === 1 ? "" : "s"} ${config.dryRun ? "available" : "made"} across ${scope.length} market${scope.length === 1 ? "" : "s"}`);
}

/** @returns whether this market produced a claim (or would have, in a dry run). */
async function settle(market: MarketView, config: AgentConfig, client: BrierClient): Promise<boolean> {
  const plan = planFor(market);
  if (plan.kind === "skip") return false;

  console.log(`\n${market.address}  (${market.status}, ${market.tier})`);

  if (plan.kind === "redeem") {
    const side = plan.winner === 1 ? "YES" : "NO";
    // Read BEFORE the claim. Redeeming burns the shares and moves `q`, so the
    // price this payout was struck at is only readable while the position still
    // exists.
    const price = market.marginalPriceWad[plan.winner];
    const probability = market.impliedProbabilityWad[plan.winner];

    // Tradable AND seed, because the contract burns and pays for both, and
    // `getPosition` alone sees only the first.
    const [tradable, seed] = await Promise.all([
      client.getPosition(market.address, plan.winner),
      client.getSeedShares(market.address, plan.winner),
    ]);
    const held = tradable + seed;

    console.log(`  winner    ${side} · p = ${times(price)} · P = ${pct(probability)}`);
    // `1/p`, the MARGINAL PRICE — never `1/P`, the probability. Both produce a
    // plausible multiple, and the wrong one is higher than the pool can pay: at
    // P = 59% the payout is 1.30x where `1/P` claims 1.69x, and at P = 10% it is
    // 3.16x against `1/P`'s 10.0x. This project's own spec shipped `1/P` once and
    // it was corrected.
    //
    // The counterexample is stated here rather than COMPUTED. CLAUDE.md's wording
    // is absolute — "There must be no `1/probability` anywhere in the codebase" —
    // and a divide-by-probability written to be printed as the wrong answer is
    // still the first thing a repo-wide scan trips on, indistinguishable at a
    // glance from the bug it warns about.
    console.log(`  rate      1/p = ${times((WAD * WAD) / price)} per winning share`);

    if (config.dryRun) {
      console.log(`  WOULD     redeem — holdings unknown without a wallet`);
      return true;
    }
    if (held === 0n) {
      console.log(`  holding   nothing on the winning side`);
      return false;
    }
    console.log(`  holding   ${shareAmount(tradable)} tradable + ${shareAmount(seed)} seed = ${shareAmount(held)} shares`);

    const claim = await client.redeem(market.address);
    report(claim.hash, claim.tokensReceived, claim.sharesBefore, tradable, seed, market);
    console.log(`            the rate above is 1/p; measured against sharesBefore, which counts seed`);
    return true;
  }

  // Failed or Voided. Nobody won, so nobody is paid at 1/p — each side exits at
  // its own marginal price, on both outcomes at once.
  console.log(`  ${market.status.toLowerCase()} — no winner. Both sides exit at their own price.`);
  if (config.dryRun) {
    console.log(`  WOULD     liquidate — holdings unknown without a wallet`);
    return true;
  }
  const [no, yes, seedNo, seedYes] = await Promise.all([
    client.getPosition(market.address, 0),
    client.getPosition(market.address, 1),
    client.getSeedShares(market.address, 0),
    client.getSeedShares(market.address, 1),
  ]);
  const tradable = no + yes;
  const seed = seedNo + seedYes;
  if (tradable + seed === 0n) {
    console.log(`  holding   nothing on either side`);
    return false;
  }
  console.log(
    `  holding   ${shareAmount(no)} NO + ${shareAmount(yes)} YES tradable, ` +
      `${shareAmount(seed)} seed`,
  );
  const claim = await client.liquidate(market.address);
  report(claim.hash, claim.tokensReceived, claim.sharesBefore, tradable, seed, market);
  return true;
}

/**
 * The claim, and the rate it actually paid.
 *
 * The divisor is `sharesBefore` — tradable plus seed, as the SDK returns it —
 * and the two halves are printed beside it so a reader can see why the numerator
 * and the denominator count the same shares. Using the tradable balance alone
 * here is the 21.01× bug, and it is a reporting bug rather than a trading one:
 * the money was always right, only the multiple printed beside it was wrong.
 */
function report(
  hash: `0x${string}`,
  tokensReceived: bigint,
  sharesBefore: bigint,
  tradable: bigint,
  seed: bigint,
  market: MarketView,
): void {
  const d = market.collateralDecimals;
  console.log(`  CLAIMED   ${hash}`);
  console.log(`  received  ${tokenAmount(tokensReceived, d)} ${market.collateralSymbol}`);
  console.log(`  burned    ${shareAmount(sharesBefore)} shares (${shareAmount(tradable)} tradable + ${shareAmount(seed)} seed)`);
  if (sharesBefore === 0n || tokensReceived < 0n) {
    // `tokensReceived` is measured as a balance difference, so a negative one
    // would mean collateral left the wallet during a claim. That is not a
    // number to divide by anything; it is a thing to look at.
    console.log(`  rate      unavailable — ${sharesBefore === 0n ? "no shares burned" : "the balance fell during the claim"}`);
    return;
  }
  console.log(`  rate      ${times(measuredRateWad({tokensReceived, decimals: d, sharesBefore}))} per share, measured`);
}

/**
 * What the claim actually paid, per share burned.
 *
 * DIVIDE BY `Claim.sharesBefore`, which counts TRADABLE PLUS SEED. The seed half
 * is easy to miss because it is held by the Market rather than by OutcomeShares,
 * so `getPosition` does not see it while `redeem` pays for it regardless — and the
 * creator of a market is usually its largest winner. Dividing the proceeds by the
 * tradable balance alone once printed an implied rate of 21.01x for a market whose
 * real rate was 1.3689x, which is a fifteen-fold overstatement of the return.
 *
 * Wad throughout: collateral is converted up to wad first, because shares are
 * always 18 decimals and collateral is whatever the token says (6 for the mock
 * USDC on Galileo, 18 for W0G).
 */
export function measuredRateWad(args: {
  tokensReceived: bigint;
  decimals: number;
  sharesBefore: bigint;
}): bigint {
  if (args.sharesBefore === 0n) throw new Error("measuredRateWad: no shares were burned");
  return (toWad(args.tokensReceived, args.decimals) * WAD) / args.sharesBefore;
}

// Run only when this file IS the command. `planFor` above is exported so it can
// be tested exhaustively over every MarketStatus, which a module that connected
// to a chain on import could not be.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  await main().catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
