import {describe, expect, it} from "vitest";
import {PHASES, isPhase, phaseInfo, phaseOf, tradingHasEnded} from "@/lib/market-phase";
import {tradingState} from "@/lib/market-rows";
import type {MarketStatus} from "@/lib/data/types";

const NOW = 1_800_000_000;
const at = (status: MarketStatus, tradingEnd: number) => ({status, tradingEnd});

/**
 * The registry page listed all seven statuses in one table, so a deployment
 * whose markets had all finished showed a full page on which nothing could be
 * done: on Galileo, seven rows of which zero were tradable — one settled, three
 * failed, three closed and waiting on a resolver.
 */
describe("phaseOf", () => {
  it("puts a market that is still trading in front of the reader", () => {
    expect(phaseOf(at("Open", NOW + 600), NOW)).toBe("live");
  });

  it("takes a market out of Live the moment its window ends, closed or not", () => {
    // `close()` is permissionless and nothing obliges anyone to call it, so a
    // market can sit at `Open` for hours after its last tradable second. The
    // clock decides, not the enum.
    for (const now of [NOW, NOW + 1, NOW + 86_400]) {
      expect(phaseOf(at("Open", NOW), now), `at now=${now}`).toBe("pending");
    }
  });

  it("keeps an unresolved market out of history, however long it has waited", () => {
    // The distinction the whole three-way split exists for. These markets are
    // over as far as trading goes and unfinished as far as money goes: the
    // collateral is locked and somebody still owes the market an answer.
    // Filing them under Resolved would hide exactly the work a keeper surfaces.
    for (const status of ["Closed", "Proposed", "Disputed"] as const) {
      expect(phaseOf(at(status, NOW - 86_400), NOW), status).toBe("pending");
    }
  });

  it("treats every ending as an ending, not only the happy one", () => {
    // A failed market pays nobody and a settled one pays its winners, but both
    // are equally over — there is nothing left to wait for in either.
    for (const status of ["Settled", "Failed", "Voided"] as const) {
      expect(phaseOf(at(status, NOW - 1), NOW), status).toBe("resolved");
    }
  });

  it("does not guess a phase before the browser reports a clock", () => {
    // `null` on the server and the first client render. An Open market keeps the
    // chain's own answer rather than being sorted by a clock nobody has read.
    expect(phaseOf(at("Open", NOW - 86_400), null)).toBe("live");
  });

  /**
   * The badge and the tab must not be able to disagree. A market badged
   * "Awaiting close" sitting under Live would be the two halves of the same
   * comparison having drifted apart, which is why there is only one comparison.
   */
  it("agrees with the badge on the same market", () => {
    const stale = at("Open", NOW - 1);
    expect(tradingState(stale, NOW).label).toBe("Awaiting close");
    expect(phaseOf(stale, NOW)).toBe("pending");
    expect(tradingHasEnded(stale, NOW)).toBe(true);

    const live = at("Open", NOW + 1);
    expect(tradingState(live, NOW).label).toBe("Open");
    expect(phaseOf(live, NOW)).toBe("live");
    expect(tradingHasEnded(live, NOW)).toBe(false);
  });

  it("covers every status, so a new one cannot fall through unnoticed", () => {
    const all: MarketStatus[] = [
      "Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided",
    ];
    for (const status of all) {
      expect(PHASES.map((p) => p.key)).toContain(phaseOf(at(status, NOW - 1), NOW));
    }
  });
});

describe("the phase catalogue", () => {
  it("describes each phase and says what an empty one means", () => {
    for (const phase of PHASES) {
      expect(phaseInfo(phase.key)).toBe(phase);
      expect(phase.blurb.length).toBeGreaterThan(20);
      expect(phase.empty.length).toBeGreaterThan(20);
    }
  });

  it("orders the tabs the way a market moves through them", () => {
    expect(PHASES.map((p) => p.key)).toEqual(["live", "pending", "resolved"]);
  });

  it("rejects a phase the URL made up", () => {
    expect(isPhase("live")).toBe(true);
    expect(isPhase("history")).toBe(false);
    expect(isPhase("")).toBe(false);
  });
});
