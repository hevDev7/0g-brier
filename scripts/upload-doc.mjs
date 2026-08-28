#!/usr/bin/env node
/**
 * Uploads a JSON document to 0G Storage and prints its Merkle root.
 *
 * Two documents go through here — the MarketSpec a market commits to, and the
 * settlement receipt a resolution anchors — and the upload is identical for
 * both. What differs is which fields must be present, so the caller says:
 * `--require question,rules`.
 *
 * That root goes on chain as `specRoot`, verbatim. It is NOT hashed again: the
 * root IS the content address, and hashing it a second time would leave a
 * bytes32 nobody could ever fetch a document with — which is what the first
 * live market on Galileo shipped with, and why its question does not appear.
 *
 * Reads the document on stdin, writes the root to stdout, everything else to
 * stderr, so a shell can do `ROOT="$(... | upload-spec.mjs)"`.
 *
 * Env: ZG_INDEXER, EVM_RPC, UPLOADER_KEY.
 *
 * `--dry-run` computes and prints the root without uploading. That is what a
 * local anvil run wants: 0G Storage is a real network whose Flow contract lives
 * on 0G Chain, so there is nothing local to upload to. The root is still the
 * TRUE root of the document, so the market commits to a real address — it just
 * commits to one nothing has been stored at, and the UI reports the question as
 * unavailable, which is exactly what is the case.
 */
import {MemData, Indexer} from "@0gfoundation/0g-storage-ts-sdk";
import {ethers} from "ethers";

// The SDK narrates its progress with `console.log`, and stdout is this script's
// RETURN CHANNEL. Left alone, a caller doing `ROOT="$(upload-spec.mjs)"` captures
// "Starting upload for file of size: 750 bytes" and hands it to `cast` as a
// bytes32. Redirected once, here, rather than by filtering the output downstream
// — a filter would have to know every line the SDK might add.
console.log = (...args) => console.error(...args);
const emit = (line) => process.stdout.write(`${line}\n`);

const INDEXER = process.env.ZG_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
const EVM_RPC = process.env.EVM_RPC ?? "https://evmrpc-testnet.0g.ai";

const die = (msg) => {
  console.error(`upload-doc: ${msg}`);
  process.exit(1);
};

const dryRun = process.argv.includes("--dry-run");

const requireArg = process.argv.indexOf("--require");
const required = requireArg === -1 ? [] : (process.argv[requireArg + 1] ?? "").split(",").filter(Boolean);

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

const text = (await readStdin()).trim();
if (text === "") die("no document on stdin");

let doc;
try {
  doc = JSON.parse(text);
} catch (e) {
  die(`stdin is not JSON: ${e.message}`);
}
// Checked BEFORE the transaction rather than after. Uploading a document that the
// UI cannot read costs gas and produces a market that still shows nothing — which
// is the failure this script exists to prevent.
for (const field of required) {
  if (typeof doc[field] !== "string" || doc[field].length === 0) {
    die(`the document has no non-empty "${field}"`);
  }
}

// Canonical bytes, computed once. Everything downstream — the root, the upload,
// the eventual fetch — is about THESE bytes, so they are serialised here and
// never re-serialised.
const bytes = new TextEncoder().encode(JSON.stringify(doc, null, 2));
const file = new MemData(bytes);
const [tree, terr] = await file.merkleTree();
if (terr) die(`merkle: ${terr.message ?? terr}`);
const root = tree.rootHash();
console.error(`   ${bytes.length} bytes, root ${root}`);

if (dryRun) {
  console.error("   --dry-run: not uploaded, so no document stands behind this root yet");
  emit(root);
  process.exit(0);
}

// 0G Storage is content-addressed, so re-uploading identical bytes is a no-op
// that still costs a transaction. Asking first makes the script idempotent.
const probe = await fetch(`${INDEXER}/file?root=${root}`, {signal: AbortSignal.timeout(15_000)});
if (probe.ok) {
  const body = await probe.text();
  if (new TextEncoder().encode(body).length === bytes.length && body === new TextDecoder().decode(bytes)) {
    console.error("   already on 0G Storage, nothing to upload");
    emit(root);
    process.exit(0);
  }
}

const key = process.env.UPLOADER_KEY;
if (!key) die("UPLOADER_KEY is not set");
const provider = new ethers.JsonRpcProvider(EVM_RPC);
const wallet = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
console.error(`   uploading as ${wallet.address}`);

const indexer = new Indexer(INDEXER);
const [res, uerr] = await indexer.upload(file, EVM_RPC, wallet);
if (uerr) die(`upload: ${uerr.message ?? uerr}`);

// The network computed the root independently. If it disagrees with ours, the
// value about to go on chain is not the one the bytes hash to, and every later
// fetch would fail verification.
if (res.rootHash !== root) die(`network returned root ${res.rootHash}, expected ${root}`);
console.error(`   stored in ${res.txHash} (txSeq ${res.txSeq})`);
emit(root);
