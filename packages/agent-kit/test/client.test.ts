import {describe, expect, it} from "vitest";
import {custom, decodeFunctionData, encodeFunctionResult, type Transport} from "viem";
import {WAD, dpm} from "@0g-delphi/protocol";
import {DelphiZeroClient} from "../src/client";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI, SHARES_ABI} from "../src/abi";

const FACTORY = "0xfacadefacadefacadefacadefacadefacadefac0" as const;
const SHARES = "0x5555555555555555555555555555555555555555" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
// anvil's first account. A well-known test key, never used for anything real.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** A skewed book, so price and probability cannot coincide by accident. */
const Q: readonly [bigint, bigint] = [1000n * WAD, 1800n * WAD];

function stub(overrides: Record<string, unknown> = {}): Transport {
  const answers: Record<string, unknown> = {
    marketCount: 1n,
    marketAt: MARKET,
    qArray: Q,
    poolWad: dpm.costUp(Q),
    status: 0,
    tier: 1,
    category: `0x${Buffer.from("crypto").toString("hex").padEnd(64, "0")}`,
    tradingEnd: 1790000000n,
    collateral: TOKEN,
    specRoot: `0x${"ab".repeat(32)}`,
    feeBps: 100,
    winningOutcome: 0,
    resolvedAt: 0n,
    symbol: "mUSDC",
    decimals: 6,
    balanceOf: 4_200_000n,
    allowance: 0n,
    balanceOfOutcome: 0n,
    quoteBuy: [100_000_000n, 1_000_000n],
    ...overrides,
  };
  return custom({
    request: async ({method, params}) => {
      if (method !== "eth_call") throw new Error(`unexpected RPC ${method}`);
      const {to, data} = (params as [{to: `0x${string}`; data: `0x${string}`}])[0];
      const abi =
        to.toLowerCase() === FACTORY.toLowerCase()
          ? FACTORY_ABI
          : to.toLowerCase() === TOKEN.toLowerCase()
            ? ERC20_ABI
            : to.toLowerCase() === SHARES.toLowerCase()
              ? SHARES_ABI
              : MARKET_ABI;
      const {functionName} = decodeFunctionData({abi, data});
      if (!(functionName in answers)) throw new Error(`stub has no answer for ${functionName}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the ABI is chosen at runtime
      return encodeFunctionResult({abi, functionName, result: answers[functionName]} as any);
    },
  });
}

const client = (overrides?: Record<string, unknown>) =>
  new DelphiZeroClient({
    network: "anvil",
    privateKey: KEY,
    factory: FACTORY,
    outcomeShares: SHARES,
    transport: stub(overrides),
  });

describe("what an agent is shown", () => {
  /**
   * The single most load-bearing test in this package. Delphi is LMSR, where the
   * marginal price IS the implied probability. 0G-Delphi is DPM Pennock, where
   * the probability is the price SQUARED. An agent ported across that boundary
   * reads one for the other, overstates its edge, and keeps trading — so the two
   * are separate fields, and this asserts they are separate NUMBERS.
   */
  it("keeps the marginal price and the implied probability apart", async () => {
    const m = await client().getMarket(MARKET);

    const priceYes = m.marginalPriceWad[1];
    const probYes = m.impliedProbabilityWad[1];
    expect(priceYes).not.toBe(probYes);

    // p² == P, within a bound DERIVED from the live q rather than guessed.
    // `price` floors once, so it is up to 1 wad-unit low; squaring amplifies
    // that by 2p/WAD. Two further floors — the division below, and the one
    // inside `probability` — contribute one unit each.
    const squaringSlack = (2n * priceYes) / WAD + 2n;
    const squared = (priceYes * priceYes) / WAD;
    expect(squared).toBeGreaterThanOrEqual(probYes - squaringSlack);
    expect(squared).toBeLessThanOrEqual(probYes + squaringSlack);

    // The probabilities sum to one; the prices sum to MORE. This is the whole
    // difference from LMSR, and the ±2 here is the one genuinely constant dust
    // bound in this project — the algebra makes it so.
    const probSum = m.impliedProbabilityWad[0] + probYes;
    expect(probSum).toBeGreaterThanOrEqual(WAD - 2n);
    expect(probSum).toBeLessThanOrEqual(WAD + 2n);
    expect(m.marginalPriceWad[0] + priceYes).toBeGreaterThan(WAD);
  });

  it("reports no winner while the market is unresolved, rather than NO", async () => {
    expect((await client().getMarket(MARKET)).winningOutcome).toBeNull();
    const settled = await client({status: 4, winningOutcome: 0, resolvedAt: 1790000500n}).getMarket(MARKET);
    expect(settled.winningOutcome).toBe(0);
  });
});

describe("what a trade would do", () => {
  /**
   * The field an LMSR agent has no place for. Under LMSR a winning share pays
   * exactly 1, fixed at purchase. Under DPM it pays 1/pᵢ and floats: buying
   * moves p up, so the prize shrinks as the agent takes it. A Kelly fraction
   * computed at the pre-trade payout is therefore always too large.
   */
  it("shows the payout shrinking as the agent buys into it", async () => {
    const p = await client().previewBuy(MARKET, 1, 300n * WAD);
    expect(p.payoutPerShareAfterWad).toBeLessThan(p.payoutPerShareBeforeWad);
    expect(p.impliedProbabilityAfterWad).toBeGreaterThan(p.impliedProbabilityBeforeWad);
  });

  it("signs the chain's number, not a local model's", async () => {
    const p = await client().previewBuy(MARKET, 1, 300n * WAD);
    // Exactly what the stubbed `quoteBuy` view returned.
    expect(p.tokensIn).toBe(100_000_000n);
    expect(p.feeTokens).toBe(1_000_000n);
  });

  it("buying the other side moves the other probability", async () => {
    const yes = await client().previewBuy(MARKET, 1, 300n * WAD);
    const no = await client().previewBuy(MARKET, 0, 300n * WAD);
    expect(no.impliedProbabilityAfterWad).toBeGreaterThan(no.impliedProbabilityBeforeWad);
    expect(no.impliedProbabilityBeforeWad).not.toBe(yes.impliedProbabilityBeforeWad);
  });
});

describe("approval", () => {
  it("does not spend gas re-approving what is already allowed", async () => {
    const already = client({allowance: 1_000_000_000n});
    await expect(already.ensureAllowance(MARKET, TOKEN, 500_000_000n)).resolves.toBeNull();
  });
});

/**
 * Kelly sizes against the bankroll and is blind to the book. On a DPM curve that
 * is not academic: this SDK's first live order previewed 50% → 100% with the
 * payout collapsing 1.4142× → 1.0000×, which would have destroyed the very edge
 * the size was computed from. The bound belongs in the SDK, not in each agent.
 */
describe("sizing against the book, not just the bankroll", () => {
  const SEEDED: readonly [bigint, bigint] = [1000n * WAD, 1000n * WAD];
  const seeded = (o?: Record<string, unknown>) =>
    client({qArray: SEEDED, poolWad: dpm.costUp(SEEDED), ...o});

  it("cuts a budget that would walk the probability to certainty", async () => {
    const huge = 149_739_766_779n; // the live budget that previewed 50% → 100%
    const sized = await seeded().sizeWithinImpact({
      market: MARKET,
      outcome: 1,
      budgetTokens: huge,
      maxImpactBps: 500n, // 5 probability points
    });
    expect(sized).toBeLessThan(huge);
    expect(sized).toBeGreaterThan(0n);
  });

  it("keeps the resulting move inside the bound it was given", async () => {
    const sized = await seeded().sizeWithinImpact({
      market: MARKET,
      outcome: 1,
      budgetTokens: 149_739_766_779n,
      maxImpactBps: 500n,
    });
    const before = dpm.probability(SEEDED, 1);
    const shares = dpm.sharesForSpend(SEEDED, 1, sized * 10n ** 12n);
    const after = dpm.probability([SEEDED[0], SEEDED[1] + shares] as const, 1);
    expect(after - before).toBeLessThanOrEqual((WAD * 500n) / 10_000n);
  });

  it("leaves a budget the book can absorb untouched", async () => {
    const small = 1_000_000n; // 1 mUSDC into a 1,000 mUSDC book
    const sized = await seeded().sizeWithinImpact({
      market: MARKET,
      outcome: 1,
      budgetTokens: small,
      maxImpactBps: 500n,
    });
    expect(sized).toBe(small);
  });
});
