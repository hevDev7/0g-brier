import {describe, expect, it} from "vitest";
import {statusTone, tradingState} from "@/lib/market-rows";
import type {MarketStatus} from "@/lib/data/types";

/**
 * `status` answers "has `close()` been called". Readers ask a different question:
 * "can I do anything here". Those came apart on this deployment and stayed apart,
 * because `close()` is permissionless and nothing obliges anyone to call it.
 *
 * A market an hour past its `tradingEnd` and not yet closed showed a green `OPEN`
 * badge while `sell` reverted with `TradingEnded`, `redeem` with `NotSettled` and
 * `liquidate` with `NotLiquidatable`. Green means go in every interface a reader
 * has used before this one.
 */
const at = (status: MarketStatus, tradingEnd: number) => ({status, tradingEnd});
const NOW = 1_800_000_000;

describe("tradingState", () => {
  it("says Open only while the window is genuinely still running", () => {
    const s = tradingState(at("Open", NOW + 600), NOW);
    expect(s.label).toBe("Open");
    expect(s.tone).toBe("positive");
  });

  it("stops calling it Open the moment the window ends", () => {
    // The boundary is the interesting case: `close()` becomes callable at exactly
    // `tradingEnd`, and `sell` stops working at exactly `tradingEnd`.
    for (const now of [NOW, NOW + 1, NOW + 86_400]) {
      const s = tradingState(at("Open", NOW), now);
      expect(s.label, `at now=${now}`).toBe("Awaiting close");
      expect(s.tone).toBe("warning");
    }
  });

  it("names what is pending rather than only what is wrong", () => {
    // A reader who cannot act needs to know why and what would change it.
    expect(tradingState(at("Open", NOW), NOW + 1).hint).toMatch(/calls close\(\)/i);
  });

  it("never invents a state for a status that already speaks for itself", () => {
    // Only `Open` is ambiguous. Every other status already means what it says,
    // and a past tradingEnd tells a reader nothing new about it.
    for (const status of ["Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided"] as const) {
      const s = tradingState(at(status, NOW - 1), NOW);
      expect(s.label, status).toBe(status);
      expect(s.tone, status).toBe(statusTone(status));
    }
  });

  it("shows the chain status unrefined until the browser reports a clock", () => {
    // `null` on the server and the first client render. Guessing would paint a
    // badge wrong and then correct it, which is worse than being briefly coarse.
    const s = tradingState(at("Open", NOW - 86_400), null);
    expect(s.label).toBe("Open");
    expect(s.tone).toBe("positive");
  });

  it("keeps the raw status reachable, since the label is derived", () => {
    // Anything chain-shaped — the status filter, an SDK consumer — must still see
    // the enum. The derived word belongs to the reader, not to the data.
    const market = at("Open", NOW - 1);
    expect(tradingState(market, NOW).label).toBe("Awaiting close");
    expect(tradingState(market, NOW).hint).toContain("Open");
    expect(market.status).toBe("Open");
  });
});
