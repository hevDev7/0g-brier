import { describe, expect, it } from 'vitest';
import { WAD, scaleFor, toWad, toTokensFloor, toTokensCeil } from '../src/units';

describe('units', () => {
  it('WAD adalah 1e18', () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it('scaleFor memetakan desimal ke pengali wad', () => {
    expect(scaleFor(6)).toBe(10n ** 12n);
    expect(scaleFor(18)).toBe(1n);
    expect(scaleFor(0)).toBe(10n ** 18n);
  });

  it('scaleFor menolak desimal di luar jangkauan', () => {
    expect(() => scaleFor(19)).toThrow(RangeError);
    expect(() => scaleFor(-1)).toThrow(RangeError);
  });

  it('toWad menaikkan skala token 6 desimal', () => {
    expect(toWad(1_000_000n, 6)).toBe(WAD);
  });

  it('toTokensFloor membulatkan ke bawah, toTokensCeil ke atas', () => {
    const almostOne = WAD - 1n;
    expect(toTokensFloor(almostOne, 6)).toBe(999_999n);
    expect(toTokensCeil(almostOne, 6)).toBe(1_000_000n);
    expect(toTokensFloor(WAD, 6)).toBe(1_000_000n);
    expect(toTokensCeil(WAD, 6)).toBe(1_000_000n);
  });

  it('toTokensCeil(0) adalah 0, bukan 1', () => {
    expect(toTokensCeil(0n, 6)).toBe(0n);
  });

  it('menolak nilai negatif', () => {
    expect(() => toWad(-1n, 6)).toThrow(RangeError);
    expect(() => toTokensFloor(-1n, 6)).toThrow(RangeError);
  });
});
