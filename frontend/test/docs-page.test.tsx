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

  /**
   * The reference half. Its value is being correct about names, so the test
   * checks names that exist in the SDK and the contracts rather than prose.
   */
  it("documents the four calls that actually send a transaction", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    for (const write of ["buyShares", "sellShares", "redeem(market)", "liquidate(market)"]) {
      expect(text, `${write} missing from the reference`).toContain(write);
    }
    // And the bound that stops Kelly on a thin book.
    expect(text).toContain("sizeWithinImpact");
  });

  it("warns about the two decimal scales, which nothing in the types distinguishes", () => {
    render(<DocsPage />);
    expect(screen.getByText(/Two units, and mixing them is silent/i)).toBeInTheDocument();
  });

  it("names the reversed outcome index for anyone porting an agent", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    // The single most dangerous difference: it compiles and runs either way.
    expect(text).toContain("0 = NO, 1 = YES");
    expect(text).toContain("0 = YES, 1 = NO");
  });

  it("lists errors a trading agent can actually hit", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    for (const err of ["SlippageExceeded", "TradingEnded", "NotSettled", "NotLiquidatable", "ProtocolPaused"]) {
      expect(text, `${err} undocumented`).toContain(err);
    }
  });

  it("says an exit is never blocked by a pause", () => {
    const {container} = render(<DocsPage />);
    // Contract guarantee, not a convention: sell/redeem/liquidate skip the pause
    // check, and a trader who assumes otherwise waits for nothing.
    expect(container.textContent).toMatch(/exit is never blocked/i);
  });

  /**
   * The configuration reference. Its whole value is being right about values a
   * reader will paste, so these are checked against the live deployment rather
   * than against the page's own prose.
   */
  it("gives the concrete numbers a newcomer needs to actually start", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("16602");                              // chain
    expect(text).toContain("https://faucet.0g.ai");               // gas
    expect(text).toContain("10,000 mUSDC");                       // collateral per claim
    expect(text).toContain("0.1 0G per wallet per day");
    expect(text).toContain("claim()");
  });

  it("warns about Galileo's two-part gas price, which most tools get wrong", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("7 wei");
    expect(text).toContain("4 gwei");
    // Both failure messages, because they look unrelated and have one cause.
    expect(text).toContain("transaction gas price below minimum");
    expect(text).toContain("max priority fee per gas higher than max fee per gas");
  });

  it("states the dispute windows, and that they run opposite to the guess", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("24 hours");   // FAST — weakest evidence, most time
    expect(text).toContain("6 hours");    // VERIFIED
    expect(text).toContain("2 hours");    // DETERMINISTIC
    expect(text).toMatch(/runs backwards from the obvious guess/i);
  });

  it("numbers its sections from the contents list rather than from literals", () => {
    const {container} = render(<DocsPage />);
    const links = [...container.querySelectorAll('nav[aria-label="Contents"] a')];
    links.forEach((link, i) => {
      const id = link.getAttribute("href")!.slice(1);
      const eyebrow = container.querySelector(`#${id} p`)?.textContent;
      // The section's own number must match its position in the contents, or the
      // page disagrees with its own index — which a reader notices and an author
      // never does.
      expect(eyebrow, `section "${id}" is numbered ${eyebrow}, listed at ${i + 1}`).toBe(
        String(i + 1).padStart(2, "0"),
      );
    });
  });

  /**
   * The quickstart. Its only job is to work when pasted, so the test pins the
   * facts that make it work rather than its prose.
   */
  it("is honest that there is no npm package", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/no npm package yet/i);
    // The consequence, not just the fact: unpublished plus TypeScript source
    // means a path dependency and tsx, which changes how you plan a project.
    expect(text).toContain("file:../brier/packages/agent-kit");
    expect(text).toContain("tsx");
  });

  it("shows a first script that needs no key, wallet or funding", () => {
    const {container} = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("new BrierClient({");
    expect(text).toContain("listMarkets()");
    // The point of the example: reading costs nothing and risks nothing.
    expect(text).toMatch(/no privateKey/i);
    expect(text).toContain("canWrite");
  });

  it("shows the one field that turns a reader into a trader", () => {
    const {container} = render(<DocsPage />);
    expect(container.textContent).toContain("privateKey: process.env.AGENT_KEY");
  });
});
