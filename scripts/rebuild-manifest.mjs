#!/usr/bin/env node
/**
 * Rebuild deployments/<chainId>.json from what is ACTUALLY on chain.
 *
 *   node scripts/rebuild-manifest.mjs [--chain 16661] [--write]
 *
 * WHY THIS EXISTS. Deploy.s.sol writes the manifest from its SIMULATION. On a
 * `--resume`, forge re-runs that simulation against the current chain state, so it
 * computes a fresh set of predicted addresses — and then writes them over the
 * manifest, even though the transactions it actually broadcasts are the recorded
 * ones from the original run. A deploy that took six resumes therefore finished
 * "successfully" with a manifest in which all fourteen addresses had no code, while
 * the real contracts sat at completely different addresses.
 *
 * This reads the CREATE receipts out of the broadcast log for the real addresses,
 * then CHECKS them against the deployed ConfigRegistry, which is the protocol's own
 * record of where everything is. Nothing is written unless every address answers.
 */
import {readFileSync, writeFileSync} from "node:fs";
import {createPublicClient, http, keccak256, toHex} from "viem";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const CHAIN = Number(arg("--chain", "16661"));
const RPC = arg("--rpc", process.env.ZERO_G_MAINNET_RPC || "https://evmrpc.0g.ai");
const WRITE = process.argv.includes("--write");
const ROOT = new URL("..", import.meta.url).pathname;

const client = createPublicClient({transport: http(RPC)});
const K = (s) => keccak256(toHex(s));

const CONFIG_ABI = [
  {type: "function", name: "addresses", stateMutability: "view", inputs: [{type: "bytes32"}], outputs: [{type: "address"}]},
  {type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
];

const broadcast = JSON.parse(
  readFileSync(`${ROOT}contracts/broadcast/Deploy.s.sol/${CHAIN}/run-latest.json`, "utf8"),
);
const creates = broadcast.transactions.filter((t) => t.transactionType === "CREATE" && t.hash);
const receipts = new Map((broadcast.receipts ?? []).map((r) => [r.transactionHash, r]));
const addressOf = (t) => (t.contractAddress ?? receipts.get(t.hash)?.contractAddress ?? "").toLowerCase();

// Deploy.s.sol's CREATE order. A proxy is named for what it fronts, since that is
// what every consumer of the manifest actually wants.
const ORDER = [
  "ConfigRegistryImpl",
  "ConfigRegistry",
  "OutcomeShares",
  "MarketImplementation",
  "MarketFactoryImpl",
  "MarketFactory",
  "AgentRegistryImpl",
  "AgentRegistry",
  "ZgDataVerifier",
  "AgentCard",
  "ResolutionModuleImpl",
  "ResolutionModule",
  "Timelock",
];
if (creates.length !== ORDER.length) {
  console.error(`✗ ${creates.length} CREATEs in the broadcast log, expected ${ORDER.length}.`);
  console.error("  The script's deployment order changed, or the log is from a different run.");
  process.exit(1);
}
const found = Object.fromEntries(ORDER.map((name, i) => [name, addressOf(creates[i])]));

const code = async (a) => (await client.getCode({address: a})) ?? "0x";
let bad = 0;
console.log(`chain ${CHAIN} via ${RPC}\n`);
for (const [name, addr] of Object.entries(found)) {
  const n = ((await code(addr)).length - 2) / 2;
  if (n === 0) bad++;
  console.log(`  ${name.padEnd(22)} ${addr}  ${n === 0 ? "✗ NO CODE" : `${n} bytes`}`);
}
if (bad) {
  console.error(`\n✗ ${bad} address(es) have no code. Refusing to write a manifest that lies.`);
  process.exit(1);
}

// Cross-check against the protocol's own record. The broadcast log says what was
// created; the registry says what the protocol believes it is using. If those two
// disagree, the manifest would be guesswork.
const config = found.ConfigRegistry;
const owner = await client.readContract({address: config, abi: CONFIG_ABI, functionName: "owner"});
const wired = {
  MarketFactory: "MARKET_FACTORY",
  ResolutionModule: "RESOLUTION_MODULE",
  OutcomeShares: "OUTCOME_SHARES",
  AgentRegistry: "AGENT_REGISTRY",
};
console.log(`\n  registry owner ${owner}\n`);
let mismatched = 0;
for (const [name, key] of Object.entries(wired)) {
  const onChain = (
    await client.readContract({address: config, abi: CONFIG_ABI, functionName: "addresses", args: [K(key)]})
  ).toLowerCase();
  if (onChain === "0x0000000000000000000000000000000000000000") {
    console.log(`  ${key.padEnd(22)} unset in the registry — not cross-checked`);
    continue;
  }
  const ok = onChain === found[name];
  if (!ok) mismatched++;
  console.log(`  ${key.padEnd(22)} ${onChain}  ${ok ? "matches" : `✗ broadcast says ${found[name]}`}`);
}
if (mismatched) {
  console.error(`\n✗ ${mismatched} mismatch(es) between the broadcast log and the registry.`);
  process.exit(1);
}

const collateral = (
  await client.readContract({address: config, abi: CONFIG_ABI, functionName: "addresses", args: [K("STAKE_TOKEN")]})
).toLowerCase();
const firstBlock = Number(receipts.get(creates[0].hash)?.blockNumber ?? 0);

const manifest = {
  chainId: CHAIN,
  contracts: Object.fromEntries(
    Object.entries({...found, MockUSDC: collateral}).sort(([a], [b]) => a.localeCompare(b)),
  ),
  deployedAt: Math.floor(Date.now() / 1000),
  deploymentBlock: firstBlock,
};

const out = `${ROOT}deployments/${CHAIN}.json`;
if (!WRITE) {
  console.log(`\n▶ would write ${out}. Re-run with --write.`);
  process.exit(0);
}
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n✓ wrote ${out} — every address above answered.`);
