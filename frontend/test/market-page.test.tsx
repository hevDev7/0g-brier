import {render, screen, waitFor, within} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {MarketView} from "@/app/market/[address]/MarketView";
import {AppProviders} from "@/hooks/provider";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const OPEN = FIXTURE_MARKETS[0]!.address;
const SETTLED = FIXTURE_MARKETS.find((m) => m.status === "Settled")!.address;

function renderMarket(source = new MockSource(), address = OPEN) {
  return render(
    <AppProviders source={source}>
      <MarketView address={address} />
    </AppProviders>,
  );
}

describe("MarketView", () => {
  it("renders the question, the probability, and the payout", async () => {
    renderMarket();
    // The first fixture mentions "ETH/USD" in both the question (h1) and the
    // resolution-rules text — a plain getByText would be ambiguous. A role-based
    // query targets the question heading specifically, which is what this test means.
    await waitFor(() =>
      expect(screen.getByRole("heading", {name: /ETH\/USD/})).toBeInTheDocument(),
    );
    // Since fixtureTrades() was fixed to converge on the market's q, the NEWEST
    // trade in the tape also shows P(YES) 59.0% — deliberately, not by coincidence
    // (see mock-source.test.ts). A plain getByText("59.0%") is ambiguous because of
    // that; scope it to the probability panel specifically.
    await waitFor(() =>
      expect(within(screen.getByTestId("probability-panel")).getByText("59.0%")).toBeInTheDocument(),
    );
    expect(screen.getByText("1.30×")).toBeInTheDocument();
  });

  /**
   * A product decision (spec §1 F3), not a layout preference: execution lives in
   * `@0g-delphi/agent-kit`, so the human page must have no execution control at
   * all — not hidden, not disabled, ABSENT. A disabled button still promises
   * something that will never exist here.
   */
  it("has no execution control on the human page", async () => {
    renderMarket();
    expect(await screen.findByTestId("probability-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("order-ticket")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: /buy|sell|approve|confirm/i})).not.toBeInTheDocument();
  });

  it("renders the inspection panels", async () => {
    renderMarket();
    for (const id of ["probability-panel", "payout-panel", "probability-chart",
                      "market-stats", "positions-table", "trade-tape"]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
  });

  /**
   * The easiest test to forget and the most important one: in a limited mode, a
   * panel whose data cannot be known shows an explanation, NOT an empty table and
   * not a zero.
   */
  it("explains an absent capability rather than rendering an empty table", async () => {
    renderMarket(new MockSource({omit: ["AGENT_POSITIONS"]}));
    expect(await screen.findByText(/agent positions.*not available/i)).toBeInTheDocument();
    expect(screen.queryByTestId("positions-table")).not.toBeInTheDocument();
  });

  it("shows Unavailable rather than zero when the tape is unavailable", async () => {
    renderMarket(new MockSource({omit: ["TRADE_TAPE"]}));
    await waitFor(() =>
      expect(screen.getAllByText(/trade history.*not available/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("trade-tape")).toBeNull();
  });

  it("shows Unavailable rather than an empty chart when price history is unavailable", async () => {
    renderMarket(new MockSource({omit: ["PRICE_HISTORY"]}));
    await waitFor(() =>
      expect(screen.getByText(/price history.*not available/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("probability-chart")).toBeNull();
  });

  /** A resolved market: the committee's verdict AND the evidence one can inspect. */
  it("a Settled market shows the final outcome and its resolution evidence", async () => {
    renderMarket(new MockSource(), SETTLED);
    expect(await screen.findByTestId("final-outcome")).toBeInTheDocument();
    expect(await screen.findByTestId("resolution-evidence")).toBeInTheDocument();
  });

  it("a still-open market shows no settlement panels", async () => {
    renderMarket();
    expect(await screen.findByTestId("market-stats")).toBeInTheDocument();
    expect(screen.queryByTestId("final-outcome")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resolution-evidence")).not.toBeInTheDocument();
  });
});

/**
 * A live chain has no MarketSpec blob, so `rules` is null — and the settlement
 * panel rendered a heading over an empty paragraph, which reads as "this market
 * has no rules" rather than "this mode cannot read them". No fixture could catch
 * it: every fixture market has rules. Found by pointing the UI at Galileo.
 */
describe("a market whose spec blob cannot be read", () => {
  it("explains the missing rules instead of showing an empty panel", async () => {
    const source = new MockSource();
    const original = source.getMarket.bind(source);
    source.getMarket = async (address) => ({...(await original(address)), rules: null, question: null});

    renderMarket(source);

    const panel = await screen.findByTestId("settlement-rules");
    expect(panel).toHaveTextContent(/question and rules not available/i);
    // The assertion that matters: the panel is not merely empty.
    expect(panel.textContent?.replace(/\s+/g, " ").trim().length).toBeGreaterThan(30);
  });
});
