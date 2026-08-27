/** All DPM math uses wad (1e18). Collateral uses its own decimals (6 for mUSDC).
 *  Conversion happens ONLY at the token boundary — never in the middle of a calculation. */
export const WAD = 10n ** 18n;

const MAX_DECIMALS = 18;

function assertNonNegative(v: bigint, label: string): void {
  if (v < 0n) throw new RangeError(`${label} must not be negative: ${v}`);
}

/** Multiplier from token units to wad. 6 decimals → 1e12. */
export function scaleFor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`unsupported decimals: ${decimals} (must be an integer 0..18)`);
  }
  return 10n ** BigInt(MAX_DECIMALS - decimals);
}

export function toWad(tokens: bigint, decimals: number): bigint {
  assertNonNegative(tokens, 'tokens');
  return tokens * scaleFor(decimals);
}

/** Funds OUT: always rounded down so the pool is never short. */
export function toTokensFloor(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  return wad / scaleFor(decimals);
}

/** Funds IN: always rounded up so the pool is never short. */
export function toTokensCeil(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  const s = scaleFor(decimals);
  return (wad + s - 1n) / s;
}
