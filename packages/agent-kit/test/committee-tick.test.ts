import {describe, expect, it} from "vitest";
import {DRAW_RECHECK_SECONDS, NONE, NO, UNRESOLVABLE, YES, phaseFor, type RoundState, type SeatState} from "../examples/committee-tick";

/**
 * The committee pass, minus the chain.
 *
 * Market 0xCDc13Cc2… on 16661 failed with commits=0 and reveals=0 because nothing
 * was scheduled to vote in it. What replaces that is a pass, and the only part of
 * a pass that can be wrong without an RPC noticing is which phase it thinks is
 * due — so that judgement is a pure function and this is its test. Everything
 * else in `examples/committee-tick.ts` needs an RPC, a 0G Storage indexer and a
 * funded compute ledger; none of that is touched here, and importing the module
 * deliberately does not start a pass.
 *
 * THE NUMBERS ARE THE LIVE ONES. COMMIT_WINDOW and REVEAL_WINDOW are both 3600 s
 * on the mainnet ConfigRegistry, so a round drawn at T has commitDeadline T+3600
 * and revealDeadline T+7200. A test written against a rounder window would not
 * have caught the incident, whose whole content is which side of those two
 * instants `resolvesBy` fell on.
 */

const DRAWN_AT = 1_788_302_533;
const COMMIT_WINDOW = 3600;
const REVEAL_WINDOW = 3600;
const DISPUTE_WINDOW = 7200;

/** A live round one, drawn at `DRAWN_AT`, with nothing proposed. */
function round(overrides: Partial<RoundState> = {}): RoundState {
  return {
    n: 3,
    k: 2,
    index: 1,
    proposedOutcome: NONE,
    commitDeadline: DRAWN_AT + COMMIT_WINDOW,
    revealDeadline: DRAWN_AT + COMMIT_WINDOW + REVEAL_WINDOW,
    disputeDeadline: 0,
    finalized: false,
    ...overrides,
  };
}

function seat(overrides: Partial<SeatState> = {}): SeatState {
  return {agentId: 7, committed: false, revealed: false, ...overrides};
}

describe("phaseFor", () => {
  it("numbers the outcomes the way Outcomes.sol does", () => {
    // The reveal path passes these straight into `revealVote`, and the module
    // rejects anything above UNRESOLVABLE with `BadOutcome`. NONE is not a vote;
    // it is what `revealOf` answers for a seat that has not revealed.
    expect([NO, YES, UNRESOLVABLE, NONE]).toEqual([0, 1, 2, 3]);
  });

  describe("before the event is decidable", () => {
    it("commits nothing and waits for resolvesBy", () => {
      const resolvesBy = DRAWN_AT + 1800;
      const due = phaseFor({now: DRAWN_AT + 60, resolvesBy, round: round(), seats: [seat()]});

      expect(due.phase).toBe("wait-for-event");
      expect(due.seats).toEqual([]);
      // Exactly resolvesBy: the commit is due the moment the event is decidable,
      // and there is nothing to gain by waking earlier or later.
      expect(due.nextDue).toBe(resolvesBy);
    });

    it("declines to vote at all when the spec does not say when the event resolves", () => {
      // A market whose spec carries no resolvesBy cannot be told apart from one
      // whose event has not happened. It fails at its deadline and both sides
      // exit at their own price, which is the cheaper of the two mistakes.
      const due = phaseFor({now: DRAWN_AT + 60, resolvesBy: null, round: round(), seats: [seat()]});

      expect(due.phase).toBe("undecidable");
      expect(due.nextDue).toBeNull();
    });

    it("names a round whose commit window shuts before the event — the incident", () => {
      // The live numbers from 0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35 on
      // 16661. The keeper drew 117 s after tradingEnd; the baseball game it asked
      // about could not be Final for another 2h54m.
      const due = phaseFor({
        now: 1_788_302_600,
        resolvesBy: 1_788_316_800,
        round: round({commitDeadline: 1_788_306_133, revealDeadline: 1_788_309_733}),
        seats: [seat()],
      });

      expect(due.phase).toBe("unanswerable");
      // Nothing to come back for: no honest vote exists inside this round, and a
      // scheduler that kept waking for it would burn passes on a dead market.
      expect(due.nextDue).toBeNull();
      expect(due.why).toContain("10667s later");
    });

    it("still reveals an outstanding commit in a round it calls unanswerable", () => {
      // A commit is stake at risk whatever is wrong with the round holding it.
      // The diagnostic must never outrank the one action that stops a slashing.
      const r = round({commitDeadline: 1_788_306_133, revealDeadline: 1_788_309_733});
      const due = phaseFor({
        now: 1_788_306_500,
        resolvesBy: 1_788_316_800,
        round: r,
        seats: [seat({committed: true})],
      });

      expect(due.phase).toBe("reveal");
      expect(due.seats).toEqual([7]);
    });
  });

  describe("the commit window", () => {
    it("commits every uncommitted seat once the event is decidable", () => {
      const resolvesBy = DRAWN_AT + 600;
      const due = phaseFor({
        now: resolvesBy + 1,
        resolvesBy,
        round: round(),
        seats: [seat({agentId: 4}), seat({agentId: 8}), seat({agentId: 12, committed: true})],
      });

      expect(due.phase).toBe("commit");
      expect(due.seats).toEqual([4, 8]);
      // The reveal opens STRICTLY after the commit deadline — `revealVote` reverts
      // `WindowOpen` on equality — so the wake is one second past it, never on it.
      expect(due.nextDue).toBe(DRAWN_AT + COMMIT_WINDOW + 1);
    });

    it("waits out the window once every seat it holds is committed", () => {
      const due = phaseFor({
        now: DRAWN_AT + 700,
        resolvesBy: DRAWN_AT,
        round: round(),
        seats: [seat({committed: true})],
      });

      expect(due.phase).toBe("idle");
      expect(due.nextDue).toBe(DRAWN_AT + COMMIT_WINDOW + 1);
    });
  });

  describe("the reveal window", () => {
    it("reveals what an earlier pass committed", () => {
      const r = round();
      const due = phaseFor({
        now: r.commitDeadline + 5,
        resolvesBy: DRAWN_AT,
        round: r,
        seats: [seat({agentId: 4, committed: true}), seat({agentId: 8, committed: true, revealed: true})],
      });

      expect(due.phase).toBe("reveal");
      expect(due.seats).toEqual([4]);
      // No proposal yet, so no dispute deadline exists to sleep to — this very
      // reveal may be the one that creates it. Come back when the window shuts
      // and read the round then.
      expect(due.nextDue).toBe(r.revealDeadline + 1);
    });

    it("has nothing due once every seat has revealed", () => {
      const r = round();
      const due = phaseFor({
        now: r.commitDeadline + 5,
        resolvesBy: DRAWN_AT,
        round: r,
        seats: [seat({committed: true, revealed: true})],
      });

      expect(due.phase).toBe("idle");
      expect(due.seats).toEqual([]);
      expect(due.nextDue).toBe(r.revealDeadline + 1);
    });

    it("sleeps to the dispute deadline when a reveal has already met the threshold", () => {
      const r = round({proposedOutcome: YES, disputeDeadline: DRAWN_AT + COMMIT_WINDOW + DISPUTE_WINDOW});
      const due = phaseFor({
        now: r.commitDeadline + 5,
        resolvesBy: DRAWN_AT,
        round: r,
        seats: [seat({committed: true, revealed: true})],
      });

      expect(due.phase).toBe("wait-for-finalize");
      expect(due.nextDue).toBe(r.disputeDeadline + 1);
    });
  });

  describe("finalizing", () => {
    it("waits out the dispute window rather than sending a call that reverts", () => {
      // `finalize` refuses round one until `block.timestamp > disputeDeadline`
      // with `TooEarly`. A pass that fired at the reveal deadline would pay gas
      // every wake to be told so.
      const r = round({proposedOutcome: YES, disputeDeadline: DRAWN_AT + 20_000});
      const due = phaseFor({now: r.revealDeadline + 10, resolvesBy: DRAWN_AT, round: r, seats: []});

      expect(due.phase).toBe("wait-for-finalize");
      expect(due.nextDue).toBe(r.disputeDeadline + 1);
    });

    it("finalizes once nobody can still object", () => {
      const r = round({proposedOutcome: YES, disputeDeadline: DRAWN_AT + 20_000});
      const due = phaseFor({now: r.disputeDeadline + 1, resolvesBy: DRAWN_AT, round: r, seats: []});

      expect(due.phase).toBe("finalize");
      // Finalizing is terminal for this market: the round is over and nothing
      // about it can fall due again.
      expect(due.nextDue).toBeNull();
    });

    it("finalizes a dispute round at its reveal deadline, which has no dispute window", () => {
      // Round two is the last word, so the module makes it wait out its reveal
      // window instead — otherwise its own members would choose the moment the
      // market settles, before anybody else could see the tally.
      const r = round({index: 2, proposedOutcome: NO, disputeDeadline: 0});
      const due = phaseFor({now: r.revealDeadline + 1, resolvesBy: DRAWN_AT, round: r, seats: []});

      expect(due.phase).toBe("finalize");
    });

    it("finalizes even for an operator that was never drawn", () => {
      // `finalize` is permissionless, and the incident's market shows why that
      // matters: a proposal nobody carries out is a market nobody can exit.
      const r = round({proposedOutcome: YES, disputeDeadline: DRAWN_AT + 20_000});
      const due = phaseFor({now: r.disputeDeadline + 60, resolvesBy: DRAWN_AT, round: r, seats: []});

      expect(due.phase).toBe("finalize");
    });
  });

  describe("rounds nothing can advance", () => {
    it("reports a reveal window that shut without a threshold", () => {
      const r = round();
      const due = phaseFor({now: r.revealDeadline + 1, resolvesBy: DRAWN_AT, round: r, seats: [seat()]});

      expect(due.phase).toBe("no-threshold");
      // Only the settlement deadline can help now, and enforcing it is the
      // keeper's job rather than this pass's.
      expect(due.nextDue).toBeNull();
    });

    it("has nothing to do with a finalized round", () => {
      const due = phaseFor({
        now: DRAWN_AT + 100_000,
        resolvesBy: DRAWN_AT,
        round: round({finalized: true, proposedOutcome: YES}),
        seats: [seat({committed: true, revealed: true})],
      });

      expect(due.phase).toBe("done");
      expect(due.nextDue).toBeNull();
    });
  });

  describe("before a committee exists", () => {
    it("sleeps to resolvesBy, because that is when the draw itself is due", () => {
      // The keeper defers round one's draw to `min(resolvesBy, latestUsefulDraw)`.
      // Waking earlier would find the same empty round; waking at resolvesBy lands
      // inside the commit window that draw opens.
      const resolvesBy = DRAWN_AT + 50_000;
      const due = phaseFor({
        now: DRAWN_AT,
        resolvesBy,
        round: round({n: 0, k: 0, index: 0, commitDeadline: 0, revealDeadline: 0}),
        seats: [],
      });

      expect(due.phase).toBe("wait-for-draw");
      expect(due.nextDue).toBe(resolvesBy);
    });

    it("re-checks on a short interval once the event is decidable", () => {
      // Past resolvesBy the draw is somebody else's transaction and nothing on
      // chain says when it lands, so there is no deadline to sleep to.
      const now = DRAWN_AT + 50_000;
      const due = phaseFor({
        now,
        resolvesBy: DRAWN_AT,
        round: round({n: 0, k: 0, index: 0, commitDeadline: 0, revealDeadline: 0}),
        seats: [],
      });

      expect(due.phase).toBe("wait-for-draw");
      expect(due.nextDue).toBe(now + DRAW_RECHECK_SECONDS);
      // Short against the 3600 s commit window the draw opens, so a pass still
      // lands well inside it.
      expect(DRAW_RECHECK_SECONDS).toBeLessThan(COMMIT_WINDOW / 2);
    });
  });
});
