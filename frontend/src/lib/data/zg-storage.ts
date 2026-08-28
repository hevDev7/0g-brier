import {concatHex, keccak256, type Hex} from "viem";
import type {Outcome, ResolverVote, SettlementReceipt, SpecSource} from "./types";

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
  const queue: Hex[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    if (i === leaves.length - 1) queue.push(leaves[i]);
    else queue.push(keccak256(concatHex([leaves[i], leaves[i + 1]])));
  }
  while (queue.length > 1) {
    const n = queue.length;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const [left, right] = queue.splice(0, 2);
      queue.push(keccak256(concatHex([left, right])));
    }
    if (n % 2 === 1) queue.push(queue.shift()!);
  }
  return queue[0];
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
 * The document a market's `specRoot` commits to.
 *
 * Only the fields the CHAIN cannot answer are read from here. `category`,
 * `tier`, `tradingEnd` and `settlementDeadline` are also in the document, but
 * the on-chain values are the ones that bind, so the UI takes those and ignores
 * these — a document that disagrees with its own market must not be able to
 * change what the market is by saying so.
 */
export type {SpecSource};

export interface MarketSpec {
  version: number;
  question: string;
  rules: string;
  sources: readonly SpecSource[];
  settlementPrompt: string | null;
}

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function parseSpec(json: unknown): MarketSpec | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const question = asString(o.question);
  const rules = asString(o.rules);
  // A document that verified against the root but carries no question is the
  // creator's doing, not a fault here — and there is still nothing to show, so
  // it lands in the same place as a document that was never uploaded.
  if (question === null || rules === null) return null;
  const sources = Array.isArray(o.sources)
    ? o.sources.flatMap((s): SpecSource[] => {
        if (typeof s !== "object" || s === null) return [];
        const e = s as Record<string, unknown>;
        const url = asString(e.url);
        if (url === null) return [];
        return [{kind: asString(e.kind) ?? "http", url, selector: asString(e.selector)}];
      })
    : [];
  return {
    version: typeof o.version === "number" ? o.version : 1,
    question,
    rules,
    sources,
    settlementPrompt: asString(o.settlementPrompt),
  };
}

/**
 * A settlement receipt (spec §7.5) as the UI needs it.
 *
 * The document's own shape is the resolver's; this maps it onto the fields the
 * report renders, and refuses to invent the ones it does not carry:
 *
 * - `votes` is EMPTY when no model was consulted. Not one entry with a blank
 *   name — an empty committee and a committee whose member has no name are
 *   different facts, and only the first is true of a receipt with `route:
 *   "none"`.
 * - `criteria` stays null unless the RESOLVER stated some. The market's promised
 *   criteria are in its MarketSpec and are shown separately; copying them in
 *   here would make the report agree with itself by construction.
 * - `simulated` defaults to TRUE when the document does not say. A receipt that
 *   forgot to declare itself real must not be read as real.
 */
function parseReceipt(json: unknown): SettlementReceipt | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const inference = (typeof o.inference === "object" && o.inference !== null ? o.inference : {}) as Record<
    string,
    unknown
  >;

  const outcome = o.outcome === "YES" ? 1 : o.outcome === "NO" ? 0 : null;
  const reasoning = asString(o.rationale);
  // A receipt with no rationale explains nothing, and the panel's whole promise
  // is that the reasoning is there to read verbatim.
  if (reasoning === null) return null;

  const model = asString(inference.model);
  const teeVerified = inference.teeVerified === true;
  const simulated = inference.simulated !== false;
  const votes: ResolverVote[] =
    model === null ? [] : [{model, outcome: outcome as Outcome | null, teeVerified, simulated}];

  const sources = Array.isArray(o.evidence)
    ? o.evidence.flatMap((e): string[] => {
        if (typeof e !== "object" || e === null) return [];
        const url = asString((e as Record<string, unknown>).url);
        return url === null ? [] : [url];
      })
    : [];

  const provider = asString(inference.providerAddress);
  return {
    outcome: outcome as Outcome | null,
    votes,
    judgeModel: model,
    reasoning,
    criteria: asString(o.criteria),
    sources,
    provider: (provider !== null && /^0x[0-9a-fA-F]{40}$/.test(provider)
      ? provider
      : "0x0000000000000000000000000000000000000000") as `0x${string}`,
    chatId: asString(inference.chatID),
    simulated,
  };
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

  /** The MarketSpec behind a `specRoot`, or `null` if there is nothing readable there. */
  async getSpec(root: Hex): Promise<MarketSpec | null> {
    return parseSpec(await this.get(root));
  }

  /** The settlement receipt behind an anchored root, or `null` if unreadable. */
  async getReceipt(root: Hex): Promise<SettlementReceipt | null> {
    return parseReceipt(await this.get(root));
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
