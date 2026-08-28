#!/usr/bin/env node
/**
 * Prepares a wallet to run inference on 0G Compute: a ledger, a provider
 * sub-account, and the TEE-signer acknowledgement.
 *
 *   DEPLOYER_KEY=... node scripts/setup-compute.mjs [--provider 0x...]
 *
 * Idempotent — every step checks before it spends.
 *
 * WHAT IT COSTS, because the numbers are contract minimums and not suggestions:
 *   - 3 0G to create the ledger (`MIN_LEDGER_BALANCE_OG`). Below that the call
 *     reverts; there is no smaller ledger.
 *   - 1 0G moved from the ledger into the provider's sub-account
 *     (`MIN_TRANSFER_AMOUNT`). This does NOT come out of the wallet again.
 *   - The SDK's auto-funding then tends to move the REST of the ledger into that
 *     sub-account on first use, so expect the ledger to read 0 available
 *     afterwards. The funds are still yours.
 *   - Recoverable via `broker.ledger.retrieveFund('inference')`, after the
 *     inference contract's `lockTime` — 86400s on Galileo.
 *
 * Inference itself is cheap by comparison: the qwen provider prices input at
 * ~1.08e12 neuron and output at ~4.33e12, i.e. millionths of a 0G.
 */
import {createZGComputeNetworkBroker} from "@0gfoundation/0g-compute-ts-sdk";
import {ethers} from "ethers";

const RPC = process.env.ZERO_G_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai";
const argProvider = process.argv[process.argv.indexOf("--provider") + 1];
const PROVIDER =
  process.argv.includes("--provider") && argProvider ? argProvider : process.env.ZG_PROVIDER;

const key = process.env.DEPLOYER_KEY;
if (!key) {
  console.error("setup-compute: DEPLOYER_KEY is not set");
  process.exit(1);
}

const rpc = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, rpc);
const broker = await createZGComputeNetworkBroker(wallet);

console.log(`wallet  ${wallet.address}`);
console.log(`balance ${ethers.formatEther(await rpc.getBalance(wallet.address))} 0G`);

if (!PROVIDER) {
  console.log("\nno --provider given. The live catalogue (free to read):\n");
  for (const s of await broker.inference.listService()) {
    console.log(`  ${s.provider}  ${s.model}  (${s.serviceType}, ${s.verifiability ?? "unverified"})`);
  }
  console.log("\nRe-run with --provider <address>. Never hardcode one in an agent:");
  console.log("the catalogue shifts, and a dead address fails only at request time.");
  process.exit(0);
}

console.log(`\n1/3 ledger`);
let ledgerExists = true;
try {
  await broker.ledger.getLedger();
} catch {
  ledgerExists = false;
}
if (ledgerExists) {
  console.log(`    exists: ${ethers.formatEther((await broker.ledger.getLedger()).totalBalance)} 0G`);
} else {
  console.log(`    creating with 3 0G (the contract minimum)`);
  await broker.ledger.depositFund(3);
  console.log(`    created: ${ethers.formatEther((await broker.ledger.getLedger()).totalBalance)} 0G`);
}

// FUNDING COMES BEFORE ACKNOWLEDGEMENT, and the order is not cosmetic:
// `acknowledged()` reads the provider sub-account, and reading one that does not
// exist reverts `AccountNotExists`. Acknowledging first looks like the natural
// order and fails.
console.log(`\n2/3 provider sub-account`);
let funded = false;
try {
  const acct = await broker.inference.getAccount(PROVIDER);
  funded = acct.balance > 0n;
  console.log(`    exists: ${ethers.formatEther(acct.balance)} 0G`);
} catch {
  console.log(`    creating with 1 0G (the contract minimum transfer, from the ledger)`);
}
if (!funded) {
  await broker.ledger.transferFund(PROVIDER, "inference", 10n ** 18n);
  console.log(`    funded: ${ethers.formatEther((await broker.inference.getAccount(PROVIDER)).balance)} 0G`);
}

console.log(`\n3/3 TEE signer acknowledgement`);
if (await broker.inference.acknowledged(PROVIDER)) {
  const {teeSignerAddress} = await broker.inference.checkProviderSignerStatus(PROVIDER);
  console.log(`    already acknowledged (signer ${teeSignerAddress})`);
} else {
  await broker.inference.acknowledgeProviderSigner(PROVIDER);
  console.log(`    acknowledged`);
}

console.log(`\nready. wallet ${ethers.formatEther(await rpc.getBalance(wallet.address))} 0G left for gas.`);
