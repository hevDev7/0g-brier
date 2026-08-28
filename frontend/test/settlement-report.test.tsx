import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {SettlementReport} from "@/components/settlement/SettlementReport";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {DataMode, MarketDetail, Query, SettlementReceipt} from "@/lib/data/types";

/** The settled fixture — euro-area inflation, resolved YES. */
const settled = FIXTURE_MARKETS.find((m) => m.status === "Settled")!;

const RECEIPT: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning: "Two of three resolvers concluded YES.",
  criteria: "YES if euro-area flash HICP is below 2.0%.",
  sources: ["https://ec.europa.eu/eurostat/web/hicp/data/database"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
    viaCommittee: true,
};

const ready: Query<SettlementReceipt> = {status: "ready", data: RECEIPT};
const noReceipt: Query<SettlementReceipt> = {
  status: "unavailable",
  capability: "SETTLEMENT_RECEIPT",
  mode: "indexer",
};

async function open(
  market: MarketDetail,
  receipt: Query<SettlementReceipt> = ready,
  mode: DataMode = "mock",
) {
  render(<SettlementReport market={market} receipt={receipt} mode={mode} />);
  await userEvent.click(screen.getByTestId("open-settlement-report"));
}

describe("the settlement report", () => {
  it("is behind a click, not on the page by default", async () => {
    render(<SettlementReport market={settled} receipt={ready} mode="mock" />);
    const dialog = screen.getByTestId("settlement-report") as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    await userEvent.click(screen.getByTestId("open-settlement-report"));
    expect(dialog.open).toBe(true);
  });

  it("closes again", async () => {
    await open(settled);
    const dialog = screen.getByTestId("settlement-report") as HTMLDialogElement;
    await userEvent.click(screen.getByLabelText("Close settlement report"));
    expect(dialog.open).toBe(false);
  });

  it("shows what was promised: criteria, the system prompt, the sources and the root", async () => {
    await open(settled);
    expect(screen.getByTestId("report-criteria")).toHaveTextContent(/Eurostat HICP release/i);
    expect(screen.getByTestId("report-system-prompt")).toHaveTextContent(/strictly below 2\.0%/i);
    expect(screen.getByTestId("report-sources")).toHaveTextContent(/ec\.europa\.eu/);
    expect(screen.getByTestId("report-spec-root")).toHaveTextContent(settled.specRoot);
  });

  it("shows what the resolver did, with every model and the judge named", async () => {
    await open(settled);
    const evidence = screen.getByTestId("resolution-evidence");
    expect(evidence).toHaveTextContent("claude-opus-5");
    expect(evidence).toHaveTextContent("gpt-5.5");
    expect(evidence).toHaveTextContent("qwen3-32b");
    expect(evidence).toHaveTextContent(/composed by the judge: claude-opus-5/i);
    expect(evidence).toHaveTextContent(/Two of three resolvers concluded YES/);
  });

  /**
   * The point of separating the two halves. The resolver states its own criteria
   * and the market promised some; both are shown, because a resolver that judged
   * against different criteria is precisely what a reader is checking for.
   */
  it("keeps the promised criteria and the resolver's account of them apart", async () => {
    await open(settled);
    expect(screen.getByTestId("report-criteria")).not.toHaveTextContent(RECEIPT.criteria!);
    expect(screen.getByTestId("resolution-evidence")).toHaveTextContent(RECEIPT.criteria!);
  });

  /**
   * The winner is read from `Market.winningOutcome`, which is what actually pays
   * out. A mode with no receipt is the normal case on a live chain today, and a
   * report that could not name the winner there would be missing the one fact
   * everything else exists to explain.
   */
  it("names the winner from the chain even when no receipt can be read", async () => {
    await open(settled, noReceipt, "indexer");
    expect(screen.getByTestId("report-winner")).toHaveTextContent("YES");
    expect(screen.getByTestId("settlement-report")).toHaveTextContent(
      /Resolution evidence not available/i,
    );
  });

  /**
   * If the two ever disagreed, the contract that holds the money is right. This
   * feeds a receipt claiming NO to a market the chain says YES, which cannot
   * happen in the fixtures and is exactly why it is asserted.
   */
  it("prefers the chain's winner over a receipt that contradicts it", async () => {
    const contradicting: Query<SettlementReceipt> = {
      status: "ready",
      data: {...RECEIPT, outcome: 0},
    };
    await open(settled, contradicting);
    expect(screen.getByTestId("report-winner")).toHaveTextContent("YES");
  });

  it("says a market is unresolved rather than calling it NO", async () => {
    const open_market = FIXTURE_MARKETS.find((m) => m.status === "Open")!;
    await open(open_market, noReceipt, "indexer");
    expect(screen.getByTestId("report-outcome")).toHaveTextContent(/Not resolved/i);
    expect(screen.queryByTestId("report-winner")).not.toBeInTheDocument();
  });

  /**
   * "The creator left it out" and "we cannot read the document" are different
   * facts. Collapsing them would tell a reader the market has no prompt when the
   * truth is that this mode cannot see one — the same class of error as
   * rendering a zero for something unknown.
   */
  it("says the document carries no prompt when the document WAS read", async () => {
    await open({...settled, settlementPrompt: null, sources: []});
    expect(screen.getByTestId("report-system-prompt")).toHaveTextContent(
      /MarketSpec carries no settlement prompt/i,
    );
    expect(screen.getByTestId("report-sources")).toHaveTextContent(/MarketSpec names no sources/i);
  });

  it("says the document could not be read when it could not", async () => {
    await open({...settled, rules: null, sources: null}, ready, "indexer");
    expect(screen.getByTestId("report-criteria")).toHaveTextContent(
      /Question and rules not available/i,
    );
    expect(screen.getByTestId("report-sources")).toHaveTextContent(
      /Question and rules not available/i,
    );
  });
});
