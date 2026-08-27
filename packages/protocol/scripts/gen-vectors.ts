import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cost, costUp, price, probability, MAX_Q, type Q } from '../src/dpm.js';

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

/** Sebaran lintas magnitudo: nol, debu, skala wad, besar, dan tepat di MAX_Q. */
function sample(rng: () => bigint, bucket: number): bigint {
  switch (bucket % 6) {
    case 0: return 0n;
    case 1: return rng() % 1_000_000n;
    case 2: return rng() % (10n ** 18n);
    case 3: return rng() % (10n ** 24n);
    case 4: return rng() % (10n ** 33n);
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

const hex = (v: bigint) => `0x${v.toString(16)}`;

for (let k = 0; k < COUNT; k++) {
  const a = sample(rng, k);
  const b = sample(rng, k + 3);
  const q: Q = [a, b];
  q0.push(hex(a));
  q1.push(hex(b));
  cst.push(hex(cost(q)));
  cstUp.push(hex(costUp(q)));
  price0.push(hex(price(q, 0)));
  prob0.push(hex(probability(q, 0)));
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ q0, q1, cost: cst, costUp: cstUp, price0, prob0 }, null, 2)}\n`);
console.log(`menulis ${COUNT} vektor ke ${OUT}`);
