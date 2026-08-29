import {WAD, toWad} from "@hevdev7/protocol";
import type {Candle, Interval, Outcome, Position, Trade} from "./types";

/**
 * Everything a history-bearing source derives from a list of trades, in one
 * place.
 *
 * The contract emits `probAfter` on every `Trade` precisely so a consumer can
 * rebuild the probability curve "without a single historical eth_call"
 * (IMarket.sol). That makes the tape the primitive and the chart, the position
 * book and the cost basis all consequences of it — so they belong together,
 * shared by the fixtures and by anything reading real logs. Two copies is how the
 * mock and the live view start disagreeing about the same market.
 */

/**
 * Bucket width per interval. A `Record<Interval, number>` rather than a ternary
 * chain: the chain ended in a bare `: 5 * 60`, which quietly made `"1m"` a
 * five-minute bucket. A Record makes TypeScript demand an entry for a new
 * interval instead of letting it inherit the last branch.
 */
export const BUCKET_SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
  // Thirty days, and named for what it is. A calendar month is not a fixed number
  // of seconds; a bucket that called itself one would put February and August on
  // the same axis and imply they were the same width.
  "30d": 30 * 24 * 60 * 60,
};

/**
 * ONE candle per bucket, not one per trade. open/close are the first and last
 * trade inside that bucket; high/low span it.
 *
 * @param trades in ANY order — sorted here rather than trusted, because a caller
 *        reading logs gets ascending order and a caller reading a tape gets
 *        descending, and open/close are wrong if that is guessed.
 */
export function candlesFrom(trades: readonly Trade[], interval: Interval): Candle[] {
  const step = BUCKET_SECONDS[interval];
  const ascending = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const buckets = new Map<number, Candle>();
  for (const t of ascending) {
    const bucketStart = t.timestamp - (t.timestamp % step);
    const candle = buckets.get(bucketStart);
    if (candle === undefined) {
      buckets.set(bucketStart, {
        bucketStart,
        open: t.probYesAfterWad,
        high: t.probYesAfterWad,
        low: t.probYesAfterWad,
        close: t.probYesAfterWad,
        volume: t.tokens,
      });
    } else {
      if (t.probYesAfterWad > candle.high) candle.high = t.probYesAfterWad;
      if (t.probYesAfterWad < candle.low) candle.low = t.probYesAfterWad;
      candle.close = t.probYesAfterWad;
      candle.volume += t.tokens;
    }
  }
  return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
}

/**
 * The position book, at average cost.
 *
 * Sells are subtracted, and that is not a refinement — it is a correctness fix
 * that only real data would have exposed. The fixture generator gives every trade
 * its own trader, so no fixture agent has ever both bought and sold the same
 * outcome; a version that counted only purchases looked perfect against fixtures
 * and would have reported an agent who bought 300 and sold 100 as holding 300.
 *
 * On a sale the cost basis is reduced in proportion to the shares leaving, which
 * is what average-cost accounting means: selling does not change the average
 * price you paid for what you still hold. With buy-only data the arithmetic is
 * identical to a plain cost/shares, so the fixtures see no change.
 */
export function positionsFrom(trades: readonly Trade[], collateralDecimals: number): Position[] {
  const acc = new Map<string, {shares: bigint; cost: bigint}>();
  const ascending = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const t of ascending) {
    const key = `${t.trader}:${t.outcome}`;
    const cur = acc.get(key) ?? {shares: 0n, cost: 0n};
    if (t.sharesDelta > 0n) {
      acc.set(key, {shares: cur.shares + t.sharesDelta, cost: cur.cost + t.tokens});
      continue;
    }
    const sold = -t.sharesDelta;
    // Guard rather than trust: a sale larger than the recorded holding means the
    // log range began mid-life, and a negative holding would be a worse answer
    // than an empty one.
    if (sold >= cur.shares || cur.shares === 0n) {
      acc.set(key, {shares: 0n, cost: 0n});
      continue;
    }
    acc.set(key, {
      shares: cur.shares - sold,
      cost: cur.cost - (cur.cost * sold) / cur.shares,
    });
  }

  const out: Position[] = [];
  for (const [key, v] of acc) {
    if (v.shares === 0n) continue;
    const [agent, outcomeStr] = key.split(":");
    out.push({
      agent: agent as `0x${string}`,
      outcome: Number(outcomeStr) as Outcome,
      shares: v.shares,
      // `cost` is in token units; scaled up to wad before dividing so the result
      // is a price per share in wad rather than a fraction truncated to zero.
      entryPriceWad: (toWad(v.cost, collateralDecimals) * WAD) / v.shares,
    });
  }
  return out.sort((a, b) => (a.shares === b.shares ? 0 : b.shares > a.shares ? 1 : -1));
}
