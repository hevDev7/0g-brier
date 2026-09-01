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
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {networkForChainId} from "@0g-brier/protocol";

const RPC = process.env.RPC_URL ?? process.env.ZERO_G_RPC ?? networkForChainId(Number(process.env.CHAIN_ID ?? 16602)).rpcUrl;
const MARKET = process.argv[2];
if (!MARKET) throw new Error("usage: node scripts/committee-run.mjs <market address>");

const raw = process.env.DEPLOYER_KEY;
if (!raw) throw new Error("set DEPLOYER_KEY — it funds the resolvers and derives their keys");
const DEPLOYER = (raw.startsWith("0x") ? raw : `0x${raw}`);
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// The chain used to be frozen here in three places at once — the manifest name,
// the viem chain id, and the RPC default — with no environment variable able to
// move any of them. A `grep mainnet` over this file returned nothing.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const NET = networkForChainId(CHAIN_ID);
const INDEXER = process.env.ZG_INDEXER ?? NET.indexerUrl;
const C = JSON.parse(
  fs.readFileSync(new URL(`../deployments/${CHAIN_ID}.json`, import.meta.url), "utf-8"),
).contracts;
const chain = defineChain({
  id: CHAIN_ID,
  name: NET.name,
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
  {type: "function", name: "requestResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {type: "function", name: "openResolution", stateMutability: "nonpayable", inputs: [{type: "address"}], outputs: []},
  {type: "function", name: "drawOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "tuple", components: [{name: "drawBlock", type: "uint64"}, {name: "index", type: "uint8"}]}]},
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
  {type: "function", name: "addresses", stateMutability: "view", inputs: [{type: "bytes32"}], outputs: [{type: "address"}]},
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

/**
 * Every operator key this deployer could be holding, indexed by address.
 *
 * THE COMMITTEE IS DRAWN, NOT CHOSEN, and that is the whole point of the module —
 * so a runner cannot assume the resolvers it registered are the ones that will be
 * seated. On a registry with other staked resolvers in it, the draw will seat
 * some of them, and voting for a list of one's own making instead reverts
 * `NotOnCommittee` while the round quietly fails to reach its threshold.
 *
 * Three derivations are in play on this deployment and all three are covered:
 * this file's own `resolverKey`, and the two `setup-committee.sh` has used —
 * `cast to-bytes32` (which pads the index on the RIGHT) and the `printf %064x`
 * that replaced it (which pads on the LEFT). A member whose key is not in here
 * is reported by name rather than skipped, because a silently short committee
 * looks exactly like resolvers refusing to show up.
 */
function operatorCandidates() {
  const byAddress = new Map();
  const add = (k) => {
    const a = privateKeyToAccount(k).address.toLowerCase();
    if (!byAddress.has(a)) byAddress.set(a, k);
  };
  for (let i = 0; i < 32; i++) {
    add(resolverKey(i));
    add(keccak256(`0x${DEPLOYER.slice(2)}${i.toString(16).padEnd(64, "0")}`));
    add(keccak256(`0x${DEPLOYER.slice(2)}${i.toString(16).padStart(64, "0")}`));
  }
  return byAddress;
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
  // Not all 60s. The commit window has to contain a 0G Storage upload per
  // member, and storage latency — not inference, not the chain — is what ended
  // the first weather run at one commit out of three. 60s is the floor
  // `setBounds` allows, which makes it the tempting number and the wrong one:
  // it is shorter than the work the window exists to hold.
  const windows = {COMMIT_WINDOW: 300n, REVEAL_WINDOW: 120n, [disputeKey]: 60n};
  // What to put back at step 9. Captured BEFORE the first write, because after it
  // the original is gone — and a script that shortens a live deployment's windows
  // and then cannot say what they were has broken the configuration, not borrowed it.
  const restore = [];
  for (const [name, want] of Object.entries(windows)) {
    const before = await pub.readContract({address: C.ConfigRegistry, abi: CONFIG, functionName: "params", args: [key(name)]});
    if (before !== want) restore.push([name, before]);
    if (before === want) {
      console.log(`   ${name} already ${want}s`);
      continue;
    }
    await send(boss, {address: C.ConfigRegistry, abi: CONFIG, functionName: "setParam", args: [key(name), want]}, name);
    console.log(`   ${name} ${before}s → ${want}s`);
  }

  // ── 2. three resolvers: funded, registered, staked, linked to ERC-8004 ────
  console.log("\n── 2. resolvers ──");
  // A WARNING, NOT A GUARD, because this script is the wrong tool for a registry
  // that already has a committee and half-fixing it would hide that.
  //
  // The keys below come from `resolverKey`, a THIRD derivation that
  // setup-committee.sh has never used. On the 0G mainnet deployment — fourteen
  // resolvers already registered and staked — this step does not reuse them. It
  // registers five MORE and locks another MIN_RESOLVER_STAKE x 2 x 5 of collateral
  // that the market's seed was budgeted for. Voting on an existing committee needs
  // a driver that seats the members the module DRAWS, which is what
  // `operatorCandidates` below is for; provisioning is for a fresh chain.
  if (CHAIN_ID === 16661) {
    throw new Error(
      "committee-run.mjs provisions its own resolvers, and chain 16661 already has a staked committee.\n" +
        "  Running it here would register five more and lock collateral the market needs.\n" +
        "  Use it on a fresh chain; drive an existing committee with the module directly.",
    );
  }

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
    //
    // SKIPPED ENTIRELY when the registry is unset. `ResolutionModule._publish`
    // treats an unset registry as "the integration is off" and settles anyway, so
    // a runner that hard-fails here is stricter than the protocol it drives — and
    // it fails with `Erc8004RegistryUnset` in the middle of provisioning, which
    // reads like a broken resolver rather than an unconfigured deployment. Seen on
    // a fresh Galileo deploy, 2026-08-31: the addresses had only ever been wired by
    // `UpgradeErc8004.s.sol`, so no new deployment had them.
    const identityAddr = await pub.readContract({address: C.ConfigRegistry, abi: CONFIG, functionName: "addresses", args: [key("ERC8004_IDENTITY")]});
    if (identityAddr === "0x0000000000000000000000000000000000000000") {
      if (i === 0) console.log("   ERC-8004 registry unset on this deployment — skipping the link, as the module does");
    } else if ((await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "erc8004Of", args: [agentId]})) === 0n) {
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
  const specRoot = await pub.readContract({address: MARKET, abi: MARKET_ABI, functionName: "specRoot"});
  const spec = await (await fetch(`${INDEXER}/file?root=${specRoot}`)).json();
  const src = spec.sources[0];
  // The BYTES, then the number — in that order and only once. A receipt claims
  // "this is what the source said", and that claim is only checkable if what was
  // hashed is what was read. Fetching twice would hash a different response than
  // the one the vote came from.
  const res = await fetch(src.url);
  const body = await res.text();
  const evidence = {
    url: src.url,
    kind: src.kind ?? "http",
    selector: src.selector ?? null,
    observed: true,
    fetchedAt: Math.floor(Date.now() / 1000),
    finalUrl: res.url,
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    bytes: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
    truncated: false,
    via: "selector",
    hint: null,
    clipped: false,
  };
  const reading = Number(JSON.parse(body)[0][4]);
  evidence.value = String(reading);
  // `[\d.]+` was greedy and the rules text ends its sentence right after the
  // number, so this captured "2397.73." — including the full stop — and Number()
  // gave NaN. Anchoring the decimal part stops at the digit.
  const threshold = Number(spec.rules.match(/greater than ([0-9]+(?:\.[0-9]+)?)/)?.[1]);

  // THE REAL DEFECT WAS HERE, NOT IN THE REGEX. `2420.71 > NaN` is false, like
  // every comparison against NaN, so an unparseable threshold did not fail — it
  // voted NO, with three resolvers agreeing and the chain recording it as a
  // committee decision. Market 0xABE2Cf5C is settled NO forever because of it,
  // when its own source says YES.
  //
  // A resolver that cannot read the question must refuse to answer it. Refusing
  // costs the round; answering wrongly costs someone their money and cannot be
  // taken back.
  if (!Number.isFinite(threshold)) {
    throw new Error(`cannot read a threshold out of the market's rules — refusing to vote.\n  rules: ${spec.rules}`);
  }
  if (!Number.isFinite(reading)) {
    throw new Error(`source ${src.url} did not yield a number — refusing to vote.`);
  }
  const outcome = reading > threshold ? OUTCOMES.YES : OUTCOMES.NO;
  console.log(`\n── 3. the rule, applied ──`);
  console.log(`   ${spec.question}`);
  console.log(`   source reads ${reading}, threshold ${threshold} → ${outcome === 1 ? "YES" : "NO"}`);

  // ── 4. open the round ────────────────────────────────────────────────────
  console.log("\n── 4. sample a committee ──");
  // Not idempotent: a second call reverts `RoundAlreadyOpen`. A rerun after a crash
  // has to join the round that already exists rather than demand a fresh one.
  //
  // TWO CALLS. `requestResolution` books a future block; `openResolution` draws from
  // that block's hash once it has been mined. The seed cannot be read at the moment
  // the draw is asked for, which is what stops a caller shopping for a committee by
  // simulating the sample and only sending when it likes the answer.
  const existing = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  if (existing.n === 0) {
    let draw = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "drawOf", args: [MARKET]});
    if (draw.drawBlock === 0n) {
      await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "requestResolution", args: [MARKET]}, "requestResolution");
      draw = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "drawOf", args: [MARKET]});
    }
    while ((await pub.getBlockNumber()) <= draw.drawBlock) {
      console.log(`   waiting for block ${draw.drawBlock} to seed the draw`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
    await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "openResolution", args: [MARKET]}, "openResolution");
  } else {
    console.log(`   a round is already open (${existing.commits} commits, ${existing.reveals} reveals) — joining it`);
  }
  const committee = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "committeeOf", args: [MARKET]});
  console.log(`   sampled ${committee.join(", ")}`);

  // The seated committee replaces the list built above. Whoever was drawn is who
  // votes; the earlier loop existed only to make sure enough eligible resolvers
  // EXISTED for a draw to be possible at all.
  const candidates = operatorCandidates();
  const voters = [];
  const orphans = [];
  for (const agentId of committee) {
    const op = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "operatorOf", args: [agentId]});
    const pk = candidates.get(op.toLowerCase());
    if (!pk) {
      orphans.push(`${agentId} (operator ${op})`);
      continue;
    }
    const account = privateKeyToAccount(pk);
    voters.push({agentId, account, wallet: createWalletClient({account, chain, transport: http(RPC)})});
  }
  if (orphans.length > 0) {
    console.log(`   ⚠ no operator key for ${orphans.length} member(s): ${orphans.join(", ")}`);
  }
  const seated = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  if (voters.length < seated.k) {
    throw new Error(`only ${voters.length} of ${committee.length} seated members are operable, and the threshold is ${seated.k} — this round cannot be carried.`);
  }
  console.log(`   operable ${voters.length}/${committee.length}, threshold ${seated.k}`);

  // Each voter needs gas of its own: the module checks `operatorOf == msg.sender`,
  // so a commit cannot be relayed by the deployer on a member's behalf.
  for (const v of voters) {
    if ((await pub.getBalance({address: v.account.address})) < 30_000_000_000_000_000n) {
      await mined(await boss.sendTransaction({to: v.account.address, value: 60_000_000_000_000_000n, ...(await fees())}), "fund voter");
    }
  }

  // ── 5. commit ────────────────────────────────────────────────────────────
  console.log("\n── 5. commit (the vote is a hash; nobody can see it) ──");
  // A REAL receipt per resolver, uploaded before it is committed to.
  //
  // This used to anchor `keccak256("brier-committee-" + MARKET)` — a number
  // invented from the market address, pointing at nothing. The chain then
  // recorded "here is the receipt" for a document that did not exist, and the
  // settlement report on the website said so: root present, body missing. A
  // placeholder is worse than an empty field, because it looks like evidence.
  //
  // One document per member, not one shared between them: a committee's whole
  // value is that its members judged separately, and three identical roots would
  // be a claim that they did not.
  const roundNo = (await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]})).index;
  const salts = new Map();
  const roots = new Map();
  for (const r of voters) {
    const doc = JSON.stringify({
      version: 1,
      market: MARKET,
      specRoot,
      round: Number(roundNo),
      resolver: r.account.address,
      // `route: "none"` is the honest value and the reader treats it as such:
      // a null model produces NO vote row, so the settlement report shows this
      // was decided without one rather than inventing an attestation. The 0G
      // Compute path is `examples/resolve.ts`, and it is a separate claim.
      inference: {route: "none", providerAddress: null, model: null, chatID: null, teeVerified: false, temperature: null, simulated: false},
      evidence: [{...evidence, agentId: Number(r.agentId)}],
      outcome: outcome === 1 ? "YES" : outcome === 0 ? "NO" : "UNRESOLVABLE",
      confidence: 1,
      // `rationale`, not `reasoning`. The reader looks for this exact key and
      // treats a receipt without it as unreadable — an anchored root with no
      // legible document behind it, which is the one thing worse than no root.
      rationale: `Coinbase candle for the pinned minute closed at ${reading}; the rule asks for strictly greater than ${threshold}. ${reading > threshold ? "Greater, so YES" : "Not greater, so NO"}.`,
      criteria: spec.rules ?? null,
      citations: [src.url],
      rawResponse: null,
    }, null, 2);
    const root = execFileSync("node", [`${ROOT}/scripts/upload-doc.mjs`], {
      input: doc,
      env: {...process.env, UPLOADER_KEY: DEPLOYER},
      encoding: "utf8",
    }).trim().split("\n").pop();
    roots.set(r.agentId, root);
    console.log(`   agent ${r.agentId} receipt ${root.slice(0, 18)}…`);

    salts.set(r.agentId, keccak256(toHex(`salt-${r.agentId}-${MARKET}`)));
  }

  // Commits go out only once every receipt exists. Interleaving them would put
  // an upload between each pair of transactions, and the window is a deadline
  // for the whole set, not for each one.
  for (const r of voters) {
    const commitment = keccak256(encodeAbiParameters(parseAbiParameters("address, uint8, bytes32, bytes32, address"), [MARKET, outcome, salts.get(r.agentId), roots.get(r.agentId), r.account.address]));
    await send(r.wallet, {address: C.ResolutionModule, abi: MODULE, functionName: "commitVote", args: [MARKET, r.agentId, commitment]}, "commit");
    console.log(`   agent ${r.agentId} committed ${commitment.slice(0, 18)}…`);
  }

  // ── 6. reveal ────────────────────────────────────────────────────────────
  const round = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [MARKET]});
  const waitCommit = Number(round.commitDeadline) - Math.floor(Date.now() / 1000) + 5;
  if (waitCommit > 0) { console.log(`\n   waiting ${waitCommit}s for the commit window to close`); await sleep(waitCommit); }
  console.log("── 6. reveal ──");
  for (const r of voters) {
    await send(r.wallet, {address: C.ResolutionModule, abi: MODULE, functionName: "revealVote", args: [MARKET, r.agentId, outcome, salts.get(r.agentId), roots.get(r.agentId)]}, "reveal");
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
  for (const r of voters) {
    const rep = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "reputationOf", args: [r.agentId]});
    const stakeLeft = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "stakeOf", args: [r.agentId]});
    console.log(`   agent ${r.agentId}  agreed ${rep.resolutionsAgreed}  overturned ${rep.resolutionsOverturned}  stake ${formatUnits(stakeLeft, 6)}  erc8004 #${await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "erc8004Of", args: [r.agentId]})}`);
  }
  console.log(`\n   finalize block ${fin.blockNumber} — read FeedbackPublished from it to see the 8004 records`);

  // ── 9. put the windows back ──────────────────────────────────────────────
  // Step 1 shortened them so a lifecycle fits in one sitting. Leaving them short
  // is not harmless: the deployment then MISREPRESENTS itself — anyone reading the
  // config, or the docs page that quotes it, sees a one-minute dispute window that
  // nobody chose. Restored here rather than left to the operator, because the
  // script is what changed them.
  console.log("\n── 9. windows restored ──");
  for (const [name, value] of restore) {
    await send(boss, {address: C.ConfigRegistry, abi: CONFIG, functionName: "setParam", args: [key(name), value]}, `restore ${name}`);
    console.log(`   ${name} → ${value}s`);
  }
}

await main();
