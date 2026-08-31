/**
 * A whole agent, end to end on 0G: read the market's own question out of 0G
 * Storage, form a belief with a TEE-attested model on 0G Compute, size it
 * against both the bankroll and the book, and trade on 0G Chain.
 *
 *   DEPLOYER_KEY=... ZG_PROVIDER=0x... npx tsx examples/trade.ts
 *
 * Three refusals are the point of the file, and each of them costs the run:
 *
 * - It will not trade on an answer whose TEE attestation did not come back true.
 *   Attestation is the whole reason inference runs on 0G Compute rather than
 *   behind someone's API key, and treating an unverified answer as verified
 *   would throw that away while keeping the bill.
 * - It will not guess at a reply it cannot parse. A belief defaulted to 0.5 is
 *   not neutral on a DPM book; it is a position against whatever the market says.
 * - It will not size on Kelly alone. See `sizeWithinImpact`.
 */
import {WAD, toTokensCeil, toWad} from "@0g-brier/protocol";
import {loadDeployment} from "@0g-brier/protocol/node";
import {ZgStore} from "@0g-brier/zg-storage";
import {BrierClient, ZgInference, type Outcome} from "../src/index";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const ZG_INDEXER = process.env.ZG_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
// From `ZgInference.listServices()`. Never hardcoded in a real agent — the
// catalogue shifts, and a dead address fails only at request time.
const ZG_PROVIDER = (process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836") as `0x${string}`;
const BANKROLL_FRACTION_CAP = 0.25; // never stake more than a quarter, whatever Kelly says
const SLIPPAGE_BPS = 100n; // 1% over the quote
const MAX_IMPACT_BPS = 500n; // never move the probability more than 5 points

const key = process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!key) throw new Error("set DEPLOYER_KEY (or AGENT_KEY) — the agent signs with its own key");
const KEY = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const client = new BrierClient({
  network: CHAIN_ID === 16602 ? "galileo" : "anvil",
  privateKey: KEY,
  factory: manifest.contracts.MarketFactory as `0x${string}`,
  outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
});

const pct = (wad: bigint) => `${(Number(wad) / 1e16).toFixed(2)}%`;
const x = (wad: bigint) => `${(Number(wad) / 1e18).toFixed(4)}×`;
const usd = (v: bigint, d: number) => (Number(v) / 10 ** d).toFixed(6);

console.log(`agent ${client.address}`);

const markets = await client.listMarkets();
const open = markets.filter((m) => m.status === "Open");
if (open.length === 0) throw new Error("no Open market to trade — create one with STOP_AFTER_CREATE=1");
const want = process.env.MARKET?.toLowerCase();
const market = want ? open.find((m) => m.address.toLowerCase() === want) : open[open.length - 1];
if (!market) {
  // "not found" is a poor answer when the address is right and the market has
  // simply closed, which is the usual reason a rerun stops working.
  const known = markets.find((m) => m.address.toLowerCase() === want);
  throw new Error(
    known
      ? `market ${known.address} is ${known.status}, not Open — nothing to trade`
      : `MARKET ${process.env.MARKET} is not on this factory`,
  );
}

console.log(`market ${market.address}  (${market.status}, ${market.tier}, ${market.category})`);
console.log(`  P(YES) ${pct(market.impliedProbabilityWad[1])}   marginal price ${x(market.marginalPriceWad[1])}`);
console.log(`  NOTE: those are different numbers. The price is not the probability.`);

// The question comes from the market's OWN document, fetched by the root the
// chain holds and verified against it. An agent told the question by its
// operator is being told what to think about; this one reads what the market
// actually promised its traders.
const store = new ZgStore(ZG_INDEXER);
const spec = (await store.get(market.specRoot)) as {
  question?: string;
  rules?: string;
  settlementPrompt?: string;
} | null;
if (!spec?.question || !spec.rules) {
  throw new Error(`market ${market.address} has no readable MarketSpec at ${market.specRoot}`);
}
console.log(`\nquestion  ${spec.question}`);

const inference = await ZgInference.connect({network: "galileo", privateKey: KEY, provider: ZG_PROVIDER});
console.log(`asking 0G Compute…`);
const judgement = await inference.believe({
  question: spec.question,
  rules: spec.rules,
  settlementPrompt: spec.settlementPrompt ?? null,
});
console.log(`  model     ${judgement.model}`);
console.log(`  chatID    ${judgement.chatId}`);
console.log(`  TEE       ${judgement.teeVerified ? "verified" : "NOT VERIFIED"}`);
console.log(`  belief    ${pct(judgement.impliedProbabilityWad)} — ${judgement.rationale}`);

// What TeeML attests is narrow: that this provider ran this model over this
// input inside an enclave. It says nothing about whether the answer is right.
// But without it there is no reason to prefer this over any API, so a run that
// cannot get it stops here rather than quietly trading anyway.
if (!judgement.teeVerified) {
  console.log(`\n  refusing to trade: the answer carries no TEE attestation.`);
  process.exit(1);
}
const belief = judgement.impliedProbabilityWad;

/**
 * Kelly for DPM: f* = (P̂ − P) / (1 − P).
 *
 * The SHAPE is the same as the LMSR form, and the variable is not. Net odds here are
 * `payout/cost − 1 = (1/p)/p − 1 = (1−P)/P`, so the denominator is one minus the
 * PROBABILITY. Feeding the marginal price into a formula of this shape — which
 * is what a ported LMSR agent does, because under LMSR the two are the same
 * number — systematically mis-sizes every position.
 */
/**
 * Which side first, and only then how much.
 *
 * A belief of 70% YES is equally a belief of 30% NO, and a market pricing YES at
 * 72.7% is pricing NO at 27.3%. Reading only the YES side of both — which this
 * file did until it was pointed at a market that had already run past its own
 * model — discards half of every belief the agent forms, and reports "no edge"
 * on a book that is plainly mispriced in the other direction.
 *
 * Because Σ probability == WAD, the two edges are one number with opposite
 * signs: at most one side is cheap, and it is not always YES.
 */
const beliefOn: readonly [bigint, bigint] = [WAD - belief, belief];
const OUTCOME: Outcome = beliefOn[1] > market.impliedProbabilityWad[1] ? 1 : 0;
const SIDE = OUTCOME === 1 ? "YES" : "NO";
const P = market.impliedProbabilityWad[OUTCOME];
const myP = beliefOn[OUTCOME];

if (myP <= P) {
  console.log(`  ${pct(belief)} YES against a book at ${pct(market.impliedProbabilityWad[1])} — no edge on either side, nothing to do`);
  process.exit(0);
}
console.log(`  the edge is on ${SIDE}: model ${pct(myP)} vs book ${pct(P)}`);
const kellyWad = ((myP - P) * WAD) / (WAD - P);
const fraction = Math.min(Number(kellyWad) / 1e18, BANKROLL_FRACTION_CAP);
console.log(`  P(${SIDE}) ${pct(myP)}  →  Kelly ${(Number(kellyWad) / 1e16).toFixed(2)}%, capped to ${(fraction * 100).toFixed(2)}%`);

const free = await client.getBalance(market.collateral);
const kellyTokens = BigInt(Math.floor(Number(free) * fraction));

/**
 * Kelly, then the book.
 *
 * The first run of this example staked a Kelly-sized 149,739 mUSDC into a market
 * seeded with 1,000 — the preview showed P(YES) going 50% → 100% and the payout
 * collapsing 1.4142× → 1.0000×. Kelly was not wrong; it was answering a
 * different question. It sizes against the bankroll and knows nothing about
 * depth, and on a DPM curve an order that big destroys the edge it was computed
 * from in the act of taking it.
 */
/**
 * …and then the belief again, as a ceiling on the move itself.
 *
 * A fixed impact cap is blind to how much edge is left. Run 3 of the
 * convergence had a belief of 70.00% against a market at 69.30% — seven tenths
 * of a point of edge — and the 5pp cap happily bought through it to 74.26%.
 * Every share past 70% is one the agent's OWN model says is overpriced, so the
 * last part of that order was a bet against itself.
 *
 * The move is therefore bounded by whichever is smaller: the standing impact
 * limit, or the distance to the belief.
 */
const edgeBps = ((myP - P) * 10_000n) / WAD;
const impactCapBps = edgeBps < MAX_IMPACT_BPS ? edgeBps : MAX_IMPACT_BPS;
if (impactCapBps < MAX_IMPACT_BPS) {
  console.log(`  only ${Number(edgeBps) / 100}pp of edge left, so the move is capped there rather than at ${Number(MAX_IMPACT_BPS) / 100}pp`);
}
const stakeTokens = await client.sizeWithinImpact({
  market: market.address,
  outcome: OUTCOME,
  budgetTokens: kellyTokens,
  maxImpactBps: impactCapBps,
});
console.log(`  free ${usd(free, market.collateralDecimals)} ${market.collateralSymbol}`);
console.log(`  Kelly wants ${usd(kellyTokens, market.collateralDecimals)}; the book allows ${usd(stakeTokens, market.collateralDecimals)} within ${Number(impactCapBps) / 100}pp of impact`);

// How many shares that budget buys, inverted BY THE CONTRACT rather than locally.
const {sharesOut} = await client.quoteBuySpend(market.address, OUTCOME, stakeTokens);
const preview = await client.previewBuy(market.address, OUTCOME, sharesOut);

console.log(`\nbuying ${(Number(sharesOut) / 1e18).toFixed(2)} ${SIDE} shares`);
console.log(`  cost      ${usd(preview.tokensIn, market.collateralDecimals)} (fee ${usd(preview.feeTokens, market.collateralDecimals)})`);
console.log(`  P(${SIDE})${SIDE === "NO" ? " " : ""}    ${pct(preview.impliedProbabilityBeforeWad)} → ${pct(preview.impliedProbabilityAfterWad)}`);
console.log(`  payout    ${x(preview.payoutPerShareBeforeWad)} → ${x(preview.payoutPerShareAfterWad)}   ← the prize SHRINKS as we take it`);

const maxTokensIn = preview.tokensIn + (preview.tokensIn * SLIPPAGE_BPS) / 10_000n;
await client.ensureAllowance(market.address, market.collateral, maxTokensIn);
const bought = await client.buyShares({market: market.address, outcome: OUTCOME, sharesOut, maxTokensIn});
console.log(`  filled    ${bought.hash}`);
console.log(`  paid      ${usd(-bought.tokensDelta, market.collateralDecimals)}  ·  now holding ${(Number(bought.sharesAfter) / 1e18).toFixed(2)} shares`);
console.log(`  P(${SIDE})${SIDE === "NO" ? " " : ""}    now ${pct(bought.impliedProbabilityAfterWad[OUTCOME])}`);

/**
 * Sell a third of WHAT THIS RUN BOUGHT, not a third of the position.
 *
 * `sharesAfter` is cumulative, so on a second run against the same market it
 * includes shares bought at an earlier price. Selling a third of that and
 * comparing the proceeds against a third of this run's cost printed
 * "paid ~20.14, got back 32.22" — a profit that never happened, because the two
 * numbers counted different shares.
 */
const sellShares = sharesOut / 3n;
const {tokensOut} = await client.quoteSell(market.address, OUTCOME, sellShares);
const minTokensOut = tokensOut - (tokensOut * SLIPPAGE_BPS) / 10_000n;
console.log(`\nselling ${(Number(sellShares) / 1e18).toFixed(2)} back for at least ${usd(minTokensOut, market.collateralDecimals)}`);

const sold = await client.sellShares({market: market.address, outcome: OUTCOME, sharesIn: sellShares, minTokensOut});
console.log(`  filled    ${sold.hash}`);
console.log(`  received  ${usd(sold.tokensDelta, market.collateralDecimals)}  ·  now holding ${(Number(sold.sharesAfter) / 1e18).toFixed(2)} shares`);
console.log(`  P(${SIDE})${SIDE === "NO" ? " " : ""}    now ${pct(sold.impliedProbabilityAfterWad[OUTCOME])}`);

/**
 * Per share, so the comparison holds whatever the position size.
 *
 * Entry is this run's total cost over the shares it bought; exit is the proceeds
 * over the shares just sold. The gap is the fee, charged both ways, plus the
 * walk back down the curve — selling moves the price against the seller exactly
 * as buying moved it against the buyer.
 */
const paidPerShare = (toWad(-bought.tokensDelta, market.collateralDecimals) * WAD) / sharesOut;
const gotPerShare = (toWad(sold.tokensDelta, market.collateralDecimals) * WAD) / sellShares;
console.log(`\nper share: paid ${x(paidPerShare)} on entry, received ${x(gotPerShare)} on exit`);
console.log(`  the gap is the fee both ways plus the walk back down the curve — see spec §4.`);
void toTokensCeil;
