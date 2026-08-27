# Frontend F0 + Halaman Market (mode mock) — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev -w frontend` menyala dan `/market/0x…` merender halaman detail market yang lengkap dan bisa diklik — panel probabilitas, panel payout berjalan, tiket order, tape trade — seluruhnya dari fixture, tanpa perlu anvil maupun market yang ter-deploy.

**Architecture:** Aplikasi Next.js 16 (App Router) sebagai workspace npm ketiga. Seluruh data mengalir lewat satu antarmuka `DataSource`; F0 hanya mengimplementasikan `MockSource`, dan komponen tidak pernah tahu mode mana yang aktif. Matematika probabilitas dan payout diambil dari `@0g-delphi/protocol` — cermin TypeScript yang sudah disematkan ke `DPMMath.sol` lewat uji diferensial 512 vektor — sehingga angka di layar berasal dari sumber yang sama dengan angka di rantai.

**Tech Stack:** Next.js 16.3.3 (App Router) · React 19.2.8 · TypeScript ^5 · Tailwind CSS v4 (CSS-first, `@theme inline`) · TanStack Query 5 · Vitest 4 + Testing Library · `@0g-delphi/protocol` (workspace)

**Spec:** `docs/superpowers/specs/2026-08-27-0g-delphi-frontend-design.md`

---

## Global Constraints

- **Next.js 16.3.3**, React **19.2.8**, TypeScript **^5** — versi yang benar-benar dihasilkan `create-next-app@16.3.3`, diverifikasi dengan scaffold nyata. Spec induk menyebut "Next.js 15"; itu sudah tertinggal satu mayor dan digantikan (lihat Ruling di §Penyimpangan).
- **Tailwind v4 tidak memakai `tailwind.config.js`.** Token tema didefinisikan di CSS lewat `@theme inline`, dan mode gelap lewat `@custom-variant`. Jangan membuat berkas konfigurasi JS Tailwind.
- **Probabilitas adalah `pᵢ²`.** Setiap nilai berlabel `%` berasal dari `dpm.probability`. Tidak boleh ada `dpm.price` yang diberi label persen.
- **Payout per lembar adalah `1/pᵢ`, bukan `1/Pᵢ`.** Setiap nilai berlabel `×` berasal dari `1/dpm.price`. **Tidak boleh ada `1/probability` di mana pun di basis kode.**
- **Konversi desimal mengimpor `@0g-delphi/protocol`** (`WAD`, `scaleFor`, `toWad`, `toTokensFloor`, `toTokensCeil`). Frontend tidak boleh punya konstanta `1e12` atau `1e18` sendiri di luar `lib/format.ts`.
- **Seluruh angka disimpan sebagai `bigint`.** Tidak ada `Number()` pada nilai moneter, tidak ada `parseFloat` pada nilai wad. Pemformatan bekerja dari `bigint` ke string secara langsung.
- **`unavailable` adalah anggota union `Query<T>`.** Komponen yang tidak menanganinya tidak boleh mengompilasi. Jangan pernah merender `0` atau `—` untuk data yang mode saat ini tidak bisa ketahui.
- Semua uji hijau sebelum commit; `npx tsc --noEmit` bersih; Conventional Commits; satu commit per tugas.

### Penyimpangan dari spec, disengaja

| Spec | Rencana | Alasan |
|---|---|---|
| §3 "Next.js 15 (App Router)" | **Next.js 16.3.3** | Next 15 bukan lagi mayor terkini. Memulai proyek baru pada mayor yang sudah tertinggal berarti berhutang migrasi sejak hari pertama. Diverifikasi lewat scaffold nyata. |
| §3 "Tailwind" (implisit v3, dengan berkas config) | **Tailwind v4**, CSS-first | v4 adalah yang dipasang `create-next-app` dan tidak lagi memakai `tailwind.config.js`. Token tema pindah ke `@theme inline` di `globals.css`. |
| §3 "Radix untuk dialog/select/tooltip" | **tidak ada di F0** | F0 + halaman market tidak butuh satu pun dari ketiganya. YAGNI; ditambahkan saat ada yang benar-benar membutuhkannya. |

---

## Struktur Berkas

```
frontend/
├─ package.json                    workspace ketiga: @0g-delphi/frontend
├─ next.config.ts                  transpilePackages untuk paket workspace TS
├─ postcss.config.mjs              @tailwindcss/postcss
├─ tsconfig.json                   alias @/*
├─ vitest.config.ts                jsdom + plugin react
├─ vitest.setup.ts                 jest-dom matchers
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                shell + QueryProvider + kelas tema
│  │  ├─ globals.css               token warna, @theme inline, @custom-variant dark
│  │  ├─ page.tsx                  placeholder yang menautkan ke market fixture
│  │  └─ market/[address]/page.tsx halaman detail
│  ├─ lib/
│  │  ├─ format.ts                 SELURUH aturan format angka, satu tempat
│  │  ├─ dpm-view.ts               turunan tampilan: probabilitas, payout per lembar
│  │  └─ data/
│  │     ├─ types.ts               Capability, Query, DataSource, model domain
│  │     ├─ mock.ts                MockSource + fixture
│  │     └─ index.ts               pemilih mode dari env
│  ├─ hooks/
│  │  ├─ provider.tsx              DataSourceProvider + QueryClientProvider
│  │  ├─ useMarket.ts              Query<MarketDetail>
│  │  ├─ useTrades.ts              Query<Trade[]>
│  │  └─ useQuote.ts               kuotasi lokal langsung, tanpa RPC
│  └─ components/
│     ├─ primitives/               Unavailable, Badge, CopyAddress, Countdown, Stat
│     └─ market/                   ProbabilityPanel, PayoutPanel, OrderTicket, TradeTape
└─ test/                           uji vitest, dicerminkan dari struktur src
```

`lib/format.ts` adalah satu-satunya tempat aturan pemformatan hidup. Komponen tidak boleh memformat angka sendiri — perbedaan format antar layar adalah cara tercepat sebuah UI angka kehilangan kredibilitas.

---

## Task 1: Workspace Next.js dan integrasi monorepo

**Files:**
- Create: seluruh `frontend/` lewat `create-next-app`, lalu `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/test/smoke.test.ts`
- Modify: `package.json` (akar), `frontend/package.json`, `frontend/next.config.ts`, `.github/workflows/ci.yml`, `Makefile`

**Interfaces:**
- Consumes: `@0g-delphi/protocol` (`WAD`, `toWad`, `toTokensFloor`, `toTokensCeil`, `dpm`)
- Produces: workspace `@0g-delphi/frontend` dengan `dev`/`build`/`test`/`typecheck`; impor lintas-workspace yang terbukti bekerja

- [ ] **Step 1: Scaffold aplikasi**

Dari akar repo:

```bash
npx --yes create-next-app@16.3.3 frontend \
  --ts --tailwind --eslint --app --src-dir --import-alias "@/*" \
  --use-npm --no-turbopack --yes
```

Ini menghasilkan Next 16.3.3, React 19.2.8, Tailwind v4 lewat `@tailwindcss/postcss`, dan **tidak ada** `tailwind.config.js` — itu benar untuk v4, jangan menambahkannya.

Hapus berkas contoh yang tidak dipakai:

```bash
rm -f frontend/public/*.svg frontend/README.md frontend/AGENTS.md frontend/CLAUDE.md
rm -rf frontend/.git
```

`create-next-app` menginisialisasi repo git sendiri di dalam `frontend/`; itu harus dibuang atau ia menjadi submodule tak sengaja.

- [ ] **Step 2: Daftarkan sebagai workspace**

Di `package.json` akar, ubah:

```json
  "workspaces": ["packages/*"],
```

menjadi:

```json
  "workspaces": ["packages/*", "frontend"],
```

- [ ] **Step 3: Namai paket dan tambahkan skrip**

Di `frontend/package.json`, ubah `"name"` menjadi `"@0g-delphi/frontend"` dan ganti blok `"scripts"` menjadi:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

Tambahkan `@0g-delphi/protocol` ke `"dependencies"`:

```json
    "@0g-delphi/protocol": "*",
```

dan tambahkan ke `"devDependencies"`:

```json
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.2",
    "@vitejs/plugin-react": "^6.1.0",
    "jsdom": "^30.0.1",
    "vitest": "^4.1.11",
```

- [ ] **Step 4: Ajarkan Next mentranspilasi paket workspace**

`@0g-delphi/protocol` menerbitkan TypeScript mentah (`"main": "./src/index.ts"`), jadi Next harus mentranspilasinya. Ubah `frontend/next.config.ts` menjadi:

```ts
import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  // @0g-delphi/protocol mengekspor .ts mentah, bukan JS terkompilasi.
  // Tanpa ini, build gagal saat mengimpor cermin DPM.
  transpilePackages: ["@0g-delphi/protocol"],
};

export default nextConfig;
```

- [ ] **Step 5: Konfigurasi Vitest**

`frontend/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import {resolve} from "node:path";
import {defineConfig} from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {"@": resolve(__dirname, "./src")},
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
```

`frontend/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Tulis uji asap yang membuktikan impor lintas-workspace bekerja**

Ini bukan uji formalitas. Ia membuktikan hal yang paling mungkin gagal di penyiapan monorepo: apakah frontend benar-benar bisa memanggil cermin DPM.

`frontend/test/smoke.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";

describe("integrasi workspace", () => {
  it("mengimpor WAD dari @0g-delphi/protocol", () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it("cermin DPM menghitung probabilitas 3-4-5 yang benar", () => {
    // P_i = q_i^2 / (q_0^2 + q_1^2); untuk (3,4): 9/25 dan 16/25
    expect(dpm.probability([3n * WAD, 4n * WAD], 0)).toBe(360_000_000_000_000_000n);
    expect(dpm.probability([3n * WAD, 4n * WAD], 1)).toBe(640_000_000_000_000_000n);
  });

  it("harga marginal BUKAN probabilitas — keduanya berbeda", () => {
    const q: readonly [bigint, bigint] = [3n * WAD, 4n * WAD];
    expect(dpm.price(q, 1)).toBe(800_000_000_000_000_000n);   // 0.8
    expect(dpm.probability(q, 1)).toBe(640_000_000_000_000_000n); // 0.64
    expect(dpm.price(q, 1)).not.toBe(dpm.probability(q, 1));
  });
});
```

- [ ] **Step 7: Pasang dan jalankan**

```bash
npm install
npm test -w @0g-delphi/frontend
npx tsc --noEmit -p frontend
```
Expected: 3 uji lulus, tsc bersih.

- [ ] **Step 8: Verifikasi server dev menyala**

```bash
cd frontend && timeout 60 npx next dev --port 3100 &
sleep 25 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/
```
Expected: `200`. Hentikan server setelahnya.

- [ ] **Step 9: Tambahkan ke CI dan Makefile**

Di `.github/workflows/ci.yml`, di dalam job `typescript`, setelah langkah `npm test --workspaces --if-present`, tambahkan:

```yaml
      - name: typecheck frontend
        run: npx tsc --noEmit -p frontend
      - name: build frontend
        run: npm run build -w @0g-delphi/frontend
```

Di `Makefile`, tambahkan target dan sertakan `fe fe-build` di baris `.PHONY`:

```makefile
fe:       ; npm run dev -w @0g-delphi/frontend
fe-build: ; npm run build -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(frontend): workspace Next.js 16 dengan impor lintas-workspace terbukti"
```

---

## Task 2: Token visual dan `lib/format.ts`

**Files:**
- Modify: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`
- Create: `frontend/src/lib/format.ts`
- Test: `frontend/test/format.test.ts`

**Interfaces:**
- Consumes: `WAD` dari `@0g-delphi/protocol`
- Produces: `formatProbability(probWad)`, `formatProbabilityDelta(fromWad, toWad)`, `formatPayout(payoutWad)`, `formatCollateral(amount, decimals)`, `formatShares(sharesWad)`, `formatPricePerShare(priceWad)`, `shortAddress(address)`, `formatCountdown(secondsRemaining)`; token CSS `--bg --bg-sunken --border --text --text-muted --text-faint --accent --pos --neg --warn --verified`

- [ ] **Step 1: Tulis uji yang gagal**

`frontend/test/format.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {
  formatCollateral, formatCountdown, formatPayout, formatPricePerShare,
  formatProbability, formatProbabilityDelta, formatShares, shortAddress,
} from "@/lib/format";

const WAD = 10n ** 18n;

describe("formatProbability", () => {
  it("memformat probabilitas wad jadi persen 1 desimal", () => {
    expect(formatProbability(590_000_000_000_000_000n)).toBe("59.0%");
    expect(formatProbability(410_000_000_000_000_000n)).toBe("41.0%");
    expect(formatProbability(WAD / 2n)).toBe("50.0%");
  });

  it("membulatkan setengah ke atas, bukan memotong", () => {
    // 0.6385 -> 63.85% -> 63.9%
    expect(formatProbability(638_500_000_000_000_000n)).toBe("63.9%");
  });

  it("menangani ekstrem", () => {
    expect(formatProbability(0n)).toBe("0.0%");
    expect(formatProbability(WAD)).toBe("100.0%");
  });
});

describe("formatProbabilityDelta", () => {
  it("selalu bertanda, dalam poin", () => {
    expect(formatProbabilityDelta(590_000_000_000_000_000n, 638_000_000_000_000_000n)).toBe("+4.8 pt");
    expect(formatProbabilityDelta(638_000_000_000_000_000n, 590_000_000_000_000_000n)).toBe("-4.8 pt");
    expect(formatProbabilityDelta(WAD / 2n, WAD / 2n)).toBe("+0.0 pt");
  });
});

describe("formatPayout", () => {
  it("2 desimal dengan tanda kali", () => {
    expect(formatPayout(1_301_700_000_000_000_000n)).toBe("1.30×");
    expect(formatPayout(1_562_000_000_000_000_000n)).toBe("1.56×");
  });
});

describe("formatCollateral", () => {
  it("menghormati desimal token dan mengelompokkan ribuan", () => {
    expect(formatCollateral(1_234_560_000n, 6)).toBe("1,234.56");
    expect(formatCollateral(100_000_000n, 6)).toBe("100.00");
    expect(formatCollateral(990_000n, 6)).toBe("0.99");
  });

  it("mengelompokkan angka besar", () => {
    expect(formatCollateral(1_234_567_890_123n, 6)).toBe("1,234,567.89");
  });
});

describe("formatShares dan formatPricePerShare", () => {
  it("lembar 2 desimal, harga 4 desimal", () => {
    expect(formatShares(126_320_000_000_000_000_000n)).toBe("126.32");
    expect(formatPricePerShare(783_800_000_000_000_000n)).toBe("0.7838");
  });
});

describe("shortAddress", () => {
  it("memotong di tengah", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("formatCountdown", () => {
  it("memilih dua satuan terbesar", () => {
    expect(formatCountdown(2 * 3600 + 14 * 60)).toBe("2j 14m");
    expect(formatCountdown(3 * 86400 + 5 * 3600)).toBe("3h 5j");
    expect(formatCountdown(45 * 60)).toBe("45m");
  });

  it("menyatakan tutup saat waktu habis", () => {
    expect(formatCountdown(0)).toBe("tutup");
    expect(formatCountdown(-10)).toBe("tutup");
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul `@/lib/format` tidak ditemukan.

- [ ] **Step 3: Implementasikan `frontend/src/lib/format.ts`**

```ts
/**
 * Satu-satunya tempat aturan pemformatan angka hidup (spec §7.2).
 * Komponen tidak boleh memformat angka sendiri: format yang berbeda antar
 * layar adalah cara tercepat sebuah UI angka kehilangan kredibilitas.
 *
 * Semua fungsi bekerja dari bigint ke string secara langsung. Tidak ada
 * Number() maupun parseFloat pada nilai moneter — presisi ganda tidak bisa
 * mewakili nilai wad, dan pembulatan diam-diam pada uang tidak dapat diterima.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Membulatkan setengah-ke-atas ke `places` desimal, murni bigint. */
function formatFixed(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const factor = 10n ** BigInt(places);
  const scaled = (magnitude * factor + scale / 2n) / scale;
  const whole = groupThousands((scaled / factor).toString());
  const body = places > 0 ? `${whole}.${(scaled % factor).toString().padStart(places, "0")}` : whole;
  return negative ? `-${body}` : body;
}

/** Probabilitas implisit (p_i^2) dalam wad → "59.0%". */
export function formatProbability(probWad: bigint): string {
  return `${formatFixed(probWad * 100n, 18, 1)}%`;
}

/** Pergeseran probabilitas dalam poin persentase, selalu bertanda. */
export function formatProbabilityDelta(fromWad: bigint, toWad: bigint): string {
  const delta = (toWad - fromWad) * 100n;
  const body = formatFixed(delta, 18, 1);
  return delta < 0n ? `${body} pt` : `+${body} pt`;
}

/** Payout per lembar (1/p_i) dalam wad → "1.30×". */
export function formatPayout(payoutWad: bigint): string {
  return `${formatFixed(payoutWad, 18, 2)}×`;
}

/** Jumlah collateral dalam satuan token terkecil → "1,234.56". */
export function formatCollateral(amount: bigint, decimals: number): string {
  return formatFixed(amount, decimals, 2);
}

/** Lembar outcome (18 desimal) → "126.32". */
export function formatShares(sharesWad: bigint): string {
  return formatFixed(sharesWad, 18, 2);
}

/** Harga per lembar dalam wad → "0.7838". Empat desimal: pada rentang 0..1 dua tidak cukup. */
export function formatPricePerShare(priceWad: bigint): string {
  return formatFixed(priceWad, 18, 4);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Dua satuan terbesar; tanpa detik — presisi detik menyiratkan ketepatan yang tak dimiliki blok. */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "tutup";
  const days = Math.floor(secondsRemaining / 86_400);
  const hours = Math.floor((secondsRemaining % 86_400) / 3_600);
  const minutes = Math.floor((secondsRemaining % 3_600) / 60);
  if (days > 0) return `${days}h ${hours}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend
```
Expected: PASS — 14 lulus (3 asap + 11 format).

- [ ] **Step 5: Tulis token visual**

Ganti seluruh isi `frontend/src/app/globals.css` dengan:

```css
@import "tailwindcss";

/* Tailwind v4 tidak punya berkas config JS. Mode gelap berbasis kelas
   dideklarasikan di sini, dan token tema diekspor lewat @theme inline. */
@custom-variant dark (&:is(.dark *));

:root {
  /* Satu tangga netral menanggung semua permukaan dan teks. */
  --n-0:#ffffff; --n-1:#fafafa; --n-2:#f4f4f5; --n-3:#e4e4e7;
  --n-4:#d4d4d8; --n-6:#a1a1aa; --n-8:#52525b; --n-10:#27272a; --n-12:#09090b;

  --bg:var(--n-0);
  --bg-sunken:var(--n-1);
  --border:var(--n-3);
  --text:var(--n-12);
  --text-muted:var(--n-8);
  --text-faint:var(--n-6);

  /* Satu aksen. Dipakai untuk aksi utama dan cincin fokus, tidak untuk dekorasi. */
  --accent:#2563eb;

  /* Semantik: sebuah elemen boleh berwarna HANYA bila warnanya membawa
     informasi yang tidak ada di tempat lain. */
  --pos:#15803d;
  --neg:#b91c1c;
  --warn:#a16207;
  --verified:#15803d;
}

.dark {
  --bg:var(--n-12);
  --bg-sunken:#050507;
  --border:#27272a;
  --text:var(--n-1);
  --text-muted:var(--n-6);
  --text-faint:var(--n-8);
  --accent:#3b82f6;
  --pos:#4ade80;
  --neg:#f87171;
  --warn:#fbbf24;
  --verified:#4ade80;
}

@theme inline {
  --color-bg:var(--bg);
  --color-bg-sunken:var(--bg-sunken);
  --color-border:var(--border);
  --color-text:var(--text);
  --color-text-muted:var(--text-muted);
  --color-text-faint:var(--text-faint);
  --color-accent:var(--accent);
  --color-pos:var(--pos);
  --color-neg:var(--neg);
  --color-warn:var(--warn);
  --color-verified:var(--verified);
}

body {
  background: var(--bg);
  color: var(--text);
  /* Angka berjajar di hampir setiap layar produk ini. Tanpa tabular-nums
     kolom bergoyang saat diperbarui dan tabel jadi sulit dipindai — ini
     persyaratan fungsional, bukan preferensi estetika. */
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 6: Sederhanakan layout**

Ganti `frontend/src/app/layout.tsx` menjadi:

```tsx
import type {Metadata} from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0G-Delphi",
  description: "Pasar prediksi biner di 0G Chain",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Verifikasi build masih bersih**

```bash
npm run build -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: build sukses, tsc bersih. Bila Tailwind mengeluh soal `@custom-variant`, periksa versi `tailwindcss` benar-benar v4 — sintaks itu tidak ada di v3.

- [ ] **Step 8: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): token visual dan pemformatan angka berbasis bigint"
```

---

## Task 3: Lapisan data — tipe, `dpm-view`, dan `MockSource`

**Files:**
- Create: `frontend/src/lib/dpm-view.ts`, `frontend/src/lib/data/types.ts`, `frontend/src/lib/data/mock.ts`, `frontend/src/lib/data/index.ts`
- Test: `frontend/test/dpm-view.test.ts`, `frontend/test/mock-source.test.ts`

**Interfaces:**
- Consumes: `WAD`, `dpm` dari `@0g-delphi/protocol`
- Produces:
  - `probabilityWad(q, outcome)`, `payoutPerShareWad(q, outcome)`, `qAfterBuy(q, outcome, shares)`
  - `type Outcome = 0 | 1`, `DataMode`, `Capability`, `CapabilityUnavailableError`, `Query<T>`, `MarketStatus`, `Tier`, `CollateralInfo`, `MarketSummary`, `MarketDetail`, `Trade`, `Candle`, `DataSource`
  - `MockSource` (menerima `{omit?: Capability[]}`), `FIXTURE_MARKETS`, `getDataSource()`

**Catatan cakupan.** Spec §3.1 mendaftar sepuluh kemampuan dan tujuh metode baca. F0 mengimplementasikan empat metode yang halaman market butuhkan — `listMarkets`, `getMarket`, `getTrades`, `getCandles`. Posisi, blob MarketSpec, dan receipt settlement ditambahkan bersama rute yang memakainya (F3/F4). Menambahkan metode sekarang berarti menulis tipe untuk bentuk data yang belum ada konsumennya.

- [ ] **Step 1: Tulis uji `dpm-view` yang gagal**

Uji ini yang menjaga jebakan `1/P` versus `1/p` dari spec §5.1.

`frontend/test/dpm-view.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {WAD, dpm} from "@0g-delphi/protocol";
import {payoutPerShareWad, probabilityWad, qAfterBuy} from "@/lib/dpm-view";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("probabilityWad", () => {
  it("mengembalikan p_i^2, bukan p_i", () => {
    expect(probabilityWad(q, 0)).toBe(409_836_065_573_770_491n);
    expect(probabilityWad(q, 1)).toBe(590_163_934_426_229_508n);
  });

  it("berjumlah satu dalam batas debu floor", () => {
    const sum = probabilityWad(q, 0) + probabilityWad(q, 1);
    expect(WAD - sum).toBeLessThanOrEqual(2n);
    expect(sum).toBeLessThanOrEqual(WAD);
  });
});

describe("payoutPerShareWad", () => {
  it("adalah 1/p_i", () => {
    expect(payoutPerShareWad(q, 1)).toBe(1_301_708_279_317_775_732n);
    expect(payoutPerShareWad(q, 0)).toBe(1_562_049_935_181_330_879n);
  });

  it("BUKAN 1/P_i — jebakan yang melebihkan payout ~30%", () => {
    const wrong = (WAD * WAD) / probabilityWad(q, 1);
    expect(wrong).toBe(1_694_444_444_444_444_445n);
    expect(payoutPerShareWad(q, 1)).not.toBe(wrong);
  });

  it("payout dikali harga marginal mendekati satu", () => {
    const product = (payoutPerShareWad(q, 1) * dpm.price(q, 1)) / WAD;
    expect(WAD - product).toBeLessThanOrEqual(2n);
  });

  it("aman pada market kosong", () => {
    expect(payoutPerShareWad([0n, 0n], 0)).toBe(0n);
  });
});

describe("qAfterBuy", () => {
  it("hanya menambah kaki yang dibeli", () => {
    expect(qAfterBuy(q, 1, 100n * WAD)).toEqual([1000n * WAD, 1300n * WAD]);
    expect(qAfterBuy(q, 0, 100n * WAD)).toEqual([1100n * WAD, 1200n * WAD]);
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul `@/lib/dpm-view` tidak ditemukan.

- [ ] **Step 3: Implementasikan `frontend/src/lib/data/types.ts` LEBIH DULU**

`dpm-view.ts` di langkah berikutnya mengimpor `Outcome` dari berkas ini, jadi ia harus ada duluan.
Isinya ada di Step 6 di bawah — tulis berkas itu sekarang, lalu lanjut.

- [ ] **Step 4: Implementasikan `frontend/src/lib/dpm-view.ts`**

```ts
import {WAD, dpm} from "@0g-delphi/protocol";
import type {Outcome} from "@/lib/data/types";

type Q = readonly [bigint, bigint];

/**
 * Turunan tampilan dari keadaan market. Setiap nilai di sini berasal dari
 * cermin TypeScript yang sudah disematkan ke DPMMath.sol lewat uji diferensial
 * 512 vektor — jadi angka di layar berasal dari sumber yang sama dengan angka
 * di rantai, bukan dari reimplementasi.
 */

/** Probabilitas implisit P_i = p_i^2. Ini satu-satunya sumber untuk nilai berlabel %. */
export function probabilityWad(q: Q, outcome: Outcome): bigint {
  return dpm.probability(q, outcome);
}

/**
 * Payout per lembar menang = 1/p_i, dalam wad.
 *
 * BUKAN 1/P_i. Keduanya menghasilkan angka yang terlihat masuk akal, dan
 * memakai yang salah melebih-lebihkan payout sekitar 30% pada skew biasa —
 * persis arah yang merugikan pengguna bila ia mempercayainya. Draf pertama
 * spec ini sendiri melakukan kesalahan itu.
 */
export function payoutPerShareWad(q: Q, outcome: Outcome): bigint {
  const price = dpm.price(q, outcome);
  if (price === 0n) return 0n;
  return (WAD * WAD) / price;
}

/** Keadaan q setelah `shares` lembar `outcome` dicetak. */
export function qAfterBuy(q: Q, outcome: Outcome, shares: bigint): Q {
  return outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
}
```

- [ ] **Step 5: Tulis uji `MockSource` yang gagal**

`frontend/test/mock-source.test.ts`:

```ts
import {beforeEach, describe, expect, it} from "vitest";
import {dpm} from "@0g-delphi/protocol";
import {MockSource} from "@/lib/data/mock";
import {CapabilityUnavailableError} from "@/lib/data/types";

describe("MockSource", () => {
  let source: MockSource;
  beforeEach(() => {
    source = new MockSource();
  });

  it("melaporkan mode dan seluruh kemampuan secara bawaan", () => {
    expect(source.mode).toBe("mock");
    expect(source.capabilities.has("PRICE_HISTORY")).toBe(true);
    expect(source.capabilities.has("TRADE_TAPE")).toBe(true);
  });

  it("mengembalikan market fixture", async () => {
    const markets = await source.listMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(2);
    expect(markets[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("mengambil satu market berdasarkan alamat", async () => {
    const [first] = await source.listMarkets();
    const detail = await source.getMarket(first!.address);
    expect(detail.address).toBe(first!.address);
    expect(detail.question).toBe(first!.question);
  });

  it("melempar untuk alamat yang tidak dikenal", async () => {
    await expect(source.getMarket("0x0000000000000000000000000000000000000009")).rejects.toThrow(
      /tidak ditemukan/,
    );
  });

  /**
   * Fixture yang tidak konsisten merender keadaan yang tidak mungkin ada di
   * rantai. poolWad DITURUNKAN dari q, tidak pernah diketik tangan.
   */
  it("setiap fixture memenuhi invarian pool protokol", async () => {
    for (const m of await source.listMarkets()) {
      expect(m.poolWad).toBe(dpm.costUp(m.q));
    }
  });

  it("mengembalikan tape trade", async () => {
    const [first] = await source.listMarkets();
    const trades = await source.getTrades(first!.address, 50);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]!.timestamp).toBeGreaterThan(trades[trades.length - 1]!.timestamp);
  });

  /**
   * Mekanisme pusat spec: kemampuan yang absen MELEMPAR, bukan mengembalikan
   * larik kosong. Larik kosong berarti "tidak ada data" — klaim yang berbeda
   * dari "aku tidak bisa tahu". MockSource bisa mensimulasikan mode terbatas
   * supaya perilaku ini teruji tanpa menunggu ChainSource ada.
   */
  it("melempar CapabilityUnavailableError untuk kemampuan yang dihilangkan", async () => {
    const limited = new MockSource({omit: ["PRICE_HISTORY", "TRADE_TAPE"]});
    const [first] = await limited.listMarkets();

    expect(limited.capabilities.has("PRICE_HISTORY")).toBe(false);
    await expect(limited.getCandles(first!.address, "1h")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
    await expect(limited.getTrades(first!.address, 50)).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("error membawa kemampuan dan mode yang gagal", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const [first] = await limited.listMarkets();
    await limited.getTrades(first!.address, 10).catch((error: unknown) => {
      const e = error as CapabilityUnavailableError;
      expect(e.capability).toBe("TRADE_TAPE");
      expect(e.mode).toBe("mock");
    });
    expect.assertions(2);
  });
});
```

- [ ] **Step 6: Isi `frontend/src/lib/data/types.ts` (dibuat di Step 3)**

```ts
export type Outcome = 0 | 1;
export type DataMode = "mock" | "chain" | "indexer";

export type Capability =
  | "LIST_MARKETS"
  | "MARKET_STATE"
  | "QUOTE"
  | "EXECUTE"
  | "PRICE_HISTORY"
  | "TRADE_TAPE";

export class CapabilityUnavailableError extends Error {
  constructor(
    readonly capability: Capability,
    readonly mode: DataMode,
  ) {
    super(`${capability} tidak tersedia di mode ${mode}`);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * `unavailable` adalah anggota union, bukan kasus khusus. Karena ia ada di
 * sini, TypeScript memaksa setiap konsumen menanganinya — komponen yang lupa
 * tidak akan mengompilasi. Kejujuran UI ditegakkan compiler, bukan disiplin.
 */
export type Query<T> =
  | {status: "loading"}
  | {status: "ready"; data: T}
  | {status: "unavailable"; capability: Capability; mode: DataMode}
  | {status: "error"; error: Error};

export type MarketStatus =
  | "Open" | "Closed" | "Proposed" | "Disputed" | "Settled" | "Failed" | "Voided";

export type Tier = "FAST" | "VERIFIED" | "DETERMINISTIC";
export type Interval = "1m" | "5m" | "1h" | "1d";

export interface CollateralInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface MarketSummary {
  address: `0x${string}`;
  question: string;
  category: string;
  tier: Tier;
  status: MarketStatus;
  /** Pasokan lembar per outcome, wad. Indeks 0 = NO, 1 = YES. */
  q: readonly [bigint, bigint];
  /** Selalu sama dengan dpm.costUp(q). Tidak pernah diketik tangan. */
  poolWad: bigint;
  tradingEnd: number;
  collateral: CollateralInfo;
}

export interface MarketDetail extends MarketSummary {
  feeBps: number;
  settlementDeadline: number;
  creator: `0x${string}`;
  specRoot: `0x${string}`;
  rules: string;
}

export interface Trade {
  id: string;
  timestamp: number;
  trader: `0x${string}`;
  outcome: Outcome;
  /** Positif untuk beli, negatif untuk jual. */
  sharesDelta: bigint;
  tokens: bigint;
  fee: bigint;
  probAfterWad: bigint;
}

export interface Candle {
  bucketStart: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

export interface DataSource {
  readonly mode: DataMode;
  readonly capabilities: ReadonlySet<Capability>;
  listMarkets(): Promise<MarketSummary[]>;
  getMarket(address: `0x${string}`): Promise<MarketDetail>;
  getTrades(address: `0x${string}`, limit: number): Promise<Trade[]>;
  getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]>;
}
```

- [ ] **Step 7: Implementasikan `frontend/src/lib/data/mock.ts`**

```ts
import {WAD, dpm} from "@0g-delphi/protocol";
import {
  CapabilityUnavailableError,
  type Candle,
  type Capability,
  type CollateralInfo,
  type DataMode,
  type DataSource,
  type Interval,
  type MarketDetail,
  type MarketSummary,
  type Trade,
} from "./types";

const ALL_CAPABILITIES: Capability[] = [
  "LIST_MARKETS", "MARKET_STATE", "QUOTE", "EXECUTE", "PRICE_HISTORY", "TRADE_TAPE",
];

const MUSDC: CollateralInfo = {
  address: "0x9AA0C7DDC6D72BEEb77E4e497b6fbfa4D81A0153",
  symbol: "mUSDC",
  decimals: 6,
};

const HOUR = 3_600;
const NOW = 1_790_000_000;

/** poolWad diturunkan, tidak pernah diketik — fixture tak boleh melanggar invarian rantai. */
function market(
  partial: Omit<MarketDetail, "poolWad" | "collateral">,
): MarketDetail {
  return {...partial, poolWad: dpm.costUp(partial.q), collateral: MUSDC};
}

export const FIXTURE_MARKETS: MarketDetail[] = [
  market({
    address: "0x1111111111111111111111111111111111111111",
    question: "Apakah harga penutupan ETH/USD pada 30 September 2026 berada di atas $4.000?",
    rules:
      "Diselesaikan YES bila harga penutupan harian ETH/USD pada 2026-09-30 23:59 UTC menurut " +
      "sumber yang terdaftar berada di atas $4.000,00. Diselesaikan NO bila di bawah atau sama " +
      "dengan. Bila tidak ada sumber yang menerbitkan harga penutupan pada hari itu, market " +
      "dianggap UNRESOLVABLE dan dilikuidasi.",
    category: "crypto",
    tier: "VERIFIED",
    status: "Open",
    q: [1000n * WAD, 1200n * WAD],
    tradingEnd: NOW + 52 * HOUR,
    settlementDeadline: NOW + 76 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000001",
    specRoot: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  }),
  market({
    address: "0x2222222222222222222222222222222222222222",
    question: "Apakah 0G Chain akan mengumumkan mainnet v2 sebelum 1 Desember 2026?",
    rules:
      "Diselesaikan YES bila pengumuman resmi terbit di kanal resmi 0G Labs sebelum " +
      "2026-12-01 00:00 UTC. Pengumuman pihak ketiga tidak dihitung.",
    category: "crypto",
    tier: "FAST",
    status: "Open",
    q: [707_106_781_186_547_524_400n, 707_106_781_186_547_524_400n],
    tradingEnd: NOW + 9 * 24 * HOUR,
    settlementDeadline: NOW + 10 * 24 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000002",
    specRoot: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1",
  }),
  market({
    address: "0x3333333333333333333333333333333333333333",
    question: "Apakah inflasi tahunan zona euro turun di bawah 2,0% pada rilis Oktober 2026?",
    rules: "Diselesaikan menurut rilis HICP Eurostat untuk Oktober 2026, angka flash.",
    category: "economics",
    tier: "DETERMINISTIC",
    status: "Closed",
    q: [1800n * WAD, 600n * WAD],
    tradingEnd: NOW - 2 * HOUR,
    settlementDeadline: NOW + 22 * HOUR,
    feeBps: 100,
    creator: "0xAaAaAaAa00000000000000000000000000000003",
    specRoot: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2",
  }),
];

function fixtureTrades(m: MarketDetail): Trade[] {
  const trades: Trade[] = [];
  let q: readonly [bigint, bigint] = [m.q[0] / 2n, m.q[1] / 2n];
  for (let i = 0; i < 24; i++) {
    const outcome = (i % 3 === 0 ? 0 : 1) as 0 | 1;
    const shares = BigInt(12 + ((i * 37) % 90)) * WAD;
    const before = dpm.costUp(q);
    q = outcome === 0 ? [q[0] + shares, q[1]] : [q[0], q[1] + shares];
    const tokens = (dpm.costUp(q) - before) / 10n ** 12n;
    trades.push({
      id: `${m.address}-${i}`,
      timestamp: NOW - (24 - i) * HOUR,
      trader: `0xbb${i.toString(16).padStart(2, "0")}${"0".repeat(34)}` as `0x${string}`,
      outcome,
      sharesDelta: shares,
      tokens,
      fee: (tokens * BigInt(m.feeBps)) / 10_000n,
      probAfterWad: dpm.probability(q, 1),
    });
  }
  return trades.reverse(); // terbaru dulu
}

export class MockSource implements DataSource {
  readonly mode: DataMode = "mock";
  readonly capabilities: ReadonlySet<Capability>;

  constructor(options: {omit?: Capability[]} = {}) {
    const omitted = new Set(options.omit ?? []);
    this.capabilities = new Set(ALL_CAPABILITIES.filter((c) => !omitted.has(c)));
  }

  private require(capability: Capability): void {
    if (!this.capabilities.has(capability)) {
      throw new CapabilityUnavailableError(capability, this.mode);
    }
  }

  private find(address: string): MarketDetail {
    const found = FIXTURE_MARKETS.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    );
    if (!found) throw new Error(`Market ${address} tidak ditemukan`);
    return found;
  }

  async listMarkets(): Promise<MarketSummary[]> {
    this.require("LIST_MARKETS");
    return FIXTURE_MARKETS;
  }

  async getMarket(address: `0x${string}`): Promise<MarketDetail> {
    this.require("MARKET_STATE");
    return this.find(address);
  }

  async getTrades(address: `0x${string}`, limit: number): Promise<Trade[]> {
    this.require("TRADE_TAPE");
    return fixtureTrades(this.find(address)).slice(0, limit);
  }

  async getCandles(address: `0x${string}`, interval: Interval): Promise<Candle[]> {
    this.require("PRICE_HISTORY");
    const trades = [...fixtureTrades(this.find(address))].reverse();
    const step = interval === "1d" ? 24 * HOUR : interval === "1h" ? HOUR : 5 * 60;
    return trades.map((t, i) => ({
      bucketStart: t.timestamp - (t.timestamp % step),
      open: i === 0 ? t.probAfterWad : trades[i - 1]!.probAfterWad,
      high: t.probAfterWad,
      low: t.probAfterWad,
      close: t.probAfterWad,
      volume: t.tokens,
    }));
  }
}
```

- [ ] **Step 8: Implementasikan `frontend/src/lib/data/index.ts`**

```ts
import {MockSource} from "./mock";
import type {DataMode, DataSource} from "./types";

/**
 * F0 hanya punya MockSource. ChainSource (F1) dan IndexerSource (F4) masuk di
 * sini; IndexerSource akan MEMBUNGKUS ChainSource, bukan menduplikasinya,
 * sehingga "kuotasi selalu dari rantai" jadi sifat struktural.
 */
export function getDataSource(): DataSource {
  const mode = (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") as DataMode;
  if (mode !== "mock") {
    throw new Error(`DATA_MODE=${mode} belum diimplementasikan; F0 hanya mendukung "mock"`);
  }
  return new MockSource();
}

export * from "./types";
```

- [ ] **Step 9: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 29 lulus (3 asap + 11 format + 7 dpm-view + 8 mock).

- [ ] **Step 10: Commit**

```bash
git add frontend
git commit -m "feat(frontend): lapisan data dengan kemampuan eksplisit dan MockSource"
```

---

## Task 4: Primitif — `Unavailable`, `Badge`, `CopyAddress`, `Countdown`, `Stat`

**Files:**
- Create: `frontend/src/components/primitives/{Unavailable,Badge,CopyAddress,Countdown,Stat}.tsx`
- Test: `frontend/test/primitives.test.tsx`

**Interfaces:**
- Consumes: `Capability`, `DataMode` dari `@/lib/data/types`; `shortAddress`, `formatCountdown` dari `@/lib/format`
- Produces: `<Unavailable capability mode />`, `<Badge tone label />`, `<CopyAddress address />`, `<Countdown until />`, `<Stat label value hint />`

`Unavailable` adalah primitif terpenting di berkas ini. Ia adalah wujud visual dari aturan bahwa UI tidak pernah merender angka yang mode saat ini tidak bisa ketahui.

- [ ] **Step 1: Tulis uji yang gagal**

`frontend/test/primitives.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Stat} from "@/components/primitives/Stat";
import {Unavailable} from "@/components/primitives/Unavailable";

describe("Unavailable", () => {
  it("menamai kemampuan yang hilang dan mode yang menyediakannya", () => {
    render(<Unavailable capability="PRICE_HISTORY" mode="chain" />);
    expect(screen.getByText(/riwayat harga/i)).toBeInTheDocument();
    expect(screen.getByText(/indexer/i)).toBeInTheDocument();
  });

  /** Inti aturannya: ketidaktahuan tidak boleh menyamar jadi angka. */
  it("tidak pernah merender nol atau strip telanjang", () => {
    const {container} = render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    const text = container.textContent ?? "";
    expect(text.trim()).not.toBe("0");
    expect(text.trim()).not.toBe("—");
    expect(text.length).toBeGreaterThan(10);
  });
});

describe("Badge", () => {
  it("merender labelnya", () => {
    render(<Badge tone="neutral" label="VERIFIED" />);
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
  });
});

describe("CopyAddress", () => {
  it("menampilkan bentuk terpotong tapi menyimpan alamat penuh di title", () => {
    const full = "0x1234567890abcdef1234567890abcdef12345678";
    render(<CopyAddress address={full} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("0x1234…5678");
    expect(button).toHaveAttribute("title", full);
  });
});

describe("Countdown", () => {
  it("memformat sisa waktu dari stempel waktu absolut", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now + 2 * 3600 + 14 * 60} nowSeconds={now} />);
    expect(screen.getByText("2j 14m")).toBeInTheDocument();
  });

  it("menyatakan tutup saat sudah lewat", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now - 60} nowSeconds={now} />);
    expect(screen.getByText("tutup")).toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("memasangkan label dengan nilai", () => {
    render(<Stat label="P(YES)" value="59.0%" />);
    expect(screen.getByText("P(YES)")).toBeInTheDocument();
    expect(screen.getByText("59.0%")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul komponen tidak ditemukan.

- [ ] **Step 3: Implementasikan `Unavailable.tsx`**

```tsx
import type {Capability, DataMode} from "@/lib/data/types";

const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Daftar market",
  MARKET_STATE: "Keadaan market",
  QUOTE: "Kuotasi",
  EXECUTE: "Eksekusi",
  PRICE_HISTORY: "Riwayat harga",
  TRADE_TAPE: "Riwayat transaksi",
};

/** Mode paling ringan yang menyediakan kemampuan ini. */
const PROVIDED_BY: Record<Capability, DataMode> = {
  LIST_MARKETS: "chain",
  MARKET_STATE: "chain",
  QUOTE: "chain",
  EXECUTE: "chain",
  PRICE_HISTORY: "indexer",
  TRADE_TAPE: "indexer",
};

/**
 * Wujud visual dari aturan bahwa UI tidak pernah merender angka yang mode saat
 * ini tidak bisa ketahui. Bukan spinner (data tidak sedang datang), bukan nol
 * (itu klaim yang salah), bukan strip telanjang (itu tidak menjelaskan apa pun).
 */
export function Unavailable({capability, mode}: {capability: Capability; mode: DataMode}) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-text-muted">
      <span className="text-text">{LABELS[capability]}</span> tidak tersedia di mode{" "}
      <span className="font-mono">{mode}</span> — sumber ini tidak menyimpan riwayat. Tersedia di
      mode <span className="font-mono">{PROVIDED_BY[capability]}</span>.
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan empat primitif sisanya**

`Badge.tsx`:

```tsx
type Tone = "neutral" | "positive" | "negative" | "warning" | "verified";

const TONES: Record<Tone, string> = {
  neutral: "border-border text-text-muted",
  positive: "border-pos/40 text-pos",
  negative: "border-neg/40 text-neg",
  warning: "border-warn/40 text-warn",
  verified: "border-verified/40 text-verified",
};

export function Badge({tone, label}: {tone: Tone; label: string}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
```

`CopyAddress.tsx`:

```tsx
"use client";

import {useState} from "react";
import {shortAddress} from "@/lib/format";

export function CopyAddress({address}: {address: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={address}
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-[13px] text-text-muted hover:text-text"
    >
      {copied ? "tersalin" : shortAddress(address)}
    </button>
  );
}
```

`Countdown.tsx`:

```tsx
import {formatCountdown} from "@/lib/format";

/**
 * `nowSeconds` disuntik agar bisa diuji secara deterministik. Tanpa itu, uji
 * hitung mundur bergantung pada jam dinding dan akan flaky.
 */
export function Countdown({until, nowSeconds}: {until: number; nowSeconds?: number}) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return <span>{formatCountdown(until - now)}</span>;
}
```

`Stat.tsx`:

```tsx
import type {ReactNode} from "react";

export function Stat({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-text-faint">{label}</span>
      <span className="text-[15px] text-text">{value}</span>
      {hint ? <span className="text-[11px] text-text-muted">{hint}</span> : null}
    </div>
  );
}
```

- [ ] **Step 5: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 36 lulus.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): primitif UI dengan Unavailable sebagai status kelas satu"
```

---

## Task 5: Provider dan hook

**Files:**
- Create: `frontend/src/hooks/provider.tsx`, `frontend/src/hooks/toQuery.ts`, `frontend/src/hooks/useMarket.ts`, `frontend/src/hooks/useTrades.ts`, `frontend/src/hooks/useQuote.ts`
- Modify: `frontend/package.json` (tambah `@tanstack/react-query`), `frontend/src/app/layout.tsx`
- Test: `frontend/test/hooks.test.tsx`

**Interfaces:**
- Consumes: `DataSource`, `Query<T>`, `CapabilityUnavailableError`, `MockSource`
- Produces: `<AppProviders source>`, `useDataSource()`, `useMarket(address): Query<MarketDetail>`, `useTrades(address, limit): Query<Trade[]>`, `useQuote({q, outcome, spendWad, feeBps})`

- [ ] **Step 1: Tambahkan dependensi**

Di `frontend/package.json`, tambahkan ke `"dependencies"`:

```json
    "@tanstack/react-query": "^5.102.6",
```

lalu `npm install` dari akar repo.

- [ ] **Step 2: Tulis uji yang gagal**

`frontend/test/hooks.test.tsx`:

```tsx
import {renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-delphi/protocol";
import {AppProviders} from "@/hooks/provider";
import {useMarket} from "@/hooks/useMarket";
import {useQuote} from "@/hooks/useQuote";
import {useTrades} from "@/hooks/useTrades";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const ADDRESS = FIXTURE_MARKETS[0]!.address;

function wrapper(source: MockSource) {
  return function Wrapper({children}: {children: ReactNode}) {
    return <AppProviders source={source}>{children}</AppProviders>;
  };
}

describe("useMarket", () => {
  it("berpindah dari loading ke ready", async () => {
    const {result} = renderHook(() => useMarket(ADDRESS), {wrapper: wrapper(new MockSource())});
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("diharapkan ready");
    expect(result.current.data.address).toBe(ADDRESS);
  });
});

describe("useTrades", () => {
  it("mengembalikan tape saat kemampuan ada", async () => {
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(new MockSource())});
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  /** Kontrak inti: kemampuan yang absen jadi status `unavailable`, bukan `error`. */
  it("memetakan kemampuan yang hilang jadi unavailable, bukan error", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(limited)});
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    if (result.current.status !== "unavailable") throw new Error("diharapkan unavailable");
    expect(result.current.capability).toBe("TRADE_TAPE");
    expect(result.current.mode).toBe("mock");
  });
});

describe("useQuote", () => {
  const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

  it("menghitung lembar dan probabilitas secara sinkron, tanpa RPC", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBeGreaterThan(0n);
    expect(result.current.probBeforeWad).toBe(590_163_934_426_229_508n);
    expect(result.current.probAfterWad).toBeGreaterThan(result.current.probBeforeWad);
  });

  /** Pembelian menaikkan harga, jadi rata-rata WAJIB di atas marginal awal. */
  it("harga rata-rata di atas harga marginal sebelum trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.avgPriceWad).toBeGreaterThan(768_221_279_597_375_842n);
  });

  /** Membeli sisi ini menurunkan payout sisi ini — dilusi, terlihat sebagai angka. */
  it("payout sisi yang dibeli turun setelah trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.payoutAfterWad).toBeLessThan(result.current.payoutBeforeWad);
  });

  it("mengembalikan nol untuk belanja nol tanpa melempar", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 0n, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBe(0n);
  });
});
```

- [ ] **Step 3: Implementasikan `provider.tsx`**

```tsx
"use client";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createContext, useContext, useState, type ReactNode} from "react";
import {CapabilityUnavailableError, type DataSource} from "@/lib/data/types";

const DataSourceContext = createContext<DataSource | null>(null);

export function useDataSource(): DataSource {
  const source = useContext(DataSourceContext);
  if (!source) throw new Error("useDataSource dipakai di luar AppProviders");
  return source;
}

export function AppProviders({source, children}: {source: DataSource; children: ReactNode}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Kemampuan yang absen bukan kegagalan sementara — mengulanginya
            // hanya menunda status `unavailable` yang sudah pasti.
            retry: (count, error) =>
              !(error instanceof CapabilityUnavailableError) && count < 2,
            staleTime: 5_000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Implementasikan `toQuery.ts`, `useMarket.ts`, dan `useTrades.ts`**

`toQuery` dipakai oleh setiap hook, jadi ia tinggal di berkasnya sendiri — mengimpornya dari
`useMarket` akan membuat `useTrades` bergantung pada hook yang tidak ada hubungannya.

`frontend/src/hooks/toQuery.ts`:

```ts
import type {UseQueryResult} from "@tanstack/react-query";
import {CapabilityUnavailableError, type DataMode, type Query} from "@/lib/data/types";

/** Menerjemahkan keadaan TanStack jadi union kita, dengan `unavailable` sebagai cabang tersendiri. */
export function toQuery<T>(result: UseQueryResult<T>, mode: DataMode): Query<T> {
  if (result.isPending) return {status: "loading"};
  if (result.error) {
    const error = result.error;
    if (error instanceof CapabilityUnavailableError) {
      return {status: "unavailable", capability: error.capability, mode: error.mode};
    }
    return {status: "error", error: error as Error};
  }
  return {status: "ready", data: result.data as T};
}
```

`frontend/src/hooks/useMarket.ts`:

```ts
"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {MarketDetail, Query} from "@/lib/data/types";

export function useMarket(address: `0x${string}`): Query<MarketDetail> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["market", source.mode, address],
    queryFn: () => source.getMarket(address),
  });
  return toQuery(result, source.mode);
}
```

`useTrades.ts`:

```ts
"use client";

import {useQuery} from "@tanstack/react-query";
import {toQuery} from "./toQuery";
import {useDataSource} from "./provider";
import type {Query, Trade} from "@/lib/data/types";

export function useTrades(address: `0x${string}`, limit: number): Query<Trade[]> {
  const source = useDataSource();
  const result = useQuery({
    queryKey: ["trades", source.mode, address, limit],
    queryFn: () => source.getTrades(address, limit),
  });
  return toQuery(result, source.mode);
}
```

- [ ] **Step 5: Implementasikan `useQuote.ts`**

```ts
"use client";

import {WAD, dpm} from "@0g-delphi/protocol";
import {useMemo} from "react";
import {payoutPerShareWad, probabilityWad, qAfterBuy} from "@/lib/dpm-view";
import type {Outcome} from "@/lib/data/types";

export interface QuotePreview {
  sharesOut: bigint;
  poolInWad: bigint;
  feeWad: bigint;
  totalWad: bigint;
  avgPriceWad: bigint;
  probBeforeWad: bigint;
  probAfterWad: bigint;
  payoutBeforeWad: bigint;
  payoutAfterWad: bigint;
}

/**
 * Pratinjau LOKAL, dihitung dari cermin TypeScript — sinkron, tanpa RPC, jadi
 * mengetik tidak memicu satu pun panggilan jaringan. Ini TAKSIRAN: sebelum
 * mengirim transaksi, F1 memanggil `quoteBuy` di rantai dan angka itulah yang
 * ditandatangani pengguna.
 */
export function useQuote(input: {
  q: readonly [bigint, bigint];
  outcome: Outcome;
  spendWad: bigint;
  feeBps: number;
}): QuotePreview {
  const {q, outcome, spendWad, feeBps} = input;
  return useMemo(() => {
    const empty: QuotePreview = {
      sharesOut: 0n, poolInWad: 0n, feeWad: 0n, totalWad: 0n, avgPriceWad: 0n,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(q, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(q, outcome),
    };
    if (spendWad <= 0n) return empty;

    // Kontrak mengenakan fee DI ATAS biaya pool, jadi membaliknya untuk
    // anggaran kotor memakai penyebut 10000 + feeBps, bukan 10000.
    const bps = BigInt(feeBps);
    const feeWad = (spendWad * bps) / (10_000n + bps);
    const poolInWad = spendWad - feeWad;
    if (poolInWad <= 0n) return empty;

    let sharesOut: bigint;
    try {
      sharesOut = dpm.sharesForSpend(q, outcome, poolInWad);
    } catch {
      return empty;
    }
    const qAfter = qAfterBuy(q, outcome, sharesOut);
    return {
      sharesOut,
      poolInWad,
      feeWad,
      totalWad: spendWad,
      avgPriceWad: sharesOut === 0n ? 0n : (poolInWad * WAD) / sharesOut,
      probBeforeWad: probabilityWad(q, outcome),
      probAfterWad: probabilityWad(qAfter, outcome),
      payoutBeforeWad: payoutPerShareWad(q, outcome),
      payoutAfterWad: payoutPerShareWad(qAfter, outcome),
    };
  }, [q, outcome, spendWad, feeBps]);
}
```

- [ ] **Step 6: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 43 lulus.

- [ ] **Step 7: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): provider, hook data, dan kuotasi lokal tanpa RPC"
```

---

## Task 6: Panel probabilitas dan panel payout

**Files:**
- Create: `frontend/src/components/market/ProbabilityPanel.tsx`, `frontend/src/components/market/PayoutPanel.tsx`
- Test: `frontend/test/market-panels.test.tsx`

**Interfaces:**
- Consumes: `probabilityWad`, `payoutPerShareWad`; `formatProbability`, `formatPayout`
- Produces: `<ProbabilityPanel q />`, `<PayoutPanel q />`

`PayoutPanel` membawa pengungkapan dilusi yang spec sebut wajib. Ia bukan disclaimer hukum — ia menjelaskan sifat instrumen yang sedang dijual halaman ini.

- [ ] **Step 1: Tulis uji yang gagal**

`frontend/test/market-panels.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-delphi/protocol";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

describe("ProbabilityPanel", () => {
  it("menampilkan kedua sisi sebagai p^2", () => {
    render(<ProbabilityPanel q={q} />);
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByText("41.0%")).toBeInTheDocument();
  });

  /** Harga marginal untuk q ini adalah 76.8% dan 64.0% — tidak boleh muncul sebagai persen. */
  it("tidak menampilkan harga marginal sebagai probabilitas", () => {
    const {container} = render(<ProbabilityPanel q={q} />);
    expect(container.textContent).not.toContain("76.8%");
    expect(container.textContent).not.toContain("64.0%");
  });
});

describe("PayoutPanel", () => {
  it("menampilkan payout 1/p, bukan 1/P", () => {
    render(<PayoutPanel q={q} />);
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.getByText("1.56×")).toBeInTheDocument();
  });

  it("tidak menampilkan angka 1/P yang keliru", () => {
    const {container} = render(<PayoutPanel q={q} />);
    expect(container.textContent).not.toContain("1.69×");
    expect(container.textContent).not.toContain("2.44×");
  });

  /** Pengungkapan wajib: payout mengambang sampai market tutup. */
  it("mengungkap dilusi dengan istilah yang bisa ditindaklanjuti", () => {
    render(<PayoutPanel q={q} />);
    expect(screen.getByText(/mengambang/i)).toBeInTheDocument();
    expect(screen.getByText(/jual kapan saja/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul panel tidak ditemukan.

- [ ] **Step 3: Implementasikan `ProbabilityPanel.tsx`**

```tsx
import {probabilityWad} from "@/lib/dpm-view";
import {formatProbability} from "@/lib/format";

/**
 * Menampilkan P_i = p_i^2. Harga marginal p_i TIDAK pernah muncul di sini —
 * ia hanya sah sebagai harga eksekusi per lembar, bukan sebagai persentase.
 */
export function ProbabilityPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {([1, 0] as const).map((outcome) => (
        <div key={outcome} className="bg-bg px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-text-faint">
            {outcome === 1 ? "YES" : "NO"}
          </div>
          <div className="mt-1 text-[28px] leading-none text-text">
            {formatProbability(probabilityWad(q, outcome))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan `PayoutPanel.tsx`**

```tsx
import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";

/**
 * Payout DPM didanai seluruhnya oleh pool, dan konsekuensinya payout milik
 * pembeli awal terdilusi oleh pembeli belakangan. Menyembunyikan itu membuat
 * halaman ini berbohong tentang instrumen yang dijualnya — karena itu
 * pengungkapannya ada di sini dan diulang di tiket order sebelum konfirmasi.
 */
export function PayoutPanel({q}: {q: readonly [bigint, bigint]}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-col gap-1.5">
        {([1, 0] as const).map((outcome) => (
          <div key={outcome} className="flex items-baseline justify-between">
            <span className="text-[13px] text-text-muted">
              Payout jika {outcome === 1 ? "YES" : "NO"} menang
            </span>
            <span className="text-[15px] text-text">
              {formatPayout(payoutPerShareWad(q, outcome))} per lembar
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-warn">
        Payout mengambang sampai market tutup. Semakin banyak yang membeli sisi yang sama denganmu,
        semakin kecil payout per lembarmu. Jual kapan saja untuk mengunci harga saat ini.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 48 lulus.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): panel probabilitas dan payout dengan pengungkapan dilusi"
```

---

## Task 7: Tiket order

**Files:**
- Create: `frontend/src/components/market/OrderTicket.tsx`
- Test: `frontend/test/order-ticket.test.tsx`

**Interfaces:**
- Consumes: `useQuote`, `formatShares`, `formatPricePerShare`, `formatCollateral`, `formatProbability`, `formatProbabilityDelta`, `formatPayout`, `toWad`, `toTokensCeil`
- Produces: `<OrderTicket market />`

Bagian paling sulit didesain benar: memuat kuotasi, dampak harga, batas slippage, payout, dan peringatan dilusi tanpa jadi menakutkan atau menyesatkan. F0 merender dan menghitung; tombol eksekusi dinonaktifkan dengan alasan yang jelas, karena mode mock tidak mengirim transaksi.

- [ ] **Step 1: Tulis uji yang gagal**

`frontend/test/order-ticket.test.tsx`:

```tsx
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {AppProviders} from "@/hooks/provider";
import {OrderTicket} from "@/components/market/OrderTicket";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const market = FIXTURE_MARKETS[0]!;

function renderTicket() {
  return render(
    <AppProviders source={new MockSource()}>
      <OrderTicket market={market} />
    </AppProviders>,
  );
}

describe("OrderTicket", () => {
  it("mulai kosong tanpa menampilkan kuotasi palsu", () => {
    renderTicket();
    expect(screen.queryByTestId("quote-shares")).toBeNull();
  });

  it("menghitung kuotasi saat mengetik", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("quote-shares").textContent).toMatch(/^\d/);
  });

  /** Dampak harga ditampilkan sebagai transisi, bukan angka tunggal. */
  it("menampilkan probabilitas sebelum dan sesudah", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("prob-before").textContent).toBe("59.0%");
    expect(screen.getByTestId("prob-after").textContent).not.toBe("59.0%");
    expect(screen.getByTestId("prob-delta").textContent).toMatch(/^\+/);
  });

  /** Dilusi terlihat konkret: pembelianmu sendiri menurunkan payout-mu. */
  it("menampilkan payout turun akibat pembelian sendiri", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    const before = screen.getByTestId("payout-before").textContent!;
    const after = screen.getByTestId("payout-after").textContent!;
    expect(parseFloat(after)).toBeLessThan(parseFloat(before));
  });

  it("menampilkan batas maksimum yang akan dibayar, bukan hanya kuotasi", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByTestId("max-paid").textContent).toBeTruthy();
    expect(screen.getByText(/0\.5%/)).toBeInTheDocument();
  });

  it("bisa berpindah sisi", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    const yesProb = screen.getByTestId("prob-before").textContent;
    await user.click(screen.getByRole("button", {name: /^NO/}));
    expect(screen.getByTestId("prob-before").textContent).not.toBe(yesProb);
  });

  /** Mode mock tidak mengirim transaksi — dan harus mengatakannya, bukan diam. */
  it("menonaktifkan eksekusi di mode mock dengan alasan yang terlihat", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.type(screen.getByLabelText(/belanjakan/i), "100");
    expect(screen.getByRole("button", {name: /beli/i})).toBeDisabled();
    expect(screen.getByText(/mode mock/i)).toBeInTheDocument();
  });
});
```

Tambahkan `@testing-library/user-event` ke `devDependencies` frontend:

```json
    "@testing-library/user-event": "^14.6.1",
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm install && npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul `OrderTicket` tidak ditemukan.

- [ ] **Step 3: Implementasikan `OrderTicket.tsx`**

```tsx
"use client";

import {useState} from "react";
import {toTokensCeil, toWad} from "@0g-delphi/protocol";
import {useDataSource} from "@/hooks/provider";
import {useQuote} from "@/hooks/useQuote";
import {
  formatCollateral, formatPayout, formatPricePerShare,
  formatProbability, formatProbabilityDelta, formatShares,
} from "@/lib/format";
import type {MarketDetail, Outcome} from "@/lib/data/types";

const SLIPPAGE_BPS = 50n; // 0,5%

/** Mengurai input desimal pengguna jadi satuan token terkecil, tanpa float. */
function parseAmount(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function OrderTicket({market}: {market: MarketDetail}) {
  const source = useDataSource();
  const [outcome, setOutcome] = useState<Outcome>(1);
  const [amountText, setAmountText] = useState("");

  const decimals = market.collateral.decimals;
  const amountTokens = parseAmount(amountText, decimals);
  const quote = useQuote({
    q: market.q,
    outcome,
    spendWad: toWad(amountTokens, decimals),
    feeBps: market.feeBps,
  });

  const hasQuote = quote.sharesOut > 0n;
  const maxPaidTokens = toTokensCeil(
    (quote.totalWad * (10_000n + SLIPPAGE_BPS)) / 10_000n,
    decimals,
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid grid-cols-2 gap-2">
        {([1, 0] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setOutcome(side)}
            className={`rounded-md border px-3 py-2 text-left ${
              outcome === side ? "border-accent text-text" : "border-border text-text-muted"
            }`}
          >
            <div className="text-[12px] font-medium">{side === 1 ? "YES" : "NO"}</div>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[12px] text-text-muted">
        Belanjakan
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-[15px] text-text outline-none"
          />
          <span className="text-[12px] text-text-faint">{market.collateral.symbol}</span>
        </div>
      </label>

      {hasQuote ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-[13px]">
          <Row label="Terima">
            <span data-testid="quote-shares">
              {formatShares(quote.sharesOut)} lembar {outcome === 1 ? "YES" : "NO"}
            </span>
          </Row>
          <Row label="Harga rata-rata">{formatPricePerShare(quote.avgPriceWad)}</Row>
          <Row label={`Fee (${(market.feeBps / 100).toFixed(2)}%)`}>
            {formatCollateral(toTokensCeil(quote.feeWad, decimals), decimals)}
          </Row>

          <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-text-muted">P({outcome === 1 ? "YES" : "NO"})</span>
            <span>
              <span data-testid="prob-before">{formatProbability(quote.probBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="prob-after">{formatProbability(quote.probAfterWad)}</span>
              <span data-testid="prob-delta" className="ml-2 text-text-muted">
                {formatProbabilityDelta(quote.probBeforeWad, quote.probAfterWad)}
              </span>
            </span>
          </div>

          <Row label="Payout jika menang">
            <span>
              <span data-testid="payout-before">{formatPayout(quote.payoutBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="payout-after">{formatPayout(quote.payoutAfterWad)}</span>
            </span>
          </Row>

          <Row label="Maks dibayar (slippage 0.5%)">
            <span data-testid="max-paid">{formatCollateral(maxPaidTokens, decimals)}</span>
          </Row>

          <p className="mt-2 text-[12px] leading-relaxed text-warn">
            Pembelian ini sendiri menurunkan payout-mu. Pembeli berikutnya di sisi ini
            menurunkannya lagi.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40"
      >
        Beli {outcome === 1 ? "YES" : "NO"}
      </button>
      <p className="text-[11px] text-text-faint">
        Mode mock — kuotasi dihitung dari cermin DPM, tetapi tidak ada transaksi yang dikirim.
        Eksekusi menyala di mode <span className="font-mono">chain</span> ({source.mode} aktif).
      </p>
    </div>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 55 lulus.

- [ ] **Step 5: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "feat(frontend): tiket order dengan dampak harga dan dilusi sebagai transisi angka"
```

---

## Task 8: Rakit halaman dan verifikasi ujung-ke-ujung

**Files:**
- Create: `frontend/src/components/market/TradeTape.tsx`, `frontend/src/app/market/[address]/page.tsx`, `frontend/src/app/market/[address]/MarketView.tsx`
- Modify: `frontend/src/app/page.tsx`, `frontend/src/app/layout.tsx`
- Test: `frontend/test/market-page.test.tsx`

**Interfaces:**
- Consumes: seluruh Task 1–7
- Produces: rute `/market/[address]` yang berfungsi dan `/` yang menautkan ke fixture

- [ ] **Step 1: Tulis uji yang gagal**

`frontend/test/market-page.test.tsx`:

```tsx
import {render, screen, waitFor} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {MarketView} from "@/app/market/[address]/MarketView";
import {AppProviders} from "@/hooks/provider";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const address = FIXTURE_MARKETS[0]!.address;

function renderView(source = new MockSource()) {
  return render(
    <AppProviders source={source}>
      <MarketView address={address} />
    </AppProviders>,
  );
}

describe("MarketView", () => {
  it("merender pertanyaan, probabilitas, payout, dan tiket", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/ETH\/USD/)).toBeInTheDocument());
    expect(screen.getByText("59.0%")).toBeInTheDocument();
    expect(screen.getByText("1.30×")).toBeInTheDocument();
    expect(screen.getByLabelText(/belanjakan/i)).toBeInTheDocument();
  });

  it("merender tape trade saat kemampuan ada", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("trade-tape")).toBeInTheDocument());
  });

  /**
   * Uji yang paling mudah terlupa dan paling penting: di mode terbatas, kolom
   * sejarah menampilkan penjelasan, BUKAN nol.
   */
  it("menampilkan Unavailable, bukan nol, saat tape tidak tersedia", async () => {
    renderView(new MockSource({omit: ["TRADE_TAPE"]}));
    await waitFor(() =>
      expect(screen.getByText(/riwayat transaksi.*tidak tersedia/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("trade-tape")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npm test -w @0g-delphi/frontend
```
Expected: FAIL — modul `MarketView` tidak ditemukan.

- [ ] **Step 3: Implementasikan `TradeTape.tsx`**

```tsx
import {formatCollateral, formatProbability, formatShares, shortAddress} from "@/lib/format";
import type {CollateralInfo, Trade} from "@/lib/data/types";

export function TradeTape({trades, collateral}: {trades: Trade[]; collateral: CollateralInfo}) {
  return (
    <div data-testid="trade-tape" className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-bg-sunken text-[11px] uppercase tracking-wide text-text-faint">
          <tr>
            {["Waktu", "Sisi", "Lembar", collateral.symbol, "P(YES)"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium last:text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2 text-text-muted">
                {new Date(t.timestamp * 1000).toISOString().slice(11, 16)}
              </td>
              <td className={`px-3 py-2 ${t.outcome === 1 ? "text-pos" : "text-neg"}`}>
                {t.outcome === 1 ? "YES" : "NO"}
              </td>
              <td className="px-3 py-2">{formatShares(t.sharesDelta)}</td>
              <td className="px-3 py-2">{formatCollateral(t.tokens, collateral.decimals)}</td>
              <td className="px-3 py-2 text-right text-text-muted">
                {formatProbability(t.probAfterWad)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border px-3 py-1.5 text-[11px] text-text-faint">
        {trades.length} transaksi terakhir · trader {shortAddress(trades[0]?.trader ?? "0x")}…
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implementasikan `MarketView.tsx`**

```tsx
"use client";

import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {Unavailable} from "@/components/primitives/Unavailable";
import {OrderTicket} from "@/components/market/OrderTicket";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {useMarket} from "@/hooks/useMarket";
import {useTrades} from "@/hooks/useTrades";

export function MarketView({address}: {address: `0x${string}`}) {
  const market = useMarket(address);
  const trades = useTrades(address, 24);

  if (market.status === "loading") return <Shell>Memuat…</Shell>;
  if (market.status === "error") return <Shell>Gagal memuat: {market.error.message}</Shell>;
  if (market.status === "unavailable") {
    return (
      <Shell>
        <Unavailable capability={market.capability} mode={market.mode} />
      </Shell>
    );
  }

  const m = market.data;
  return (
    <Shell>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" label={m.tier} />
          <Badge tone={m.status === "Open" ? "positive" : "neutral"} label={m.status} />
          <span className="text-[12px] text-text-muted">{m.category}</span>
          <span className="text-[12px] text-text-muted">
            tutup dalam <Countdown until={m.tradingEnd} />
          </span>
          <CopyAddress address={m.address} />
        </div>
        <h1 className="max-w-3xl text-[20px] leading-snug text-text">{m.question}</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <ProbabilityPanel q={m.q} />
          <PayoutPanel q={m.q} />
          {trades.status === "ready" ? (
            <TradeTape trades={trades.data} collateral={m.collateral} />
          ) : trades.status === "unavailable" ? (
            <Unavailable capability={trades.capability} mode={trades.mode} />
          ) : trades.status === "error" ? (
            <div className="text-[13px] text-neg">Gagal memuat transaksi.</div>
          ) : (
            <div className="text-[13px] text-text-muted">Memuat transaksi…</div>
          )}
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-text-faint">
              Aturan penyelesaian
            </h2>
            <p className="text-[13px] leading-relaxed text-text-muted">{m.rules}</p>
          </section>
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <OrderTicket market={m} />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({children}: {children: React.ReactNode}) {
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>;
}
```

- [ ] **Step 5: Implementasikan rute dan beranda**

`frontend/src/app/market/[address]/page.tsx`:

```tsx
import {MarketView} from "./MarketView";

export default async function Page({params}: {params: Promise<{address: string}>}) {
  const {address} = await params;
  return <MarketView address={address as `0x${string}`} />;
}
```

`frontend/src/app/page.tsx`:

```tsx
import Link from "next/link";
import {FIXTURE_MARKETS} from "@/lib/data/mock";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <h1 className="text-[20px] text-text">0G-Delphi</h1>
      <p className="text-[13px] text-text-muted">
        Mode mock. Daftar market penuh menyusul di F2, setelah MarketFactory mendarat.
      </p>
      <ul className="flex flex-col gap-2">
        {FIXTURE_MARKETS.map((m) => (
          <li key={m.address}>
            <Link
              href={`/market/${m.address}`}
              className="block rounded-lg border border-border px-4 py-3 text-[14px] text-text hover:border-accent"
            >
              {m.question}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Ganti `frontend/src/app/layout.tsx` untuk membungkus dengan provider:

```tsx
import type {Metadata} from "next";
import {AppShell} from "./AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "0G-Delphi",
  description: "Pasar prediksi biner di 0G Chain",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-bg text-text antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

`frontend/src/app/AppShell.tsx`:

```tsx
"use client";

import {useState} from "react";
import {AppProviders} from "@/hooks/provider";
import {getDataSource} from "@/lib/data";

export function AppShell({children}: {children: React.ReactNode}) {
  const [source] = useState(getDataSource);
  return <AppProviders source={source}>{children}</AppProviders>;
}
```

- [ ] **Step 6: Jalankan dan pastikan lulus**

```bash
npm test -w @0g-delphi/frontend && npx tsc --noEmit -p frontend
```
Expected: PASS — 58 lulus.

- [ ] **Step 7: Verifikasi ujung-ke-ujung di server sungguhan**

```bash
npm run build -w @0g-delphi/frontend
cd frontend && timeout 90 npx next start --port 3100 &
sleep 20
curl -s http://127.0.0.1:3100/market/0x1111111111111111111111111111111111111111 > /tmp/market.html
grep -c "59.0%" /tmp/market.html
grep -c "1.30×" /tmp/market.html
grep -c "mengambang" /tmp/market.html
```
Expected: build sukses; ketiga `grep` mengembalikan ≥ 1. Hentikan server setelahnya.

Ini bukan formalitas — ia membuktikan halaman benar-benar dirender oleh Next, bukan hanya oleh jsdom, dan bahwa nilai `bigint` selamat melewati batas server/klien.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): halaman market lengkap di mode mock"
```

---

## Lampiran A — Peta cakupan spec

| Bagian spec | Tugas |
|---|---|
| §2 kemampuan per mode | 3 (`Capability`, `MockSource({omit})`) |
| §3.1 kontrak `DataSource` | 3 — subset F0, lihat catatan cakupan di Task 3 |
| §3.2 komposisi dekorator | belum — `ChainSource`/`IndexerSource` di F1/F4; jahitannya ada di `lib/data/index.ts` |
| §3.3 `Query<T>` + `unavailable` | 3 (tipe), 5 (`toQuery`), 4 (`<Unavailable>`), 8 (dipakai di halaman) |
| §3.4 matematika di klien | 3 (`dpm-view`), 5 (`useQuote`) |
| §4.2 halaman detail market | 6, 7, 8 |
| §5.1 probabilitas `pᵢ²`, payout `1/pᵢ` | 3 (uji jebakan), 6 (uji negatif di panel) |
| §5.2 kuotasi taksiran, slippage mengikat | 7 (`max-paid`, 0,5%) |
| §5.3 desimal lewat `@0g-delphi/protocol` | 1 (uji impor), 2, 7 |
| §6 anatomi tiket order | 7 |
| §7 sistem visual | 2 |
| §8 struktur berkas | 1–8 |
| §9 uji | tiap tugas; uji "tanpa nol saat unavailable" ada di Task 8 |
| §10 fase F0 dan bagian F1 | seluruh rencana ini |

**Di luar cakupan, sesuai rencana:** grafik probabilitas SVG (butuh `PRICE_HISTORY` yang berarti — F4), `/` daftar market penuh (F2, butuh factory), `/portfolio` (F3), eksekusi transaksi (F1 dengan `ChainSource`), penampil MarketSpec dari 0G Storage dan badge TEE (butuh 0G Storage — F4).

## Lampiran B — Gerbang

| Perintah | Harus |
|---|---|
| `npm test -w @0g-delphi/frontend` | 58 lulus |
| `npx tsc --noEmit -p frontend` | bersih |
| `npm run build -w @0g-delphi/frontend` | sukses |
| `make fe` | server dev menyala di :3000 |
