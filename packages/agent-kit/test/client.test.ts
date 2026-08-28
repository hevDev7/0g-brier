import {describe, expect, it} from "vitest";
import {custom, decodeFunctionData, encodeFunctionResult, type Transport} from "viem";
import {WAD, dpm} from "@brier/protocol";
import {BrierClient} from "../src/client";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI, SHARES_ABI} from "../src/abi";
import {UnreadableBeliefError, parseBelief, parseJudgement} from "../src/inference";
import {decodeAgentName, encodeAgentName} from "../src/client";

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
  new BrierClient({
    network: "anvil",
    privateKey: KEY,
    factory: FACTORY,
    outcomeShares: SHARES,
    transport: stub(overrides),
  });

describe("what an agent is shown", () => {
  /**
   * The single most load-bearing test in this package. Gensyn's Delphi
   * competition runs on LMSR, where the
   * marginal price IS the implied probability. Brier is DPM Pennock, where
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

/**
 * The parser is strict because a lenient one is worse than useless here. An
 * agent that fell back to 0.5 on an unreadable reply would trade on noise while
 * looking exactly like one that had a view — and on a DPM book 0.5 is never
 * neutral, it is a position against whatever the market currently says.
 */
describe("reading a belief out of a model's reply", () => {
  it("reads a plain JSON answer", () => {
    const b = parseBelief('{"probability": 0.72, "rationale": "because"}');
    expect(b.impliedProbabilityWad).toBe((WAD * 72n) / 100n);
    expect(b.rationale).toBe("because");
  });

  it("tolerates the markdown fence models add anyway", () => {
    const b = parseBelief('```json\n{"probability": 0.5, "rationale": "x"}\n```');
    expect(b.impliedProbabilityWad).toBe(WAD / 2n);
  });

  it.each([
    ["prose", "I think about 72 percent."],
    ["no probability", '{"rationale": "sure"}'],
    ["a percentage, not a fraction", '{"probability": 72}'],
    ["negative", '{"probability": -0.1}'],
    ["not a number", '{"probability": "high"}'],
    ["empty", ""],
  ])("refuses %s rather than guessing", (_label, raw) => {
    expect(() => parseBelief(raw)).toThrow(UnreadableBeliefError);
  });

  it("never silently yields one half", () => {
    // The failure mode being ruled out: a reply it did not understand must not
    // come back as a coin flip.
    for (const raw of ["nonsense", "{}", '{"probability": null}']) {
      expect(() => parseBelief(raw)).toThrow();
    }
  });
});

/**
 * A fixed impact cap is blind to how much edge is left. In run 3 of the live
 * convergence the agent believed 70.00% against a market at 69.30% and bought
 * through to 74.26% — every share past its own belief being one its own model
 * calls overpriced. The cap has to be the SMALLER of the standing limit and the
 * distance to the belief.
 */
describe("not buying past your own belief", () => {
  const AT_69: readonly [bigint, bigint] = [1000n * WAD, 1502n * WAD];
  const at69 = () => client({qArray: AT_69, poolWad: dpm.costUp(AT_69)});

  it("the book at this q really is near 69%", () => {
    const p = dpm.probability(AT_69, 1);
    expect(p).toBeGreaterThan((WAD * 68n) / 100n);
    expect(p).toBeLessThan((WAD * 70n) / 100n);
  });

  it("a thin edge buys far less than a wide one", async () => {
    const budget = 149_739_766_779n;
    const wide = await at69().sizeWithinImpact({
      market: MARKET, outcome: 1, budgetTokens: budget, maxImpactBps: 500n,
    });
    // Seven tenths of a point of edge, as run 3 actually had.
    const thin = await at69().sizeWithinImpact({
      market: MARKET, outcome: 1, budgetTokens: budget, maxImpactBps: 70n,
    });
    expect(thin).toBeLessThan(wide);
    expect(thin).toBeGreaterThan(0n);
  });

  it("keeps the move inside the thin bound, so the market cannot be pushed past the belief", async () => {
    const sized = await at69().sizeWithinImpact({
      market: MARKET, outcome: 1, budgetTokens: 149_739_766_779n, maxImpactBps: 70n,
    });
    const before = dpm.probability(AT_69, 1);
    const shares = dpm.sharesForSpend(AT_69, 1, sized * 10n ** 12n);
    const after = dpm.probability([AT_69[0], AT_69[1] + shares] as const, 1);
    expect(after - before).toBeLessThanOrEqual((WAD * 70n) / 10_000n);
  });
});

/**
 * `redeem` burns and pays for the tradable position AND the seed shares, and the
 * two live in different contracts: tradable in OutcomeShares, seed in the Market.
 * A client that reads only the first divides the whole proceeds by a fraction of
 * the shares — the first live redemption through this SDK printed an "implied
 * rate" of 21.01× for a market whose rate was 1.3689×.
 */
describe("what a claim says it burned", () => {
  const settled = () =>
    client({
      status: 4,
      winningOutcome: 1,
      resolvedAt: 1790000500n,
      balanceOfOutcome: 49_271_245_000_000_000_000n, // 49.27 tradable
      seedSharesOf: [0n, 707_121_731_000_000_000_000n], // 707.12 seed, YES side
    });

  it("reads the seed shares the Market holds, which OutcomeShares does not", async () => {
    expect(await settled().getSeedShares(MARKET, 1)).toBe(707_121_731_000_000_000_000n);
    // `getPosition` stays tradable-only, which is what its name says.
    expect(await settled().getPosition(MARKET, 1)).toBe(49_271_245_000_000_000_000n);
  });

  it("refuses to claim a market that has not resolved", async () => {
    await expect(client().redeem(MARKET)).rejects.toThrow(/not been resolved/);
  });
});

/**
 * A resolver that defaulted an unreadable reply to some outcome would settle a market
 * on noise. The default people reach for — UNRESOLVABLE — is not an abstention
 * either: it liquidates every position, which is a decision.
 */
describe("reading a settlement out of a model's reply", () => {
  it("reads the three outcomes", () => {
    expect(parseJudgement('{"outcome":"YES","confidence":0.9,"rationale":"x"}').outcome).toBe(1);
    expect(parseJudgement('{"outcome":"NO","confidence":0.9,"rationale":"x"}').outcome).toBe(0);
    expect(parseJudgement('{"outcome":"UNRESOLVABLE","rationale":"x"}').outcome).toBe(2);
  });

  it("keeps confidence null rather than inventing one", () => {
    expect(parseJudgement('{"outcome":"YES","rationale":"x"}').confidence).toBeNull();
    expect(parseJudgement('{"outcome":"YES","confidence":7,"rationale":"x"}').confidence).toBeNull();
  });

  it.each([
    ["prose", "I think YES."],
    ["a probability instead of an outcome", '{"probability":0.7}'],
    ["an outcome it was not offered", '{"outcome":"MAYBE"}'],
    ["empty", ""],
  ])("refuses %s rather than settling on it", (_l, raw) => {
    expect(() => parseJudgement(raw)).toThrow(UnreadableBeliefError);
  });
});

/**
 * The same three-state read as the frontend's, and the same live cause: a committee
 * on Galileo returned UNRESOLVABLE, the market FAILED, and `winningOutcome` read 0
 * because nothing had ever written to it. `resolvedAt` is set on failure too, so it
 * cannot be what distinguishes a winner from the absence of one.
 */
describe("a market that failed has no winner", () => {
  it.each([
    ["Failed", 5],
    ["Voided", 6],
  ])("reports no winner for a %s market, not NO", async (_l, status) => {
    const m = await client({status, winningOutcome: 0, resolvedAt: 1790000500n}).getMarket(MARKET);
    expect(m.winningOutcome).toBeNull();
  });

  it("still reports NO as a winner for a Settled market", async () => {
    const m = await client({status: 4, winningOutcome: 0, resolvedAt: 1790000500n}).getMarket(MARKET);
    expect(m.winningOutcome).toBe(0);
  });

  /** `redeem` on a market with no winner has nothing to claim, and says so. */
  it("refuses to redeem a failed market", async () => {
    await expect(client({status: 5, resolvedAt: 1790000500n}).redeem(MARKET)).rejects.toThrow(/not been resolved/);
  });
});

/**
 * A handle is bytes32, and bytes32 is 32 bytes — but a name has to round-trip, so 31
 * is the limit. `stringToHex` with `size: 32` TRUNCATES silently, and an agent that
 * discovered its handle had been cut short after registering could not tell that
 * from having typed it wrong.
 */
describe("agent names as the chain stores them", () => {
  it("round-trips an ordinary handle", () => {
    expect(decodeAgentName(encodeAgentName("Nostradamus"))).toBe("Nostradamus");
  });

  it("right-pads, as bytes32 does", () => {
    expect(encodeAgentName("a")).toBe(`0x61${"0".repeat(62)}`);
  });

  it("refuses a name too long to survive rather than truncating it", () => {
    expect(() => encodeAgentName("x".repeat(31))).not.toThrow();
    expect(() => encodeAgentName("x".repeat(32))).toThrow(/must fit in 31/);
  });

  it("refuses an empty name", () => {
    expect(() => encodeAgentName("")).toThrow(/cannot be empty/);
  });

  /** An unset name is zero, and zero is not the empty string — it is "no name". */
  it("reads an unset name as null, not as an empty handle", () => {
    expect(decodeAgentName(`0x${"0".repeat(64)}`)).toBeNull();
  });

  it("counts BYTES, not characters", () => {
    // Ten emoji are 40 bytes and will not fit, however short they look.
    expect(() => encodeAgentName("🤖".repeat(10))).toThrow(/must fit in 31/);
    expect(decodeAgentName(encodeAgentName("🤖 oracle"))).toBe("🤖 oracle");
  });
});
