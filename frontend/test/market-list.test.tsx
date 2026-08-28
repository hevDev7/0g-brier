import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {MarketList} from "@/components/market/MarketList";
import {AppProviders} from "@/hooks/provider";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";
import type {Capability} from "@/lib/data/types";

// `vi.mock` is hoisted above every `let`, so the mutable bag it reads from has
// to be created with `vi.hoisted` rather than declared below.
const routing = vi.hoisted(() => ({params: new URLSearchParams()}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace: vi.fn(), push: vi.fn()}),
  usePathname: () => "/",
  useSearchParams: () => routing.params,
}));

vi.mock("next/link", () => ({
  default: ({href, children, ...rest}: {href: string; children: React.ReactNode}) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

function renderList(source = new MockSource(), query = "") {
  routing.params = new URLSearchParams(query);
  return render(
    <AppProviders source={source}>
      <MarketList />
    </AppProviders>,
  );
}

/**
 * The registry is split into phases now, so "every market" is no longer one
 * view. These are the fixture counts per phase — four markets still trading,
 * one closed and waiting on a resolver, one settled.
 *
 * Derived from the fixtures rather than typed, so adding a fixture cannot leave
 * a test asserting a stale total while still passing for the wrong reason.
 */
const LIVE = FIXTURE_MARKETS.filter((m) => m.status === "Open").length;

/** The row header holds the question, so it identifies a row unambiguously. */
async function questionOrder(): Promise<string[]> {
  const table = await screen.findByRole("table");
  return within(table)
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent ?? "");
}

beforeEach(() => {
  routing.params = new URLSearchParams();
});

/** The table row whose heading contains `needle`. */
function rowFor(table: HTMLElement, needle: string): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(needle));
  if (!row) throw new Error(`no row for ${needle}`);
  return row;
}

describe("MarketList", () => {
  it("renders one row per market in the phase, with P(YES) as p squared", async () => {
    renderList();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(LIVE);
    // q = [1000, 1200] -> P(YES) = 59.0%. The marginal price is 0.7682.
    expect(within(table).getByText("59.0%")).toBeInTheDocument();
    expect(within(table).getByText("50.0%")).toBeInTheDocument();
    // 10.0% belongs to the settled market, which is no longer in this view.
    expect(within(table).queryByText("10.0%")).not.toBeInTheDocument();
  });

  /** The twin of the probability trap: a marginal price must never carry a % sign. */
  it("never shows a marginal price as a percentage", async () => {
    const {container} = renderList();
    await screen.findByRole("table");
    for (const wrong of ["76.8%", "64.0%", "70.7%", "31.6%", "94.9%"]) {
      expect(container.textContent).not.toContain(wrong);
    }
  });

  it("shows depth for every market, since it comes from MARKET_STATE", async () => {
    renderList();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("1,562.05")).toBeInTheDocument();
    expect(within(table).getByText("1,000.00")).toBeInTheDocument();
    expect(within(table).getByText("1,664.33")).toBeInTheDocument();
  });

  /** Depth is chain state and does not stop being knowable once a market ends. */
  it("shows depth in the resolved phase too", async () => {
    renderList(new MockSource(), "phase=resolved");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("1,897.37")).toBeInTheDocument();
  });

  it("shows the 24h change measured over the history that actually exists", async () => {
    renderList();
    const table = await screen.findByRole("table");
    // Asserted per ROW rather than by counting occurrences across the table. A count
    // says how many markets happen to share a figure, which is a fact about the
    // fixture set; naming the row says which market shows what, which is the claim.
    await waitFor(() => expect(rowFor(table, "ETH/USD")).toHaveTextContent("+1.4 pt"));
  });

  it("measures the change on a resolved market too, over its own history", async () => {
    renderList(new MockSource(), "phase=resolved");
    const table = await screen.findByRole("table");
    await waitFor(() => expect(rowFor(table, "euro-area")).toHaveTextContent("+0.5 pt"));
  });

  /**
   * The required-and-easiest-to-forget test (frontend brief §9.2): in a degraded
   * mode the unknown columns explain themselves and the known ones stay
   * populated. A zero here would be a false claim, not a small number.
   */
  it("explains the columns a limited mode cannot know, and keeps the rest", async () => {
    const omit: Capability[] = ["TRADE_TAPE", "PRICE_HISTORY"];
    const {container} = renderList(new MockSource({omit}));
    const table = await screen.findByRole("table");

    await waitFor(() =>
      expect(within(table).getAllByText(/trade history not available/i).length).toBe(LIVE),
    );
    expect(within(table).getAllByText(/price history not available/i).length).toBe(LIVE);

    // Depth and probability come from MARKET_STATE, so they survive.
    expect(within(table).getByText("1,562.05")).toBeInTheDocument();
    expect(within(table).getByText("59.0%")).toBeInTheDocument();

    // No volume figure was invented to fill the gap — neither per row nor in the
    // aggregate tile, which reports a total only when EVERY tape has arrived.
    expect(container.textContent).not.toContain("781.02");
    expect(container.textContent).not.toContain("2,229.70");
    expect(within(table).queryByText("+1.4 pt")).not.toBeInTheDocument();
  });

  /** Where a question sits in the rendered list, by a fragment of its text. */
  const positionOf = (order: string[], needle: string) => order.findIndex((q) => q.includes(needle));

  it("sorts by volume, and an unknown volume sorts last rather than as zero", async () => {
    // Relative order, not absolute positions: the claim is that volume decides the
    // sequence, and it stays true however many other markets the fixtures hold.
    // Volumes here are 948.68, 781.02 and 500.00.
    renderList(new MockSource(), "sort=volume");
    await waitFor(async () => {
      const order = await questionOrder();
      expect(positionOf(order, "euro-area")).toBeLessThan(positionOf(order, "ETH/USD"));
      expect(positionOf(order, "ETH/USD")).toBeLessThan(positionOf(order, "mainnet v2"));
    });
  });

  it("sorts by newest using createdAt from the market summary", async () => {
    renderList(new MockSource(), "sort=newest");
    const order = await questionOrder();
    // Man City, ETH/USD and mainnet v2 were created 6h, 72h and 240h before the
    // fixture clock. All three are still trading, so one view holds them.
    expect(positionOf(order, "Manchester City")).toBeLessThan(positionOf(order, "ETH/USD"));
    expect(positionOf(order, "ETH/USD")).toBeLessThan(positionOf(order, "mainnet v2"));
  });

  it("filters by status from the URL, within the phase", async () => {
    renderList(new MockSource(), "phase=resolved&status=Settled");
    const order = await questionOrder();
    expect(order).toHaveLength(1);
    expect(order[0]).toContain("euro-area");
  });

  it("filters by free-text search", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    await user.type(screen.getByTestId("market-search"), "ETH");
    await waitFor(async () => expect(await questionOrder()).toHaveLength(1));
  });

  it("says so plainly when no market matches", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole("table");
    await user.type(screen.getByTestId("market-search"), "zzzzz");
    expect(await screen.findByText(/no market matches these filters/i)).toBeInTheDocument();
  });

  /** Spec §1 F3: the human pages carry no execution surface at all. */
  it("has no execution control", async () => {
    renderList();
    await screen.findByRole("table");
    expect(
      screen.queryByRole("button", {name: /buy|sell|approve|redeem|liquidate|connect/i}),
    ).not.toBeInTheDocument();
  });

  it("explains an unavailable market list instead of rendering an empty table", async () => {
    renderList(new MockSource({omit: ["LIST_MARKETS"]}));
    expect(await screen.findByText(/market list not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/**
 * The dashboard used to be one table of everything, so on a deployment where
 * every market had finished it showed a full page on which nothing could be
 * traded. The split is by what a reader can do, not by status.
 */
describe("the phase split", () => {
  it("shows only markets that are still trading by default", async () => {
    renderList();
    const table = await screen.findByRole("table");
    const order = await questionOrder();
    expect(order).toHaveLength(LIVE);
    // The settled market and the one waiting on a resolver are elsewhere.
    expect(order.join(" ")).not.toContain("euro-area");
    expect(order.join(" ")).not.toContain("Artemis");
    expect(within(table).queryByText("Settled")).not.toBeInTheDocument();
  });

  it("gives a finished market a place to be found", async () => {
    renderList(new MockSource(), "phase=resolved");
    const order = await questionOrder();
    expect(order).toHaveLength(1);
    expect(order[0]).toContain("euro-area");
  });

  it("does not file an unresolved market under history", async () => {
    // Closed and past its trading window: over for a trader, unfinished for the
    // protocol. Putting it in Resolved would hide that somebody still owes this
    // market an answer and that the collateral is locked until they give one.
    renderList(new MockSource(), "phase=pending");
    const order = await questionOrder();
    expect(order).toHaveLength(1);
    expect(order[0]).toContain("Artemis");
  });

  it("counts each phase on its own tab, so an empty one reads as a fact", async () => {
    renderList();
    await screen.findByRole("table");
    expect(screen.getByTestId("phase-live")).toHaveTextContent(String(LIVE));
    expect(screen.getByTestId("phase-pending")).toHaveTextContent("1");
    expect(screen.getByTestId("phase-resolved")).toHaveTextContent("1");
  });

  /**
   * Which side won is the one fact that separates two settled markets. A history
   * list without it is a list of names, and a reader would have to open every
   * row to learn the thing they came for.
   */
  it("names the winning side in the resolved view", async () => {
    renderList(new MockSource(), "phase=resolved");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Outcome")).toBeInTheDocument();
    expect(within(rowFor(table, "euro-area")).getByText("YES")).toBeInTheDocument();
  });

  it("does not offer a countdown on a market that has stopped trading", async () => {
    renderList(new MockSource(), "phase=pending");
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Trading ended")).toBeInTheDocument();
    expect(within(table).queryByText("Closes")).not.toBeInTheDocument();
  });

  /**
   * An empty PHASE and an empty RESULT are different absences. On Galileo the
   * Live tab is genuinely empty, and "no market matches these filters" would
   * send a reader hunting through filters they never set.
   */
  it("tells an empty phase apart from an empty search", async () => {
    const user = userEvent.setup();
    renderList(new MockSource({omit: []}), "phase=resolved");
    await screen.findByRole("table");
    await user.type(screen.getByTestId("market-search"), "zzzzz");
    expect(await screen.findByTestId("market-empty")).toHaveTextContent(
      /no market matches these filters/i,
    );
  });

  it("offers only the statuses the phase actually contains", async () => {
    // Choosing "Settled" while looking at Live emptied the table and blamed the
    // filters. A filter that can only produce nothing should not be offered —
    // and with one status left there is nothing to filter, so it is hidden.
    renderList();
    await screen.findByRole("table");
    expect(screen.queryByTestId("filter-status")).not.toBeInTheDocument();
  });

  it("keeps the whole registry in the tiles above the split", async () => {
    // The tiles describe the deployment, not the tab: hiding finished markets
    // from the table must not quietly shrink the count of what exists.
    renderList();
    await screen.findByRole("table");
    expect(screen.getByText("Indexed markets").previousSibling).toHaveTextContent(
      String(FIXTURE_MARKETS.length).padStart(2, "0"),
    );
  });
});
