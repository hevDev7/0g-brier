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
 * A PASS, NOT A DAEMON
 *
 * Run it on a schedule. A long-lived process drifts, leaks, and dies quietly at
 * three in the morning; a pass that exits either did its work or failed loudly
 * enough to be noticed, and a missed tick costs one interval rather than a
 * service. It is idempotent: every action re-checks its precondition against
 * live chain state immediately before sending, so two overlapping runs cannot
 * both act.
 */
import {createPublicClient, createWalletClient, defineChain, http} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {loadDeployment} from "@0g-brier/protocol/node";
import {BrierClient, MARKET_ABI} from "../src/index";
import {modeForChainId} from "@0g-brier/protocol";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const RPC = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const DRY = process.env.DRY_RUN === "1";

const rawKey = process.env.KEEPER_KEY ?? process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!rawKey) throw new Error("set KEEPER_KEY (or DEPLOYER_KEY) — the keeper signs its own transactions");
const KEY = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const account = privateKeyToAccount(KEY);
const chain = defineChain({
  id: CHAIN_ID,
  name: modeForChainId(CHAIN_ID),
  nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});
const pub = createPublicClient({chain, transport: http(RPC)});
const wallet = createWalletClient({account, chain, transport: http(RPC)});

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
] as const;

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

const client = new BrierClient({
  network: modeForChainId(CHAIN_ID),
  privateKey: KEY,
  factory: manifest.contracts.MarketFactory as `0x${string}`,
  outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
});

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
      const hash = await send(m.address, "fail");
      console.log(`        ${hash}  — both sides can now liquidate`);
      failed++;
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

// ── when to come back ──────────────────────────────────────────────────────
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
