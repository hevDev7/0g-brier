/**
 * Claim a settled position, and check the payout against the rate the contract
 * itself snapshotted.
 *
 *   DEPLOYER_KEY=... MARKET=0x... npx tsx examples/redeem.ts
 *
 * The check at the end is the point. The payout per winning share is `1/pᵢ` —
 * the reciprocal of the MARGINAL PRICE — and not `1/Pᵢ`, the reciprocal of the
 * probability. Both produce plausible numbers; at the settlement below the
 * second is 27% higher, which is exactly the direction that hurts anyone who
 * trusted it. This project's own spec draft made that mistake once.
 */
import {WAD, modeForChainId} from "@0g-brier/protocol";
import {loadDeployment} from "@0g-brier/protocol/node";
import {BrierClient} from "../src/index";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const key = process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!key) throw new Error("set DEPLOYER_KEY (or AGENT_KEY)");
const market = process.env.MARKET as `0x${string}` | undefined;
if (!market) throw new Error("set MARKET to the settled market's address");

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const client = new BrierClient({
  network: modeForChainId(CHAIN_ID),
  privateKey: (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
  factory: manifest.contracts.MarketFactory as `0x${string}`,
  outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
});

const view = await client.getMarket(market);
const usd = (v: bigint) => (Number(v) / 10 ** view.collateralDecimals).toFixed(6);
const x = (wad: bigint) => `${(Number(wad) / 1e18).toFixed(4)}×`;

console.log(`agent  ${client.address}`);
console.log(`market ${market}  (${view.status})`);
if (view.winningOutcome === null && view.status !== "Failed" && view.status !== "Voided") {
  console.log(`  not resolved — nothing to claim`);
  process.exit(0);
}

// A market can end three ways and only one of them has a winner. Settled pays the
// winning side at 1/p; Failed and Voided pay BOTH sides at their own price, which
// is a different function and a different arithmetic.
if (view.status === "Failed" || view.status === "Voided") {
  console.log(`  ${view.status.toLowerCase()} — no winner. Both sides exit at their own price.`);
  const both = await client.liquidate(market);
  console.log(`\nliquidated ${both.hash}`);
  console.log(`  shares burned ${(Number(both.sharesBefore) / 1e18).toFixed(6)}  (both sides, tradable and seed)`);
  console.log(`  received      ${usd(both.tokensReceived)} ${view.collateralSymbol}`);
  console.log(`\nNobody won, so nobody was paid at 1/p. Each side was paid its own`);
  console.log(`marginal price — which is what makes an unanswerable question survivable.`);
  process.exit(0);
}

// Settled, so there IS a winner. The compound guard at the top cannot prove that to
// the type checker, and an explicit check beats a cast: were it ever to fire, the
// client had returned a settled market with no recorded outcome, and saying so is a
// better answer than indexing a price array with null.
if (view.winningOutcome === null) {
  console.log(`  settled, but no outcome was recorded — refusing to guess which side won`);
  process.exit(1);
}

const side = view.winningOutcome === 1 ? "YES" : "NO";
const price = view.marginalPriceWad[view.winningOutcome];
const probability = view.impliedProbabilityWad[view.winningOutcome];
console.log(`  winner ${side}`);
console.log(`  p = ${x(price)}   P = ${(Number(probability) / 1e16).toFixed(2)}%`);
console.log(`  payout should be 1/p = ${x((WAD * WAD) / price)}   (1/P would say ${x((WAD * WAD) / probability)})`);

const claim = await client.redeem(market);
console.log(`\nredeemed ${claim.hash}`);
console.log(`  shares burned ${(Number(claim.sharesBefore) / 1e18).toFixed(6)}`);
console.log(`  received      ${usd(claim.tokensReceived)} ${view.collateralSymbol}`);

// Measured against the rate, not against the quote. A mismatch here would mean
// the contract paid something other than what it snapshotted at settlement.
const impliedRate = claim.sharesBefore === 0n
  ? 0n
  : (claim.tokensReceived * 10n ** BigInt(18 - view.collateralDecimals) * WAD) / claim.sharesBefore;
console.log(`  implied rate  ${x(impliedRate)}`);
console.log(`\nThe rate is 1/p, not 1/P. Using the probability would have promised`);
console.log(`${x((WAD * WAD) / probability)} — about 27% more than the pool can pay.`);
