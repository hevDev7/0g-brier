/**
 * One pass over every market, doing the work the clock makes due.
 *
 *   npx tsx examples/keeper.ts              — act
 *   DRY_RUN=1 npx tsx examples/keeper.ts    — decide and report, send nothing
 *
 * Nothing in this protocol advances on its own. `close()` is permissionless and
 * `fail()` becomes permissionless once the settlement deadline passes, but both
 * still need somebody to send a transaction — and until this file existed,
 * nobody did. Three markets sat an hour past their trading window with every
 * exit reverting: `sell` with `TradingEnded`, `redeem` with `NotSettled`,
 * `liquidate` with `NotLiquidatable`. That is what a missing keeper looks like
 * from a holder's side.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not decide outcomes. Choosing YES or NO is the committee's job, and
 * doing it needs staked resolvers, gathered evidence and an attested model —
 * none of which a scheduled script should quietly stand in for. Where a market
 * needs that judgement, the keeper says so and moves on. A keeper that invents a
 * settlement to leave a tidy console is worse than one that leaves work visible.
 *
 * WHEN IT DRAWS
 *
 * Drawing a committee is what STARTS the commit and reveal windows —
 * `openResolution` dates them from the block it lands in and checks no deadline
 * of its own — so whoever draws chooses the hour by which a resolver must have
 * voted. This pass used to draw the instant it saw a market go Closed. On
 * 2026-09-01 that shut the reveal window on 0xCDc13Cc2… (16661) one hour and
 * fifty-eight minutes before the baseball game it asked about could be Final:
 * three resolvers were seated, none of them could honestly vote, and the market
 * failed with commits=0 and reveals=0. Nobody misbehaved. The draw was simply 117
 * seconds after `tradingEnd` and the question was not yet answerable.
 *
 * So round one now waits for `resolvesBy` — the instant the market's own spec
 * says its question becomes decidable — bounded by the last moment at which a
 * whole round still fits inside the settlement deadline. `drawDecision` below is
 * that rule, and it is the one piece of this file with a test. Round two is never
 * held back: a dispute only exists after a round has already been answered, so
 * the event is long decided by then.
 *
 * A PASS, NOT A DAEMON
 *
 * Run it on a schedule. A long-lived process drifts, leaks, and dies quietly at
 * three in the morning; a pass that exits either did its work or failed loudly
 * enough to be noticed, and a missed tick costs one interval rather than a
 * service. It is idempotent: every action re-checks its precondition against
 * live chain state immediately before sending, so two overlapping runs cannot
 * both act.
 */
import {createPublicClient, createWalletClient, defineChain, http, keccak256, toHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {realpathSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {loadDeployment} from "@0g-brier/protocol/node";
import {ZgStore} from "@0g-brier/zg-storage";
import {BrierClient, MARKET_ABI} from "../src/index";
import {CONFIG_ABI} from "../src/abi";
import {modeForChainId, networkForChainId} from "@0g-brier/protocol";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const RPC = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const DRY = process.env.DRY_RUN === "1";

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const chain = defineChain({
  id: CHAIN_ID,
  name: modeForChainId(CHAIN_ID),
  nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});
const pub = createPublicClient({chain, transport: http(RPC)});

/**
 * The account this pass signs with, and everything derived from it — built on
 * first use rather than at import.
 *
 * THE DEMAND FOR A KEY USED TO SIT AT THE TOP OF THE FILE, and that is why the
 * one judgement here that has already cost a real market — when to draw — had no
 * test. Reaching `drawDecision` meant importing this module, and importing it
 * demanded a signing key, a manifest and then a node, none of which a schedule
 * needs. Nothing above `main()` signs anything, so nothing above `main()` asks
 * for a key: a run without one still dies on its first piece of work, and still
 * dies before it can send.
 */
function buildSigner() {
  const rawKey = process.env.KEEPER_KEY ?? process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
  if (!rawKey) throw new Error("set KEEPER_KEY (or DEPLOYER_KEY) — the keeper signs its own transactions");
  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  return {
    account,
    wallet: createWalletClient({account, chain, transport: http(RPC)}),
    client: new BrierClient({
      network: modeForChainId(CHAIN_ID),
      privateKey: key,
      factory: manifest.contracts.MarketFactory as `0x${string}`,
      outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
    }),
  };
}
let signerCache: ReturnType<typeof buildSigner> | null = null;
const signer = () => (signerCache ??= buildSigner());

/**
 * Galileo prices the two halves of a fee very differently and both must be asked
 * of the node: the base fee is single-digit wei while the minimum tip is 4 gwei.
 * Most tools default the tip to 1 and are rejected with "gas price below
 * minimum"; setting only the tip fails differently, because the ceiling is then
 * derived from that tiny base.
 */
async function fees() {
  const [tip, block] = await Promise.all([
    pub.request({method: "eth_maxPriorityFeePerGas"}) as Promise<`0x${string}`>,
    pub.getBlock(),
  ]);
  const maxPriorityFeePerGas = BigInt(tip);
  const base = block.baseFeePerGas ?? 0n;
  return {maxPriorityFeePerGas, maxFeePerGas: maxPriorityFeePerGas + base * 4n + 1_000_000_000n};
}

/**
 * Polled, not watched.
 *
 * `waitForTransactionReceipt` subscribes to new blocks and asks about the hash as
 * they arrive. Galileo answers those subscriptions unreliably, so the first
 * attempt at this threw `TransactionReceiptNotFoundError` on a transaction that
 * had in fact already succeeded — the keeper reported a crash and the market was
 * closed. Asking directly, on a timer, is what the SDK's own `awaitReceipt` does
 * and for the same reason.
 */
async function receiptOf(hash: `0x${string}`, what: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await pub.getTransactionReceipt({hash});
    } catch {
      if (Date.now() > until) throw new Error(`${what}: no receipt for ${hash} after ${timeoutMs / 1000}s`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

/**
 * The ResolutionModule's surface, written out here rather than added to
 * `@0g-brier/agent-kit`. That package is the trading client; how settlement is
 * opened is not its business, and giving it the knowledge would put the
 * committee's shape into every agent that only wants to buy.
 */
const RESOLUTION_ABI = [
  {
    name: "requestResolution",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{name: "market", type: "address"}],
    outputs: [],
  },
  {
    name: "openResolution",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{name: "market", type: "address"}],
    outputs: [],
  },
  {
    name: "openDisputeRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{name: "market", type: "address"}],
    outputs: [],
  },
  {
    name: "drawOf",
    type: "function",
    stateMutability: "view",
    inputs: [{name: "market", type: "address"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "drawBlock", type: "uint64"},
          {name: "index", type: "uint8"},
        ],
      },
    ],
  },
  {
    name: "committeeOf",
    type: "function",
    stateMutability: "view",
    inputs: [{name: "market", type: "address"}],
    outputs: [{type: "uint256[]"}],
  },
  {
    name: "markFailed",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{name: "market", type: "address"}],
    outputs: [],
  },
] as const;

/** What `drawDecision` decided, and the instants it decided it from. */
export type DrawDecision =
  | {
      act: "draw";
      /** The instant the draw became due. `now` when the spec names no event. */
      drawAt: number;
      /** How far `resolvesBy` overruns the last useful draw. 0 when the spec fits. */
      shortfall: number;
      why: "decidable-at-close" | "question-answerable" | "deadline-forces-it";
    }
  | {act: "defer"; drawAt: number; resolvesBy: number; shortfall: number};

/**
 * When round one's committee may be drawn — the fix for the incident at the top
 * of this file, kept pure so it can be tested against the numbers that caused it.
 *
 * TWO INSTANTS BOUND THE DRAW, from opposite sides.
 *
 *   `resolvesBy` is the earliest useful one. It is the instant the market's own
 *   MarketSpec says its question becomes decidable, and drawing before it seats a
 *   committee that must vote on something that has not happened. Nothing read it
 *   until now: the field was written by scripts/market-spec.py and consumed by no
 *   runtime code at all, which is exactly how a market could be created with an
 *   answerable question and still die unanswered.
 *
 *   `settlementDeadline - (COMMIT_WINDOW + REVEAL_WINDOW)` is the latest useful
 *   one, because `openResolution` dates both windows from the draw and a reveal
 *   that lands after the deadline is a reveal nobody can act on.
 *
 * So `drawAt = min(resolvesBy, latestUsefulDraw)`. The `min` is not symmetry for
 * its own sake: when the two cross — a spec whose event resolves too close to its
 * own deadline for a round to fit — the deadline wins and the draw goes in late
 * but INSIDE, because a committee with a shortened window can still answer and a
 * committee never seated cannot. `shortfall` says how many seconds were lost so
 * the caller can say so out loud; market-spec.py refuses to create such a market
 * in the first place, and a positive `shortfall` here means one predates that
 * refusal.
 *
 * A `resolvesBy` of 0, null or undefined means "decidable as soon as the market
 * closes" — market-spec.py's `selftest` category, whose question is answered from
 * the market's own chain state — and draws immediately, which is what this keeper
 * did for everything before today.
 *
 * The windows are arguments rather than constants because they are ConfigRegistry
 * parameters: 3600 apiece on 16661 today, and 300/120 while scripts/committee-run.mjs
 * has a demo in flight. Writing either number down here would make this agree with
 * the chain only by luck.
 */
export function drawDecision(x: {
  now: number;
  resolvesBy: number | null | undefined;
  settlementDeadline: number;
  commitWindow: number;
  revealWindow: number;
}): DrawDecision {
  const latestUsefulDraw = x.settlementDeadline - (x.commitWindow + x.revealWindow);
  if (!x.resolvesBy) return {act: "draw", drawAt: x.now, shortfall: 0, why: "decidable-at-close"};

  const shortfall = Math.max(0, x.resolvesBy - latestUsefulDraw);
  const drawAt = Math.min(x.resolvesBy, latestUsefulDraw);
  if (x.now < drawAt) return {act: "defer", drawAt, resolvesBy: x.resolvesBy, shortfall};
  return {act: "draw", drawAt, shortfall, why: shortfall > 0 ? "deadline-forces-it" : "question-answerable"};
}

/**
 * COMMIT_WINDOW and REVEAL_WINDOW, off the chain and cached for the pass.
 *
 * Governance owns both and moves them — committee-run.mjs shortens them to 300 and
 * 120 so a rehearsal finishes in minutes — so a keeper carrying 3600 in its source
 * would compute a draw instant that the module it is calling disagrees with. Read
 * once per pass rather than once per market: they cannot change mid-pass in any way
 * that matters, and a keeper watching ten markets should not make twenty calls to
 * learn two numbers.
 */
const configKey = (name: string) => keccak256(toHex(name));
let windowCache: {commit: number; reveal: number} | null = null;
async function resolutionWindows(): Promise<{commit: number; reveal: number}> {
  if (windowCache !== null) return windowCache;
  const registry = manifest.contracts.ConfigRegistry as `0x${string}`;
  const [commit, reveal] = await Promise.all([
    pub.readContract({address: registry, abi: CONFIG_ABI, functionName: "params", args: [configKey("COMMIT_WINDOW")]}),
    pub.readContract({address: registry, abi: CONFIG_ABI, functionName: "params", args: [configKey("REVEAL_WINDOW")]}),
  ]);
  windowCache = {commit: Number(commit), reveal: Number(reveal)};
  return windowCache;
}

/**
 * `resolvesBy` out of the MarketSpec the market's `specRoot` names, or null.
 *
 * `ZgStore.get` verifies the bytes against the root before parsing, so a document
 * that arrives is the document the market committed to — it throws
 * `SpecRootMismatchError` rather than hand back something that merely looks right.
 * It also throws when the indexer is unreachable, and returns null only for a root
 * genuinely never uploaded. The caller depends on that distinction: a null is a
 * spec that says nothing about when its question resolves, which is the same as
 * saying "at close"; a throw is a spec this pass has not managed to read yet.
 *
 * A chain with no storage network — anvil, where `indexerUrl` is null — also
 * returns null. A local demo's spec is a fixture rather than a 0G document, there
 * is no `resolvesBy` to honour, and `make demo` must not start deferring draws to
 * an instant nothing can supply.
 */
async function resolvesByOf(specRoot: `0x${string}`): Promise<number | null> {
  const indexer = process.env.ZG_INDEXER ?? networkForChainId(CHAIN_ID).indexerUrl;
  if (indexer === null) return null;
  const spec = (await new ZgStore(indexer).get(specRoot)) as {resolvesBy?: unknown} | null;
  const value = spec?.resolvesBy;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ask for a committee, or draw one that has been asked for.
 *
 * TWO CALLS, and the gap between them is the security property — see
 * `ResolutionModule.requestResolution`. The committee is seeded from the hash of a
 * block that has not been mined when the request goes in, so nobody, this keeper
 * included, can see what they are about to draw. A single call would let whoever
 * sends it simulate the draw first and only transact on a committee it liked.
 *
 * Returns what it did, so the caller can log it and decide when to come back.
 */
async function advanceDraw(
  market: `0x${string}`,
  round: 1 | 2,
): Promise<{action: "requested" | "drawn" | "waiting" | "blocked"; detail: string}> {
  const {account, wallet} = signer();
  const draw = await pub.readContract({
    address: RESOLUTION_MODULE,
    abi: RESOLUTION_ABI,
    functionName: "drawOf",
    args: [market],
  });
  const head = await pub.getBlockNumber();

  // No draw outstanding, or one belonging to the other round: ask for this one.
  // Round 2's draw is requested by `dispute` itself, so `round === 2` reaching here
  // with nothing outstanding means the draw expired and must be asked for again.
  if (draw.drawBlock === 0n || draw.index !== round) {
    if (!DRY) {
      const hash = await wallet.writeContract({
        address: RESOLUTION_MODULE,
        abi: RESOLUTION_ABI,
        functionName: "requestResolution",
        args: [market],
        ...(await fees()),
      });
      const receipt = await receiptOf(hash, "requestResolution");
      if (receipt.status !== "success") throw new Error(`requestResolution reverted: ${hash}`);
    }
    return {action: "requested", detail: "asked for a committee; the draw block is not mined yet"};
  }

  if (head <= draw.drawBlock) {
    return {action: "waiting", detail: `draw block ${draw.drawBlock} not mined (head ${head})`};
  }

  // Past 256 blocks the EVM stops answering for that hash and the draw is dead. The
  // module refuses to sample from the zero it would otherwise get, so ask again.
  if (head - draw.drawBlock > 250n) {
    if (!DRY) {
      const hash = await wallet.writeContract({
        address: RESOLUTION_MODULE,
        abi: RESOLUTION_ABI,
        functionName: "requestResolution",
        args: [market],
        ...(await fees()),
      });
      await receiptOf(hash, "requestResolution");
    }
    return {action: "requested", detail: "the previous draw fell out of the blockhash window"};
  }

  const fn = round === 1 ? "openResolution" : "openDisputeRound";
  // Simulated first, and not as belt-and-braces. `NotEnoughResolvers` is raised HERE,
  // at the draw, not at the request — the registry may hold fewer staked agents than
  // the tier's committee needs, and that does not clear on its own. Sending blind
  // would pay gas every tick to be told the same thing. A reverted draw leaves the
  // request intact, so a retry after more resolvers register still works.
  try {
    await pub.simulateContract({
      address: RESOLUTION_MODULE,
      abi: RESOLUTION_ABI,
      functionName: fn,
      args: [market],
      account: account.address,
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const why = text.includes("0x2cb54a66")
      ? "not enough registered resolvers for this tier's committee"
      : (text.match(/0x[0-9a-f]{8}/)?.[0] ?? text.split("\n")[0] ?? text).slice(0, 80);
    return {action: "blocked", detail: why};
  }

  if (!DRY) {
    const hash = await wallet.writeContract({
      address: RESOLUTION_MODULE,
      abi: RESOLUTION_ABI,
      functionName: fn,
      args: [market],
      ...(await fees()),
    });
    const receipt = await receiptOf(hash, fn);
    if (receipt.status !== "success") throw new Error(`${fn} reverted: ${hash}`);
  }
  return {action: "drawn", detail: "committee seated; the commit window is open"};
}

/** The useful sentence out of a viem error, without the stack of ABI dumps. */
function reasonOf(err: unknown): string {
  const text = err instanceof Error ? ((err as {shortMessage?: string}).shortMessage ?? err.message) : String(err);
  return (text.split("\n")[0] ?? text).slice(0, 120);
}

const RESOLUTION_MODULE = manifest.contracts.ResolutionModule as `0x${string}`;

/**
 * Returns the hash, or `null` when the call would revert.
 *
 * The simulation is not an optimisation. `close()` and `fail()` are
 * permissionless, so a second keeper — or a trader who got tired of waiting —
 * may have done the work between this run's read and this run's write. That
 * loser used to throw, and the throw aborted the whole tick: every market later
 * in the loop went untouched because an earlier one had already been handled.
 *
 * Simulating first turns the race into a skip. Which is what makes it safe to
 * run more than one keeper, and running more than one is the only honest answer
 * to "what happens when the machine hosting it goes down".
 */
async function send(market: `0x${string}`, functionName: "close" | "fail"): Promise<`0x${string}` | null> {
  const {wallet} = signer();
  try {
    await pub.simulateContract({address: market, abi: MARKET_ABI, functionName, args: [], account: wallet.account});
  } catch (err) {
    console.log(`        skipped — ${functionName}() would revert (${reasonOf(err)})`);
    return null;
  }
  const hash = await wallet.writeContract({address: market, abi: MARKET_ABI, functionName, args: [], ...(await fees())});
  const receipt = await receiptOf(hash, functionName);
  // A receipt proves the transaction was MINED, not that it succeeded. Not
  // checking `status` is how a reverted call gets reported as work done.
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

/**
 * Fail a market that ran out of time — through the ResolutionModule where a
 * committee was ever seated, and only otherwise through the market itself.
 *
 * `Market.fail()` is the backstop the protocol advertises and it is what this
 * keeper used to call, including on 0xCDc13Cc2… (16661). Holders could liquidate
 * afterwards, so it looked like the job done. It was not. Two things `fail()`
 * cannot do, because it does not know the round exists:
 *
 *  1. IT NEVER ENDS THE ROUND. `_rounds[market].finalized` stays false, and stays
 *     false forever: `markFailed` afterwards reverts on a market already Failed,
 *     so there is no second chance at it. Round 1 of that market is still open on
 *     mainnet today.
 *  2. NOBODY IS SLASHED. `markFailed` calls `_settleAccounts(market, NONE)` before
 *     `fail()`, and that is the call that takes NO_SHOW_SLASH_BPS off a resolver
 *     who was drawn and said nothing. Three of them kept 0.4 W0G apiece and remain
 *     indistinguishable from agents that were never asked.
 *
 * The test is `committeeOf`, not `roundOf().n`. `n` is the committee size the tier
 * asked for and is legitimately zero between `dispute` and `openDisputeRound` — see
 * the note on `openResolution` — which is precisely a market that HAS resolvers to
 * settle. The committee list is the set `_settleAccounts` walks, so a non-empty one
 * is exactly the reason to prefer this path.
 *
 * Simulated first, like the draw. A market that cannot be FINALIZED must still be
 * FAILED, because the point of the whole branch is letting holders out: if
 * `markFailed` would revert — `AlreadyFinalized` from a round somebody else closed,
 * `TooEarly` inside the grace a live proposal buys — the plain `fail()` still runs.
 */
async function failMarket(market: `0x${string}`): Promise<{hash: `0x${string}`; via: string} | null> {
  const committee = await pub.readContract({
    address: RESOLUTION_MODULE,
    abi: RESOLUTION_ABI,
    functionName: "committeeOf",
    args: [market],
  });
  if (committee.length > 0) {
    const {account, wallet} = signer();
    let finalizable = true;
    try {
      await pub.simulateContract({
        address: RESOLUTION_MODULE,
        abi: RESOLUTION_ABI,
        functionName: "markFailed",
        args: [market],
        account: account.address,
      });
    } catch (err) {
      console.log(`        markFailed() would revert (${reasonOf(err)}) — failing the market without it`);
      finalizable = false;
    }
    if (finalizable) {
      const hash = await wallet.writeContract({
        address: RESOLUTION_MODULE,
        abi: RESOLUTION_ABI,
        functionName: "markFailed",
        args: [market],
        ...(await fees()),
      });
      const receipt = await receiptOf(hash, "markFailed");
      if (receipt.status !== "success") throw new Error(`markFailed reverted: ${hash}`);
      return {hash, via: `markFailed — round finalized, ${committee.length} resolver(s) settled`};
    }
  }
  const hash = await send(market, "fail");
  return hash === null ? null : {hash, via: "fail()"};
}

/**
 * How long to wait before asking 0G Storage for a spec again, when it would not
 * answer. Not a rounding tolerance and not tuned: bounded above by the fact that
 * the caller never sleeps past `latestUsefulDraw` anyway, and below by the fact
 * that an indexer that is down does not come back inside the 30 seconds this file
 * uses for an unmined block. Five minutes leaves dozens of attempts inside a
 * four-hour settlement window without hammering a service that is already ill.
 */
const SPEC_RETRY_SECONDS = 300;

async function main() {
  const {account, client} = signer();
  const now = Math.floor(Date.now() / 1000);
  const markets = await client.listMarkets();
  console.log(`keeper  ${account.address}`);
  console.log(`        ${markets.length} market(s) on ${manifest.contracts.MarketFactory}${DRY ? "  ·  DRY RUN" : ""}`);

  let closed = 0;
  let failed = 0;
  let opened = 0;
  /**
   * When the clock next makes something due, so a scheduler can sleep until then
   * instead of polling. Every deadline in this protocol is on chain and known in
   * advance; waking every two minutes to be told nothing has changed is work
   * nobody asked for. A market in a terminal state contributes nothing here, so
   * once every market has settled or failed this comes back empty and the keeper
   * stops being scheduled at all.
   */
  const dueAt: number[] = [];
  const needsJudgement: string[] = [];

  for (const m of markets) {
    const short = `${m.address.slice(0, 10)}…`;

    // ── due to close ────────────────────────────────────────────────────────
    // Permissionless on purpose: a market waiting to be closed is a market where
    // every position is stuck, so the protocol lets anybody unstick it.
    if (m.status === "Open" && now >= m.tradingEnd) {
      console.log(`close   ${short}  trading ended ${Math.round((now - m.tradingEnd) / 60)} min ago`);
      if (!DRY) {
        const hash = await send(m.address, "close");
        console.log(`        ${hash}`);
        closed++;
      }
      // Now Closed, and its resolution wants opening. Come back shortly rather
      // than sleeping to the settlement deadline.
      dueAt.push(now + 30);
      continue;
    }

    // ── past the settlement deadline, unresolved ────────────────────────────
    // The protocol's own backstop. Nobody claims to have resolved anything here;
    // the deadline was missed, so the market fails and BOTH sides are bought back
    // at their price. Calling it is a rescue, not a verdict.
    const settlementDeadline = await pub.readContract({
      address: m.address,
      abi: MARKET_ABI,
      functionName: "settlementDeadline",
    });
    const pastDeadline = now >= Number(settlementDeadline);
    const unresolved = m.status === "Closed" || m.status === "Proposed" || m.status === "Disputed";

    if (unresolved && pastDeadline) {
      console.log(`fail    ${short}  settlement deadline missed by ${Math.round((now - Number(settlementDeadline)) / 60)} min`);
      if (!DRY) {
        // Through the ResolutionModule where there is a round to finish — see
        // `failMarket`. Calling the market's own `fail()` first is what left
        // round 1 of 0xCDc13Cc2… open and its three no-shows unslashed.
        const done = await failMarket(m.address);
        if (done !== null) {
          console.log(`        ${done.hash}  ${done.via} — both sides can now liquidate`);
          failed++;
        }
      }
      continue;
    }

    // ── closed, and nobody has started the resolution ───────────────────────
    // `openResolution` is permissionless too, and until it is called a closed
    // market simply waits — no committee sampled, no commit window running, and
    // every holder locked out until the deadline expires and it fails. Closing a
    // market without opening its resolution moves it from one kind of stuck to
    // another, which is what this keeper did before: it closed three markets and
    // left every one of them to time out.
    if (m.status === "Closed" || m.status === "Disputed") {
      const committee = await pub.readContract({
        address: RESOLUTION_MODULE,
        abi: RESOLUTION_ABI,
        functionName: "committeeOf",
        args: [m.address],
      });
      if (committee.length === 0) {
        // `Disputed` with no committee means the dispute posted its bond and asked for
        // round two, which nobody has drawn yet. A dispute left undrawn now COSTS the
        // challenger its bond — a stalled round is no longer treated as an overturn —
        // so drawing it is as much a keeper's job as opening round one.
        const round = m.status === "Closed" ? 1 : 2;

        // ── but not before the question can be answered ──────────────────────
        // Round one only. See `drawDecision` and the note at the top of this file:
        // the draw sets the commit and reveal deadlines, so drawing early is how a
        // perfectly answerable market comes to be answered by nobody. Round two is
        // never held back — a dispute exists only after an answer did.
        if (round === 1) {
          const {commit, reveal} = await resolutionWindows();
          const latestUsefulDraw = Number(settlementDeadline) - (commit + reveal);
          let resolvesBy: number | null = null;
          try {
            resolvesBy = await resolvesByOf(m.specRoot);
          } catch (err) {
            // TWO WAYS TO BE WRONG HERE, and they pull in opposite directions. Draw
            // now and an unreadable spec becomes the same early draw that killed
            // 0xCDc13Cc2…. Defer indefinitely and an indexer outage silently costs
            // the market its whole resolution, which is worse: nothing is ever
            // drawn, nobody votes, and it fails at the deadline anyway. So retry
            // while retrying can still help, and once `latestUsefulDraw` arrives
            // draw regardless — at that point a shortened window beats none.
            if (now < latestUsefulDraw) {
              console.log(`wait    ${short}  cannot read its spec at ${m.specRoot} — ${reasonOf(err)}`);
              dueAt.push(Math.min(now + SPEC_RETRY_SECONDS, latestUsefulDraw));
              continue;
            }
            console.log(`draw    ${short}  spec still unreadable (${reasonOf(err)}); drawing at the last useful moment`);
          }

          const decision = drawDecision({
            now,
            resolvesBy,
            settlementDeadline: Number(settlementDeadline),
            commitWindow: commit,
            revealWindow: reveal,
          });
          if (decision.shortfall > 0) {
            console.log(
              `warn    ${short}  its question resolves ${decision.shortfall}s AFTER the last draw that fits a ` +
                `full round (${commit}s commit + ${reveal}s reveal) before ${settlementDeadline}. Drawing at ` +
                `${decision.drawAt} anyway — a short window beats no committee — but this market should never ` +
                `have been created; scripts/market-spec.py now refuses one.`,
            );
          }
          if (decision.act === "defer") {
            console.log(
              `hold    ${short}  closed, but its question is not answerable until ${decision.resolvesBy} ` +
                `(${new Date(decision.resolvesBy * 1000).toISOString()}); drawing at ${decision.drawAt} ` +
                `(${new Date(decision.drawAt * 1000).toISOString()})`,
            );
            dueAt.push(decision.drawAt);
            continue;
          }
        }

        const {action, detail} = await advanceDraw(m.address, round);
        if (action === "blocked") {
          console.log(`wait    ${short}  cannot draw round ${round} — ${detail}`);
          dueAt.push(Number(settlementDeadline));
          continue;
        }
        console.log(`draw    ${short}  round ${round}: ${action} — ${detail}`);
        if (action === "drawn") opened++;
        // A requested-but-unmined draw is worth coming back for in seconds, not at the
        // settlement deadline. Anything else can wait for the ordinary schedule.
        if (action !== "drawn") dueAt.push(Math.floor(Date.now() / 1000) + 30);
        continue;
      }
    }

    // ── waiting on a judgement this script must not make ────────────────────
    if (unresolved) {
      const mins = Math.round((Number(settlementDeadline) - now) / 60);
      needsJudgement.push(`${short}  ${m.status}, ${mins} min before the deadline`);
      dueAt.push(Number(settlementDeadline));
      continue;
    }

    if (m.status === "Open") dueAt.push(m.tradingEnd);
    console.log(`skip    ${short}  ${m.status}${m.status === "Open" ? `, ${Math.round((m.tradingEnd - now) / 60)} min of trading left` : ""}`);
  }

  console.log("");
  console.log(`${closed} closed, ${opened} opened, ${failed} failed${DRY ? " (dry run — nothing sent)" : ""}`);

  if (needsJudgement.length > 0) {
    console.log("");
    console.log(`${needsJudgement.length} market(s) need a resolver, which this keeper is not:`);
    for (const line of needsJudgement) console.log(`  ${line}`);
    console.log("");
    console.log("A committee decides these — see examples/resolve.ts. If none does before");
    console.log("the deadline, the next pass will fail them and every holder can liquidate.");
  }

  // ── when to come back ────────────────────────────────────────────────────
  // One line, parsed by scripts/keeper-tick.sh, which turns it into a one-shot
  // systemd timer. Printed last and always, including when the answer is "never":
  // a scheduler that cannot tell "nothing is due" from "the keeper crashed" will
  // either poll forever or stop watching a live market.
  const next = dueAt.length > 0 ? Math.min(...dueAt) : null;
  console.log("");
  if (next === null) {
    console.log("next-due none");
    console.log("Nothing is pending. Every market has reached a terminal state.");
  } else {
    const mins = Math.round((next - now) / 60);
    console.log(`next-due ${next}`);
    console.log(`Next action is due ${mins > 0 ? `in ${mins} min` : "now"}, at ${new Date(next * 1000).toISOString()}.`);
  }
}

/**
 * The pass runs only when this file is the program.
 *
 * `test/keeper-schedule.test.ts` imports it for `drawDecision` alone, and a test
 * that quietly opened a wallet and started sending from a keeper key would be a
 * good deal worse than no test. `realpathSync` on both sides because the tick
 * script invokes this through a path that may be a symlink, and a comparison that
 * fails there would leave the keeper doing nothing at all — silently, which is the
 * one failure mode this file exists to prevent.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
}

if (invokedDirectly()) await main();
