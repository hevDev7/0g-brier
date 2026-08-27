import {describe, expect, it} from "vitest";
import {render, screen, within} from "@testing-library/react";
import {PositionsTable} from "@/components/market/PositionsTable";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
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
