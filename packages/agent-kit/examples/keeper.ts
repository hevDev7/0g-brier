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
import {loadDeployment} from "@hevdev7/protocol/node";
import {BrierClient, MARKET_ABI} from "../src/index";

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
  name: CHAIN_ID === 16602 ? "galileo" : "anvil",
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

async function send(market: `0x${string}`, functionName: "close" | "fail"): Promise<`0x${string}`> {
  const hash = await wallet.writeContract({address: market, abi: MARKET_ABI, functionName, args: [], ...(await fees())});
  const receipt = await receiptOf(hash, functionName);
  // A receipt proves the transaction was MINED, not that it succeeded. Not
  // checking `status` is how a reverted call gets reported as work done.
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

const client = new BrierClient({
  network: CHAIN_ID === 16602 ? "galileo" : "anvil",
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

  // ── waiting on a judgement this script must not make ────────────────────
  if (unresolved) {
    const mins = Math.round((Number(settlementDeadline) - now) / 60);
    needsJudgement.push(`${short}  ${m.status}, ${mins} min before the deadline`);
    continue;
  }

  console.log(`skip    ${short}  ${m.status}${m.status === "Open" ? `, ${Math.round((m.tradingEnd - now) / 60)} min of trading left` : ""}`);
}

console.log("");
console.log(`${closed} closed, ${failed} failed${DRY ? " (dry run — nothing sent)" : ""}`);

if (needsJudgement.length > 0) {
  console.log("");
  console.log(`${needsJudgement.length} market(s) need a resolver, which this keeper is not:`);
  for (const line of needsJudgement) console.log(`  ${line}`);
  console.log("");
  console.log("A committee decides these — see examples/resolve.ts. If none does before");
  console.log("the deadline, the next pass will fail them and every holder can liquidate.");
}
