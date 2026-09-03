import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

/**
 * `keeper-schedule.test.ts` proves the arithmetic of `drawDecision`. It cannot
 * prove the keeper ASKS it anything: every one of those tests calls the exported
 * function directly, so deleting the call site — or the `markFailed` preference
 * beside it — leaves the whole file green while restoring both defects.
 *
 * That is not hypothetical. Both bugs this guards were live on 0G mainnet on
 * 2026-09-01, on market 0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35:
 *
 *  1. THE DRAW. `advanceDraw` ran 117 s after `tradingEnd`, and `openResolution`
 *     sets `commitDeadline = block.timestamp + COMMIT_WINDOW` — so the reveal
 *     window shut at 1788309733, 1h58m BEFORE the baseball game the question
 *     asks about could be Final (`resolvesBy` 1788316800). The round closed with
 *     commits=0 and the market failed. Nothing on chain forced that timing:
 *     `openResolution` has no deadline check, only `index != 0` and status.
 *  2. THE FAIL. The keeper called `Market.fail()` directly rather than
 *     `ResolutionModule.markFailed()`, so round 1 is stuck at `finalized=false`
 *     permanently and agents 12, 8 and 4 kept 0.4 W0G each, unslashed and
 *     indistinguishable from agents never drawn.
 *
 * Written in the shape of `network-boundary.test.ts`, which guards the same class
 * of regression: a rule that lives at one call site and cannot be typed.
 */
describe("the keeper's round-1 draw is gated on the question being answerable", () => {
  const keeper = join(process.cwd(), "examples", "keeper.ts");
  const src = readFileSync(keeper, "utf8");

  /**
   * The source with its own declarations removed, so a scan sees CALL SITES only.
   *
   * The first draft of this file asserted `/drawDecision\s*\(/` against the whole
   * source and was green after the call site was deleted — because the exported
   * `function drawDecision(` matched itself. A wiring test that the wiring cannot
   * break is worse than none: it reports coverage it does not have. Verified by
   * mutation both ways before this was committed.
   */
  const calls = src
    .replace(/export\s+function\s+drawDecision\s*\(/g, "«decl»")
    .replace(/(export\s+)?(async\s+)?function\s+failMarket\s*\(/g, "«decl»");

  it("scans the source it means to scan", () => {
    // A scanner pointed at a moved or renamed file passes every assertion below
    // for free — the failure mode `network-boundary.test.ts` guards first, too.
    expect(src.length, "examples/keeper.ts is empty or missing").toBeGreaterThan(5_000);
    expect(src, "examples/keeper.ts no longer opens a resolution round").toContain("openResolution");
  });

  it("consults drawDecision before drawing", () => {
    expect(
      /drawDecision\s*\(/.test(calls),
      "keeper.ts never CALLS drawDecision — the draw is ungated again, which is the 2026-09-01 defect",
    ).toBe(true);
  });

  it("feeds drawDecision the market's own resolvesBy, not a constant", () => {
    // The spec field is the whole point: `resolvesBy` was read by NOTHING in this
    // package before the fix, which is why the draw could not know the question
    // was not answerable yet.
    expect(/resolvesBy[,:]/.test(src), "keeper.ts no longer passes resolvesBy to the schedule").toBe(true);
    expect(src, "keeper.ts no longer reads the MarketSpec that carries resolvesBy").toContain("specRoot");
  });

  it("reads the commit and reveal windows from config rather than hardcoding them", () => {
    // CLAUDE.md: a bound is derived from live state or it is a guess. These two are
    // ConfigRegistry parameters and a deployment may have moved them.
    expect(src).toContain("COMMIT_WINDOW");
    expect(src).toContain("REVEAL_WINDOW");
    const hardcoded = src.match(/(commitWindow|revealWindow)\s*[:=]\s*3_?600\b/);
    expect(hardcoded?.[0], `keeper.ts hardcodes a window: ${hardcoded?.[0]}`).toBeUndefined();
  });

  it("prefers markFailed over Market.fail so no-shows are slashed", () => {
    // `markFailed` alone is too weak: it appears in the ABI and in comments. The
    // load-bearing facts are that a call is built for it, and that the fail branch
    // reaches it through `failMarket` rather than going straight to Market.fail().
    expect(src, "keeper.ts builds no markFailed call").toContain('functionName: "markFailed"');
    expect(
      /failMarket\s*\(/.test(calls),
      "nothing calls failMarket — the fail branch is back to Market.fail(), which strands the round at " +
        "finalized=false and lets its no-show resolvers keep their stake",
    ).toBe(true);
  });
});
