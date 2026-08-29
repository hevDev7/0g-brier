/**
 * A real committee settlement, end to end on a live chain.
 *
 *   DEPLOYER_KEY=0x… node scripts/committee-run.mjs <market>
 *
 * Every settlement this deployment has produced went through `settle()` — one
 * allowlisted key, no stake at risk, no vote committed blind, nothing open to
 * dispute. The market page says so in as many words. This exercises the
 * mechanism that is supposed to replace it: staked resolvers sampled from a
 * registry, votes committed as hashes and revealed afterwards, a threshold, and
 * a dispute window that has to expire before anything is final.
 *
 * THE RESOLVER WALLETS ARE DERIVED, NOT STORED. One operator may act for exactly
 * one agent (`OperatorAlreadyActs`), so a committee of three needs three keys.
 * They come from `keccak256(DEPLOYER_KEY, "brier-resolver", i)` — reproducible
 * from a secret the operator already holds, so the stake stays recoverable, and
 * never written to disk or printed. A fresh random key per run would strand the
 * stake behind a secret that existed for ninety seconds.
 *
 * AFTER THE TIMELOCK HANDOVER, STEP 1 STOPS WORKING. It calls `setParam` with the
 * deployer's key; once governance has accepted ownership of ConfigRegistry those
 * calls have to be scheduled through a 48-hour timelock instead. That is the
 * handover doing its job, not a regression — but a run against a handed-over
 * deployment has to set the windows in advance, or live with the real ones.
 *
 * NO MODEL RUNS HERE. Each resolver reads the market's own declared source and
 * applies the rule the market published — which is what the rule says to do for
 * a threshold question, and leaves the committee mechanism as the only thing
 * under test. The 0G Compute path is exercised by `nostradamus-0g/src/resolve.ts`
 * and is a separate claim.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  stringToHex,
  formatUnits,
} from "viem";
import {decodeEventLog} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import fs from "node:fs";

const RPC = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const MARKET = process.argv[2];
if (!MARKET) throw new Error("usage: node scripts/committee-run.mjs <market address>");

const raw = process.env.DEPLOYER_KEY;
if (!raw) throw new Error("set DEPLOYER_KEY — it funds the resolvers and derives their keys");
const DEPLOYER = (raw.startsWith("0x") ? raw : `0x${raw}`);

const C = JSON.parse(fs.readFileSync(new URL("../deployments/16602.json", import.meta.url), "utf-8")).contracts;
const chain = defineChain({
  id: 16602,
  name: "galileo",
  nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});
const pub = createPublicClient({chain, transport: http(RPC)});
const deployer = privateKeyToAccount(DEPLOYER);
const boss = createWalletClient({account: deployer, chain, transport: http(RPC)});

const ERC8004_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const OUTCOMES = {NO: 0, YES: 1, UNRESOLVABLE: 2};

// ── abis, trimmed to what is called ─────────────────────────────────────────
const REGISTRY = [
  {type: "function", name: "register", stateMutability: "nonpayable", inputs: [{type: "uint8"}, {type: "address"}, {type: "bytes32"}, {type: "bytes32"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{type: "uint256"}, {type: "uint256"}], outputs: []},
  {type: "function", name: "stakeOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "activeStake", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "agentOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "operatorOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "address"}]},
  {type: "function", name: "linkErc8004", stateMutability: "nonpayable", inputs: [{type: "uint256"}, {type: "uint256"}], outputs: []},
  {type: "function", name: "erc8004Of", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "reputationOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "tuple", components: [{name: "marketsCreated", type: "uint32"}, {name: "marketsVoided", type: "uint32"}, {name: "resolutionsAgreed", type: "uint32"}, {name: "resolutionsOverturned", type: "uint32"}, {name: "realizedPnl", type: "int128"}, {name: "tradesExecuted", type: "uint32"}]}]},
];
const MODULE = [
  {type: "function", name: "openResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {type: "function", name: "commitVote", stateMutability: "nonpayable", inputs: [{type: "address"}, {type: "uint256"}, {type: "bytes32"}], outputs: []},
  {type: "function", name: "revealVote", stateMutability: "nonpayable", inputs: [{type: "address"}, {type: "uint256"}, {type: "uint8"}, {type: "bytes32"}, {type: "bytes32"}], outputs: []},
  {type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {type: "function", name: "committeeOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256[]"}]},
  {type: "function", name: "viaCommittee", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "bool"}]},
  // Mirrors IResolutionModule.Round exactly. It did not, on the first run: `commits`
  // and `reveals` are uint16 and there is no `receiptRoot` on the struct at all, so the
  // decode failed with "returned no data" — which reads like a missing function and is
  // really a tuple one field too long.
  {type: "function", name: "roundOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "tuple", components: [{name: "n", type: "uint8"}, {name: "k", type: "uint8"}, {name: "index", type: "uint8"}, {name: "proposedOutcome", type: "uint8"}, {name: "commitDeadline", type: "uint64"}, {name: "revealDeadline", type: "uint64"}, {name: "disputeDeadline", type: "uint64"}, {name: "commits", type: "uint16"}, {name: "reveals", type: "uint16"}, {name: "finalized", type: "bool"}]}]},
];
const CONFIG = [
  {type: "function", name: "setParam", stateMutability: "nonpayable", inputs: [{type: "bytes32"}, {type: "uint256"}], outputs: []},
  {type: "function", name: "params", stateMutability: "view", inputs: [{type: "bytes32"}], outputs: [{type: "uint256"}]},
];
const MARKET_ABI = [
  {type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "tier", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "specRoot", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "winningOutcome", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "tradingEnd", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
];
const ERC20 = [
  {type: "function", name: "mintTo", stateMutability: "nonpayable", inputs: [{type: "address"}, {type: "uint256"}], outputs: []},
  {type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{type: "address"}, {type: "uint256"}], outputs: [{type: "bool"}]},
];
const IDENTITY_8004 = [
  {type: "function", name: "register", stateMutability: "nonpayable", inputs: [{name: "agentURI", type: "string"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "ownerOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "address"}]},
  {type: "event", name: "Registered", inputs: [{name: "agentId", type: "uint256", indexed: true}, {name: "agentURI", type: "string", indexed: false}, {name: "owner", type: "address", indexed: true}]},
];

// ── plumbing ────────────────────────────────────────────────────────────────
async function fees() {
  const tip = BigInt(await pub.request({method: "eth_maxPriorityFeePerGas"}));
  const base = (await pub.getBlock()).baseFeePerGas ?? 0n;
  return {maxPriorityFeePerGas: tip, maxFeePerGas: tip + base * 4n + 1_000_000_000n};
}

/** Polled, not watched: Galileo answers block subscriptions unreliably. */
async function mined(hash, what) {
  for (let i = 0; ; i++) {
    try {
      const r = await pub.getTransactionReceipt({hash});
      if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
      return r;
    } catch (e) {
      if (i > 90) throw e;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

const send = async (wallet, args, what) => mined(await wallet.writeContract({...args, ...(await fees())}), what);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const key = (name) => keccak256(toHex(name));

/**
 * One key per resolver, derived from the deployer's. See the note at the top:
 * one operator may act for exactly one agent, so three votes need three keys.
 */
function resolverKey(i) {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32, string, uint256"), [DEPLOYER, "brier-resolver", BigInt(i)]));
}

async function main() {
  const tier = await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "tier"});
  const shapeKey = ["COMMITTEE_FAST", "COMMITTEE_VERIFIED", "COMMITTEE_DETERMINISTIC"][tier];
  const packed = Number(await pub.readContract({address: C.ConfigRegistry, abi: CONFIG, functionName: "params", args: [key(shapeKey)]}));
  const n = packed >> 8;
  const k = packed & 255;
  console.log(`market ${MARKET}  tier ${tier}  committee ${n} of ${k} threshold`);

  // ── 1. shorten the windows, and say so ────────────────────────────────────
  // The live values are an hour to commit, an hour to reveal and two hours to
  // dispute. Those are the right numbers for a market people have money in and
  // the wrong ones for showing the mechanism works. 60s is the configured floor,
  // not an arbitrary choice: `setBounds` refuses anything shorter.
  console.log("\n── 1. windows shortened to the configured floor (testnet) ──");
  const disputeKey = ["DISPUTE_WINDOW_FAST", "DISPUTE_WINDOW_VERIFIED", "DISPUTE_WINDOW_DETERMINISTIC"][tier];
  for (const name of ["COMMIT_WINDOW", "REVEAL_WINDOW", disputeKey]) {
    const before = await pub.readContract({address: C.ConfigRegistry, abi: CONFIG, functionName: "params", args: [key(name)]});
    if (before === 60n) {
      console.log(`   ${name} already 60s`);
      continue;
    }
    await send(boss, {address: C.ConfigRegistry, abi: CONFIG, functionName: "setParam", args: [key(name), 60n]}, name);
    console.log(`   ${name} ${before}s → 60s`);
  }

  // ── 2. three resolvers: funded, registered, staked, linked to ERC-8004 ────
  console.log("\n── 2. resolvers ──");
  const stakeAmount = await pub.readContract({address: C.ConfigRegistry, abi: CONFIG, functionName: "params", args: [key("MIN_RESOLVER_STAKE")]});
  const resolvers = [];
  for (let i = 0; i < n; i++) {
    const account = privateKeyToAccount(resolverKey(i));
    const wallet = createWalletClient({account, chain, transport: http(RPC)});

    const gas = await pub.getBalance({address: account.address});
    if (gas < 30_000_000_000_000_000n) {
      await mined(await boss.sendTransaction({to: account.address, value: 60_000_000_000_000_000n, ...(await fees())}), "fund");
    }

    let agentId = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "agentOf", args: [account.address]});
    if (agentId === 0n) {
      await send(boss, {address: C.MockUSDC, abi: ERC20, functionName: "mintTo", args: [account.address, stakeAmount * 4n]}, "mint");
      // Role 2 = Resolver. Its own key is the operator, because the module checks
      // `operatorOf(agentId) == msg.sender` on every vote.
      const r = await send(wallet, {address: C.AgentRegistry, abi: REGISTRY, functionName: "register", args: [2, account.address, stringToHex(`resolver-${i + 1}`, {size: 32}), "0x" + "00".repeat(32)]}, "register");
      agentId = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "agentOf", args: [account.address]});
      void r;
    }
    if ((await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "stakeOf", args: [agentId]})) < stakeAmount) {
      await send(wallet, {address: C.MockUSDC, abi: ERC20, functionName: "approve", args: [C.AgentRegistry, stakeAmount * 4n]}, "approve");
      await send(wallet, {address: C.AgentRegistry, abi: REGISTRY, functionName: "stake", args: [agentId, stakeAmount]}, "stake");
    }
    // The link is what makes the module publish this resolver's record to 8004.
    // Without it `_publish` declines rather than guessing an id.
    if ((await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "erc8004Of", args: [agentId]})) === 0n) {
      const rec = await send(wallet, {address: ERC8004_IDENTITY, abi: IDENTITY_8004, functionName: "register", args: [`https://brier.0g/resolver/${agentId}`]}, "8004 register");
      const ev = rec.logs
        .map((l) => {
          try {
            return decodeEventLog({abi: IDENTITY_8004, data: l.data, topics: l.topics});
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "Registered");
      if (!ev) throw new Error(`ERC-8004 register emitted no Registered event for ${account.address}`);
      const foreign = ev.args.agentId;
      await send(wallet, {address: C.AgentRegistry, abi: REGISTRY, functionName: "linkErc8004", args: [agentId, foreign]}, "link");
    }
    const linked = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "erc8004Of", args: [agentId]});
    const staked = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "activeStake", args: [agentId]});
    console.log(`   agent ${agentId}  ${account.address}  stake ${formatUnits(staked, 6)} mUSDC  erc8004 #${linked}`);
    resolvers.push({agentId, wallet, account});
  }

  // ── 3. what the market's own source says ─────────────────────────────────
  const spec = await (await fetch(`${process.env.ZG_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai"}/file?root=${await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "specRoot"})}`)).json();
  const src = spec.sources[0];
  const reading = (await (await fetch(src.url)).json())[0][4];
  const threshold = Number(spec.rules.match(/greater than ([\d.]+)/)[1]);
  const outcome = reading > threshold ? OUTCOMES.YES : OUTCOMES.NO;
  console.log(`\n── 3. the rule, applied ──`);
  console.log(`   ${spec.question}`);
  console.log(`   source reads ${reading}, threshold ${threshold} → ${outcome === 1 ? "YES" : "NO"}`);

  // ── 4. open the round ────────────────────────────────────────────────────
  console.log("\n── 4. sample a committee ──");
  // Not idempotent: a second call reverts `RoundAlreadyOpen`. A rerun after a crash
  // has to join the round that already exists rather than demand a fresh one.
  const existing = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  if (existing.n === 0) {
    await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "openResolution", args: [MARKET]}, "openResolution");
  } else {
    console.log(`   a round is already open (${existing.commits} commits, ${existing.reveals} reveals) — joining it`);
  }
  const committee = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "committeeOf", args: [MARKET]});
  console.log(`   sampled ${committee.join(", ")}`);

  // ── 5. commit ────────────────────────────────────────────────────────────
  console.log("\n── 5. commit (the vote is a hash; nobody can see it) ──");
  const receiptRoot = keccak256(toHex(`brier-committee-${MARKET}`));
  const salts = new Map();
  for (const r of resolvers) {
    if (!committee.includes(r.agentId)) continue;
    const salt = keccak256(toHex(`salt-${r.agentId}-${MARKET}`));
    salts.set(r.agentId, salt);
    const commitment = keccak256(encodeAbiParameters(parseAbiParameters("address, uint8, bytes32, bytes32, address"), [MARKET, outcome, salt, receiptRoot, r.account.address]));
    await send(r.wallet, {address: C.ResolutionModule, abi: MODULE, functionName: "commitVote", args: [MARKET, r.agentId, commitment]}, "commit");
    console.log(`   agent ${r.agentId} committed ${commitment.slice(0, 18)}…`);
  }

  // ── 6. reveal ────────────────────────────────────────────────────────────
  const round = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  const waitCommit = Number(round.commitDeadline) - Math.floor(Date.now() / 1000) + 5;
  if (waitCommit > 0) { console.log(`\n   waiting ${waitCommit}s for the commit window to close`); await sleep(waitCommit); }
  console.log("── 6. reveal ──");
  for (const r of resolvers) {
    if (!committee.includes(r.agentId)) continue;
    await send(r.wallet, {address: C.ResolutionModule, abi: MODULE, functionName: "revealVote", args: [MARKET, r.agentId, outcome, salts.get(r.agentId), receiptRoot]}, "reveal");
    console.log(`   agent ${r.agentId} revealed ${outcome === 1 ? "YES" : "NO"}`);
  }

  // ── 7. finalize ──────────────────────────────────────────────────────────
  const after = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  console.log(`\n   proposed ${after.proposedOutcome === 1 ? "YES" : after.proposedOutcome === 0 ? "NO" : "none"} on ${after.reveals}/${after.n} reveals (threshold ${after.k})`);
  const waitDispute = Number(after.disputeDeadline) - Math.floor(Date.now() / 1000) + 5;
  if (waitDispute > 0) { console.log(`   waiting ${waitDispute}s for the dispute window`); await sleep(waitDispute); }

  console.log("── 7. finalize ──");
  const fin = await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "finalize", args: [MARKET]}, "finalize");
  console.log(`   tx ${fin.transactionHash}`);

  // ── 8. what it left behind ───────────────────────────────────────────────
  console.log("\n── 8. the record ──");
  console.log(`   market status    ${["Open", "Closed", "Proposed", "Disputed", "Settled", "Failed", "Voided"][await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "status"})]}`);
  console.log(`   winner           ${await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "winningOutcome"}) === 1 ? "YES" : "NO"}`);
  console.log(`   viaCommittee     ${await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "viaCommittee", args: [MARKET]})}`);
  for (const r of resolvers) {
    if (!committee.includes(r.agentId)) continue;
    const rep = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "reputationOf", args: [r.agentId]});
    const stakeLeft = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "stakeOf", args: [r.agentId]});
    console.log(`   agent ${r.agentId}  agreed ${rep.resolutionsAgreed}  overturned ${rep.resolutionsOverturned}  stake ${formatUnits(stakeLeft, 6)}  erc8004 #${await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "erc8004Of", args: [r.agentId]})}`);
  }
  console.log(`\n   finalize block ${fin.blockNumber} — read FeedbackPublished from it to see the 8004 records`);
}

await main();
