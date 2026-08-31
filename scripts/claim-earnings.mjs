/**
 * A resolver collects what it earned for settling a market honestly.
 *
 *   DEPLOYER_KEY=0x… node scripts/claim-earnings.mjs [agentId]
 *
 * The resolver fee share used to accrue to the ResolutionModule and stay there:
 * `settle()` moved the collateral, and no function moved it back out. This calls
 * the function that now does.
 *
 * WHO MAY CALL IT. `claim` binds to the agent's ERC-721 owner, not its operator
 * and not whoever happens to be paying gas — so a compromised voting key cannot
 * withdraw the earnings it voted for. The committee wallets are DERIVED from the
 * deployer secret the same way `committee-run.mjs` derives them, never stored,
 * and they are the owners because they are what called `register`.
 *
 * PULL, NOT PUSH. Nothing sweeps earnings to a resolver. That is deliberate: a
 * settlement that pushed payments would let one reverting recipient block every
 * other resolver's payout, and settlement is the one transaction that must not
 * be blockable.
 */
import {createPublicClient, createWalletClient, defineChain, http, keccak256, encodeAbiParameters, parseAbiParameters, formatUnits} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import fs from "node:fs";

const RPC = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const raw = process.env.DEPLOYER_KEY;
if (!raw) throw new Error("set DEPLOYER_KEY — the resolver wallets are derived from it");
const DEPLOYER = raw.startsWith("0x") ? raw : `0x${raw}`;
const WANT = process.argv[2] ? BigInt(process.argv[2]) : null;

const C = JSON.parse(fs.readFileSync(new URL("../deployments/16602.json", import.meta.url), "utf-8")).contracts;
const chain = defineChain({id: 16602, name: "galileo", nativeCurrency: {name: "0G", symbol: "0G", decimals: 18}, rpcUrls: {default: {http: [RPC]}}});
const pub = createPublicClient({chain, transport: http(RPC)});

const MODULE = [
  {type: "function", name: "owedTo", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "totalOwed", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{name: "agentId", type: "uint256"}, {name: "to", type: "address"}], outputs: [{type: "uint256"}]},
];
const REGISTRY = [{type: "function", name: "agentOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]}];
const ERC20 = [{type: "function", name: "balanceOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]}];

const resolverKey = (i) => keccak256(encodeAbiParameters(parseAbiParameters("bytes32, string, uint256"), [DEPLOYER, "brier-resolver", BigInt(i)]));

async function fees() {
  const tip = 4_000_000_000n;
  const base = (await pub.getBlock()).baseFeePerGas ?? 0n;
  return {maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip};
}

console.log(`module   ${C.ResolutionModule}`);
console.log(`totalOwed ${formatUnits(await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "totalOwed"}), 6)} mUSDC\n`);

let claimed = false;
for (let i = 0; i < 5; i++) {
  const account = privateKeyToAccount(resolverKey(i));
  const agentId = await pub.readContract({address: C.AgentRegistry, abi: REGISTRY, functionName: "agentOf", args: [account.address]});
  if (agentId === 0n) continue;
  const owed = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "owedTo", args: [agentId]});
  console.log(`agent ${agentId}  owner ${account.address}  owed ${formatUnits(owed, 6)} mUSDC`);
  if (owed === 0n) continue;
  if (WANT !== null && agentId !== WANT) continue;

  const before = await pub.readContract({address: C.MockUSDC, abi: ERC20, functionName: "balanceOf", args: [account.address]});
  const wallet = createWalletClient({account, chain, transport: http(RPC)});
  const hash = await wallet.writeContract({address: C.ResolutionModule, abi: MODULE, functionName: "claim", args: [agentId, account.address], ...(await fees())});
  // Galileo can take a while to surface a receipt, and the default wait gave up
  // early — reporting a claim as failed on a run where the transfer had in fact
  // landed. Saying "it failed" about money that moved is the worse error of the
  // two, so this waits properly rather than guessing.
  const receipt = await pub.waitForTransactionReceipt({hash, timeout: 180_000, pollingInterval: 2_000});
  // A mined receipt is not a successful one. Checking `status` is the difference
  // between reporting work done and reporting a transaction that happened.
  if (receipt.status !== "success") throw new Error(`claim reverted: ${hash}`);
  const after = await pub.readContract({address: C.MockUSDC, abi: ERC20, functionName: "balanceOf", args: [account.address]});

  console.log(`\n   claim tx   ${hash}`);
  console.log(`   balance    ${formatUnits(before, 6)} → ${formatUnits(after, 6)} mUSDC  (+${formatUnits(after - before, 6)})`);
  console.log(`   owedTo now ${formatUnits(await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "owedTo", args: [agentId]}), 6)}`);
  console.log(`   totalOwed  ${formatUnits(await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "totalOwed"}), 6)}`);
  claimed = true;
  break;
}
if (!claimed) console.log("\nnothing to claim — no derived resolver has a balance owed.");
