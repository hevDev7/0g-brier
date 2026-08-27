import { describe, expect, it } from 'vitest';
import { WAD, scaleFor, toWad, toTokensFloor, toTokensCeil } from '../src/units';

describe('units', () => {
  it('WAD is 1e18', () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it('scaleFor maps decimals to a wad multiplier', () => {
    expect(scaleFor(6)).toBe(10n ** 12n);
    expect(scaleFor(18)).toBe(1n);
    expect(scaleFor(0)).toBe(10n ** 18n);
  });

  it('scaleFor rejects out-of-range decimals', () => {
    expect(() => scaleFor(19)).toThrow(RangeError);
    expect(() => scaleFor(-1)).toThrow(RangeError);
  });

  it('toWad scales up 6-decimal tokens', () => {
    expect(toWad(1_000_000n, 6)).toBe(WAD);
  });

  it('toTokensFloor rounds down, toTokensCeil rounds up', () => {
    const almostOne = WAD - 1n;
    expect(toTokensFloor(almostOne, 6)).toBe(999_999n);
    expect(toTokensCeil(almostOne, 6)).toBe(1_000_000n);
    expect(toTokensFloor(WAD, 6)).toBe(1_000_000n);
    expect(toTokensCeil(WAD, 6)).toBe(1_000_000n);
  });

  it('toTokensCeil(0) is 0, not 1', () => {
    expect(toTokensCeil(0n, 6)).toBe(0n);
  });

  it('rejects negative values', () => {
    expect(() => toWad(-1n, 6)).toThrow(RangeError);
    expect(() => toTokensFloor(-1n, 6)).toThrow(RangeError);
  });
});
