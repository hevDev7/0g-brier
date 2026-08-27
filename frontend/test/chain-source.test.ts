import {describe, expect, it} from "vitest";
import {custom, encodeFunctionResult, decodeFunctionData, type Transport} from "viem";
import {ChainSource} from "@/lib/data/chain";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI} from "@/lib/data/abi";
import {CapabilityUnavailableError} from "@/lib/data/types";

const FACTORY = "0xfacadefacadefacadefacadefacadefacadefac0" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

/**
 * Answers `eth_call` from a table keyed by the decoded function name, so a test
 * says what the CHAIN reports rather than how viem encodes it. Anything the table
 * does not cover throws by name — a silent zero here would be exactly the lie the
 * whole `unavailable` design exists to prevent.
 */
function stubChain(overrides: Record<string, unknown> = {}): Transport {
  const answers: Record<string, unknown> = {
    marketCount: 2n,
    marketAt: MARKET,
    qArray: [1000n * 10n ** 18n, 1200n * 10n ** 18n],
    poolWad: 1562049935181330879n,
    status: 0,
    tier: 1,
    // "crypto" as bytes32, right-padded with the zeros a fixed-size type carries.
    category: `0x${Buffer.from("crypto").toString("hex").padEnd(64, "0")}`,
    tradingEnd: 1790000000n,
    settlementDeadline: 1790086400n,
    collateral: TOKEN,
    creator: "0xaaaaaaaa00000000000000000000000000000001",
    specRoot: `0x${"ab".repeat(32)}`,
    feeBps: 100,
    symbol: "mUSDC",
    decimals: 6,
    balanceOf: 4_200_000n,
    ...overrides,
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
      return encodeFunctionResult({abi, functionName, result: answers[functionName] } as any);
    },
  });
}

const source = (overrides?: Record<string, unknown>) =>
  new ChainSource({rpcUrl: "http://stub", chainId: 16602, factory: FACTORY, transport: stubChain(overrides)});

describe("ChainSource capabilities", () => {
  /**
   * The list is short, and every omission is a decision rather than an oversight.
   * Asserting it exactly means adding one later cannot happen quietly.
   */
  it("claims only what an eth_call can answer", () => {
    expect([...source().capabilities].sort()).toEqual(["AGENT_BALANCE", "LIST_MARKETS", "MARKET_STATE"]);
    expect(source().mode).toBe("chain");
  });

  it.each([
    ["getTrades", "TRADE_TAPE"],
    ["getCandles", "PRICE_HISTORY"],
    ["getPositions", "AGENT_POSITIONS"],
    ["getReceipt", "SETTLEMENT_RECEIPT"],
  ])("%s throws unavailable rather than returning empty", async (method, capability) => {
    const s = source() as unknown as Record<string, () => Promise<unknown>>;
    await expect(s[method]!()).rejects.toBeInstanceOf(CapabilityUnavailableError);
    await expect(s[method]!()).rejects.toMatchObject({capability, mode: "chain"});
  });
});

describe("ChainSource market state", () => {
  it("decodes the enums and the padded category, and admits what it cannot know", async () => {
    const market = await source().getMarket(MARKET);
    expect(market.status).toBe("Open");
    expect(market.tier).toBe("VERIFIED");
    // A NUL-padded label matches nothing and renders as nothing; the size hint is
    // what strips the padding a bytes32 always carries.
    expect(market.category).toBe("crypto");
    expect(market.q).toEqual([1000n * 10n ** 18n, 1200n * 10n ** 18n]);
    expect(market.feeBps).toBe(100);
    expect(market.collateral).toEqual({address: TOKEN, symbol: "mUSDC", decimals: 6});

    // The three a chain genuinely cannot answer — null, never a placeholder.
    expect(market.question).toBeNull();
    expect(market.rules).toBeNull();
    expect(market.createdAt).toBeNull();
  });

  it("maps every status index to the enum in IMarket order", async () => {
    const expected = ["Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided"];
    for (const [index, label] of expected.entries()) {
      expect((await source({status: index}).getMarket(MARKET)).status).toBe(label);
    }
  });

  /**
   * A market answering outside the enum is not one this UI can describe. Guessing
   * a label would put a wrong word on screen, which is worse than failing.
   */
  it("refuses an out-of-range status rather than inventing a label", async () => {
    await expect(source({status: 9}).getMarket(MARKET)).rejects.toThrow(/unknown status 9/);
    await expect(source({tier: 7}).getMarket(MARKET)).rejects.toThrow(/unknown tier 7/);
  });

  it("lists markets newest first, since marketAt is append-only", async () => {
    const markets = await source().listMarkets();
    expect(markets).toHaveLength(2);
    expect(markets.every((m) => m.createdAt === null)).toBe(true);
  });

  it("reads a free-collateral balance, which needs no history", async () => {
    expect(await source().getBalance("0xaaaaaaaa00000000000000000000000000000001", TOKEN)).toBe(4_200_000n);
  });
});
