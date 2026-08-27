/** Semua matematika DPM memakai wad (1e18). Collateral memakai desimalnya sendiri (6 untuk mUSDC).
 *  Konversi HANYA terjadi di batas token — tidak pernah di tengah perhitungan. */
export const WAD = 10n ** 18n;

const MAX_DECIMALS = 18;

function assertNonNegative(v: bigint, label: string): void {
  if (v < 0n) throw new RangeError(`${label} tidak boleh negatif: ${v}`);
}

/** Pengali dari satuan token ke wad. 6 desimal → 1e12. */
export function scaleFor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new RangeError(`desimal tidak didukung: ${decimals} (harus bilangan bulat 0..18)`);
  }
  return 10n ** BigInt(MAX_DECIMALS - decimals);
}

export function toWad(tokens: bigint, decimals: number): bigint {
  assertNonNegative(tokens, 'tokens');
  return tokens * scaleFor(decimals);
}

/** Dana KELUAR: selalu dibulatkan ke bawah agar pool tidak pernah kekurangan. */
export function toTokensFloor(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  return wad / scaleFor(decimals);
}

/** Dana MASUK: selalu dibulatkan ke atas agar pool tidak pernah kekurangan. */
export function toTokensCeil(wad: bigint, decimals: number): bigint {
  assertNonNegative(wad, 'wad');
  const s = scaleFor(decimals);
  return (wad + s - 1n) / s;
}
