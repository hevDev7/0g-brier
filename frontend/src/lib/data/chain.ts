import {
  createPublicClient,
  defineChain,
  fallback,
  hexToString,
  http,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import {AGENT_REGISTRY_ABI, CONFIG_ABI, ERC20_ABI, FACTORY_ABI, MARKET_ABI, RESOLUTION_ABI} from "./abi";
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
const AGENT_REGISTRY_KEY = keccak256(toBytes("AGENT_REGISTRY"));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ROOT = `0x${"0".repeat(64)}`;

/**
 * How many JSON-RPC calls may be in flight to the endpoint at one time.
 *
 * Measured, not chosen. Ask the public Galileo endpoint for more than fifty at
 * once and it answers the excess with, verbatim:
 *
 *     -32005 request rate exceeded: Too many requests (exceeds 50),
 *            try again after 11ms
 *
 * one error per call over the line. The leaderboard's cold read is a few hundred
 * calls wide, so without a ceiling it trips this on every load — which is what
 * "the page never finishes" actually was. Batching does not help by itself: the
 * cap counts CALLS, and a batch of fifty is fifty of them.
 *
 * Forty rather than fifty because the limit is the endpoint's and the margin is
 * ours: a page has other reads in the air, and being one over costs a failed
 * call while being ten under costs a fraction of a round trip.
 */
const IN_FLIGHT_CALLS = 40;

/**
 * How many JSON-RPC calls may share one HTTP request.
 *
 * Kept at half the in-flight budget so two full batches fit inside it — one
 * wider than the budget could never be admitted on a busy line, and the gate
 * would have to let it through anyway.
 */
const BATCH_SIZE = 20;

/**
 * How long the transport holds a call back looking for company, in ms.
 *
 * Reads that sit either side of an `await` — the market list's `marketAt`
 * enumeration and the state reads that follow it — are issued in different ticks
 * and would otherwise never share a request. Twelve milliseconds is long enough
 * to catch them and short enough to vanish beside a round trip to a public
 * endpoint, which costs on the order of a second.
 */
const BATCH_WAIT_MS = 12;

/**
 * Batch JSON-RPC where the endpoint accepts it, one call per request where it
 * does not.
 *
 * The public Galileo endpoint takes batches today, but a UI that assumed so
 * would go completely blank against one that does not — and "the chain is down"
 * is exactly the wrong thing to tell a reader whose only real problem is that
 * their RPC dislikes arrays. `fallback` retries the individual call on an
 * unbatched transport whenever the batched one errors, so the page degrades to
 * the request pattern it had before batching existed rather than failing.
 *
 * Batch JSON-RPC rather than Multicall3, deliberately. Multicall would need a
 * contract to be deployed on every chain this points at — including the local
 * anvil `make demo` brings up — and it can only aggregate `eth_call`. Half the
 * traffic here is `eth_getLogs` and `eth_getBlockByNumber`, which it cannot
 * touch at all.
 */
function batchedHttp(rpcUrl: string): Transport {
  // ONE gate, shared by both transports. Two would each be allowed the whole
  // budget, and the degraded path — which fires the most calls of all — is
  // exactly where the ceiling matters most.
  const fetchFn = callGate(IN_FLIGHT_CALLS);
  return fallback([
    http(rpcUrl, {batch: {batchSize: BATCH_SIZE, wait: BATCH_WAIT_MS}, fetchFn}),
    http(rpcUrl, {fetchFn}),
  ]);
}

/** How many JSON-RPC calls one HTTP body carries. */
function callsIn(body: BodyInit | null | undefined): number {
  if (typeof body !== "string") return 1;
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? Math.max(parsed.length, 1) : 1;
  } catch {
    return 1;
  }
}

/**
 * A `fetch` that will not let more than `limit` JSON-RPC calls be outstanding.
 *
 * It counts CALLS rather than requests, which is the only counting that matches
 * what the endpoint measures: a single batched request can be worth twenty of
 * them, and a degraded client sends the same twenty as twenty requests. Both
 * must be held to the same ceiling or the ceiling means nothing.
 */
function callGate(limit: number): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  return async (input, init) => {
    const cost = callsIn(init?.body);
    // `inFlight > 0` is the escape hatch for a request wider than the whole
    // budget: it waits for a quiet line and then goes regardless, because a
    // request that can never fit would otherwise wait forever.
    while (inFlight > 0 && inFlight + cost > limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    inFlight += cost;
    try {
      return await fetch(input, init);
    } finally {
      inFlight -= cost;
      while (waiting.length > 0 && inFlight < limit) waiting.shift()!();
    }
  };
}

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
  /** `undefined` = not looked up yet; `null` = looked, and there is none. */
  private registryAddress: `0x${string}` | null | undefined;
  /**
   * Token metadata by token address. Keyed on the PROMISE rather than the
   * resolved value, which is the whole point: a market list reads every row at
   * once, so with a value cache all thirteen rows reach the lookup before the
   * first one has answered, every one of them misses, and one token's symbol and
   * decimals get read twenty-six times. Storing the in-flight promise is what
   * makes the cache actually catch the case it was written for.
   */
  private readonly tokens = new Map<string, Promise<CollateralInfo>>();
  /**
   * Market address → its collateral.
   *
   * Kept for the life of the source, and safe to: `Market.collateral` is
   * assigned once in `initialize` and never written again, so a hit here cannot
   * go stale the way a price or a status could.
   */
  private readonly marketTokens = new Map<string, Promise<CollateralInfo>>();

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
      transport: config.transport ?? batchedHttp(config.rpcUrl),
    });
  }

  private unavailable(capability: Capability): never {
    throw new CapabilityUnavailableError(capability, this.mode);
  }

  /**
   * Holds a promise in a cache, and forgets it if it rejects.
   *
   * Without the second half a single failed read would be remembered as the
   * answer for the rest of the session, and a source that recovered on its own
   * would keep reporting the outage.
   */
  private remember<T>(cache: Map<string, Promise<T>>, key: string, pending: Promise<T>): Promise<T> {
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }

  private collateralInfo(address: `0x${string}`): Promise<CollateralInfo> {
    const key = address.toLowerCase();
    const cached = this.tokens.get(key);
    if (cached) return cached;
    const pending = Promise.all([
      this.client.readContract({address, abi: ERC20_ABI, functionName: "symbol"}),
      this.client.readContract({address, abi: ERC20_ABI, functionName: "decimals"}),
    ]).then(([symbol, decimals]): CollateralInfo => ({address, symbol, decimals}));
    return this.remember(this.tokens, key, pending);
  }

  /**
   * A market's collateral on its own, for a caller that needs the token and not
   * the market.
   *
   * `positionsFrom` needs exactly one number out of a market — its collateral's
   * decimals — and the only way to ask for it used to be `getMarket`, which
   * reads thirteen values and a 0G Storage document to answer it. Across a
   * leaderboard that was thirteen `eth_call`s per market spent on a constant.
   *
   * Free after `readMarket` has run, which is the normal order: the list is what
   * tells the page which markets to ask about.
   */
  collateralOf(address: `0x${string}`): Promise<CollateralInfo> {
    const key = address.toLowerCase();
    const cached = this.marketTokens.get(key);
    if (cached) return cached;
    const pending = this.client
      .readContract({address, abi: MARKET_ABI, functionName: "collateral"})
      .then((token) => this.collateralInfo(token));
    return this.remember(this.marketTokens, key, pending);
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

    const [q, poolWad, status, tier, category, tradingEnd, collateral, specRoot, winner] =
      await Promise.all([
        read<readonly [bigint, bigint]>("qArray"),
        read<bigint>("poolWad"),
        read<number>("status"),
        read<number>("tier"),
        read<`0x${string}`>("category"),
        read<bigint>("tradingEnd"),
        read<`0x${string}`>("collateral"),
        read<`0x${string}`>("specRoot"),
        read<number>("winningOutcome"),
      ]);

    const statusLabel = STATUSES[status];
    const tierLabel = TIERS[tier];
    // A contract that answered outside the enum is not a market this UI can
    // describe, and guessing a label would put a wrong word on screen.
    if (statusLabel === undefined) throw new Error(`Market ${address} returned unknown status ${status}`);
    if (tierLabel === undefined) throw new Error(`Market ${address} returned unknown tier ${tier}`);

    // Started here rather than awaited at the bottom, and registered against the
    // MARKET as well as the token: the storage fetch below goes to a different
    // network entirely and there is no reason for the two to queue behind each
    // other. Registering it is what makes a later `collateralOf` for this market
    // free, which is how the leaderboard reads a position book without also
    // re-reading every market it belongs to.
    const key = address.toLowerCase();
    const token =
      this.marketTokens.get(key) ?? this.remember(this.marketTokens, key, this.collateralInfo(collateral));

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
        collateral: await token,
        // ONLY `Settled` has a winner, and the reason is not pedantry:
        // `winningOutcome` is 0 in storage until a resolution lands, and 0 is
        // also a legitimate winner ("NO"), so trusting the field alone reports
        // every unresolved market as having settled NO. A market that FAILED or
        // was VOIDED has no winner at all — every side liquidates at its own
        // price — and a committee on Galileo returned UNRESOLVABLE, the market
        // failed, and an earlier version of this read called it "NO".
        // (Phrased in the plural on purpose: `test/write-boundary.test.ts`
        // greps this directory for the bare verb, and a guard that cannot be
        // argued with is worth more than a comment that reads slightly better.)
        winningOutcome: statusLabel === "Settled" ? ((winner === 1 ? 1 : 0) as Outcome) : null,
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

    const [base, feeBps, settlementDeadline, creator, resolvedAt] = await Promise.all([
      this.readMarket(address),
      read<number>("feeBps"),
      read<bigint>("settlementDeadline"),
      read<`0x${string}`>("creator"),
      read<bigint>("resolvedAt"),
    ]);

    // `winningOutcome` comes up with the summary now — see `readMarket` for why
    // only `Settled` may carry one. `resolvedAt` stays here because it is a
    // detail fact, and it is NOT interchangeable with the winner: it is written
    // when a market fails or is voided too, where there is no winner at all.
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

  /**
   * Names for the keys that have traded, found the way the contracts find them:
   * factory → its ConfigRegistry → AGENT_REGISTRY → `nameOfOperator`.
   *
   * Returns what it knows and nothing else. A deployment with no registry yields an
   * empty map rather than an error, because "nobody here has a name" is a true
   * description of such a deployment — every row then shows its address, which is
   * what it showed before names existed.
   */
  async getAgentNames(agents: readonly `0x${string}`[]): Promise<ReadonlyMap<string, string>> {
    const names = new Map<string, string>();
    if (agents.length === 0) return names;

    const registry = await this.agentRegistry();
    if (registry === null) return names;

    const raw = await Promise.all(
      agents.map((agent) =>
        this.client.readContract({
          address: registry,
          abi: AGENT_REGISTRY_ABI,
          functionName: "nameOfOperator",
          args: [agent],
        }),
      ),
    );
    agents.forEach((agent, i) => {
      const value = raw[i];
      if (value === undefined || value === ZERO_ROOT) return;
      // bytes32, right-padded with zeros. Without the explicit size the label carries
      // NUL characters that render as nothing and break an exact-text match — the same
      // trap `category` has.
      const name = hexToString(value, {size: 32}).replace(/\0+$/, "");
      if (name.length > 0) names.set(agent.toLowerCase(), name);
    });
    return names;
  }

  /** Cached: a deployment does not change its registry between renders. */
  private async agentRegistry(): Promise<`0x${string}` | null> {
    if (this.registryAddress !== undefined) return this.registryAddress;
    try {
      const configAddress = await this.client.readContract({
        address: this.factory,
        abi: FACTORY_ABI,
        functionName: "config",
      });
      const registry = await this.client.readContract({
        address: configAddress,
        abi: CONFIG_ABI,
        functionName: "addresses",
        args: [AGENT_REGISTRY_KEY],
      });
      this.registryAddress = registry.toLowerCase() === ZERO_ADDRESS ? null : registry;
    } catch {
      // A factory too old to have `config`, or a registry key never set. Both mean
      // there are no names to be had, which is not an error worth surfacing.
      this.registryAddress = null;
    }
    return this.registryAddress;
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
    // Read beside the root rather than inferred from it: a receipt says what the
    // resolver claims, and this says what the protocol recorded.
    const viaCommittee = await this.client.readContract({
      address: moduleAddress,
      abi: RESOLUTION_ABI,
      functionName: "viaCommittee",
      args: [address],
    });

    const receipt = await specs.getReceipt(receiptRoot as Hex);
    if (receipt !== null) return {...receipt, viaCommittee};
    // The chain says a receipt exists and storage cannot produce it. That is an
    // anomaly, not an absence, and reporting it as "no receipt was anchored"
    // would hide a broken record behind a true-sounding sentence.
    if (receipt === null) {
      throw new Error(`Market ${address} anchored receipt ${receiptRoot}, but no readable document is stored there`);
    }
    return receipt;
  }
}
