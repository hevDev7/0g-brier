import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  hexToString,
  type Account,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {keccak256, stringToHex, toBytes, pad} from "viem";
import {WAD, dpm, quote, toWad, networkFor, type ChainMode} from "@hevdev7/protocol";
import {AGENT_REGISTRY_ABI, CONFIG_ABI, ERC20_ABI, FACTORY_ABI, MARKET_ABI, SHARES_ABI} from "./abi.js";
import {suggestFees} from "./fees.js";
import type {Claim, Fill, MarketView, Outcome, Preview, Tier, MarketStatus} from "./types.js";

/** The order in `IMarket.Status`. */
const STATUSES: readonly MarketStatus[] = [
  "Open",
  "Closed",
  "Proposed",
  "Disputed",
  "Settled",
  "Failed",
  "Voided",
];

const TIERS: readonly Tier[] = ["FAST", "VERIFIED", "DETERMINISTIC"];

/** `IAgentRegistry.Role`, in the order the enum declares them. */
export const AGENT_ROLES = ["Creator", "Curator", "Resolver", "Trader"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

const AGENT_REGISTRY_KEY = keccak256(toBytes("AGENT_REGISTRY"));
const REQUIRE_REGISTERED_TRADER_KEY = keccak256(toBytes("REQUIRE_REGISTERED_TRADER"));

/**
 * A handle, as the chain stores it: bytes32, right-padded.
 *
 * 31 bytes, not 32 — `stringToHex` with `size: 32` would silently TRUNCATE a longer
 * name, and an agent discovering its handle was cut short after registering has no
 * way to tell that from having typed it wrong.
 */
export function encodeAgentName(name: string): `0x${string}` {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0) throw new Error("an agent name cannot be empty");
  if (bytes.length > 31) {
    throw new Error(`"${name}" is ${bytes.length} bytes; an agent name must fit in 31`);
  }
  return pad(stringToHex(name), {size: 32, dir: "right"});
}

export function decodeAgentName(raw: `0x${string}`): string | null {
  if (/^0x0*$/.test(raw)) return null;
  const name = hexToString(raw, {size: 32}).replace(/\0+$/, "");
  return name.length > 0 ? name : null;
}

export interface AgentIdentity {
  agentId: bigint;
  name: string | null;
  role: AgentRole;
  operator: `0x${string}`;
}

export interface ClientConfig {
  network: ChainMode;
  /**
   * The agent's OWN key. It never holds a user's — see spec §8.4 for the
   * AgentAccount that will hold user funds under an on-chain policy.
   *
   * OPTIONAL, because reading needs no signer. Omitting it gives a client that
   * can list markets, quote and preview, and that refuses every write with a
   * message naming the reason. The alternative was telling newcomers to pass a
   * throwaway key to look around, which teaches exactly the wrong habit and
   * invites somebody to paste a real one.
   */
  privateKey?: `0x${string}`;
  factory: `0x${string}`;
  outcomeShares: `0x${string}`;
  rpcUrl?: string;
  transport?: Transport;
}

/**
 * The agent's way in. Every buy, sell, redeem and liquidate in this project
 * goes through here — the web UI holds no signer at all (spec §1 F3).
 *
 * Two rules run through the whole surface:
 *
 * 1. **The chain's quote is what gets signed.** `preview()` reads
 *    `Market.quoteBuy` on chain and returns that number; the DPM mirror in
 *    `@hevdev7/protocol` only supplies the things a view cannot — what the
 *    trade does to the probability and to the payout. An agent that sized from
 *    a local model and signed against it would be trading a copy.
 *
 * 2. **A slippage bound is required, never defaulted.** `maxTokensIn` and
 *    `minTokensOut` have no safe default: zero and max-uint are both a standing
 *    offer to be filled at any price, and a bound the SDK invented would be a
 *    risk decision made by the wrong party.
 */
export class BrierClient {
  /** `null` on a read-only client. */
  readonly account: Account | null;
  /** The zero address when there is no key, so logging one never throws. */
  readonly address: `0x${string}`;
  /** Whether this client can sign. Check it rather than catching the throw. */
  readonly canWrite: boolean;

  private readonly publicClient: PublicClient;
  private readonly wallet: WalletClient | null;
  private readonly factory: `0x${string}`;
  private readonly shares: `0x${string}`;
  private readonly tokens = new Map<string, {symbol: string; decimals: number}>();
  /** `undefined` = not looked up; `null` = looked, and there is none. */
  private configAddress: `0x${string}` | null | undefined;
  private registryAddress: `0x${string}` | null | undefined;
  private gated: boolean | undefined;

  constructor(config: ClientConfig) {
    const net = networkFor(config.network);
    const chain = defineChain({
      id: net.chainId,
      name: net.name,
      nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
      rpcUrls: {default: {http: [config.rpcUrl ?? net.rpcUrl]}},
    });
    const transport = config.transport ?? http(config.rpcUrl ?? net.rpcUrl);
    this.account = config.privateKey ? privateKeyToAccount(config.privateKey) : null;
    this.address = this.account?.address ?? `0x${"0".repeat(40)}`;
    this.canWrite = this.account !== null;
    this.publicClient = createPublicClient({chain, transport});
    this.wallet = this.account ? createWalletClient({account: this.account, chain, transport}) : null;
    this.factory = config.factory;
    this.shares = config.outcomeShares;
  }

  /**
   * Refuse early, before any RPC.
   *
   * The guard inside `send` is the backstop, but every write reads first — a
   * market view, an allowance, a registry address — so a read-only client that
   * discovered its limitation there would already have spent three round trips
   * on a chain where each takes about a second and a half.
   */
  private requireSigner(verb: string): void {
    if (this.account === null) {
      throw new Error(
        `cannot ${verb}: this client has no private key, so it can only read. ` +
          "Pass `privateKey` to BrierClient to sign.",
      );
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async listMarkets(): Promise<MarketView[]> {
    const count = await this.publicClient.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "marketCount",
    });
    const addresses = await Promise.all(
      Array.from({length: Number(count)}, (_, i) =>
        this.publicClient.readContract({
          address: this.factory,
          abi: FACTORY_ABI,
          functionName: "marketAt",
          args: [BigInt(i)],
        }),
      ),
    );
    return Promise.all(addresses.map((a) => this.getMarket(a)));
  }

  async getMarket(market: `0x${string}`): Promise<MarketView> {
    // Narrowed to the argument-free views. Typing it as any ABI member would
    // let `buy` through, and `readContract` would then fail at runtime on a
    // name the compiler had accepted.
    type NullaryView =
      | "qArray"
      | "poolWad"
      | "status"
      | "tier"
      | "category"
      | "tradingEnd"
      | "collateral"
      | "specRoot"
      | "feeBps"
      | "winningOutcome"
      | "resolvedAt";
    const read = <T,>(functionName: NullaryView) =>
      this.publicClient.readContract({address: market, abi: MARKET_ABI, functionName}) as Promise<T>;

    const [q, poolWad, status, tier, category, tradingEnd, collateral, specRoot, feeBps, winner, resolvedAt] =
      await Promise.all([
        read<readonly [bigint, bigint]>("qArray"),
        read<bigint>("poolWad"),
        read<number>("status"),
        read<number>("tier"),
        read<`0x${string}`>("category"),
        read<bigint>("tradingEnd"),
        read<`0x${string}`>("collateral"),
        read<`0x${string}`>("specRoot"),
        read<number>("feeBps"),
        read<number>("winningOutcome"),
        read<bigint>("resolvedAt"),
      ]);

    const statusLabel = STATUSES[status];
    const tierLabel = TIERS[tier];
    if (statusLabel === undefined) throw new Error(`Market ${market} returned unknown status ${status}`);
    if (tierLabel === undefined) throw new Error(`Market ${market} returned unknown tier ${tier}`);

    const token = await this.tokenInfo(collateral);
    const qq = q as readonly [bigint, bigint];
    // Three states, not two, and the third is easy to miss.
    //
    // `winningOutcome` is 0 until a resolution lands, and 0 is also a winner, so
    // `resolvedAt` is what separates "unresolved" from "NO won". But `resolvedAt`
    // is ALSO set when a market FAILS or is VOIDED — where there is no winner at
    // all and both sides liquidate at their own price. A live committee returning
    // UNRESOLVABLE produced exactly that, and this read reported "NO won".
    const resolved = statusLabel === "Settled";

    return {
      address: market,
      status: statusLabel,
      tier: tierLabel,
      category: hexToString(category, {size: 32}),
      q: qq,
      poolWad,
      marginalPriceWad: [dpm.price(qq, 0), dpm.price(qq, 1)],
      impliedProbabilityWad: [dpm.probability(qq, 0), dpm.probability(qq, 1)],
      tradingEnd: Number(tradingEnd),
      feeBps,
      collateral,
      collateralDecimals: token.decimals,
      collateralSymbol: token.symbol,
      specRoot,
      winningOutcome: resolved ? ((winner === 1 ? 1 : 0) as Outcome) : null,
    };
  }

  /** The agent's FREE collateral — what it has not put into a market. */
  async getBalance(collateral: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: collateral,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.address],
    });
  }

  /**
   * Seed shares held on one side, wad.
   *
   * A liquidity provider's stake, held by the Market itself rather than by
   * OutcomeShares — so it is invisible to `getPosition`, and `redeem` pays for
   * it all the same. A market's creator is usually its largest winner, and a
   * client that ignored this would report a payout rate many times too high by
   * dividing the whole proceeds by a fraction of the shares.
   */
  async getSeedShares(market: `0x${string}`, outcome: Outcome): Promise<bigint> {
    const seed = await this.publicClient.readContract({
      address: market,
      abi: MARKET_ABI,
      functionName: "seedSharesOf",
      args: [this.address],
    });
    return seed[outcome];
  }

  /** TRADABLE shares held on one side of one market, wad. Excludes seed. */
  async getPosition(market: `0x${string}`, outcome: Outcome): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.shares,
      abi: SHARES_ABI,
      functionName: "balanceOfOutcome",
      args: [this.address, market, outcome],
    });
  }

  // ── identity ─────────────────────────────────────────────────────────────

  /**
   * Register this agent, so its trades can be attributed to a name.
   *
   * PERMISSIONLESS — nobody grants this. An identity here is a handle the protocol
   * can display, not a licence, and what it costs is a name nobody else has taken.
   *
   * The operator defaults to the key this client signs with, because that is the
   * key whose trades need attributing. Pass one explicitly to register on behalf of
   * a machine that will sign elsewhere.
   */
  async registerAgent(args: {
    name: string;
    role?: AgentRole;
    operator?: `0x${string}`;
    metadataRoot?: `0x${string}`;
  }): Promise<AgentIdentity> {
    this.requireSigner("registerAgent");
    const registry = await this.requireAgentRegistry();
    const operator = args.operator ?? this.address;
    const role = AGENT_ROLES.indexOf(args.role ?? "Trader");

    // Checked before spending gas, and separately, because the two failures need
    // different fixes: a taken name wants a different name, a busy key wants a
    // different key.
    const encoded = encodeAgentName(args.name);
    if (await this.publicClient.readContract({address: registry, abi: AGENT_REGISTRY_ABI, functionName: "nameTaken", args: [encoded]})) {
      throw new Error(`the name "${args.name}" is already registered`);
    }
    const acting = await this.publicClient.readContract({
      address: registry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "agentOf",
      args: [operator],
    });
    if (acting !== 0n) throw new Error(`${operator} already acts for agent ${acting}`);

    await this.send(registry, AGENT_REGISTRY_ABI, "register", [
      role,
      operator,
      encoded,
      args.metadataRoot ?? `0x${"0".repeat(64)}`,
    ]);
    // Read back rather than trusting the return value of a transaction, which a
    // receipt does not carry.
    const identity = await this.agentOf(operator);
    if (identity === null) throw new Error("registration landed but the agent cannot be found");
    return identity;
  }

  /**
   * The 0G Storage root of an agent's persona document, or the zero hash.
   *
   * Zero is the common case and means nothing has been published, NOT that the
   * agent is invalid — `register` defaults the field, so an agent created
   * without one reads as zero forever until this is set.
   */
  async metadataRootOf(agentId: bigint): Promise<`0x${string}`> {
    const registry = await this.requireAgentRegistry();
    return this.publicClient.readContract({
      address: registry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "metadataRootOf",
      args: [agentId],
    });
  }

  /**
   * Point an agent at a persona document on 0G Storage.
   *
   * The root goes on chain VERBATIM — it is the content address, and hashing it
   * again produces a bytes32 nothing can be fetched with. Caller must own the
   * agent, not merely operate it.
   */
  async setAgentMetadata(agentId: bigint, metadataRoot: `0x${string}`): Promise<`0x${string}`> {
    this.requireSigner("setAgentMetadata");
    const registry = await this.requireAgentRegistry();
    return this.send(registry, AGENT_REGISTRY_ABI, "updateMetadata", [agentId, metadataRoot, "0x"]);
  }

  /** Rename an agent. Releases the old handle for someone else. */
  async setAgentName(agentId: bigint, name: string): Promise<`0x${string}`> {
    this.requireSigner("setAgentName");
    const registry = await this.requireAgentRegistry();
    return this.send(registry, AGENT_REGISTRY_ABI, "setName", [agentId, encodeAgentName(name)]);
  }

  /** Rotate the key that trades for an agent. The old key stops being it. */
  async setAgentOperator(agentId: bigint, operator: `0x${string}`): Promise<`0x${string}`> {
    this.requireSigner("setAgentOperator");
    const registry = await this.requireAgentRegistry();
    return this.send(registry, AGENT_REGISTRY_ABI, "setOperator", [agentId, operator]);
  }

  /** This client's own identity, or `null` if its key acts for no agent. */
  async myAgent(): Promise<AgentIdentity | null> {
    return this.agentOf(this.address);
  }

  async agentOf(operator: `0x${string}`): Promise<AgentIdentity | null> {
    const registry = await this.agentRegistry();
    if (registry === null) return null;
    const agentId = await this.publicClient.readContract({
      address: registry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "agentOf",
      args: [operator],
    });
    if (agentId === 0n) return null;
    const [rawName, role] = await Promise.all([
      this.publicClient.readContract({address: registry, abi: AGENT_REGISTRY_ABI, functionName: "nameOf", args: [agentId]}),
      this.publicClient.readContract({address: registry, abi: AGENT_REGISTRY_ABI, functionName: "roleOf", args: [agentId]}),
    ]);
    return {
      agentId,
      name: decodeAgentName(rawName),
      role: AGENT_ROLES[role] ?? "Trader",
      operator,
    };
  }

  /**
   * Whether this deployment requires a registered Trader before it will take an
   * order, so a client can say so before a revert does.
   */
  async requiresRegisteredTrader(): Promise<boolean> {
    const config = await this.configRegistry();
    if (config === null) return false;
    const value = await this.publicClient.readContract({
      address: config,
      abi: CONFIG_ABI,
      functionName: "params",
      args: [REQUIRE_REGISTERED_TRADER_KEY],
    });
    return value !== 0n;
  }

  // ── quotes ───────────────────────────────────────────────────────────────

  /**
   * What `sharesOut` would cost, and what buying them would do to the market.
   *
   * `tokensIn` comes from `Market.quoteBuy` — the same view the contract will
   * re-run when the transaction lands. Everything else is derived locally,
   * because no view returns it: a probability, and above all the payout per
   * share BEFORE and AFTER. That last pair is the one an LMSR-shaped agent has
   * no place to put, and the one that makes a naive Kelly fraction too large.
   */
  async previewBuy(market: `0x${string}`, outcome: Outcome, sharesOut: bigint): Promise<Preview> {
    const [tokensIn, feeTokens] = await this.publicClient.readContract({
      address: market,
      abi: MARKET_ABI,
      functionName: "quoteBuy",
      args: [outcome, sharesOut],
    });
    const view = await this.getMarket(market);
    const qAfter = quote.qAfterBuy(view.q, outcome, sharesOut);
    const grossWad = toWad(tokensIn, view.collateralDecimals);

    return {
      tokensIn,
      feeTokens,
      sharesOut,
      avgPriceWad: sharesOut === 0n ? 0n : (grossWad * WAD) / sharesOut,
      impliedProbabilityBeforeWad: dpm.probability(view.q, outcome),
      impliedProbabilityAfterWad: dpm.probability(qAfter, outcome),
      payoutPerShareBeforeWad: quote.payoutPerShareWad(view.q, outcome),
      payoutPerShareAfterWad: quote.payoutPerShareWad(qAfter, outcome),
    };
  }

  /** How many shares a budget buys, from the contract's own inversion. */
  async quoteBuySpend(
    market: `0x${string}`,
    outcome: Outcome,
    tokensIn: bigint,
  ): Promise<{sharesOut: bigint; feeTokens: bigint}> {
    const [sharesOut, feeTokens] = await this.publicClient.readContract({
      address: market,
      abi: MARKET_ABI,
      functionName: "quoteBuySpend",
      args: [outcome, tokensIn],
    });
    return {sharesOut, feeTokens};
  }

  async quoteSell(
    market: `0x${string}`,
    outcome: Outcome,
    sharesIn: bigint,
  ): Promise<{tokensOut: bigint; feeTokens: bigint}> {
    const [tokensOut, feeTokens] = await this.publicClient.readContract({
      address: market,
      abi: MARKET_ABI,
      functionName: "quoteSell",
      args: [outcome, sharesIn],
    });
    return {tokensOut, feeTokens};
  }

  /**
   * The largest slice of `budgetTokens` whose purchase keeps the implied
   * probability move within `maxImpactBps`.
   *
   * Kelly says how much of the BANKROLL to risk. It knows nothing about the
   * book, and on a DPM curve that gap is not academic: a Kelly-sized order into
   * a thin market walks the probability to certainty and collapses the payout to
   * 1.0×, destroying the edge the sizing was computed from. This SDK's own first
   * live order previewed exactly that — 50% → 100%, payout 1.4142× → 1.0000× —
   * which is why the primitive lives here rather than in each agent.
   *
   * Searched against the local DPM mirror, so it costs one `getMarket` rather
   * than a round trip per iteration. The number it returns is then quoted on
   * chain like any other, because the mirror sizes and the chain prices.
   */
  async sizeWithinImpact(args: {
    market: `0x${string}`;
    outcome: Outcome;
    budgetTokens: bigint;
    maxImpactBps: bigint;
  }): Promise<bigint> {
    const view = await this.getMarket(args.market);
    const before = dpm.probability(view.q, args.outcome);
    const ceiling = before + (WAD * args.maxImpactBps) / 10_000n;

    const impactOf = (tokens: bigint): bigint => {
      if (tokens <= 0n) return before;
      try {
        const shares = dpm.sharesForSpend(view.q, args.outcome, toWad(tokens, view.collateralDecimals));
        return dpm.probability(quote.qAfterBuy(view.q, args.outcome, shares), args.outcome);
      } catch {
        // Past the curve's limits. Treated as maximum impact so the search backs
        // off rather than proposing a spend the contract would reject.
        return WAD;
      }
    };

    if (impactOf(args.budgetTokens) <= ceiling) return args.budgetTokens;

    // Bisect. `lo` always fits and `hi` never does, so the loop cannot return a
    // budget that breaches the bound even if it exits early.
    let lo = 0n;
    let hi = args.budgetTokens;
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if (impactOf(mid) <= ceiling) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * Approve `market` to spend collateral, if it cannot already spend enough.
   *
   * Returns `null` when the allowance was already sufficient — an agent that
   * approves before every order pays gas to change nothing.
   */
  async ensureAllowance(
    market: `0x${string}`,
    collateral: `0x${string}`,
    minimum: bigint,
  ): Promise<`0x${string}` | null> {
    this.requireSigner("ensureAllowance");
    const current = await this.publicClient.readContract({
      address: collateral,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.address, market],
    });
    if (current >= minimum) return null;
    return this.send(collateral, ERC20_ABI, "approve", [market, minimum]);
  }

  /**
   * @param maxTokensIn the most the agent will pay. REQUIRED: see the class note.
   */
  async buyShares(args: {
    market: `0x${string}`;
    outcome: Outcome;
    sharesOut: bigint;
    maxTokensIn: bigint;
  }): Promise<Fill> {
    this.requireSigner("buyShares");
    await this.requireIdentityIfGated();
    const before = await this.balanceOfCollateral(args.market);
    const hash = await this.send(args.market, MARKET_ABI, "buy", [
      args.outcome,
      args.sharesOut,
      args.maxTokensIn,
      this.address,
    ]);
    return this.fillFrom(hash, args.market, args.outcome, before);
  }

  /**
   * @param minTokensOut the least the agent will accept. REQUIRED.
   */
  async sellShares(args: {
    market: `0x${string}`;
    outcome: Outcome;
    sharesIn: bigint;
    minTokensOut: bigint;
  }): Promise<Fill> {
    this.requireSigner("sellShares");
    await this.requireIdentityIfGated();
    const before = await this.balanceOfCollateral(args.market);
    const hash = await this.send(args.market, MARKET_ABI, "sell", [
      args.outcome,
      args.sharesIn,
      args.minTokensOut,
      this.address,
    ]);
    return this.fillFrom(hash, args.market, args.outcome, before);
  }

  /**
   * Claim a winning position after settlement.
   *
   * Works while the protocol is paused, and that is a guarantee rather than an
   * accident: pause never blocks an exit (spec §6), and the contracts have a
   * test saying so.
   */
  async redeem(market: `0x${string}`): Promise<Claim> {
    this.requireSigner("redeem");
    const view = await this.getMarket(market);
    if (view.winningOutcome === null) {
      throw new Error(`market ${market} has not been resolved — there is nothing to redeem`);
    }
    // Tradable AND seed, because the contract burns and pays for both.
    const [tradable, seed] = await Promise.all([
      this.getPosition(market, view.winningOutcome),
      this.getSeedShares(market, view.winningOutcome),
    ]);
    return this.claim(market, view.collateral, tradable + seed);
  }

  /**
   * Exit at `pᵢ` after a failed or voided market, where BOTH sides are paid.
   * Also works while paused.
   */
  async liquidate(market: `0x${string}`): Promise<Claim> {
    this.requireSigner("liquidate");
    const view = await this.getMarket(market);
    const [no, yes, seedNo, seedYes] = await Promise.all([
      this.getPosition(market, 0),
      this.getPosition(market, 1),
      this.getSeedShares(market, 0),
      this.getSeedShares(market, 1),
    ]);
    return this.claim(market, view.collateral, no + yes + seedNo + seedYes, "liquidate");
  }

  private async claim(
    market: `0x${string}`,
    collateral: `0x${string}`,
    sharesBefore: bigint,
    verb: "redeem" | "liquidate" = "redeem",
  ): Promise<Claim> {
    const before = await this.getBalance(collateral);
    const hash = await this.send(market, MARKET_ABI, verb, [this.address]);
    const after = await this.getBalance(collateral);
    // Measured, not quoted. `redeem` pays for the tradable position AND for seed
    // shares on the winning side, so a figure derived from the tradable balance
    // alone would understate what a market's creator actually receives.
    return {hash, tokensReceived: after - before, sharesBefore};
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Stop before spending gas on an order the market will refuse.
   *
   * The contract's own check is what enforces this; this only makes the refusal
   * legible. A raw `UnregisteredTrader` from inside a market tells an operator
   * nothing about what to do next, and it arrives after the gas is gone.
   *
   * Both reads are session-stable and cached, so the happy path costs one round
   * trip on the first order and nothing after.
   *
   * NOT applied to `redeem` or `liquidate`: exits are never gated, and a client
   * that refused one because an identity had lapsed would be inventing a rule the
   * contract does not have.
   */
  private async requireIdentityIfGated(): Promise<void> {
    if (this.gated === undefined) this.gated = await this.requiresRegisteredTrader();
    if (!this.gated) return;
    const identity = await this.myAgent();
    if (identity === null) {
      throw new Error(
        `${this.address} acts for no registered agent, and this deployment only accepts ` +
          "orders from one. Call registerAgent({name}) first.",
      );
    }
    if (identity.role !== "Trader") {
      throw new Error(
        `agent ${identity.agentId} ("${identity.name}") is registered as a ${identity.role}, not a Trader. ` +
          "A resolver holding a position in a market it may be sampled to judge is the conflict the roles separate.",
      );
    }
  }

  private async configRegistry(): Promise<`0x${string}` | null> {
    if (this.configAddress !== undefined) return this.configAddress;
    try {
      this.configAddress = await this.publicClient.readContract({
        address: this.factory,
        abi: FACTORY_ABI,
        functionName: "config",
      });
    } catch {
      this.configAddress = null;
    }
    return this.configAddress;
  }

  /** Found the way the contracts find it, never from configuration handed in. */
  private async agentRegistry(): Promise<`0x${string}` | null> {
    if (this.registryAddress !== undefined) return this.registryAddress;
    const config = await this.configRegistry();
    if (config === null) return (this.registryAddress = null);
    const registry = await this.publicClient.readContract({
      address: config,
      abi: CONFIG_ABI,
      functionName: "addresses",
      args: [AGENT_REGISTRY_KEY],
    });
    this.registryAddress = /^0x0+$/.test(registry) ? null : registry;
    return this.registryAddress;
  }

  private async requireAgentRegistry(): Promise<`0x${string}`> {
    const registry = await this.agentRegistry();
    if (registry === null) {
      throw new Error("this deployment has no AgentRegistry — there is nothing to register with");
    }
    return registry;
  }

  private async tokenInfo(address: `0x${string}`): Promise<{symbol: string; decimals: number}> {
    const key = address.toLowerCase();
    const cached = this.tokens.get(key);
    if (cached) return cached;
    const [symbol, decimals] = await Promise.all([
      this.publicClient.readContract({address, abi: ERC20_ABI, functionName: "symbol"}),
      this.publicClient.readContract({address, abi: ERC20_ABI, functionName: "decimals"}),
    ]);
    const info = {symbol, decimals};
    this.tokens.set(key, info);
    return info;
  }

  private async balanceOfCollateral(market: `0x${string}`): Promise<bigint> {
    const {collateral} = await this.getMarket(market);
    return this.getBalance(collateral);
  }

  /**
   * The fill as the CHAIN reports it after the fact, not as the quote predicted.
   * A quote is what was asked for; between asking and mining, another agent may
   * have moved the curve, and the difference is exactly what a slippage bound
   * exists to cap rather than to hide.
   */
  private async fillFrom(
    hash: `0x${string}`,
    market: `0x${string}`,
    outcome: Outcome,
    collateralBefore: bigint,
  ): Promise<Fill> {
    const view = await this.getMarket(market);
    const [sharesAfter, after] = await Promise.all([
      this.getPosition(market, outcome),
      this.getBalance(view.collateral),
    ]);
    return {
      hash,
      sharesAfter,
      tokensDelta: after - collateralBefore,
      impliedProbabilityAfterWad: view.impliedProbabilityWad,
    };
  }

  private async send(
    address: `0x${string}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper for several ABIs
    abi: any,
    functionName: string,
    args: readonly unknown[],
  ): Promise<`0x${string}`> {
    if (this.wallet === null || this.account === null) {
      // Named at the point of use rather than at construction: a read-only
      // client is a legitimate thing to build, and the failure belongs where
      // somebody actually asks it to sign.
      throw new Error(
        `cannot ${functionName}: this client has no private key, so it can only read. ` +
          "Pass `privateKey` to BrierClient to sign.",
      );
    }
    const fees = await suggestFees(this.publicClient);
    const hash = await this.wallet.writeContract({
      address,
      abi,
      functionName,
      args,
      account: this.account,
      chain: this.wallet.chain,
      ...fees,
    });
    const receipt = await this.awaitReceipt(hash, functionName);
    // A receipt is proof the transaction was MINED, not that it succeeded. Not
    // checking `status` is how a reverted order gets reported as a fill.
    if (receipt.status !== "success") {
      throw new Error(`${functionName} reverted on chain: ${hash}`);
    }
    return hash;
  }

  /**
   * Poll for the receipt rather than watch for it.
   *
   * viem's `waitForTransactionReceipt` follows new blocks and asks for the
   * receipt when one arrives. On 0G that races: the block is announced before
   * the receipt is queryable, the lookup returns null, and the call throws
   * `TransactionReceiptNotFoundError` for a transaction that is perfectly fine —
   * as this very SDK's first live order did, on the approve. Polling tolerates
   * the gap, which is what the shell scripts in this repo already had to do.
   */
  private async awaitReceipt(hash: `0x${string}`, what: string, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        return await this.publicClient.getTransactionReceipt({hash});
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`${what}: no receipt for ${hash} after ${timeoutMs / 1000}s`);
        }
        await new Promise((r) => setTimeout(r, 1_500));
      }
    }
  }
}
