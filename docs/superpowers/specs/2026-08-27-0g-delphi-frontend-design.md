# 0G-Delphi Frontend — Desain v1

**Status:** Design spec (v1) · **Tanggal:** 2026-08-27 · **Induk:** `docs/superpowers/specs/2026-08-27-0g-delphi-design.md` §11

---

## 1. Ringkasan

Antarmuka web untuk **manusia yang mengamati** pasar prediksi biner 0G-Delphi. Manusia membaca harga, sejarah, bukti resolusi, dan buku posisi agent — **manusia tidak mengeksekusi apa pun dari halaman ini**. Seluruh buy, sell, redeem, dan liquidate berjalan lewat SDK `@0g-delphi/agent-kit` di luar dApp, mengikuti pemisahan yang dipakai Delphi (Gensyn).

Konsekuensinya bukan sekadar "satu komponen dihapus": halaman detail market berhenti menjadi tempat bertransaksi dan menjadi tempat **memeriksa** — apa harganya, dari mana sejarahnya, siapa memegang apa, dan atas dasar bukti apa ia diselesaikan.

Tiga rute di v1: daftar market, detail market, portofolio. Rute agent (`/agents`, `/agents/[id]`, `/agents/new`) dan `/create` mendapat spec sendiri di P4.

### Keputusan terkunci

| # | Keputusan | Alasan |
|---|---|---|
| F1 | Lapisan data ber-mode `mock \| chain \| indexer`, dikomposisi sebagai **dekorator** | `indexer` = `chain` + sejarah, bukan penggantinya; komposisi membuat sifat itu struktural |
| F2 | `unavailable` adalah status kelas satu, sejajar loading/error | Mode `chain` tidak bisa menjawab pertanyaan sejarah sama sekali; UI tidak boleh menyamarkannya jadi nol |
| F3 | **UI manusia hanya mengamati; seluruh eksekusi lewat SDK agent** | Pemisahan literal ala Delphi, dipilih pemilik produk. Halaman manusia tidak punya jalur menulis ke rantai sama sekali — bukan disembunyikan di balik flag, melainkan tidak ada |
| F4 | Visual padat-data, tenang, presisi | Isi produk ini angka dan bukti, bukan narasi |
| F5 | Mesin kuotasi (kuotasi, dampak harga, dilusi) pindah ke **`@0g-delphi/agent-kit`**, bukan ke halaman | Yang membutuhkannya adalah pihak yang mengeksekusi. Menyimpannya di UI berarti menaruh logika sizing di tempat yang tak pernah memakainya |
| F7 | Panel bukti resolusi wajib menampilkan **model, alasan, kriteria, dan sumber data** | "Diselesaikan oleh AI" tanpa bukti adalah permintaan untuk percaya. Delphi mempublikasikannya; kita punya commit-reveal + 0G Storage yang seharusnya membuat kita bisa melakukannya lebih baik |
| F6 | Konversi desimal mengimpor `@0g-delphi/protocol`, tidak ditulis ulang | Paket itu sudah punya arah pembulatan yang benar dan sudah teruji diferensial |

---

## 2. Kemampuan per mode

Ini tabel yang mendorong seluruh desain. Ketiga mode **tidak** setara.

| Kemampuan | `mock` | `chain` | `indexer` | Sumber di mode nyata |
|---|:--:|:--:|:--:|---|
| `LIST_MARKETS` | ✓ | ✓ | ✓ | `MarketFactory.marketCount/marketAt` · tabel terindeks |
| `MARKET_STATE` | ✓ | ✓ | ✓ | `Market.qArray/probability/poolWad/status` |
| `MARKET_STATS` | ✓ | ✓ | ✓ | `Market.poolWad/feeBps/closeTime/...` · volume butuh indexer |
| `AGENT_POSITIONS` | ✓ | sebagian | ✓ | `OutcomeShares.balanceOfOutcome`; harga masuk butuh indexer |
| `POSITIONS_CURRENT` | ✓ | ✓ | ✓ | `OutcomeShares.balanceOfOutcome` + `Market.seedSharesOf` |
| `PRICE_HISTORY` | ✓ | ✗ | ✓ | indexer `price_points` |
| `TRADE_TAPE` | ✓ | ✗ | ✓ | indexer `trades` |
| `COST_BASIS` | ✓ | ✗ | ✓ | indexer `positions.avg_cost` |
| `MARKET_SPEC_BLOB` | ✓ | ✗ | ✓ | 0G Storage lewat `specRoot` |
| `SETTLEMENT_RECEIPT` | ✓ | ✗ | ✓ | 0G Storage + `resolutions` |

`QUOTE` dan `EXECUTE` **tidak lagi ada di tabel ini.** Keduanya milik `@0g-delphi/agent-kit`; lapisan data frontend tidak pernah memanggil `Market.buy`, `sell`, `redeem`, atau `liquidate`, dan tidak menyimpan signer. Itu batas yang struktural, bukan konvensi — `DataSource` sama sekali tidak punya metode yang menulis.

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

Susunan dua kolom: konten di kiri, **panel pemeriksaan** menempel di kanan (≥1024px); menumpuk di bawah 1024px. Kolom kanan berisi statistik market dan bukti resolusi — bukan kontrol.

**Kepala.** Pertanyaan, badge status, badge tier, kategori, hitung mundur tutup, alamat market dengan salin + tautan explorer.

**Panel probabilitas.** Angka besar `P(YES)` dan `P(NO)`, keduanya `pᵢ²`, dijamin berjumlah 100% (±1 unit terakhir — konsekuensi dua pembagian floor, lihat §5.1).

**Grafik riwayat probabilitas.** Dua seri (YES/NO), sumbu waktu, sumbu 0–100%. `PRICE_HISTORY` — merender `<Unavailable>` di mode `chain`, tidak pernah grafik kosong. Sumbu Y adalah **probabilitas**, bukan harga marginal; label sumbu menyebut `P(YES)` eksplisit agar tak ada pembaca yang menyangka itu `pᵢ`.

**Statistik market** (kolom kanan). Fee, kedalaman pool, volume, dan garis waktu siklus hidup lengkap: dibuat, tutup, settlement mulai, batas settle. Garis waktu itu bukan hiasan — di market dengan resolusi bertingkat, jarak antara "tutup" dan "batas settle" adalah jendela sengketa, dan pengamat berhak tahu berapa lama dananya terkunci.

**Panel payout berjalan — wajib, bukan hiasan.**

```
Payout jika YES menang     1.30× per lembar
Payout jika NO menang      1.56× per lembar

⚠  Payout mengambang sampai market tutup. Semakin banyak yang membeli
   sisi yang sama denganmu, semakin kecil payout per lembarmu.
   Jual kapan saja untuk mengunci harga saat ini.
```

Ini pengungkapan, bukan disclaimer. DPM mendanai pembayarannya dari pool, dan konsekuensinya payout milik pembeli awal terdilusi oleh pembeli belakangan. Menyembunyikannya membuat halaman ini berbohong tentang instrumen yang dijelaskannya. Karena manusia tidak lagi mengeksekusi di sini, panel ini menjadi **satu-satunya** tempat sifat itu terlihat oleh manusia — dan `agent-kit` wajib memunculkannya lagi di sisi agent (§6).

**Tabel posisi agent.** Agent, sisi, lembar, harga masuk, harga sekarang. `AGENT_POSITIONS`. Ini yang menggantikan tiket order sebagai isi utama halaman: pertanyaan manusia berubah dari "berapa yang saya beli" menjadi "siapa memegang apa, dan pada harga berapa". Harga masuk butuh `COST_BASIS`; di mode `chain` kolom itu `<Unavailable>` sementara lembar dan harga sekarang tetap terisi.

**Tape trade.** Waktu, sisi, lembar, harga rata-rata, alamat terpotong. `TRADE_TAPE`.

**Penampil MarketSpec.** Pertanyaan, aturan, sumber, prompt settlement, deadline. Diambil dari 0G Storage lewat `specRoot`. `MARKET_SPEC_BLOB`.

**Panel outcome final** (setelah resolusi). Outcome pemenang dan kurs payout-nya — `1/pᵢ` pada `q` yang dibekukan, bukan `1/Pᵢ` (§5.1).

**Panel bukti resolusi** (kolom kanan, setelah resolusi). Ini panel yang membuat "diselesaikan oleh AI" bisa diperiksa alih-alih dipercaya:

| Baris | Isi |
|---|---|
| Model resolver | daftar model komite yang memberi suara |
| Model hakim | model yang memutuskan, bila tier `VERIFIED`/`DETERMINISTIC` |
| Outcome final | YES / NO / VOID |
| Alasan | teks apa adanya dari receipt — **tidak diringkas** |
| Kriteria resolusi | dari `MarketSpec`, agar pembaca bisa menilai alasannya terhadap aturan yang dijanjikan |
| Sumber data | URL yang benar-benar dikonsultasikan resolver |
| Badge TEE | `teeVerified`, alamat provider, model, `chatID`, tautan receipt |

Badge menampilkan `simulated: true` secara mencolok bila receipt-nya dari mode stub — hasil tersimulasi tidak boleh pernah tertukar dengan yang sungguhan. Alasan resolver ditampilkan verbatim: meringkasnya berarti UI ikut menilai, dan pembaca kehilangan justru bagian yang ingin ia periksa. `SETTLEMENT_RECEIPT`.

### 4.3 `/portfolio` — buku agent, hanya-baca

Karena manusia tidak mengeksekusi, halaman ini bukan lagi "posisi saya" melainkan **buku posisi sebuah agent**, dialamatkan oleh wallet agent tersebut.

| Kolom | Sumber |
|---|---|
| Market · Outcome | — |
| Lembar | `POSITIONS_CURRENT` |
| Harga masuk rata-rata | `COST_BASIS` — `unavailable` di chain |
| Nilai sekarang | `pᵢ × lembar` dari `MARKET_STATE` |
| PnL belum direalisasi | butuh `COST_BASIS` |
| Status | Open · Settled (belum ditebus) · Failed/Voided (bisa dilikuidasi) |

Kolom **Aksi dihapus.** Redeem dan liquidate adalah eksekusi, dan eksekusi hidup di `agent-kit`. Kolom Status menggantikannya: ia memberi tahu pengamat bahwa ada yang perlu dilakukan, tanpa berpura-pura halaman ini bisa melakukannya.

Di mode `chain` kolom lembar dan nilai sekarang terisi penuh; harga masuk dan PnL merender `<Unavailable>`. Itu tabel yang berguna dan jujur sekaligus — persis alasan `unavailable` dijadikan status, bukan nol.

**Terbuka:** apakah rute ini kelak dilebur ke `/agents/[address]` bersama leaderboard di P4. Dibiarkan `/portfolio` untuk sekarang agar tidak mendahului spec agent.

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

## 6. Mesin kuotasi milik SDK, bukan halaman

Manusia tidak mengeksekusi, jadi tiket order keluar dari halaman market. Yang **tidak** boleh ikut hilang adalah logikanya — kuotasi, dampak harga, batas slippage, dan pengungkapan dilusi tetap wajib, hanya pindah ke pihak yang benar-benar memakainya: `@0g-delphi/agent-kit`.

### 6.1 Permukaan yang dicerminkan dari Delphi

Bentuk berikut diambil dari SDK Delphi karena penulis agent sudah mengenalnya, dan keakraban itu mengurangi kesalahan:

```ts
quoteBuy ({ market, outcome, sharesOut })          -> { tokensIn }
quoteSell({ market, outcome, sharesIn  })          -> { tokensOut }
ensureTokenApproval({ market, minimumAmount })     -> { approvalNeeded }
buyShares ({ market, outcome, sharesOut, maxTokensIn  }) -> { transactionHash }
sellShares({ market, outcome, sharesIn,  minTokensOut }) -> { transactionHash }
getMarket ({ address, pricesAndImpliedProbabilities }) -> { spotPrices[], spotImpliedProbabilities[], ... }
```

Dua detail dari SDK itu kita adopsi apa adanya karena keduanya benar:

- **Approve `maxTokensIn`, bukan hasil kuotasi.** Harga bisa bergerak ke mana saja sampai batas itu sebelum transaksinya mendarat; approve sebesar kuotasi membuat trade gagal justru pada saat harga bergerak.
- **`spotPrices` dan `spotImpliedProbabilities` dikembalikan terpisah**, meski di LMSR keduanya identik. Di sistem kita keduanya **berbeda secara fundamental**, jadi bentuk yang sudah memisahkannya membawa perbedaan itu dengan benar.

### 6.2 Jebakan porting: LMSR bukan DPM Pennock

**Ini bagian terpenting di seluruh dokumen bagi penulis agent.** Delphi memakai LMSR. Kita memakai DPM Pennock `C(q) = √(Σqᵢ²)`. Perbedaannya bukan detail implementasi:

| | Delphi (LMSR) | 0G-Delphi (DPM Pennock) |
|---|---|---|
| Normalisasi | `Σpᵢ = 1` | `Σpᵢ² = 1` |
| Probabilitas implisit | `Pᵢ = pᵢ` | `Pᵢ = pᵢ²` |
| Payout per lembar menang | **1** (tetap sejak beli) | **`1/pᵢ`** (mengambang sampai tutup) |
| Kelly | `f* = (P̂ − p)/(1 − p)` | `f* = (P̂ − P)/(1 − P)` |

Pada `P = 59%`: market kita membayar **1,30×**, market LMSR membayar **1,69×**. Agent yang di-port tanpa penyesuaian akan **melebih-lebihkan payout sekitar 30%** — dan ia akan tetap "bekerja", cuma rugi pelan-pelan.

Perhatikan bentuk Kelly-nya: rumusnya sama, tapi **variabelnya probabilitas, bukan harga**. Turunannya: odds bersih `b = payout/cost − 1 = (1/p)/p − 1 = (1−P)/P`, sehingga `f* = (P̂ − P)/(1 − P)`. Agent yang memasukkan `price` kita (yang bernilai `√P`) ke rumus bergaya Delphi salah ukuran secara sistematis, bukan sesekali.

Konsekuensi API: **`agent-kit` tidak boleh mengekspos field bernama `price` yang bisa disangka probabilitas.** Namai `marginalPrice` dan `impliedProbability`, dan biarkan tipe menolak pertukarannya.

### 6.3 Dilusi adalah dimensi risiko yang tak dimiliki LMSR

Di LMSR lembar menang membayar tepat 1, terkunci saat pembelian. Di DPM kita payout adalah `1/p_final`, dan **setiap pembelian berikutnya di sisi yang sama menurunkannya**. Artinya Kelly yang dihitung pada harga sekarang melebih-lebihkan edge — bukan karena estimasi probabilitasnya keliru, melainkan karena hadiahnya menyusut setelah agent masuk.

`quoteBuy` karena itu wajib mengembalikan **payout sebelum dan sesudah**, sebagaimana panel payout menampilkannya untuk manusia:

```ts
{ tokensIn, sharesOut, avgPrice,
  probBefore, probAfter,
  payoutBefore, payoutAfter }   // payoutAfter < payoutBefore, selalu, untuk buy
```

Mengembalikan `tokensIn` saja akan menyembunyikan satu-satunya hal yang membedakan market ini dari yang sudah dikenal penulis agent.

### 6.4 Ukuran dibatasi dampak, bukan hanya modal

Pola dari agent produksi yang layak ditiru: kuotasi ukuran target, lalu **paruh terus sampai dampaknya di bawah ambang**, dan tolak trade bila market terlalu tipis untuk menyerap ukuran terkecil sekalipun. Lalu periksa ulang edge terhadap **harga yang benar-benar dibayar**, bukan harga spot — edge 0,8% melawan biaya eksekusi 3,7% adalah kerugian dengan langkah tambahan.

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
│  ├─ hooks/                     useMarkets, useMarket, useCandles, usePositions
│  └─ format.ts                  seluruh aturan §7.2, satu tempat
├─ components/
│  ├─ primitives/                Table, Badge, Unavailable, CopyAddress, Countdown
│  ├─ market/                    ProbabilityPanel, PayoutPanel, ProbabilityChart,
│  │                             MarketStats, PositionsTable, TradeTape, SpecViewer
│  └─ settlement/                FinalOutcome, ResolutionEvidence, TeeBadge, ReceiptViewer
└─ test/                         vitest + playwright
```

`lib/format.ts` memusatkan §7.2 sehingga tidak ada komponen yang memformat angka sendiri — perbedaan format antar layar adalah cara paling mudah sebuah UI angka kehilangan kredibilitas.

---

## 9. Uji

| Lapisan | Isi | Alat |
|---|---|---|
| Lapisan data | tiap sumber memenuhi kontrak; kemampuan absen **melempar**, bukan mengembalikan kosong | vitest |
| Dekorasi | `IndexerSource` mendelegasikan pembacaan status ke `ChainSource` — dibuktikan lewat spy, bukan inspeksi | vitest |
| Batas tulis | `DataSource` **tidak punya** metode yang menulis rantai; diuji sebagai properti tipe dan sebagai grep terhadap `buy\|sell\|redeem\|liquidate` di `lib/data/` | vitest |
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
| **F1** | Halaman market diperkaya di mode mock: grafik probabilitas, statistik market, tabel posisi, outcome final, bukti resolusi. `OrderTicket` dikeluarkan. | F0 | halaman detail setara referensi Delphi, seluruhnya dari `MockSource` |
| **F2** | `ChainSource` + `/` daftar market | Task 17 (factory) | daftar terisi dari enumerasi factory; kolom sejarah `unavailable` dengan jujur |
| **F3** | `/portfolio` hanya-baca | Task 16 | buku agent terbaca dari rantai |
| **F4** | `IndexerSource` | P3 | grafik, tape, harga masuk terisi; `unavailable` menghilang |
| **F5** | `@0g-delphi/agent-kit` — kuotasi, dilusi, eksekusi (§6) | Task 13, 16, 17 | agent membeli dan menjual sungguhan di anvil lewat SDK |

Perhatikan urutannya berubah: dulu F1 adalah "beli & jual dari browser". Sekarang **tidak ada** fase yang membuat browser membeli apa pun. Momen "kurva DPM terlihat bergerak" pindah ke F5, dan penggeraknya agent, bukan manusia yang mengetik.

Kerja `OrderTicket` dari F0 tidak dibuang: logika `useQuote` — inversi fee dengan penyebut `10_000n + bps`, dampak harga lewat evaluasi ulang `dpm` pada `qAfter`, dan transisi payout — adalah implementasi rujukan yang dicerminkan `agent-kit` di F5. Yang dihapus komponennya, bukan matematikanya.

---

## 11. Risiko terbuka

| # | Isu | Sikap |
|---|---|---|
| R1 | `MarketFactory.marketAt` enumerasi linier; ribuan market akan lambat | Diterima untuk v1; indexer menggantikannya di F4 |
| R2 | Mode `chain` tanpa grafik membuat halaman detail terasa kosong | Diterima dan disengaja — lebih baik kosong jujur daripada terisi bohong |
| R3 | Toleransi slippage bawaan 0,5% mungkin terlalu ketat untuk market berkedalaman kecil | Pantau di F1; bisa diturunkan jadi fungsi kedalaman |
| R4 | Peringatan dilusi berisiko diabaikan seperti disclaimer pada umumnya | Karena itu ia ditampilkan sebagai **transisi angka** (`1.30× → 1.25×`), bukan hanya teks |
| R5 | `deploymentBlock` di manifest merekam blok pra-broadcast | Sudah tercatat di ledger P0; harus dibereskan sebelum F4 memakainya untuk backfill |
