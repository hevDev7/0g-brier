"use client";

import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {Unavailable} from "@/components/primitives/Unavailable";
import {MarketStats} from "@/components/market/MarketStats";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {PositionsTable} from "@/components/market/PositionsTable";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {FinalOutcome} from "@/components/settlement/FinalOutcome";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {useDataSource} from "@/hooks/provider";
import {useCandles} from "@/hooks/useCandles";
import {useMarket} from "@/hooks/useMarket";
import {usePositions} from "@/hooks/usePositions";
import {useReceipt} from "@/hooks/useReceipt";
import {useTrades} from "@/hooks/useTrades";
import type {
  Candle,
  CollateralInfo,
  DataMode,
  MarketDetail,
  Position,
  Query,
  SettlementReceipt,
  Trade,
} from "@/lib/data/types";

/**
 * Halaman PEMERIKSAAN, bukan tempat bertransaksi (spec §1 F3): berapa harganya,
 * dari mana harga itu datang, siapa memegang apa, dan atas bukti apa market
 * diselesaikan. Beli, jual, tebus, dan likuidasi seluruhnya hidup di
 * `@0g-delphi/agent-kit`, di luar dApp — jadi tidak ada kontrol eksekusi di
 * berkas ini. Bukan disembunyikan dan bukan dinonaktifkan: ABSEN. Tombol mati
 * tetap menjanjikan sesuatu yang tak akan pernah ada di sini, dan uji halaman
 * ini menegaskan tak ada satu pun tombol beli/jual/approve yang tersisa.
 *
 * Tidak ada SpecViewer di sini, dan itu disengaja: isinya berasal dari 0G
 * Storage lewat `specRoot`, yang integrasinya belum ada. Aturan penyelesaian
 * tetap terbaca lewat `market.rules` di bawah, dan kriteria yang benar-benar
 * dipakai komite lewat `ResolutionEvidence` begitu market selesai.
 */
export function MarketView({address}: {address: `0x${string}`}): React.JSX.Element {
  const market = useMarket(address);

  // Pola yang sama dengan setiap pembongkaran Query<T> di bawah — switch tanpa
  // `default`, tipe kembalian non-nullable eksplisit di tanda tangan fungsi.
  // Cabang `ready` menyerahkan ke komponen tersendiri supaya hook data lain
  // (tape, candle, posisi, receipt) tidak perlu dipanggil sebelum `market.data`
  // ada, dan tetap tak bersyarat di dalam komponen itu sendiri.
  switch (market.status) {
    case "ready":
      return <MarketBody market={market.data} />;
    case "unavailable":
      return (
        <Shell>
          <Unavailable capability={market.capability} mode={market.mode} />
        </Shell>
      );
    case "error":
      return <Shell>Gagal memuat: {market.error.message}</Shell>;
    case "loading":
      return <Shell>Memuat…</Shell>;
  }
}

function MarketBody({market}: {market: MarketDetail}): React.JSX.Element {
  const source = useDataSource();
  const trades = useTrades(market.address, 24);
  const candles = useCandles(market.address, "1h");
  const positions = usePositions(market.address);
  const receipt = useReceipt(market.address);

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" label={market.tier} />
              <Badge
                tone={market.status === "Open" ? "positive" : "neutral"}
                label={market.status}
              />
              <span className="text-[12px] text-text-muted">{market.category}</span>
              {/* Hitung mundur hanya sah selama perdagangan masih berjalan: di
                  market yang sudah tutup, `formatCountdown` mengembalikan
                  "tutup" dan barisnya akan terbaca "tutup dalam tutup". Status
                  market sendiri sudah mengatakannya lewat badge di atas. */}
              {market.status === "Open" && (
                <span className="text-[12px] text-text-muted">
                  tutup dalam <Countdown until={market.tradingEnd} />
                </span>
              )}
              <CopyAddress address={market.address} />
            </div>
            <h1 className="max-w-3xl text-[20px] leading-snug text-text">{market.question}</h1>
          </header>

          <ProbabilityPanel q={market.q} />
          <PayoutPanel q={market.q} />
          {renderChart(candles)}
          {renderPositions(positions, market, source.mode)}
          {renderTrades(trades, market.collateral)}

          {/* Aturan penyelesaian berasal dari MARKET_STATE — mode apa pun bisa
              menjawabnya, jadi ia tak pernah `unavailable`. Halaman pemeriksaan
              tanpa aturan yang mengikatnya menyembunyikan justru hal yang
              paling perlu diperiksa pembaca sebelum market selesai. */}
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-text-faint">
              Aturan penyelesaian
            </h2>
            <p className="text-[13px] leading-relaxed text-text-muted">{market.rules}</p>
          </section>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <MarketStats market={market} trades={trades} />
          {market.status === "Settled" && renderSettlement(receipt, market)}
        </aside>
      </div>
    </Shell>
  );
}

/**
 * Diekstrak dari ternary jadi switch atas `.status` supaya jaminan
 * exhaustiveness-nya STRUKTURAL, bukan kebetulan cara kode ini ditulis hari
 * ini. Tipe kembalian non-nullable eksplisit (`React.JSX.Element`) adalah
 * bagian yang menegakkan itu: di bawah `strict`, fungsi yang "jatuh" dari
 * akhir switch tanpa return mengembalikan `undefined`, dan `undefined` tak
 * bisa ditetapkan ke `React.JSX.Element` — jadi menghapus satu `case` gagal
 * kompilasi (TS2366). Tanpa anotasi ini TypeScript diam-diam menyimpulkan
 * `| undefined` dan jaminannya lenyap.
 *
 * SENGAJA TIDAK ADA `default` di seluruh fungsi di bawah: menambahkannya "demi
 * jaga-jaga" akan melucuti exhaustiveness check ini — compiler berhenti memaksa
 * kasus baru ditangani begitu ada fallback yang menampung segalanya.
 */
function renderTrades(trades: Query<Trade[]>, collateral: CollateralInfo): React.JSX.Element {
  switch (trades.status) {
    case "ready":
      return <TradeTape trades={trades.data} collateral={collateral} />;
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Gagal memuat transaksi: {trades.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Memuat transaksi…</div>;
  }
}

function renderChart(candles: Query<Candle[]>): React.JSX.Element {
  switch (candles.status) {
    case "ready":
      return <ProbabilityChart candles={candles.data} />;
    case "unavailable":
      return <Unavailable capability={candles.capability} mode={candles.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Gagal memuat riwayat: {candles.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Memuat riwayat…</div>;
  }
}

/**
 * `mode` diambil dari sumber data, bukan dari `positions` — cabang `ready` tak
 * membawanya, dan tabel tetap perlu tahu mode saat ini untuk sel harga masuk
 * yang bisa `null` (COST_BASIS). Ketersediaan per SEL, bukan per panel.
 */
function renderPositions(
  positions: Query<Position[]>,
  market: MarketDetail,
  mode: DataMode,
): React.JSX.Element {
  switch (positions.status) {
    case "ready":
      return <PositionsTable positions={positions.data} market={market} mode={mode} />;
    case "unavailable":
      return <Unavailable capability={positions.capability} mode={positions.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">Gagal memuat posisi: {positions.error.message}</div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Memuat posisi…</div>;
  }
}

/** Putusan komite DAN bukti yang membuatnya bisa diperiksa — satu receipt, dua panel. */
function renderSettlement(
  receipt: Query<SettlementReceipt>,
  market: MarketDetail,
): React.JSX.Element {
  switch (receipt.status) {
    case "ready":
      return (
        <>
          <FinalOutcome receipt={receipt.data} market={market} />
          <ResolutionEvidence receipt={receipt.data} />
        </>
      );
    case "unavailable":
      return <Unavailable capability={receipt.capability} mode={receipt.mode} />;
    case "error":
      return (
        <div className="text-[13px] text-neg">
          Gagal memuat bukti resolusi: {receipt.error.message}
        </div>
      );
    case "loading":
      return <div className="text-[13px] text-text-muted">Memuat bukti resolusi…</div>;
  }
}

function Shell({children}: {children: React.ReactNode}) {
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>;
}
