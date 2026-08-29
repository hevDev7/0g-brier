import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {WAD} from "@hevdev7/protocol";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("ProbabilityPanel", () => {
  it("shows both sides as p^2", () => {
    render(<ProbabilityPanel q={q} />);
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByText("41.0%")).toBeInTheDocument();
  });

  /** The marginal prices for this q are 76.8% and 64.0% — neither may appear as a percentage. */
  it("does not show the marginal price as a probability", () => {
    const {container} = render(<ProbabilityPanel q={q} />);
    expect(container.textContent).not.toContain("76.8%");
    expect(container.textContent).not.toContain("64.0%");
  });
});

describe("PayoutPanel", () => {
  it("shows the 1/p payout, not 1/P", () => {
    render(<PayoutPanel q={q} />);
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.getByText("1.56×")).toBeInTheDocument();
  });

  it("does not show the mistaken 1/P numbers", () => {
    const {container} = render(<PayoutPanel q={q} />);
    expect(container.textContent).not.toContain("1.69×");
    expect(container.textContent).not.toContain("2.44×");
  });

  /** A mandatory disclosure: the payout floats until the market closes. */
  it("discloses dilution in terms a reader can act on", () => {
    render(<PayoutPanel q={q} />);
    // Addressed by test id, not by DOM position: the guarantee is that this
    // disclosure exists and says these four things, not that it happens to be
    // the first paragraph in the panel.
    const disclosure = screen.getByTestId("dilution-disclosure");
    expect(disclosure).toHaveTextContent(/floats until the market closes/i);
    // Self-dilution named explicitly: the reader's own agent is one of the buyers.
    expect(disclosure).toHaveTextContent(/including purchases your own agent makes/i);
    // The exit window and the risk window are the same length, and the exit is
    // described as costly — see the FR34 ruling.
    expect(disclosure).toHaveTextContent(/only be sold while the market is Open/i);
    expect(disclosure).toHaveTextContent(/below the one on screen, minus fee/i);
  });
});

/**
 * Every panel on this page was written for a market whose answer is still open,
 * and each kept its wording after the answer arrived. On a live settled market
 * that produced: "CURRENT ESTIMATE — YES 55.0%" beside a decided outcome, and
 * "Payout if NO wins — 1.49× per share" for a side that cannot win, in the same
 * weight as the side that did. Both are prices quoted on an impossibility.
 */
describe("once the market has an answer", () => {
  it("stops calling a settled market's last estimate the current one", () => {
    render(<ProbabilityPanel q={q} winningOutcome={1} />);
    expect(screen.queryByText(/current estimate/i)).toBeNull();
    expect(screen.getByText(/final estimate before settlement/i)).toBeInTheDocument();
    // The figures stay. They are the record the market is scored on, and 59.0%
    // is what it actually believed — deleting it would hide the forecast.
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByTestId("estimate-is-historic")).toHaveTextContent("YES won");
  });

  it("leaves an unresolved market saying exactly what it said before", () => {
    render(<ProbabilityPanel q={q} />);
    expect(screen.getByText(/current estimate/i)).toBeInTheDocument();
    expect(screen.queryByTestId("estimate-is-historic")).toBeNull();
  });

  it("prices the losing side at nothing instead of at what it would have paid", () => {
    render(<PayoutPanel q={q} winningOutcome={1} />);
    // 1.30× is what YES shares now redeem for; 1.56× is what NO shares would
    // have paid in a world that did not happen, and must not be on the page.
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.queryByText("1.56×")).toBeNull();
    expect(screen.getByText("0.00×")).toBeInTheDocument();
    expect(screen.queryByText(/payout if/i)).toBeNull();
  });

  it("stops offering an exit that closing already took away", () => {
    render(<PayoutPanel q={q} winningOutcome={0} />);
    const disclosure = screen.getByTestId("dilution-disclosure");
    // The disclosure survives — dilution is why the payout is what it is — but
    // it can no longer describe selling as something a reader might still do.
    expect(disclosure).toHaveTextContent(/floated until the market closed/i);
    expect(disclosure).toHaveTextContent(/nothing left to sell, only to redeem/i);
    expect(disclosure).not.toHaveTextContent(/can only be sold while the market is Open/i);
  });
});
