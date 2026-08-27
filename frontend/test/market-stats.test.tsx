import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {MarketStats} from "@/components/market/MarketStats";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import {formatTimestamp} from "@/lib/format";
import type {Trade} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const trades: Trade[] = [
  {id: "1", timestamp: 1, trader: "0x1111111111111111111111111111111111111111",
   outcome: 1, sharesDelta: 10n ** 18n, tokens: 500_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
  {id: "2", timestamp: 2, trader: "0x2222222222222222222222222222222222222222",
   outcome: 0, sharesDelta: -(10n ** 18n), tokens: 300_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
];

describe("MarketStats", () => {
  it("sums volume from absolute token values, buys and sells alike", () => {
    render(<MarketStats market={m} trades={{status: "ready", data: trades}} />);
    expect(screen.getByTestId("stat-volume")).toHaveTextContent("0.80");
  });

  it("only the volume row is unavailable; the other rows stay populated", () => {
    render(
      <MarketStats market={m} trades={{status: "unavailable", capability: "TRADE_TAPE", mode: "chain"}} />,
    );
    expect(screen.getByTestId("stat-volume")).toHaveTextContent(/not available/i);
    expect(screen.getByTestId("stat-fee")).not.toHaveTextContent(/not available/i);
    expect(screen.getByTestId("stat-liquidity")).not.toHaveTextContent(/not available/i);
  });

  // The lifecycle dates moved to <Lifecycle>, which shows them as a sequence and
  // names the dispute window; the guarantee moved with them, to lifecycle.test.tsx.
  // Listing the same dates in two panels meant a reader had to check they agreed.

  it("shows the fee as a rate, not just as an amount", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    expect(screen.getByTestId("stat-fee")).toHaveTextContent("%");
  });

  // Ruling R-F1-1 (the task-4 controller): Task 7 assembles this panel into the
  // page and its test depends on `screen.findByTestId("market-stats")` being on
  // the panel's outermost element.
  it("the panel's outermost element carries data-testid market-stats", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    expect(screen.getByTestId("market-stats")).toBeInTheDocument();
  });
});

describe("formatTimestamp", () => {
  // Two earlier sign bugs in format.ts (formatProbabilityDelta's "-0.0", then
  // formatFeeRate losing the sign on negative input) are why the edge cases here
  // are tested explicitly rather than assumed safe because the function "merely"
  // wraps Date.toLocaleString.
  //
  // The assertions deliberately do NOT pin the exact locale string (the day/hour
  // depend on the timezone of the machine running the test — see chart.ts, which
  // uses toLocaleDateString without pinning an exact string for the same reason).
  // What is locked down here is the behavioural DECISION at the edges: the
  // function never produces "Invalid Date" / "NaN", and the year survives.

  it("unixSeconds 0 renders as the real epoch, not as a placeholder", () => {
    // 0 is a valid Unix timestamp (1 Jan 1970) — formatTimestamp knows nothing
    // about "not yet known"; that is Query.status's business, not a numeric value's.
    // So 0 is formatted as it is, just as formatCollateral(0n, ...) renders "0.00"
    // rather than hiding it.
    const out = formatTimestamp(0);
    expect(out).not.toBe("Invalid Date");
    expect(out).not.toMatch(/nan/i);
    expect(out).toMatch(/19(69|70)/); // the epoch; the exact year depends on the machine's timezone
  });

  it("a date far in the future still formats, without overflowing", () => {
    // Mid-year and mid-day UTC are used deliberately (not midnight or year end) so
    // that no timezone offset (-12..+14 hours) can ever shift the date into another
    // year — which makes the year safe to pin here.
    const farFuture = Math.floor(Date.UTC(9999, 5, 15, 12, 0, 0) / 1000);
    const out = formatTimestamp(farFuture);
    expect(out).not.toBe("Invalid Date");
    expect(out).not.toMatch(/nan/i);
    expect(out).toContain("9999");
  });
});
