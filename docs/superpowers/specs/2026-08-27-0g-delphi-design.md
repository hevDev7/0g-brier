# 0G-Delphi — Agent-Native Binary Prediction Market di 0G Chain

**Status:** Design spec (v1) · **Tanggal:** 2026-08-27 · **Target chain:** 0G Galileo testnet (16602) → 0G mainnet (16661)

---

## 1. Ringkasan Eksekutif

0G-Delphi adalah pasar prediksi biner di mana **seluruh siklus hidup market digerakkan oleh AI agent**: agent yang merancang dan mendanai market, agent yang menjaga kualitasnya, agent yang menyelesaikan hasilnya lewat inferensi terverifikasi TEE, dan agent milik pengguna yang mengambil posisi beli/jual.

Tiga pilihan yang membentuk sistem ini:

1. **Harga dibentuk oleh cost function DPM** `C(q) = √(Σ qᵢ²)`. Pool mendanai pembayarannya sendiri, sehingga protokol **secara struktural tidak bisa insolven** dan tidak butuh subsidi likuiditas.
2. **Settlement dilakukan komite agent ber-stake** yang menjalankan inferensi di 0G Compute dengan atestasi TeeML wajib, menyimpan receipt lengkap di 0G Storage, lewat commit–reveal dengan window sengketa dan slashing.
3. **Batas risiko agent ditegakkan di kontrak**, bukan di kode agent. Setiap pengguna punya `AgentAccount` sendiri; agent tidak pernah memegang kunci dompet pengguna dan tidak bisa melampaui kebijakan yang disetel.

Pembeda utama terhadap Delphi (Gensyn), rujukan terdekat yang ada: **Delphi melarang agent membuat market** — "Agents cannot create markets. Markets must be created through the Delphi UI." Di 0G-Delphi, pembuatan market justru adalah aksi agent kelas satu.

---

## 2. Keputusan Terkunci

| # | Keputusan | Alasan |
|---|---|---|
| D1 | Mekanisme harga: **DPM Pennock** `C(q)=√(Σqᵢ²)` | Pool-funded ⇒ selalu solven, tanpa subsidi LP, hanya butuh `sqrt` di Solidity, rugi creator terbatas 29.29% |
| D2 | Collateral: **mUSDC 6 desimal**, matematika internal wad 18 | Lapisan normalisasi desimal teruji sejak hari pertama; ganti ke stablecoin nyata = ganti konfigurasi |
| D3 | Resolusi: **komite AI k-of-n di 0G Compute** + commit–reveal + dispute + slashing | Premis "digerakkan agent" tetap utuh sampai ke settlement; verifiabilitas dari TeeML |
| D4 | Agent: **runtime terkelola + SDK tipis**, identitas di jalur **ERC-7857** | Demo dan produksi tidak bergantung pada agent pihak ketiga; identitas tetap aset on-chain |
| D5 | Target: **produk serius menuju mainnet 0G** | Dipecah jadi P0–P7, tiap fase punya spec dan plan sendiri |
| D6 | Dana 0G testnet tersedia (>5 0G) | Jalur `INFERENCE_MODE=compute` (TEE) diuji live sejak P4, bukan ditunda |

**Yang diadopsi dari Delphi:** DPM (bukan LMSR/CLOB), settlement bertingkat, creator menulis prompt settlement-nya sendiri, status `failed` → likuidasi (bukan redeem), ergonomi SDK.
**Yang tidak diadopsi:** larangan agent membuat market, ketergantungan pada subgraph terkelola.

---

## 3. Fakta Lingkungan Terverifikasi (probe 2026-08-27)

### 3.1 0G Chain

| Item | Galileo testnet | Mainnet |
|---|---|---|
| Chain ID | `16602` | `16661` |
| RPC | `https://evmrpc-testnet.0g.ai` | `https://evmrpc.0g.ai` |
| Explorer | `https://chainscan-galileo.0g.ai` | — |
| Faucet | `https://faucet.0g.ai` — **0.1 0G / wallet / hari** | — |
| Faucet alt | `https://cloud.google.com/application/web3/faucet/0g/galileo` | — |
| Token native | `0G` | `0G` |

Kontrak sistem Galileo: Flow `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` · Mine `0x00A9E9604b0538e06b268Fb297Df333337f9593b` · Reward `0xA97B57b4BdFEA2D0a25e535bd849ad4e6C440A69` · DAEntrance `0xE75A073dA5bb7b0eC622170Fd268f35E675a957B`

### 3.2 0G Storage

Paket: **`@0gfoundation/0g-storage-ts-sdk`** (peer dep `ethers`). Indexer testnet: `https://indexer-storage-testnet-turbo.0g.ai`.

```ts
const file       = await ZgFile.fromFilePath(path);
const [tree,err] = await file.merkleTree();      // tree.rootHash()
const indexer    = new Indexer(indexerRpc);
const [tx, uerr] = await indexer.upload(file, evmRpc, signer);
const derr       = await indexer.download(rootHash, outPath, /*withProof*/ true);
```

### 3.3 0G Compute

Paket: **`@0gfoundation/0g-compute-ts-sdk`** (v0.8.0+).
⚠️ `@0glabs/0g-serving-broker` sudah **deprecated** — jangan dipakai di kode baru.

```ts
const broker = await createZGComputeNetworkBroker(wallet);
await broker.ledger.depositFund(10);                                   // min 3 0G untuk buat ledger
await broker.ledger.transferFund(provider, 'inference', 1n * 10n**18n); // min 1 0G per provider
const services = await broker.inference.listService();                 // katalog berubah-ubah: JANGAN hardcode
const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
const headers = await broker.inference.getRequestHeaders(provider);    // sekali pakai per request
const res  = await fetch(`${endpoint}/chat/completions`, { method:'POST', headers:{...headers,'Content-Type':'application/json'}, body: JSON.stringify({ messages, model, temperature: 0 }) });
const chatID   = res.headers.get('ZG-Res-Key') ?? (await res.json()).id;
const verified = await broker.inference.processResponse(provider, chatID);  // ← atestasi TEE
```

Rate limit default: **30 rpm sustained, burst 5, 5 concurrent** per user. HTTP 429 = kena limit. Fee menyelesaikan diri secara batch, bukan per-request.

**Jalur alternatif — Compute Router:** OpenAI-compatible, testnet `https://router-api-testnet.integratenetwork.work/v1`, mainnet `https://router-api.0g.ai/v1`, satu API key + satu saldo on-chain, failover provider otomatis. **Tidak mengekspos atestasi TEE** ⇒ hanya boleh dipakai untuk tier `FAST` dan penalaran trader agent, **tidak pernah** untuk tier `VERIFIED`.

### 3.4 Konsekuensi arsitektural dari fakta di atas

| Fakta | Konsekuensi |
|---|---|
| Katalog provider berubah-ubah | Penemuan provider **saat runtime** + cache TTL + daftar preferensi, bukan alamat hardcode |
| 30 rpm / 5 concurrent | Antrian + rate limiter di agent runtime; job settlement komite dijadwalkan, tidak burst |
| Router tanpa TEE | Dua klien inferensi terpisah di balik satu interface `IInferenceClient` |
| Tidak ada subgraph di 0G | Indexer sendiri wajib, bukan opsional |
| Faucet 0.1 0G/hari | Skrip `fund-compute.mts` + monitor saldo ledger; alarm sebelum ledger kering |

---

## 4. Matematika DPM

### 4.1 Definisi

Untuk market biner dengan pasokan lembar `q = (q₀, q₁)` (indeks 0 = NO, 1 = YES), semuanya dalam wad:

```
Cost function        C(q)  = √(q₀² + q₁²)
Harga marginal       pᵢ    = ∂C/∂qᵢ = qᵢ / C(q)
Probabilitas implisit Pᵢ   = pᵢ²     = qᵢ² / (q₀² + q₁²)
Biaya beli Δ lembar i       ΔC       = C(q + Δeᵢ) − C(q)
Hasil jual Δ lembar i       ΔC       = C(q) − C(q − Δeᵢ)
Payout per lembar menang    C(q) / q_menang  =  1 / p_menang
```

### 4.2 Sifat yang dijadikan invarian

| Sifat | Pernyataan | Kegunaan |
|---|---|---|
| **Solvabilitas** | kas kontrak `= C(q)` di setiap saat | protokol tidak bisa insolven |
| **Normalisasi** | `Σ pᵢ² = 1` | `pᵢ²` adalah distribusi probabilitas sah |
| **Euler (homogen derajat 1)** | `Σ pᵢ·qᵢ = C(q)` | likuidasi membayar `pᵢ` per lembar dan **persis** menghabiskan pool |
| **Path independence** | biaya hanya bergantung pada `q` awal & akhir | tidak bisa diarbitrase lewat pemecahan order |
| **Batas rugi penyedia** | rugi ≤ `1 − 1/√2 ≈ 29.29%` dari setoran | creator/LP punya batas risiko yang bisa dinyatakan |
| **Netralitas LP** | tambah `λ` proporsional ⇒ `Pᵢ` tidak berubah | primitif likuiditas tanpa menggeser harga |

**Bukti batas 29.29%.** Penyedia menyetor `L = C(q₀,q₀) = q₀√2` dan menerima `q₀` lembar tiap sisi. Saat settle, ia menerima `q₀ · C(q_final)/q_win`. Karena `C(q) ≥ q_win` untuk semua `q`, penerimaan `≥ q₀`. Rasio terburuk `q₀ / (q₀√2) = 1/√2`. ∎

**Bukti netralitas LP.** `C` homogen derajat 1 ⇒ `q → (1+λ)q` memberi `C → (1+λ)C` dan `Pᵢ = qᵢ²/Σqⱼ²` tak berubah. Biaya `= λ·C(q)`, lembar diterima `= λ·qᵢ` per outcome. ∎
Menambah **jumlah absolut yang sama** ke kedua sisi hanya netral saat `q₀ = q₁`; karena itu yang dipakai adalah penambahan **proporsional**.

### 4.3 Contoh angka (seed 1000/1000, mUSDC)

| Aksi | q₀ / q₁ | Pool | P(YES) | Catatan |
|---|---|---|---|---|
| Creator seed | 1000 / 1000 | 1414.21 | 50.0% | bayar `L` = 1414.21, pegang 1000+1000 (terkunci) |
| Agent beli 200 YES | 1000 / 1200 | 1562.05 | **59.0%** | bayar 147.84 → 0.7392/lembar |
| Settle YES | — | 1562.05 | — | 1.3017/lembar → agent 260.35 (**1.76×**), creator 1301.71 (−7.95%) |
| (alternatif) Failed | — | 1562.05 | — | likuidasi: NO 0.6402/lembar, YES 0.7682/lembar → total 1562.05 ✓ |

Tabel di atas bertolak dari `q`; API bertolak dari collateral. Konversinya: setoran `L` menghasilkan
`q₀ = q₁ = L/√2`. Jadi `L = 1000 mUSDC` ⇒ `q = (707.11, 707.11)` dan pool = 1000 — inilah angka yang
dipakai skenario e2e §14.3, bukan baris pertama tabel ini.

### 4.4 Implementasi & pembulatan

`q` dalam wad ⇒ `qᵢ²` berskala 1e36 ⇒ **`sqrt` integer atas `q₀² + q₁²` langsung menghasilkan wad** tanpa rescale. Batas overflow: `qᵢ ≤ 1e33 wad` (di-`require`), karena `2·(1e33)² = 2e66 < 2²⁵⁶`.

Kebijakan pembulatan — **selalu berpihak pada pool**:

```solidity
// pool tidak "diakumulasi", tapi disetel ke target. Debu pembulatan selalu masuk ke pool.
uint256 target = DPMMath.costUp(qNew);   // sqrt dibulatkan ke ATAS
cost      = target - poolBalance;         // buy   (≥ biaya matematis)
proceeds  = poolBalance - target;         // sell  (≤ hasil matematis)
poolBalance = target;                     // invarian poolBalance == costUp(q) berlaku by construction
```

Di batas token (6 desimal): masuk dibulatkan **ke atas**, keluar dibulatkan **ke bawah**.

Karena pembulatan ke atas, `buy` yang sangat kecil bisa menghasilkan `cost == 0`. Karena itu setiap
`buy`/`sell` menuntut `tokens >= minTradeTokens` (§17) dan `require(cost > 0)` — perdagangan debu
ditolak, bukan dilayani gratis.

### 4.5 Trade-off yang diakui terbuka

**Dilusi payout.** Payout per lembar menang `= C(q)/q_win` **mengambang sampai market tutup**: pembeli YES yang datang belakangan menaikkan `q_YES` lebih cepat daripada `C(q)`, sehingga menurunkan payout holder YES lama. LMSR mengunci payout 1.0 saat beli; DPM tidak. Ini konsekuensi tak terhindarkan dari "pool mendanai pembayarannya sendiri".

Mitigasi: `sell` tersedia kontinu sehingga holder bisa keluar mengunci harga, dan UI **wajib** menampilkan payout berjalan (bukan payout terkunci) beserta peringatannya. Keputusan ini sadar dan sama dengan yang diambil Delphi.

---

## 5. Model Domain & Siklus Hidup

### 5.1 Status market

```
                       ┌──────── void() [guardian, pra-tutup] ────────┐
                       │                                              ▼
Draft ──approve──▶  Open ──tradingEnd──▶ Closed ──≥k reveal sepakat──▶ Proposed ──finalize──▶ Settled
(off-chain)            │                    │                             │                    (redeem)
                       │                    │                        dispute(bond)
                       │              settlementDeadline                  ▼
                       │                    │                        Disputed ──ronde-2 sepakat──▶ Settled
                       ▼                    ▼                             │
                    Voided              Failed ◀──── ronde-2 gagal ───────┘
                  (liquidate)         (liquidate)
```

| Status | Beli | Jual | Redeem | Liquidate |
|---|---|---|---|---|
| `Open` | ✓ | ✓ | — | — |
| `Closed` / `Proposed` / `Disputed` | — | — | — | — |
| `Settled` | — | — | ✓ (sisi menang) | — |
| `Failed` / `Voided` | — | — | — | ✓ (semua sisi, `pᵢ`/lembar) |

`Closed` mengunci perdagangan agar `q` — dan karenanya payout — tidak bisa digeser saat komite sedang menilai.

### 5.2 MarketSpec (JSON, disimpan di 0G Storage, `specRoot` di on-chain)

```jsonc
{
  "version": 1,
  "question": "Apakah harga penutupan ETH/USD pada 2026-09-30 23:59 UTC berada di atas $4000?",
  "rules": "Diselesaikan YES bila ... Diselesaikan NO bila ... Dianggap UNRESOLVABLE bila ...",
  "category": "crypto",              // crypto|politics|sports|economics|science|culture
  "sources": [ { "kind": "http", "url": "...", "selector": "..." } ],
  "settlementPrompt": "<prompt milik creator, disisipkan ke template kategori>",
  "tier": "VERIFIED",                // FAST | VERIFIED | DETERMINISTIC
  "tradingEnd": 1790000000,
  "settlementDeadline": 1790086400,
  "creatorAgentId": 42,
  "curatorApproval": { "agentId": 7, "signature": "0x..." }
}
```

`specRoot = keccak256` dari root Merkle 0G Storage untuk dokumen ini. Isi spec **immutable** setelah market dibuat — resolver menilai persis apa yang dijanjikan ke trader.

---

## 6. Arsitektur Kontrak

### 6.1 Peta modul

| Kontrak | Tanggung jawab | Pola | Upgradeable |
|---|---|---|---|
| `DPMMath` | cost/price/probability, semua wad, pure | library | — |
| `Market` | `q`, `poolBalance`, buy/sell/likuiditas/exit, siklus hidup | clone EIP-1167 | **Tidak** (memegang dana) |
| `OutcomeShares` | ERC-1155 posisi tradable, `id = uint160(market)<<8 \| outcome` — market hanya bisa menyentuh id miliknya sendiri | singleton | Tidak |
| `MarketFactory` | clone + registry + versi implementasi + parameter default | — | UUPS + timelock |
| `ResolutionModule` | komite, commit–reveal, threshold, dispute, slashing | — | UUPS + timelock |
| `AgentRegistry` | identitas agent (jalur ERC-7857), operator key, stake, reputasi | ERC-721 → 7857 | UUPS + timelock |
| `AgentAccountFactory` / `AgentAccount` | kustodi dana user + enforcement policy | clone per user | Tidak |
| `Treasury` | fee protokol, insurance fund, sweep dana tak diklaim | — | UUPS + timelock |
| `ConfigRegistry` | alamat, parameter, guardian, pause | — | UUPS + timelock |
| `MockUSDC` | collateral uji 6 desimal + faucet | testnet saja | — |
| `PythAdapter` / `MockPyth` | sumber resolusi `DETERMINISTIC` | — | — |

**Prinsip pemisahan:** kontrak yang **memegang dana pengguna tidak pernah upgradeable**. Yang upgradeable hanyalah logika koordinasi (factory, resolusi, registry), selalu di balik timelock 48 jam.

### 6.2 `DPMMath`

```solidity
library DPMMath {
    uint256 internal constant WAD   = 1e18;
    uint256 internal constant MAX_Q = 1e33;               // 2*(1e33)^2 = 2e66 < 2^256

    error QOverflow();
    error QUnderflow();

    /// @notice C(q) = sqrt(q0^2 + q1^2). q wad → hasil wad. Dibulatkan KE BAWAH.
    function cost(uint256[2] memory q) internal pure returns (uint256);

    /// @notice cost() dibulatkan KE ATAS (+1 wei bila tidak eksak). Dipakai untuk semua state pool.
    function costUp(uint256[2] memory q) internal pure returns (uint256);

    /// @notice p_i = q_i * WAD / C(q). Berlaku sum(p_i^2) == WAD^2 / WAD.
    function price(uint256[2] memory q, uint8 i) internal pure returns (uint256);

    /// @notice P_i = p_i^2 = q_i^2 * WAD / (q0^2 + q1^2). Probabilitas yang ditampilkan UI.
    function probability(uint256[2] memory q, uint8 i) internal pure returns (uint256);

    /// @notice Invers: berapa lembar yang didapat untuk `spend` collateral (wad). Newton, dibulatkan KE BAWAH.
    function sharesForSpend(uint256[2] memory q, uint8 i, uint256 spend) internal pure returns (uint256);
}
```

`sharesForSpend` punya bentuk tertutup untuk biner dan tidak perlu iterasi:
diberi `C₁ = C(q) + spend`, dengan `spend` adalah bagian yang masuk ke pool (**sudah bersih dari fee**), cari `x` sehingga `√((qᵢ+x)² + q_j²) = C₁` ⇒ **`x = √(C₁² − q_j²) − qᵢ`**. Eksak, satu `sqrt`, tanpa Newton. (Newton hanya diperlukan bila kelak diperluas ke >2 outcome.)

### 6.3 `Market`

```solidity
interface IMarket {
    enum Status { Open, Closed, Proposed, Disputed, Settled, Failed, Voided }

    struct Params {
        address collateral;          // ERC-20 (mUSDC 6 desimal di testnet)
        uint8   collateralDecimals;
        address creator;
        uint256 creatorAgentId;
        uint64  tradingEnd;
        uint64  settlementDeadline;
        uint16  feeBps;              // atas notional
        uint8   tier;                // 0=FAST 1=VERIFIED 2=DETERMINISTIC
        bytes32 specRoot;            // 0G Storage
        bytes32 category;
    }

    // ── kuotasi (view, tanpa efek samping) ──────────────────────────────────
    function quoteBuy(uint8 outcome, uint256 sharesOut)  external view returns (uint256 tokensIn,  uint256 fee);
    function quoteBuySpend(uint8 outcome, uint256 tokensIn) external view returns (uint256 sharesOut, uint256 fee);
    function quoteSell(uint8 outcome, uint256 sharesIn)  external view returns (uint256 tokensOut, uint256 fee);

    // ── perdagangan ─────────────────────────────────────────────────────────
    function buy (uint8 outcome, uint256 sharesOut, uint256 maxTokensIn, address to) external returns (uint256 tokensIn);
    function sell(uint8 outcome, uint256 sharesIn,  uint256 minTokensOut, address to) external returns (uint256 tokensOut);

    // ── likuiditas proporsional (netral terhadap probabilitas) ──────────────
    function addLiquidity(uint256 tokensIn, uint256 minSharesOut, address to)
        external returns (uint256[2] memory seedSharesMinted);
    /// @param lambdaWad fraksi wad dari q saat ini yang ditarik; penarikan[i] = q[i]*lambdaWad/WAD.
    ///        Proporsional ⇒ netral terhadap probabilitas. Penarikan tak-proporsional dilarang
    ///        karena setara perdagangan berarah tanpa fee.
    function removeLiquidity(uint256 lambdaWad, uint256 minTokensOut, address to)
        external returns (uint256 tokensOut);   // hanya bila Status == Open

    // ── siklus hidup ────────────────────────────────────────────────────────
    function close() external;                                   // siapa pun, setelah tradingEnd
    function settle(uint8 outcome) external;                     // hanya ResolutionModule
    function fail() external;                                    // ResolutionModule atau setelah settlementDeadline
    function void(bytes32 reason) external;                      // hanya Guardian, hanya pra-Closed

    // ── keluar ──────────────────────────────────────────────────────────────
    function redeem(address to)    external returns (uint256 tokensOut);  // Settled: lembar menang → C(q)/q_win
    function liquidate(address to) external returns (uint256 tokensOut);  // Failed/Voided: semua lembar → p_i
    function sweepUnclaimed() external;                                   // → Treasury, setelah sweepUnclaimedAfter

    // ── view ────────────────────────────────────────────────────────────────
    function q() external view returns (uint256[2] memory);
    function poolBalance() external view returns (uint256);        // wad, selalu == DPMMath.costUp(q)
    function probability(uint8 outcome) external view returns (uint256);
    function payoutPerShare(uint8 outcome) external view returns (uint256);
    function status() external view returns (Status);
    function seedSharesOf(address account) external view returns (uint256[2] memory);
}
```

**Pemisahan lembar seed vs lembar tradable.** `qᵢ = tradableSupplyᵢ (ERC-1155) + seedSupplyᵢ`.
Lembar seed (dari `createMarket` dan `addLiquidity`) **tidak** dicetak sebagai ERC-1155, melainkan dicatat di `seedShares[account][outcome]` di dalam `Market`. Lembar seed tidak pernah bisa ditransfer dan tidak pernah bisa dijual lewat `sell()`.

Penarikannya dibedakan menjadi dua kelas, dan pembedaan ini **wajib** — tanpanya jaminan `qᵢ > 0` batal:

| Kelas | Sumber | Bisa ditarik? |
|---|---|---|
| **Seed creator** (`creatorSeedᵢ`, ditetapkan saat `createMarket`) | `createMarket` | **Tidak pernah.** Hanya `redeem`/`liquidate` setelah market selesai. |
| **Seed LP** (`seedSupplyᵢ − creatorSeedᵢ`) | `addLiquidity` | Ya, lewat `removeLiquidity`, tetapi **hanya saat `Open`** dan tidak pernah menembus lantai `creatorSeedᵢ`. |

`removeLiquidity` karena itu memuat `require(seedSupplyᵢ - shares[i] >= creatorSeedᵢ)` untuk kedua outcome.

**Alasan (temuan desain):** tanpa lantai ini, `q_YES` bisa mencapai 0 sementara YES menang, membuat `C(q)/q_win` membagi nol dan meninggalkan pool tanpa pemilik sah. Dengan lantai `creatorSeedᵢ`, berlaku `qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0` selamanya, sekaligus mencegah probabilitas didorong ke ekstrem degenerate dengan modal kecil. Ini pula yang membuat batas rugi 29.29% bermakna: creator memang menanggung posisinya sampai akhir.

**Akuntansi fee.** `feeAccrued` adalah variabel terpisah dari `poolBalance` dan **tidak pernah** ikut dalam `C(q)`.
`buy`: pengguna membayar `ΔC + fee`. `sell`: pengguna menerima `ΔC − fee`. Distribusi saat `Settled`/`Failed`:
`creatorFeeShareBps` → creator, `resolverFeeShareBps` → kas hadiah resolver, sisanya → `Treasury`.

**Guardian & pause.** `ConfigRegistry.paused()` memblokir `createMarket`, `buy`, dan `addLiquidity`.
**Tidak pernah** memblokir `sell`, `redeem`, `liquidate`, atau `AgentAccount.withdraw` — pengguna selalu bisa keluar. Ini dijadikan uji eksplisit, bukan sekadar konvensi.

**Event (kontrak dengan indexer):**

```solidity
event MarketCreated(address indexed market, uint256 indexed creatorAgentId, bytes32 specRoot, uint256 seed, uint8 tier);
event Trade(address indexed market, address indexed trader, uint256 indexed agentId, uint8 outcome,
            int256 sharesDelta, uint256 tokens, uint256 fee, uint256[2] qAfter, uint256 probAfter);
event LiquidityChanged(address indexed market, address indexed provider, int256 lambdaWad, uint256[2] qAfter);
event StatusChanged(address indexed market, Status from, Status to);
event Settled(address indexed market, uint8 outcome, bytes32 receiptRoot, uint256 payoutPerShare);
event Redeemed(address indexed market, address indexed account, uint256 shares, uint256 tokensOut);
event Liquidated(address indexed market, address indexed account, uint256[2] shares, uint256 tokensOut);
```

`Trade` sengaja membawa `qAfter` dan `probAfter` agar indexer bisa merekonstruksi kurva probabilitas tanpa `eth_call` historis.

### 6.4 `MarketFactory`

```solidity
function createMarket(
    IMarket.Params calldata p,
    uint256 seedCollateral,          // ≥ minSeed
    uint256 settlementDeposit,       // ≥ minSettlementDeposit
    bytes   calldata curatorSig      // EIP-712 dari agent ber-peran Curator
) external returns (address market);
```

`seedCollateral = L` ⇒ `q₀ = q₁ = L/√2` lembar seed untuk creator.
`curatorSig` menandatangani `keccak256(specRoot, tradingEnd, settlementDeadline, tier, creatorAgentId, nonce, chainId)`.
Flag `permissionlessCreation` di `ConfigRegistry` memungkinkan jalur tanpa curator kelak (bond lebih besar, window sengketa lebih panjang) — **mati di v1**.

---

## 7. Modul Resolusi

### 7.1 Tiga tier

| Tier | Jalur inferensi | Bukti | Komite | Dispute window | Fee resolver |
|---|---|---|---|---|---|
| `FAST` | Compute **Router** | receipt di 0G Storage, tanpa atestasi | 1 | 24 jam | rendah |
| `VERIFIED` | **broker** `@0gfoundation/0g-compute-ts-sdk` | `processResponse() == true` **wajib** + receipt | 5, k=3 | 6 jam | sedang |
| `DETERMINISTIC` | adapter data/harga (Pyth Hermes) | atestasi EIP-712 worker | 3, k=2 | 2 jam | rendah |

Trust lebih rendah ⇒ window sengketa **lebih panjang**, bukan lebih pendek.

### 7.2 Antarmuka

```solidity
interface IResolutionSource {
    function kind() external view returns (bytes32);           // "TEE_COMMITTEE" | "ROUTER" | "PRICE_FEED"
    function isEligible(address resolver, address market) external view returns (bool);
    function validateReveal(address market, uint8 outcome, bytes32 receiptRoot, bytes calldata proof)
        external view returns (bool);
}

interface IResolutionModule {
    struct Round {
        uint8     n; uint8 k; uint8 index;
        uint64    commitDeadline; uint64 revealDeadline;
        address[] committee;
        uint16    commits; uint16 reveals;
        uint16[3] tally;                 // [NO, YES, UNRESOLVABLE]
        uint8     proposedOutcome;
        uint64    disputeDeadline;
    }

    function openResolution(address market) external;                       // dipanggil Market.close()
    function commitVote(address market, bytes32 commitment) external;       // hanya anggota komite
    function revealVote(address market, uint8 outcome, bytes32 salt, bytes32 receiptRoot) external;
    function finalize(address market) external;                             // setelah disputeDeadline
    function dispute(address market, bytes32 evidenceRoot) external;        // butuh disputeBond
    function markFailed(address market) external;                           // setelah settlementDeadline

    function roundOf(address market) external view returns (Round memory);
    function receiptRootOf(address market, address resolver) external view returns (bytes32);
}
```

`commitment = keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))` — mengikat resolver sehingga commitment tidak bisa disalin.

### 7.3 Alur

```
1. Market.close()                → ResolutionModule.openResolution()
                                   sampling komite deterministik dari resolver aktif ber-stake
                                   commitDeadline = now + commitWindow
2. commitVote()                  → hash saja, tidak ada yang bisa mencontek
3. revealVote()                  → outcome + salt + receiptRoot; validateReveal() dipanggil
4. ≥ k reveal sepakat            → Status=Proposed, disputeDeadline = now + disputeWindow(tier)
   (bila outcome yang mencapai threshold adalah UNRESOLVABLE, finalize() memanggil Market.fail(),
    bukan Market.settle() — jalur keluarnya likuidasi)
5a. tanpa sengketa → finalize()  → Market.settle(outcome)
                                   resolver sepakat: bagi kas hadiah
                                   resolver beda   : slash disagreeSlashBps
                                   tidak reveal    : slash noShowSlashBps
5b. dispute(bond)                → Status=Disputed, ronde-2 (n=9,k=5), eksklusi peserta ronde-1
      ronde-2 ≠ ronde-1          → ronde-1 yang sepakat di-slash overturnSlashBps
                                   challenger: bond kembali + 50% hasil slash
      ronde-2 = ronde-1          → bond challenger → kas hadiah resolver
      ronde-2 tanpa threshold    → Market.fail()
6. settlementDeadline lewat      → markFailed() → Market.fail() → likuidasi
```

**Sampling komite.** `seed = keccak256(market, blockhash(closeBlock), roundIndex)`, lalu pemilihan tanpa pengembalian berbobot stake dari daftar resolver aktif.
⚠️ *Keterbatasan diketahui:* `blockhash` dapat dipengaruhi validator. Diterima untuk v1, jalur upgrade ke beacon acak/VRF dicatat di §13.2 dan dijadwalkan di P7.

### 7.4 Job settlement (off-chain, per resolver)

```
1.  Unduh MarketSpec dari 0G Storage lewat specRoot; verifikasi Merkle proof.
2.  Kumpulkan bukti dari spec.sources[]; simpan snapshot mentah tiap sumber ke 0G Storage → evidenceRoots[].
3.  Susun prompt = template kategori (Sports|Politics|Crypto|Economics|Science|Culture)
                 + spec.rules + spec.settlementPrompt + bukti (dengan stempel waktu & URL).
4.  TIER VERIFIED:
      getServiceMetadata(provider) → getRequestHeaders(provider)
      POST {endpoint}/chat/completions  { messages, model, temperature: 0 }
      chatID = header ZG-Res-Key
      verified = await broker.inference.processResponse(provider, chatID)
      if (!verified) → JANGAN commit; coba provider lain; setelah semua gagal → commit UNRESOLVABLE
    TIER FAST: Compute Router, verified = false (dicatat apa adanya di receipt).
5.  Parse keluaran terstruktur: { outcome: "YES"|"NO"|"UNRESOLVABLE", confidence, rationale, citations[] }
6.  Susun receipt (§7.5), unggah ke 0G Storage → receiptRoot.
7.  commitVote(); pada revealWindow → revealVote().
```

### 7.5 Receipt settlement (JSON, 0G Storage)

```jsonc
{
  "version": 1,
  "market": "0x...", "specRoot": "0x...", "round": 1,
  "resolver": { "agentId": 12, "address": "0x..." },
  "inference": {
    "route": "broker",                      // broker | router | price_feed
    "providerAddress": "0x...",
    "model": "...",
    "chatID": "...",
    "teeVerified": true,                    // hasil processResponse()
    "promptHash": "0x...", "responseHash": "0x...",
    "temperature": 0,
    "simulated": false                      // true saat INFERENCE_MODE=stub — jangan tertukar dengan hasil sungguhan
  },
  "evidence": [ { "url": "...", "fetchedAt": 1790000123, "root": "0x...", "sha256": "..." } ],
  "outcome": "YES", "confidence": 0.93,
  "rationale": "...", "citations": [ 0, 2 ],
  "rawResponse": "...",
  "signature": "0x..."                      // EIP-191 oleh operator key resolver
}
```

**Batas kejujuran atas klaim verifiabilitas.** Menjalankan ulang prompt yang sama pada LLM **tidak** dijamin identik bit-per-bit meski `temperature: 0`. Yang dijamin atestasi TeeML adalah: *provider tersebut menjalankan model tersebut atas input tersebut, di dalam enclave*. Menjalankan ulang adalah **korroborasi**, bukan bukti. Dokumen produk, UI, dan materi pemasaran tidak boleh menyatakan lebih dari ini.

### 7.6 Anti-abuse pembuatan market

Curator Agent menjalankan, berurutan, sebelum menandatangani approval:

1. **Blocklist kata kunci** — target individu privat, konten seksual/kekerasan terhadap orang nyata, market "kematian".
2. **Pemeriksaan semantik LLM** — apakah pertanyaan menyamarkan sesuatu di daftar (1)?
3. **Skor ambiguitas** — apakah aturan menutup semua kasus tepi? Ambang minimum, ditolak bila di bawah.
4. **Cek keterselesaian** — dapatkah sumber yang terdaftar menjawabnya sebelum `settlementDeadline`?
5. **Deduplikasi** — kemiripan embedding terhadap market `Open` (cosine < ambang).

Gagal salah satu ⇒ tidak ditandatangani, dengan alasan dikembalikan ke Creator Agent untuk revisi (maks 2 putaran).
`settlementDeposit` di-slash bila market kemudian di-`void` karena abuse — inilah yang membuat spam mahal.

---

## 8. Lapisan Agent

### 8.1 Peran

| Peran | Trigger | Aksi utama | Stake |
|---|---|---|---|
| **Creator** | terjadwal / sinyal | rancang MarketSpec → minta approval → `createMarket` + danai seed | ya (anti-spam) |
| **Curator** | permintaan approval | pipeline §7.6 → tanda tangan EIP-712 | ya |
| **Resolver** | `openResolution` menunjuknya | job §7.4 → commit → reveal | **ya, wajib** |
| **Trader** | terjadwal / harga bergerak | evaluasi market → sizing → `AgentAccount.execute` | tidak |

### 8.2 Kontrak runtime

```ts
interface Agent {
  readonly agentId: bigint;                    // tokenId di AgentRegistry
  readonly role: 'creator' | 'curator' | 'resolver' | 'trader';
  tick(ctx: AgentContext): Promise<AgentAction[]>;
}

interface AgentContext {
  chain:     ChainClient;        // viem, dibungkus ConfigRegistry
  indexer:   IndexerClient;      // REST + WS
  inference: IInferenceClient;   // stub | router | broker(TEE)
  storage:   IStorageClient;     // memory | file | 0G Storage
  clock:     Clock;              // disuntik → uji deterministik
  logger:    DecisionLogger;     // menandatangani & membatch ke 0G Storage
}
```

`tick()` **murni terhadap I/O yang disuntik** — semua ketergantungan eksternal lewat `ctx`. Konsekuensinya seluruh agent bisa diuji dengan klien palsu, tanpa jaringan.

### 8.3 Persona trader (v1)

| Persona | Sinyal | Sizing |
|---|---|---|
| `KellyValueBettor` | inferensi `fairProbability` vs `P = pᵢ²` | Kelly pecahan (¼), dibatasi policy |
| `Contrarian` | pergerakan probabilitas ekstrem tanpa berita pendukung | tetap, naik saat divergensi melebar |
| `MomentumFollower` | tren probabilitas + volume | proporsional terhadap kekuatan tren |
| `NewsArbitrageur` | berita baru vs waktu update terakhir market | agresif dalam jendela pendek pasca-berita |

Loop tiap tick: `listMarkets(open)` → saring kategori yang diizinkan → inferensi → bandingkan → `quoteBuySpend` → cek slippage vs `maxSlippageBps` → `execute`.

### 8.4 `AgentAccount` — batas risiko di kontrak

```solidity
struct Policy {
    uint128 maxNotionalPerTrade;    // satuan collateral
    uint128 maxTotalExposure;       // jumlah notional terbuka
    uint128 dailySpendCap;          // rolling 24 jam
    uint16  maxConcurrentMarkets;
    uint16  maxSlippageBps;
    uint64  expiry;
    bytes32 allowedCategories;      // bitmask
}

interface IAgentAccount {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount, address to) external;          // hanya owner — SELALU tersedia
    function grant(uint256 agentId, Policy calldata p) external;     // hanya owner
    function revoke(uint256 agentId) external;                       // hanya owner — efek seketika
    function execute(Action calldata a) external;                    // hanya operator agent, dicek policy
    function redeemAll(address[] calldata markets) external;         // siapa pun (menguntungkan owner)
    function policyOf(uint256 agentId) external view returns (Policy memory);
    function exposure() external view returns (uint256);
}
```

**Sifat yang dijamin:**

- Agent **tidak pernah** memegang kunci dompet pengguna; ia hanya bisa memanggil `execute` pada akun itu.
- Setiap pengguna punya clone `AgentAccount` sendiri ⇒ **tidak ada kontaminasi silang** antar pengguna.
- `withdraw` dan `revoke` tidak pernah bisa diblokir oleh agent, guardian, maupun pause global.
- Pelanggaran policy → revert, bukan dicatat lalu diteruskan.

### 8.5 Identitas agent — jalur ERC-7857

```solidity
interface IAgentRegistry /* is IERC721 */ {
    enum Role { Creator, Curator, Resolver, Trader }
    struct Reputation {
        uint32 marketsCreated; uint32 marketsVoided;
        uint32 resolutionsAgreed; uint32 resolutionsOverturned;
        int128 realizedPnl;      uint32 tradesExecuted;
    }
    function register(Role role, address operator, bytes32 metadataRoot) external returns (uint256 agentId);
    function setOperator(uint256 agentId, address operator) external;
    function updateMetadata(uint256 agentId, bytes32 newRoot, bytes calldata proof) external;  // hook 7857
    function stake(uint256 agentId, uint256 amount) external;
    function requestUnstake(uint256 agentId, uint256 amount) external;   // cooldown 7 hari
    function slash(uint256 agentId, uint256 amount, bytes32 reason) external; // hanya ResolutionModule
    function reputationOf(uint256 agentId) external view returns (Reputation memory);
}
```

`metadataRoot` menunjuk ke blob 0G Storage berisi persona, prompt, dan konfigurasi model.
**v1 (P4):** ERC-721 + `metadataRoot` polos, `updateMetadata` menerima `proof` kosong.
**P7:** metadata terenkripsi + transfer ter-reenkripsi sesuai ERC-7857 penuh; `updateMetadata` mulai memverifikasi proof. Antarmuka sengaja sudah berbentuk final agar migrasi bukan penulisan ulang.

### 8.6 Log keputusan agent

Setiap `AgentAction` menghasilkan record bertanda tangan `{ agentId, tick, inputs, inference{provider,model,chatID,teeVerified}, reasoning, action, txHash }`.
Record dibatch (NDJSON) per jam, diunggah ke 0G Storage, dan root-nya di-anchor lewat `AgentRegistry.anchorDecisionLog(agentId, root, fromTick, toTick)`.
Konsekuensi produk: setiap trade dan setiap settlement di UI dapat ditelusuri sampai ke alasannya.
---

## 9. Indexer & API

0G tidak punya layanan subgraph terkelola (Delphi memakai Goldsky). Indexer sendiri karena itu **komponen wajib**, bukan optimasi.

### 9.1 Desain

- **Tailer**: `eth_getLogs` per rentang blok dari `deploymentBlock`, checkpoint per blok, `CONFIRMATIONS=8`.
- **Reorg**: simpan `blockHash` per blok terproses; bila induk tak cocok → rollback ke titik cabang, putar ulang. Semua tabel turunan bersifat `ON DELETE CASCADE` terhadap `blocks`.
- **Penyimpanan**: PostgreSQL (produksi), SQLite (lokal/CI) lewat satu lapisan query.
- **Penyajian**: REST + WebSocket.

### 9.2 Skema

```sql
blocks(number PK, hash, parent_hash, timestamp)
agents(agent_id PK, owner, operator, role, metadata_root, stake, active, registered_at)
markets(address PK, creator_agent_id, spec_root, category, tier, status,
        trading_end, settlement_deadline, fee_bps,
        q0 NUMERIC(78,0), q1 NUMERIC(78,0), pool_balance NUMERIC(78,0),
        prob_yes NUMERIC(38,18), volume NUMERIC(78,0), trade_count,
        created_block REFERENCES blocks(number) ON DELETE CASCADE)
trades(id PK, market, trader, agent_id, outcome, shares_delta, tokens, fee,
       q0_after, q1_after, prob_after, block REFERENCES blocks(number) ON DELETE CASCADE, log_index,
       UNIQUE(block, log_index))
liquidity_events(id PK, market, provider, lambda_wad, q0_after, q1_after, block, log_index)
positions(market, account, outcome, shares, seed_shares, avg_cost, realized_pnl, PRIMARY KEY(market,account,outcome))
price_points(market, bucket_start, interval, open, high, low, close, volume, PRIMARY KEY(market,interval,bucket_start))
resolutions(market PK, round, phase, proposed_outcome, final_outcome,
            commit_deadline, reveal_deadline, dispute_deadline, disputer, dispute_bond)
resolution_votes(market, resolver, round, commitment, revealed_outcome, receipt_root, slashed_amount,
                 PRIMARY KEY(market,resolver,round))
agent_actions(id PK, agent_id, tick, kind, market, payload JSONB, tx_hash, decision_log_root, ts)
```

`prob_yes` diturunkan dari `q1²/(q0²+q1²)` saat ingest, bukan dihitung ulang saat query.

### 9.3 REST

```
GET  /health                              → { status, headBlock, chainId, lagSeconds }
GET  /markets?status&category&tier&orderBy&skip&limit
GET  /markets/:address                    → market + q + prob + payoutPerShare + spec (dari 0G Storage, cache)
GET  /markets/:address/trades?skip&limit
GET  /markets/:address/candles?interval=1m|5m|1h|1d&from&to
GET  /markets/:address/resolution         → ronde, vote, receiptRoot, teeVerified per resolver
GET  /positions?wallet=&redeemedOrLiquidated=
GET  /agents?role&orderBy=pnl|accuracy    → leaderboard
GET  /agents/:agentId                     → profil + reputasi + log keputusan terbaru
GET  /agents/:agentId/actions?skip&limit
```

### 9.4 WebSocket

```
subscribe { channel: "market", address }     → trade, statusChanged, probability
subscribe { channel: "markets" }             → marketCreated, statusChanged
subscribe { channel: "agent", agentId }      → action, trade
```

---

## 10. SDK — `@0g-delphi/agent-kit`

Ergonomi sengaja mengikuti Delphi SDK agar pengguna Delphi langsung paham, **plus** yang tidak mereka punya.

```ts
const client = new DelphiZeroClient({
  network: 'anvil' | 'galileo' | 'mainnet',
  signerType: 'private_key' | 'session',
  privateKey?: string,
  indexerUrl?: string,
});

// baca (indexer)
client.health(); client.listMarkets(params); client.getMarket({ address });
client.listPositions({ wallet }); client.getMarketStatus(address);
client.getCandles({ address, interval });

// kuotasi (on-chain view)
client.quoteBuy({ address, outcomeIdx, sharesOut });
client.quoteBuySpend({ address, outcomeIdx, tokensIn });   // ← agent berpikir dalam nominal
client.quoteSell({ address, outcomeIdx, sharesIn });

// tulis (on-chain)
client.buyShares({ address, outcomeIdx, sharesOut, maxTokensIn });
client.sellShares({ address, outcomeIdx, sharesIn, minTokensOut });
client.addLiquidity({ address, tokensIn, minSharesOut });
client.redeem({ address }); client.liquidate({ address });
client.ensureTokenApproval({ address, minimumAmount });

// yang tidak ada di Delphi
client.proposeMarket({ question, rules, sources, settlementPrompt, category, tradingEnd, tier, seed });
client.getResolution({ address });          // receipt + status TEE per resolver

// primitif agent
new AgentRunner({ agents, schedule, ctx }).start();
```

Semua nilai token di API SDK memakai `bigint` satuan terkecil; helper `parseUsd/formatUsd` disediakan agar desimal tidak pernah ditebak.

---

## 11. Frontend

Next.js 15 (App Router), viem + wagmi, data dari indexer.

| Rute | Isi |
|---|---|
| `/` | daftar market: probabilitas, volume, kedalaman, tier, waktu tutup; filter kategori/status/tier |
| `/market/[address]` | grafik probabilitas, tiket order (beli/jual + slippage), tape trade, **panel payout berjalan + peringatan dilusi**, penampil MarketSpec, penampil receipt settlement |
| `/portfolio` | posisi, PnL, tombol redeem/liquidate, riwayat |
| `/agents` | leaderboard (PnL, akurasi resolusi, market dibuat) |
| `/agents/[id]` | profil, kebijakan, **log keputusan** dengan alasan per trade |
| `/agents/new` | wizard: pilih persona → setel Policy → deploy `AgentAccount` → setor → `grant` |
| `/create` | jalur manusia mengusulkan market (tetap lewat Creator+Curator Agent) |

Dua elemen UI yang bersifat wajib, bukan hiasan:

1. **Badge TEE** pada setiap settlement — `teeVerified` true/false, alamat provider, model, chatID, tautan ke receipt di 0G Storage.
2. **Panel "Kenapa"** pada setiap trade agent — alasan, inferensi yang mendasarinya, dan tautan ke root log keputusan.

---

## 12. Konfigurasi, Mode, Deployment

### 12.1 Tiga saklar mode

| Env | Nilai | Efek |
|---|---|---|
| `CHAIN_MODE` | `anvil` \| `galileo` \| `mainnet` | RPC, chainId, manifest deployment |
| `STORAGE_MODE` | `memory` \| `file` \| `real` | in-proc \| `ZG_BLOB_DIR` \| 0G Storage |
| `INFERENCE_MODE` | `stub` \| `router` \| `compute` | fixture deterministik \| Compute Router \| broker + TEE |

`INFERENCE_MODE=stub` memakai fixture yang di-key berdasarkan `keccak256(promptHash)` → keluaran tetap ⇒ e2e reproducible di CI, tanpa jaringan dan tanpa biaya. Tier `VERIFIED` di mode `stub` menyetel `teeVerified: true` **dan menandai receipt sebagai `simulated: true`** agar tidak pernah tertukar dengan hasil sungguhan.

### 12.2 Env

```bash
CHAIN_MODE=galileo
ZERO_G_TESTNET_RPC=https://evmrpc-testnet.0g.ai
ZERO_G_MAINNET_RPC=https://evmrpc.0g.ai
LOCAL_RPC=http://127.0.0.1:8545

STORAGE_MODE=real
ZG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZG_BLOB_DIR=/tmp/0g-delphi-blobs

INFERENCE_MODE=compute
ZG_COMPUTE_PREFERRED_PROVIDERS=            # opsional; kosong = pilih otomatis dari listService()
ZG_ROUTER_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
ZG_ROUTER_API_KEY=
ZG_COMPUTE_MIN_LEDGER=3                    # 0G; alarm bila di bawah
ZG_COMPUTE_MIN_PER_PROVIDER=1              # 0G

DEPLOYER_KEY=                              # deploy kontrak
CURATOR_OPERATOR_KEY=
RESOLVER_OPERATOR_KEYS=                    # dipisah koma, satu per resolver agent
TRADER_OPERATOR_KEY=
UPLOADER_KEY=                              # membayar biaya unggah 0G Storage

DATABASE_URL=postgres://...                # sqlite:./indexer.db saat lokal
INDEXER_URL=http://127.0.0.1:7200
CONFIRMATIONS=8
```

### 12.3 Manifest deployment

`deployments/<chainId>.json` — satu sumber kebenaran, dibaca kontrak (`ConfigRegistry`), service, dan frontend:

```jsonc
{ "chainId": 16602, "deployedAt": "...", "deploymentBlock": 0,
  "contracts": { "ConfigRegistry": "0x..", "MarketFactory": "0x..", "MarketImpl": "0x..",
                 "OutcomeShares": "0x..", "ResolutionModule": "0x..", "AgentRegistry": "0x..",
                 "AgentAccountFactory": "0x..", "Treasury": "0x..", "MockUSDC": "0x.." },
  "params": { "feeBps": 100, "minSeed": "100000000", "...": "..." } }
```

### 12.4 Struktur repo

```
0g-delphi/
├─ contracts/                 Foundry
│  ├─ src/{core,resolution,agents,periphery,mocks}/
│  ├─ test/{unit,invariant,integration}/
│  └─ script/{Deploy.s.sol,Seed.s.sol}
├─ packages/
│  ├─ protocol/               tipe bersama, cermin DPM di TS, EIP-712, pengalamatan blob, ABI
│  └─ agent-kit/              SDK + primitif runtime agent
├─ services/
│  ├─ agent-runtime/          creator · curator · resolver · trader
│  ├─ indexer/                tailer + REST + WS
│  └─ oracle-worker/          adapter DETERMINISTIC (Pyth Hermes)
├─ frontend/                  Next.js 15
├─ scripts/                   demo-local.sh · e2e-workflow.mts · deploy-galileo.sh · fund-compute.mts
├─ deployments/<chainId>.json
└─ docs/
```

npm workspaces di akar, mengikuti pola `0g-Umbra`.

---

## 13. Keamanan & Ekonomi

### 13.1 Permukaan kontrak

| Risiko | Penanganan |
|---|---|
| Reentrancy | CEI + `ReentrancyGuard` pada semua fungsi bergerak dana; `safeTransfer` (SafeERC20) |
| Token fee-on-transfer / rebasing | ditolak: `ConfigRegistry` memuat allowlist collateral; saldo diukur delta sebelum/sesudah |
| Presisi & pembulatan | semua keluar dibulatkan ke bawah, masuk ke atas; pool disetel ke `costUp(q)` (§4.4) |
| Overflow `q²` | `require(qᵢ <= MAX_Q)` pada setiap mutasi |
| `q_i = 0` saat settle | lantai seed creator ⇒ `qᵢ ≥ seedSupplyᵢ ≥ creatorSeedᵢ > 0` (§6.3) |
| Front-running / sandwich | `maxTokensIn` / `minTokensOut` wajib; `maxSlippageBps` di policy; commit–reveal order besar → P7 |
| Griefing lewat `close()` | `close()` permissionless tetapi hanya valid setelah `tradingEnd` |
| Dana tak diklaim | `sweepUnclaimed()` ke Treasury setelah 365 hari |
| Pause menyandera pengguna | pause **tidak pernah** menyentuh `sell`/`redeem`/`liquidate`/`withdraw` (diuji) |

### 13.2 Keamanan ekonomi resolusi

| Serangan | Pertahanan |
|---|---|
| Resolver menyalin jawaban resolver lain | commit–reveal, commitment terikat `msg.sender` |
| Resolver malas / mangkir | slash `noShowSlashBps`; reputasi turun; berulang → dicoret dari sampling |
| Kartel resolver | sampling berbobot stake + eksklusi peserta ronde-1 di ronde sengketa + `overturnSlashBps` berat |
| Manipulasi sampling oleh validator | ⚠️ **terbuka di v1** (`blockhash`); mitigasi: window commit panjang membuat prediksi mahal; jalur upgrade ke VRF di P7 |
| Sengketa spam | `disputeBond` hangus bila ronde-2 menegaskan ronde-1 |
| Creator menulis prompt yang menyesatkan | pipeline curator §7.6; `settlementDeposit` di-slash saat void |
| Biaya inferensi mengeringkan ledger | `settlementDeposit` mendanai hadiah resolver; `ZG_COMPUTE_MIN_LEDGER` mengalarm sebelum kering |

### 13.3 Upgrade & tata kelola

- Kontrak pemegang dana (`Market`, `OutcomeShares`, `AgentAccount`) **immutable**.
- Koordinasi (`MarketFactory`, `ResolutionModule`, `AgentRegistry`, `Treasury`, `ConfigRegistry`) UUPS, admin = multisig 3/5, **semua upgrade lewat timelock 48 jam**.
- Perubahan parameter (fee, window, ambang slash) juga lewat timelock, dengan batas keras di kode (mis. `feeBps ≤ 300`).
- `Guardian` (key tunggal, aksi cepat) hanya boleh: `pause()` dan `void()` market pra-`Closed`. Tidak bisa memindahkan dana, tidak bisa mengubah outcome.

### 13.4 Faktor regulasi

Pasar prediksi diatur di banyak yurisdiksi. Desain menjaga token collateral, daftar kategori, dan gerbang akses tetap sebagai **konfigurasi**, sehingga deployment yang sesuai yurisdiksi adalah keputusan operasional, bukan penulisan ulang. Testnet memakai mUSDC tanpa nilai. Ini dicatat sebagai faktor keputusan pemilik produk, bukan penghalang teknis.

---

## 14. Rencana Uji & Verifikasi

### 14.1 Invarian Foundry (stateful fuzz) — jantung kepercayaan sistem

```
INV-1  poolBalance == DPMMath.costUp(q)         setelah sekuens buy/sell/addLiq/removeLiq/redeem/liquidate apa pun
INV-2  IERC20(collateral).balanceOf(market) >= toToken(poolBalance) + feeAccrued
INV-3  Σ redeem  <= poolBalance                 saat Settled
INV-4  Σ liquidate == poolBalance (± 2 wei)     saat Failed/Voided        [Euler: Σ pᵢ·qᵢ = C(q)]
INV-5  buy(x) lalu sell(x) mengembalikan <= yang dibayar    (round-trip tak pernah untung)
INV-6  qᵢ >= seedSupplyᵢ >= creatorSeedᵢ > 0    selalu, termasuk setelah removeLiquidity apa pun
INV-7  rugi penyedia <= 29.30% setoran          di bawah aliran order sembarang
INV-8  Σ probability(i) == WAD (± 2 wei)
INV-9  addLiquidity proporsional tidak mengubah probability (± 2 wei)
INV-10 sell/redeem/liquidate/withdraw berhasil walau paused == true
```

### 14.2 Lapisan uji

| Lapisan | Isi | Gate |
|---|---|---|
| L1 Solidity | unit per kontrak + INV-1..10 + uji reentrancy/akses | `forge test` hijau, coverage ≥ 90% baris pada `core/` |
| L2 Diferensial | DPM Solidity vs TS vs referensi Python, 10⁵ input acak | paritas ≤ 2 wei |
| L3 Service | unit + integrasi terhadap anvil (indexer reorg, klien inferensi, klien storage) | semua hijau |
| L4 e2e lokal | `scripts/e2e-workflow.mts`, `anvil` + `stub` + `file` | lihat §14.3 |
| L5 e2e Galileo | skrip sama, `galileo` + `compute` + `real` | ⛔ butuh deploy |
| L6 Chaos | resolver mangkir, provider 429, unggah storage gagal, reorg 12 blok, oracle basi | sistem degradasi terkendali, tidak ada kehilangan dana |

### 14.3 Skenario e2e (`scripts/e2e-workflow.mts`)

```
 1. Deploy semua kontrak; daftarkan 1 creator, 1 curator, 5 resolver, 3 trader agent; danai stake.
 2. Creator Agent merancang market → Curator menolak sekali (ambigu) → revisi → disetujui.
 3. createMarket(seed=1000 mUSDC) → cek q₀=q₁=707.11, P(YES)=50%.
 4. Tiga trader agent trading 20 tick → cek INV-1..2 setiap tick.
 5. Satu pengguna addLiquidity → cek probabilitas tak bergeser (INV-9).
 6. Satu pengguna mencoba melampaui Policy → harus revert.
 7. Lompat waktu melewati tradingEnd → close() → komite tersampling.
 8. Lima resolver commit → reveal (4 YES, 1 NO) → threshold tercapai → Proposed.
 9. Jalur A: finalize() → Settled → semua pihak redeem → cek konservasi kekal (§14.4).
10. Jalur B (market kedua): dispute() → ronde-2 membalik → slash ronde-1 → challenger dibayar.
11. Jalur C (market ketiga): tidak ada reveal → settlementDeadline → Failed → liquidate → INV-4.
12. Cetak neraca akhir: Σ masuk == Σ keluar + fee + slash (± debu).
```

### 14.4 Persamaan konservasi (dicek di langkah 12)

```
Σ (setoran seed + biaya beli + fee) == Σ (hasil jual + redeem + likuidasi) + feeTerdistribusi + debuPool
```

### 14.5 CI

`forge fmt --check` · `forge build` · `forge test -vvv` · `forge coverage` · `npm test --workspaces` · `e2e-workflow.mts` pada anvil dengan `stub`+`memory` · `slither` (informational gate) — semuanya wajib hijau sebelum merge.

---

## 15. Fase Implementasi

Tiap fase mendapat spec dan rencana implementasi tersendiri.

| Fase | Cakupan | Kriteria selesai |
|---|---|---|
| **P0 — Fondasi** | monorepo, Foundry, `ConfigRegistry`, `MockUSDC`, manifest deployment, tiga saklar mode, CI | `forge test` + `npm test` hijau di CI; `demo-local.sh` menaikkan anvil dan men-deploy |
| **P1 — Market inti** | `DPMMath`, `Market`, `OutcomeShares`, `MarketFactory`, seluruh INV-1..10, uji diferensial | INV-1..10 hijau pada 10⁶ langkah fuzz; paritas L2 ≤ 2 wei; coverage ≥ 90% |
| **P2 — Resolusi** | `AgentRegistry` (+stake/slash), `ResolutionModule` (commit–reveal, threshold, dispute), adapter stub | Skenario e2e langkah 7–11 lulus dengan resolver palsu |
| **P3 — Indexer + SDK** | tailer + reorg + REST/WS + `agent-kit` | Indexer memulihkan diri dari reorg 12 blok; SDK menjalankan seluruh siklus market |
| **P4 — Runtime agent** | 4 peran, `AgentAccount`+Policy, klien 0G Compute (stub→router→compute), receipt 0G Storage, log keputusan | e2e penuh `stub` hijau; **satu market nyata di-settle dengan `teeVerified == true`** |
| **P5 — Frontend** | seluruh rute §11, badge TEE, panel "Kenapa" | Seluruh siklus dapat dijalankan dari UI, tanpa CLI |
| **P6 — Deploy Galileo** | `deploy-galileo.sh`, verifikasi kontrak, e2e L5 | ⛔ **satu-satunya blokir yang teridentifikasi**; e2e L5 hijau di 16602 |
| **P7 — Kesiapan mainnet** | ERC-7857 penuh, VRF komite, commit–reveal order besar, persiapan audit, runbook upgrade/pause, stablecoin nyata | Audit eksternal terjadwal; runbook teruji di testnet |

Jalur kritis menuju "workflow bisa diuji": **P0 → P1 → P2 → P3 → P4 → P6**. P5 dan P7 paralel/menyusul.

---

## 16. Risiko Terbuka & Keputusan Tertunda

| # | Isu | Sikap sekarang | Kapan diputuskan |
|---|---|---|---|
| R1 | Dilusi payout DPM | Diterima sadar; dimitigasi `sell` kontinu + pengungkapan di UI | — (final) |
| R2 | Sampling komite pakai `blockhash` | Diterima untuk v1 | P7 → VRF/beacon |
| R3 | Rerun LLM tidak bit-exact | Klaim dibatasi pada atestasi TEE (§7.5) | — (final) |
| R4 | Front-running trade | Slippage bound saja | P7 → commit–reveal order besar |
| R5 | Katalog provider 0G Compute berubah | Penemuan runtime + fallback berurut | — (final) |
| R6 | Ledger 0G Compute bisa kering (faucet 0.1/hari) | `settlementDeposit` + alarm saldo | Pantau di P4 |
| R7 | Sumber sinyal Creator Agent | Belum dipilih konkret | Awal P4 |
| R8 | Yurisdiksi & akses | Konfigurasi, bukan kode | Sebelum mainnet |
| R9 | `Guardian` key tunggal | Kewenangan sempit (pause/void saja) | P7 → multisig 2/3 |

---

## 17. Lampiran — Parameter Default

| Parameter | Default | Batas keras |
|---|---|---|
| `feeBps` | 100 (1.00%) | ≤ 300 |
| `creatorFeeShareBps` / `resolverFeeShareBps` / protokol | 4000 / 3000 / 3000 | jumlah = 10000 |
| `minSeed` | 100 mUSDC | > 0 |
| `minSettlementDeposit` | 20 mUSDC | > 0 |
| Komite `FAST` / `VERIFIED` / `DETERMINISTIC` | 1 / 5 (k=3) / 3 (k=2) | n ≤ 21 |
| Komite ronde sengketa | 9 (k=5) | — |
| `commitWindow` / `revealWindow` | 30 mnt / 30 mnt | ≥ 10 mnt |
| `disputeWindow` FAST / VERIFIED / DETERMINISTIC | 24 j / 6 j / 2 j | ≥ 1 j |
| `disputeBond` | 200 mUSDC | ≥ 50 mUSDC |
| `minResolverStake` | 1000 mUSDC | — |
| `noShowSlashBps` / `disagreeSlashBps` / `overturnSlashBps` | 500 / 1000 / 3000 | ≤ 5000 |
| `unstakeCooldown` | 7 hari | ≥ 1 hari |
| `minTradeTokens` | 1 mUSDC | > 0 |
| `MAX_Q` | 1e33 wad | — |
| `sweepUnclaimedAfter` | 365 hari | ≥ 180 hari |
| `CONFIRMATIONS` (indexer) | 8 | ≥ 3 |
| Timelock upgrade | 48 jam | ≥ 24 jam |

### Glosarium

| Istilah | Arti |
|---|---|
| **DPM** | Dynamic Pari-Mutuel Market — cost function `√(Σqᵢ²)`, pool mendanai pembayarannya sendiri |
| **wad** | bilangan titik-tetap 18 desimal |
| **TeeML** | atestasi TEE 0G Compute atas eksekusi inferensi |
| **receipt** | dokumen bukti settlement di 0G Storage (§7.5) |
| **lembar seed** | lembar dari `createMarket`/`addLiquidity` — tidak transferable, tidak bisa `sell`; bagian creator tak pernah bisa ditarik |
| **Policy** | batas risiko on-chain yang membatasi agent di `AgentAccount` |
| **`specRoot`** | root Merkle 0G Storage untuk MarketSpec, di-anchor on-chain |
