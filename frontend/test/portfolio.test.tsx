import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {AgentBook} from "@/components/portfolio/AgentBook";
import {AgentPicker} from "@/components/portfolio/AgentPicker";
import {AppProviders} from "@/hooks/provider";
import {agentsSeen} from "@/lib/agent-book";
import {MockSource} from "@/lib/data/mock";

const nav = vi.hoisted(() => ({push: vi.fn()}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({push: nav.push, replace: vi.fn()}),
  usePathname: () => "/portfolio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({href, children, ...rest}: {href: string; children: React.ReactNode}) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

/** The agent holding a position in every fixture market, derived rather than pasted. */
let busiest = "";

beforeAll(async () => {
  const source = new MockSource();
  const markets = await source.listMarkets();
  const lists = await Promise.all(markets.map((m) => source.getPositions(m.address)));
  const counts = new Map<string, number>();
  for (const list of lists) for (const p of list) counts.set(p.agent, (counts.get(p.agent) ?? 0) + 1);
  busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  expect(agentsSeen(lists)).toContain(busiest);
});

function renderBook(source = new MockSource(), agent = busiest) {
  return render(
    <AppProviders source={source}>
      <AgentBook agent={agent} />
    </AppProviders>,
  );
}

describe("AgentBook", () => {
  it("lists one row per market the agent holds", async () => {
    renderBook();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
  });

  it("values holdings at the marginal price, never labelling one as a percentage", async () => {
    const {container} = renderBook();
    await screen.findByRole("table");
    // p(NO) at q = [1000, 1200] is 0.6402 — a price per share, not 64.0%.
    expect(screen.getAllByText("0.6402").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("64.0%");
  });

  /**
   * COST_BASIS is what `chain` mode cannot answer. Everything derived from the
   * pool's current state survives; only what was paid, and the profit that
   * depends on it, become unknown — explained, never zero.
   */
  it("explains entry and PnL without COST_BASIS, and keeps shares and value", async () => {
    const {container} = renderBook(new MockSource({omit: ["COST_BASIS"]}));
    const table = await screen.findByRole("table");
    const row = within(table).getAllByRole("row")[1]!;

    expect(within(row).getByTestId("book-entry")).toHaveTextContent(/not available/i);
    expect(within(row).getByTestId("book-pnl")).toHaveTextContent(/not available/i);
    expect(within(row).getByTestId("book-entry")).not.toHaveTextContent("0.0000");
    // The current price and the value are pool state, so they stay.
    expect(within(table).getAllByText("0.6402").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("74.22");
  });

  it("says so plainly when an address holds nothing", async () => {
    renderBook(new MockSource(), `0x${"9".repeat(40)}`);
    expect(
      await screen.findByText(/no positions found for this address/i),
    ).toBeInTheDocument();
  });

  it("explains an unreadable position list instead of showing a partial book", async () => {
    renderBook(new MockSource({omit: ["AGENT_POSITIONS"]}));
    expect(await screen.findByText(/agent positions not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  /** Redeeming and liquidating are execution; the Status column replaces the Actions column. */
  it("reports what needs doing without offering to do it", async () => {
    renderBook();
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/agent can redeem/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {name: /redeem|liquidate|claim|sell|connect/i}),
    ).not.toBeInTheDocument();
  });
});

describe("AgentPicker", () => {
  it("offers no wallet connection", () => {
    render(
      <AppProviders source={new MockSource()}>
        <AgentPicker />
      </AppProviders>,
    );
    expect(screen.queryByRole("button", {name: /connect|wallet|sign in/i})).not.toBeInTheDocument();
  });

  /**
   * Navigating on a malformed address would render an empty book for the wrong
   * reason: "this agent holds nothing" reads very differently from "that is not
   * an address".
   */
  it("rejects a malformed address rather than navigating to an empty book", async () => {
    const user = userEvent.setup();
    nav.push.mockClear();
    render(
      <AppProviders source={new MockSource()}>
        <AgentPicker />
      </AppProviders>,
    );
    await user.type(screen.getByTestId("agent-address"), "0xnot-an-address");
    await user.click(screen.getByTestId("inspect-agent"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a 0x address/i);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("navigates on a well-formed address", async () => {
    const user = userEvent.setup();
    nav.push.mockClear();
    render(
      <AppProviders source={new MockSource()}>
        <AgentPicker />
      </AppProviders>,
    );
    const address = `0x${"a".repeat(40)}`;
    await user.type(screen.getByTestId("agent-address"), address);
    await user.click(screen.getByTestId("inspect-agent"));
    expect(nav.push).toHaveBeenCalledWith(`/portfolio/${address}`);
  });

  it("offers the agents this source can actually see", async () => {
    render(
      <AppProviders source={new MockSource()}>
        <AgentPicker />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByText(/agents in this source/i)).toBeInTheDocument());
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
