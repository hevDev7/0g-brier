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
import {WAD, dpm, quote, toWad, networkFor, type ChainMode} from "@0g-delphi/protocol";
import {ERC20_ABI, FACTORY_ABI, MARKET_ABI, SHARES_ABI} from "./abi";
import {suggestFees} from "./fees";
import type {Claim, Fill, MarketView, Outcome, Preview, Tier, MarketStatus} from "./types";

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

export interface ClientConfig {
  network: ChainMode;
  /** The agent's OWN key. It never holds a user's — see spec §8.4 for the
   *  AgentAccount that will hold user funds under an on-chain policy. */
  privateKey: `0x${string}`;
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
 *    `@0g-delphi/protocol` only supplies the things a view cannot — what the
 *    trade does to the probability and to the payout. An agent that sized from
 *    a local model and signed against it would be trading a copy.
 *
 * 2. **A slippage bound is required, never defaulted.** `maxTokensIn` and
 *    `minTokensOut` have no safe default: zero and max-uint are both a standing
 *    offer to be filled at any price, and a bound the SDK invented would be a
 *    risk decision made by the wrong party.
 */
export class DelphiZeroClient {
  readonly account: Account;
  readonly address: `0x${string}`;

  private readonly publicClient: PublicClient;
  private readonly wallet: WalletClient;
  private readonly factory: `0x${string}`;
  private readonly shares: `0x${string}`;
  private readonly tokens = new Map<string, {symbol: string; decimals: number}>();

  constructor(config: ClientConfig) {
    const net = networkFor(config.network);
    const chain = defineChain({
      id: net.chainId,
      name: net.name,
      nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
      rpcUrls: {default: {http: [config.rpcUrl ?? net.rpcUrl]}},
    });
    const transport = config.transport ?? http(config.rpcUrl ?? net.rpcUrl);
    this.account = privateKeyToAccount(config.privateKey);
    this.address = this.account.address;
    this.publicClient = createPublicClient({chain, transport});
    this.wallet = createWalletClient({account: this.account, chain, transport});
    this.factory = config.factory;
    this.shares = config.outcomeShares;
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
