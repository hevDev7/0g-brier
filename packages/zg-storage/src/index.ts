import {concatHex, keccak256, type Hex} from "viem";

/**
 * Reading a market's documents out of 0G Storage, and PROVING each is the one it
 * was committed to.
 *
 * Two documents come through here — the MarketSpec behind `specRoot`, and the
 * settlement receipt behind the root `ResolutionModule` anchors. The fetch and
 * the verification are identical for both; only the parsing differs.
 *
 * The chain stores `specRoot` and nothing else. The question and the settlement
 * rules live in a JSON document on 0G Storage whose Merkle root that field is.
 * Fetching the document is easy; the part that matters is that we recompute the
 * root from the bytes we received and compare. Without that step the panel would
 * be showing "whatever the indexer said", while the spec's whole claim is that
 * traders and resolvers judge the SAME immutable text.
 *
 * The verification needs no network and no SDK — just keccak256, which viem
 * already brings.
 */

/** 0G Storage splits a file into 256-byte chunks and 1024-chunk segments. */
const CHUNK_BYTES = 256;
const SEGMENT_BYTES = CHUNK_BYTES * 1024;

/** `ceil(total / unit)`, as 0G computes it. */
const splitCount = (total: number, unit: number) => Math.floor((total - 1) / unit) + 1;

const nextPow2 = (n: number) => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

/**
 * How many chunks the file is zero-padded to before hashing.
 *
 * Not simply the next power of two: above 16 chunks 0G rounds up to a multiple
 * of a SIXTEENTH of that power of two, which is far less padding. Getting this
 * wrong produces a root that is wrong only for some sizes, which is why the
 * vectors in the test sweep both sides of 16, 32 and 1024 chunks.
 */
function paddedChunkCount(chunks: number): number {
  const p2 = nextPow2(chunks);
  if (p2 === chunks) return chunks;
  const minChunk = p2 >= 16 ? Math.floor(p2 / 16) : 1;
  return splitCount(chunks, minChunk) * minChunk;
}

/**
 * Fold leaves into a root, in 0G's order.
 *
 * Not the textbook shape: an odd node is carried unchanged to the BACK of the
 * queue rather than duplicated or paired with its neighbour, so the tree is
 * unbalanced in a specific way. Mirroring the sequence exactly is the whole
 * point — a root that is "a" Merkle root of the same bytes is still the wrong
 * number.
 */
function fold(leaves: readonly Hex[]): Hex | null {
  if (leaves.length === 0) return null;
  // Written to satisfy `noUncheckedIndexedAccess` honestly rather than with
  // assertions: every read below is guarded by the shift/splice that produced
  // it, so a missing element is a real bug and not a type-system formality.
  const queue: Hex[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i];
    const right = leaves[i + 1];
    if (left === undefined) break;
    queue.push(right === undefined ? left : keccak256(concatHex([left, right])));
  }
  while (queue.length > 1) {
    const n = queue.length;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const [left, right] = queue.splice(0, 2);
      if (left === undefined || right === undefined) break;
      queue.push(keccak256(concatHex([left, right])));
    }
    if (n % 2 === 1) {
      const carried = queue.shift();
      if (carried !== undefined) queue.push(carried);
    }
  }
  return queue[0] ?? null;
}

const segmentRoot = (segment: Uint8Array): Hex | null => {
  const leaves: Hex[] = [];
  for (let o = 0; o < segment.length; o += CHUNK_BYTES) {
    leaves.push(keccak256(segment.subarray(o, o + CHUNK_BYTES)));
  }
  return fold(leaves);
};

/**
 * The 0G Storage Merkle root of `data` — the same number the upload returns and
 * the same one that goes on chain as `specRoot`.
 *
 * Pinned to the reference implementation by 19 vectors in the test beside this
 * file, generated from `@0gfoundation/0g-storage-ts-sdk`. That SDK is not a
 * dependency here: it needs ethers and a signer, and a page that only reads has
 * no business carrying either.
 */
export function zgMerkleRoot(data: Uint8Array): Hex | null {
  if (data.length === 0) return null;
  const padded = new Uint8Array(paddedChunkCount(splitCount(data.length, CHUNK_BYTES)) * CHUNK_BYTES);
  padded.set(data);
  const leaves: Hex[] = [];
  for (let o = 0; o < padded.length; o += SEGMENT_BYTES) {
    const root = segmentRoot(padded.subarray(o, o + SEGMENT_BYTES));
    if (root === null) return null;
    leaves.push(root);
  }
  return fold(leaves);
}

/** Thrown when the bytes behind a root are not the bytes that root names. */
export class SpecRootMismatchError extends Error {
  constructor(
    readonly expected: Hex,
    readonly actual: Hex | null,
  ) {
    super(`0G Storage returned a document whose root is ${actual ?? "undefined"}, not ${expected}`);
    this.name = "SpecRootMismatchError";
  }
}

/**
 * The indexer's envelope for a root it has never seen: HTTP 200 with a JSON
 * body carrying a non-zero code. It is only ever consulted AFTER verification
 * has already failed, so a real document can never be mistaken for one of these
 * — a document that hashes to the root is the document, whatever it contains.
 */
function isAbsentEnvelope(text: string): boolean {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) return false;
    const e = body as Record<string, unknown>;
    return typeof e.code === "number" && e.code !== 0 && typeof e.message === "string";
  } catch {
    return false;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Fetches documents by root, verifies them, and caches them.
 *
 * Caching is unconditionally safe here in a way it almost never is: the key IS
 * the hash of the value. A root cannot come to mean different bytes later, so
 * there is no staleness to reason about and no invalidation to get wrong.
 */
export class ZgStore {
  private readonly indexerUrl: string;
  private readonly cache = new Map<Hex, unknown>();
  private readonly inflight = new Map<Hex, Promise<unknown>>();
  private readonly fetchImpl: typeof fetch;

  constructor(indexerUrl: string, fetchImpl?: typeof fetch) {
    this.indexerUrl = indexerUrl;
    // `fetch` is a METHOD of the global object in a browser, and throws
    // "Illegal invocation" when called with any other receiver — which is what
    // `private readonly fetchImpl = fetch` plus `this.fetchImpl(…)` does. The
    // test runner's fetch does not care about its receiver, so this passed 35
    // tests and failed on the first real page load. Wrapped rather than bound,
    // which also means a test that replaces the global is still honoured.
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * The verified document at `root`, parsed as JSON, or `null` when there is
   * genuinely nothing there — the root was never uploaded.
   *
   * THROWS on a root mismatch and on an unreachable indexer. Both are wrong
   * answers rather than absent ones, and the difference matters on screen: an
   * absent document is honestly reported as "not available", whereas silently
   * showing that for one that failed verification would turn a tampered or
   * broken read into a shrug.
   */
  async get(root: Hex): Promise<unknown> {
    // Keyed lowercase because the comparison in `load` is: two spellings of one
    // root are one document, and caching them apart would fetch it twice.
    const key = root.toLowerCase() as Hex;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const running = this.inflight.get(key);
    if (running) return running;

    const task = this.load(root)
      .then((doc) => {
        this.cache.set(key, doc);
        return doc;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async load(root: Hex): Promise<unknown> {
    const url = `${this.indexerUrl.replace(/\/+$/, "")}/file?root=${root}`;
    const res = await this.fetchImpl(url, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    if (!res.ok) {
      throw new Error(`0G Storage indexer answered ${res.status} for ${root}`);
    }
    const text = await res.text();
    const bytes = new TextEncoder().encode(text);
    const actual = zgMerkleRoot(bytes);
    if (actual === null || actual.toLowerCase() !== root.toLowerCase()) {
      if (isAbsentEnvelope(text)) return null;
      throw new SpecRootMismatchError(root, actual);
    }
    try {
      return JSON.parse(text);
    } catch {
      // Verified bytes that are not JSON. The creator stored something else at
      // this root; there is nothing here to render, and nothing was tampered with.
      return null;
    }
  }
}
