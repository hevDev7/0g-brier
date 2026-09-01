/**
 * The resolver's job (spec §7.4), driven for a whole committee.
 *
 *   DEPLOYER_KEY=... MARKET=0x... npx tsx examples/resolve.ts
 *
 * For each member: read the market's MarketSpec from 0G Storage, judge it with a
 * TEE-attested model on 0G Compute, write the receipt (§7.5), store it on 0G
 * Storage, then commit and reveal the vote on chain.
 *
 * THREE LIMITATIONS, and none is hidden by the output:
 *
 *  1. ONE PROCESS HOLDS EVERY OPERATOR KEY. A real committee is independent
 *     parties; this is one machine voting three times. What the chain enforces —
 *     the sampling, the commit binding, the threshold, the slashing — is under
 *     test. What it cannot enforce, the independence of the operators, is not.
 *  2. ONE COMPUTE LEDGER pays for every inference, because a ledger costs 3 0G to
 *     open and we have one. The attestation still says a real enclave ran each
 *     request; it does not say three unrelated parties did.
 *  3. ONE READ OF THE EVIDENCE is shared by the whole committee. §7.4 has each
 *     resolver gather for itself, and that is right for independent operators —
 *     but on one machine it would mean three fetches of the same candle seconds
 *     apart, three legitimately different closes, and a split vote that nothing
 *     was actually wrong with. The sources are read once, before the loop, and
 *     every member judges the same observations.
 *
 * A resolver whose answer comes back unattested does NOT commit its outcome. Per
 * §7.4 it falls through to UNRESOLVABLE, because an unverified answer is not
 * evidence and guessing is worse than abstaining.
 */
import {createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseAbiParameters} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {loadDeployment} from "@0g-brier/protocol/node";
import {modeForChainId, networkFor, networkForChainId} from "@0g-brier/protocol";
import {ZgStore} from "@0g-brier/zg-storage";
import {
  ZgInference,
  gatherEvidence,
  observedIndices,
  receiptEvidence,
  renderObservation,
  suggestFees,
  type Judgement,
} from "../src/index";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const ZG_INDEXER = process.env.ZG_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
/**
 * The provider(s) whose enclaves judge this market.
 *
 * ONE PER MEMBER WHERE THERE ARE ENOUGH, and this is the difference between a
 * committee and a quorum of copies. 0G Compute serves ONE text model on Galileo
 * and twelve services on mainnet, of which seven are TeeML-attested text models.
 * With one model at temperature 0 over evidence read once and shared, N
 * resolvers are one deterministic function evaluated N times: they cannot
 * disagree, the threshold is met on identical answers, and on 2026-08-31 that
 * carried a wrong settlement to the chain three votes to nil.
 *
 * `ZG_PROVIDERS` takes a comma-separated list and hands them out round-robin
 * across the sampled committee. Each needs its own funded sub-account and its
 * own TEE acknowledgement — `scripts/setup-compute.mjs --provider` per address,
 * 1 0G apiece — so this is opt-in rather than assumed. Falls back to the single
 * `ZG_PROVIDER`, which is the old behaviour and says so in the output.
 */
const ZG_PROVIDERS = (process.env.ZG_PROVIDERS ?? process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean) as `0x${string}`[];
const REPO = new URL("../../../", import.meta.url).pathname;

const key = process.env.DEPLOYER_KEY!;
if (!key) throw new Error("set DEPLOYER_KEY");
const KEY = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
const MARKET = process.env.MARKET as `0x${string}`;
if (!MARKET) throw new Error("set MARKET");

const manifest = loadDeployment(CHAIN_ID, `${REPO}deployments`);
const MODULE = manifest.contracts.ResolutionModule as `0x${string}`;
const REGISTRY = manifest.contracts.AgentRegistry as `0x${string}`;
const net = networkForChainId(CHAIN_ID);
const chain = defineChain({
  id: net.chainId,
  name: net.name,
  nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [net.rpcUrl]}},
});
const pub = createPublicClient({chain, transport: http(net.rpcUrl)});

const MODULE_ABI = [
  {type: "function", name: "requestResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {type: "function", name: "openResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {
    type: "function",
    name: "drawOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
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

const REGISTRY_ABI = [
  {
    type: "function",
    name: "operatorOf",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [{type: "address"}],
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
 * `keccak256(abi.encode(deployerKey, "brier-resolver", index))`.
 *
 * ONE derivation, shared with `scripts/committee-run.mjs`. There used to be two:
 * this file matched `setup-committee.sh` (`keccak256(deployerKey ‖ bytes32(i))`)
 * while `committee-run.mjs` used the tagged form above. Both were internally
 * consistent and mutually useless — resolvers registered by one script could
 * not be signed for by the other, and the failure surfaced as a commit reverting
 * on a committee whose members looked perfectly correct. The tagged form wins
 * because it is domain-separated: a raw concatenation of a key and a counter is
 * the kind of thing that collides with some other scheme derived from the same
 * secret, and a tag costs nothing.
 */
function operatorKey(index: number): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, string, uint256"), [
      KEY as `0x${string}`,
      "brier-resolver",
      BigInt(index),
    ]),
  );
}

/**
 * Every operator key this deployer could hold, indexed by the address it makes.
 *
 * THE INDEX IN THE MANIFEST IS NOT ENOUGH, and the comment above explains why it
 * looked like it was: two derivations have been in use, and a deployment can hold
 * agents from both — `setup-committee.sh` wrote the untagged form for its first
 * ten agents, then the padded-left variant that replaced it, while this file and
 * `committee-run.mjs` use the tagged form. Deriving from `entry.index` alone
 * produces a key for the wrong scheme, and the failure is a commit reverting
 * `NotOperator` on a member the manifest describes perfectly.
 *
 * Worse, the committee is DRAWN from every eligible resolver — including ones
 * registered by a script that never wrote to this manifest at all, for which
 * `find` returns nothing and the run dies with "no operator key".
 *
 * So the address on chain is the key, not the file. All three derivations are
 * computed and matched against `operatorOf`; a member none of them produces is
 * named rather than guessed at.
 */
function operatorCandidates(): Map<string, `0x${string}`> {
  const byAddress = new Map<string, `0x${string}`>();
  const add = (k: `0x${string}`) => {
    const a = privateKeyToAccount(k).address.toLowerCase();
    if (!byAddress.has(a)) byAddress.set(a, k);
  };
  const bare = KEY.slice(2);
  for (let i = 0; i < 32; i++) {
    add(operatorKey(i));
    add(keccak256(`0x${bare}${i.toString(16).padEnd(64, "0")}` as `0x${string}`));
    add(keccak256(`0x${bare}${i.toString(16).padStart(64, "0")}` as `0x${string}`));
  }
  return byAddress;
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
  sources?: {kind?: string; url: string; selector?: string}[];
} | null;
if (!spec?.question || !spec.rules) throw new Error(`no readable MarketSpec at ${specRoot}`);

console.log(`market   ${MARKET}`);
console.log(`question ${spec.question}`);

  // Closed, and possibly already opened by somebody else. The keeper opens a
  // round the moment a market closes, so by the time a resolver arrives the
  // committee is usually already sampled — and `openResolution` reverts with
  // `RoundAlreadyOpen` rather than being idempotent. Joining is the normal path
  // now; opening is the exception, for a market nothing else has reached.
  //
  // Opening is TWO CALLS: ask for a committee, wait for the block that seeds it to
  // be mined, then draw. The wait is the security property — the seed is the hash of
  // a block that does not exist when the request goes in, so nobody can look at the
  // committee they are about to get and decide whether to accept it.
  if ((await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "status"})) === 1) {
    const round = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "roundOf", args: [MARKET]});
    if (round.n === 0) {
      let draw = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "drawOf", args: [MARKET]});
      if (draw.drawBlock === 0n) {
        console.log(`\nasking for a committee`);
        await send(KEY, "requestResolution", [MARKET]);
        draw = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "drawOf", args: [MARKET]});
      }
      while ((await pub.getBlockNumber()) <= draw.drawBlock) {
        console.log(`  waiting for block ${draw.drawBlock} to seed the draw`);
        await new Promise((r) => setTimeout(r, 2_000));
      }
      console.log(`drawing the committee from the hash of block ${draw.drawBlock}`);
      await send(KEY, "openResolution", [MARKET]);
    } else {
      console.log(`\njoining the round already open (${round.commits} commits, ${round.reveals} reveals)`);
    }
  }

const members = await pub.readContract({address: MODULE, abi: MODULE_ABI, functionName: "committeeOf", args: [MARKET]});
console.log(`committee ${members.map(String).join(", ")}`);

// §7.4 step 2. Done before a single inference is paid for: if nothing could be
// read, that is worth seeing before spending 0G to be told UNRESOLVABLE.
console.log(`\nreading ${(spec.sources ?? []).length} source(s)`);
const observations = await gatherEvidence(spec.sources, {
  timeoutMs: Number(process.env.EVIDENCE_TIMEOUT_MS ?? 10_000),
  maxBytes: Number(process.env.EVIDENCE_MAX_BYTES ?? 256 * 1024),
});
for (const o of observations) {
  console.log(
    o.ok
      ? `  [${o.index}] ${o.via === "selector" ? "selected" : "read"} ${o.value.length} chars from ${o.url} — sha256 ${o.fetch.sha256.slice(0, 16)}…`
      : `  [${o.index}] NOT OBSERVED ${o.url} — ${o.reason}: ${o.detail}`,
  );
}
// The exact blocks the model will be shown, for when a committee says
// UNRESOLVABLE and the question is whether it was right to.
if (process.env.EVIDENCE_DUMP === "1") for (const o of observations) console.log(`\n${renderObservation(o)}`);
if (observations.length > 0 && observations.every((o) => !o.ok)) {
  // Not an abort. A committee that cannot see anything should say UNRESOLVABLE
  // on the record, with the reasons in its receipts, rather than have the job
  // quietly not run — a market nobody voted on fails at the deadline with no
  // explanation attached to it.
  console.log(`  no source could be read; the committee will be asked to judge on that`);
}

// `network` from CHAIN_ID, not hardcoded. This said "galileo" outright, so on
// mainnet the inference client talked to the testnet RPC while every other call
// in this file talked to 16661 — a split-brain that surfaces as an attestation
// against a chain the market does not live on.
const NETWORK = modeForChainId(CHAIN_ID);
const brokers = new Map<string, ZgInference>();
async function inferenceFor(provider: `0x${string}`): Promise<ZgInference> {
  let b = brokers.get(provider.toLowerCase());
  if (!b) {
    b = await ZgInference.connect({network: NETWORK, privateKey: KEY, provider});
    brokers.set(provider.toLowerCase(), b);
  }
  return b;
}
console.log(
  ZG_PROVIDERS.length > 1
    ? `\n${ZG_PROVIDERS.length} providers, handed out round-robin — the committee will not all be running one model`
    : `\none provider for the whole committee: every member runs the same model over the same evidence, so they cannot disagree`,
);
const votes: {agentId: bigint; pk: `0x${string}`; j: Judgement | null; outcome: number; salt: `0x${string}`; receipt: `0x${string}`}[] = [];

const candidates = operatorCandidates();
for (const agentId of members) {
  const op = await pub.readContract({address: REGISTRY, abi: REGISTRY_ABI, functionName: "operatorOf", args: [agentId]});
  const pk = candidates.get(op.toLowerCase());
  if (!pk) throw new Error(`no operator key for agent ${agentId} (operator ${op}) — not derivable from this DEPLOYER_KEY`);
  console.log(`\nagent ${agentId} (operator ${op})`);

  // Round-robin over the sampled order, so a committee of five across three
  // providers is 2/2/1 rather than 5/0/0.
  const provider = ZG_PROVIDERS[votes.length % ZG_PROVIDERS.length]!;
  const inference = await inferenceFor(provider);
  const j = await inference.settle({
    question: spec.question,
    rules: spec.rules,
    category: spec.category ?? null,
    settlementPrompt: spec.settlementPrompt ?? null,
    observations,
  });
  // §7.4: an unattested answer is not evidence. Do not commit it.
  //
  // An ARITHMETIC judgement is not unattested — it is unmodelled, which is a
  // different thing and a stronger one. There is no enclave to vouch for it
  // because no model was asked; what stands behind it is the observation's own
  // digest and a comparison anyone can repeat. Abstaining on that would be
  // abstaining because the answer was too certain.
  const attested = j.route === "arithmetic" || j.attestation?.teeVerified === true;
  const outcome = attested ? j.outcome : 2;
  console.log(
    j.route === "arithmetic"
      ? `  decided in code — no model consulted`
      : `  model ${j.attestation?.model ?? "(none)"}  TEE ${attested ? "verified" : "NOT VERIFIED → abstaining as UNRESOLVABLE"}`,
  );
  console.log(`  says  ${OUTCOME_NAMES[outcome]}  — ${j.rationale}`);

  const receipt = storeReceipt({
    version: 1,
    market: MARKET,
    specRoot,
    round: 1,
    resolver: {agentId: Number(agentId), address: op},
    // `route` is the field a reader checks first. "arithmetic" means the numbers
    // were compared in code and every model field below is null BECAUSE there was
    // no model — not because one failed. Writing the provider address here anyway
    // would claim an enclave took part in something it never saw.
    inference:
      j.route === "arithmetic"
        ? {
            route: "arithmetic",
            providerAddress: null,
            model: null,
            chatID: null,
            teeVerified: false,
            temperature: null,
            simulated: false,
          }
        : {
            route: "broker",
            providerAddress: provider,
            model: j.attestation?.model ?? null,
            chatID: j.attestation?.chatId ?? null,
            teeVerified: j.attestation?.teeVerified ?? false,
            temperature: 0,
            simulated: false,
          },
    // What was READ, not where it lives: the value, its digest, the status, and
    // the instant — enough for a stranger holding this receipt to repeat the read.
    evidence: receiptEvidence(observations),
    outcome: OUTCOME_NAMES[outcome],
    confidence: j.confidence,
    rationale: j.rationale,
    // Only the sources that produced an observation. Listing every index claimed
    // the resolver had consulted documents it never managed to fetch.
    citations: observedIndices(observations),
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
