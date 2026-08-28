import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import DocsPage from "@/app/docs/page";

/**
 * The documentation makes numeric claims, and a wrong one is worse than no page
 * at all: a reader who checks a figure and finds it consistent stops checking.
 * So the arithmetic behind the worked examples is recomputed here from the
 * mechanism rather than compared against a transcription of what the page says.
 */
describe("the documentation page", () => {
  it("renders every section its contents list promises", () => {
    const {container} = render(<DocsPage />);
    const links = [...container.querySelectorAll('nav[aria-label="Contents"] a')];
    expect(links.length).toBeGreaterThan(5);

    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      // A contents entry pointing at nothing is silent in a browser: the click
      // does nothing at all and the reader assumes the section is missing.
      expect(container.querySelector(`#${id}`), `no section with id "${id}"`).not.toBeNull();
    }
  });

  it("states plainly that the site cannot trade", () => {
    render(<DocsPage />);
    // The structural promise of the whole product. If this text ever softens
    // into "trading is done through the SDK" it stops warning anybody.
    expect(screen.getByText(/cannot trade from this website/i)).toBeInTheDocument();
  });

  /**
   * The claim: payout is 1/price, and computing it from the probability instead
   * overstates it by about 30% at ordinary skew. Both numbers are recomputed
   * from P here, so a typo in the page fails rather than reading plausibly.
   */
  it("gets the worked payout example right", () => {
    const {container} = render(<DocsPage />);
    const P = 0.59;
    const price = Math.sqrt(P);
    expect(price.toFixed(4)).toBe("0.7681");
    expect((1 / price).toFixed(4)).toBe("1.3019");
    expect((1 / P).toFixed(4)).toBe("1.6949");

    const text = container.textContent ?? "";
    expect(text).toContain("0.7681");
    expect(text).toContain("1.3019×");
    expect(text).toContain("1.6949×");
    // And the size of the error, which is the part a reader remembers.
    expect(Math.round(((1 / P) / (1 / price) - 1) * 100)).toBe(30);
  });

  it("gets the second worked example right — 10% pays 3.16x, not 10x", () => {
    const {container} = render(<DocsPage />);
    expect((1 / Math.sqrt(0.1)).toFixed(2)).toBe("3.16");
    const text = container.textContent ?? "";
    expect(text).toContain("3.16×");
    expect(text).toContain("10×");
  });

  it("names all four market states and pairs each with what it forbids", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    for (const state of ["Open", "Closed", "Settled", "Failed or Voided"]) {
      expect(text).toContain(state);
    }
    // Four rows, each with a Can and a Cannot. A state described only by what it
    // allows is the one a reader gets wrong.
    expect(text.match(/Cannot:/g)?.length).toBe(4);
    expect(text.match(/Can:/g)?.length).toBe(4);
  });

  it("keeps the two corrections a newcomer arrives with", () => {
    const {container} = render(<DocsPage />);
    const blocks = [...container.querySelectorAll("div")].filter((d) =>
      d.textContent?.includes("You might expect"),
    );
    // Price-is-probability, and payout-is-fixed. Both are assumptions carried in
    // from an ordinary book, and both cost money here.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the live measurement of a payout shrinking under its own order", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("1.4142×");
    expect(text).toContain("1.3490×");
    // √2 is the payout on a market at even odds, which is where that order began.
    expect(Math.SQRT2.toFixed(4)).toBe("1.4142");
  });
});
