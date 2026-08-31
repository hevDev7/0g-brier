import type {PublicClient} from "viem";
import {dpm} from "@0g-brier/protocol";
import {MARKET_CREATED_EVENT, TRADE_EVENT} from "./abi";
import type {GetLogsReturnType} from "viem";
import {ChainSource, type ChainSourceConfig} from "./chain";
import {candlesFrom, positionsFrom} from "./derive";
import {
  type Candle,
  type Capability,
  type DataMode,
  type DataSource,
  type Interval,
  type MarketDetail,
  type MarketSummary,
  type Outcome,
  type Position,
  type SettlementReceipt,
  type Trade,
} from "./types";

/**
 * The `indexer` mode, built by reading logs directly rather than by querying a
 * service.
 *
 * It DECORATES `ChainSource` instead of reimplementing it, which is the property
 * the spec asks for (§3.2): current state still comes from `eth_call`, and this
 * class only adds what state cannot answer. So the price on the chart and the
 * price in the panel cannot disagree — there is one source for the second and the
 * first is derived from the same market's own events.
 *
 * What it is NOT: the P3 indexer service. There is no database, no reorg
 * handling, and no incremental cursor — every query walks the range again. That
 * is honest for a testnet with a handful of markets and would not be for mainnet,
 * where reorgs are real and the range only grows. When the service arrives it
 * replaces this class and keeps the same decorator shape.
 *
 * `fromBlock` is what makes the range bounded and therefore defensible. The spec
 * rejects scanning "from genesis on Galileo" as dishonest for a UI, and it is
 * right — but the deployment manifest records the block the contracts landed in,
 * so nothing here ever looks below it.
 */

export interface LogSourceConfig extends ChainSourceConfig {
  /**
   * A LOWER BOUND on the deployment block, from `deployments/<chainId>.json`.
   * Lower is the safe direction: too early only costs a wider scan, while too
   * late silently drops the events before it and would show a market as having
   * no history rather than as having history nobody fetched.
   */
  fromBlock: bigint;
}

/** What `getLogs` gives back for `MarketCreated`, named so two members can share it. */
type CreatedLog = GetLogsReturnType<undefined, [typeof MARKET_CREATED_EVENT]>[number];

export class LogSource implements DataSource {
  readonly mode: DataMode = "indexer";

  /**
   * Whatever the source it decorates can do, plus everything a `Trade` log
   * carries. Composed rather than restated: `MARKET_SPEC_BLOB` depends on
   * whether a 0G Storage indexer is configured, and a hand-written literal here
   * would quietly claim otherwise the moment one is.
   *
   * `SETTLEMENT_RECEIPT` is still absent, and no amount of log reading produces
   * it — it is a 0G Storage document with no root on chain to fetch it by.
   */
  readonly capabilities: ReadonlySet<Capability>;

  private static readonly FROM_LOGS = [
    "TRADE_TAPE",
    "PRICE_HISTORY",
    "AGENT_POSITIONS",
    "COST_BASIS",
  ] as const satisfies readonly Capability[];

  private readonly chain: ChainSource;
  private readonly client: PublicClient;
  private readonly factory: `0x${string}`;
  private readonly fromBlock: bigint;
  /**
   * A block's timestamp never changes, and one tape hits the same block
   * repeatedly.
   *
   * The promise is cached, not the number, and that is the fix rather than a
   * stylistic choice: a tape decodes all of its logs at once, so with a value
   * cache every log in a block reached the lookup before the first one had
   * answered and each of them fetched the block again. Four trades in a block
   * cost four `eth_getBlockByNumber`; now they cost one.
   */
  private readonly blockTimes = new Map<string, Promise<number>>();
  /**
   * The tape currently being read for a market, while it is being read.
   *
   * The leaderboard asks for a market's positions and its trades in the same
   * tick, and both are the same `getLogs` over the same range — one of the two
   * was pure waste. The entry is dropped the moment it settles, so this
   * coalesces concurrent readers and never serves a range that has aged: a
   * refetch a second later still goes to the chain.
   */
  private readonly tapes = new Map<string, Promise<Trade[]>>();

  /** See `createdLogs`. Held only while the scan is in flight. */
  private createdLogsPending: Promise<CreatedLog[]> | null = null;
  /** The creation index while it is being built, for the same reason. `null`
   *  when nothing is in flight. */
  private created: Promise<Map<string, number>> | null = null;

  constructor(config: LogSourceConfig) {
    this.chain = new ChainSource(config);
    this.capabilities = new Set<Capability>([...this.chain.capabilities, ...LogSource.FROM_LOGS]);
    this.client = this.chain.publicClient;
    this.factory = config.factory;
    this.fromBlock = config.fromBlock;
  }

  /**
   * Holds a promise in a cache, and forgets it if it rejects. A failed read
   * remembered as the answer would outlive the outage that caused it.
   */
  private static remember<K, T>(cache: Map<K, Promise<T>>, key: K, pending: Promise<T>): Promise<T> {
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }

  private timestampOf(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.blockTimes.get(key);
    if (cached !== undefined) return cached;
    return LogSource.remember(
      this.blockTimes,
      key,
      this.client.getBlock({blockNumber}).then((block) => Number(block.timestamp)),
    );
  }

  /**
   * The tape, read once per burst however many callers want it. See `tapes`.
   */
  private tape(address: `0x${string}`): Promise<Trade[]> {
    const key = address.toLowerCase();
    const inFlight = this.tapes.get(key);
    if (inFlight !== undefined) return inFlight;
    const pending = this.readTape(address);
    const forget = () => {
      if (this.tapes.get(key) === pending) this.tapes.delete(key);
    };
    this.tapes.set(key, pending);
    pending.then(forget, forget);
    return pending;
  }

  /** Newest first, matching every other tape in this codebase. */
  private async readTape(address: `0x${string}`): Promise<Trade[]> {
    const logs = await this.client.getLogs({
      address,
      event: TRADE_EVENT,
      fromBlock: this.fromBlock,
      toBlock: "latest",
    });

    const trades = await Promise.all(
      logs.map(async (log): Promise<Trade> => {
        const a = log.args;
        return {
          // Block plus log index, not the transaction hash: one transaction can
          // emit several trades, and a key that collides would silently drop rows
          // from a React list.
          id: `${log.blockNumber}-${log.logIndex}`,
          timestamp: await this.timestampOf(log.blockNumber!),
          trader: a.trader!,
          outcome: Number(a.outcome!) as Outcome,
          sharesDelta: a.sharesDelta!,
          tokens: a.tokens!,
          fee: a.fee!,
          // From `qAfter`, not from `probAfter`. The event's own field is the
          // probability of the TRADED side, so a NO trade reports P(NO); taking
          // the complement would recover P(YES) only to within the ±2 wei that
          // Σ probability is allowed to drift. The full q is right there in the
          // log, so the exact number costs nothing.
          probYesAfterWad: dpm.probability(a.qAfter!, 1),
        };
      }),
    );
    return trades.sort((x, y) => y.timestamp - x.timestamp || y.id.localeCompare(x.id));
  }

  /** Built once per burst however many callers want it. See `created`. */
  private createdAt(): Promise<Map<string, number>> {
    if (this.created !== null) return this.created;
    const pending = this.readCreatedAt();
    const forget = () => {
      if (this.created === pending) this.created = null;
    };
    this.created = pending;
    pending.then(forget, forget);
    return pending;
  }

  /**
   * The creation scan itself, memoised for the same burst as `created`.
   *
   * Two things come out of these logs — when each market was created, and which
   * document each committed to — and they are wanted at opposite ends of the
   * load. Sharing the promise is what lets the second consumer read the roots
   * without a second scan; without it, prefetching would have cost the round
   * trip it was meant to save.
   */
  private createdLogs(): Promise<CreatedLog[]> {
    if (this.createdLogsPending !== null) return this.createdLogsPending;
    const pending = this.client.getLogs({
      address: this.factory,
      event: MARKET_CREATED_EVENT,
      fromBlock: this.fromBlock,
      toBlock: "latest",
    });
    this.createdLogsPending = pending;
    const forget = () => {
      if (this.createdLogsPending === pending) this.createdLogsPending = null;
    };
    pending.then(forget, forget);
    return pending;
  }

  private async readCreatedAt(): Promise<Map<string, number>> {
    const logs = await this.createdLogs();
    // Concurrently, not in a loop that awaits. The loop was one round trip per
    // market, in series, for a set of timestamps that have nothing to do with
    // each other — thirteen markets meant thirteen sequential waits on an
    // endpoint that answers in about a second.
    const entries = await Promise.all(
      logs.flatMap((log) => {
        const market = log.args.market;
        if (!market) return [];
        return [
          this.timestampOf(log.blockNumber!).then((seconds) => [market.toLowerCase(), seconds] as const),
        ];
      }),
    );
    return new Map(entries);
  }

  // ── delegated to the chain, then enriched ────────────────────────────────

  async listMarkets(): Promise<MarketSummary[]> {
    // Started before the prefetch, and deliberately in this order: `createdAt`
    // puts the creation scan in flight synchronously, so the prefetch below
    // joins that same request instead of opening a second one. Neither is
    // awaited here — the chain reads must not queue behind either.
    const created = this.createdAt();
    this.prefetchSpecsFromLogs();

    const markets = await this.chain.listMarkets();
    const at = await created;
    return markets.map((m) => ({...m, createdAt: at.get(m.address.toLowerCase()) ?? null}));
  }

  /**
   * Hand the spec roots in the creation log to the chain source, so the
   * documents are on their way before anything asks for them.
   *
   * Failure is deliberately quiet. Nothing here is load-bearing: every root is
   * read again from the market itself, and a scan that fails will fail again in
   * `createdAt`, where the reader is told about it.
   */
  private prefetchSpecsFromLogs(): void {
    void this.createdLogs()
      .then((logs) => {
        this.chain.prefetchSpecs(logs.flatMap((l) => (l.args.specRoot ? [l.args.specRoot] : [])));
      })
      // Reported by the call that needs the answer, not by the one that guessed.
      .catch(() => {});
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    const [market, created] = await Promise.all([this.chain.getMarket(address), this.createdAt()]);
    return {...market, createdAt: created.get(address.toLowerCase()) ?? null};
  }

  getBalance(agent: `0x${string}`, collateral: `0x${string}`): Promise<bigint> {
    return this.chain.getBalance(agent, collateral);
  }

  // ── rebuilt from the tape ────────────────────────────────────────────────

  async getTrades(address: `0x${string}`, limit: number): Promise<Trade[]> {
    return (await this.tape(address)).slice(0, limit);
  }

  async getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]> {
    return candlesFrom(await this.tape(address), interval);
  }

  /**
   * The collateral, not the market.
   *
   * `positionsFrom` needs one number from the chain — the token's decimals, to
   * turn what was paid into a price per share — and this used to ask
   * `getMarket` for it, which reads thirteen values and a 0G Storage document.
   * On a leaderboard that is every market's full state fetched a second time,
   * after the list has already fetched it, to learn a constant. The positions
   * themselves come from the tape and are byte-for-byte what they were.
   */
  async getPositions(address: `0x${string}`): Promise<Position[]> {
    const [collateral, trades] = await Promise.all([this.chain.collateralOf(address), this.tape(address)]);
    return positionsFrom(trades, collateral.decimals);
  }

  // ── still out of reach, and it is not the log's fault ────────────────────

  /**
   * A receipt is a document on 0G Storage keyed by `receiptRoot`, not an event.
   * Reading every log ever emitted would not produce one, so this stays
   * unavailable until that integration exists rather than degrading into a
   * partial answer assembled from whatever the chain happens to hold.
   */
  /** Delegated, like every other non-log read. The receipt is a 0G Storage
   *  document reached from chain state, so nothing here can improve on it. */
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt | null> {
    return this.chain.getReceipt(address);
  }

  /** Delegated: a name is chain state, not history. */
  getAgentNames(agents: readonly `0x${string}`[]): Promise<ReadonlyMap<string, string>> {
    return this.chain.getAgentNames(agents);
  }
}
