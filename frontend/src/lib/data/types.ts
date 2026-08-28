export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

/**
 * The canonical list, and the type is derived FROM it rather than declared
 * alongside it.
 *
 * A hand-written union plus a hand-written array is two places to add a member
 * and one place to forget: `MockSource`'s array was not exhaustiveness-checked,
 * so adding `MARKET_SPEC_BLOB` to the union left the mock silently claiming it
 * could not answer something it answers from a fixture. `Record<Capability, T>`
 * still fails to compile when a member is missing, so the label and provider
 * tables keep their guarantee.
 */
export const CAPABILITIES = [
  "LIST_MARKETS",
  "MARKET_STATE",
  "PRICE_HISTORY",
  "TRADE_TAPE",
  "AGENT_POSITIONS",
  "AGENT_BALANCE",
  "COST_BASIS",
  "MARKET_SPEC_BLOB",
  "SETTLEMENT_RECEIPT",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly mode: DataMode,
  ) {
    super(`${capability} is not available in ${mode} mode`);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * `unavailable` is a member of the union, not a special case. Because it lives
 * here, TypeScript forces every consumer to handle it — a component that
 * forgets will not compile. The UI's honesty is enforced by the compiler, not
 * by discipline.
 */
export type Query<T> =
  | {status: "loading"}
  | {status: "ready"; data: T}
  | {status: "unavailable"; capability: Capability; mode: DataMode}
  | {status: "error"; error: Error};

export type MarketStatus =
  | "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";
/**
 * A bucket width, in the shape a fixed number of seconds can take.
 *
 * `30d` is thirty days and is NOT called `1M`, because a calendar month is not a
 * fixed number of seconds and a bucket that pretends otherwise would put February
 * and August on the same axis and call them equal.
 */
export type Interval = "1m" | "5m" | "1h" | "1d" | "1w" | "30d";

export interface CollateralInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface MarketSummary {
  address: `0x${string}`;
  /**
   * The question, from the MarketSpec on 0G Storage.
   *
   * `null` means the current mode CANNOT read it — not that the market has no
   * question. Only `specRoot` is on chain; the text it commits to lives in 0G
   * Storage, and that integration does not exist yet (`MARKET_SPEC_BLOB`). A
   * `chain`-mode consumer must render `<Unavailable capability="MARKET_SPEC_BLOB">`
   * rather than an empty heading, for the same reason it must not render 0 for an
   * unknown number.
   */
  question: string | null;
  category: string;
  tier: Tier;
  status: MarketStatus;
  /** Share supply per outcome, wad. Index 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Always equal to dpm.costUp(q). Never typed by hand. */
  poolWad: bigint;
  /**
   * Creation time, unix seconds, or `null` when the mode cannot know it.
   *
   * The earlier comment here claimed this was MARKET_STATE and "answerable in
   * every mode". It is not: `Market` has no `createdAt` in storage at all — the
   * time a market was created exists only in the `MarketCreated` event, which
   * means an indexer. `chain` mode returns null and relies on
   * `MarketFactory.marketAt` being append-only, so creation ORDER survives even
   * where the timestamp does not.
   */
  createdAt: number | null;
  tradingEnd: number;
  collateral: CollateralInfo;
}

export interface MarketDetail extends MarketSummary {
  feeBps: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  /** The resolution rules, from the MarketSpec on 0G Storage. `null` for the same
   *  reason as `question`: the root is on chain, the text is not. */
  rules: string | null;
  /**
   * The prompt the creator committed the resolver to, from the MarketSpec.
   *
   * Distinct from `rules` and not a duplicate of it: the rules say what decides
   * the question, this says what the resolver is INSTRUCTED to do about them.
   * A settlement is judged against both, so a report that shows one and not the
   * other cannot be checked.
   */
  settlementPrompt: string | null;
  /**
   * The data sources the creator committed to, from the MarketSpec. `null` when
   * the document cannot be read — distinct from `[]`, which would claim the
   * creator named none.
   */
  sources: readonly SpecSource[] | null;
  /**
   * The side that won, read from `Market.winningOutcome` on chain.
   *
   * `null` means NOT RESOLVED, never "NO" — outcome 0 IS "NO" and the two must
   * not collapse. It comes from the chain rather than from the settlement
   * receipt because the chain is what pays out: a mode with no receipt still
   * knows who won, and a report that could not name the winner would be missing
   * the one fact everything else explains.
   */
  winningOutcome: Outcome | null;
  /** When `settle`/`fail`/`void` landed, unix seconds. `null` before that. */
  resolvedAt: number | null;
}

/** One source a MarketSpec commits its resolver to. */
export interface SpecSource {
  kind: string;
  url: string;
  selector: string | null;
}

export interface Trade {
  id: string;
  timestamp: number;
  trader: `0x${string}`;
  outcome: Outcome;
  /** Positive for a buy, negative for a sell. */
  sharesDelta: bigint;
  tokens: bigint;
  fee: bigint;
  /**
   * P(YES) after the trade — NOT the event's `probAfter` field.
   *
   * The contract emits `probability(qAfter, outcome)`: the probability of the
   * side that was traded. That is a deliberate choice and the event carries
   * `outcome` next to it, so the reading is recoverable — but a NO trade emits
   * P(NO), and a consumer that takes the number at face value plots the
   * complement of the series it thinks it is plotting. This field is normalised
   * at the decode site so nothing downstream has to remember.
   */
  probYesAfterWad: bigint;
}

export interface Candle {
  bucketStart: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

export interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;
  /**
   * Average entry price, wad. `null` means the current mode CANNOT know it —
   * not zero, and not "not loaded yet". Only events record what was paid, so
   * `chain` mode returns null here and the table renders
   * `<Unavailable capability="COST_BASIS">` in that cell. The type is
   * deliberately nullable so that a consumer which forgets will not compile.
   */
  entryPriceWad: bigint | null;
}

export interface ResolverVote {
  model: string;
  /** null = the resolver cast no vote (not yet revealed, or abstained). */
  outcome: Outcome | null;
  teeVerified: boolean;
  simulated: boolean;
}

export interface SettlementReceipt {
  /** null while the market has not been resolved. */
  outcome: Outcome | null;
  votes: ResolverVote[];
  judgeModel: string | null;
  /** The resolver's reasoning verbatim. NOT summarized — see spec §4.2. */
  reasoning: string;
  /**
   * The criteria the RESOLVER states it judged against, or `null` when it stated
   * none of its own.
   *
   * Not the same thing as the market's promised criteria, which live in the
   * MarketSpec and are shown beside these in the settlement report. A resolver
   * that judged against different criteria is exactly what a reader is checking
   * for, so the two must never be filled in from each other.
   */
  criteria: string | null;
  sources: string[];
  provider: `0x${string}`;
  /** The inference's id at the provider, or `null` when no model was consulted. */
  chatId: string | null;
  /** true when the receipt came from stub mode. Must be conspicuous in the UI. */
  simulated: boolean;
  /**
   * Whether a COMMITTEE decided this, or a single allowlisted key did.
   *
   * The module keeps `viaCommittee` for exactly this reason — a settlement by
   * one operator is a different claim from one reached by staked resolvers
   * voting blind, and the contract refuses to let the shortcut hide. The UI
   * called every settlement a "committee verdict" until this was read.
   */
  viaCommittee: boolean;
}

/**
 * The read contract. Note there is no method here for buying, selling, claiming
 * a settled position, or unwinding one, and that is not an oversight: the human
 * UI only observes (spec §1 F3). All execution lives in
 * `@brier/agent-kit`. This boundary is enforced by a test, not merely by
 * convention — see test/write-boundary.test.ts. (The two exit verbs are
 * deliberately paraphrased rather than named: that test greps every file in
 * this directory, comments included, for the literal chain-write terms.)
 */
export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
  getPositions(address: `0x${string}`): Promise<Position[]>;
  /**
   * An agent's FREE collateral — what it has not put into a market — in that
   * token's smallest unit.
   *
   * It takes the collateral address because a balance is a property of a token,
   * not of the system: two markets may settle in different tokens, and summing
   * across them would produce a number meaning nothing. On chain this is a plain
   * `IERC20.balanceOf` view call, which is why AGENT_BALANCE is answerable in
   * every mode rather than only where an indexer exists.
   *
   * Without it "account value" cannot be told the truth: positions alone are
   * what an agent has DEPLOYED, and calling that its account silently redefines
   * the term.
   */
  getBalance(agent: `0x${string}`, collateral: `0x${string}`): Promise<bigint>;
  /**
   * The resolver's record for a settlement, or `null` when the mode LOOKED and
   * this settlement anchored none.
   *
   * `null` is not `unavailable`. Unavailable means this mode cannot know; null
   * means it knows, and the answer is that no receipt exists — which is
   * permanently true of every market settled before `ResolutionModule` did, and
   * of any settled by an EOA holding the resolution role. Collapsing the two
   * would report a fact about the settlement as a limitation of the reader.
   */
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt | null>;

  /**
   * Display names for the keys that have traded, keyed by LOWERCASED address.
   *
   * A missing entry means no name is known, and that covers two causes on
   * purpose: the key acts for no registered agent, or no registry is configured
   * to ask. Both lead to the same honest display — the address itself — because
   * an address IS a complete identity, just an unfriendly one. This is the rare
   * case where two unknowns collapse safely, and it collapses because the
   * fallback is true in both.
   */
  getAgentNames(agents: readonly `0x${string}`[]): Promise<ReadonlyMap<string, string>>;
}
