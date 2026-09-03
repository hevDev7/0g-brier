import {describe, expect, it} from "vitest";
import {drawDecision} from "../examples/keeper";

/**
 * The keeper's draw schedule, against the numbers that made it necessary.
 *
 * Every constant below is real: read off 0G mainnet (16661) on 2026-09-01, from
 * ConfigRegistry 0x3289fcb307714774ac45de9606af6f95d2b2b4dd and the two markets
 * MarketFactory 0x4c79…8fe0 has created. Nothing here is a scenario — the first
 * test is a transcript of a market that died.
 *
 * `drawDecision` is pure and takes the windows as arguments, so this file talks
 * to no chain, no indexer and no clock.
 */

/** ConfigRegistry on 16661, both 3600 as deployed today. */
const COMMIT_WINDOW = 3600;
const REVEAL_WINDOW = 3600;

/**
 * Market[1], 0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35 —
 * "Will the combined final score of Mets @ Rays on 2026-09-01 be more than 8 runs?"
 */
const METS_RAYS = {
  tradingEnd: 1788302416,
  /** First pitch plus four hours: when the game can be Final, per its MarketSpec. */
  resolvesBy: 1788316800,
  settlementDeadline: 1788331216,
  /** When the keeper actually drew: 117 seconds after trading ended. */
  drewAt: 1788302533,
};

/** Market[0], 0x7c1f9c8b2C1b17fbB054d18735982cD9a696099E — the ETH/USD close for 2026-09-30. */
const ETH_CLOSE = {
  tradingEnd: 1790812812,
  /** The Coinbase close the question names, thirteen seconds BEFORE trading ends. */
  resolvesBy: 1790812799,
  settlementDeadline: 1791417612,
};

describe("Mets @ Rays: the draw that shut the reveal window before the game ended", () => {
  it("is the failure this rule exists to prevent", () => {
    // Not an assertion about the code — an assertion about the incident, so that a
    // reader can see the arithmetic that produced commits=0, reveals=0 and a Failed
    // market nobody had voted on. The keeper drew at `drewAt`, `openResolution`
    // dated both windows from there, and the reveal window shut here:
    const revealShutAt = METS_RAYS.drewAt + COMMIT_WINDOW + REVEAL_WINDOW;
    expect(revealShutAt).toBe(1788309733);
    // …7,067 seconds — one hour fifty-eight minutes — before the baseball game the
    // market asked about could possibly be Final. No honest vote was available.
    expect(METS_RAYS.resolvesBy - revealShutAt).toBe(7067);
  });

  it("defers rather than drawing, 117 seconds after trading ended", () => {
    const d = drawDecision({
      now: METS_RAYS.drewAt,
      resolvesBy: METS_RAYS.resolvesBy,
      settlementDeadline: METS_RAYS.settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d.act).toBe("defer");
    expect(d.drawAt).toBe(METS_RAYS.resolvesBy);
    expect(d.drawAt).toBe(1788316800);
    // The spec fits its own settlement window with room to spare, so there is
    // nothing to warn about. The market was answerable; the keeper burned it.
    expect(d.shortfall).toBe(0);
  });

  it("draws once the game can be Final, and the reveal window still lands inside the deadline", () => {
    const d = drawDecision({
      now: METS_RAYS.resolvesBy,
      resolvesBy: METS_RAYS.resolvesBy,
      settlementDeadline: METS_RAYS.settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d.act).toBe("draw");
    expect(d.drawAt).toBe(1788316800);
    // The whole point of the bound: `openResolution` would set `revealDeadline`
    // here, and a reveal nobody can make before the market fails is not a window.
    const revealDeadline = d.drawAt + COMMIT_WINDOW + REVEAL_WINDOW;
    expect(revealDeadline).toBe(1788324000);
    expect(revealDeadline).toBeLessThanOrEqual(METS_RAYS.settlementDeadline);
    // 7,216 seconds of slack — the same margin scripts/market-spec.py measures
    // when it admits this spec.
    expect(METS_RAYS.settlementDeadline - revealDeadline).toBe(7216);
  });

  it("still defers with the shortened windows a rehearsal runs on", () => {
    // committee-run.mjs sets COMMIT_WINDOW to 300 and REVEAL_WINDOW to 120 so a
    // demo finishes in minutes. The windows are arguments for exactly this reason:
    // a rule holding 3600 in its own source agrees with the chain only by luck.
    const d = drawDecision({
      now: METS_RAYS.drewAt,
      resolvesBy: METS_RAYS.resolvesBy,
      settlementDeadline: METS_RAYS.settlementDeadline,
      commitWindow: 300,
      revealWindow: 120,
    });
    expect(d.act).toBe("defer");
    expect(d.drawAt).toBe(METS_RAYS.resolvesBy);
  });
});

describe("a question already decidable at close", () => {
  it("draws market[0] the moment its trading window ends", () => {
    // `resolvesBy` is thirteen seconds BEFORE `tradingEnd` here — the Coinbase
    // close the question names has already printed by the time the market shuts.
    // Nothing is deferred; this is the ordinary case and must stay free.
    const d = drawDecision({
      now: ETH_CLOSE.tradingEnd,
      resolvesBy: ETH_CLOSE.resolvesBy,
      settlementDeadline: ETH_CLOSE.settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d.act).toBe("draw");
    expect(d).toMatchObject({why: "question-answerable", shortfall: 0});
    expect(d.drawAt).toBe(ETH_CLOSE.resolvesBy);
  });

  for (const [label, resolvesBy] of [
    ["0, the `selftest` spec answered from the market's own chain state", 0],
    ["null", null],
    ["undefined", undefined],
  ] as const) {
    it(`draws immediately when resolvesBy is ${label}`, () => {
      const now = 1788302533;
      const d = drawDecision({
        now,
        resolvesBy,
        settlementDeadline: METS_RAYS.settlementDeadline,
        commitWindow: COMMIT_WINDOW,
        revealWindow: REVEAL_WINDOW,
      });
      expect(d).toEqual({act: "draw", drawAt: now, shortfall: 0, why: "decidable-at-close"});
    });
  }
});

describe("a spec whose event resolves too late for a full round", () => {
  // market-spec.py refuses to create one of these, so it can only be a market
  // predating that refusal. Late-but-inside still beats never drawn: a committee
  // with a shortened window can answer, one that was never seated cannot.
  const settlementDeadline = METS_RAYS.settlementDeadline;
  const latestUsefulDraw = settlementDeadline - (COMMIT_WINDOW + REVEAL_WINDOW);
  const resolvesBy = latestUsefulDraw + 1800;

  it("caps the draw at the last useful moment and reports the shortfall", () => {
    const d = drawDecision({
      now: latestUsefulDraw,
      resolvesBy,
      settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d).toEqual({act: "draw", drawAt: latestUsefulDraw, shortfall: 1800, why: "deadline-forces-it"});
    expect(latestUsefulDraw).toBe(1788324016);
  });

  it("does not defer past the last useful moment, and warns while it waits", () => {
    const d = drawDecision({
      now: latestUsefulDraw - 60,
      resolvesBy,
      settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d.act).toBe("defer");
    expect(d.drawAt).toBe(latestUsefulDraw);
    expect(d.drawAt).toBeLessThan(resolvesBy);
    expect(d.shortfall).toBe(1800);
  });

  it("draws a market already past its last useful moment rather than giving up", () => {
    const d = drawDecision({
      now: settlementDeadline - 1,
      resolvesBy,
      settlementDeadline,
      commitWindow: COMMIT_WINDOW,
      revealWindow: REVEAL_WINDOW,
    });
    expect(d.act).toBe("draw");
  });
});

describe("importing the keeper does not run it", () => {
  it("exports the schedule without opening a wallet", () => {
    // The import at the top of this file IS the assertion. Until this fix, reaching
    // `drawDecision` meant loading a module that threw for want of a signing key and
    // then called `listMarkets` against a live node — so the draw instant, the one
    // judgement here that has already cost a market, had no test at all.
    //
    // Do NOT assert on `process.env.KEEPER_KEY` to say the same thing. `.env.mainnet`
    // defines it and scripts/keeper-tick.sh exports it with `set -a`, so it is set in
    // exactly the shell an operator runs tests from — and a failing `toBeUndefined()`
    // renders the received value, printing a live mainnet key into the terminal and
    // into any CI log. The assertion bought no coverage the import does not already
    // give, and cost a secret.
    expect(typeof drawDecision).toBe("function");
  });
});
