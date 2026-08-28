import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {WAD} from "@brier/protocol";
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
