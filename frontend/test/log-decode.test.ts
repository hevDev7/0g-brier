import {describe, expect, it} from "vitest";
import {LogSource} from "@/lib/data/logs";
import {dpm} from "@0g-brier/protocol";

/**
 * The decode step, with the chain stubbed out.
 *
 * This file exists because of one live NO trade. Until it happened every trade
 * in the project had been a YES trade, and on a YES trade the contract's
 * `probAfter` — which is `probability(qAfter, outcome)`, the probability of the
 * side TRADED — is identical to P(YES). The frontend read the field as P(YES)
 * unconditionally and was right every single time, until it wasn't: the chart
 * then plotted P(NO) as its YES series and drew the market upside down.
 *
 * Neither of the two tests that should have caught it could. `mock.ts` writes
 * `probability(q, 1)` whatever the side, so mock mode was internally consistent
 * with the bug; and the live assertion compared against the newest trade, which
 * had always been YES.
 */
const WAD = 10n ** 18n;
// P(YES) = 4/5, P(NO) = 1/5 — far enough apart that no rounding argument can
// confuse one for the other.
const Q: readonly [bigint, bigint] = [WAD, 2n * WAD];

function sourceReturning(outcome: 0 | 1) {
  const source = new LogSource({
    rpcUrl: "http://127.0.0.1:1",
    chainId: 16602,
    factory: "0x0000000000000000000000000000000000000001",
    fromBlock: 0n,
  });
  // The client is private, and reaching past that is the point: this asserts on
  // the decoding, and a network is the one thing it must not depend on.
  (source as unknown as {client: unknown}).client = {
    getLogs: async () => [
      {
        blockNumber: 7n,
        logIndex: 0,
        args: {
          trader: "0x00000000000000000000000000000000000000aa",
          recipient: "0x00000000000000000000000000000000000000aa",
          outcome,
          sharesDelta: 5n * WAD,
          tokens: 1_000n,
          fee: 10n,
          qAfter: Q,
          // What the contract actually emits: the traded side's probability.
          probAfter: dpm.probability(Q, outcome),
        },
      },
    ],
    getBlock: async () => ({timestamp: 1_700_000_000n}),
  };
  return source;
}

describe("Trade decoding normalises probability to the YES side", () => {
  it("reports P(YES) for a YES trade", async () => {
    const [trade] = await sourceReturning(1).getTrades("0x0000000000000000000000000000000000000002", 10);
    expect(trade!.probYesAfterWad).toBe(dpm.probability(Q, 1));
    expect(trade!.probYesAfterWad).toBe((WAD * 4n) / 5n);
  });

  it("reports P(YES) for a NO trade, not the P(NO) the event carries", async () => {
    const [trade] = await sourceReturning(0).getTrades("0x0000000000000000000000000000000000000002", 10);
    expect(trade!.outcome).toBe(0);
    // The regression: this used to be dpm.probability(Q, 0) — one fifth — and
    // the chart drew the market inverted.
    expect(trade!.probYesAfterWad).toBe(dpm.probability(Q, 1));
    expect(trade!.probYesAfterWad).not.toBe(dpm.probability(Q, 0));
  });

  it("derives the candle close from the YES side of a NO trade", async () => {
    const candles = await sourceReturning(0).getCandles(
      "0x0000000000000000000000000000000000000002",
      "1h",
    );
    expect(candles.at(-1)!.close).toBe(dpm.probability(Q, 1));
  });
});
