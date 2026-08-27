import type {PublicClient} from "viem";
import {MARKET_CREATED_EVENT, TRADE_EVENT} from "./abi";
import {ChainSource, type ChainSourceConfig} from "./chain";
import {candlesFrom, positionsFrom} from "./derive";
import {
  CapabilityUnavailableError,
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

export class LogSource implements DataSource {
  readonly mode: DataMode = "indexer";

  /**
   * The chain's capabilities plus everything a `Trade` log carries. Note what is
   * still absent: `SETTLEMENT_RECEIPT` and `MARKET_SPEC_BLOB` are 0G Storage
   * documents, not events, so no amount of log reading produces them.
   */
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    "LIST_MARKETS",
    "MARKET_STATE",
    "AGENT_BALANCE",
    "TRADE_TAPE",
    "PRICE_HISTORY",
    "AGENT_POSITIONS",
    "COST_BASIS",
  ]);

  private readonly chain: ChainSource;
  private readonly client: PublicClient;
  private readonly factory: `0x${string}`;
  private readonly fromBlock: bigint;
  /** A block's timestamp never changes, and one tape hits the same block repeatedly. */
  private readonly blockTimes = new Map<string, number>();

  constructor(config: LogSourceConfig) {
    this.chain = new ChainSource(config);
    this.client = this.chain.publicClient;
    this.factory = config.factory;
    this.fromBlock = config.fromBlock;
  }

  private async timestampOf(blockNumber: bigint): Promise<number> {
    const key = blockNumber.toString();
    const cached = this.blockTimes.get(key);
    if (cached !== undefined) return cached;
    const block = await this.client.getBlock({blockNumber});
    const seconds = Number(block.timestamp);
    this.blockTimes.set(key, seconds);
    return seconds;
  }

  /** Newest first, matching every other tape in this codebase. */
  private async tape(address: `0x${string}`): Promise<Trade[]> {
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
          probAfterWad: a.probAfter!,
        };
      }),
    );
    return trades.sort((x, y) => y.timestamp - x.timestamp || y.id.localeCompare(x.id));
  }

  private async createdAt(): Promise<Map<string, number>> {
    const logs = await this.client.getLogs({
      address: this.factory,
      event: MARKET_CREATED_EVENT,
      fromBlock: this.fromBlock,
      toBlock: "latest",
    });
    const out = new Map<string, number>();
    for (const log of logs) {
      const market = log.args.market;
      if (market) out.set(market.toLowerCase(), await this.timestampOf(log.blockNumber!));
    }
    return out;
  }

  // ── delegated to the chain, then enriched ────────────────────────────────

  async listMarkets(): Promise<MarketSummary[]> {
    const [markets, created] = await Promise.all([this.chain.listMarkets(), this.createdAt()]);
    return markets.map((m) => ({...m, createdAt: created.get(m.address.toLowerCase()) ?? null}));
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

  async getPositions(address: `0x${string}`): Promise<Position[]> {
    const [market, trades] = await Promise.all([this.chain.getMarket(address), this.tape(address)]);
    return positionsFrom(trades, market.collateral.decimals);
  }

  // ── still out of reach, and it is not the log's fault ────────────────────

  /**
   * A receipt is a document on 0G Storage keyed by `receiptRoot`, not an event.
   * Reading every log ever emitted would not produce one, so this stays
   * unavailable until that integration exists rather than degrading into a
   * partial answer assembled from whatever the chain happens to hold.
   */
  async getReceipt(): Promise<SettlementReceipt> {
    throw new CapabilityUnavailableError("SETTLEMENT_RECEIPT", this.mode);
  }
}
