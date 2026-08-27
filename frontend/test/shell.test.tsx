import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Shell} from "@/components/shell/Shell";
import {AppProviders} from "@/hooks/provider";
import {MockSource} from "@/lib/data/mock";

const routing = vi.hoisted(() => ({pathname: "/"}));

vi.mock("next/navigation", () => ({
  usePathname: () => routing.pathname,
  useRouter: () => ({push: vi.fn(), replace: vi.fn()}),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({href, children, ...rest}: {href: string; children: React.ReactNode}) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

function renderShell(pathname = "/", source = new MockSource()) {
  routing.pathname = pathname;
  return render(
    <AppProviders source={source}>
      <Shell>
        <p>page body</p>
      </Shell>
    </AppProviders>,
  );
}

beforeEach(() => {
  routing.pathname = "/";
});

describe("Shell navigation", () => {
  it("puts the primary navigation in the header, not in a sidebar", () => {
    renderShell();
    const header = screen.getByRole("banner");
    const nav = within(header).getByRole("navigation", {name: /primary/i});
    expect(within(nav).getByTestId("nav-markets")).toBeInTheDocument();
    expect(within(nav).getByTestId("nav-portfolio")).toBeInTheDocument();
  });

  /**
   * One nav element, not a desktop copy plus a mobile copy. Two would put the
   * same links in the accessibility tree twice, and every nav query would be
   * ambiguous.
   */
  it("renders each link exactly once", () => {
    renderShell();
    expect(screen.getAllByTestId("nav-markets")).toHaveLength(1);
    expect(screen.getAllByTestId("nav-portfolio")).toHaveLength(1);
  });

  it("marks the current section, and keeps Markets lit while inspecting one", () => {
    renderShell("/market/0x1111111111111111111111111111111111111111");
    expect(screen.getByTestId("nav-markets")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-portfolio")).not.toHaveAttribute("aria-current");
  });

  it("marks Portfolio on an agent book", () => {
    renderShell("/portfolio/0xabc");
    expect(screen.getByTestId("nav-portfolio")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-markets")).not.toHaveAttribute("aria-current");
  });

  it("the small-screen toggle reports and flips its own state", async () => {
    const user = userEvent.setup();
    renderShell();
    const toggle = screen.getByTestId("nav-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "primary-nav");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a skip link ahead of the navigation", () => {
    renderShell();
    const skip = screen.getByRole("link", {name: /skip to content/i});
    expect(skip).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});

describe("Shell chrome", () => {
  /**
   * The statement that humans do not execute here survived the sidebar being
   * replaced by a top navigation. It is not decoration: it is the honest reason
   * no page in this product has an action button, and losing it in a layout
   * change would leave that absence unexplained.
   */
  it("still says that execution does not happen in the browser", () => {
    renderShell();
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      /every trade is executed by an agent through the sdk, never from this page/i,
    );
  });

  it("names the data source, and flags a fixture source conspicuously", () => {
    renderShell();
    const indicators = screen.getAllByTestId("mode-indicator");
    expect(indicators.length).toBeGreaterThan(0);
    expect(indicators[0]).toHaveTextContent(/mock source/i);
  });

  it("offers a theme toggle whose label does not claim a direction", () => {
    renderShell();
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute(
      "aria-label",
      "Toggle colour theme",
    );
  });

  /** Spec §1 F3: no execution surface anywhere, chrome included. */
  it("has no execution control", () => {
    renderShell();
    expect(
      screen.queryByRole("button", {name: /buy|sell|approve|redeem|liquidate|connect|wallet/i}),
    ).not.toBeInTheDocument();
  });
});
