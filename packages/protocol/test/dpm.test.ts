import { describe, expect, it } from 'vitest';
import { WAD } from '../src/units';
import { cost, costUp, isqrt, isqrtCeil, price, probability, seedShares, sharesForSpend, MAX_Q } from '../src/dpm';

const E18 = WAD;

describe('isqrt', () => {
  it('computes the floor and ceil root', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(2n)).toBe(1n);
    expect(isqrtCeil(2n)).toBe(2n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrtCeil(4n)).toBe(2n);
    expect(isqrt(10n ** 66n)).toBe(10n ** 33n);
  });
});

describe('DPM mirror — golden values computed by hand', () => {
  it('the 3-4-5 triangle is exact, and ceil adds nothing', () => {
    expect(cost([3n * E18, 4n * E18])).toBe(5n * E18);
    expect(costUp([3n * E18, 4n * E18])).toBe(5n * E18);
  });

  it('a balanced market costs q√2', () => {
    expect(cost([E18, E18])).toBe(1_414_213_562_373_095_048n);
    expect(costUp([E18, E18])).toBe(1_414_213_562_373_095_049n);
  });

  it('marginal prices on 3-4-5 are 0.6 and 0.8', () => {
    expect(price([3n * E18, 4n * E18], 0)).toBe(600_000_000_000_000_000n);
    expect(price([3n * E18, 4n * E18], 1)).toBe(800_000_000_000_000_000n);
  });

  it('probability is the square of price, and the two sum to one', () => {
    const q: readonly [bigint, bigint] = [3n * E18, 4n * E18];
    expect(probability(q, 0)).toBe(360_000_000_000_000_000n);
    expect(probability(q, 1)).toBe(640_000_000_000_000_000n);
    expect(probability(q, 0) + probability(q, 1)).toBe(WAD);
  });

  it('does not overflow at MAX_Q', () => {
    expect(probability([MAX_Q, MAX_Q], 0)).toBe(WAD / 2n);
  });

  it('sharesForSpend uses the closed form', () => {
    expect(sharesForSpend([0n, 3n * E18], 0, 2n * E18)).toBe(4n * E18);
    expect(sharesForSpend([5n * E18, 12n * E18], 0, 2n * E18)).toBe(4n * E18);
  });

  it('rejects q above MAX_Q', () => {
    expect(() => cost([MAX_Q + 1n, 0n])).toThrow(/MAX_Q/);
  });
});

describe('seedShares', () => {
  it('never costs more than was deposited, and is maximal', () => {
    for (const w of [1n, 1000n, E18, 1000n * E18, 10n ** 30n]) {
      const s = seedShares(w);
      expect(costUp([s, s])).toBeLessThanOrEqual(w);
      expect(costUp([s + 1n, s + 1n])).toBeGreaterThan(w);
    }
  });

  it('a market starts at exactly 50%', () => {
    const s = seedShares(1000n * E18);
    expect(probability([s, s], 0)).toBe(E18 / 2n);
  });
});
