import {
  createPublicClient,
  defineChain,
  hexToString,
  http,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import {CONFIG_ABI, ERC20_ABI, FACTORY_ABI, MARKET_ABI, RESOLUTION_ABI} from "./abi";
import {ZgStore, type MarketSpec} from "./zg-storage";
import {
  CapabilityUnavailableError,
  type Candle,
  type Capability,
  type CollateralInfo,
  type DataMode,
  type DataSource,
  type MarketDetail,
  type MarketStatus,
  type Outcome,
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
 * `createdAt` is unanswerable here even though the market itself is fully
 * readable: it is not in `Market`'s storage at all, existing only in the
 * `MarketCreated` event. It comes back `null`.
 *
 * `question` and `rules` are a different case. They live in a 0G Storage
 * document committed to by `specRoot`, which is a plain HTTPS GET away — so
 * they are answerable HERE, without an indexer, when `zgIndexerUrl` is
 * configured, and `MARKET_SPEC_BLOB` appears in `capabilities` only then. A
 * market whose document was never uploaded still returns `null`, which is the
 * true answer rather than a failure.
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

/** `ConfigKeys.RESOLUTION_MODULE`, derived rather than pasted — a mistyped
 *  bytes32 constant reads as "no module configured" and would be silent. */
const RESOLUTION_MODULE_KEY = keccak256(toBytes("RESOLUTION_MODULE"));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ROOT = `0x${"0".repeat(64)}`;

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
  /**
   * The 0G Storage indexer, e.g. `https://indexer-storage-testnet-turbo.0g.ai`.
   *
   * Optional because it is a genuinely separate network from the EVM RPC: a
   * deployment can have a chain and no storage. Absent, `question` and `rules`
   * stay `null` and `MARKET_SPEC_BLOB` stays out of `capabilities`, which is
   * exactly the behaviour that shipped before this existed.
   */
  zgIndexerUrl?: string;
}

export class ChainSource implements DataSource {
  readonly mode: DataMode = "chain";

  /**
   * Deliberately short. `AGENT_BALANCE` is here because `IERC20.balanceOf` is a
   * view; `AGENT_POSITIONS` is not, because `getPositions` returns EVERY agent's
   * position and enumerating holders needs transfer events.
   */
  readonly capabilities: ReadonlySet<Capability>;

  /**
   * Exposed so `LogSource` can decorate this source rather than build a second
   * client beside it — two clients would mean two views of "latest" and a chart
   * that could disagree with the panel above it about which block it is on.
   */
  get publicClient(): PublicClient {
    return this.client;
  }

  private readonly client: PublicClient;
  private readonly factory: `0x${string}`;
  /** Absent when no 0G Storage indexer is configured. */
  private readonly specs: ZgStore | null;
  /** Token metadata never changes, and a market list would otherwise re-read it once per row. */
  private readonly tokens = new Map<string, CollateralInfo>();

  constructor(config: ChainSourceConfig) {
    this.factory = config.factory;
    this.specs = config.zgIndexerUrl ? new ZgStore(config.zgIndexerUrl) : null;
    this.capabilities = new Set<Capability>([
      "LIST_MARKETS",
      "MARKET_STATE",
      "AGENT_BALANCE",
      // Both are 0G Storage documents reached by a root that is already on chain,
      // so an indexer is not what either needs — a storage endpoint is.
      ...(this.specs ? (["MARKET_SPEC_BLOB", "SETTLEMENT_RECEIPT"] as const) : []),
    ]);
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

  /**
   * Everything both the list and the detail page need, read once.
   *
   * `specRoot` is read here rather than in `getMarket` because the list needs
   * the question too. Splitting them would fetch the same document twice per
   * market — once for the row, once for the page it links to.
   */
  private async readMarket(address: `0x${string}`): Promise<{
    summary: MarketSummary;
    specRoot: `0x${string}`;
    spec: MarketSpec | null;
  }> {
    const read = <T,>(functionName: MarketFn) =>
      this.client.readContract({address, abi: MARKET_ABI, functionName}) as Promise<T>;

    const [q, poolWad, status, tier, category, tradingEnd, collateral, specRoot] = await Promise.all([
      read<readonly [bigint, bigint]>("qArray"),
      read<bigint>("poolWad"),
      read<number>("status"),
      read<number>("tier"),
      read<`0x${string}`>("category"),
      read<bigint>("tradingEnd"),
      read<`0x${string}`>("collateral"),
      read<`0x${string}`>("specRoot"),
    ]);

    const statusLabel = STATUSES[status];
    const tierLabel = TIERS[tier];
    // A contract that answered outside the enum is not a market this UI can
    // describe, and guessing a label would put a wrong word on screen.
    if (statusLabel === undefined) throw new Error(`Market ${address} returned unknown status ${status}`);
    if (tierLabel === undefined) throw new Error(`Market ${address} returned unknown tier ${tier}`);

    // Awaited after the enum checks so a market this UI cannot describe fails on
    // that, not on a storage fetch it was never going to be able to use.
    const spec = this.specs ? await this.specs.getSpec(specRoot) : null;

    return {
      specRoot,
      spec,
      summary: {
        address,
        // The document supplies only what the chain cannot: the chain's own
        // category, tier and tradingEnd are the ones that bind, so a document
        // that disagrees with its market cannot change what the market is.
        question: spec?.question ?? null,
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
      },
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
    return Promise.all(addresses.map(async (address) => (await this.readMarket(address)).summary));
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    const read = <T,>(functionName: MarketFn) =>
      this.client.readContract({address, abi: MARKET_ABI, functionName}) as Promise<T>;

    const [base, feeBps, settlementDeadline, creator, winner, resolvedAt] = await Promise.all([
      this.readMarket(address),
      read<number>("feeBps"),
      read<bigint>("settlementDeadline"),
      read<`0x${string}`>("creator"),
      read<number>("winningOutcome"),
      read<bigint>("resolvedAt"),
    ]);

    // `winningOutcome` is 0 in storage until a resolution lands, and 0 is also a
    // legitimate winner ("NO"). `resolvedAt` is what distinguishes them — it is
    // the field the contract writes at the moment of resolution, and it cannot
    // be zero afterwards. Reading the outcome alone would report every unresolved
    // market as having settled NO.
    const resolved = Number(resolvedAt) !== 0;

    return {
      ...base.summary,
      feeBps,
      settlementDeadline: Number(settlementDeadline),
      creator,
      specRoot: base.specRoot,
      rules: base.spec?.rules ?? null,
      settlementPrompt: base.spec?.settlementPrompt ?? null,
      sources: base.spec?.sources ?? null,
      winningOutcome: resolved ? ((winner === 1 ? 1 : 0) as Outcome) : null,
      resolvedAt: resolved ? Number(resolvedAt) : null,
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

  /**
   * The resolver's record for a settlement, found the way the contract itself
   * would: market → its ConfigRegistry → RESOLUTION_MODULE → the root anchored
   * for this market. Nothing is read from configuration that the chain could be
   * asked for, so a client cannot be pointed at a module the market does not
   * actually obey.
   *
   * `null` means the settlement anchored nothing — permanently true of every
   * market resolved before `ResolutionModule` existed, and of any resolved by an
   * EOA holding the role directly.
   */
  async getReceipt(address: `0x${string}`): Promise<SettlementReceipt | null> {
    const specs = this.specs;
    if (!specs) this.unavailable("SETTLEMENT_RECEIPT");

    const configAddress = await this.client.readContract({
      address,
      abi: MARKET_ABI,
      functionName: "config",
    });
    const moduleAddress = await this.client.readContract({
      address: configAddress,
      abi: CONFIG_ABI,
      functionName: "addresses",
      args: [RESOLUTION_MODULE_KEY],
    });
    // No module at all: nothing has ever been anchored on this deployment, and
    // nothing about this market can be.
    if (moduleAddress.toLowerCase() === ZERO_ADDRESS) return null;

    const [receiptRoot] = await this.client.readContract({
      address: moduleAddress,
      abi: RESOLUTION_ABI,
      functionName: "resolutionOf",
      args: [address],
    });
    if (receiptRoot.toLowerCase() === ZERO_ROOT) return null;

    const receipt = await specs.getReceipt(receiptRoot as Hex);
    // The chain says a receipt exists and storage cannot produce it. That is an
    // anomaly, not an absence, and reporting it as "no receipt was anchored"
    // would hide a broken record behind a true-sounding sentence.
    if (receipt === null) {
      throw new Error(`Market ${address} anchored receipt ${receiptRoot}, but no readable document is stored there`);
    }
    return receipt;
  }
}
