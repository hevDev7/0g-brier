import { WAD } from './units.js';

/** Cermin persis dari contracts/src/math/DPMMath.sol. Setiap perubahan di satu sisi
 *  harus diikuti sisi lain — uji diferensial di contracts/test/differential menegakkannya. */
export const MAX_Q = 10n ** 33n;

export type Q = readonly [bigint, bigint];
export type Outcome = 0 | 1;

/** Akar kuadrat integer (floor). Tebakan awal 2^ceil(bits/2) selalu ≥ √n,
 *  sehingga iterasi Newton turun secara monoton dan berhenti tepat. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt: nilai negatif');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

function sumSq(q: Q): bigint {
  if (q[0] > MAX_Q || q[1] > MAX_Q) {
    throw new RangeError(`q melampaui MAX_Q (${MAX_Q}): [${q[0]}, ${q[1]}]`);
  }
  return q[0] * q[0] + q[1] * q[1];
}

export function cost(q: Q): bigint {
  return isqrt(sumSq(q));
}

export function costUp(q: Q): bigint {
  return isqrtCeil(sumSq(q));
}

export function price(q: Q, i: Outcome): bigint {
  const c = cost(q);
  return c === 0n ? 0n : (q[i] * WAD) / c;
}

export function probability(q: Q, i: Outcome): bigint {
  const s = sumSq(q);
  return s === 0n ? 0n : (q[i] * q[i] * WAD) / s;
}

export function sharesForSpend(q: Q, i: Outcome, spendWad: bigint): bigint {
  if (spendWad <= 0n) throw new RangeError('sharesForSpend: spend harus > 0');
  const j: Outcome = i === 0 ? 1 : 0;
  const c1 = costUp(q) + spendWad;
  if (c1 > MAX_Q) throw new RangeError(`C1 melampaui MAX_Q: ${c1}`);
  const inner = c1 * c1 - q[j] * q[j];
  const newQi = isqrt(inner);
  if (newQi <= q[i]) throw new RangeError('sharesForSpend: spend terlalu kecil untuk satu lembar pun');
  return newQi - q[i];
}

export function seedShares(seedWad: bigint): bigint {
  if (seedWad > MAX_Q) throw new RangeError(`seedWad melampaui MAX_Q: ${seedWad}`);
  return isqrt((seedWad * seedWad) / 2n);
}
