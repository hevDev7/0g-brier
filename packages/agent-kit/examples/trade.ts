/**
 * A whole agent: read the book, size a position, buy, and sell part of it back.
 *
 * Run it against the live Galileo deployment:
 *   DEPLOYER_KEY=... npx tsx examples/trade.ts
 *
 * Nothing here is an oracle. The BELIEF is supplied by whoever runs it, because
 * an agent's edge comes from what it knows and this file knows nothing. What the
 * SDK contributes is everything after the belief: sizing that uses the right
 * variable, a quote that comes from the chain, and a bound on what may be paid.
 */
import {WAD, toTokensCeil, toWad} from "@0g-delphi/protocol";
import {loadDeployment} from "@0g-delphi/protocol/node";
import {DelphiZeroClient, type Outcome} from "../src/index";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const BELIEF_PCT = Number(process.env.BELIEF_PCT ?? 75); // P̂ for YES, in percent
const BANKROLL_FRACTION_CAP = 0.25; // never stake more than a quarter, whatever Kelly says
const SLIPPAGE_BPS = 100n; // 1% over the quote
const MAX_IMPACT_BPS = 500n; // never move the probability more than 5 points

const key = process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!key) throw new Error("set DEPLOYER_KEY (or AGENT_KEY) — the agent signs with its own key");

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const client = new DelphiZeroClient({
  network: CHAIN_ID === 16602 ? "galileo" : "anvil",
  privateKey: (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
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
const market = open[open.length - 1]!;

console.log(`market ${market.address}  (${market.status}, ${market.tier}, ${market.category})`);
console.log(`  P(YES) ${pct(market.impliedProbabilityWad[1])}   marginal price ${x(market.marginalPriceWad[1])}`);
console.log(`  NOTE: those are different numbers. The price is not the probability.`);

const OUTCOME: Outcome = 1;
const P = market.impliedProbabilityWad[OUTCOME];
const belief = (BigInt(Math.round(BELIEF_PCT * 100)) * WAD) / 10_000n;

/**
 * Kelly for DPM: f* = (P̂ − P) / (1 − P).
 *
 * The SHAPE is the same as Delphi's, and the variable is not. Net odds here are
 * `payout/cost − 1 = (1/p)/p − 1 = (1−P)/P`, so the denominator is one minus the
 * PROBABILITY. Feeding the marginal price into a formula of this shape — which
 * is what a ported LMSR agent does, because under LMSR the two are the same
 * number — systematically mis-sizes every position.
 */
if (belief <= P) {
  console.log(`  belief ${pct(belief)} is not above the market's ${pct(P)} — no edge, nothing to do`);
  process.exit(0);
}
const kellyWad = ((belief - P) * WAD) / (WAD - P);
const fraction = Math.min(Number(kellyWad) / 1e18, BANKROLL_FRACTION_CAP);
console.log(`  belief ${pct(belief)}  →  Kelly ${(Number(kellyWad) / 1e16).toFixed(2)}%, capped to ${(fraction * 100).toFixed(2)}%`);

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
const stakeTokens = await client.sizeWithinImpact({
  market: market.address,
  outcome: OUTCOME,
  budgetTokens: kellyTokens,
  maxImpactBps: MAX_IMPACT_BPS,
});
console.log(`  free ${usd(free, market.collateralDecimals)} ${market.collateralSymbol}`);
console.log(`  Kelly wants ${usd(kellyTokens, market.collateralDecimals)}; the book allows ${usd(stakeTokens, market.collateralDecimals)} within ${Number(MAX_IMPACT_BPS) / 100}pp of impact`);

// How many shares that budget buys, inverted BY THE CONTRACT rather than locally.
const {sharesOut} = await client.quoteBuySpend(market.address, OUTCOME, stakeTokens);
const preview = await client.previewBuy(market.address, OUTCOME, sharesOut);

console.log(`\nbuying ${(Number(sharesOut) / 1e18).toFixed(2)} YES shares`);
console.log(`  cost      ${usd(preview.tokensIn, market.collateralDecimals)} (fee ${usd(preview.feeTokens, market.collateralDecimals)})`);
console.log(`  P(YES)    ${pct(preview.impliedProbabilityBeforeWad)} → ${pct(preview.impliedProbabilityAfterWad)}`);
console.log(`  payout    ${x(preview.payoutPerShareBeforeWad)} → ${x(preview.payoutPerShareAfterWad)}   ← the prize SHRINKS as we take it`);

const maxTokensIn = preview.tokensIn + (preview.tokensIn * SLIPPAGE_BPS) / 10_000n;
await client.ensureAllowance(market.address, market.collateral, maxTokensIn);
const bought = await client.buyShares({market: market.address, outcome: OUTCOME, sharesOut, maxTokensIn});
console.log(`  filled    ${bought.hash}`);
console.log(`  paid      ${usd(-bought.tokensDelta, market.collateralDecimals)}  ·  now holding ${(Number(bought.sharesAfter) / 1e18).toFixed(2)} shares`);
console.log(`  P(YES)    now ${pct(bought.impliedProbabilityAfterWad[1])}`);

// Sell a third back, to prove the exit works and to show what the curve costs.
const sellShares = bought.sharesAfter / 3n;
const {tokensOut} = await client.quoteSell(market.address, OUTCOME, sellShares);
const minTokensOut = tokensOut - (tokensOut * SLIPPAGE_BPS) / 10_000n;
console.log(`\nselling ${(Number(sellShares) / 1e18).toFixed(2)} back for at least ${usd(minTokensOut, market.collateralDecimals)}`);

const sold = await client.sellShares({market: market.address, outcome: OUTCOME, sharesIn: sellShares, minTokensOut});
console.log(`  filled    ${sold.hash}`);
console.log(`  received  ${usd(sold.tokensDelta, market.collateralDecimals)}  ·  now holding ${(Number(sold.sharesAfter) / 1e18).toFixed(2)} shares`);
console.log(`  P(YES)    now ${pct(sold.impliedProbabilityAfterWad[1])}`);

// The round trip cost, which is the fee twice plus the walk down the curve.
const buyCost = toWad(-bought.tokensDelta, market.collateralDecimals);
const sellBack = toWad(sold.tokensDelta, market.collateralDecimals);
const third = buyCost / 3n;
console.log(`\nround trip on that third: paid ~${usd(toTokensCeil(third, market.collateralDecimals), market.collateralDecimals)}, got back ${usd(sold.tokensDelta, market.collateralDecimals)}`);
console.log(`  selling walks BACK DOWN the curve, and the fee is charged both ways — see spec §4.`);
void sellBack;
