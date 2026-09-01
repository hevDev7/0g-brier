/**
 * The 0G Compute inference catalogue, so a provider address is looked up rather
 * than pasted from a chat message.
 *
 *   DEPLOYER_KEY=0x… npx tsx examples/providers.ts
 *
 * Listing is free — it reads the on-chain service registry and asks nothing of
 * any provider. `verifiability` is the column that matters: TeeML means the
 * provider runs inside an enclave and `processResponse` can return an
 * attestation, which is the whole reason to route an agent's judgement here.
 * A provider with no verifiability is a remote API with extra steps.
 */
import {ZgInference} from "../src/index";
import {modeForChainId} from "@0g-brier/protocol";

const raw = process.env.DEPLOYER_KEY ?? process.env.AGENT_KEY;
if (!raw) throw new Error("set DEPLOYER_KEY or AGENT_KEY — listing reads the registry through a wallet");
const KEY = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;

// THREE networks, not two. This read `=== "16602" ? "galileo" : "anvil"`, so
// CHAIN_ID=16661 fell silently to anvil and pointed the listing at localhost —
// which fails as a connection error and reads like the mainnet catalogue being
// unreachable. It matters more than a typo usually would: mainnet carries twelve
// services where Galileo carries two, and the difference is the whole argument
// for a committee whose members do not all run the same model.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);
const NETWORK = modeForChainId(CHAIN_ID);
console.log(`catalogue on ${NETWORK} (chain ${CHAIN_ID})\n`);

const services = await ZgInference.listServices({network: NETWORK, privateKey: KEY});

if (services.length === 0) {
  console.log("no inference services are listed on this network");
  process.exit(0);
}

console.log(`${services.length} inference service(s):\n`);
for (const s of services) {
  // The SDK exports no type for a service, and different versions have returned
  // it as a struct and as a positional tuple. Read both shapes rather than pick
  // one and print `undefined` on the other.
  const provider = s.provider ?? s[0];
  const model = s.model ?? s[5];
  const verifiability = s.verifiability ?? s[7] ?? "none";
  console.log(`  ${model}`);
  console.log(`    provider      ${provider}`);
  console.log(`    verifiability ${verifiability}${verifiability === "TeeML" ? "  ← attestable" : ""}`);
  console.log("");
}
console.log("Run an agent against one with:  ZG_PROVIDER=<provider> INFERENCE_ROUTE=0g-compute");
