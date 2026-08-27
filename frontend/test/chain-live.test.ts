import {describe, expect, it} from "vitest";
import {ChainSource} from "@/lib/data/chain";
import {LogSource} from "@/lib/data/logs";
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

describe.skipIf(!FACTORY)("LogSource against live Galileo", () => {
  const source = () =>
    new LogSource({
      rpcUrl: RPC,
      chainId: 16602,
      factory: FACTORY!,
      fromBlock: BigInt(process.env.GALILEO_FROM_BLOCK ?? "0"),
    });

  it("answers the history that ChainSource has to refuse", async () => {
    const s = source();
    for (const capability of ["TRADE_TAPE", "PRICE_HISTORY", "AGENT_POSITIONS", "COST_BASIS"]) {
      expect(s.capabilities.has(capability as never)).toBe(true);
    }
    // Still not, and no amount of log reading changes it: a receipt is a 0G
    // Storage document, not an event.
    expect(s.capabilities.has("SETTLEMENT_RECEIPT")).toBe(false);
  });

  it("rebuilds the tape from Trade logs", async () => {
    const [m] = await source().listMarkets();
    const trades = await source().getTrades(m!.address, 50);
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades) {
      expect(t.timestamp).toBeGreaterThan(0);
      expect([0, 1]).toContain(t.outcome);
      expect(t.sharesDelta).not.toBe(0n);
    }
    // Newest first, like every other tape here.
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i - 1]!.timestamp).toBeGreaterThanOrEqual(trades[i]!.timestamp);
    }
  });

  /**
   * The claim the contract's own NatSpec makes: `probAfter` is emitted "so that an
   * indexer can reconstruct the probability curve without a single historical
   * eth_call". This checks that the curve's last point really does land on the
   * probability the market reports right now — if it did not, the chart and the
   * panel above it would be telling a reader two different things.
   */
  it("closes the curve on the probability the market reports today", async () => {
    const [m] = await source().listMarkets();
    const trades = await source().getTrades(m!.address, 50);
    const newest = trades[0]!;
    expect(newest.probAfterWad).toBe(dpm.probability(m!.q, 1));
  });

  it("supplies the createdAt that chain mode cannot", async () => {
    const [m] = await source().listMarkets();
    expect(m!.createdAt).not.toBeNull();
    expect(m!.createdAt!).toBeGreaterThan(1_700_000_000);
    expect(m!.createdAt!).toBeLessThanOrEqual(m!.tradingEnd);
  });

  it("rebuilds positions with a cost basis, net of sells", async () => {
    const [m] = await source().listMarkets();
    const positions = await source().getPositions(m!.address);
    for (const p of positions) {
      expect(p.shares).toBeGreaterThan(0n);
      expect(p.entryPriceWad).not.toBeNull();
      // A price per share on a binary market lives strictly inside (0, 1).
      expect(p.entryPriceWad!).toBeGreaterThan(0n);
      expect(p.entryPriceWad!).toBeLessThan(10n ** 18n);
    }
  });
});
