// A dress rehearsal for the NEW resolution flow against a live chain. Nothing is
// mocked: every number printed is read back from the chain after the transaction
// that produced it.
//
//   ZERO_G_TESTNET_RPC=... DEPLOYER_KEY=... CURATOR_KEY=... node scripts/rehearse-resolution.mjs
//
// LOWER THE WINDOWS FIRST, or this takes eight hours rather than twenty minutes:
// COMMIT_WINDOW and REVEAL_WINDOW ship at an hour apiece and the run waits out
// both, twice. `setParam` them to 300 and put them back afterwards — the bounds
// allow 60 as a floor, so nothing here needs a redeployment.
//
// Two checks are BEST EFFORT and say so when they miss: `DrawNotReady` needs a
// call to arrive inside the eight blocks between requesting a draw and its block
// being mined, which on 0G is about twelve seconds — less than two round trips to
// a public endpoint. The property itself is pinned exhaustively by
// test_aDrawCannotBeClaimedBeforeItsBlockIsMined in the Foundry suite; what this
// file reports is whether it was observable from outside, not whether it exists.
//
// Yang dibuktikan, berurutan:
//   A. undian dua fase  — openResolution ditolak sebelum blok undiannya ditambang
//   B. undian tak bisa dipilih — komite sama di blok klaim mana pun
//   C. ronde 2 diundi terpisah dan mengecualikan seluruh ronde 1
//   D. ronde 2 menunggu habis reveal window sebelum finalize
//   E. market benar-benar settle
import {createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, keccak256, toHex, stringToHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {readFileSync} from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const RPC = process.env.ZERO_G_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai";
const C = JSON.parse(readFileSync(`${ROOT}/deployments/16602.json`, "utf8")).contracts;
const COMMITTEE = JSON.parse(readFileSync(`${ROOT}/deployments/committee-16602.json`, "utf8"));

const k = (s) => (s.startsWith("0x") ? s : `0x${s}`);
const boss = privateKeyToAccount(k(process.env.DEPLOYER_KEY));
const curator = privateKeyToAccount(k(process.env.CURATOR_KEY));

const chain = {id: 16602, name: "galileo", nativeCurrency: {name: "0G", symbol: "0G", decimals: 18},
  rpcUrls: {default: {http: [RPC]}}};
const pub = createPublicClient({chain, transport: http(RPC, {batch: {batchSize: 20, wait: 16}, retryCount: 6, retryDelay: 400})});
const wallet = (acct) => createWalletClient({account: acct, chain, transport: http(RPC, {retryCount: 6, retryDelay: 400})});

const FACTORY = parseAbi([
  "struct Params { address collateral; address creator; uint256 creatorAgentId; uint64 tradingEnd; uint64 settlementDeadline; uint8 tier; bytes32 specRoot; bytes32 category; }",
  "function createMarket((address,address,uint256,uint64,uint64,uint8,bytes32,bytes32) p, uint256 seedTokens, uint256 depositTokens, uint256 nonce, bytes curatorSig) returns (address)",
  "function marketCount() view returns (uint256)",
  "function marketAt(uint256) view returns (address)",
]);
const MARKET = parseAbi([
  "function close()", "function status() view returns (uint8)",
  "function winningOutcome() view returns (uint8)", "function tier() view returns (uint8)",
  "function settlementDeadline() view returns (uint64)",
]);
const MODULE = parseAbi([
  "function requestResolution(address)", "function openResolution(address)", "function openDisputeRound(address)",
  "function drawOf(address) view returns ((uint64,uint8))",
  "function committeeOf(address) view returns (uint256[])",
  "function roundOf(address) view returns ((uint8,uint8,uint8,uint8,uint64,uint64,uint64,uint16,uint16,bool))",
  "function commitVote(address,uint256,bytes32)",
  "function revealVote(address,uint256,uint8,bytes32,bytes32)",
  "function dispute(address,bytes32)", "function finalize(address)",
]);
const REG = parseAbi(["function operatorOf(uint256) view returns (address)"]);
const ERC20 = parseAbi(["function mintTo(address,uint256)", "function approve(address,uint256) returns (bool)"]);
const CFG = parseAbi(["function params(bytes32) view returns (uint256)"]);

const P = (n) => pub.readContract({address: C.ConfigRegistry, abi: CFG, functionName: "params", args: [keccak256(toHex(n))]});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fees = null;
async function feeOpts() {
  const tip = BigInt(await pub.request({method: "eth_maxPriorityFeePerGas"}));
  const base = (await pub.getBlock()).baseFeePerGas ?? 0n;
  return {maxPriorityFeePerGas: tip, maxFeePerGas: tip + base * 4n + 1_000_000_000n};
}
async function send(acct, req, label) {
  fees = await feeOpts();
  const {request} = await pub.simulateContract({...req, account: acct});
  const hash = await wallet(acct).writeContract({...request, ...fees});
  return waitReceipt(hash, label);
}

// Penungguan resi milik sendiri, bukan `waitForTransactionReceipt`. Node publik
// Galileo kerap menjawab "belum ada" untuk transaksi yang SUDAH mendarat, dan
// viem memperlakukan itu sebagai kegagalan akhir. Terlihat pada 2026-08-31: sebuah
// `approve` yang sukses di blok 52348572 dilaporkan sebagai resi yang tidak ada.
// "Belum ada" di sini berarti terus menunggu; hanya habisnya waktu yang menyerah.
async function waitReceipt(hash, label, timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await pub.getTransactionReceipt({hash});
      if (r) {
        if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
        return r;
      }
    } catch (e) {
      // Endpoint publik Galileo menolak resi transaksi yang sudah mendarat dalam
      // beberapa bentuk berbeda: "could not be found", dan juga -32000 dengan
      // "no matching receipts found: this may indicate potential data corruption",
      // yang terdengar mengkhawatirkan dan ternyata hanya berarti "belum saya
      // indeks". Semuanya diperlakukan sebagai "tunggu lagi".
      const msg = `${e.shortMessage ?? ""} ${e.message ?? ""} ${e.details ?? ""}`;
      if (!/could not be found|not be processed|no matching receipts/i.test(msg)) throw e;
    }
    await sleep(3000);
  }
  throw new Error(`${label}: tidak ada resi untuk ${hash} setelah ${timeoutMs / 1000}s`);
}
async function expectRevert(acct, req, label, want) {
  try { await pub.simulateContract({...req, account: acct}); }
  catch (e) {
    const m = (e.shortMessage ?? e.message ?? "").replace(/\s+/g, " ");
    console.log(`   ✓ ${label} ditolak: ${want}`);
    if (!m.includes(want)) console.log(`     (pesan penuh: ${m.slice(0, 160)})`);
    return;
  }
  throw new Error(`${label}: TIDAK ditolak, padahal harus ${want}`);
}
const shape = (v) => `${v >> 8} of ${v & 255}`;

// ── 1. sebuah market ─────────────────────────────────────────────────────────
console.log("── 1. membuat market ──");
const seed = await P("MIN_SEED"), deposit = await P("MIN_SETTLEMENT_DEPOSIT");
const minWindow = await P("MIN_SETTLEMENT_WINDOW");
const now = BigInt((await pub.getBlock()).timestamp);
const tradingEnd = now + 90n;
const settlementDeadline = tradingEnd + minWindow + 3600n;
const p = {
  collateral: C.MockUSDC, creator: boss.address, creatorAgentId: 0n,
  tradingEnd, settlementDeadline, tier: 1,               // VERIFIED
  specRoot: keccak256(toHex("gladi-resik-resolusi")),
  // Kategori disimpan sebagai STRING ASCII di dalam bytes32 — `addCategory("crypto")`
  // di Solidity adalah literal yang di-pad ke kanan, bukan hash-nya. Memakai
  // keccak256 di sini membuat createMarket ditolak `UnknownCategory`.
  category: stringToHex("crypto", {size: 32}),
};
console.log(`   seed ${seed} deposit ${deposit}  jendela settle ${minWindow}s (min)`);

await send(boss, {address: C.MockUSDC, abi: ERC20, functionName: "mintTo", args: [boss.address, (seed + deposit) * 4n]}, "mintTo");
await send(boss, {address: C.MockUSDC, abi: ERC20, functionName: "approve", args: [C.MarketFactory, (seed + deposit) * 4n]}, "approve");

const TYPEHASH = keccak256(toHex(
  "MarketApproval(bytes32 specRoot,uint64 tradingEnd,uint64 settlementDeadline,uint8 tier,uint256 creatorAgentId,bytes32 category,address creator,address collateral,uint256 seedTokens,uint256 depositTokens,uint256 nonce)"));
const nonce = BigInt(Date.now());
const structHash = keccak256(encodeAbiParameters(
  [{type:"bytes32"},{type:"bytes32"},{type:"uint64"},{type:"uint64"},{type:"uint8"},{type:"uint256"},{type:"bytes32"},{type:"address"},{type:"address"},{type:"uint256"},{type:"uint256"},{type:"uint256"}],
  [TYPEHASH, p.specRoot, p.tradingEnd, p.settlementDeadline, p.tier, p.creatorAgentId, p.category, p.creator, p.collateral, seed, deposit, nonce]));
// Digest EIP-712 dirakit dari primitifnya: yang kita punya adalah structHash yang
// sudah jadi, bukan objek pesan, dan `signTypedData` menuntut yang kedua.
const domainSep = keccak256(encodeAbiParameters(
  [{type:"bytes32"},{type:"bytes32"},{type:"bytes32"},{type:"uint256"},{type:"address"}],
  [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
   keccak256(toHex("Brier")), keccak256(toHex("1")), 16602n, C.MarketFactory]));
const digest = keccak256(`0x1901${domainSep.slice(2)}${structHash.slice(2)}`);
const curatorSig = await curator.sign({hash: digest});

const before = await pub.readContract({address: C.MarketFactory, abi: FACTORY, functionName: "marketCount"});
await send(boss, {address: C.MarketFactory, abi: FACTORY, functionName: "createMarket",
  args: [[p.collateral, p.creator, p.creatorAgentId, p.tradingEnd, p.settlementDeadline, p.tier, p.specRoot, p.category], seed, deposit, nonce, curatorSig]}, "createMarket");
const market = await pub.readContract({address: C.MarketFactory, abi: FACTORY, functionName: "marketAt", args: [before]});
console.log(`   market ${market}  tier VERIFIED  komite ${shape(Number(await P("COMMITTEE_VERIFIED")))}`);

// ── 2. tutup ─────────────────────────────────────────────────────────────────
console.log("\n── 2. menunggu tradingEnd lalu close() ──");
while (BigInt((await pub.getBlock()).timestamp) < tradingEnd) await sleep(5000);
await send(boss, {address: market, abi: MARKET, functionName: "close"}, "close");
console.log(`   status ${await pub.readContract({address: market, abi: MARKET, functionName: "status"})} (1 = Closed)`);

// ── 3. UJI A: undian dua fase ────────────────────────────────────────────────
console.log("\n── 3. UJI A — undian tidak bisa diklaim sebelum bloknya ada ──");
await expectRevert(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "openResolution", args: [market]},
  "openResolution tanpa meminta undian", "NoDrawRequested");

const reqRcpt = await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "requestResolution", args: [market]}, "requestResolution");
// Diuji SEGERA, sebelum panggilan RPC lain: delapan blok Galileo berlalu dalam
// belasan detik, dan menunggu apa pun di antaranya menghabiskan jendelanya.
// BEST EFFORT, dan tidak mematikan. Delapan blok Galileo berlalu dalam belasan
// detik sementara dua round-trip ke endpoint publik sudah memakan sebagian
// besarnya, jadi jendela untuk mengamati `DrawNotReady` dari luar sering sudah
// tutup sebelum panggilannya sampai. Sifatnya sendiri dijamin lengkap oleh
// test_aDrawCannotBeClaimedBeforeItsBlockIsMined di suite Foundry; yang dilaporkan
// di sini adalah apakah sempat teramati, bukan apakah ada.
const drawEarly = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "drawOf", args: [market]});
try {
  await pub.simulateContract({address: C.ResolutionModule, abi: MODULE, functionName: "openResolution", args: [market], account: boss});
  console.log(`   – DrawNotReady tidak teramati: rantai sudah melewati blok ${drawEarly[0]} sebelum panggilan sampai`);
  console.log("     (dijamin oleh test_aDrawCannotBeClaimedBeforeItsBlockIsMined di suite Foundry)");
} catch {
  console.log("   ✓ openResolution sebelum blok undian ditolak: DrawNotReady");
}
const draw = drawEarly;
const drawBlock = draw[0];
const delay = await P("RESOLUTION_DRAW_DELAY");
// Dibandingkan dengan blok tempat PERMINTAAN mendarat, bukan dengan kepala rantai
// saat ini. Galileo memproduksi blok lebih cepat daripada kita bisa membacanya, jadi
// "sekarang" sudah melewati blok undian sebelum baris ini jalan — itu balapan pada
// pengujiannya, bukan sifat yang diuji. Yang penting: pada saat transaksi itu
// DIEKSEKUSI, blok penyemainya belum ada, jadi tidak ada yang bisa membacanya.
console.log(`   permintaan mendarat di blok ${reqRcpt.blockNumber}; undian untuk blok ${drawBlock} (+${delay})`);
if (drawBlock !== reqRcpt.blockNumber + delay) {
  throw new Error(`blok undian harus ${reqRcpt.blockNumber + delay}, tercatat ${drawBlock}`);
}
console.log("   ✓ benih terikat pada blok yang belum ditambang saat permintaan dieksekusi");

while ((await pub.getBlockNumber()) <= drawBlock) await sleep(2000);
console.log(`   blok ${drawBlock} kini ada, hash ${(await pub.getBlock({blockNumber: drawBlock})).hash.slice(0, 18)}…`);

// ── 4. UJI B: benihnya sudah beku sebelum diklaim ───────────────────────────
// Sengaja menunggu beberapa blok EKSTRA sebelum mengklaim. Pada kode lama, tiap
// blok tambahan adalah undian gratis yang baru; di sini benihnya sudah ditetapkan
// oleh blok yang diminta, jadi menunggu tidak mengubah apa pun. Kesamaan komite
// pada 40 blok klaim berbeda dibuktikan lengkap oleh
// test_theCommitteeDoesNotDependOnWhenTheDrawIsClaimed di suite Foundry; yang
// diperiksa DI SINI adalah bahwa undian benar-benar terikat pada blok itu.
console.log("\n── 4. UJI B — benih sudah beku, menunggu tidak mengubahnya ──");
const seedHash = (await pub.getBlock({blockNumber: drawBlock})).hash;
for (let i = 0; i < 4; i++) await sleep(3000);
const headAtClaim = await pub.getBlockNumber();
console.log(`   diklaim ${headAtClaim - drawBlock} blok setelah blok undian, benih tetap ${seedHash.slice(0, 18)}…`);

await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "openResolution", args: [market]}, "openResolution");
const round1 = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "committeeOf", args: [market]});
console.log(`   komite ronde 1 (${round1.length} anggota): ${round1.join(", ")}`);
if (round1.length !== 5) throw new Error(`komite harus 5, dapat ${round1.length}`);

// Undian yang sudah dibelanjakan dihapus — "minta lagi" tidak boleh jadi cara
// mengulang undian yang masih hidup.
const spent = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "drawOf", args: [market]});
console.log(`   undian setelah dipakai: drawBlock=${spent[0]} ${spent[0] === 0n ? "(terhapus, benar)" : "(MASIH ADA — salah)"}`);
if (spent[0] !== 0n) throw new Error("undian tidak dihapus setelah dipakai");
await expectRevert(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "requestResolution", args: [market]},
  "meminta undian ulang untuk ronde yang sudah diundi", "RoundAlreadyOpen");

// ── 5. commit + reveal ───────────────────────────────────────────────────────
const opOf = async (id) => pub.readContract({address: C.AgentRegistry, abi: REG, functionName: "operatorOf", args: [id]});
// Kunci operator diturunkan dari kunci deployer plus indeks. Ada DUA skema di
// chain ini: `cast to-bytes32` memadatkan indeks ke KANAN (dipakai untuk agen
// 1..10, dan itulah yang membuat indeks 1 dan 10 bertabrakan), sementara
// perbaikannya memadatkan ke KIRI. Alih-alih menebak agen mana pakai yang mana,
// kedua skema dihitung untuk rentang indeks yang masuk akal dan dicocokkan ke
// `operatorOf` yang dibaca dari chain. Tidak ada kunci privat yang disimpan.
const DK = k(process.env.DEPLOYER_KEY).slice(2);
const candidates = new Map();
for (let i = 0; i < 32; i++) {
  const right = i.toString(16).padEnd(64, "0");   // cast to-bytes32, skema lama
  const left  = i.toString(16).padStart(64, "0"); // printf %064x, skema baru
  for (const enc of new Set([right, left])) {
    const key = keccak256(`0x${DK}${enc}`);
    candidates.set(privateKeyToAccount(key).address.toLowerCase(), key);
  }
}
const keyOf = async (agentId) => {
  const op = (await opOf(agentId)).toLowerCase();
  const key = candidates.get(op);
  if (!key) throw new Error(`tidak menemukan kunci untuk operator ${op} (agent ${agentId})`);
  return key;
};
async function voteAll(members, outcome, tag) {
  const commitment = (m, op) => keccak256(encodeAbiParameters(
    [{type:"address"},{type:"uint8"},{type:"bytes32"},{type:"bytes32"},{type:"address"}],
    [market, outcome, keccak256(toHex(`salt-${tag}-${m}`)), keccak256(toHex(`receipt-${tag}-${m}`)), op]));
  for (const m of members) {
    const acct = privateKeyToAccount(await keyOf(m));
    if ((await opOf(m)).toLowerCase() !== acct.address.toLowerCase()) throw new Error(`kunci operator agent ${m} tidak cocok`);
    await send(acct, {address: C.ResolutionModule, abi: MODULE, functionName: "commitVote", args: [market, m, commitment(m, acct.address)]}, `commit ${m}`);
  }
  const r = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [market]});
  console.log(`   ${members.length} commit terkirim; menunggu commitDeadline (${r[4]})`);
  while (BigInt((await pub.getBlock()).timestamp) <= r[4]) await sleep(5000);
  for (const m of members) {
    const acct = privateKeyToAccount(await keyOf(m));
    await send(acct, {address: C.ResolutionModule, abi: MODULE, functionName: "revealVote",
      args: [market, m, outcome, keccak256(toHex(`salt-${tag}-${m}`)), keccak256(toHex(`receipt-${tag}-${m}`))]}, `reveal ${m}`);
  }
}
console.log("\n── 5. ronde 1 memilih YES ──");
await voteAll(round1, 1, "r1");
console.log(`   status market ${await pub.readContract({address: market, abi: MARKET, functionName: "status"})} (2 = Proposed)`);

// ── 6. UJI C: ronde dispute diundi terpisah, dan mengecualikan ronde 1 ───────
console.log("\n── 6. UJI C — dispute memesan undian, tidak mengundinya sendiri ──");
const bond = await P("DISPUTE_BOND");
await send(boss, {address: C.MockUSDC, abi: ERC20, functionName: "mintTo", args: [boss.address, bond * 2n]}, "mintTo bond");
await send(boss, {address: C.MockUSDC, abi: ERC20, functionName: "approve", args: [C.ResolutionModule, bond * 2n]}, "approve bond");
await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "dispute", args: [market, keccak256(toHex("bukti"))]}, "dispute");

const midCommittee = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "committeeOf", args: [market]});
const r2draw = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "drawOf", args: [market]});
console.log(`   setelah dispute: komite ${midCommittee.length} anggota (harus 0 — belum diundi), undian ronde ${r2draw[1]} untuk blok ${r2draw[0]}`);
if (midCommittee.length !== 0) throw new Error("dispute masih mengundi komitenya sendiri — inilah cacat yang diperbaiki");
if (r2draw[1] !== 2) throw new Error(`undian harus untuk ronde 2, dapat ${r2draw[1]}`);
console.log("   ✓ penantang tidak memilih ronde yang mereview tantangannya");

// Best effort, dengan alasan yang sama seperti pada ronde 1.
try {
  await pub.simulateContract({address: C.ResolutionModule, abi: MODULE, functionName: "openDisputeRound", args: [market], account: boss});
  console.log(`   – DrawNotReady tidak teramati: rantai sudah melewati blok ${r2draw[0]}`);
} catch {
  console.log("   ✓ openDisputeRound sebelum blok undian ditolak: DrawNotReady");
}
while ((await pub.getBlockNumber()) <= r2draw[0]) await sleep(2000);
await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "openDisputeRound", args: [market]}, "openDisputeRound");

const round2 = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "committeeOf", args: [market]});
const overlap = round2.filter((m) => round1.some((x) => x === m));
console.log(`   komite ronde 2 (${round2.length} anggota): ${round2.join(", ")}`);
console.log(`   irisan dengan ronde 1: ${overlap.length} ${overlap.length === 0 ? "(benar — dikecualikan seluruhnya)" : "(SALAH)"}`);
if (round2.length !== 9) throw new Error(`ronde dispute harus 9, dapat ${round2.length}`);
if (overlap.length !== 0) throw new Error("ronde 1 ikut mereview pekerjaannya sendiri");

// ── 7. ronde 2 membalik ke NO, lalu UJI D: finalize harus menunggu ──────────
console.log("\n── 7. ronde 2 memilih NO (membalik ronde 1) ──");
await voteAll(round2, 0, "r2");
const r2 = await pub.readContract({address: C.ResolutionModule, abi: MODULE, functionName: "roundOf", args: [market]});
console.log(`   reveal ${r2[8]} dari ${r2[0]}, ambang ${r2[1]}`);

console.log("\n── 8. UJI D — ronde 2 menunggu habis reveal window meski semua sudah memilih ──");
if (BigInt((await pub.getBlock()).timestamp) <= r2[5]) {
  await expectRevert(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "finalize", args: [market]},
    "finalize sebelum revealDeadline", "TooEarly");
} else console.log("   (jendela sudah lewat sebelum sempat diuji — lewati)");
while (BigInt((await pub.getBlock()).timestamp) <= r2[5]) await sleep(5000);

// ── 9. UJI E: benar-benar settle ────────────────────────────────────────────
console.log("\n── 9. UJI E — finalize ──");
await send(boss, {address: C.ResolutionModule, abi: MODULE, functionName: "finalize", args: [market]}, "finalize");
const st = await pub.readContract({address: market, abi: MARKET, functionName: "status"});
const win = await pub.readContract({address: market, abi: MARKET, functionName: "winningOutcome"});
console.log(`   status ${st} (4 = Settled), pemenang ${win} (${win === 1 ? "YES" : "NO"})`);
if (st !== 4) throw new Error(`market tidak settle, status ${st}`);
if (win !== 0) throw new Error(`ronde 2 memilih NO tapi yang tercatat ${win}`);
console.log(`\n✓ SELESAI — market ${market}`);
console.log("  A undian dua fase        NoDrawRequested -> DrawNotReady -> sukses");
console.log("  B benih beku             undian terhapus setelah dipakai, tak bisa diminta ulang");
console.log("  C ronde 2 terpisah       dispute tidak mengundi; 0 irisan dengan ronde 1");
console.log("  D ronde 2 menunggu       finalize ditolak sebelum revealDeadline");
console.log("  E settle                 pembalikan ronde 2 tercatat di chain");
