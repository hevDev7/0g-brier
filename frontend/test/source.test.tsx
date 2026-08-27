import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {ObservationLegend} from "@/components/source/ObservationLegend";
import {SourceNotes} from "@/components/source/SourceNotes";
import {AppProviders} from "@/hooks/provider";
import {CAPABILITY_LABELS} from "@/components/primitives/Unavailable";
import {MockSource} from "@/lib/data/mock";

function renderNotes(source = new MockSource()) {
  return render(
    <AppProviders source={source}>
      <SourceNotes />
    </AppProviders>,
  );
}

describe("SourceNotes", () => {
  it("stays closed until asked", () => {
    renderNotes();
    expect(screen.queryByTestId("source-notes")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-notes-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("names the current mode and warns that mock figures are fixtures", async () => {
    const user = userEvent.setup();
    renderNotes();
    await user.click(screen.getByTestId("source-notes-toggle"));
    const panel = screen.getByTestId("source-notes");
    expect(panel).toHaveTextContent("mock");
    expect(panel).toHaveTextContent(/nothing here is a live market/i);
  });

  /**
   * Read from `source.capabilities`, not from a table written beside it: a
   * hard-coded list is how a disclosure ends up describing a source that has
   * since changed. Omitting two capabilities must show up here without anyone
   * editing this component.
   */
  it("reports what the live source can answer, capability by capability", async () => {
    const user = userEvent.setup();
    renderNotes(new MockSource({omit: ["TRADE_TAPE", "COST_BASIS"]}));
    await user.click(screen.getByTestId("source-notes-toggle"));
    const items = within(screen.getByTestId("source-notes")).getAllByRole("listitem");
    // Counted from CAPABILITY_LABELS rather than written as a literal. The literal
    // was 7 and became wrong the moment MARKET_SPEC_BLOB joined the union — which
    // is the failure mode this test exists to catch in the COMPONENT, so it should
    // not have been reproduced in the test itself.
    expect(items).toHaveLength(Object.keys(CAPABILITY_LABELS).length);

    const missing = items.filter((li) => li.textContent?.includes("not available"));
    expect(missing.map((li) => li.textContent?.replace("not available", "").trim())).toEqual([
      "Trade history",
      "Entry price",
    ]);
  });

  it("closes again", async () => {
    const user = userEvent.setup();
    renderNotes();
    const toggle = screen.getByTestId("source-notes-toggle");
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByTestId("source-notes")).not.toBeInTheDocument();
  });
});

describe("ObservationLegend", () => {
  it("names all four states a figure can be in", () => {
    render(<ObservationLegend />);
    for (const state of ["LOADING", "EMPTY", "UNAVAILABLE", "ERROR"]) {
      expect(screen.getByText(state)).toBeInTheDocument();
    }
  });

  it("draws the distinction the product rests on: unknown is not zero", () => {
    render(<ObservationLegend />);
    expect(screen.getByTestId("observation-legend")).toHaveTextContent(
      /never a zero, which would be a claim/i,
    );
  });

  /** A legend is not a control: a retry button here would describe nothing. */
  it("offers no controls", () => {
    render(<ObservationLegend />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
