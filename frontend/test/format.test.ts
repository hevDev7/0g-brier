import {describe, expect, it} from "vitest";
import {
  formatCollateral, formatCountdown, formatFeeRate, formatPayout, formatPricePerShare,
  formatProbability, formatProbabilityDelta, formatShares, shortAddress,
} from "@/lib/format";

const WAD = 10n ** 18n;

describe("formatProbability", () => {
  it("formats a wad probability as a percentage with 1 decimal", () => {
    expect(formatProbability(590_000_000_000_000_000n)).toBe("59.0%");
    expect(formatProbability(410_000_000_000_000_000n)).toBe("41.0%");
    expect(formatProbability(WAD / 2n)).toBe("50.0%");
  });

  it("rounds half up rather than truncating", () => {
    // 0.6385 -> 63.85% -> 63.9%
    expect(formatProbability(638_500_000_000_000_000n)).toBe("63.9%");
  });

  it("handles the extremes", () => {
    expect(formatProbability(0n)).toBe("0.0%");
    expect(formatProbability(WAD)).toBe("100.0%");
  });
});

describe("formatProbabilityDelta", () => {
  it("is always signed, in points", () => {
    expect(formatProbabilityDelta(590_000_000_000_000_000n, 638_000_000_000_000_000n)).toBe("+4.8 pt");
    expect(formatProbabilityDelta(638_000_000_000_000_000n, 590_000_000_000_000_000n)).toBe("-4.8 pt");
    expect(formatProbabilityDelta(WAD / 2n, WAD / 2n)).toBe("+0.0 pt");
  });

  it("never shows a negative zero", () => {
    expect(formatProbabilityDelta(1n, 0n)).toBe("+0.0 pt");
    expect(formatProbabilityDelta(0n, 1n)).toBe("+0.0 pt");
  });
});

describe("formatPayout", () => {
  it("uses 2 decimals with a multiplication sign", () => {
    expect(formatPayout(1_301_700_000_000_000_000n)).toBe("1.30×");
    expect(formatPayout(1_562_000_000_000_000_000n)).toBe("1.56×");
  });
});

describe("formatFeeRate", () => {
  it("turns basis points into a percentage rate with 2 decimals", () => {
    expect(formatFeeRate(100)).toBe("1.00%");
    expect(formatFeeRate(1)).toBe("0.01%");
    expect(formatFeeRate(250)).toBe("2.50%");
    expect(formatFeeRate(10_000)).toBe("100.00%");
    expect(formatFeeRate(0)).toBe("0.00%");
  });
});

/**
 * Sign handling in `format.ts` has leaked twice: the "-0.0" bug, where the sign was captured
 * before rounding, and then `formatFeeRate` losing the sign on -100 < bps < 0 because
 * `Math.trunc(-0.5)` is `-0` and `${-0}` is `"0"`. Both leaks were at a seam between a
 * magnitude path and a sign path, so the whole sign surface is checked here at once rather
 * than one function at a time as each failure surfaces.
 *
 * Note what is NOT asserted: the bigint formatters render a negative dust value as an unsigned
 * zero ("0.00", not "-0.00"). That is deliberate and is what the first fix installed — a
 * magnitude that rounds away should not leave a minus sign behind.
 */
describe("sign handling across every formatter that touches one", () => {
  it("formatFeeRate keeps the sign below one percent, where -0 used to eat it", () => {
    expect(formatFeeRate(-50)).toBe("-0.50%");
    expect(formatFeeRate(-5)).toBe("-0.05%");
    expect(formatFeeRate(-1)).toBe("-0.01%");
  });

  it("formatFeeRate keeps the sign at and above one percent", () => {
    expect(formatFeeRate(-100)).toBe("-1.00%");
    expect(formatFeeRate(-150)).toBe("-1.50%");
    expect(formatFeeRate(-10_000)).toBe("-100.00%");
  });

  it("formatFeeRate never renders a negative zero", () => {
    expect(formatFeeRate(0)).toBe("0.00%");
    expect(formatFeeRate(-0)).toBe("0.00%");
  });

  it("formatFeeRate rejects a non-integer rather than formatting nonsense", () => {
    expect(() => formatFeeRate(1.5)).toThrow(RangeError);
  });

  it("the bigint formatters drop a sign only when the magnitude rounds away", () => {
    expect(formatCollateral(-1n, 6)).toBe("0.00");
    expect(formatShares(-1n)).toBe("0.00");
    expect(formatPricePerShare(-1n)).toBe("0.0000");
    expect(formatPayout(-1n)).toBe("0.00×");
    // ...and keep it when the magnitude survives.
    expect(formatCollateral(-1_500_000n, 6)).toBe("-1.50");
    expect(formatShares(-(10n ** 18n))).toBe("-1.00");
    expect(formatPayout(-(10n ** 18n))).toBe("-1.00×");
  });
});

describe("formatCollateral", () => {
  it("respects the token decimals and groups thousands", () => {
    expect(formatCollateral(1_234_560_000n, 6)).toBe("1,234.56");
    expect(formatCollateral(100_000_000n, 6)).toBe("100.00");
    expect(formatCollateral(990_000n, 6)).toBe("0.99");
  });

  it("groups large numbers", () => {
    expect(formatCollateral(1_234_567_890_123n, 6)).toBe("1,234,567.89");
  });
});

describe("formatShares and formatPricePerShare", () => {
  it("shows shares to 2 decimals and prices to 4", () => {
    expect(formatShares(126_320_000_000_000_000_000n)).toBe("126.32");
    expect(formatPricePerShare(783_800_000_000_000_000n)).toBe("0.7838");
  });
});

describe("shortAddress", () => {
  it("elides the middle", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("formatCountdown", () => {
  it("picks the two largest units", () => {
    expect(formatCountdown(2 * 3600 + 14 * 60)).toBe("2h 14m");
    expect(formatCountdown(3 * 86400 + 5 * 3600)).toBe("3d 5h");
    expect(formatCountdown(45 * 60)).toBe("45m");
  });

  /**
   * It formats a LENGTH, and a length is never a status.
   *
   * This used to assert `"closed"`, which pinned a real defect in place: the same
   * function formats durations — a dispute window of zero would have read
   * "closed" — and `Closed` is the name of a market status, so a market list row
   * showed `Open` and `closed` in adjacent columns. Whether a deadline has passed
   * is the caller's question.
   */
  it("formats a spent duration as a duration, not as a status", () => {
    expect(formatCountdown(0)).toBe("0m");
    expect(formatCountdown(-10)).toBe("0m");
    expect(formatCountdown(0)).not.toMatch(/closed/i);
  });
});
