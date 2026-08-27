import {render, screen, within} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {Lifecycle} from "@/components/market/Lifecycle";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import {formatTimestamp} from "@/lib/format";
import type {MarketDetail} from "@/lib/data/types";

const open = FIXTURE_MARKETS[0]!;
const settled = FIXTURE_MARKETS.find((m) => m.status === "Settled")!;

function step(label: string): HTMLElement {
  return screen.getAllByRole("listitem").find((li) => li.textContent?.includes(label))!;
}

describe("Lifecycle", () => {
  it("shows the complete lifecycle timeline", () => {
    render(<Lifecycle market={open} mode="mock" />);
    // `createdAt` is nullable now — a mode without an indexer cannot know it. The
    // fixture supplies one, so the assertion still covers all three, but it says so
    // rather than assuming.
    expect(open.createdAt).not.toBeNull();
    for (const at of [open.createdAt!, open.tradingEnd, open.settlementDeadline]) {
      expect(screen.getByText(formatTimestamp(at))).toBeInTheDocument();
    }
  });

  /**
   * The gap between trading closing and the settlement deadline is the window in
   * which funds stay locked. Showing it as a duration, rather than leaving a
   * reader to subtract two dates, is the whole reason this panel exists.
   */
  it("names the dispute window as a duration", () => {
    render(<Lifecycle market={open} mode="mock" />);
    // 76h - 52h = 24h after the fixture clock.
    expect(screen.getByText(/dispute window/i)).toHaveTextContent("1d 0h");
  });

  it("an open market has not reached the later steps", () => {
    render(<Lifecycle market={open} mode="mock" />);
    expect(within(step("Created")).getByText(/reached/)).toHaveTextContent("— reached");
    expect(step("Trading closes")).toHaveTextContent("not yet reached");
    expect(step("Settlement deadline")).toHaveTextContent("not yet reached");
  });

  it("a settled market has reached every step", () => {
    render(<Lifecycle market={settled} mode="mock" />);
    for (const label of ["Created", "Trading closes", "Settlement deadline"]) {
      expect(step(label)).not.toHaveTextContent("not yet reached");
    }
  });

  /**
   * The heart of it: progress is read from `status`, never from the wall clock.
   * A market whose trading end has passed but which has not been closed on chain
   * is still Open, and this panel must report what happened rather than what the
   * clock implies should have.
   */
  it("reads progress from status, not from the clock", () => {
    // tradingEnd is far in the PAST, yet the chain still reports Open.
    const stale: MarketDetail = {...open, tradingEnd: open.createdAt! + 1, status: "Open"};
    render(<Lifecycle market={stale} mode="mock" />);
    expect(step("Trading closes")).toHaveTextContent("not yet reached");
  });

  it("a closed-but-unsettled market shows exactly one step outstanding", () => {
    const closed: MarketDetail = {...open, status: "Closed"};
    render(<Lifecycle market={closed} mode="mock" />);
    expect(step("Trading closes")).not.toHaveTextContent("not yet reached");
    expect(step("Settlement deadline")).toHaveTextContent("not yet reached");
  });
});
