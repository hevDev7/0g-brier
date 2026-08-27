import {describe, expect, it, vi} from "vitest";
import {SpecRootMismatchError, SpecStore, zgMerkleRoot} from "@/lib/data/zg-storage";

/**
 * Byte i is `(i * 37 + 11) mod 256`. A one-line pattern rather than a blob, so
 * the vectors below carry no hidden state and anyone can regenerate them
 * against the reference SDK.
 */
const bytesOf = (n: number) => Uint8Array.from({length: n}, (_, i) => (i * 37 + 11) & 0xff);

/**
 * Generated with `@0gfoundation/0g-storage-ts-sdk@1.2.11`'s own
 * `new MemData(bytes).merkleTree()`.
 *
 * This is the same device that pins `packages/protocol` to the Solidity DPM
 * library: the implementation here is a mirror, and a mirror is only worth
 * having if something fails when it drifts. The sizes straddle every boundary
 * the padding rule has — 16, 32 and 1024 chunks — because a wrong rule agrees
 * with the right one on most inputs and disagrees just past a power of two.
 */
const VECTORS = [
  {size: 1, root: "0xc01911b7b53672791742fb9dcf630c3b6d001487f6f27f41d9018d0901eeb85c"},
  {size: 255, root: "0x5b741b651f4d16b5dddf2254ef561c027206811b3ce372b63e7c62f31adc2196"},
  {size: 256, root: "0x5fe18c6fe729a64cf9a6570ac86303dd45ec8d238c443a688a732a077f374e2d"},
  {size: 257, root: "0x93603545719c989cda4956f815f526162959775493f30e9c503651fc7afcb16f"},
  {size: 512, root: "0x876b82c83791b3614b11bf5abc7f7d0aa4189ddd963f36b3d2347209dcaf50eb"},
  {size: 807, root: "0xb3d000b5c77c58e452997cf8f1c6d51bfb15604a54d4a130543be0657f938a86"},
  {size: 1024, root: "0xf96026e2fea52b21169545a47f92ed2bc8e51dfd7aebf42cdff29a5d73bc14cb"},
  {size: 3840, root: "0x536f04938b51e5710e71052fa510886f118a1404e6e5955432cc8f26d165c440"},
  {size: 4096, root: "0xe7c2511b59465e6753da7ac0d5273fda4156ea4d15486571da7040bf7675182e"},
  {size: 4352, root: "0x5102d446ca915f8cc6398a4a17aa32fe3df83e1151603dd13d3fbe7e1d28519f"},
  {size: 7936, root: "0x1786a66ebde715b94a6c0dcc6ea303bf4be8cb90f997007eda6dddc2f1ad4ae1"},
  {size: 8192, root: "0xd7dc5f8482d90aaaefc418bc1f9325ba57f91ee6441ceb00a6729f8271dfa34b"},
  {size: 8448, root: "0x051fb7cbe888288011d29a8d810cfb5da15d3da35263b17514fbcc39572787cc"},
  {size: 261888, root: "0xab5e68b9308e4af101f4f5a83c594c8f3d84359b37499afe7a43db7214739538"},
  {size: 262144, root: "0x3a445d738066002c09d31be2faf7b9b175208e1563752b4031b56bce94b6688f"},
  {size: 262400, root: "0xd2ae580a7f741af33e2513e0d6ff8c2b61719ac028963680a17150e553baca02"},
  {size: 524288, root: "0x9587dfcc1d8382f9d4e49c3caaa0ffd245219e4bd4c52854c5266e9a91899b77"},
  {size: 300000, root: "0x929d9f89887a0e026be0b764fc44a2d12947adbeae4695fed35ec4b4ebdfd4f7"},
  {size: 700000, root: "0xe6922fa757bc5f292f16bc147db38038b98b690af45a3b1073f3911546a46f90"},
] as const;

/** The document actually uploaded to 0G Storage on Galileo, byte for byte, and
 *  the root the network gave back for it. A live anchor, not a synthetic one. */
const LIVE_SPEC = "{\n  \"version\": 1,\n  \"question\": \"Will the ETH/USD closing price on 2026-09-30 23:59 UTC be above $4,000?\",\n  \"rules\": \"Resolves YES if the Coinbase ETH-USD close at 2026-09-30 23:59:59 UTC is strictly greater than 4000.00 USD. Resolves NO otherwise. Deemed UNRESOLVABLE if Coinbase publishes no ETH-USD candle covering that minute and no listed fallback does either.\",\n  \"category\": \"crypto\",\n  \"sources\": [\n    {\n      \"kind\": \"http\",\n      \"url\": \"https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60\",\n      \"selector\": \"$[0][4]\"\n    }\n  ],\n  \"settlementPrompt\": \"Read the close price from the source. Compare it to 4000.00 USD. Answer YES if strictly greater, NO if not.\",\n  \"tier\": \"VERIFIED\",\n  \"tradingEnd\": 1790000000,\n  \"settlementDeadline\": 1790086400,\n  \"creatorAgentId\": 0\n}";
const LIVE_ROOT = "0x3f1cd7a175fcefa57fb06a4423e6bb251949f45e2ab7d01116c21b0250364dd8" as const;

const INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

/** Takes the url so the assertion below can check WHICH root was asked for. */
const responding = (body: string, status = 200) =>
  vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(body, {status});
  });

describe("zgMerkleRoot", () => {
  it.each(VECTORS)("matches the reference SDK at $size bytes", ({size, root}) => {
    expect(zgMerkleRoot(bytesOf(size))).toBe(root);
  });

  it("reproduces the root of the document that is live on Galileo", () => {
    expect(zgMerkleRoot(new TextEncoder().encode(LIVE_SPEC))).toBe(LIVE_ROOT);
  });

  it("has no root for no bytes", () => {
    expect(zgMerkleRoot(new Uint8Array(0))).toBeNull();
  });

  it("changes when a single byte changes", () => {
    const a = bytesOf(807);
    const b = bytesOf(807);
    b[400] ^= 0x01;
    expect(zgMerkleRoot(b)).not.toBe(zgMerkleRoot(a));
  });
});

describe("SpecStore", () => {
  it("returns the document when its bytes hash to the root asked for", async () => {
    const fetchImpl = responding(LIVE_SPEC);
    const spec = await new SpecStore(INDEXER, fetchImpl).get(LIVE_ROOT);
    expect(spec?.question).toContain("ETH/USD");
    expect(spec?.rules).toContain("Resolves YES");
    expect(spec?.sources[0]?.url).toContain("coinbase");
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${INDEXER}/file?root=${LIVE_ROOT}`);
  });

  it("reports a root the indexer has never seen as absent, not as an error", async () => {
    const store = new SpecStore(INDEXER, responding('{"code":101,"message":"File not found","data":null}'));
    await expect(store.get(LIVE_ROOT)).resolves.toBeNull();
  });

  /**
   * The one case the whole module exists for. A document served under the wrong
   * root is not a missing answer, it is a WRONG one, and the market's claim to
   * immutable rules is exactly what it breaks.
   */
  it("refuses a document that does not hash to the root asked for", async () => {
    const tampered = LIVE_SPEC.replace("above $4,000", "above $9,000");
    const store = new SpecStore(INDEXER, responding(tampered));
    await expect(store.get(LIVE_ROOT)).rejects.toThrow(SpecRootMismatchError);
  });

  it("does not mistake an absent-file envelope for a document", async () => {
    // Valid JSON with a question in it — but it is not the committed bytes, so
    // the hash decides and the envelope check never gets to matter.
    const store = new SpecStore(INDEXER, responding('{"question":"Am I real?","rules":"No."}'));
    await expect(store.get(LIVE_ROOT)).rejects.toThrow(SpecRootMismatchError);
  });

  it("treats an unreachable indexer as an error rather than as an absent spec", async () => {
    const store = new SpecStore(INDEXER, responding("nope", 503));
    await expect(store.get(LIVE_ROOT)).rejects.toThrow(/503/);
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
      await new SpecStore(INDEXER).get(LIVE_ROOT);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).not.toBeInstanceOf(SpecStore);
  });

  it("fetches a root once however often it is asked for", async () => {
    const fetchImpl = responding(LIVE_SPEC);
    const store = new SpecStore(INDEXER, fetchImpl);
    const [a, b, c] = await Promise.all([store.get(LIVE_ROOT), store.get(LIVE_ROOT), store.get(LIVE_ROOT)]);
    expect(await store.get(LIVE_ROOT)).toEqual(a);
    expect(b).toEqual(c);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches an absent root too, so a market with no spec is not re-fetched per render", async () => {
    const fetchImpl = responding('{"code":101,"message":"File not found","data":null}');
    const store = new SpecStore(INDEXER, fetchImpl);
    expect(await store.get(LIVE_ROOT)).toBeNull();
    expect(await store.get(LIVE_ROOT)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
