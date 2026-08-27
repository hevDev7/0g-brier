import {act, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it} from "vitest";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Unavailable, WHY} from "@/components/primitives/Unavailable";
import {ChainSource} from "@/lib/data/chain";
import {LogSource} from "@/lib/data/logs";
import {CAPABILITIES, type DataMode} from "@/lib/data/types";

const FULL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

/** Installs navigator.clipboard for a single test only; restored in afterEach. */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {writeText},
    configurable: true,
  });
}

describe("Unavailable", () => {
  it("names the missing capability and the mode that provides it", () => {
    render(<Unavailable capability="PRICE_HISTORY" mode="chain" />);
    expect(screen.getByText(/price history/i)).toBeInTheDocument();
    expect(screen.getByText(/indexer/i)).toBeInTheDocument();
  });

  /** The heart of the rule: not knowing must not disguise itself as a number. */
  it("never renders a zero or a bare dash", () => {
    const {container} = render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    const text = container.textContent ?? "";
    expect(text.trim()).not.toBe("0");
    expect(text.trim()).not.toBe("—");
    expect(text.length).toBeGreaterThan(10);
  });

  /**
   * A live page printed "Resolution evidence not available in indexer mode —
   * … Available in indexer mode." Two entries in the table named a mode that
   * does not in fact supply them, and one of those was the mode the reader was
   * already in. The rule is not about those two capabilities: no message may
   * ever send a reader to where they already are, so it is asserted across every
   * capability and every mode rather than at the two that happened to break.
   */
  it.each(
    CAPABILITIES.flatMap((capability) =>
      (["mock", "chain", "indexer"] as const).map((mode) => [capability, mode] as const),
    ),
  )("never points %s at the mode the reader is already in (%s)", (capability, mode: DataMode) => {
    const {container} = render(<Unavailable capability={capability} mode={mode} />);
    expect(container.textContent ?? "").not.toMatch(new RegExp(`Available in ${mode} mode`));
  });

  /**
   * The other half of the same defect, and the half the guard above HIDES: two
   * entries named `indexer` for capabilities `LogSource` does not declare. The
   * guard stops the sentence pointing at the reader's own mode, so a wrong entry
   * goes silent instead of wrong — which is worse, because it also stops
   * pointing anyone at the mode that would work.
   *
   * A component cannot check a claim about another mode, so the check belongs
   * here: whatever mode a message names must really supply the capability.
   */
  it.each(Object.entries(WHY).filter(([, w]) => w.provider !== null))(
    "%s names a mode that really supplies it",
    (capability, {provider}) => {
      const config = {
        rpcUrl: "http://stub",
        chainId: 16602,
        factory: "0xfacadefacadefacadefacadefacadefacadefac0" as const,
        fromBlock: 0n,
      };
      // Capabilities are settled in the constructor, so neither source touches
      // the network here.
      const source = provider === "chain" ? new ChainSource(config) : new LogSource(config);
      expect(source.mode).toBe(provider);
      expect([...source.capabilities]).toContain(capability);
    },
  );

  /**
   * This is a status change a screen-reader user needs to hear, just as a sighted
   * user needs to see it — without role="status" the explanation exists only
   * visually.
   */
  it("is announced to screen readers through role=status", () => {
    render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge tone="neutral" label="VERIFIED" />);
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
  });
});

describe("CopyAddress", () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, "clipboard", {value: undefined, configurable: true});
  });

  it("shows the elided form but keeps the full address in the title", () => {
    render(<CopyAddress address={FULL_ADDRESS} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("0x1234…5678");
    expect(button).toHaveAttribute("title", FULL_ADDRESS);
  });

  /** The transition to "copied" is a status change; screen-reader users need to hear it too. */
  it("announces the copied confirmation through aria-live", () => {
    render(<CopyAddress address={FULL_ADDRESS} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-live", "polite");
  });

  /**
   * The button must not claim a success that has not happened — the same rule that
   * makes `unavailable` a member of the Query union, moved from data to action.
   * Before writeText resolves, "copied" may not appear.
   */
  it("shows 'copied' only AFTER the clipboard write genuinely succeeds", async () => {
    // userEvent.setup() installs its OWN clipboard stub on navigator — ours must be
    // installed AFTERWARDS, or it is silently overwritten.
    const user = userEvent.setup();
    let resolveWrite!: () => void;
    const pending = new Promise<void>((res) => {
      resolveWrite = res;
    });
    stubClipboard(() => pending);

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).not.toHaveTextContent("copied");

    await act(async () => {
      resolveWrite();
      await pending;
    });
    expect(screen.getByRole("button")).toHaveTextContent("copied");
  });

  it("does not claim copied when the clipboard write fails (rejected promise)", async () => {
    const user = userEvent.setup();
    let rejectWrite!: (reason: unknown) => void;
    const pending = new Promise<void>((_resolve, rej) => {
      rejectWrite = rej;
    });
    stubClipboard(() => pending);

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    await act(async () => {
      rejectWrite(new Error("permission denied"));
      await pending.catch(() => {});
    });
    expect(screen.getByRole("button")).toHaveTextContent("0x1234…5678");
  });

  it("does not claim copied when the clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {value: undefined, configurable: true});

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("0x1234…5678");
  });
});

describe("Countdown", () => {
  it("formats the time remaining from an absolute timestamp", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now + 2 * 3600 + 14 * 60} nowSeconds={now} />);
    expect(screen.getByText("2h 14m")).toBeInTheDocument();
  });

  it("says closed once it has passed", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now - 60} nowSeconds={now} />);
    expect(screen.getByText("closed")).toBeInTheDocument();
  });
});
