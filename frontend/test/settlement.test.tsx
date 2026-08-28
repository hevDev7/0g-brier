import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {MarketDetail, SettlementReceipt} from "@/lib/data/types";

/**
 * The first fixture, resolved YES.
 *
 * The winner is set HERE, on the market, because that is where `FinalOutcome`
 * reads it from — `Market.winningOutcome` on chain, not the receipt. Its `q` is
 * kept so the 1/p payout assertion below still has the same known answer.
 */
const m: MarketDetail = {...FIXTURE_MARKETS[0]!, winningOutcome: 1, resolvedAt: 1_790_000_000};
const receipt: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning: "Two of three resolvers concluded YES.",
  criteria: "YES if the closing price is above $4,000.",
  sources: ["https://example.org/data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
    viaCommittee: true,
};

describe("FinalOutcome", () => {
  it("names the winner and its payout rate", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
    expect(screen.getByTestId("payout")).toHaveTextContent("×");
  });

  it("the payout rate uses 1/p, not 1/P", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    // The fixture q gives P(YES)=59.0% -> p=0.7681 -> 1/p = 1.30x. 1/P would be 1.69x.
    expect(screen.getByTestId("payout")).toHaveTextContent("1.30×");
    expect(screen.getByTestId("payout")).not.toHaveTextContent("1.69×");
  });

  // The same pattern as ResolutionEvidence's simulated-badge below — checked here
  // too, because the verdict (winner + payout rate) must likewise never be taken
  // for real when it comes from a stub receipt.
  it("flags a simulated result conspicuously in the final-outcome panel too", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("final-outcome-simulated")).toHaveTextContent(/simulated/i);
  });

  it("does not flag simulation in the final-outcome panel for a real receipt", () => {
    render(<FinalOutcome receipt={{...receipt, simulated: false}} market={m} />);
    expect(screen.queryByTestId("final-outcome-simulated")).not.toBeInTheDocument();
  });

  /**
   * The contract holds the money, so the contract decides. A receipt is the
   * resolver's ACCOUNT of the decision; if the two ever disagreed, showing the
   * receipt's side would put the wrong winner above a payout figure computed for
   * the right one.
   */
  it("names the chain's winner even when the receipt claims the other side", () => {
    render(<FinalOutcome receipt={{...receipt, outcome: 0}} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
  });

  /**
   * A mode with no receipt is the normal case on a live chain today. The winner
   * is still known, and hiding it would be hiding what we have behind what we
   * lack.
   */
  it("names the winner with no receipt at all", () => {
    render(<FinalOutcome receipt={null} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
    expect(screen.queryByTestId("final-outcome-simulated")).not.toBeInTheDocument();
  });

  it("says a market is unresolved rather than believing a receipt that says otherwise", () => {
    render(<FinalOutcome receipt={receipt} market={FIXTURE_MARKETS[0]!} />);
    expect(screen.queryByTestId("winner")).not.toBeInTheDocument();
    expect(screen.getByTestId("final-outcome")).toHaveTextContent(/Not resolved yet/i);
  });
});

describe("ResolutionEvidence", () => {
  it("shows every resolver model and its vote", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    for (const v of receipt.votes) expect(screen.getByText(v.model)).toBeInTheDocument();
  });

  it("shows the reasoning verbatim, untrimmed", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("reasoning")).toHaveTextContent(receipt.reasoning);
  });

  it("shows the resolution criteria and the data sources", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("criteria")).toHaveTextContent(receipt.criteria!);
    expect(screen.getByText(receipt.sources[0]!)).toBeInTheDocument();
  });

  it("flags a simulated result conspicuously", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("simulated-badge")).toHaveTextContent(/simulated/i);
  });

  it("does not flag simulation for a real receipt", () => {
    render(<ResolutionEvidence receipt={{...receipt, simulated: false}} />);
    expect(screen.queryByTestId("simulated-badge")).not.toBeInTheDocument();
  });

  it("flags a resolver whose vote differs from the final outcome", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("vote-qwen3-32b")).toHaveTextContent(/NO/);
  });
});

describe("ResolutionEvidence — an unresolved market", () => {
  // The equivalent of PENDING_RECEIPT in lib/data/mock.ts (not exported from
  // there, so rewritten here) — the shape getReceipt() returns for any market
  // whose status is NOT Settled: two of the three fixture markets take this shape,
  // so it is no rare edge case.
  const pending: SettlementReceipt = {
    outcome: null,
    votes: [],
    judgeModel: null,
    reasoning: "",
    criteria: "",
    sources: [],
    provider: "0x0000000000000000000000000000000000000000",
    chatId: "",
    simulated: true,
    viaCommittee: true,
  };

  it("shows a not-resolved-yet message rather than an unexplained empty panel", () => {
    render(<ResolutionEvidence receipt={pending} />);
    expect(screen.getAllByText(/not resolved/i).length).toBeGreaterThan(0);
  });

  // The heart of the fix: before this, the "Resolution criteria" heading rendered
  // an empty paragraph and the "in full, verbatim" <details> opened onto nothing —
  // a disclosure that promises complete content and then delivers none. That reads
  // as "a resolution happened and produced nothing" rather than "no resolution has
  // happened", exactly the lie rule #1 of that component file forbids.
  it("promises neither criteria nor full reasoning when both are actually empty", () => {
    render(<ResolutionEvidence receipt={pending} />);
    expect(screen.queryByTestId("criteria")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reasoning")).not.toBeInTheDocument();
  });
});

/**
 * "Yet" promises something still to come. A resolved settlement that consulted no
 * models will never have votes, and a resolved one that cited nothing will never
 * have sources — saying otherwise is the same defect as rendering a zero for
 * something unknown, one step further along.
 */
describe("ResolutionEvidence — resolved, but with nothing to show", () => {
  const bare: SettlementReceipt = {
    ...receipt,
    votes: [],
    judgeModel: null,
    criteria: null,
    sources: [],
    reasoning: "No resolver committee ran, and no model was consulted.",
  };

  it("does not promise votes that will never arrive", () => {
    render(<ResolutionEvidence receipt={bare} />);
    expect(screen.getByText(/No models were consulted for this settlement/i)).toBeInTheDocument();
    expect(screen.queryByText(/No resolver votes yet/i)).not.toBeInTheDocument();
  });

  it("still says 'yet' while the market is genuinely unresolved", () => {
    render(<ResolutionEvidence receipt={{...bare, outcome: null}} />);
    expect(screen.getByText(/No resolver votes yet/i)).toBeInTheDocument();
  });

  it("points a reader at the promised criteria rather than inventing the resolver's", () => {
    render(<ResolutionEvidence receipt={bare} />);
    expect(screen.getByText(/recorded no criteria of its own/i)).toBeInTheDocument();
    expect(screen.queryByTestId("criteria")).not.toBeInTheDocument();
  });

  it("says the resolver cited nothing rather than that sources are pending", () => {
    render(<ResolutionEvidence receipt={bare} />);
    expect(screen.getByText(/resolver cited no sources/i)).toBeInTheDocument();
  });
});

/**
 * `ResolutionModule` keeps `viaCommittee` for exactly one reason: a settlement
 * that one allowlisted key made and a settlement that staked resolvers reached
 * by voting blind are not the same claim, and the second is the one worth
 * trusting. The panel headed every settlement "COMMITTEE VERDICT" regardless —
 * including the live one this deployment produced from a single operator key —
 * which prints the misrepresentation the flag exists to prevent. The frontend
 * read the flag nowhere at all; the docs page promised a committee, so the
 * product was making a promise it had no way of keeping.
 */
describe("who decided", () => {
  it("does not call one key a committee", () => {
    render(<FinalOutcome market={m} receipt={{...receipt, viaCommittee: false}} />);
    expect(screen.queryByText(/committee verdict/i)).toBeNull();
    expect(screen.getByText(/settled by one resolver/i)).toBeInTheDocument();
    // And says what is missing, since "one resolver" only means something to a
    // reader who knows what the committee would have added.
    const note = screen.getByTestId("single-resolver-note");
    expect(note).toHaveTextContent(/no stake was at risk/i);
    expect(note).toHaveTextContent(/nothing was open to dispute/i);
  });

  it("credits a genuine committee as one, with no caveat", () => {
    render(<FinalOutcome market={m} receipt={{...receipt, viaCommittee: true}} />);
    expect(screen.getByText(/committee verdict/i)).toBeInTheDocument();
    expect(screen.queryByTestId("single-resolver-note")).toBeNull();
  });

  /** The winner is still the winner either way — the caveat is about the process. */
  it("does not let the caveat weaken the outcome itself", () => {
    render(<FinalOutcome market={m} receipt={{...receipt, viaCommittee: false}} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
  });
});

/**
 * `null` is not `false`. A receipt that has not arrived says nothing about how
 * the market was decided, and the heading claimed a single resolver on the first
 * paint of every settled market — a beat before the receipt that would have
 * justified it.
 */
it("does not guess how a market was decided before the receipt arrives", () => {
  render(<FinalOutcome market={m} receipt={null} />);
  expect(screen.queryByText(/committee verdict/i)).toBeNull();
  expect(screen.queryByText(/settled by one resolver/i)).toBeNull();
  expect(screen.queryByTestId("single-resolver-note")).toBeNull();
  // The outcome itself is chain state and does not wait for a receipt.
  expect(screen.getByTestId("winner")).toHaveTextContent("YES");
});
