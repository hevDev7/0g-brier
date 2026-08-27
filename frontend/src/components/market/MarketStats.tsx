import {toTokensFloor} from "@0g-delphi/protocol";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatCollateral, formatFeeRate, formatTimestamp} from "@/lib/format";
import type {MarketDetail, Query, Trade} from "@/lib/data/types";

/**
 * Tujuh fakta market, tapi ketersediaan dievaluasi PER BARIS, bukan per panel
 * (spec §2). Enam berasal dari `market: MarketDetail` — MARKET_STATE, yang
 * bisa dijawab mode apa pun — jadi lima baris di bawah (fee, likuiditas,
 * dibuat, tutup, batas settle) selalu terisi begitu `market` ada. Hanya baris
 * volume bergantung pada `trades: Query<Trade[]>`, karena hanya event yang
 * menyimpan apa yang diperdagangkan (TRADE_TAPE) — mode `chain` tidak bisa
 * menjawabnya. Kalau ketersediaan dievaluasi per PANEL, seluruh panel ini
 * gelap setiap kali volume tak diketahui: enam fakta yang kita punya dibuang
 * demi satu yang tidak. Jadi hanya `stat-volume` yang boleh merender
 * `<Unavailable>`; lima baris lainnya tidak pernah menanyakan status `trades`
 * sama sekali.
 */
export function MarketStats({market, trades}: {market: MarketDetail; trades: Query<Trade[]>}) {
  const decimals = market.collateral.decimals;
  // floor, bukan ceil: ini bacaan likuiditas pool, bukan transfer dana masuk.
  // Membulatkan ke atas akan mengklaim collateral lebih banyak dari yang
  // benar-benar membekingi market — floor menjaga angka ini tidak pernah
  // melebih-lebihkan apa yang sungguh ada, senada dengan alasan toTokensFloor
  // dipakai untuk arah "dana keluar" di units.ts.
  const liquidityTokens = toTokensFloor(market.poolWad, decimals);

  return (
    <div
      data-testid="market-stats"
      className="flex flex-col gap-1.5 rounded-lg border border-border p-4"
    >
      <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Statistik market</h2>
      <Row testId="stat-volume" label="Volume">
        {volumeRow(trades, market)}
      </Row>
      <Row testId="stat-fee" label="Fee">
        <span>{formatFeeRate(market.feeBps)}</span>
      </Row>
      <Row testId="stat-liquidity" label="Likuiditas">
        <span>{formatCollateral(liquidityTokens, decimals)}</span>
      </Row>
      <Row testId="stat-created" label="Dibuat">
        <span>{formatTimestamp(market.createdAt)}</span>
      </Row>
      <Row testId="stat-closes" label="Tutup">
        <span>{formatTimestamp(market.tradingEnd)}</span>
      </Row>
      <Row testId="stat-settles-by" label="Batas settle">
        <span>{formatTimestamp(market.settlementDeadline)}</span>
      </Row>
    </div>
  );
}

/**
 * Diekstrak jadi switch atas `trades.status` dengan tipe kembalian
 * non-nullable eksplisit (`React.JSX.Element`) SENGAJA — bukan gaya. Di
 * bawah `strict`, fungsi yang jatuh dari akhir switch tanpa `return`
 * mengembalikan `undefined`, dan `undefined` tak bisa ditetapkan ke
 * `React.JSX.Element` (TS2366): menghapus satu `case` gagal kompilasi. Tanpa
 * anotasi ini TypeScript diam-diam menyimpulkan `| undefined` dan jaminan
 * exhaustiveness-nya lenyap — persis defect yang sama yang pernah ditemukan
 * dan diperbaiki di `MarketView.renderTrades`.
 *
 * SENGAJA TIDAK ADA `default`: menambahkannya melucuti exhaustiveness check
 * ini sendiri.
 */
function volumeRow(trades: Query<Trade[]>, m: MarketDetail): React.JSX.Element {
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

function Row({testId, label, children}: {testId: string; label: string; children: React.ReactNode}) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
