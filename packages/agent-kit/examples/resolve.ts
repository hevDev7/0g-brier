/**
 * The resolver's job (spec §7.4), driven for a whole committee.
 *
 *   DEPLOYER_KEY=... MARKET=0x... npx tsx examples/resolve.ts
 *
 * For each member: read the market's MarketSpec from 0G Storage, judge it with a
 * TEE-attested model on 0G Compute, write the receipt (§7.5), store it on 0G
 * Storage, then commit and reveal the vote on chain.
 *
 * TWO LIMITATIONS, and neither is hidden by the output:
 *
 *  1. ONE PROCESS HOLDS EVERY OPERATOR KEY. A real committee is independent
 *     parties; this is one machine voting three times. What the chain enforces —
 *     the sampling, the commit binding, the threshold, the slashing — is under
 *     test. What it cannot enforce, the independence of the operators, is not.
 *  2. ONE COMPUTE LEDGER pays for every inference, because a ledger costs 3 0G to
 *     open and we have one. The attestation still says a real enclave ran each
 *     request; it does not say three unrelated parties did.
 *
 * A resolver whose answer comes back unattested does NOT commit its outcome. Per
 * §7.4 it falls through to UNRESOLVABLE, because an unverified answer is not
 * evidence and guessing is worse than abstaining.
 */
import {createPublicClient, createWalletClient, defineChain, http, keccak256, encodeAbiParameters} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {loadDeployment} from "@brier/protocol/node";
import {networkFor} from "@brier/protocol";
import {ZgStore} from "@brier/zg-storage";
import {ZgInference, suggestFees, type Judgement} from "../src/index";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const ZG_INDEXER = process.env.ZG_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
const ZG_PROVIDER = (process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836") as `0x${string}`;
const REPO = new URL("../../../", import.meta.url).pathname;

const key = process.env.DEPLOYER_KEY!;
if (!key) throw new Error("set DEPLOYER_KEY");
const KEY = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
const MARKET = process.env.MARKET as `0x${string}`;
if (!MARKET) throw new Error("set MARKET");

const manifest = loadDeployment(CHAIN_ID, `${REPO}deployments`);
const MODULE = manifest.contracts.ResolutionModule as `0x${string}`;
const net = networkFor(CHAIN_ID === 16602 ? "galileo" : "anvil");
const chain = defineChain({
  id: net.chainId,
  name: net.name,
  nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [net.rpcUrl]}},
});
const pub = createPublicClient({chain, transport: http(net.rpcUrl)});

const MODULE_ABI = [
  {type: "function", name: "openResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {
    type: "function",
    name: "commitVote",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}, {type: "bytes32"}],
    outputs: [],
  },
  {
    type: "function",
    name: "revealVote",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}, {type: "uint8"}, {type: "bytes32"}, {type: "bytes32"}],
    outputs: [],
  },
  {type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {
    type: "function",
    name: "committeeOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256[]"}],
  },
  {
    type: "function",
    name: "roundOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "n", type: "uint8"},
          {name: "k", type: "uint8"},
          {name: "index", type: "uint8"},
          {name: "proposedOutcome", type: "uint8"},
          {name: "commitDeadline", type: "uint64"},
          {name: "revealDeadline", type: "uint64"},
          {name: "disputeDeadline", type: "uint64"},
          {name: "commits", type: "uint16"},
          {name: "reveals", type: "uint16"},
          {name: "finalized", type: "bool"},
        ],
      },
    ],
  },
] as const;

const MARKET_ABI = [
  {type: "function", name: "specRoot", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "winningOutcome", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
] as const;

const committee: {agentId: number; operator: `0x${string}`; index: number}[] = JSON.parse(
  readFileSync(`${REPO}deployments/committee-${CHAIN_ID}.json`, "utf8"),
);

/**
 * Derived exactly as `scripts/setup-committee.sh` derives them:
 * `keccak256(deployerKey ‖ bytes32(index))`.
 *
 * The subtlety is that `cast to-bytes32 1` yields `0x1000…0000`, RIGHT-padded — it
 * treats its argument as a hex string, not as a number. Left-padding it here, which
 * is what one writes by reflex, produces a different key and a different address,
 * and the failure surfaces as `NotOperator` on a committee whose members look
 * perfectly correct.
 */
function operatorKey(index: number): `0x${string}` {
  const hex = index.toString(16);
  const padded = hex + "0".repeat(64 - hex.length);
  return keccak256(`${KEY}${padded}` as `0x${string}`);
}

async function send(pk: `0x${string}`, functionName: string, args: readonly unknown[]) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({account, chain, transport: http(net.rpcUrl)});
  const fees = await suggestFees(pub);
  const hash = await wallet.writeContract({
    address: MODULE,
    abi: MODULE_ABI,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper, several names
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
    account,
    chain,
    ...fees,
  });
  for (;;) {
    try {
      const r = await pub.getTransactionReceipt({hash});
      if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
      return hash;
    } catch (e) {
      if (e instanceof Error && e.message.includes("reverted")) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Uploads through the repo's own uploader, so a receipt is stored the one way. */
function storeReceipt(doc: unknown): `0x${string}` {
  const out = execFileSync("node", [`${REPO}scripts/upload-doc.mjs`], {
    input: JSON.stringify(doc),
    env: {...process.env, UPLOADER_KEY: KEY},
    encoding: "utf8",
  });
  return out.trim() as `0x${string}`;
}

const OUTCOME_NAMES = ["NO", "YES", "UNRESOLVABLE"];

// ── the job ────────────────────────────────────────────────────────────────

const specRoot = await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "specRoot"});
const spec = (await new ZgStore(ZG_INDEXER).get(specRoot)) as {
  question?: string;
  rules?: string;
  category?: string;
  settlementPrompt?: string;
  sources?: {url: string; selector?: string}[];
} | null;
if (!spec?.question || !spec.rules) throw new Error(`no readable MarketSpec at ${specRoot}`);

console.log(`market   ${MARKET}`);
console.log(`question ${spec.question}`);

if ((await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "status"})) === 1) {
  console.log(`\nopening the resolution`);
  await send(KEY, "openResolution", [MARKET]);
}

const members = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "committeeOf", args: [MARKET]});
console.log(`committee ${members.map(String).join(", ")}`);

const inference = await ZgInference.connect({network: "galileo", privateKey: KEY, provider: ZG_PROVIDER});
const votes: {agentId: bigint; pk: `0x${string}`; j: Judgement | null; outcome: number; salt: `0x${string}`; receipt: `0x${string}`}[] = [];

for (const agentId of members) {
  const entry = committee.find((c) => BigInt(c.agentId) === agentId);
  if (!entry) throw new Error(`no operator key for agent ${agentId}`);
  const pk = operatorKey(entry.index);
  const op = privateKeyToAccount(pk).address;
  console.log(`\nagent ${agentId} (operator ${op})`);

  const j = await inference.settle({
    question: spec.question,
    rules: spec.rules,
    category: spec.category ?? null,
    settlementPrompt: spec.settlementPrompt ?? null,
    evidence: (spec.sources ?? []).map((s) => ({url: s.url})),
  });
  // §7.4: an unattested answer is not evidence. Do not commit it.
  const attested = j.teeVerified;
  const outcome = attested ? j.outcome : 2;
  console.log(`  model ${j.model}  TEE ${attested ? "verified" : "NOT VERIFIED → abstaining as UNRESOLVABLE"}`);
  console.log(`  says  ${OUTCOME_NAMES[outcome]}  — ${j.rationale}`);

  const receipt = storeReceipt({
    version: 1,
    market: MARKET,
    specRoot,
    round: 1,
    resolver: {agentId: Number(agentId), address: op},
    inference: {
      route: "broker",
      providerAddress: ZG_PROVIDER,
      model: j.model,
      chatID: j.chatId,
      teeVerified: j.teeVerified,
      temperature: 0,
      simulated: false,
    },
    evidence: (spec.sources ?? []).map((s) => ({url: s.url, fetchedAt: Math.floor(Date.now() / 1000)})),
    outcome: OUTCOME_NAMES[outcome],
    confidence: j.confidence,
    rationale: j.rationale,
    citations: (spec.sources ?? []).map((_, i) => i),
    rawResponse: j.raw,
  });
  console.log(`  receipt ${receipt}`);

  const salt = keccak256(`0x${Buffer.from(`salt-${agentId}-${MARKET}`).toString("hex")}` as `0x${string}`);
  const commitment = keccak256(
    encodeAbiParameters(
      [{type: "address"}, {type: "uint8"}, {type: "bytes32"}, {type: "bytes32"}, {type: "address"}],
      [MARKET, outcome, salt, receipt, op],
    ),
  );
  await send(pk, "commitVote", [MARKET, agentId, commitment]);
  console.log(`  committed`);
  votes.push({agentId, pk, j, outcome, salt, receipt});
}

const round = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "roundOf", args: [MARKET]});
console.log(`\nwaiting for the commit window to close (${round.commitDeadline})`);
for (;;) {
  const block = await pub.getBlock();
  if (block.timestamp > round.commitDeadline) break;
  await new Promise((r) => setTimeout(r, 5000));
}

for (const v of votes) {
  await send(v.pk, "revealVote", [MARKET, v.agentId, v.outcome, v.salt, v.receipt]);
  console.log(`agent ${v.agentId} revealed ${OUTCOME_NAMES[v.outcome]}`);
}

const proposed = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "roundOf", args: [MARKET]});
console.log(`\nproposed ${OUTCOME_NAMES[proposed.proposedOutcome] ?? "none"} — dispute closes ${proposed.disputeDeadline}`);
for (;;) {
  const block = await pub.getBlock();
  if (block.timestamp > proposed.disputeDeadline) break;
  await new Promise((r) => setTimeout(r, 5000));
}

await send(KEY, "finalize", [MARKET]);
const status = await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "status"});
const winner = await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "winningOutcome"});
// A FAILED market has no winner, and `winningOutcome` is 0 there because nothing
// ever wrote to it. Printing `OUTCOME_NAMES[0]` announced "NO" for a market the
// committee had just declared unanswerable.
console.log(
  status === 4
    ? `\nfinalized: SETTLED, winner ${OUTCOME_NAMES[winner]}`
    : `\nfinalized: FAILED — no winner. Every side liquidates at its own price.`,
);
