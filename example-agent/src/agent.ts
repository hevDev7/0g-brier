/**
 * The loop: scan → believe → edge → size → trade.
 *
 *   npm run dry        scans, reports, and signs nothing
 *   npm run agent      the same pass, with a key
 *
 * Nothing here has an opinion about the world. Every opinion comes from
 * `src/strategy.ts`, which ships refusing to form one, so an unmodified run
 * reports the whole book and buys nothing.
 *
 * THREE ARITHMETIC RULES RUN THROUGH THIS FILE, and each of them is a bug this
 * project has already paid for once:
 *
 * 1. The belief is compared against `impliedProbabilityWad`, never against
 *    `marginalPriceWad`. Brier is DPM Pennock: `Σpᵢ² = WAD`, so the probability
 *    is the SQUARE of the marginal price. An agent ported from an LMSR venue —
 *    where the two are one number — reads one for the other, mis-sizes every
 *    position, and keeps running. It just bleeds.
 *
 * 2. No payout is computed here. The prize per winning share is `1/pᵢ`, not
 *    `1/Pᵢ` — at P = 59% that is 1.30× against 1/P's 1.69× — and rather than
 *    write either, this file reads `Preview.payoutPerShareAfterWad` from the
 *    SDK, which the contracts' own differential test pins.
 *
 * 3. The prize FLOATS, so the edge is checked AFTER the order rather than
 *    before it. This is parimutuel: buying moves `p` up, which shrinks `1/p`,
 *    which shrinks the prize the order was placed to win. An edge measured at
 *    the pre-trade payout overstates itself on every single order. See
 *    `survivesItsOwnImpact` below — it is the one thing in this project most
 *    worth copying.
 */
import {argv} from "node:process";
import {pathToFileURL} from "node:url";
import {WAD, toTokensFloor, toWad} from "@0g-brier/protocol";
import {ZgStore} from "@0g-brier/zg-storage";
import type {BrierClient, MarketView, Outcome, Preview, SpecSource} from "@0g-brier/agent-kit";
import {
  connect,
  dryBudgetTokens,
  pct,
  pp,
  rate,
  short,
  shareAmount,
  times,
  tokenAmount,
  type AgentConfig,
} from "./config.js";
import {strategy, type MarketSpec, type StrategyContext} from "./strategy.js";

type Decision = "abstained" | "declined" | "traded" | "would-trade";

async function main(): Promise<void> {
  const {config, client} = await connect();
  printHeader(config, client);

  if (!(await passesTraderGate(config, client))) return;

  const markets = await client.listMarkets();
  const open = markets.filter((m) => m.status === "Open");
  const only = config.onlyMarket === null ? null : config.onlyMarket.toLowerCase();
  const scope = only === null ? open : open.filter((m) => m.address.toLowerCase() === only);

  if (only !== null && scope.length === 0) {
    // "Not found" is a poor answer when the address is right and the market has
    // simply closed, which is the usual reason a rerun stops working.
    const known = markets.find((m) => m.address.toLowerCase() === only);
    console.log(
      known === undefined
        ? `\nMARKET ${config.onlyMarket} is not on this factory.`
        : `\nMARKET ${known.address} is ${known.status}, not Open — nothing to trade.`,
    );
    return;
  }
  console.log(`\n${scope.length} Open market${scope.length === 1 ? "" : "s"} of ${markets.length} on this factory`);

  // Absent on anvil, which has no 0G Storage network — so a local run reports
  // every spec as unreadable and the shipped strategy abstains on all of them.
  // That is the honest outcome rather than a crash inside a fetch.
  const store = config.indexerUrl === null ? null : new ZgStore(config.indexerUrl);
  // One instant for the whole pass, so two markets a second apart are not judged
  // against two different clocks.
  const now = Math.floor(Date.now() / 1000);

  const tally: Record<Decision, number> = {abstained: 0, declined: 0, traded: 0, "would-trade": 0};
  for (const market of scope) {
    tally[await consider(market, {config, client, store, now})] += 1;
  }

  console.log(`\n── summary ────────────────────────────────────────────────`);
  console.log(`  no opinion   ${tally.abstained}`);
  console.log(`  declined     ${tally.declined}`);
  console.log(config.dryRun ? `  would trade  ${tally["would-trade"]}` : `  traded       ${tally.traded}`);
  if (tally.abstained === scope.length && scope.length > 0) {
    console.log(
      `\nThe strategy had no opinion on any of them. If you have not edited\n` +
        `src/strategy.ts yet, that is exactly what it ships doing — it refuses to\n` +
        `forecast rather than trade on a signal nobody designed.`,
    );
  }
}

interface Pass {
  config: AgentConfig;
  client: BrierClient;
  store: ZgStore | null;
  now: number;
}

async function consider(market: MarketView, pass: Pass): Promise<Decision> {
  const {config, client} = pass;
  const d = market.collateralDecimals;

  console.log(`\n${market.address}  (${market.tier}, ${market.category})`);
  // Both printed, side by side, because seeing them differ is the fastest way to
  // learn that they are not the same number.
  console.log(
    `  book      P(YES) ${pct(market.impliedProbabilityWad[1])}   ` +
      `marginal price ${times(market.marginalPriceWad[1])}   fee ${market.feeBps} bps`,
  );

  const spec = await readSpec(pass.store, market.specRoot);
  console.log(`  question  ${spec === null ? "(no readable spec at " + short(market.specRoot) + ")" : spec.question}`);

  const spendable = config.dryRun
    ? dryBudgetTokens(config, d)
    : await client.getBalance(market.collateral);
  // Skipped entirely in a dry run: `getPosition` would answer for the zero
  // address, and printing a stranger's zero as your own position is a lie with
  // a number on it. `unavailable` is a first-class answer in this project.
  const position: readonly [bigint, bigint] | null = config.dryRun
    ? null
    : [await client.getPosition(market.address, 0), await client.getPosition(market.address, 1)];
  console.log(
    `  wallet    ${tokenAmount(spendable, d)} ${market.collateralSymbol} ` +
      `(${config.dryRun ? "DRY_BUDGET, not a balance" : "wallet balance, nothing reserved"})` +
      (position === null ? "  ·  position unknown without a wallet" : `  ·  holding ${shareAmount(position[0])} NO / ${shareAmount(position[1])} YES`),
  );

  const ctx: StrategyContext = {
    spec,
    position,
    spendableTokens: spendable,
    spendableSource: config.dryRun ? "config" : "wallet",
    now: pass.now,
    dryRun: config.dryRun,
  };
  const belief = await strategy(market, ctx);
  if (belief === null) {
    console.log(`  belief    none — the strategy declined to have an opinion`);
    return "abstained";
  }
  console.log(`  belief    ${pct(belief.impliedProbabilityWad)} YES — ${belief.rationale}`);

  // ── rule 1: the edge is against the PROBABILITY ───────────────────────────
  //
  // A belief of 70% YES is equally a belief of 30% NO, and a book at 72.7% YES
  // is a book at 27.3% NO. Reading only the YES side of both discards half of
  // every belief and reports "no edge" on a book that is plainly mispriced the
  // other way. Because Σ probability == WAD, the two edges are one number with
  // opposite signs: at most one side is cheap, and it is not always YES.
  //
  // `market.impliedProbabilityWad` — NOT `marginalPriceWad`. The two are named
  // apart in the SDK so that reading one for the other has to be typed out on
  // purpose, and this is the line where that would happen.
  const found = edgeAgainstBook(belief.impliedProbabilityWad, market);
  if (found.kind === "no-edge") {
    console.log(`  edge      none on either side (${pct(found.myP)} against a book at ${pct(found.bookP)})`);
    return "declined";
  }
  const {outcome, bookP, myP, edgeBps} = found;
  const side = outcome === 1 ? "YES" : "NO";
  if (found.kind === "dust") {
    console.log(`  edge      on ${side}: ${pct(myP)} vs book ${pct(bookP)}`);
  // Also the one place a dust tolerance is needed, and the one case where this
  // project allows a constant: `Σ probability == WAD ± 2` exactly, because the
  // algebra makes the residue constant rather than a function of `q`. Two wei of
  // it round to nothing here, so a book that merely agrees with the belief lands
  // in this branch rather than being traded as a fractional edge.
    console.log(`            less than one basis point of edge — not worth a transaction`);
    return "declined";
  }
  console.log(`  edge      on ${side}: ${pct(myP)} vs book ${pct(bookP)} → ${pp(edgeBps)}`);

  // ── sizing: the bankroll, then the book, then the belief again ────────────
  //
  // Kelly for DPM is f* = (P̂ − P)/(1 − P). The SHAPE matches the LMSR form and
  // the variable does not: net odds here are payout/cost − 1 = (1/p)/p − 1 =
  // (1−P)/P, so the denominator is one minus the PROBABILITY. Feeding a marginal
  // price into a formula of this shape is what a ported LMSR agent does, and it
  // mis-sizes every position.
  const {kellyWad, fractionWad, budgetTokens} = stakeBudget({
    myP,
    bookP,
    spendable,
    bankrollCapBps: config.bankrollCapBps,
  });

  // Kelly sizes against the bankroll and knows nothing about depth. On a DPM
  // curve that gap is not academic: this SDK's first live order previewed a
  // Kelly-sized stake walking P(YES) 50% → 100% and the payout 1.4142× → 1.0000×,
  // destroying the edge the sizing was computed from in the act of taking it.
  // `sizeWithinImpact` is the SDK's own inversion of that, and is used here
  // rather than a formula invented locally.
  //
  // The impact ceiling is the SMALLER of the standing limit and the distance to
  // the belief — derived, not chosen. Every share bought past P̂ is one the
  // agent's own model says is overpriced, so an order that runs the book to the
  // configured cap when only 0.7pp of edge exists spends its last tokens
  // betting against itself.
  const impactCapBps = impactCapFor(edgeBps, config.maxImpactBps);
  const stakeTokens = await client.sizeWithinImpact({
    market: market.address,
    outcome,
    budgetTokens,
    maxImpactBps: impactCapBps,
  });
  console.log(
    `  size      Kelly ${rate((kellyWad * 10_000n) / WAD)} capped to ${rate((fractionWad * 10_000n) / WAD)} → ` +
      `${tokenAmount(budgetTokens, d)}; the book allows ${tokenAmount(stakeTokens, d)} within ${pp(impactCapBps)}`,
  );
  if (stakeTokens === 0n) {
    if (spendable === 0n) {
      console.log(
        `            no free ${market.collateralSymbol}. If this deployment settles in wrapped\n` +
          `            native 0G, client.wrapNative(market.collateral, amount) mints it\n` +
          `            one-for-one — native 0G has no transferFrom, so no market can hold it.`,
      );
    }
    return "declined";
  }

  // Inverted BY THE CONTRACT, not locally: the chain's quote is the thing that
  // gets signed, and a size derived from a local model would be trading a copy.
  const {sharesOut} = await client.quoteBuySpend(market.address, outcome, stakeTokens);
  if (sharesOut === 0n) {
    console.log(`            that budget buys no whole share here`);
    return "declined";
  }
  const preview = await client.previewBuy(market.address, outcome, sharesOut);
  console.log(
    `  quote     ${shareAmount(sharesOut)} ${side} shares for ${tokenAmount(preview.tokensIn, d)} ` +
      `${market.collateralSymbol} (fee ${tokenAmount(preview.feeTokens, d)})`,
  );
  console.log(
    `            P(${side}) ${pct(preview.impliedProbabilityBeforeWad)} → ${pct(preview.impliedProbabilityAfterWad)}   ` +
      `payout ${times(preview.payoutPerShareBeforeWad)} → ${times(preview.payoutPerShareAfterWad)}   ← the prize shrinks as we take it`,
  );

  // ── rule 3: does the edge survive its own impact? ─────────────────────────
  const verdict = survivesItsOwnImpact(preview, myP, market.collateralDecimals, config.minEdgeBps);
  if (!verdict.ok) {
    console.log(`  ABORT     ${verdict.why}`);
    return "declined";
  }
  console.log(
    `  survives  expected ${tokenAmount(toTokensFloor(verdict.expectedWad, d), d)} against a cost of ` +
      `${tokenAmount(preview.tokensIn, d)} → ${rate(verdict.survivingBps)} after the fee and its own impact`,
  );

  const maxTokensIn = preview.tokensIn + (preview.tokensIn * config.slippageBps) / 10_000n;

  // The bound is what gets signed, so it has to be affordable: a slippage
  // allowance above the free balance is an order whose collateral transfer
  // reverts, after gas.
  //
  // Checked BEFORE the dry-run branch and against the same number the live run
  // would use, so the two reach the same verdict. A dry run that approves an
  // order the real one refuses is worse than no dry run at all.
  if (maxTokensIn > spendable) {
    console.log(
      `  ABORT     the slippage bound ${tokenAmount(maxTokensIn, d)} is above the ` +
        `${config.dryRun ? "stated budget" : "free balance"} ${tokenAmount(spendable, d)} — ` +
        "lower SLIPPAGE_BPS or BANKROLL_CAP_BPS",
    );
    return "declined";
  }

  if (config.dryRun) {
    console.log(`  WOULD BUY ${shareAmount(sharesOut)} ${side}, maxTokensIn ${tokenAmount(maxTokensIn, d)} — dry run, nothing sent`);
    return "would-trade";
  }

  // Wrapping is not approving, and approving before every order pays gas to
  // change nothing — `ensureAllowance` returns null when there was already
  // enough.
  await client.ensureAllowance(market.address, market.collateral, maxTokensIn);
  const fill = await client.buyShares({market: market.address, outcome, sharesOut, maxTokensIn});
  console.log(`  FILLED    ${fill.hash}`);
  console.log(
    `            paid ${tokenAmount(-fill.tokensDelta, d)} ${market.collateralSymbol} · ` +
      `holding ${shareAmount(fill.sharesAfter)} ${side} · P(${side}) now ${pct(fill.impliedProbabilityAfterWad[outcome])}`,
  );
  return "traded";
}

export type Verdict =
  | {ok: true; expectedWad: bigint; survivingBps: bigint}
  | {ok: false; why: string};

/**
 * THE CHECK THE REST OF THIS PROJECT EXISTS TO REACH.
 *
 * The edge that justified the order was measured against the book as it stood
 * BEFORE the order. Brier is parimutuel: the order itself moves `p` up, and the
 * payout per winning share is `1/p`, so the prize is smaller by the time the
 * shares are held than it was when the trade was decided. Every buy is a little
 * self-defeating, and a size chosen without that is chosen blind.
 *
 * So the edge is recomputed on the AFTER numbers and the trade is abandoned if
 * it does not survive. Two independent things are checked:
 *
 *  - The order must not walk the book PAST the agent's own belief. If it does,
 *    the last shares in it are ones the agent's own model prices as too
 *    expensive: the tail of the order is a bet against the head. `maxImpactBps`
 *    is capped at the edge for this reason and `sizeWithinImpact` searches the
 *    local DPM mirror; this reads `impliedProbabilityAfterWad` off the chain's
 *    own quote instead, so a disagreement between the two shows up here rather
 *    than in a fill.
 *
 *  - Expected value must still exceed cost. `sharesOut × payoutPerShareAfterWad`
 *    is what the position pays IF it wins, `× P̂` is what it is worth given the
 *    agent's belief, and `Preview.tokensIn` is what it costs — gross, with the
 *    fee already inside it. Nothing is added back and nothing is subtracted
 *    twice, which is why the default floor is break-even rather than a number
 *    somebody picked.
 *
 * Both the belief and the payout are read, never derived. `payoutPerShareAfterWad`
 * comes from the SDK because `1/pᵢ` and `1/Pᵢ` both produce plausible multiples
 * and the wrong one is 27% high at ordinary skew — this project's own spec draft
 * shipped that mistake once.
 */
/**
 * Which side is cheap against the agent's belief, and by how much.
 *
 * `market.impliedProbabilityWad` — NOT `marginalPriceWad`. The two are named apart
 * in the SDK so that reading one for the other has to be typed out on purpose, and
 * this is the line where that would happen. At a fresh 50/50 book the price reads
 * 0.7071 and the probability 0.5, so a belief of 0.60 is a 10pp edge against the
 * probability and a NEGATIVE one against the price: the same input, opposite trades.
 *
 * Because `Σ probability == WAD`, the two sides are one number with opposite signs.
 * At most one side is cheap, and it is not always YES.
 *
 * Extracted from `consider` so it can be tested by value. It was inline, and five
 * separate mutations of the money path — including deleting the Kelly denominator
 * and inverting the slippage bound — left the whole suite green.
 */
export type EdgeResult =
  | {kind: "edge"; outcome: Outcome; myP: bigint; bookP: bigint; edgeBps: bigint}
  | {kind: "dust"; outcome: Outcome; myP: bigint; bookP: bigint; edgeBps: bigint}
  | {kind: "no-edge"; outcome: Outcome; myP: bigint; bookP: bigint};

export function edgeAgainstBook(
  beliefWad: bigint,
  market: Pick<MarketView, "impliedProbabilityWad">,
): EdgeResult {
  const beliefOn: readonly [bigint, bigint] = [WAD - beliefWad, beliefWad];
  const outcome: Outcome = beliefOn[1] > market.impliedProbabilityWad[1] ? 1 : 0;
  const bookP = market.impliedProbabilityWad[outcome];
  const myP = beliefOn[outcome];
  if (myP <= bookP) return {kind: "no-edge", outcome, myP, bookP};
  const edgeBps = ((myP - bookP) * 10_000n) / WAD;
  // The one place a dust tolerance is needed, and the one case where this project
  // allows a constant: `Σ probability == WAD ± 2` exactly, because the algebra
  // makes the residue constant rather than a function of `q`. Two wei of it round
  // to nothing here, so a book that merely AGREES with the belief lands here
  // rather than being traded as a fractional edge.
  if (edgeBps === 0n) return {kind: "dust", outcome, myP, bookP, edgeBps};
  return {kind: "edge", outcome, myP, bookP, edgeBps};
}

/**
 * How much of the bankroll this edge justifies, before the book is consulted.
 *
 * Kelly for DPM is f* = (P̂ − P)/(1 − P). The SHAPE matches the LMSR form and the
 * variable does not: net odds here are payout/cost − 1 = (1/p)/p − 1 = (1−P)/P, so
 * the denominator is one minus the PROBABILITY. Feeding a marginal price into a
 * formula of this shape is what a ported LMSR agent does, and it mis-sizes every
 * position — which is why the denominator is asserted on directly in the tests.
 */
export interface Stake {
  kellyWad: bigint;
  fractionWad: bigint;
  budgetTokens: bigint;
}

export function stakeBudget(args: {
  myP: bigint;
  bookP: bigint;
  spendable: bigint;
  bankrollCapBps: bigint;
}): Stake {
  const kellyWad = ((args.myP - args.bookP) * WAD) / (WAD - args.bookP);
  const capWad = (args.bankrollCapBps * WAD) / 10_000n;
  const fractionWad = kellyWad < capWad ? kellyWad : capWad;
  return {kellyWad, fractionWad, budgetTokens: (args.spendable * fractionWad) / WAD};
}

/**
 * The impact ceiling for an order: the SMALLER of the standing limit and the
 * distance to the belief — derived, not chosen.
 *
 * Every share bought past P̂ is one the agent's own model says is overpriced, so an
 * order that runs the book to the configured cap when only 0.7pp of edge exists
 * spends its last tokens betting against itself. That is not hypothetical: this
 * SDK's `examples/trade.ts` records run 3 doing exactly that, buying through 0.7pp
 * of edge up to 74.26%.
 */
export function impactCapFor(edgeBps: bigint, maxImpactBps: bigint): bigint {
  return edgeBps < maxImpactBps ? edgeBps : maxImpactBps;
}

export function survivesItsOwnImpact(
  preview: Preview,
  beliefWad: bigint,
  collateralDecimals: number,
  minEdgeBps: bigint,
): Verdict {
  if (preview.impliedProbabilityAfterWad > beliefWad) {
    return {
      ok: false,
      why:
        `the order would move P to ${pct(preview.impliedProbabilityAfterWad)}, past our own ` +
        `${pct(beliefWad)} — its last shares are ones this belief calls overpriced`,
    };
  }

  const costWad = toWad(preview.tokensIn, collateralDecimals);
  if (costWad === 0n) return {ok: false, why: "the chain quoted a cost of zero — refusing to sign that"};

  // Wad throughout, and converted to collateral units only for display. Mixing
  // the two mid-calculation is how this project's rounding rules get broken.
  const ifItWinsWad = (preview.sharesOut * preview.payoutPerShareAfterWad) / WAD;
  const expectedWad = (ifItWinsWad * beliefWad) / WAD;
  const survivingBps = ((expectedWad - costWad) * 10_000n) / costWad;

  if (survivingBps <= minEdgeBps) {
    return {
      ok: false,
      why:
        `the edge does not survive its own impact: ${rate(survivingBps)} expected against a ` +
        `floor of ${rate(minEdgeBps)}. The payout after this order is ` +
        `${times(preview.payoutPerShareAfterWad)}, down from ${times(preview.payoutPerShareBeforeWad)}`,
    };
  }
  return {ok: true, expectedWad, survivingBps};
}

function printHeader(config: AgentConfig, client: BrierClient): void {
  console.log(config.dryRun ? "brier example-agent — DRY RUN, nothing will be signed" : "brier example-agent");
  console.log(`  chain     ${config.chainId} (${config.network}) via ${config.rpcUrl}`);
  console.log(`  contracts ${short(config.factory)} factory · ${short(config.outcomeShares)} shares  (from the ${config.addressSource})`);
  console.log(`  wallet    ${client.canWrite ? client.address : "read-only — no key was loaded"}`);
  console.log(
    `  limits    impact ≤ ${pp(config.maxImpactBps)} · surviving edge > ${rate(config.minEdgeBps)} · ` +
      `slippage ${rate(config.slippageBps)} · bankroll cap ${rate(config.bankrollCapBps)}`,
  );
}

/**
 * `REQUIRE_REGISTERED_TRADER`, explained rather than hit.
 *
 * A deployment can require that orders come from an address the AgentRegistry
 * knows. Finding that out from a revert costs gas and reads like the market
 * rejecting the trade rather than the configuration rejecting the trader.
 */
async function passesTraderGate(config: AgentConfig, client: BrierClient): Promise<boolean> {
  if (!(await client.requiresRegisteredTrader())) {
    console.log(`  gate      open — this deployment takes orders from any address`);
    return true;
  }
  if (config.dryRun) {
    console.log(
      `  gate      REQUIRE_REGISTERED_TRADER is ON. This run has no wallet, so whether\n` +
        `            your agent is registered is unknown — the scan below is still valid.`,
    );
    return true;
  }
  const me = await client.myAgent();
  if (me !== null) {
    console.log(`  gate      registered as "${me.name ?? "(unnamed)"}" · agent #${me.agentId} · role ${me.role}`);
    return true;
  }
  console.log(
    `  gate      REQUIRE_REGISTERED_TRADER is ON and ${client.address} is not registered.\n` +
      `\n` +
      `  This deployment only accepts orders from an address the AgentRegistry knows.\n` +
      `  Registration is PERMISSIONLESS — nobody grants it, and what it costs is a name\n` +
      `  nobody else has taken:\n` +
      `\n` +
      `      await client.registerAgent({name: "your-agent"});\n` +
      `\n` +
      `  Stopping here rather than sending an order the market would revert.`,
  );
  return false;
}

/**
 * The market's own question, off 0G Storage and verified against the root the
 * chain holds.
 *
 * An agent told the question by its operator is being told what to think about.
 * This reads what the market actually promised its traders.
 *
 * `ZgStore.get` THROWS on a root mismatch and on an unreachable indexer, and
 * both are wrong answers rather than absent ones — so the reason is printed
 * rather than swallowed. It is not fatal: one market with a broken document
 * should not take down a pass over twenty, and the strategy's answer to a
 * missing spec is already "no opinion".
 */
async function readSpec(store: ZgStore | null, root: `0x${string}`): Promise<MarketSpec | null> {
  if (store === null) return null;
  try {
    return parseSpec(await store.get(root));
  } catch (error: unknown) {
    console.log(`  spec      unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * A verified document into the fields a strategy needs.
 *
 * A document that verified against its root but carries no question is the
 * creator's doing rather than a fault here — and there is still nothing to form
 * an opinion about, so it lands in the same place as one that was never
 * uploaded: `null`, never a blank string.
 */
function parseSpec(raw: unknown): MarketSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === "string" && o.question.length > 0 ? o.question : null;
  const rules = typeof o.rules === "string" && o.rules.length > 0 ? o.rules : null;
  if (question === null || rules === null) return null;
  const sources: SpecSource[] = Array.isArray(o.sources)
    ? o.sources.flatMap((entry): SpecSource[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const e = entry as Record<string, unknown>;
        if (typeof e.url !== "string") return [];
        return [
          {
            kind: typeof e.kind === "string" ? e.kind : "http",
            url: e.url,
            selector: typeof e.selector === "string" ? e.selector : null,
          },
        ];
      })
    : [];
  return {
    version: typeof o.version === "number" ? o.version : 1,
    question,
    rules,
    sources,
    settlementPrompt: typeof o.settlementPrompt === "string" ? o.settlementPrompt : null,
  };
}

/**
 * Run only when this file IS the command, never when it is imported.
 *
 * `survivesItsOwnImpact` above is the piece most worth testing and most worth
 * lifting into another agent, and a module that opened an RPC connection and
 * started sizing orders the moment somebody imported it could be neither
 * tested nor lifted.
 *
 * The message is printed without a stack: every throw this project raises on
 * purpose already says what to fix, and a stack trace above it buries that.
 */
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  await main().catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
