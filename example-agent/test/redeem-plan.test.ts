/**
 * Every way a market can end, and what is claimed in each.
 *
 * A market ends three ways and only one of them has a winner: `Settled` pays
 * the winning side at `1/pᵢ` through `redeem`, while `Failed` and `Voided` pay
 * BOTH sides at their own marginal price through `liquidate` — a different
 * function with a different arithmetic, and the thing that makes an
 * unanswerable question survivable rather than a total loss.
 *
 * `planFor` is an exhaustive switch with an explicit return type and no
 * `default`, the same discipline the frontend's `Query<T>` uses, so a status
 * that grew a case would fail to compile rather than fall through to "skip" and
 * leave an exit path nobody noticed had gone missing. The record below carries
 * that guarantee into this file: adding a `MarketStatus` breaks this test's
 * compilation too, so the exit paths cannot be extended without being counted.
 */
import {describe, expect, it} from "vitest";
import type {MarketStatus} from "@0g-brier/agent-kit";
import {planFor} from "../src/redeem.js";
import {EVEN_BOOK, marketAt} from "./fixtures.js";

const EVERY_STATUS: Record<MarketStatus, true> = {
  Open: true,
  Closed: true,
  Proposed: true,
  Disputed: true,
  Settled: true,
  Failed: true,
  Voided: true,
};
const ALL_STATUSES = Object.keys(EVERY_STATUS) as MarketStatus[];

describe("planFor covers every status a market can hold", () => {
  it("answers for all seven, with no status left unplanned", () => {
    expect(ALL_STATUSES).toHaveLength(7);
    for (const status of ALL_STATUSES) {
      const plan = planFor(marketAt(EVEN_BOOK, {status, winningOutcome: status === "Settled" ? 1 : null}));
      expect(plan.kind, `${status} produced no plan`).toMatch(/^(redeem|liquidate|skip)$/);
    }
  });

  it("redeems a settled market on the side that won", () => {
    for (const winner of [0, 1] as const) {
      const plan = planFor(marketAt(EVEN_BOOK, {status: "Settled", winningOutcome: winner}));
      expect(plan).toEqual({kind: "redeem", winner});
    }
  });

  it("does not read outcome 0 as an absence", () => {
    // NO winning is a settlement, not a missing one, and `winningOutcome` is
    // `Outcome | null` for exactly that reason. A falsy check here would skip
    // every market that resolved NO and silently strand the position.
    const plan = planFor(marketAt(EVEN_BOOK, {status: "Settled", winningOutcome: 0}));
    expect(plan.kind).toBe("redeem");
  });

  it("refuses to guess which side won when the chain recorded no outcome", () => {
    const plan = planFor(marketAt(EVEN_BOOK, {status: "Settled", winningOutcome: null}));
    expect(plan.kind).toBe("skip");
    if (plan.kind !== "skip") return;
    expect(plan.why).toContain("refusing to guess");
  });

  it("liquidates a market nobody won", () => {
    for (const status of ["Failed", "Voided"] as const) {
      expect(planFor(marketAt(EVEN_BOOK, {status}))).toEqual({kind: "liquidate"});
    }
  });

  it("waits on a market that has not resolved, and says what it is waiting on", () => {
    for (const status of ["Open", "Closed", "Proposed", "Disputed"] as const) {
      const plan = planFor(marketAt(EVEN_BOOK, {status}));
      expect(plan.kind).toBe("skip");
      if (plan.kind !== "skip") continue;
      expect(plan.why).toContain(status);
    }
  });
});
