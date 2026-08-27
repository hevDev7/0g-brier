import {render, screen, waitFor, within} from "@testing-library/react";
import {describe, expect, it, vi} from "vitest";
import {Leaderboard} from "@/components/leaderboard/Leaderboard";
import {AppProviders} from "@/hooks/provider";
import {MockSource} from "@/lib/data/mock";
import type {Capability} from "@/lib/data/types";

const routing = vi.hoisted(() => ({params: new URLSearchParams()}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({replace: vi.fn(), push: vi.fn()}),
  usePathname: () => "/leaderboard",
  useSearchParams: () => routing.params,
}));

vi.mock("next/link", () => ({
  default: ({href, children, ...rest}: {href: string; children: React.ReactNode}) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

function renderBoard(omit: Capability[] = [], query = "") {
  routing.params = new URLSearchParams(query);
  return render(
    <AppProviders source={new MockSource({omit})}>
      <Leaderboard />
    </AppProviders>,
  );
}

async function rows() {
  const table = await screen.findByRole("table");
  return within(table).getAllByRole("rowheader");
}

describe("Leaderboard", () => {
  it("ranks every agent, linking each to its own book", async () => {
    renderBoard();
    const agents = await waitFor(async () => {
      const found = await rows();
      expect(found.length).toBeGreaterThan(1);
      return found;
    });
    const link = within(agents[0]!).getByRole("link");
    expect(link.getAttribute("href")).toMatch(/^\/portfolio\/0x[0-9a-fA-F]{40}$/);
  });

  it("shows the four figures asked of it", async () => {
    renderBoard();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByTestId("lb-account").length).toBeGreaterThan(0));
    for (const id of ["lb-trades", "lb-volume", "lb-deployed", "lb-account", "lb-unrealised"]) {
      expect(within(table).getAllByTestId(id).length).toBeGreaterThan(0);
    }
  });

  /**
   * The required-and-easiest-to-forget check: in a limited mode the unknown
   * columns explain themselves and the known ones stay populated. A zero on a
   * RANKED table is worse than elsewhere — it reads as a claim about the agent
   * rather than about the source.
   */
  it("explains the columns a limited mode cannot know, and keeps the rest", async () => {
    renderBoard(["TRADE_TAPE", "COST_BASIS"]);
    const table = await screen.findByRole("table");
    await waitFor(() =>
      expect(within(table).getAllByTestId("lb-trades")[0]).toHaveTextContent(/not available/i),
    );
    expect(within(table).getAllByTestId("lb-volume")[0]).toHaveTextContent(/not available/i);
    expect(within(table).getAllByTestId("lb-unrealised")[0]).toHaveTextContent(/not available/i);
    // Deployed and account value come from elsewhere and survive.
    expect(within(table).getAllByTestId("lb-deployed")[0]).not.toHaveTextContent(/not available/i);
    expect(within(table).getAllByTestId("lb-account")[0]).not.toHaveTextContent(/not available/i);
    expect(within(table).getAllByTestId("lb-trades")[0]).not.toHaveTextContent("0");
  });

  it("explains an unknown account value rather than ranking the agent as broke", async () => {
    renderBoard(["AGENT_BALANCE"]);
    const table = await screen.findByRole("table");
    await waitFor(() =>
      expect(within(table).getAllByTestId("lb-account")[0]).toHaveTextContent(/not available/i),
    );
    expect(within(table).getAllByTestId("lb-free")[0]).toHaveTextContent(/not available/i);
    expect(within(table).getAllByTestId("lb-deployed")[0]).not.toHaveTextContent(/not available/i);
  });

  /**
   * The cell must name the mode the app is ACTUALLY in. These cells hard-coded
   * "chain", so running on `mock` with a capability omitted sent a reader
   * looking for a fix in a source that had nothing to do with it.
   */
  it("names the mode it is really running in, not a hard-coded one", async () => {
    renderBoard(["COST_BASIS"]);
    const table = await screen.findByRole("table");
    const cell = within(table).getAllByTestId("lb-unrealised")[0]!;
    await waitFor(() => expect(cell).toHaveTextContent(/not available/i));
    const status = within(cell).getByRole("status");
    expect(status.getAttribute("title")).toMatch(/in mock mode/i);
    expect(status.getAttribute("title")).not.toMatch(/in chain mode/i);
  });

  it("says nothing at all rather than an empty ranking when no agent can be seen", async () => {
    renderBoard(["AGENT_POSITIONS", "TRADE_TAPE"]);
    expect(await screen.findByText(/agent positions not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("ranks by the sort taken from the URL", async () => {
    renderBoard([], "sort=trades");
    await screen.findByRole("table");
    expect(screen.getByTestId("sort-trades")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sort-account")).toHaveAttribute("aria-pressed", "false");
  });

  /** Three claims a reader would otherwise infer, and infer wrongly. */
  it("states what unrealised excludes and what account value contains", async () => {
    renderBoard();
    const panel = await screen.findByTestId("leaderboard");
    expect(panel).toHaveTextContent(/free collateral plus the value of open positions/i);
    expect(panel).toHaveTextContent(/covers open positions only/i);
    expect(panel).toHaveTextContent(/ranked last rather than as zero/i);
  });

  /** Spec §1 F3: observation only, leaderboards included. */
  it("has no execution control", async () => {
    renderBoard();
    await screen.findByRole("table");
    expect(
      screen.queryByRole("button", {name: /buy|sell|approve|redeem|liquidate|connect|copy trade/i}),
    ).not.toBeInTheDocument();
  });
});
