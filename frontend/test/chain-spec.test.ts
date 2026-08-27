import {afterEach, describe, expect, it, vi} from "vitest";
import {custom, decodeFunctionData, encodeFunctionResult, type Transport} from "viem";
import {ChainSource} from "@/lib/data/chain";
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
