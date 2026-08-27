import {createPublicClient, defineChain, hexToString, http, type PublicClient, type Transport} from "viem";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI} from "./abi";
import {
  CapabilityUnavailableError,
  type Candle,
  type Capability,
  type CollateralInfo,
  type DataMode,
  type DataSource,
  type MarketDetail,
  type MarketStatus,
  type MarketSummary,
  type Position,
  type SettlementReceipt,
  type Tier,
  type Trade,
} from "./types";

/**
 * A `DataSource` backed by `eth_call` and nothing else.
 *
 * What it can answer is decided by what a view function can return, not by what
 * would be convenient. Everything that needs event history — the trade tape,
 * price history, cost basis, the market-wide position book, the settlement
 * receipt — throws `CapabilityUnavailableError`, and the UI renders that as an
 * explanation rather than as a zero. Reaching for `eth_getLogs` from genesis on
 * every page load would be the dishonest way out; that is what the indexer is
 * for (F4).
 *
 * Two fields on a market are unanswerable here even though the market itself is
 * fully readable: `question` and `rules` live in a 0G Storage blob committed to
 * by `specRoot`, and `createdAt` is not in `Market`'s storage at all — it exists
 * only in the `MarketCreated` event. All three come back `null`.
 */

/** Narrowed from the ABI so a typo in a read name is a compile error, not a
 *  runtime one on a page nobody has opened yet. */
type MarketFn = (typeof MARKET_ABI)[number]["name"];

/** The order in `IMarket.Status`. Read from the enum, so a reordering breaks loudly. */
const STATUSES: readonly MarketStatus[] = [
  "Open",
  "Closed",
  "Proposed",
  "Disputed",
  "Settled",
  "Failed",
  "Voided",
];

/** `IMarket.Params.tier`: 0 = FAST, 1 = VERIFIED, 2 = DETERMINISTIC. */
const TIERS: readonly Tier[] = ["FAST", "VERIFIED", "DETERMINISTIC"];

export interface ChainSourceConfig {
  rpcUrl: string;
  chainId: number;
  factory: `0x${string}`;
  /**
   * Overrides the HTTP transport. Present so the decoding below — the status and
   * tier enums, the right-padded bytes32 category — can be tested against known
   * bytes instead of against a chain that has to be running. Supplying a
   * transport is ordinary viem practice, not a test-only hatch.
   */
  transport?: Transport;
}

export class ChainSource implements DataSource {
  readonly mode: DataMode = "chain";

  /**
   * Deliberately short. `AGENT_BALANCE` is here because `IERC20.balanceOf` is a
   * view; `AGENT_POSITIONS` is not, because `getPositions` returns EVERY agent's
   * position and enumerating holders needs transfer events.
   */
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "LIST_MARKETS",
    "MARKET_STATE",
    "AGENT_BALANCE",
  ]);

  private readonly client: PublicClient;
  private readonly factory: `0x${string}`;
  /** Token metadata never changes, and a market list would otherwise re-read it once per row. */
  private readonly tokens = new Map<string, CollateralInfo>();

  constructor(config: ChainSourceConfig) {
    this.factory = config.factory;
    this.client = createPublicClient({
      chain: defineChain({
        id: config.chainId,
        name: `chain-${config.chainId}`,
        nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
        rpcUrls: {default: {http: [config.rpcUrl]}},
      }),
      transport: config.transport ?? http(config.rpcUrl),
    });
  }

  private unavailable(capability: Capability): never {
    throw new CapabilityUnavailableError(capability, this.mode);
  }

  private async collateralInfo(address: `0x${string}`): Promise<CollateralInfo> {
    const cached = this.tokens.get(address.toLowerCase());
    if (cached) return cached;
    const [symbol, decimals] = await Promise.all([
      this.client.readContract({address, abi: ERC20_ABI, functionName: "symbol"}),
      this.client.readContract({address, abi: ERC20_ABI, functionName: "decimals"}),
    ]);
    const info: CollateralInfo = {address, symbol, decimals};
    this.tokens.set(address.toLowerCase(), info);
    return info;
  }

  private async summary(address: `0x${string}`): Promise<MarketSummary> {
    const read = <T,>(functionName: MarketFn) =>
      this.client.readContract({address, abi: MARKET_ABI, functionName}) as Promise<T>;

    const [q, poolWad, status, tier, category, tradingEnd, collateral] = await Promise.all([
      read<readonly [bigint, bigint]>("qArray"),
      read<bigint>("poolWad"),
      read<number>("status"),
      read<number>("tier"),
      read<`0x${string}`>("category"),
      read<bigint>("tradingEnd"),
      read<`0x${string}`>("collateral"),
    ]);

    const statusLabel = STATUSES[status];
    const tierLabel = TIERS[tier];
    // A contract that answered outside the enum is not a market this UI can
    // describe, and guessing a label would put a wrong word on screen.
    if (statusLabel === undefined) throw new Error(`Market ${address} returned unknown status ${status}`);
    if (tierLabel === undefined) throw new Error(`Market ${address} returned unknown tier ${tier}`);

    return {
      address,
      question: null,
      // `category` is bytes32, right-padded with zeros. `hexToString` with an
      // explicit size strips them; without it the label carries NUL characters
      // that render as nothing and break an exact-text match.
      category: hexToString(category, {size: 32}),
      tier: tierLabel,
      status: statusLabel,
      q,
      poolWad,
      createdAt: null,
      tradingEnd: Number(tradingEnd),
      collateral: await this.collateralInfo(collateral),
    };
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const count = await this.client.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "marketCount",
    });

    // Walked backwards so the newest market is first. `_markets` is append-only,
    // which makes the index a creation-order proxy — the only ordering left once
    // `createdAt` is null, and the one the default "newest" sort expects.
    const indices = Array.from({length: Number(count)}, (_, i) => BigInt(Number(count) - 1 - i));
    const addresses = await Promise.all(
      indices.map((index) =>
        this.client.readContract({
          address: this.factory,
          abi: FACTORY_ABI,
          functionName: "marketAt",
          args: [index],
        }),
      ),
    );
    return Promise.all(addresses.map((address) => this.summary(address)));
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    const read = <T,>(functionName: MarketFn) =>
      this.client.readContract({address, abi: MARKET_ABI, functionName}) as Promise<T>;

    const [base, feeBps, settlementDeadline, creator, specRoot] = await Promise.all([
      this.summary(address),
      read<number>("feeBps"),
      read<bigint>("settlementDeadline"),
      read<`0x${string}`>("creator"),
      read<`0x${string}`>("specRoot"),
    ]);

    return {
      ...base,
      feeBps,
      settlementDeadline: Number(settlementDeadline),
      creator,
      specRoot,
      rules: null,
    };
  }

  async getBalance(agent: `0x${string}`, collateral: `0x${string}`): Promise<bigint> {
    return this.client.readContract({
      address: collateral,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [agent],
    });
  }

  // ── everything below needs events, and says so ───────────────────────────

  // Declared without parameters on purpose. A method may take fewer arguments
  // than the interface it satisfies, and writing none says the thing an unused
  // `_address` only hints at: the answer does not depend on which market, or how
  // many rows, you asked for. It is unavailable for every input.

  async getTrades(): Promise<Trade[]> {
    this.unavailable("TRADE_TAPE");
  }

  async getCandles(): Promise<Candle[]> {
    this.unavailable("PRICE_HISTORY");
  }

  async getPositions(): Promise<Position[]> {
    this.unavailable("AGENT_POSITIONS");
  }

  async getReceipt(): Promise<SettlementReceipt> {
    this.unavailable("SETTLEMENT_RECEIPT");
  }
}
