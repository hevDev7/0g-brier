import type {ReactElement} from "react";
import {render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {DOCS, PAGES, neighbours, pageBySlug} from "@/components/docs/nav";
import {DocsSidebar} from "@/components/docs/DocsSidebar";
import {DocPage} from "@/components/docs/DocPage";

import Index from "@/app/docs/page";
import Problem from "@/app/docs/problem/page";
import Features from "@/app/docs/features/page";
import Reading from "@/app/docs/reading/page";
import Probability from "@/app/docs/probability/page";
import Payout from "@/app/docs/payout/page";
import Parimutuel from "@/app/docs/parimutuel/page";
import Creation from "@/app/docs/creation/page";
import Lifecycle from "@/app/docs/lifecycle/page";
import Settlement from "@/app/docs/settlement/page";
import Parameters from "@/app/docs/parameters/page";
import Agent from "@/app/docs/agent/page";
import Setup from "@/app/docs/setup/page";
import Funding from "@/app/docs/funding/page";
import Deciding from "@/app/docs/deciding/page";
import Risks from "@/app/docs/risks/page";
import Sdk from "@/app/docs/sdk/page";
import Errors from "@/app/docs/errors/page";
import Porting from "@/app/docs/porting/page";

const routing = {pathname: "/docs"};
vi.mock("next/navigation", () => ({
  usePathname: () => routing.pathname,
}));

/** Every route, keyed by the slug the nav tree uses. */
const ROUTES: Record<string, () => ReactElement> = {
  "": Index,
  problem: Problem,
  features: Features,
  reading: Reading,
  probability: Probability,
  payout: Payout,
  parimutuel: Parimutuel,
  creation: Creation,
  lifecycle: Lifecycle,
  settlement: Settlement,
  parameters: Parameters,
  agent: Agent,
  setup: Setup,
  funding: Funding,
  deciding: Deciding,
  risks: Risks,
  sdk: Sdk,
  errors: Errors,
  porting: Porting,
};

const textOf = (slug: string) => render(ROUTES[slug]!()).container.textContent ?? "";

beforeEach(() => {
  routing.pathname = "/docs";
});

describe("the documentation tree", () => {
  /**
   * The two ways a split-up documentation set rots: a page nobody can reach, and
   * a sidebar entry leading nowhere. Both are silent — the first because nothing
   * links to it, the second because the 404 only appears to whoever clicks.
   */
  it("has a route for every page it lists, and lists every route it has", () => {
    expect(Object.keys(ROUTES).sort()).toEqual(PAGES.map((p) => p.slug).sort());
  });

  it("gives every page the heading its own nav entry promises", () => {
    for (const {slug, title} of PAGES) {
      const {container, unmount} = render(ROUTES[slug]!());
      expect(container.querySelector("h1")?.textContent, `${slug} has the wrong heading`).toBe(title);
      unmount();
    }
  });

  it("chains the pages so a reader can go start to finish without the sidebar", () => {
    const first = PAGES[0]!;
    const last = PAGES[PAGES.length - 1]!;
    expect(neighbours(first.slug).prev, "the first page has a previous").toBeUndefined();
    expect(neighbours(last.slug).next, "the last page has a next").toBeUndefined();

    const walked: string[] = [];
    let at: string | undefined = first.slug;
    while (at !== undefined) {
      walked.push(at);
      at = neighbours(at).next?.slug;
    }
    expect(walked).toEqual(PAGES.map((p) => p.slug));
  });

  it("refuses to render a page that is not in the tree", () => {
    // A heading rendered for a page the nav does not know would be an orphan:
    // reachable by URL, invisible in the sidebar.
    expect(() => render(<DocPage slug="not-a-page">x</DocPage>)).toThrow(/not in the documentation tree/);
  });
});

describe("the sidebar", () => {
  it("shows every group and every page", () => {
    const {container} = render(<DocsSidebar />);
    for (const group of DOCS) {
      expect(container.textContent, `group "${group.title}" missing`).toContain(group.title);
      for (const page of group.pages) {
        expect(container.textContent, `page "${page.title}" missing`).toContain(page.title);
      }
    }
  });

  it("marks only the page being read", () => {
    routing.pathname = "/docs/funding";
    const {container} = render(<DocsSidebar />);
    const current = [...container.querySelectorAll('[aria-current="page"]')];
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe(pageBySlug("funding")!.title);
  });

  it("does not light the index up on every other page", () => {
    // `/docs` is a prefix of all thirteen other docs URLs, so a startsWith test
    // would mark the index current everywhere.
    routing.pathname = "/docs/sdk";
    const {container} = render(<DocsSidebar />);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("The SDK, call by call");
  });
});

describe("what each page has to say", () => {
  it("the index states plainly that the site cannot trade", () => {
    render(<Index />);
    // Exact, because the page's own blurb now says it too — matching loosely
    // finds two elements and fails for a reason that has nothing to do with the
    // claim being made.
    expect(screen.getByText("You cannot trade from this website")).toBeInTheDocument();
    // The reason, not just the rule: a promise with no mechanism behind it is a
    // slogan, and this one is enforced by a test in the repository.
    expect(screen.getByText(/no connect-wallet button/i)).toBeInTheDocument();
  });

  /**
   * The claim: payout is 1/price, and computing it from the probability instead
   * overstates it by about 30%. Recomputed from P here, so a typo in the page
   * fails rather than reading plausibly.
   */
  it("the problem page names what is wrong, not what is offered", () => {
    const text = textOf("problem");
    // Each of the three is a complaint about the state of things, and each is
    // answered by something in this repository rather than by an intention.
    expect(text).toMatch(/built for a person clicking/i);
    expect(text).toMatch(/request to be trusted/i);
    expect(text).toMatch(/address is not a reputation/i);
  });

  it("features only claims things the contracts and tests actually do", () => {
    const text = textOf("features");
    // The four load-bearing mechanisms. Each is checkable in the repo, which is
    // the standard this page sets for itself in its own first paragraph.
    expect(text).toContain("512-vector");           // protocol mirror pinned to Solidity
    expect(text).toContain("Commit–reveal");
    expect(text).toContain("5%");                   // no-show slash
    expect(text).toContain("20%");                  // overturn slash
    expect(text).toMatch(/never blocks an exit|pause never blocks/i);
    expect(text).toContain("unavailable");
  });

  it("probability gets both worked examples right", () => {
    const P = 0.59;
    const price = Math.sqrt(P);
    expect(price.toFixed(4)).toBe("0.7681");
    expect((1 / price).toFixed(4)).toBe("1.3019");
    expect((1 / P).toFixed(4)).toBe("1.6949");
    expect(Math.round((1 / P / (1 / price) - 1) * 100)).toBe(30);
    expect((1 / Math.sqrt(0.1)).toFixed(2)).toBe("3.16");

    const text = textOf("probability");
    for (const n of ["0.7681", "1.3019×", "1.6949×", "3.16×", "10×"]) {
      expect(text, `${n} missing`).toContain(n);
    }
  });

  it("probability and payout each name the wrong belief before the right one", () => {
    // The correction only teaches if the assumption is stated. A page of correct
    // facts leaves the reader's incorrect one intact beside them.
    for (const slug of ["probability", "payout"]) {
      expect(textOf(slug), `${slug} states no expectation to correct`).toContain("You might expect");
    }
  });

  /**
   * The dilution table is computed at render from `@hevdev7/protocol`, so this
   * checks the CLAIM the page makes about it rather than the digits: that profit
   * keeps rising while the return on each unit staked collapses. Those two moving
   * in opposite directions is the entire point, and a table that lost it would
   * still look like a table.
   */
  it("payout shows profit rising while the return per unit collapses", () => {
    const {container} = render(<Payout />);
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => Number(td.textContent!.replace(/[^0-9.-]/g, ""))),
    );
    // The prose names the count, so a row added or removed must break here
    // rather than leaving the sentence quietly wrong.
    expect(rows.length).toBe(6);
    expect(container.textContent).toContain("at six sizes");

    const profit = rows.map((r) => r[4]!);
    const perUnit = rows.map((r) => r[5]!);
    for (let i = 1; i < rows.length; i++) {
      expect(profit[i], `profit fell from row ${i - 1} to ${i}`).toBeGreaterThan(profit[i - 1]!);
      expect(perUnit[i], `per-unit rose from row ${i - 1} to ${i}`).toBeLessThan(perUnit[i - 1]!);
    }
    // The sentence the page draws from it, checked against the table itself.
    const [first, last] = [rows[0]!, rows[rows.length - 1]!];
    expect(Math.round(last[0]! / first[0]!)).toBe(80);          // 80x the stake
    expect(Math.round(last[4]! / first[4]!)).toBe(23);          // 23x the profit
    expect(container.textContent).toMatch(/before the 1% fee/i);
  });

  it("payout shows the live measurement of a prize shrinking under its own order", () => {
    const text = textOf("payout");
    expect(text).toContain("1.4142×");
    expect(text).toContain("1.3490×");
    // √2 is the payout at even odds, which is where that order began.
    expect(Math.SQRT2.toFixed(4)).toBe("1.4142");
  });

  it("lifecycle names all four states and pairs each with what it forbids", () => {
    const text = textOf("lifecycle");
    for (const state of ["Open", "Closed", "Settled", "Failed or Voided"]) {
      expect(text).toContain(state);
    }
    // A state described only by what it allows is the one a reader gets wrong.
    expect(text.match(/Cannot:/g)?.length).toBe(4);
    expect(text.match(/Can:/g)?.length).toBe(4);
  });

  /**
   * The page's central claim is arithmetic: whichever side wins, the total paid
   * equals the pool. Recomputed here from the q it quotes, so a mistyped figure
   * fails rather than reading plausibly — the same standard the worked payout
   * example is held to.
   */
  it("parimutuel shows a pool that balances whichever side wins", () => {
    // Six decimals, matching the page. At four the recomputation misses by
    // twenty-three micro-units — close enough to look right, which is why the
    // page quotes the precision that actually reproduces.
    const [qNo, qYes] = [707.106781, 781.013648];
    const C = Math.sqrt(qNo ** 2 + qYes ** 2);
    expect(C.toFixed(6)).toBe("1053.556984");
    // Payout per share is 1/p, and p = q/C, so q × (1/p) collapses to C on
    // BOTH sides. That identity is the reason nobody has to subsidise the book.
    expect((qNo * (C / qNo)).toFixed(6)).toBe(C.toFixed(6));
    expect((qYes * (C / qYes)).toFixed(6)).toBe(C.toFixed(6));
    expect((C / qNo).toFixed(4)).toBe("1.4900");
    expect((C / qYes).toFixed(4)).toBe("1.3490");

    const text = textOf("parimutuel");
    for (const n of ["1053.556984", "1.4900×", "1.3490×", "707.106781"]) expect(text).toContain(n);
    // And the trade it is explaining, which is the point of the page.
    expect(text).toMatch(/needs a subsidy/i);
    expect(text).toMatch(/price of that, not a defect/i);
  });

  it("creation names every gate the factory actually enforces", () => {
    const text = textOf("creation");
    // Four refusals, each with its own named error in MarketFactory.
    expect(text).toContain("CollateralNotAllowlisted");
    expect(text).toContain("UnknownCategory");
    expect(text).toContain("ApprovalAlreadyUsed");
    // And the one that has already gone wrong once, in a live market.
    expect(text).toMatch(/verbatim/i);
  });

  it("settlement walks the whole commit-reveal sequence", () => {
    const text = textOf("settlement");
    expect(text).toContain("openResolution");
    expect(text).toContain("keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))");
    // The guarantee the mechanism exists for: no settlement without reasoning.
    expect(text).toMatch(/zero receipt root is rejected/i);
    // And the honest disclosure that the shortcut is what testnet actually used.
    expect(text).toContain("viaCommittee == false");
    for (const rate of ["5%", "1%", "20%"]) expect(text).toContain(rate);
  });

  it("parameters states the dispute windows, and that they run opposite to the guess", () => {
    const text = textOf("parameters");
    expect(text).toContain("24 hours"); // FAST — weakest evidence, most time
    expect(text).toContain("6 hours"); // VERIFIED
    expect(text).toContain("2 hours"); // DETERMINISTIC
    expect(text).toMatch(/runs backwards from the obvious guess/i);
  });

  it("setup is honest about npm, and shows a first script needing no key", () => {
    const text = textOf("setup");
    expect(text).toMatch(/no npm package yet/i);
    expect(text).toContain("file:../brier/packages/agent-kit");
    expect(text).toContain("tsx");
    expect(text).toContain("new BrierClient({");
    expect(text).toContain("listMarkets()");
    expect(text).toMatch(/no privateKey/i);
    expect(text).toContain("canWrite");
    expect(text).toContain("privateKey: process.env.AGENT_KEY");
  });

  it("funding gives the concrete numbers and the two-part gas price", () => {
    const text = textOf("funding");
    for (const fact of [
      "https://faucet.0g.ai",
      "0.1 0G per wallet per day",
      "10,000 mUSDC",
      "claim()",
      "7 wei",
      "4 gwei",
      // Both failure messages, because they look unrelated and have one cause.
      "transaction gas price below minimum",
      "max priority fee per gas higher than max fee per gas",
    ]) {
      expect(text, `${fact} missing`).toContain(fact);
    }
  });

  it("sdk documents the calls that send a transaction, and the decimals trap", () => {
    const text = textOf("sdk");
    for (const write of ["buyShares", "sellShares", "redeem(market)", "liquidate(market)"]) {
      expect(text, `${write} missing`).toContain(write);
    }
    expect(text).toContain("sizeWithinImpact");
    expect(text).toMatch(/Two units, and mixing them is silent/i);
  });

  it("errors lists reverts an agent hits, and says an exit is never blocked", () => {
    const text = textOf("errors");
    for (const err of ["SlippageExceeded", "TradingEnded", "NotSettled", "NotLiquidatable", "ProtocolPaused"]) {
      expect(text, `${err} undocumented`).toContain(err);
    }
    expect(text).toMatch(/exit is never blocked/i);
  });

  it("agent tells the reader which directory, and only names scripts that ship", () => {
    const text = textOf("agent");
    // The complaint this answers: a command with no directory, for a script the
    // reader had no way to have.
    expect(text).toContain("brier/packages/agent-kit");
    expect(text).toContain("npx tsx examples/register.ts");
    // And says plainly where the shipped set stops.
    expect(text).toMatch(/is something you write/i);
    expect(text).not.toContain("npm run");
  });

  it("porting names the reversed outcome index", () => {
    const text = textOf("porting");
    // The single most dangerous difference: it compiles and runs either way.
    expect(text).toContain("0 = NO, 1 = YES");
    expect(text).toContain("0 = YES, 1 = NO");
  });
});
