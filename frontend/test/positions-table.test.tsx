import {describe, expect, it} from "vitest";
import {render, screen, within} from "@testing-library/react";
import {PositionsTable} from "@/components/market/PositionsTable";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import {toTokensFloor} from "@hevdev7/protocol";
import type {Position} from "@/lib/data/types";

const WAD = 10n ** 18n;
const m = FIXTURE_MARKETS[0]!;
const positions: Position[] = [
  {agent: "0xAAaAaAAaAAaAaaAaaAAAAaAaAaaAAAAAaAaAaAaA", outcome: 1,
   shares: 100n * WAD, entryPriceWad: (WAD * 70n) / 100n},
  {agent: "0xBbBBBbbBbBbbbBBbBbbbbbBBbBbbbBBbBBbBBBbB", outcome: 0,
   shares: 40n * WAD, entryPriceWad: (WAD * 55n) / 100n},
];

describe("PositionsTable", () => {
  it("renders one row per position, with its side", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
  });

  it("entry price and current price are both per share, with no percent label", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("%");
    expect(within(row).getByTestId("current")).not.toHaveTextContent("%");
  });

  it("an empty list explains itself rather than showing a bare table", () => {
    render(<PositionsTable positions={[]} market={m} mode="mock" />);
    expect(screen.getByText(/no positions/i)).toBeInTheDocument();
  });

  it("a null entry price renders an explanation, not a zero; the other columns stay populated", () => {
    const unknown = positions.map((p) => ({...p, entryPriceWad: null}));
    render(<PositionsTable positions={unknown} market={m} mode="chain" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).toHaveTextContent(/not available/i);
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("0.0000");
    expect(within(row).getByTestId("current")).not.toHaveTextContent(/not available/i);
  });

  it("elides the agent address", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.queryByText(positions[0]!.agent)).not.toBeInTheDocument();
    expect(screen.getByText(/0xAAaA…AaAa/i)).toBeInTheDocument();
  });

  // Ruling R-F1-1 (the task-5 controller): Task 7 assembles this panel into the
  // page and its test depends on `screen.findByTestId("positions-table")` being on
  // the panel's outermost element — in BOTH branches, populated and empty.
  it("the outermost element carries data-testid positions-table when populated", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
  });

  it("the outermost element carries data-testid positions-table when empty", () => {
    render(<PositionsTable positions={[]} market={m} mode="mock" />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
  });
});

/**
 * After settlement the marginal price is frozen, not stale — `q` has stopped
 * moving — so the old last column was showing a real number. It just was not
 * the row's worth, and it sat directly beside a share count, which invites the
 * product. The winning side pays `1/p`, the reciprocal, so reading the column
 * that way understates a position by more than it looks: on the live settled
 * market, 73.91 shares at "0.7413" reads as 54.79 mUSDC against an actual
 * 99.70. The losing row was worse — a price on shares worth nothing.
 */
describe("once the market has settled", () => {
  const settled = {...m, winningOutcome: 1 as const, resolvedAt: 1_790_000_000};
  const row = (i: number) => screen.getAllByRole("row")[i]!;

  it("shows what the winning position redeems for, not a price it no longer has", () => {
    render(<PositionsTable positions={positions} market={settled} mode="mock" />);
    expect(screen.queryByText(/current price/i)).toBeNull();
    // The identity the pool guarantees: every winning share pays poolWad/q[win],
    // so the holders of ALL the winning shares are paid exactly the pool. This
    // fixture holds 100 of them out of the market's own q, and the cell must
    // agree with that arithmetic rather than with anything rounded on the way.
    const expected = toTokensFloor(
      (100n * WAD * ((settled.poolWad * WAD) / settled.q[1])) / WAD,
      settled.collateral.decimals,
    );
    expect(within(row(1)).getByTestId("current")).toHaveTextContent(
      new Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(
        Number(expected) / 10 ** settled.collateral.decimals,
      ),
    );
  });

  it("prices the losing position at nothing", () => {
    render(<PositionsTable positions={positions} market={settled} mode="mock" />);
    expect(within(row(2)).getByTestId("current")).toHaveTextContent("0.00");
  });

  it("says which side won, so the column is not read as a price", () => {
    render(<PositionsTable positions={positions} market={settled} mode="mock" />);
    expect(screen.getByText(/losing shares redeem for nothing/i)).toHaveTextContent("YES won");
  });

  it("leaves an open market showing the current price exactly as before", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getByText(/current price/i)).toBeInTheDocument();
    expect(within(row(1)).getByTestId("current")).toHaveTextContent(/^0\.\d{4}$/);
  });
});
