import {describe, expect, it} from "vitest";
import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MarketActivity} from "@/components/market/MarketActivity";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {Position, Query, Trade} from "@/lib/data/types";

const WAD = 10n ** 18n;
const m = FIXTURE_MARKETS[0]!;
const ALICE = "0xAAaAaAAaAAaAaaAaaAAAAaAaAaaAAAAAaAaAaAaA" as const;
const BOB = "0xBbBBBbbBbBbbbBBbBbbbbbBBbBbbbBBbBBbBBBbB" as const;

const positions: Position[] = [
  {agent: ALICE, outcome: 1, shares: 100n * WAD, entryPriceWad: (WAD * 70n) / 100n},
  {agent: BOB, outcome: 0, shares: 40n * WAD, entryPriceWad: (WAD * 55n) / 100n},
];

const trade = (id: string, trader: `0x${string}`): Trade => ({
  id,
  timestamp: 1_780_000_000,
  trader,
  outcome: 1,
  sharesDelta: 10n * WAD,
  tokens: 7_000_000n,
  fee: 70_000n,
  probYesAfterWad: (WAD * 59n) / 100n,
});
// Two for Alice, one for Bob — so a filter that works shows a DIFFERENT number of
// rows than no filter, which a single-trade fixture could not distinguish.
const trades: Trade[] = [trade("t1", ALICE), trade("t2", BOB), trade("t3", ALICE)];

const ready = <T,>(data: T): Query<T> => ({status: "ready", data}) as Query<T>;

function renderPanel(overrides: {trades?: Query<Trade[]>} = {}) {
  return render(
    <MarketActivity
      positions={ready(positions)}
      trades={overrides.trades ?? ready(trades)}
      market={m}
      mode="mock"
      collateral={m.collateral}
    />,
  );
}

/**
 * The panel exists because two tables that answer different questions were being
 * shown in identical chrome and read as one thing said twice. These tests hold the
 * line that merging the CONTAINER did not merge the DATA: the tape must never
 * start showing balances, and the positions must never acquire a clock.
 */
describe("MarketActivity", () => {
  it("shows holdings first, with the tape mounted but hidden", () => {
    renderPanel();
    expect(screen.getByRole("tab", {name: /who holds what/i})).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Mounted, so switching back is free and the filter survives — but hidden, so
    // the reader is not looking at both at once, which was the whole complaint.
    expect(screen.getByTestId("trade-tape").closest("[role=tabpanel]")).toHaveAttribute("hidden");
  });

  it("switches to the tape and back", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", {name: /what happened/i}));
    expect(screen.getByTestId("trade-tape").closest("[role=tabpanel]")).not.toHaveAttribute(
      "hidden",
    );
    expect(screen.getByTestId("positions-table").closest("[role=tabpanel]")).toHaveAttribute(
      "hidden",
    );
  });

  it("clicking an agent narrows the tape to that agent and moves there to show it", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", {name: /0xAAaA…AaAa/i}));

    expect(screen.getByRole("tab", {name: /what happened/i})).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const tape = screen.getByTestId("trade-tape");
    // Two of Alice's three-trade tape, header row included.
    expect(within(tape).getAllByRole("row")).toHaveLength(3);
  });

  it("says it is filtering rather than quietly showing fewer trades", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", {name: /0xAAaA…AaAa/i}));
    // A tape showing 2 of 3 looks exactly like a market with 2 trades. It has to
    // say which it is, or the panel misleads about what happened in the market.
    expect(screen.getByText(/2 of 3 trades/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: /show all/i}));
    expect(within(screen.getByTestId("trade-tape")).getAllByRole("row")).toHaveLength(4);
  });

  it("offers no agent link when the tape it would filter is not there", () => {
    renderPanel({trades: {status: "unavailable", capability: "TRADE_TAPE", mode: "chain"} as Query<Trade[]>});
    // The address stays readable; only the control disappears. A button that
    // cannot do anything is worse than plain text.
    expect(screen.getByText(/0xAAaA…AaAa/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /0xAAaA…AaAa/i})).not.toBeInTheDocument();
  });
});
