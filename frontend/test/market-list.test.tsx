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
  it("renders one row per market, with P(YES) as p squared", async () => {
    renderList();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(FIXTURE_MARKETS.length);
    // q = [1000, 1200] -> P(YES) = 59.0%. The marginal price is 0.7682.
    expect(within(table).getByText("59.0%")).toBeInTheDocument();
    expect(within(table).getByText("50.0%")).toBeInTheDocument();
    expect(within(table).getByText("10.0%")).toBeInTheDocument();
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
    expect(within(table).getByText("1,897.37")).toBeInTheDocument();
  });

  it("shows the 24h change measured over the history that actually exists", async () => {
    renderList();
    const table = await screen.findByRole("table");
    // Asserted per ROW rather than by counting occurrences across the table. A count
    // says how many markets happen to share a figure, which is a fact about the
    // fixture set; naming the row says which market shows what, which is the claim.
    await waitFor(() => expect(rowFor(table, "ETH/USD")).toHaveTextContent("+1.4 pt"));
    expect(rowFor(table, "euro-area")).toHaveTextContent("+0.5 pt");
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
      expect(within(table).getAllByText(/trade history not available/i).length).toBe(
        FIXTURE_MARKETS.length,
      ),
    );
    expect(within(table).getAllByText(/price history not available/i).length).toBe(
      FIXTURE_MARKETS.length,
    );

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
    // 72h, 96h and 240h before the fixture clock.
    expect(positionOf(order, "ETH/USD")).toBeLessThan(positionOf(order, "euro-area"));
    expect(positionOf(order, "euro-area")).toBeLessThan(positionOf(order, "mainnet v2"));
  });

  it("filters by status from the URL", async () => {
    renderList(new MockSource(), "status=Settled");
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
