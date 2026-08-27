import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cost, costUp, price, probability, seedShares, MAX_Q, type Q } from '../src/dpm';

const OUT = join(process.cwd(), '../../contracts/test/vectors/dpm.json');
const COUNT = 512;

/** Deterministic xorshift64 — the vectors must be identical on every machine and every
 *  run, so that `gen:vectors` re-run in CI does not produce a diff. */
function makeRng(seed: bigint): () => bigint {
  const MASK = (1n << 64n) - 1n;
  let s = seed;
  return () => {
    s = (s ^ (s << 13n)) & MASK;
    s = s ^ (s >> 7n);
    s = (s ^ (s << 17n)) & MASK;
    return s;
  };
}

/** Composes two 64-bit draws into a 128-bit value. rng() alone is limited to
 *  [0, 2^64) ≈ 1.845e19 — smaller than the modulus of the "large" bucket (1e24)
 *  and the "near-MAX_Q" bucket (1e33), so `rng() % modulus` for both would become
 *  a no-op without this (modulus > value space means the modulo operation never
 *  cuts anything off). Explicit temporaries (hi, lo) so the order of rng() calls
 *  is not ambiguous to the reader. */
function rng128(rng: () => bigint): bigint {
  const hi = rng();
  const lo = rng();
  return (hi << 64n) | lo;
}

/** Spread across magnitudes: zero, dust, wad scale, large, and exactly at MAX_Q. */
function sample(rng: () => bigint, bucket: number): bigint {
  switch (bucket % 6) {
    case 0: return 0n;
    case 1: return rng() % 1_000_000n;
    case 2: return rng() % (10n ** 18n);
    case 3: return rng128(rng) % (10n ** 24n);
    case 4: return rng128(rng) % (10n ** 33n);
    default: return MAX_Q;
  }
}

const rng = makeRng(0x0de1_9105_eed0_1234n);
const q0: string[] = [];
const q1: string[] = [];
const cst: string[] = [];
const cstUp: string[] = [];
const price0: string[] = [];
const prob0: string[] = [];
const seed: string[] = [];

const hex = (v: bigint) => `0x${v.toString(16)}`;

/** Cases 0..35 explicitly cover all 36 bucket pairs (including (MAX_Q, MAX_Q),
 *  which the offset-3 scheme below can NEVER reach — bucket i is always paired
 *  with bucket (i+3)%6, so the two legs are never both in the highest tier).
 *  Cases 36.. use the original offset-3 scheme for the remaining random samples. */
for (let k = 0; k < COUNT; k++) {
  const bucketA = k < 36 ? Math.floor(k / 6) : k % 6;
  const bucketB = k < 36 ? k % 6 : k + 3;
  const a = sample(rng, bucketA);
  const b = sample(rng, bucketB);
  const q: Q = [a, b];
  q0.push(hex(a));
  q1.push(hex(b));
  cst.push(hex(cost(q)));
  cstUp.push(hex(costUp(q)));
  price0.push(hex(price(q, 0)));
  prob0.push(hex(probability(q, 0)));
  seed.push(hex(seedShares(a)));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ q0, q1, cost: cst, costUp: cstUp, price0, prob0, seed }, null, 2)}\n`);
console.log(`wrote ${COUNT} vectors to ${OUT}`);
