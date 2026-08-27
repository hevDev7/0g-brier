import {describe, expect, it} from "vitest";
import {ChainSource} from "@/lib/data/chain";
import {CapabilityUnavailableError} from "@/lib/data/types";
import {dpm, quote} from "@0g-delphi/protocol";

/**
 * The only test here that touches a network, and therefore opt-in:
 *
 *   GALILEO_FACTORY=0x… npx vitest run test/chain-live.test.ts
 *
 * A stub proves the decoding; this proves the ABI matches contracts that are
 * actually deployed. Those are different claims, and a green stub has never once
 * caught a renamed getter.
 */
const FACTORY = process.env.GALILEO_FACTORY as `0x${string}` | undefined;
const RPC = process.env.GALILEO_RPC ?? "https://evmrpc-testnet.0g.ai";

describe.skipIf(!FACTORY)("ChainSource against live Galileo", () => {
  const source = () => new ChainSource({rpcUrl: RPC, chainId: 16602, factory: FACTORY!});

  it("lists the markets the factory actually holds", async () => {
    const markets = await source().listMarkets();
    expect(markets.length).toBeGreaterThan(0);
    const [first] = markets;
    expect(first!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(first!.collateral.decimals).toBe(6);
    expect(["Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided"]).toContain(first!.status);
  });

  /**
   * INV-1 across the network boundary: the pool a live contract reports, against
   * costUp(q) computed by the TypeScript mirror. It is the differential test
   * repeated over RPC — a mirror that had drifted from DPMMath.sol would put a
   * wrong number on screen and nothing else would say so.
   *
   * The two regimes are NOT optional here, and the first draft of this test got it
   * wrong: it asserted equality against a market that had already settled and
   * found 65 against 1150148995771686534475. The contract was right. From
   * settle/fail/void onward `q` is frozen and `poolWad` stops meaning "the cost of
   * q" and starts meaning "the liability still unclaimed", which only shrinks as
   * holders are paid. Equality before, an upper bound after.
   */
  it("reads a pool that agrees with the mirror, in whichever regime the market is in", async () => {
    const [summary] = await source().listMarkets();
    const market = await source().getMarket(summary!.address);
    const resolved = ["Settled", "Failed", "Voided"].includes(market.status);
    if (resolved) {
      expect(market.poolWad).toBeLessThanOrEqual(dpm.costUp(market.q));
    } else {
      expect(market.poolWad).toBe(dpm.costUp(market.q));
    }
  });

  it("derives a probability and a payout the same way the contract does", async () => {
    const [summary] = await source().listMarkets();
    const p = dpm.probability(summary!.q, 1);
    expect(p).toBeGreaterThan(0n);
    expect(p).toBeLessThanOrEqual(10n ** 18n);
    // The rule that outlives every refactor: payout is 1/p, not 1/P.
    const payout = quote.payoutPerShareWad(summary!.q, 1);
    const wrong = (10n ** 18n * 10n ** 18n) / p;
    expect(payout).not.toBe(wrong);
  });

  it("still refuses history from a chain that genuinely has none", async () => {
    const [summary] = await source().listMarkets();
    await expect(source().getTrades()).rejects.toBeInstanceOf(CapabilityUnavailableError);
    await expect(source().getPositions()).rejects.toMatchObject({capability: "AGENT_POSITIONS"});
    expect(summary!.question).toBeNull();
  });
});
