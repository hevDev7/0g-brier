# 0G-Delphi Frontend — Desain v1

**Status:** Design spec (v1) · **Tanggal:** 2026-08-27 · **Induk:** `docs/superpowers/specs/2026-08-27-0g-delphi-design.md` §11

---

## 1. Ringkasan

Antarmuka web untuk **manusia** yang menelusuri, memperdagangkan, dan menebus posisi di pasar prediksi biner 0G-Delphi. Agent AI memakai jalur terpisah — SDK `@0g-delphi/agent-kit` di luar dApp — mengikuti pemisahan yang dipakai Delphi (Gensyn).

Tiga rute di v1: daftar market, detail market, portofolio. Rute agent (`/agents`, `/agents/[id]`, `/agents/new`) dan `/create` mendapat spec sendiri di P4.

### Keputusan terkunci

| # | Keputusan | Alasan |
|---|---|---|
| F1 | Lapisan data ber-mode `mock \| chain \| indexer`, dikomposisi sebagai **dekorator** | `indexer` = `chain` + sejarah, bukan penggantinya; komposisi membuat sifat itu struktural |
| F2 | `unavailable` adalah status kelas satu, sejajar loading/error | Mode `chain` tidak bisa menjawab pertanyaan sejarah sama sekali; UI tidak boleh menyamarkannya jadi nol |
| F3 | UI manusia; agent lewat SDK terpisah | Pemisahan literal ala Delphi, dipilih pemilik produk |
| F4 | Visual padat-data, tenang, presisi | Isi produk ini angka dan bukti, bukan narasi |
| F5 | Tiket order pratinjau **lokal** lewat cermin TS, konfirmasi **on-chain** sebelum kirim | Mengetik tanpa latensi RPC, eksekusi tetap otoritatif |
| F6 | Konversi desimal mengimpor `@0g-delphi/protocol`, tidak ditulis ulang | Paket itu sudah punya arah pembulatan yang benar dan sudah teruji diferensial |

---

## 2. Kemampuan per mode

Ini tabel yang mendorong seluruh desain. Ketiga mode **tidak** setara.

| Kemampuan | `mock` | `chain` | `indexer` | Sumber di mode nyata |
|---|:--:|:--:|:--:|---|
| `LIST_MARKETS` | ✓ | ✓ | ✓ | `MarketFactory.marketCount/marketAt` · tabel terindeks |
| `MARKET_STATE` | ✓ | ✓ | ✓ | `Market.qArray/probability/poolWad/status` |
| `QUOTE` | ✓ | ✓ | ✓ | `Market.quoteBuy/quoteBuySpend/quoteSell` — **selalu rantai** |
| `EXECUTE` | simulasi | ✓ | ✓ | `Market.buy/sell/redeem/liquidate` |
| `POSITIONS_CURRENT` | ✓ | ✓ | ✓ | `OutcomeShares.balanceOfOutcome` + `Market.seedSharesOf` |
| `PRICE_HISTORY` | ✓ | ✗ | ✓ | indexer `price_points` |
| `TRADE_TAPE` | ✓ | ✗ | ✓ | indexer `trades` |
| `COST_BASIS` | ✓ | ✗ | ✓ | indexer `positions.avg_cost` |
| `MARKET_SPEC_BLOB` | ✓ | ✗ | ✓ | 0G Storage lewat `specRoot` |
| `SETTLEMENT_RECEIPT` | ✓ | ✗ | ✓ | 0G Storage + `resolutions` |

**Kenapa `chain` tidak bisa menjawab sejarah.** Cost basis menuntut pengetahuan tentang apa yang dibayar, dan itu hanya ada di event. `eth_getLogs` dari genesis di Galileo bukan jalan keluar yang jujur untuk sebuah UI. Karena itu PnL di mode `chain` bukan nol — ia **tidak tersedia**, dan ditampilkan begitu.

---

## 3. Kontrak lapisan data

### 3.1 Bentuk

```ts
export type DataMode = 'mock' | 'chain' | 'indexer';

export type Capability =
  | 'LIST_MARKETS' | 'MARKET_STATE' | 'QUOTE' | 'EXECUTE'
  | 'POSITIONS_CURRENT' | 'PRICE_HISTORY' | 'TRADE_TAPE'
  | 'COST_BASIS' | 'MARKET_SPEC_BLOB' | 'SETTLEMENT_RECEIPT';

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: Capability, readonly mode: DataMode) {
    super(`${capability} tidak tersedia di mode ${mode}`);
  }
}

export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;

  listMarkets(f: MarketFilter): Promise<MarketSummary[]>;
  getMarket(address: Address): Promise<MarketDetail>;
  getCandles(address: Address, interval: Interval): Promise<Candle[]>;
  getTrades(address: Address, page: Page): Promise<Trade[]>;
  getPositions(wallet: Address): Promise<Position[]>;
  getMarketSpec(specRoot: Hex): Promise<MarketSpec>;
  getSettlement(address: Address): Promise<Settlement>;

  quoteBuy(a: Address, outcome: 0 | 1, sharesOut: bigint): Promise<Quote>;
  quoteBuySpend(a: Address, outcome: 0 | 1, tokensIn: bigint): Promise<Quote>;
  quoteSell(a: Address, outcome: 0 | 1, sharesIn: bigint): Promise<Quote>;
}
```

Metode yang kemampuannya absen **melempar** `CapabilityUnavailableError`. Ia tidak mengembalikan larik kosong — larik kosong berarti "tidak ada data", dan itu klaim berbeda dari "aku tidak bisa tahu".

### 3.2 Komposisi

```
MockSource     implements DataSource   — seluruh kemampuan, dari fixture
ChainSource    implements DataSource   — viem; melempar untuk 5 kemampuan sejarah
IndexerSource  implements DataSource   — MEMBUNGKUS ChainSource
                                          · state/kuotasi/eksekusi  → didelegasikan
                                          · sejarah                 → REST indexer
```

`IndexerSource` mendelegasikan alih-alih menduplikasi. Itu membuat "kuotasi selalu dari rantai" menjadi sifat struktural: tidak ada jalur kode di `IndexerSource` yang bisa mengambil kuotasi dari tempat lain, karena ia tidak punya implementasi kuotasi sendiri.

### 3.3 Status di React

```ts
export type Query<T> =
  | { status: 'loading' }
  | { status: 'ready';       data: T }
  | { status: 'unavailable'; capability: Capability; mode: DataMode }
  | { status: 'error';       error: Error };
```

Setiap hook mengembalikan bentuk ini. Karena `unavailable` ada di union, TypeScript **memaksa** tiap konsumen menanganinya — komponen yang lupa tidak akan mengompilasi. Itulah mekanisme yang menjaga UI tetap jujur, bukan disiplin penulisnya.

Komponen `<Unavailable capability mode />` merender satu baris tenang: nama kemampuan, mode saat ini, dan mode mana yang menyediakannya. Bukan spinner, bukan nol, bukan em dash tanpa penjelasan.

### 3.4 Matematika di klien

`@0g-delphi/protocol` mengekspor `dpm` — cermin TypeScript dari `DPMMath.sol` yang sudah disematkan ke Solidity lewat uji diferensial 512 vektor. Frontend memakainya untuk **pratinjau**, bukan untuk kebenaran:

```ts
import { dpm, toWad, toTokensCeil } from '@0g-delphi/protocol';

// saat pengguna mengetik — instan, tanpa RPC
const shares  = dpm.sharesForSpend(q, outcome, spendWad);
const qAfter  = withAdded(q, outcome, shares);
const probNow = dpm.probability(q, outcome);        // p_i^2
const probNew = dpm.probability(qAfter, outcome);

// sebelum kirim — otoritatif
const quote = await source.quoteBuy(addr, outcome, shares);
```

Dua konsekuensi yang disengaja: mengetik tidak memicu satu pun panggilan RPC, dan angka yang ditandatangani pengguna selalu berasal dari kontrak, bukan dari cermin.

---

## 4. Rute

### 4.1 `/` — daftar market

Tabel, bukan kartu. Arah visual padat-data menuntutnya, dan pembanding satu market dengan lainnya adalah pekerjaan utama halaman ini.

| Kolom | Isi | Catatan |
|---|---|---|
| Pertanyaan | teks, terpotong 2 baris | tautan ke detail |
| P(YES) | `pᵧ² ` dalam persen, 1 desimal | **kuadrat harga marginal**, lihat §5.1 |
| Δ24j | poin persentase, berwarna | `PRICE_HISTORY` — `unavailable` di mode chain |
| Volume | satuan collateral | `TRADE_TAPE` |
| Kedalaman | `poolWad` → token | lihat kenapa di bawah |
| Tier | badge `FAST`/`VERIFIED`/`DETERMINISTIC` | |
| Tutup | relatif (`2j 14m`), absolut saat hover | |

Filter: kategori, status, tier. Urut: volume, segera tutup, terbaru.

**Kenapa kedalaman jadi kolom kelas satu.** Di DPM, kedalaman sepenuhnya berasal dari seed — market bermodal kecil bergerak liar, dan dua market dengan probabilitas identik bisa punya perilaku harga yang sama sekali berbeda. Menyembunyikan kedalaman berarti menyembunyikan separuh informasi harga.

Di mode `chain`, kolom Δ24j dan Volume merender `<Unavailable>`; tabel tetap berguna.

### 4.2 `/market/[address]` — detail market

Susunan dua kolom: konten di kiri, tiket order menempel di kanan (≥1024px); menumpuk di bawah 1024px dengan tiket jadi sheet yang bisa dipanggil.

**Kepala.** Pertanyaan, badge status, badge tier, kategori, hitung mundur tutup, alamat market dengan salin + tautan explorer.

**Panel probabilitas.** Angka besar `P(YES)` dan `P(NO)`, keduanya `pᵢ²`, dijamin berjumlah 100% (±1 unit terakhir — konsekuensi dua pembagian floor, lihat §5.1). Grafik garis di bawahnya bila `PRICE_HISTORY` tersedia.

**Panel payout berjalan — wajib, bukan hiasan.**

```
Payout jika YES menang     1.30× per lembar
Payout jika NO menang      1.56× per lembar

⚠  Payout mengambang sampai market tutup. Semakin banyak yang membeli
   sisi yang sama denganmu, semakin kecil payout per lembarmu.
   Jual kapan saja untuk mengunci harga saat ini.
```

Ini pengungkapan, bukan disclaimer. DPM mendanai pembayarannya dari pool, dan konsekuensinya payout milik pembeli awal terdilusi oleh pembeli belakangan. Menyembunyikannya membuat UI ini berbohong tentang instrumen yang dijualnya. Teksnya muncul di panel **dan** di tiket order sebelum konfirmasi.

**Tape trade.** Waktu, sisi, lembar, harga rata-rata, alamat terpotong. `TRADE_TAPE`.

**Penampil MarketSpec.** Pertanyaan, aturan, sumber, prompt settlement, deadline. Diambil dari 0G Storage lewat `specRoot`. `MARKET_SPEC_BLOB`.

**Panel settlement** (setelah resolusi, P2). Outcome, kurs payout, dan **badge TEE**: `teeVerified` benar/salah, alamat provider, model, `chatID`, tautan ke receipt. Badge menampilkan `simulated: true` secara mencolok bila receipt-nya dari mode stub — hasil tersimulasi tidak boleh pernah tertukar dengan yang sungguhan.

### 4.3 `/portfolio`

| Kolom | Sumber |
|---|---|
| Market · Outcome | — |
| Lembar | `POSITIONS_CURRENT` |
| Cost basis rata-rata | `COST_BASIS` — `unavailable` di chain |
| Nilai sekarang | `pᵢ × lembar` dari `MARKET_STATE` |
| PnL belum direalisasi | butuh `COST_BASIS` |
| Aksi | Redeem (Settled) · Liquidate (Failed/Voided) |

Di mode `chain` kolom lembar dan nilai sekarang terisi penuh; cost basis dan PnL merender `<Unavailable>`. Itu tabel yang berguna dan jujur sekaligus — persis alasan `unavailable` dijadikan status, bukan nol.

---

## 5. Aturan kebenaran yang mengikat UI

### 5.1 Probabilitas adalah `pᵢ²`

`DPMMath.price` mengembalikan harga marginal `pᵢ = qᵢ/C(q)`. Probabilitas implisit adalah **kuadratnya**, karena `Σpᵢ² = WAD`. Menampilkan `pᵢ` sebagai probabilitas keliru sampai ~5 poin persentase pada skew yang biasa terjadi.

Gunakan `dpm.probability(q, i)` — jangan pernah `dpm.price(q, i)` — untuk apa pun yang diberi label persen. `marginalPrice` hanya muncul di satu tempat: sebagai harga eksekusi per lembar di tiket order dan tape.

**Payout per lembar adalah `1/pᵢ`, bukan `1/Pᵢ`.** Jebakan kembarannya, dan lebih halus karena keduanya menghasilkan angka yang terlihat masuk akal. Pada `P(YES) = 59.0%`, payout yang benar adalah `1/0.7682 = 1.30×`; memakai `1/0.59 = 1.69×` melebih-lebihkan payout **30%** — persis arah yang merugikan pengguna bila ia mempercayainya. Draf pertama spec ini sendiri melakukan kesalahan itu; ia ditemukan hanya karena angkanya dihitung ulang, bukan dibaca ulang.

Konsekuensi praktis untuk implementer: setiap nilai berlabel `%` berasal dari `dpm.probability`; setiap nilai berlabel `×` berasal dari `1/dpm.price`. Tidak ada `1/probability` di mana pun di basis kode.

Jumlah dua probabilitas bisa meleset 1 unit terakhir ke bawah (dua pembagian floor independen). UI menampilkan keduanya apa adanya dan tidak "memperbaiki" totalnya agar genap 100% — memaksa jumlah berarti menampilkan angka yang bukan angka kontrak.

### 5.2 Kuotasi taksiran; batas slippage yang mengikat

`quoteBuySpend` dibulatkan ke bawah dan tidak otoritatif. Kontraknya menghitung ulang. Tiket order selalu mengirim `maxTokensIn` (beli) atau `minTokensOut` (jual), diturunkan dari kuotasi ditambah toleransi yang bisa disetel pengguna (bawaan 0,5%), dan menampilkan batas itu sebelum konfirmasi.

### 5.3 Desimal

Collateral 6 desimal; lembar 18; seluruh matematika wad. Konversi hanya di batas token, lewat `toWad`/`toTokensFloor`/`toTokensCeil` dari `@0g-delphi/protocol`. Frontend tidak boleh punya konstanta `1e12` sendiri.

### 5.4 Jangan merender yang tak diketahui

Sudah ditegakkan tipe (§3.3). Dinyatakan di sini karena ia aturan produk, bukan sekadar detail teknis.

---

## 6. Tiket order

Bagian paling sulit didesain benar: ia harus memuat kuotasi, dampak harga, batas slippage, payout, dan peringatan dilusi tanpa jadi menakutkan atau justru menyesatkan.

```
┌─ Beli · Jual ────────────────────────────────┐
│  [ YES  59.0% ]  [ NO  41.0% ]               │
│                                              │
│  Belanjakan   [        100.00 ] mUSDC        │
│                    atau lembar ⇄              │
│  ────────────────────────────────────────    │
│  Terima              126.32 lembar YES       │
│  Harga rata-rata     0.7838 mUSDC / lembar   │
│  Fee (1.00%)         0.99 mUSDC              │
│  Ke pool             99.01 mUSDC             │
│                                              │
│  P(YES)  59.0%  →  63.8%     (+4.7 pt)       │
│  Payout jika YES     1.30×  →  1.25×         │
│                                              │
│  Maks dibayar  100.50 mUSDC   slippage 0.5%  │
│                                              │
│  ⚠ Payout mengambang; pembeli berikutnya di  │
│    sisi ini menurunkan payout per lembarmu.  │
│                                              │
│  [           Setujui mUSDC           ]       │
│  [            Beli YES                ]      │
└──────────────────────────────────────────────┘
```

Empat keputusan di balik susunan ini:

- **Nominal dulu, lembar sebagai alternatif.** Orang berpikir "seratus dolar", bukan "135,31 lembar". Tombol `⇄` menukar mode input.
- **Dampak harga ditampilkan sebagai transisi, bukan angka tunggal.** `59.0% → 59.4%` memberi tahu apa yang perbuatanmu lakukan pada market; "+0,4 pt" saja tidak.
- **Payout ditampilkan sebagai transisi juga**, dan itu justru yang membuat dilusi terlihat konkret: pembelianmu sendiri menurunkan payout-mu dari 1,30× ke 1,25×. Peringatan teks di bawahnya menggeneralisasi apa yang sudah pengguna lihat terjadi.
- **Approve dan Beli sebagai dua tombol terpisah**, bukan satu tombol yang diam-diam mengirim dua transaksi. Tombol approve hilang begitu allowance mencukupi.

Perilaku status: kuotasi dihitung lokal saat mengetik (tanpa debounce, tanpa RPC); `quoteBuy` on-chain dipanggil sekali saat blur atau sebelum konfirmasi; bila keduanya berbeda lebih dari toleransi, tiket menampilkan angka rantai dan menandainya diperbarui.

---

## 7. Sistem visual

Padat-data, tenang, presisi. Angka adalah warga kelas satu; warna hanya membawa makna.

### 7.1 Token

```css
:root {
  /* netral — satu-satunya tangga yang dipakai untuk permukaan dan teks */
  --n-0:#ffffff; --n-1:#fafafa; --n-2:#f4f4f5; --n-3:#e4e4e7;
  --n-4:#d4d4d8; --n-6:#a1a1aa; --n-8:#52525b; --n-10:#27272a; --n-12:#09090b;

  --bg:var(--n-0); --bg-sunken:var(--n-1); --bg-raised:var(--n-0);
  --border:var(--n-3); --border-strong:var(--n-4);
  --text:var(--n-12); --text-muted:var(--n-8); --text-faint:var(--n-6);

  /* satu aksen, dipakai untuk aksi utama dan fokus — tidak untuk dekorasi */
  --accent:#2563eb; --accent-fg:#ffffff;

  /* semantik: hanya untuk makna */
  --pos:#15803d;      /* naik, untung */
  --neg:#b91c1c;      /* turun, rugi */
  --warn:#a16207;     /* dilusi, batas, perhatian */
  --verified:#15803d; /* TEE terverifikasi */
  --unverified:var(--n-6);

  --radius:6px;
  --row-h:38px;
}

.dark {
  --bg:var(--n-12); --bg-sunken:#050507; --bg-raised:var(--n-10);
  --border:#27272a; --border-strong:#3f3f46;
  --text:var(--n-1); --text-muted:var(--n-6); --text-faint:var(--n-8);
  --accent:#3b82f6;
  --pos:#4ade80; --neg:#f87171; --warn:#fbbf24; --verified:#4ade80;
}
```

Tailwind `darkMode: 'class'`. Setiap warna punya definisi di `:root`; `.dark` hanya menimpa. Tidak ada warna yang definisi satu-satunya ada di blok gelap.

### 7.2 Tipografi & angka

Satu keluarga sans untuk UI (Inter atau system stack), satu mono hanya untuk alamat dan hash.

**`font-variant-numeric: tabular-nums` di setiap sel angka.** Tanpa itu, kolom probabilitas bergoyang saat diperbarui dan tabel jadi sulit dipindai — ini persyaratan fungsional pada UI yang isinya angka berjajar, bukan preferensi estetika.

| Besaran | Format | Contoh |
|---|---|---|
| Probabilitas | 1 desimal + `%` | `59.0%` |
| Delta probabilitas | 1 desimal + `pt`, berwarna | `+0.4 pt` |
| Payout | 2 desimal + `×` | `1.70×` |
| Collateral | 2 desimal + simbol | `1,234.56 mUSDC` |
| Lembar | 2 desimal | `135.31` |
| Harga/lembar | 4 desimal | `0.7391` |
| Alamat | `0x1234…cdef`, mono, klik-salin | |
| Waktu tutup | relatif; absolut saat hover | `2j 14m` |

Skala tipe: 12 / 13 / 14 / 16 / 20 / 28 px. Empat pertama menanggung hampir seluruh UI.

### 7.3 Kepadatan & kromatik

Baris tabel `--row-h: 38px`. Pembatas 1px, bukan bayangan. Radius 6px. Tidak ada gradien, glow, atau bayangan berwarna.

Aturan warna: sebuah elemen boleh berwarna **hanya bila warnanya membawa informasi yang tidak ada di tempat lain**. Probabilitas naik/turun berwarna; nama market tidak. Badge TEE berwarna; badge kategori abu-abu.

---

## 8. Struktur berkas

```
frontend/
├─ app/
│  ├─ layout.tsx                 shell, provider, tema
│  ├─ page.tsx                   /
│  ├─ market/[address]/page.tsx  /market/[address]
│  └─ portfolio/page.tsx         /portfolio
├─ lib/
│  ├─ data/
│  │  ├─ types.ts                DataSource, Capability, Query, model
│  │  ├─ mock.ts                 MockSource + fixture
│  │  ├─ chain.ts                ChainSource (viem)
│  │  ├─ indexer.ts              IndexerSource (membungkus ChainSource)
│  │  └─ index.ts                pemilih mode dari env
│  ├─ hooks/                     useMarkets, useMarket, useCandles, usePositions, useQuote
│  └─ format.ts                  seluruh aturan §7.2, satu tempat
├─ components/
│  ├─ primitives/                Table, Badge, Unavailable, CopyAddress, Countdown
│  ├─ market/                    ProbabilityPanel, PayoutPanel, OrderTicket, TradeTape, SpecViewer
│  └─ settlement/                TeeBadge, ReceiptViewer
└─ test/                         vitest + playwright
```

`lib/format.ts` memusatkan §7.2 sehingga tidak ada komponen yang memformat angka sendiri — perbedaan format antar layar adalah cara paling mudah sebuah UI angka kehilangan kredibilitas.

---

## 9. Uji

| Lapisan | Isi | Alat |
|---|---|---|
| Lapisan data | tiap sumber memenuhi kontrak; kemampuan absen **melempar**, bukan mengembalikan kosong | vitest |
| Dekorasi | `IndexerSource` mendelegasikan kuotasi/eksekusi ke `ChainSource` — dibuktikan lewat spy, bukan inspeksi | vitest |
| Format | tabel §7.2 sebagai kasus uji | vitest |
| Komponen | tiap konsumen `Query<T>` merender keempat status | vitest + Testing Library |
| e2e | tiga rute melawan anvil di mode `chain`; termasuk buy sungguhan dan verifikasi `unavailable` muncul di kolom sejarah | Playwright |

`MockSource` **adalah** fixture uji — jalur kodenya sama dengan yang dipakai pengembangan, jadi ia tidak bisa membusuk diam-diam.

Satu uji yang wajib ada dan mudah terlupa: **render setiap komponen di mode `chain` dan pastikan tidak ada nol yang muncul di tempat yang seharusnya `unavailable`.** Itu penegakan F2 di tingkat perilaku, bukan hanya tipe.

---

## 10. Fase

| Fase | Isi | Prasyarat | Selesai bila |
|---|---|---|---|
| **F0** | workspace, token, `lib/format`, `types.ts`, `MockSource`, primitif | — | vitest hijau; storybook-less demo halaman token |
| **F1** | `/market/[address]` + `ChainSource` + tiket order | Task 13 (`sell`) | beli & jual sungguhan di anvil dari browser |
| **F2** | `/` daftar market | Task 17 (factory) | daftar terisi dari enumerasi factory |
| **F3** | `/portfolio` + redeem/liquidate | Task 16 | siklus penuh: beli → settle → redeem, dari UI |
| **F4** | `IndexerSource` | P3 | grafik, tape, PnL terisi; `unavailable` menghilang |

F1 adalah pertama kalinya kurva DPM terlihat bergerak di browser, dan pertama kalinya seluruh disiplin pembulatan protokol diuji oleh manusia yang mengetik angka sembarang.

---

## 11. Risiko terbuka

| # | Isu | Sikap |
|---|---|---|
| R1 | `MarketFactory.marketAt` enumerasi linier; ribuan market akan lambat | Diterima untuk v1; indexer menggantikannya di F4 |
| R2 | Mode `chain` tanpa grafik membuat halaman detail terasa kosong | Diterima dan disengaja — lebih baik kosong jujur daripada terisi bohong |
| R3 | Toleransi slippage bawaan 0,5% mungkin terlalu ketat untuk market berkedalaman kecil | Pantau di F1; bisa diturunkan jadi fungsi kedalaman |
| R4 | Peringatan dilusi berisiko diabaikan seperti disclaimer pada umumnya | Karena itu ia ditampilkan sebagai **transisi angka** (`1.30× → 1.25×`), bukan hanya teks |
| R5 | `deploymentBlock` di manifest merekam blok pra-broadcast | Sudah tercatat di ledger P0; harus dibereskan sebelum F4 memakainya untuk backfill |
