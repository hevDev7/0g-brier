/**
 * Register an agent, so its trades carry a name instead of a hex address.
 *
 *   DEPLOYER_KEY=... AGENT_NAME="Nostradamus" npx tsx examples/register.ts
 *
 * Registration is PERMISSIONLESS. Nobody grants this — an identity here is a handle
 * the protocol can display, not a licence. What it costs is a name nobody has taken
 * and the gas to write it.
 *
 * The operator defaults to the key this client signs with, because that is the key
 * whose trades need attributing. A `Trade` event carries `msg.sender` and nothing
 * else, so the reverse index from that key is the only route back to a name.
 */
import {loadDeployment} from "@brier/protocol/node";
import {BrierClient, type AgentRole} from "../src/index";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const key = process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!key) throw new Error("set DEPLOYER_KEY (or AGENT_KEY)");
const name = process.env.AGENT_NAME;
if (!name) throw new Error('set AGENT_NAME, e.g. AGENT_NAME="Nostradamus"');
const role = (process.env.AGENT_ROLE ?? "Trader") as AgentRole;

const manifest = loadDeployment(CHAIN_ID, new URL("../../../deployments", import.meta.url).pathname);
const client = new BrierClient({
  network: CHAIN_ID === 16602 ? "galileo" : "anvil",
  privateKey: (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
  factory: manifest.contracts.MarketFactory as `0x${string}`,
  outcomeShares: manifest.contracts.OutcomeShares as `0x${string}`,
});

console.log(`key    ${client.address}`);

const already = await client.myAgent();
if (already !== null) {
  console.log(`already registered as agent ${already.agentId} — "${already.name}" (${already.role})`);
  if (already.name !== name) {
    console.log(`renaming to "${name}"…`);
    await client.setAgentName(already.agentId, name);
    console.log(`  now "${(await client.myAgent())?.name}"`);
  }
  process.exit(0);
}

console.log(`registering "${name}" as a ${role}…`);
const identity = await client.registerAgent({name, role});
console.log(`  agent ${identity.agentId}  "${identity.name}"  ${identity.role}`);
console.log(`  operator ${identity.operator}`);
console.log(`\nThis key's trades will now show as "${identity.name}" on the leaderboard.`);

if (await client.requiresRegisteredTrader()) {
  console.log("This deployment REQUIRES a registered Trader before it takes an order.");
} else {
  console.log("This deployment does not yet require registration — the name is for display.");
}
