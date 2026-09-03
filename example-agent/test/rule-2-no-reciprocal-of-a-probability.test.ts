/**
 * RULE 2: the payout per winning share is `1/pᵢ`, and never `1/Pᵢ`.
 *
 * CLAUDE.md: "There must be no `1/probability` anywhere in the codebase." It
 * shipped in this project's own spec draft once and was corrected. Both forms
 * produce a plausible multiple, which is what makes it survivable long enough
 * to reach a reader: at P = 59% the payout is 1.30× and `1/P` claims 1.69×, and
 * at P = 10% it is 3.16× against `1/P`'s 10.00×.
 *
 * An example project gets this wrong once and teaches it to everyone who copies
 * it, so the rule is enforced twice here: as arithmetic, showing that the wrong
 * multiple owes more than the pool physically holds, and as a scan of the
 * source, in the shape of `packages/agent-kit/test/network-boundary.test.ts` —
 * because this rule lives at a call site and no type can carry it.
 */
import {describe, expect, it} from "vitest";
import {WAD, dpm, quote} from "@0g-brier/protocol";
import {pct, times} from "../src/config.js";
import {fileNamed, loadSrc, occurrences} from "./source.js";

/** Every division, by its divisor. The rule is about what may appear there. */
const DIVIDED_BY = /\/\s*\(?\s*([A-Za-z_$][\w$.]*(?:\[[^\]]*\])?)/g;

/**
 * Whether a divisor names a probability.
 *
 * `WAD - bookP` is fine and is how Kelly's denominator is written — one minus
 * the probability — so it is the bare name that matters, not whether a
 * probability appears in the expression at all.
 */
function namesAProbability(divisor: string): boolean {
  return /probab/i.test(divisor) || divisor === "P" || divisor === "myP" || divisor === "bookP";
}

/**
 * The single place the wrong answer is written down on purpose.
 *
 * `redeem.ts` prints `1/P` BESIDE the real rate, labelled as the claim the pool
 * cannot honour, so that anyone reading a settlement report can see the two
 * multiples next to each other. It is the only exception, it is stripped by
 * text before the scan below runs, and the scan then holds every other
 * occurrence to zero — including the correct line in the very same
 * `console.log`, which is what a lazier allowlist would have let through.
 */
const COUNTEREXAMPLE = /1\/P would claim \$\{times\(\(\s*WAD\s*\*\s*WAD\s*\)\s*\/\s*probability\s*\)\}/g;

describe("rule 2 — what the two multiples actually pay", () => {
  // q chosen so the book quotes the exact figures CLAUDE.md names.
  const at59 = [10_000n * WAD, 11_997n * WAD] as const;
  const at10 = [30_000n * WAD, 10_000n * WAD] as const;

  it("at P = 59.00% the payout is 1.30× and 1/P claims 1.69×", () => {
    expect(pct(dpm.probability(at59, 1))).toBe("59.00%");
    expect(times(quote.payoutPerShareWad(at59, 1))).toBe("1.3018×");
    expect(times((WAD * WAD) / dpm.probability(at59, 1))).toBe("1.6948×");
  });

  it("at P = 10.00% the payout is 3.16× and 1/P claims 10.00×", () => {
    expect(pct(dpm.probability(at10, 1))).toBe("10.00%");
    expect(times(quote.payoutPerShareWad(at10, 1))).toBe("3.1623×");
    expect(times((WAD * WAD) / dpm.probability(at10, 1))).toBe("10.0000×");
  });

  it("1/p pays out the pool; 1/P owes more than the pool holds", () => {
    // Paying every winning share at 1/pᵢ owes qᵢ · C/qᵢ = C, which IS the pool.
    // Paying at 1/Pᵢ owes qᵢ · C²/qᵢ² = C/pᵢ, and pᵢ < 1 on any live book, so
    // the second is larger than the pool by construction rather than by a
    // fraction somebody measured.
    //
    // The tolerance is DERIVED, per CLAUDE.md's third rule, because the first
    // claim is only the pool up to two floorings: C = cost(q) rounds down and
    // p = ⌊q₁·WAD/C⌋ rounds down again, so p is short by at most one and
    //
    //     owed ≤ q₁·WAD/p < C·(1 + C/(q₁·WAD − C)),
    //
    // which is a function of the live q — about 2·10⁴ wei against a pool of
    // 1.6·10²² at the first book here, and 10⁵ at the second. Nothing about it
    // is a constant, and a guessed one would either pass on 1/P or fail on 1/p
    // depending on the skew.
    for (const q of [at59, at10]) {
      const pool = dpm.costUp(q);
      const dust = (pool * pool) / (q[1] * WAD - pool) + 1n;
      const owedAtOneOverP = (q[1] * quote.payoutPerShareWad(q, 1)) / WAD;
      const owedAtOneOverBigP = (q[1] * ((WAD * WAD) / dpm.probability(q, 1))) / WAD;
      const missedBy = owedAtOneOverP > pool ? owedAtOneOverP - pool : pool - owedAtOneOverP;
      expect(missedBy).toBeLessThanOrEqual(dust);
      // Not dust, and not close to it: 30% of the pool at 59%, 216% at 10%.
      expect(owedAtOneOverBigP - pool).toBeGreaterThan(pool / 4n);
    }
  });
});

describe("rule 2, at the call site — no source file divides by a probability", () => {
  const files = loadSrc();

  it("scans the source it means to scan", () => {
    // A scanner that finds nothing passes every assertion below it for free.
    expect(files.map((f) => f.name)).toEqual(["agent.ts", "config.ts", "redeem.ts", "strategy.ts"]);
    for (const file of files) {
      expect(file.code, `src/${file.name} has no code left after comment blanking`).toContain("export");
    }
    // And the scan can see a division at all: `redeem.ts` contains several.
    expect(occurrences(fileNamed(files, "redeem.ts").code, DIVIDED_BY).length).toBeGreaterThan(2);
  });

  it("not even the counterexample survives — the count is zero everywhere", () => {
    // This assertion used to allow exactly one occurrence, in redeem.ts, where a
    // live `1/P` was computed so it could be printed beside the correct `1/p` and
    // labelled as the wrong answer. It was removed, and the allowance with it.
    //
    // CLAUDE.md's wording is absolute — "There must be no `1/probability` anywhere
    // in the codebase" — and a divide-by-probability written to be printed as a
    // warning is still the first thing a repo-wide scan trips on, indistinguishable
    // at a glance from the defect it warns about. The teaching survives as prose
    // and constants in redeem.ts: at P = 59% the payout is 1.30x where 1/P claims
    // 1.69x, and at P = 10% it is 3.16x against 1/P's 10.0x.
    for (const file of files) {
      expect(
        occurrences(file.code, COUNTEREXAMPLE).length,
        `src/${file.name}: no file may divide by a probability, counterexamples included`,
      ).toBe(0);
    }
  });

  it("nothing else anywhere divides by a probability", () => {
    for (const file of files) {
      const scanned = file.code.replace(COUNTEREXAMPLE, "");
      for (const hit of occurrences(scanned, DIVIDED_BY)) {
        const divisor = hit.groups[0] ?? "";
        expect(
          namesAProbability(divisor),
          `src/${file.name}:${hit.line} divides by ${divisor} — the payout per winning share ` +
            `is 1/pᵢ, and 1/Pᵢ is 30% high at ordinary skew: ${hit.statement}`,
        ).toBe(false);
      }
    }
  });

  it("redeem.ts still prints the rate it pays as 1/p, taken from the marginal price", () => {
    // The positive half. Without it, deleting the correct line would leave the
    // scan above perfectly happy: nothing would divide by a probability because
    // nothing would divide by anything.
    const redeem = fileNamed(files, "redeem.ts");
    expect(redeem.code).toMatch(/times\(\(WAD \* WAD\) \/ price\)/);
    expect(redeem.code).toMatch(/const price = market\.marginalPriceWad\[/);
  });

  it("agent.ts computes no payout at all — it reads the SDK's", () => {
    // Rule 2 and rule 3 meet here: the payout an order will actually be paid at
    // is the post-trade one, so the loop reads `payoutPerShareAfterWad` from the
    // preview instead of deriving anything from a price it holds.
    const agent = fileNamed(files, "agent.ts");
    expect(agent.code).toContain("preview.payoutPerShareAfterWad");
    expect(agent.code, "agent.ts has started computing a reciprocal of its own").not.toMatch(/WAD\s*\*\s*WAD/);
  });
});
