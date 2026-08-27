import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cost, costUp, price, probability, seedShares, MAX_Q, type Q } from '../src/dpm.js';

const OUT = join(process.cwd(), '../../contracts/test/vectors/dpm.json');
const COUNT = 512;

/** xorshift64 deterministik — vektor harus identik di setiap mesin dan setiap kali,
 *  supaya `gen:vectors` yang dijalankan ulang di CI tidak menghasilkan diff. */
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

/** Komposisi dua tarikan 64-bit menjadi nilai 128-bit. rng() sendiri terbatas pada
 *  [0, 2^64) ≈ 1.845e19 — lebih kecil dari modulus bucket "besar" (1e24) dan
 *  "dekat-MAX_Q" (1e33), sehingga `rng() % modulus` untuk keduanya jadi no-op tanpa ini
 *  (modulus > ruang nilai berarti operasi modulo tidak pernah memotong apa pun).
 *  Temporer eksplisit (hi, lo) supaya urutan pemanggilan rng() tidak ambigu bagi pembaca. */
function rng128(rng: () => bigint): bigint {
  const hi = rng();
  const lo = rng();
  return (hi << 64n) | lo;
}

/** Sebaran lintas magnitudo: nol, debu, skala wad, besar, dan tepat di MAX_Q. */
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

/** Kasus 0..35 menjangkau eksplisit seluruh 36 pasangan bucket (termasuk (MAX_Q, MAX_Q),
 *  yang skema offset-3 di bawah TIDAK PERNAH bisa capai — bucket i selalu berpasangan
 *  dengan bucket (i+3)%6, jadi kedua kaki tak pernah sama-sama di tier tertinggi).
 *  Kasus 36.. memakai skema offset-3 semula untuk sisa sampel acak. */
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
console.log(`menulis ${COUNT} vektor ke ${OUT}`);
