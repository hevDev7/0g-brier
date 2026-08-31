import {describe, expect, it, vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {SpecRootMismatchError, ZgStore} from "@/lib/data/zg-storage";

/**
 * The document actually uploaded to 0G Storage on Galileo, byte for byte, and
 * the root the network gave back for it.
 *
 * The Merkle arithmetic that proves the pairing is pinned by 19 SDK vectors in
 * `@0g-brier/zg-storage`, which is where it now lives. What this file still
 * owns is the step after the proof: turning verified bytes into the shapes this
 * application renders.
 */
const LIVE_SPEC = "{\n  \"version\": 1,\n  \"question\": \"Will the ETH/USD closing price on 2026-09-30 23:59 UTC be above $4,000?\",\n  \"rules\": \"Resolves YES if the Coinbase ETH-USD close at 2026-09-30 23:59:59 UTC is strictly greater than 4000.00 USD. Resolves NO otherwise. Deemed UNRESOLVABLE if Coinbase publishes no ETH-USD candle covering that minute and no listed fallback does either.\",\n  \"category\": \"crypto\",\n  \"sources\": [\n    {\n      \"kind\": \"http\",\n      \"url\": \"https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60\",\n      \"selector\": \"$[0][4]\"\n    }\n  ],\n  \"settlementPrompt\": \"Read the close price from the source. Compare it to 4000.00 USD. Answer YES if strictly greater, NO if not.\",\n  \"tier\": \"VERIFIED\",\n  \"tradingEnd\": 1790000000,\n  \"settlementDeadline\": 1790086400,\n  \"creatorAgentId\": 0\n}";
const LIVE_ROOT = "0x3f1cd7a175fcefa57fb06a4423e6bb251949f45e2ab7d01116c21b0250364dd8" as const;

const INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

/** Takes the url so the assertion below can check WHICH root was asked for. */
const responding = (body: string, status = 200) =>
  vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(body, {status});
  });

describe("the documents behind a verified root", () => {
  it("returns the document when its bytes hash to the root asked for", async () => {
    const fetchImpl = responding(LIVE_SPEC);
    const spec = await new ZgStore(INDEXER, fetchImpl).getSpec(LIVE_ROOT);
    expect(spec?.question).toContain("ETH/USD");
    expect(spec?.rules).toContain("Resolves YES");
    expect(spec?.sources[0]?.url).toContain("coinbase");
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${INDEXER}/file?root=${LIVE_ROOT}`);
  });

  it("reports a root the indexer has never seen as absent, not as an error", async () => {
    const store = new ZgStore(INDEXER, responding('{"code":101,"message":"File not found","data":null}'));
    await expect(store.getSpec(LIVE_ROOT)).resolves.toBeNull();
  });

  /**
   * The one case the whole module exists for. A document served under the wrong
   * root is not a missing answer, it is a WRONG one, and the market's claim to
   * immutable rules is exactly what it breaks.
   */
  it("refuses a document that does not hash to the root asked for", async () => {
    const tampered = LIVE_SPEC.replace("above $4,000", "above $9,000");
    const store = new ZgStore(INDEXER, responding(tampered));
    await expect(store.getSpec(LIVE_ROOT)).rejects.toThrow(SpecRootMismatchError);
  });

  it("does not mistake an absent-file envelope for a document", async () => {
    // Valid JSON with a question in it — but it is not the committed bytes, so
    // the hash decides and the envelope check never gets to matter.
    const store = new ZgStore(INDEXER, responding('{"question":"Am I real?","rules":"No."}'));
    await expect(store.getSpec(LIVE_ROOT)).rejects.toThrow(SpecRootMismatchError);
  });

  it("treats an unreachable indexer as an error rather than as an absent spec", async () => {
    const store = new ZgStore(INDEXER, responding("nope", 503));
    await expect(store.getSpec(LIVE_ROOT)).rejects.toThrow(/503/);
  });

  /**
   * The browser's `fetch` is a method of `window` and throws "Illegal
   * invocation" if `this` is anything else. Holding it on an instance and
   * calling `this.fetchImpl(...)` did exactly that, and the test runner's fetch
   * is indifferent to its receiver — so the whole file passed while the first
   * real page load failed. Asserting the RECEIVER is the only thing here that
   * would have caught it.
   */
  it("calls the global fetch with the global as its receiver, not the store", async () => {
    const receivers: unknown[] = [];
    vi.stubGlobal("fetch", function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(LIVE_SPEC));
    });
    try {
      await new ZgStore(INDEXER).getSpec(LIVE_ROOT);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).not.toBeInstanceOf(ZgStore);
  });

  it("fetches a root once however often it is asked for", async () => {
    const fetchImpl = responding(LIVE_SPEC);
    const store = new ZgStore(INDEXER, fetchImpl);
    const [a, b, c] = await Promise.all([store.getSpec(LIVE_ROOT), store.getSpec(LIVE_ROOT), store.getSpec(LIVE_ROOT)]);
    expect(await store.getSpec(LIVE_ROOT)).toEqual(a);
    expect(b).toEqual(c);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches an absent root too, so a market with no spec is not re-fetched per render", async () => {
    const fetchImpl = responding('{"code":101,"message":"File not found","data":null}');
    const store = new ZgStore(INDEXER, fetchImpl);
    expect(await store.getSpec(LIVE_ROOT)).toBeNull();
    expect(await store.getSpec(LIVE_ROOT)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/**
 * The producers, checked against the reader.
 *
 * `parseReceipt` returns null when a document has no `rationale`, and a null
 * document reaches the settlement report as "anchored a receipt, but none has a
 * readable document" — a market that looks tampered with when it is only
 * misspelled. That is not hypothetical: `committee-run.mjs` wrote `reasoning`
 * and `sources`, both plausible, neither read, and three roots went on chain
 * pointing at documents the site could not display.
 *
 * A root is permanent. There is no fixing a receipt after it is anchored, so the
 * key names have to be right the first time — which makes this worth a test that
 * fails in CI rather than a convention nobody can check.
 */
describe("what writes a receipt and what reads one", () => {
  const ROOT = join(__dirname, "..", "..");
  const WRITERS = ["scripts/committee-run.mjs", "packages/agent-kit/examples/resolve.ts"];

  it.each(WRITERS)("%s names the keys the reader requires", (path) => {
    const src = readFileSync(join(ROOT, path), "utf-8");
    // `rationale` is the one the parser hard-requires; the others decide whether
    // the panel has anything to show once it renders.
    expect(src, "the key parseReceipt refuses a document without").toMatch(/\brationale:/);
    expect(src, "outcome, or the report cannot state one").toMatch(/\boutcome:/);
    expect(src, "evidence[], which is where the sources are read from").toMatch(/\bevidence:/);
    // The near-misses that caused this. Named explicitly so the failure message
    // says what is wrong rather than only that something is.
    expect(src, "`reasoning` is not read — the key is `rationale`").not.toMatch(/\breasoning:/);
    expect(src, "`sources` is not read — the key is `evidence`").not.toMatch(/^\s*sources:/m);
  });
});
