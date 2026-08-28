import {afterEach, describe, expect, it, vi} from "vitest";
import {custom, decodeFunctionData, encodeFunctionResult, type Transport} from "viem";
import {ChainSource} from "@/lib/data/chain";
import {CONFIG_ABI, RESOLUTION_ABI} from "@/lib/data/abi";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI} from "@/lib/data/abi";
import {SpecRootMismatchError} from "@/lib/data/zg-storage";

/**
 * `question` and `rules` stop being `null` once a 0G Storage indexer is
 * configured. This file covers the seam between the chain and that document —
 * the storage arithmetic itself is pinned in `zg-storage.test.ts`.
 *
 * The document and its root are the real ones from Galileo, so a change that
 * broke the round trip could not be papered over by choosing friendlier bytes.
 */

const FACTORY = "0xfacadefacadefacadefacadefacadefacadefac0" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

const LIVE_SPEC = "{\n  \"version\": 1,\n  \"question\": \"Will the ETH/USD closing price on 2026-09-30 23:59 UTC be above $4,000?\",\n  \"rules\": \"Resolves YES if the Coinbase ETH-USD close at 2026-09-30 23:59:59 UTC is strictly greater than 4000.00 USD. Resolves NO otherwise. Deemed UNRESOLVABLE if Coinbase publishes no ETH-USD candle covering that minute and no listed fallback does either.\",\n  \"category\": \"crypto\",\n  \"sources\": [\n    {\n      \"kind\": \"http\",\n      \"url\": \"https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60\",\n      \"selector\": \"$[0][4]\"\n    }\n  ],\n  \"settlementPrompt\": \"Read the close price from the source. Compare it to 4000.00 USD. Answer YES if strictly greater, NO if not.\",\n  \"tier\": \"VERIFIED\",\n  \"tradingEnd\": 1790000000,\n  \"settlementDeadline\": 1790086400,\n  \"creatorAgentId\": 0\n}";
const LIVE_ROOT = "0x3f1cd7a175fcefa57fb06a4423e6bb251949f45e2ab7d01116c21b0250364dd8" as const;

/** The receipt actually anchored on Galileo, byte for byte. */
const LIVE_RECEIPT = "{\n  \"version\": 1,\n  \"market\": \"0xBA49bA43311c96bE3D5D48Ba57EfC21191E8f178\",\n  \"specRoot\": \"0x4df6b47a3f8176f4e3aadeafb2287b6bca45601dfecfca9796d1b1dffc5cf692\",\n  \"resolver\": {\n    \"agentId\": 0,\n    \"address\": \"0x71a89a7e692dAC4d6BD7c3f1cCa9155592d87BaE\"\n  },\n  \"inference\": {\n    \"route\": \"none\",\n    \"providerAddress\": \"0x0000000000000000000000000000000000000000\",\n    \"model\": null,\n    \"chatID\": null,\n    \"teeVerified\": false,\n    \"temperature\": 0,\n    \"simulated\": true\n  },\n  \"evidence\": [\n    {\n      \"kind\": \"chain\",\n      \"url\": \"https://chainscan-galileo.0g.ai/address/0xBA49bA43311c96bE3D5D48Ba57EfC21191E8f178\",\n      \"fetchedAt\": 1787877188,\n      \"note\": \"The market's own Settled event is the only record consulted.\"\n    }\n  ],\n  \"outcome\": \"YES\",\n  \"confidence\": null,\n  \"rationale\": \"No resolver committee ran, and no model was consulted. This market was settled by scripts/e2e-market.sh, which drives the full lifecycle against a live chain to prove the contracts behave \u2014 create, buy, sell, close, settle, redeem \u2014 and settles YES unconditionally so that the redeem path is exercised. The outcome recorded here is therefore a property of that test, not a judgement about the world. It is anchored on chain anyway, because a settlement whose evidence is missing and a settlement whose evidence says 'none was gathered' are different things, and only the second can be checked.\",\n  \"citations\": [\n    0\n  ],\n  \"rawResponse\": null\n}";

function stubChain(specRoot: `0x${string}`): Transport {
  const answers: Record<string, unknown> = {
    marketCount: 1n,
    marketAt: MARKET,
    qArray: [1000n * 10n ** 18n, 1200n * 10n ** 18n],
    poolWad: 1562049935181330879n,
    status: 0,
    tier: 1,
    category: `0x${Buffer.from("crypto").toString("hex").padEnd(64, "0")}`,
    tradingEnd: 1790000000n,
    settlementDeadline: 1790086400n,
    collateral: TOKEN,
    // 0 is a legitimate winner ("NO"), so an unresolved market is distinguished
    // by resolvedAt being 0, not by the outcome.
    winningOutcome: 0,
    resolvedAt: 0n,
    creator: "0xaaaaaaaa00000000000000000000000000000001",
    specRoot,
    feeBps: 100,
    symbol: "mUSDC",
    decimals: 6,
  };
  return custom({
    request: async ({method, params}) => {
      if (method !== "eth_call") throw new Error(`unexpected RPC ${method}`);
      const {to, data} = (params as [{to: `0x${string}`; data: `0x${string}`}])[0];
      const abi = to.toLowerCase() === FACTORY.toLowerCase()
        ? FACTORY_ABI
        : to.toLowerCase() === TOKEN.toLowerCase()
          ? ERC20_ABI
          : MARKET_ABI;
      const {functionName} = decodeFunctionData({abi, data});
      if (!(functionName in answers)) throw new Error(`stub has no answer for ${functionName}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the ABI is chosen at runtime
      return encodeFunctionResult({abi, functionName, result: answers[functionName]} as any);
    },
  });
}

function stubStorage(body: string, status = 200) {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(body, {status});
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

const source = (opts: {indexer?: string; specRoot?: `0x${string}`} = {}) =>
  new ChainSource({
    rpcUrl: "http://stub",
    chainId: 16602,
    factory: FACTORY,
    transport: stubChain(opts.specRoot ?? LIVE_ROOT),
    zgIndexerUrl: opts.indexer,
  });

afterEach(() => vi.unstubAllGlobals());

describe("a market's question, read from 0G Storage", () => {
  it("is not claimed at all when no storage indexer is configured", async () => {
    const s = source();
    expect(s.capabilities.has("MARKET_SPEC_BLOB")).toBe(false);
    const [row] = await s.listMarkets();
    expect(row.question).toBeNull();
    expect((await s.getMarket(MARKET)).rules).toBeNull();
  });

  it("appears on the list and the detail page when one is", async () => {
    stubStorage(LIVE_SPEC);
    const s = source({indexer: INDEXER});
    expect(s.capabilities.has("MARKET_SPEC_BLOB")).toBe(true);
    const [row] = await s.listMarkets();
    expect(row.question).toContain("ETH/USD");
    const detail = await s.getMarket(MARKET);
    expect(detail.question).toBe(row.question);
    expect(detail.rules).toContain("Resolves YES");
    expect(detail.specRoot).toBe(LIVE_ROOT);
  });

  /**
   * The reason `question` is nullable rather than optional. A market whose
   * document was never uploaded is not an error — the honest row shows the
   * address and says the question is unavailable, exactly as it did before this
   * capability existed.
   */
  it("stays null for a root the storage network has never seen", async () => {
    stubStorage('{"code":101,"message":"File not found","data":null}');
    const [row] = await source({indexer: INDEXER}).listMarkets();
    expect(row.question).toBeNull();
  });

  it("fails loudly when the document served is not the one the market committed to", async () => {
    stubStorage(LIVE_SPEC.replace("above $4,000", "above $9,000"));
    await expect(source({indexer: INDEXER}).listMarkets()).rejects.toThrow(SpecRootMismatchError);
  });

  /**
   * The chain is what binds. The document also carries a category and a tier,
   * and this one says `crypto`/`VERIFIED` — but so does the market, and if they
   * ever disagreed the market would have to win.
   */
  it("takes only the question and rules from the document", async () => {
    stubStorage(LIVE_SPEC);
    const detail = await source({indexer: INDEXER}).getMarket(MARKET);
    expect(detail.category).toBe("crypto");
    expect(detail.tier).toBe("VERIFIED");
    expect(detail.tradingEnd).toBe(1790000000);
  });

  it("reads the document once for a market that appears in a list and then a page", async () => {
    const fetchImpl = stubStorage(LIVE_SPEC);
    const s = source({indexer: INDEXER});
    await s.listMarkets();
    await s.getMarket(MARKET);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/**
 * The settlement receipt, found the way the contract finds it: market → its own
 * ConfigRegistry → RESOLUTION_MODULE → the root anchored for this market. The
 * stub answers each hop, so a wrong hop is a stub miss rather than a silent zero.
 */
describe("a settlement's receipt, read from 0G Storage", () => {
  const MODULE = "0x3333333333333333333333333333333333333333" as const;
  const CONFIG = "0x4444444444444444444444444444444444444444" as const;
  const RECEIPT_ROOT = "0x948db94252d136d6cc9cd5809de69039602b9889ec81fbe61f696a8cf6522c17" as const;

  it("is unavailable, not absent, when no storage endpoint is configured", async () => {
    const s = source();
    expect(s.capabilities.has("SETTLEMENT_RECEIPT")).toBe(false);
    await expect(s.getReceipt(MARKET)).rejects.toMatchObject({capability: "SETTLEMENT_RECEIPT"});
  });

  it("is null — looked, and nothing was anchored — when the root is zero", async () => {
    stubStorage("{}");
    const s = sourceWithModule({module: MODULE, root: `0x${"0".repeat(64)}`});
    expect(s.capabilities.has("SETTLEMENT_RECEIPT")).toBe(true);
    await expect(s.getReceipt(MARKET)).resolves.toBeNull();
  });

  it("is null when the deployment has no resolution module at all", async () => {
    stubStorage("{}");
    const s = sourceWithModule({module: "0x0000000000000000000000000000000000000000", root: RECEIPT_ROOT});
    await expect(s.getReceipt(MARKET)).resolves.toBeNull();
  });

  it("reads the anchored document and keeps what the resolver did not claim empty", async () => {
    stubStorage(LIVE_RECEIPT);
    const receipt = await sourceWithModule({module: MODULE, root: RECEIPT_ROOT}).getReceipt(MARKET);
    expect(receipt?.outcome).toBe(1);
    expect(receipt?.simulated).toBe(true);
    // `route: "none"` — no model was consulted, so the committee is EMPTY rather
    // than one nameless member, and there is no judge.
    expect(receipt?.votes).toEqual([]);
    expect(receipt?.judgeModel).toBeNull();
    // The resolver stated no criteria of its own. The market's promised criteria
    // are in the MarketSpec and must not be copied in here.
    expect(receipt?.criteria).toBeNull();
    expect(receipt?.reasoning).toContain("No resolver committee ran");
    expect(receipt?.sources[0]).toContain("chainscan-galileo");
    // `route: "none"` means one key settled this. The flag says so.
    expect(receipt?.viaCommittee).toBe(false);
  });

  /**
   * The receipt is written by whoever settled the market, so nothing inside it
   * can be evidence about that settlement's own legitimacy. `viaCommittee` is
   * the protocol's record, read from the module beside the root, and the same
   * unmodified document must come back with either answer depending only on what
   * the chain says. (Tampering with the document to test this is impossible by
   * construction — the root check rejects it first, which is the stronger
   * guarantee. This pins the weaker one the root check does not cover: that the
   * flag is not being derived from the document's own `route` field, which reads
   * `"none"` in both runs below.)
   */
  it("takes viaCommittee from the chain, not from the document", async () => {
    stubStorage(LIVE_RECEIPT);
    const one = sourceWithModule({module: MODULE, root: RECEIPT_ROOT, viaCommittee: false});
    expect((await one.getReceipt(MARKET))?.viaCommittee).toBe(false);

    stubStorage(LIVE_RECEIPT);
    const committee = sourceWithModule({module: MODULE, root: RECEIPT_ROOT, viaCommittee: true});
    expect((await committee.getReceipt(MARKET))?.viaCommittee).toBe(true);
  });

  /**
   * The chain says a receipt exists and storage cannot produce it. Reporting that
   * as "no receipt was anchored" would hide a broken record behind a sentence
   * that happens to read true.
   */
  it("fails loudly when an anchored root has no readable document behind it", async () => {
    stubStorage('{"code":101,"message":"File not found","data":null}');
    const s = sourceWithModule({module: MODULE, root: RECEIPT_ROOT});
    await expect(s.getReceipt(MARKET)).rejects.toThrow(/anchored receipt .*no readable document/);
  });

  function sourceWithModule(opts: {module: `0x${string}`; root: `0x${string}`; viaCommittee?: boolean}) {
    return new ChainSource({
      rpcUrl: "http://stub",
      chainId: 16602,
      factory: FACTORY,
      transport: stubResolution(opts),
      zgIndexerUrl: INDEXER,
    });
  }

  function stubResolution({module, root, viaCommittee = false}: {module: `0x${string}`; root: `0x${string}`; viaCommittee?: boolean}): Transport {
    const base = stubChain(LIVE_ROOT);
    return custom({
      request: async (args) => {
        const {method, params} = args as {method: string; params: unknown};
        if (method === "eth_call") {
          const {to, data} = (params as [{to: `0x${string}`; data: `0x${string}`}])[0];
          if (to.toLowerCase() === CONFIG.toLowerCase()) {
            return encodeFunctionResult({abi: CONFIG_ABI, functionName: "addresses", result: module});
          }
          if (to.toLowerCase() === module.toLowerCase()) {
            // Dispatched on the SELECTOR, not on the address. Answering every
            // call to the module with `resolutionOf`'s encoding made the stub
            // agree with whatever the code happened to ask for, which is the
            // opposite of what the comment above this function promises — the
            // first reader of `viaCommittee` got a 32-byte root back and viem
            // refused to call it a boolean.
            const call = decodeFunctionData({abi: RESOLUTION_ABI, data});
            if (call.functionName === "viaCommittee") {
              return encodeFunctionResult({abi: RESOLUTION_ABI, functionName: "viaCommittee", result: viaCommittee});
            }
            return encodeFunctionResult({
              abi: RESOLUTION_ABI,
              functionName: "resolutionOf",
              result: [root, "0xaaaaaaaa00000000000000000000000000000001"],
            });
          }
          const {functionName} = decodeFunctionData({abi: MARKET_ABI, data});
          if (functionName === "config") {
            return encodeFunctionResult({abi: MARKET_ABI, functionName: "config", result: CONFIG});
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delegating the untouched hops
        return (base({} as any) as any).request(args);
      },
    });
  }
});

/**
 * 0G Storage is a different network from the EVM RPC and answers in about
 * 600ms. On a market list every row needs a document and the table cannot
 * finish until the slowest lands — measured on Galileo, it appeared 30ms after
 * the last spec arrived. Those bytes never change, so the second visit has no
 * reason to ask again.
 *
 * The argument for caching a root is unusually strong and unusually narrow: the
 * key IS the hash of the value, so there is no staleness. That argument survives
 * the cache outliving the page. What it does NOT survive is skipping the check
 * — a document read back off the reader's own disk is exactly the one an
 * attacker can reach, so it is re-proved every time.
 */
describe("documents remembered across visits", () => {
  it("does not ask the network twice for bytes it has already proved", async () => {
    const first = stubStorage(LIVE_SPEC);
    expect((await source({indexer: INDEXER}).listMarkets())[0]!.question).toContain("ETH/USD");
    expect(first).toHaveBeenCalledTimes(1);

    // A NEW source, as a second page load would build: nothing in memory, and
    // the fetch is stubbed to fail so that using it at all is a test failure.
    const second = vi.fn(async () => {
      throw new Error("the network was consulted for a document already proved");
    });
    vi.stubGlobal("fetch", second);
    expect((await source({indexer: INDEXER}).listMarkets())[0]!.question).toContain("ETH/USD");
    expect(second).not.toHaveBeenCalled();
  });

  it("re-proves what it stored, and refuses bytes that no longer hash to the root", async () => {
    stubStorage(LIVE_SPEC);
    await source({indexer: INDEXER}).listMarkets();

    // Someone edits the entry — a browser console, an extension, another tab.
    // The stored key names a hash, so the swap is detectable without asking
    // anyone, and it must not be believed.
    const key = Object.keys(localStorage).find((k) => k.startsWith("brier.zg."))!;
    expect(key).toBeDefined();
    localStorage.setItem(key, LIVE_SPEC.replace("above $4,000", "above $9,000"));

    const refetch = stubStorage(LIVE_SPEC);
    const row = (await source({indexer: INDEXER}).listMarkets())[0]!;
    expect(row.question).toContain("$4,000");
    expect(row.question).not.toContain("$9,000");
    // Not merely ignored — discarded, and the real document fetched instead.
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBe(LIVE_SPEC);
  });

  it("does not remember that a root was empty", async () => {
    // An absent root answers with an envelope that hashes to nothing, so there
    // would be no way to re-prove it on the way out — and an unverifiable
    // "there is nothing here" on the reader's own disk is the entry that would
    // make a real document disappear. Re-asking costs one request.
    stubStorage('{"code":101,"message":"File not found","data":null}');
    expect((await source({indexer: INDEXER}).listMarkets())[0]!.question).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("brier.zg."))).toHaveLength(0);
  });
});
