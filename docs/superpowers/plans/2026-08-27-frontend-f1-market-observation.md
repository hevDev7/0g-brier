# F1 — Halaman Market yang Diperkaya (Mode Observasi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah `/market/[address]` dari halaman transaksi menjadi halaman pemeriksaan — grafik riwayat probabilitas, statistik market, tabel posisi agent, outcome final, dan bukti resolusi — seluruhnya di mode `mock`, dengan `OrderTicket` dikeluarkan dan batas tulis ditegakkan secara struktural.

**Architecture:** Lapisan data bertambah tiga kemampuan (`AGENT_POSITIONS`, `COST_BASIS`, `SETTLEMENT_RECEIPT`) dan kehilangan dua yang tak pernah dipakai (`QUOTE`, `EXECUTE`). Setiap panel baru adalah komponen presentasional murni yang menerima data sudah-teresolusi; `MarketView` tetap satu-satunya tempat `Query<T>` dibongkar. Grafik digambar sebagai SVG tanpa pustaka pihak ketiga.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript ^5, Tailwind v4 (CSS-first, tanpa `tailwind.config.js`), TanStack Query 5, Vitest 4 + jsdom + Testing Library, `@0g-delphi/protocol` untuk DPM dan konversi desimal.

**Spec:** `docs/superpowers/specs/2026-08-27-0g-delphi-frontend-design.md` (§1 F3, §2, §4.2, §4.3, §6)

## Global Constraints

Setiap tugas tunduk pada seluruh butir ini.

- **Manusia tidak mengeksekusi apa pun.** `DataSource` tidak boleh punya satu pun metode yang menulis ke rantai, dan frontend tidak boleh menyimpan signer. Ini diuji, bukan diasumsikan (Task 1 Step 6).
- **Probabilitas adalah `pᵢ²`.** Setiap nilai berlabel `%` berasal dari `dpm.probability`. Tidak boleh ada `dpm.price` yang diberi label persen — termasuk pada sumbu grafik.
- **Payout per lembar adalah `1/pᵢ`, bukan `1/Pᵢ`.** Tidak boleh ada `1/probability` di mana pun di basis kode.
- **Seluruh nilai moneter `bigint`.** Tidak ada `Number()` pada nilai moneter, tidak ada `parseFloat` pada nilai wad. Satu pengecualian eksplisit: koordinat SVG di `ProbabilityChart` (Task 2), yang dikonversi dari `bigint` tepat satu kali di batas render dan tidak pernah dipakai untuk menghitung nilai yang ditampilkan.
- **Komponen tidak memformat angka sendiri.** Semua lewat `frontend/src/lib/format.ts`.
- **Konversi desimal mengimpor `@0g-delphi/protocol`.** Tidak ada konstanta `1e12`/`1e18` di luar `lib/format.ts`.
- **`unavailable` adalah anggota union `Query<T>`.** Komponen yang tidak menanganinya tidak boleh mengompilasi. Jangan pernah merender `0` atau `—` untuk data yang mode saat ini tidak bisa ketahui.
- **Ketersediaan dievaluasi per baris, bukan per panel** (spec §2). Panel yang satu barisnya tak diketahui tetap merender baris-baris lain.
- **Tailwind v4.** Token tema di `@theme inline` dalam `globals.css`. Jangan membuat `tailwind.config.js`.
- Semua uji hijau sebelum commit; `npx tsc --noEmit -p frontend` bersih; Conventional Commits; satu commit per tugas.

### Pelajaran yang sudah dibayar mahal — jangan diulang

- **`getByText` hanya menggabungkan node teks LANGSUNG milik satu elemen.** Frasa yang terpecah lintas elemen (`<span>{nilai}</span> per lembar`) tidak akan pernah cocok. Sudah menggigit rencana F0 tiga kali. Bila sebuah assertion mencari frasa, pastikan frasa itu utuh di dalam satu elemen — atau pakai `toHaveTextContent`, yang membaca `.textContent` secara rekursif.
- **`afterEach(cleanup)` wajib.** Vitest di proyek ini berjalan tanpa `globals`, jadi auto-cleanup Testing Library tidak pernah terpasang sendiri. Sudah ada di `vitest.setup.ts`; jangan hapus.
- **Anotasi tipe kembalian eksplisit adalah penanggung beban eksaustivitas.** `switch` atas `Query.status` tanpa `default` hanya menegakkan kelengkapan bila fungsinya beranotasi tipe non-nullable. Tanpa anotasi, TypeScript menyimpulkan `| undefined` dan jaminannya lenyap.
- **Penanganan tanda di `format.ts` sudah dua kali bocor** (bug "-0.0", lalu `formatFeeRate` negatif). Fungsi format baru yang menyentuh tanda wajib punya kasus uji negatif dan nol.

---

## Struktur berkas

```
frontend/src/
├─ lib/
│  ├─ data/
│  │  ├─ types.ts          + Position, SettlementReceipt, ResolverVote
│  │  │                    + AGENT_POSITIONS/COST_BASIS/SETTLEMENT_RECEIPT
│  │  │                    − QUOTE/EXECUTE
│  │  │                    + getPositions(), getReceipt() di DataSource
│  │  └─ mock.ts           + fixture posisi & receipt, generator koheren
│  ├─ format.ts            + formatTimestamp, formatDuration
│  └─ chart.ts             BARU — geometri murni, tanpa JSX
├─ hooks/
│  ├─ usePositions.ts      BARU
│  ├─ useReceipt.ts        BARU
│  └─ useCandles.ts        BARU
├─ components/
│  ├─ market/
│  │  ├─ ProbabilityChart.tsx   BARU
│  │  ├─ MarketStats.tsx        BARU
│  │  └─ PositionsTable.tsx     BARU
│  └─ settlement/
│     ├─ FinalOutcome.tsx       BARU
│     └─ ResolutionEvidence.tsx BARU
└─ app/market/[address]/MarketView.tsx   dirakit ulang; OrderTicket dikeluarkan
```

`lib/chart.ts` dipisah dari komponennya dengan sengaja: geometri grafik adalah aritmetika yang bisa diuji tanpa DOM, dan mencampurnya dengan JSX membuat satu-satunya bagian yang benar-benar bisa salah jadi sulit diuji.

---

### Task 1: Lapisan data — kemampuan observasi, dan batas tulis yang ditegakkan

**Files:**
- Modify: `frontend/src/lib/data/types.ts`
- Modify: `frontend/src/lib/data/mock.ts`
- Modify: `frontend/src/components/primitives/Unavailable.tsx`
- Test: `frontend/test/mock-source.test.ts` (tambah), `frontend/test/write-boundary.test.ts` (baru)

**Interfaces:**
- Consumes: `MarketDetail`, `Trade`, `Candle`, `Query<T>`, `CapabilityUnavailableError` (F0)
- Produces:
  - `Capability` = `"LIST_MARKETS" | "MARKET_STATE" | "PRICE_HISTORY" | "TRADE_TAPE" | "AGENT_POSITIONS" | "COST_BASIS" | "SETTLEMENT_RECEIPT"`
  - `interface Position { agent: \`0x${string}\`; outcome: Outcome; shares: bigint; entryPriceWad: bigint | null }`
  - `interface ResolverVote { model: string; outcome: Outcome | null; teeVerified: boolean; simulated: boolean }`
  - `interface SettlementReceipt { outcome: Outcome | null; votes: ResolverVote[]; judgeModel: string | null; reasoning: string; criteria: string; sources: string[]; provider: \`0x${string}\`; chatId: string; simulated: boolean }`
  - `MarketDetail.createdAt: number`
  - `DataSource.getPositions(address): Promise<Position[]>`
  - `DataSource.getReceipt(address): Promise<SettlementReceipt>`

- [ ] **Step 1: Tulis uji yang gagal — kemampuan absen melempar, tidak mengembalikan kosong**

Tambahkan ke `frontend/test/mock-source.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {MockSource, FIXTURE_MARKETS} from "@/lib/data/mock";
import {CapabilityUnavailableError} from "@/lib/data/types";

describe("kemampuan observasi", () => {
  const addr = FIXTURE_MARKETS[0]!.address;

  it("getPositions melempar bila AGENT_POSITIONS diomit", async () => {
    const src = new MockSource({omit: ["AGENT_POSITIONS"]});
    await expect(src.getPositions(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("getReceipt melempar bila SETTLEMENT_RECEIPT diomit", async () => {
    const src = new MockSource({omit: ["SETTLEMENT_RECEIPT"]});
    await expect(src.getReceipt(addr)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("posisi menjumlah ke q market, per outcome", async () => {
    const src = new MockSource();
    for (const m of FIXTURE_MARKETS) {
      const pos = await src.getPositions(m.address);
      for (const outcome of [0, 1] as const) {
        const held = pos
          .filter((p) => p.outcome === outcome)
          .reduce((a, p) => a + p.shares, 0n);
        expect(held).toBeLessThanOrEqual(m.q[outcome]);
      }
    }
  });

  it("harga masuk tiap posisi berada di antara 0 dan WAD", async () => {
    const src = new MockSource();
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) {
      expect(p.entryPriceWad).not.toBeNull();
      expect(p.entryPriceWad!).toBeGreaterThan(0n);
      expect(p.entryPriceWad!).toBeLessThan(10n ** 18n);
    }
  });

  it("COST_BASIS diomit -> posisi tetap ada, harga masuknya null", async () => {
    const src = new MockSource({omit: ["COST_BASIS"]});
    const pos = await src.getPositions(FIXTURE_MARKETS[0]!.address);
    expect(pos.length).toBeGreaterThan(0);
    for (const p of pos) expect(p.entryPriceWad).toBeNull();
  });

  it("receipt market Settled menyebut outcome, dan yang Open tidak", async () => {
    const src = new MockSource();
    const settled = FIXTURE_MARKETS.find((m) => m.status === "Settled");
    expect(settled, "fixture wajib punya satu market Settled").toBeDefined();
    expect((await src.getReceipt(settled!.address)).outcome).not.toBeNull();

    const open = FIXTURE_MARKETS.find((m) => m.status === "Open")!;
    expect((await src.getReceipt(open.address)).outcome).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- mock-source`
Expected: FAIL — `src.getPositions is not a function`.

- [ ] **Step 3: Perbarui `types.ts`**

Ganti union `Capability`, hapus `QUOTE` dan `EXECUTE`:

```ts
export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE"
  | "AGENT_POSITIONS"
  | "COST_BASIS"
  | "SETTLEMENT_RECEIPT";
```

Tambahkan tipe baru:

```ts
export interface Position {
  agent: `0x${string}`;
  outcome: Outcome;
  shares: bigint;
  /**
   * Harga rata-rata masuk, wad. `null` berarti mode saat ini TIDAK BISA
   * mengetahuinya — bukan nol, dan bukan "belum dimuat". Hanya event yang
   * menyimpan apa yang dibayar, jadi mode `chain` mengembalikan null di sini
   * dan tabel merender `<Unavailable capability="COST_BASIS">` di sel itu.
   * Tipenya sengaja nullable supaya konsumen yang lupa tidak mengompilasi.
   */
  entryPriceWad: bigint | null;
}

export interface ResolverVote {
  model: string;
  /** null = resolver tidak memberi suara (belum reveal, atau abstain). */
  outcome: Outcome | null;
  teeVerified: boolean;
  simulated: boolean;
}

export interface SettlementReceipt {
  /** null selama market belum diselesaikan. */
  outcome: Outcome | null;
  votes: ResolverVote[];
  judgeModel: string | null;
  /** Alasan apa adanya dari resolver. TIDAK diringkas — lihat spec §4.2. */
  reasoning: string;
  criteria: string;
  sources: string[];
  provider: `0x${string}`;
  chatId: string;
  /** true bila receipt berasal dari mode stub. Wajib mencolok di UI. */
  simulated: boolean;
}
```

Tambahkan `createdAt` ke `MarketDetail`:

```ts
export interface MarketDetail extends MarketSummary {
  feeBps: number;
  createdAt: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
}
```

Tambahkan dua metode ke `DataSource`, **dan komentar yang menjelaskan kenapa tidak ada metode tulis**:

```ts
/**
 * Kontrak baca. Perhatikan tidak ada `buy`, `sell`, `redeem`, maupun
 * `liquidate` di sini, dan itu bukan kelalaian: UI manusia hanya mengamati
 * (spec §1 F3). Seluruh eksekusi hidup di `@0g-delphi/agent-kit`. Batas ini
 * ditegakkan uji, bukan hanya konvensi — lihat test/write-boundary.test.ts.
 */
export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
  getPositions(address: `0x${string}`): Promise<Position[]>;
  getReceipt(address: `0x${string}`): Promise<SettlementReceipt>;
}
```

- [ ] **Step 4: Perbarui `mock.ts`**

Tambahkan `createdAt` ke setiap entri `FIXTURE_MARKETS`, dan pastikan **minimal satu market berstatus `"Settled"`** (uji Step 1 menuntutnya; bila fixture saat ini semuanya `Open`, ubah market ketiga menjadi `Settled`).

Posisi diturunkan dari transaksi yang sudah dibangkitkan, bukan diarang bebas — kalau tidak, tabel posisi akan bertentangan dengan tape persis seperti tape dulu bertentangan dengan harga:

```ts
/**
 * Posisi diturunkan dari transaksi fixture, bukan ditulis terpisah. Menulisnya
 * terpisah adalah cara paling mudah membuat dua panel di halaman yang sama
 * saling membantah — dan itu sudah pernah terjadi di F0, saat tape berakhir di
 * 73,1% sementara market berharga 59,0%.
 */
function fixturePositions(m: MarketSummary, trades: Trade[]): Position[] {
  const acc = new Map<string, {shares: bigint; tokens: bigint}>();
  for (const t of trades) {
    if (t.sharesDelta <= 0n) continue; // hanya pembelian membentuk harga masuk
    const key = `${t.trader}:${t.outcome}`;
    const cur = acc.get(key) ?? {shares: 0n, tokens: 0n};
    acc.set(key, {shares: cur.shares + t.sharesDelta, tokens: cur.tokens + t.tokens});
  }
  const out: Position[] = [];
  for (const [key, v] of acc) {
    const [agent, outcomeStr] = key.split(":");
    if (v.shares === 0n) continue;
    out.push({
      agent: agent as `0x${string}`,
      outcome: Number(outcomeStr) as Outcome,
      shares: v.shares,
      // tokens sudah dalam satuan token; naikkan ke wad sebelum membagi supaya
      // hasilnya harga per lembar dalam wad, bukan pecahan yang terpotong nol.
      entryPriceWad: (toWad(v.tokens, m.collateral.decimals) * WAD) / v.shares,
    });
  }
  return out.sort((a, b) => (b.shares > a.shares ? 1 : -1));
}
```

Receipt fixture untuk market `Settled` (yang lain mengembalikan `outcome: null`):

```ts
const FIXTURE_RECEIPT: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning:
    "Dua dari tiga resolver menyimpulkan YES. Resolver ketiga membaca rilis " +
    "yang berbeda tanggal dan karena itu menjawab NO; bukti yang dikutipnya " +
    "berada di luar jendela yang ditetapkan kriteria.",
  criteria:
    "YES bila harga penutupan ETH/USD pada 30 September 2026 di atas $4.000 " +
    "menurut rilis harian CoinGecko. Sumber lain hanya dipakai bila CoinGecko " +
    "tidak menerbitkan.",
  sources: ["https://www.coingecko.com/en/coins/ethereum/historical_data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};
```

Implementasikan `getPositions` dan `getReceipt` memakai helper `require()` yang sudah ada, sehingga kemampuan yang diomit **melempar**, bukan mengembalikan kosong.

- [ ] **Step 5: Perbarui `Unavailable.tsx`**

Hapus entri `QUOTE`/`EXECUTE` dari `LABELS` dan `PROVIDED_BY`, tambahkan tiga yang baru:

```ts
const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Daftar market",
  MARKET_STATE: "Status market",
  PRICE_HISTORY: "Riwayat harga",
  TRADE_TAPE: "Riwayat transaksi",
  AGENT_POSITIONS: "Posisi agent",
  COST_BASIS: "Harga masuk",
  SETTLEMENT_RECEIPT: "Bukti resolusi",
};
```

`PROVIDED_BY` untuk ketiganya adalah `"indexer"` kecuali `AGENT_POSITIONS`, yang tersedia di `chain` juga (dibaca dari `OutcomeShares`).

Karena keduanya `Record<Capability, …>`, menghapus anggota union akan membuat entri lama gagal kompilasi — itulah tujuannya.

- [ ] **Step 6: Tulis uji batas tulis**

Buat `frontend/test/write-boundary.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

/**
 * Batas ini adalah keputusan produk (spec §1 F3): manusia hanya mengamati.
 * Aturan yang hanya ditulis di dokumen akan dilanggar; yang gagal di CI tidak.
 */
describe("lapisan data tidak menulis ke rantai", () => {
  const dir = join(process.cwd(), "src/lib/data");

  it("tidak ada berkas di lib/data yang menyebut operasi tulis", () => {
    const forbidden = /\b(buyShares|sellShares|redeem|liquidate|writeContract|sendTransaction|getSigner|privateKey)\b/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const hit = src.match(forbidden);
      expect(hit?.[0], `${file} menyebut operasi tulis: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("DataSource hanya mengekspos metode baca", async () => {
    const {MockSource} = await import("@/lib/data/mock");
    const src = new MockSource();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(src))
      .filter((n) => n !== "constructor" && typeof (src as never)[n] === "function");
    const allowed = new Set([
      "listMarkets", "getMarket", "getTrades", "getCandles",
      "getPositions", "getReceipt", "require", "find",
    ]);
    for (const m of methods) {
      expect(allowed.has(m), `metode tak terduga di MockSource: ${m}`).toBe(true);
    }
  });
});
```

- [ ] **Step 7: Jalankan seluruh uji**

Run: `npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend`
Expected: semua hijau. Uji lama yang menyebut `QUOTE`/`EXECUTE` akan gagal kompilasi — perbaiki dengan menghapus referensinya, jangan dengan memulihkan anggota union.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/data frontend/src/components/primitives/Unavailable.tsx frontend/test
git commit -m "feat(frontend): kemampuan observasi di lapisan data, batas tulis ditegakkan uji"
```

---

### Task 2: `lib/chart.ts` — geometri grafik sebagai aritmetika murni

**Files:**
- Create: `frontend/src/lib/chart.ts`
- Test: `frontend/test/chart.test.ts`

**Interfaces:**
- Consumes: `Candle` (Task 1)
- Produces:
  - `interface Extent { minT: number; maxT: number }`
  - `function seriesPath(candles: Candle[], box: Box, extent: Extent, pick: (c: Candle) => bigint): string`
  - `function yTicks(box: Box): {y: number; label: string}[]`
  - `function xTicks(candles: Candle[], box: Box, extent: Extent, count: number): {x: number; label: string}[]`
  - `interface Box { width: number; height: number; padLeft: number; padRight: number; padTop: number; padBottom: number }`

Sumbu Y **selalu 0–100%**, tidak pernah diskalakan ke rentang data. Grafik probabilitas yang sumbu-nya mengambang membuat pergerakan 2 poin terlihat seperti keruntuhan.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `frontend/test/chart.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {seriesPath, yTicks, xTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

function candle(t: number, closeWad: bigint): Candle {
  return {bucketStart: t, open: closeWad, high: closeWad, low: closeWad, close: closeWad, volume: 0n};
}

describe("seriesPath", () => {
  it("memetakan 0% ke dasar plot dan 100% ke puncaknya", () => {
    const cs = [candle(0, 0n), candle(100, WAD)];
    const d = seriesPath(cs, BOX, {minT: 0, maxT: 100}, (c) => c.close);
    // y untuk 0% = height - padBottom = 276 ; y untuk 100% = padTop = 8
    expect(d).toBe("M40,276L592,8");
  });

  it("mengembalikan string kosong untuk data kosong", () => {
    expect(seriesPath([], BOX, {minT: 0, maxT: 1}, (c) => c.close)).toBe("");
  });

  it("menempatkan satu titik tunggal, bukan garis rusak", () => {
    const d = seriesPath([candle(5, WAD / 2n)], BOX, {minT: 5, maxT: 5}, (c) => c.close);
    expect(d.startsWith("M")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("tidak pernah menghasilkan NaN saat rentang waktu nol", () => {
    const cs = [candle(7, 0n), candle(7, WAD)];
    const d = seriesPath(cs, BOX, {minT: 7, maxT: 7}, (c) => c.close);
    expect(d).not.toContain("NaN");
  });
});

describe("yTicks", () => {
  it("selalu 0%..100%, tidak mengikuti data", () => {
    expect(yTicks(BOX).map((t) => t.label)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
  });
});

describe("xTicks", () => {
  it("mengembalikan kosong untuk data kosong", () => {
    expect(xTicks([], BOX, {minT: 0, maxT: 1}, 4)).toEqual([]);
  });

  it("tidak pernah melebihi jumlah yang diminta", () => {
    const cs = Array.from({length: 50}, (_, i) => candle(i * 60, WAD / 2n));
    expect(xTicks(cs, BOX, {minT: 0, maxT: 2940}, 4).length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- chart`
Expected: FAIL — modul `@/lib/chart` tidak ada.

- [ ] **Step 3: Implementasikan `lib/chart.ts`**

```ts
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
/** Presisi konversi wad→number untuk koordinat. Cukup untuk 600px. */
const COORD_SCALE = 10_000n;

export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Extent {
  minT: number;
  maxT: number;
}

const plotLeft = (b: Box) => b.padLeft;
const plotRight = (b: Box) => b.width - b.padRight;
const plotTop = (b: Box) => b.padTop;
const plotBottom = (b: Box) => b.height - b.padBottom;

/**
 * Satu-satunya tempat nilai wad menyeberang ke `number` di seluruh frontend,
 * dan hanya untuk koordinat piksel — tidak pernah untuk angka yang dibaca
 * pengguna. Konversi lewat bigint dulu supaya pembagiannya tidak kehilangan
 * presisi sebelum diskalakan.
 */
function wadToUnit(v: bigint): number {
  const clamped = v < 0n ? 0n : v > WAD ? WAD : v;
  return Number((clamped * COORD_SCALE) / WAD) / Number(COORD_SCALE);
}

export function seriesPath(
  candles: Candle[],
  box: Box,
  extent: Extent,
  pick: (c: Candle) => bigint,
): string {
  if (candles.length === 0) return "";
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const h = plotBottom(box) - plotTop(box);
  return candles
    .map((c, i) => {
      // Rentang waktu nol terjadi pada satu bucket; sebarkan merata alih-alih
      // membagi dengan nol, yang akan menghasilkan NaN di atribut `d`.
      const tx = span === 0
        ? (candles.length === 1 ? 0 : i / (candles.length - 1))
        : (c.bucketStart - extent.minT) / span;
      const x = plotLeft(box) + tx * w;
      const y = plotBottom(box) - wadToUnit(pick(c)) * h;
      return `${i === 0 ? "M" : "L"}${round(x)},${round(y)}`;
    })
    .join("");
}

const round = (n: number) => Math.round(n * 100) / 100;

export function yTicks(box: Box): {y: number; label: string}[] {
  const h = plotBottom(box) - plotTop(box);
  return [0, 25, 50, 75, 100].map((pct) => ({
    y: round(plotBottom(box) - (pct / 100) * h),
    label: `${pct}%`,
  }));
}

export function xTicks(
  candles: Candle[],
  box: Box,
  extent: Extent,
  count: number,
): {x: number; label: string}[] {
  if (candles.length === 0 || count <= 0) return [];
  const span = extent.maxT - extent.minT;
  const w = plotRight(box) - plotLeft(box);
  const step = Math.max(1, Math.floor(candles.length / count));
  const out: {x: number; label: string}[] = [];
  for (let i = 0; i < candles.length && out.length < count; i += step) {
    const c = candles[i]!;
    const tx = span === 0 ? 0 : (c.bucketStart - extent.minT) / span;
    out.push({
      x: round(plotLeft(box) + tx * w),
      label: new Date(c.bucketStart * 1000).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      }),
    });
  }
  return out;
}
```

- [ ] **Step 4: Jalankan uji, pastikan lulus**

Run: `npm test -w @0g-delphi/frontend -- chart`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chart.ts frontend/test/chart.test.ts
git commit -m "feat(frontend): geometri grafik probabilitas sebagai aritmetika murni"
```

---

### Task 3: `ProbabilityChart` — dua seri, sumbu tetap 0–100%

**Files:**
- Create: `frontend/src/components/market/ProbabilityChart.tsx`
- Create: `frontend/src/hooks/useCandles.ts`
- Test: `frontend/test/probability-chart.test.tsx`

**Interfaces:**
- Consumes: `seriesPath`, `yTicks`, `xTicks`, `Box` (Task 2); `Candle`, `Query<T>` (Task 1); `toQuery`, `useDataSource` (F0)
- Produces:
  - `function useCandles(address, interval): Query<Candle[]>`
  - `<ProbabilityChart candles={Candle[]} />`

`Candle.close` menyimpan **probabilitas YES dalam wad** (bukan harga marginal). Seri NO adalah `WAD − close`, dijamin berjumlah 100% menurut spec §5.1.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `frontend/test/probability-chart.test.tsx`:

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const cs: Candle[] = [
  {bucketStart: 0, open: WAD / 2n, high: WAD / 2n, low: WAD / 2n, close: WAD / 2n, volume: 0n},
  {bucketStart: 3600, open: (WAD * 59n) / 100n, high: (WAD * 59n) / 100n,
   low: (WAD * 59n) / 100n, close: (WAD * 59n) / 100n, volume: 0n},
];

describe("ProbabilityChart", () => {
  it("menggambar dua seri", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    expect(container.querySelectorAll("path[data-series]").length).toBe(2);
  });

  it("sumbu Y berlabel 0% sampai 100%, bukan rentang data", () => {
    render(<ProbabilityChart candles={cs} />);
    for (const label of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("seri NO adalah komplemen seri YES", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    const yes = container.querySelector('path[data-series="yes"]')!.getAttribute("d")!;
    const no = container.querySelector('path[data-series="no"]')!.getAttribute("d")!;
    expect(yes).not.toBe(no);
    expect(yes).not.toContain("NaN");
    expect(no).not.toContain("NaN");
  });

  it("menyebut sumbu sebagai probabilitas, bukan harga", () => {
    render(<ProbabilityChart candles={cs} />);
    expect(screen.getByText(/P\(YES\)/)).toBeInTheDocument();
  });

  it("data kosong merender pesan, bukan sumbu telanjang", () => {
    render(<ProbabilityChart candles={[]} />);
    expect(screen.getByText(/belum ada riwayat/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- probability-chart`
Expected: FAIL — komponen belum ada.

- [ ] **Step 3: Implementasikan `useCandles.ts`**

```ts
"use client";
import {useQuery} from "@tanstack/react-query";
import {useDataSource} from "@/hooks/provider";
import {toQuery} from "@/hooks/toQuery";
import type {Candle, Interval, Query} from "@/lib/data/types";

export function useCandles(address: `0x${string}`, interval: Interval): Query<Candle[]> {
  const src = useDataSource();
  return toQuery(
    useQuery({
      queryKey: ["candles", src.mode, address, interval],
      queryFn: () => src.getCandles(address, interval),
    }),
    src.mode,
  );
}
```

- [ ] **Step 4: Implementasikan `ProbabilityChart.tsx`**

```tsx
import {seriesPath, xTicks, yTicks, type Box} from "@/lib/chart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const BOX: Box = {width: 600, height: 300, padLeft: 40, padRight: 8, padTop: 8, padBottom: 24};

export function ProbabilityChart({candles}: {candles: Candle[]}) {
  if (candles.length === 0) {
    return (
      <div className="rounded-lg border border-border px-4 py-8 text-center text-[13px] text-text-muted">
        Belum ada riwayat untuk market ini.
      </div>
    );
  }

  const extent = {
    minT: candles[0]!.bucketStart,
    maxT: candles[candles.length - 1]!.bucketStart,
  };
  const yes = seriesPath(candles, BOX, extent, (c) => c.close);
  const no = seriesPath(candles, BOX, extent, (c) => WAD - c.close);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-[12px] uppercase tracking-wide text-text-muted">
        Riwayat P(YES)
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          className="w-full"
          role="img"
          aria-label="Grafik riwayat probabilitas"
        >
          {yTicks(BOX).map((t) => (
            <g key={t.label}>
              <line x1={BOX.padLeft} x2={BOX.width - BOX.padRight} y1={t.y} y2={t.y}
                    className="stroke-border" strokeWidth={1} />
              <text x={0} y={t.y + 4} className="fill-text-faint text-[10px]">{t.label}</text>
            </g>
          ))}
          {xTicks(candles, BOX, extent, 5).map((t) => (
            <text key={t.x} x={t.x} y={BOX.height - 6}
                  textAnchor="middle" className="fill-text-faint text-[10px]">
              {t.label}
            </text>
          ))}
          <path data-series="no" d={no} fill="none" className="stroke-neg" strokeWidth={1.5} />
          <path data-series="yes" d={yes} fill="none" className="stroke-pos" strokeWidth={1.5} />
        </svg>
      </div>
      <div className="mt-1 flex gap-4 text-[11px] text-text-muted">
        <span className="text-pos">● YES</span>
        <span className="text-neg">● NO</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Jalankan uji, pastikan lulus**

Run: `npm test -w @0g-delphi/frontend -- probability-chart`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/ProbabilityChart.tsx frontend/src/hooks/useCandles.ts frontend/test/probability-chart.test.tsx
git commit -m "feat(frontend): grafik riwayat probabilitas dengan sumbu tetap 0-100%"
```

---

### Task 4: `MarketStats` — ketersediaan per baris

**Files:**
- Create: `frontend/src/components/market/MarketStats.tsx`
- Modify: `frontend/src/lib/format.ts` (tambah `formatTimestamp`)
- Test: `frontend/test/market-stats.test.tsx`

**Interfaces:**
- Consumes: `MarketDetail`, `Trade`, `Query<T>` (Task 1); `formatCollateral`, `formatFeeRate` (F0)
- Produces:
  - `function formatTimestamp(unixSeconds: number): string`
  - `<MarketStats market={MarketDetail} trades={Query<Trade[]>} />`

Volume dihitung dari `trades`; bila `trades` tidak tersedia, **baris volume saja** yang merender `<Unavailable>` — enam baris lainnya tetap terisi. Itu penerapan langsung aturan per-baris di spec §2.

- [ ] **Step 1: Tulis uji yang gagal**

Buat `frontend/test/market-stats.test.tsx`:

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {MarketStats} from "@/components/market/MarketStats";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {Trade} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const trades: Trade[] = [
  {id: "1", timestamp: 1, trader: "0x1111111111111111111111111111111111111111",
   outcome: 1, sharesDelta: 10n ** 18n, tokens: 500_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
  {id: "2", timestamp: 2, trader: "0x2222222222222222222222222222222222222222",
   outcome: 0, sharesDelta: -(10n ** 18n), tokens: 300_000n, fee: 0n, probAfterWad: 10n ** 18n / 2n},
];

describe("MarketStats", () => {
  it("menjumlahkan volume dari nilai absolut token, beli maupun jual", () => {
    render(<MarketStats market={m} trades={{status: "ready", data: trades}} />);
    expect(screen.getByTestId("stat-volume")).toHaveTextContent("0.80");
  });

  it("hanya baris volume yang unavailable; baris lain tetap terisi", () => {
    render(
      <MarketStats market={m} trades={{status: "unavailable", capability: "TRADE_TAPE", mode: "chain"}} />,
    );
    expect(screen.getByTestId("stat-volume")).toHaveTextContent(/tidak tersedia/i);
    expect(screen.getByTestId("stat-fee")).not.toHaveTextContent(/tidak tersedia/i);
    expect(screen.getByTestId("stat-liquidity")).not.toHaveTextContent(/tidak tersedia/i);
  });

  it("menampilkan garis waktu siklus hidup lengkap", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    for (const id of ["stat-created", "stat-closes", "stat-settles-by"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("menampilkan tarif fee, bukan hanya nominalnya", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    expect(screen.getByTestId("stat-fee")).toHaveTextContent("%");
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- market-stats`
Expected: FAIL — komponen belum ada.

- [ ] **Step 3: Tambahkan `formatTimestamp` ke `format.ts`**

```ts
/** Waktu absolut, zona lokal pembaca. Dipakai untuk garis waktu siklus hidup. */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

- [ ] **Step 4: Implementasikan `MarketStats.tsx`**

Susun sebagai daftar baris `<Row>` lokal. Volume:

```tsx
function volumeRow(trades: Query<Trade[]>, m: MarketDetail) {
  switch (trades.status) {
    case "ready": {
      // Jual juga volume. Menjumlahkan nilai bertanda akan membuat market
      // yang ramai terlihat sepi karena beli dan jual saling meniadakan.
      const total = trades.data.reduce((a, t) => a + (t.tokens < 0n ? -t.tokens : t.tokens), 0n);
      return <span>{formatCollateral(total, m.collateral.decimals)}</span>;
    }
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} />;
    case "error":
      return <span className="text-neg">Gagal memuat</span>;
    case "loading":
      return <span className="text-text-muted">Memuat…</span>;
  }
}
```

Perhatikan anotasi tipe kembalian pada `volumeRow` — beri `: React.JSX.Element`, sesuai pelajaran di Global Constraints.

Baris lain: Fee (`formatFeeRate(m.feeBps)`), Likuiditas (`formatCollateral(poolWad→token)`), Dibuat, Tutup, Batas settle. Setiap baris punya `data-testid="stat-…"`.

- [ ] **Step 5: Jalankan uji, pastikan lulus**

Run: `npm test -w @0g-delphi/frontend -- market-stats`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/MarketStats.tsx frontend/src/lib/format.ts frontend/test/market-stats.test.tsx
git commit -m "feat(frontend): panel statistik market dengan ketersediaan per baris"
```

---

### Task 5: `PositionsTable` — siapa memegang apa, pada harga berapa

**Files:**
- Create: `frontend/src/components/market/PositionsTable.tsx`
- Create: `frontend/src/hooks/usePositions.ts`
- Test: `frontend/test/positions-table.test.tsx`

**Interfaces:**
- Consumes: `Position`, `MarketDetail`, `Query<T>` (Task 1); `probabilityWad`, `payoutPerShareWad` (F0 `dpm-view`); `formatShares`, `formatPricePerShare` (F0)
- Produces:
  - `function usePositions(address): Query<Position[]>`
  - `<PositionsTable positions={Position[]} market={MarketDetail} mode={DataMode} />`

Kolom: Agent · Sisi · Lembar · Harga masuk · Harga sekarang. **Harga sekarang adalah `dpm.price`, bukan probabilitas** — ia harga per lembar dalam satuan collateral, sebanding langsung dengan harga masuk. Memberi label persen padanya melanggar Global Constraints.

Kolom **Harga masuk** adalah satu-satunya yang bisa tidak diketahui: `entryPriceWad === null` berarti mode ini tidak menyimpan apa yang dibayar. Sel itu merender `<Unavailable capability="COST_BASIS" mode={mode} />` sementara empat kolom lain tetap terisi — penerapan aturan per-baris spec §2 di tingkat sel. Karena itu komponen menerima prop `mode`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
import {describe, expect, it} from "vitest";
import {render, screen, within} from "@testing-library/react";
import {PositionsTable} from "@/components/market/PositionsTable";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {Position} from "@/lib/data/types";

const WAD = 10n ** 18n;
const m = FIXTURE_MARKETS[0]!;
const positions: Position[] = [
  {agent: "0xAAaAaAAaAAaAaaAaaAAAAaAaAaaAAAAAaAaAaAaA", outcome: 1,
   shares: 100n * WAD, entryPriceWad: (WAD * 70n) / 100n},
  {agent: "0xBbBBBbbBbBbbbBBbBbbbbbBBbBbbbBBbBBbBBBbB", outcome: 0,
   shares: 40n * WAD, entryPriceWad: (WAD * 55n) / 100n},
];

describe("PositionsTable", () => {
  it("merender satu baris per posisi dengan sisinya", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // kepala + 2
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
  });

  it("harga masuk dan harga sekarang keduanya per lembar, tanpa label persen", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("%");
    expect(within(row).getByTestId("current")).not.toHaveTextContent("%");
  });

  it("daftar kosong menjelaskan, bukan tabel telanjang", () => {
    render(<PositionsTable positions={[]} market={m} mode="mock" />);
    expect(screen.getByText(/belum ada posisi/i)).toBeInTheDocument();
  });

  it("harga masuk null merender penjelasan, bukan nol; kolom lain tetap terisi", () => {
    const unknown = positions.map((p) => ({...p, entryPriceWad: null}));
    render(<PositionsTable positions={unknown} market={m} mode="chain" />);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByTestId("entry")).toHaveTextContent(/tidak tersedia/i);
    expect(within(row).getByTestId("entry")).not.toHaveTextContent("0.0000");
    expect(within(row).getByTestId("current")).not.toHaveTextContent(/tidak tersedia/i);
  });

  it("memendekkan alamat agent", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.queryByText(positions[0]!.agent)).not.toBeInTheDocument();
    expect(screen.getByText(/0xAAaA…AaAa/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- positions-table`

- [ ] **Step 3: Implementasikan `usePositions.ts`**

Sama pola dengan `useCandles`, dengan `queryKey: ["positions", src.mode, address]`.

- [ ] **Step 4: Implementasikan `PositionsTable.tsx`**

Harga sekarang untuk sisi `p.outcome`: `dpm.price(market.q, p.outcome)`, diformat dengan `formatPricePerShare`. Pemendekan alamat memakai helper yang sama dengan `CopyAddress` — bila belum diekspor, ekspor dari sana alih-alih menulis ulang.

- [ ] **Step 5: Jalankan uji, pastikan lulus**

Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/market/PositionsTable.tsx frontend/src/hooks/usePositions.ts frontend/test/positions-table.test.tsx
git commit -m "feat(frontend): tabel posisi agent dengan harga masuk dan harga sekarang"
```

---

### Task 6: `FinalOutcome` + `ResolutionEvidence` — bukti yang bisa diperiksa

**Files:**
- Create: `frontend/src/components/settlement/FinalOutcome.tsx`
- Create: `frontend/src/components/settlement/ResolutionEvidence.tsx`
- Create: `frontend/src/hooks/useReceipt.ts`
- Test: `frontend/test/settlement.test.tsx`

**Interfaces:**
- Consumes: `SettlementReceipt`, `ResolverVote`, `MarketDetail` (Task 1); `payoutPerShareWad` (F0)
- Produces:
  - `function useReceipt(address): Query<SettlementReceipt>`
  - `<FinalOutcome receipt={SettlementReceipt} market={MarketDetail} />`
  - `<ResolutionEvidence receipt={SettlementReceipt} />`

Dua aturan yang tidak boleh dilanggar:

1. **Alasan resolver ditampilkan verbatim.** Tidak diringkas, tidak dipotong di tengah kalimat. Meringkasnya berarti UI ikut menilai, dan pembaca kehilangan justru bagian yang ingin ia periksa. Boleh dilipat (`<details>`), tidak boleh dipangkas.
2. **`simulated: true` wajib mencolok.** Hasil tersimulasi tidak boleh pernah tertukar dengan yang sungguhan.

Kurs payout memakai `payoutPerShareWad` (`1/pᵢ`), **bukan** `1/Pᵢ`.

- [ ] **Step 1: Tulis uji yang gagal**

```tsx
import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import type {SettlementReceipt} from "@/lib/data/types";

const m = FIXTURE_MARKETS[0]!;
const receipt: SettlementReceipt = {
  outcome: 1,
  votes: [
    {model: "claude-opus-5", outcome: 1, teeVerified: true, simulated: true},
    {model: "gpt-5.5", outcome: 1, teeVerified: true, simulated: true},
    {model: "qwen3-32b", outcome: 0, teeVerified: false, simulated: true},
  ],
  judgeModel: "claude-opus-5",
  reasoning: "Dua dari tiga resolver menyimpulkan YES.",
  criteria: "YES bila harga penutupan di atas $4.000.",
  sources: ["https://example.org/data"],
  provider: "0x0000000000000000000000000000000000000000",
  chatId: "stub-0001",
  simulated: true,
};

describe("FinalOutcome", () => {
  it("menyebut pemenang dan kurs payout-nya", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    expect(screen.getByTestId("winner")).toHaveTextContent("YES");
    expect(screen.getByTestId("payout")).toHaveTextContent("×");
  });

  it("kurs payout memakai 1/p, bukan 1/P", () => {
    render(<FinalOutcome receipt={receipt} market={m} />);
    // q fixture memberi P(YES)=59,0% -> p=0,7681 -> 1/p = 1,30x. 1/P akan 1,69x.
    expect(screen.getByTestId("payout")).toHaveTextContent("1.30×");
    expect(screen.getByTestId("payout")).not.toHaveTextContent("1.69×");
  });
});

describe("ResolutionEvidence", () => {
  it("menampilkan setiap model resolver dan suaranya", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    for (const v of receipt.votes) expect(screen.getByText(v.model)).toBeInTheDocument();
  });

  it("menampilkan alasan verbatim, tanpa dipangkas", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("reasoning")).toHaveTextContent(receipt.reasoning);
  });

  it("menampilkan kriteria resolusi dan sumber data", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("criteria")).toHaveTextContent(receipt.criteria);
    expect(screen.getByText(receipt.sources[0]!)).toBeInTheDocument();
  });

  it("menandai hasil tersimulasi secara mencolok", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("simulated-badge")).toHaveTextContent(/simulasi/i);
  });

  it("tidak menandai simulasi saat receipt sungguhan", () => {
    render(<ResolutionEvidence receipt={{...receipt, simulated: false}} />);
    expect(screen.queryByTestId("simulated-badge")).not.toBeInTheDocument();
  });

  it("menandai resolver yang suaranya berbeda dari outcome final", () => {
    render(<ResolutionEvidence receipt={receipt} />);
    expect(screen.getByTestId("vote-qwen3-32b")).toHaveTextContent(/NO/);
  });
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- settlement`

- [ ] **Step 3: Implementasikan `useReceipt.ts`, `FinalOutcome.tsx`, `ResolutionEvidence.tsx`**

`ResolutionEvidence` menampilkan suara tiap resolver berikut sisinya, sehingga pembaca melihat komite itu **tidak bulat** ketika memang tidak bulat. Menyembunyikan suara minoritas membuat konsensus terlihat lebih kuat daripada kenyataannya, dan itu jenis kebohongan yang sama dengan merender nol untuk data yang tak diketahui.

- [ ] **Step 4: Jalankan uji, pastikan lulus**

Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settlement frontend/src/hooks/useReceipt.ts frontend/test/settlement.test.tsx
git commit -m "feat(frontend): panel outcome final dan bukti resolusi yang bisa diperiksa"
```

---

### Task 7: Rakit ulang `MarketView` — halaman pemeriksaan

**Files:**
- Modify: `frontend/src/app/market/[address]/MarketView.tsx`
- Delete: `frontend/src/components/market/OrderTicket.tsx`
- Delete: `frontend/src/hooks/useQuote.ts` → **pindahkan**, jangan hapus (lihat Step 3)
- Delete: `frontend/test/order-ticket.test.tsx`
- Create: `packages/protocol/src/quote.ts`
- Test: `frontend/test/market-page.test.tsx` (perbarui)

- [ ] **Step 1: Perbarui uji halaman**

Uji lama menegaskan tiket order ada. Ganti dengan yang menegaskan ia **tidak** ada, dan panel baru ada:

```tsx
it("tidak ada kontrol eksekusi di halaman manusia", async () => {
  renderMarket();
  expect(await screen.findByTestId("probability-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("order-ticket")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name: /beli|jual|approve|setujui/i})).not.toBeInTheDocument();
});

it("merender panel pemeriksaan", async () => {
  renderMarket();
  for (const id of ["probability-panel", "payout-panel", "probability-chart",
                    "market-stats", "positions-table", "trade-tape"]) {
    expect(await screen.findByTestId(id)).toBeInTheDocument();
  }
});

it("menjelaskan kapabilitas yang absen, bukan merender tabel kosong", async () => {
  renderMarket(new MockSource({omit: ["AGENT_POSITIONS"]}));
  expect(await screen.findByText(/posisi agent.*tidak tersedia/i)).toBeInTheDocument();
  expect(screen.queryByTestId("positions-table")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `npm test -w @0g-delphi/frontend -- market-page`

- [ ] **Step 3: Pindahkan mesin kuotasi, jangan buang**

Matematika di `useQuote` adalah implementasi rujukan untuk `agent-kit` (spec §6). Pindahkan fungsi murninya ke `packages/protocol/src/quote.ts` — inversi fee dengan penyebut `10_000n + bps`, `qAfterBuy`, dan transisi probabilitas/payout — lengkap dengan ujinya. Baru setelah itu hapus hook dan komponennya dari frontend.

**Peringatan lingkup:** `packages/protocol` adalah cermin DPM yang dipaku ke Solidity oleh uji diferensial 512 vektor. Menambah modul baru boleh; mengubah `dpm.ts`, `units.ts`, atau konvensi impor paket itu **tidak** termasuk tugas ini.

- [ ] **Step 4: Rakit ulang `MarketView`**

Kolom kiri: kepala → panel probabilitas → panel payout → grafik → tabel posisi → tape.

**Tidak ada `SpecViewer` di F1, dan itu disengaja.** Spec §4.2 menyebutnya, tetapi isinya berasal dari 0G Storage lewat `specRoot` (`MARKET_SPEC_BLOB`) yang integrasinya belum ada. Membuat kemampuan yang tak dipakai apa pun adalah persis beban mati yang baru saja dibuang bersama `QUOTE`/`EXECUTE`. Aturan resolusi tetap terlihat pembaca lewat baris **Kriteria resolusi** di `ResolutionEvidence`, yang bersumber dari receipt, bukan dari blob.
Kolom kanan: `MarketStats`; ditambah `FinalOutcome` dan `ResolutionEvidence` bila `market.status === "Settled"`.

Setiap `Query<T>` dibongkar lewat fungsi `switch` beranotasi tipe kembalian eksplisit tanpa `default` — pola yang sama dengan `renderTrades` yang sudah ada.

- [ ] **Step 5: Jalankan seluruh uji dan build**

```bash
npm test -w @0g-delphi/frontend && npm test -w @0g-delphi/protocol
npx tsc --noEmit -p frontend && npm run build -w @0g-delphi/frontend
```
Expected: semua hijau; build sukses.

- [ ] **Step 6: Verifikasi di server produksi**

Jalankan `next start` pada port yang **sudah diverifikasi kosong**, dan pastikan proses yang menjawab memang milikmu sebelum mempercayai hasilnya — satu tugas di rencana sebelumnya mendapat 200 palsu dari proses asing yang kebetulan memegang portnya. Lalu `curl` halaman market dan pastikan **tidak ada** tombol beli/jual di HTML-nya.

- [ ] **Step 7: Commit**

```bash
git add frontend packages/protocol/src/quote.ts packages/protocol/test
git commit -m "feat(frontend): halaman market jadi halaman pemeriksaan; tiket order dikeluarkan"
```

---

## Fase berikutnya

F1 selesai bila halaman detail market setara referensi Delphi, seluruhnya dari `MockSource`. Berikutnya F2 (`ChainSource` + daftar market) menuntut Task 17 kontrak, yang sudah selesai; F5 (`@0g-delphi/agent-kit`) memakai `packages/protocol/src/quote.ts` yang dipindahkan di Task 7 sebagai implementasi rujukannya.
