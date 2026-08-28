import type {Candle, MarketStatus} from "@/lib/data/types";

const DAY = 86_400;

export interface Delta24h {
  /** Signed change in P(YES), wad. */
  deltaWad: bigint;
  /** The span the change was ACTUALLY measured over, seconds. */
  spanSeconds: number;
}

/**
 * The change in P(YES) across the last 24 hours of recorded history.
 *
 * `spanSeconds` is returned rather than assumed because the history is often
 * shorter than a day: a market opened four hours ago has no 24-hour change, and
 * a column headed "Δ24h" that silently reports a four-hour move is a small lie
 * of exactly the kind this codebase spends its effort avoiding. Callers show the
 * real span; when there is not enough history to measure anything at all, this
 * returns null and the cell says so instead of rendering a zero.
 *
 * The baseline is the OLDEST bucket still inside the window, and its `open` —
 * not its `close` — because `open` is the probability at the moment that bucket
 * began, which is where the measured period actually starts.
 */
export function delta24h(candles: readonly Candle[]): Delta24h | null {
  if (candles.length < 2) return null;
  const newest = candles[candles.length - 1]!;
  const cutoff = newest.bucketStart - DAY;

  let baseline = candles[0]!;
  for (const candle of candles) {
    if (candle.bucketStart >= cutoff) {
      baseline = candle;
      break;
    }
  }

  const spanSeconds = newest.bucketStart - baseline.bucketStart;
  if (spanSeconds === 0) return null;
  return {deltaWad: newest.close - baseline.open, spanSeconds};
}

/** Total traded value, unsigned: a sell is volume too. */
export function volumeOf(trades: readonly {tokens: bigint}[]): bigint {
  return trades.reduce((sum, t) => sum + (t.tokens < 0n ? -t.tokens : t.tokens), 0n);
}

export type Tone = "neutral" | "positive" | "negative" | "warning" | "verified";

/**
 * A status's colour says what the label already says, so it adds nothing on its
 * own — but in a table of twenty rows it is what lets a reader find the two
 * markets that need attention without reading twenty words. That is information
 * the label does not carry at a glance, which is what earns it colour here.
 */
/**
 * What the reader can actually do, which is not the same question as `status`.
 *
 * `Open` means only that `close()` has not been called. It says nothing about
 * `tradingEnd`, and nothing obliges anyone to call `close()` promptly — on a
 * deployment with no keeper, nobody does. So a market sat there badged a green
 * `Open` while every exit reverted: `sell` with `TradingEnded`, `redeem` with
 * `NotSettled`, `liquidate` with `NotLiquidatable`. Green means "go" in every
 * interface a reader has ever used, and there was nowhere to go.
 *
 * `now === null` before the browser reports a clock; the chain status is shown
 * unrefined rather than guessed at, and sharpens once the clock arrives.
 */
export function tradingState(
  market: {status: MarketStatus; tradingEnd: number},
  now: number | null,
): {label: string; tone: Tone; hint: string} {
  if (market.status === "Open" && now !== null && now >= market.tradingEnd) {
    return {
      label: "Awaiting close",
      tone: "warning",
      hint: "Trading has ended. The market stays Open on chain until someone calls close(), and nothing can be bought, sold or redeemed until it is.",
    };
  }
  return {label: market.status, tone: statusTone(market.status), hint: `On-chain status: ${market.status}`};
}

export function statusTone(status: MarketStatus): Tone {
  switch (status) {
    case "Open":
      return "positive";
    case "Proposed":
    case "Closed":
    case "Disputed":
      return "warning";
    case "Failed":
    case "Voided":
      return "negative";
    case "Settled":
      return "neutral";
  }
}
