import {render, screen, waitFor, within} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {MarketView} from "@/app/market/[address]/MarketView";
import {AppProviders} from "@/hooks/provider";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const OPEN = FIXTURE_MARKETS[0]!.address;
const SETTLED = FIXTURE_MARKETS.find((m) => m.status === "Settled")!.address;

function renderMarket(source = new MockSource(), address = OPEN) {
  return render(
    <AppProviders source={source}>
      <MarketView address={address} />
    </AppProviders>,
  );
}

describe("MarketView", () => {
  it("merender pertanyaan, probabilitas, dan payout", async () => {
    renderMarket();
    // Fixture pertama menyebut "ETH/USD" baik di pertanyaan (h1) maupun di teks
    // aturan penyelesaian — getByText teks polos jadi ambigu. Query berbasis role
    // menyasar heading pertanyaannya secara spesifik, sesuai maksud uji ini.
    await waitFor(() =>
      expect(screen.getByRole("heading", {name: /ETH\/USD/})).toBeInTheDocument(),
    );
    // Sejak fixtureTrades() diperbaiki supaya konvergen ke q pasar, trade
    // TERBARU di tape juga menunjukkan P(YES) 59.0% — dengan sengaja, bukan
    // kebetulan (lihat mock-source.test.ts). getByText("59.0%") polos jadi
    // ambigu karena itu; scope ke panel probabilitas secara spesifik.
    await waitFor(() =>
      expect(within(screen.getByTestId("probability-panel")).getByText("59.0%")).toBeInTheDocument(),
    );
    expect(screen.getByText("1.30×")).toBeInTheDocument();
  });

  /**
   * Keputusan produk (spec §1 F3), bukan selera tata letak: eksekusi hidup di
   * `@0g-delphi/agent-kit`, jadi halaman manusia tidak boleh punya kontrol
   * eksekusi sama sekali — bukan disembunyikan, bukan dinonaktifkan, ABSEN.
   * Tombol yang dinonaktifkan tetap menjanjikan sesuatu yang tak akan pernah
   * ada di sini.
   */
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

  /**
   * Uji yang paling mudah terlupa dan paling penting: di mode terbatas, panel
   * yang datanya tak bisa diketahui menampilkan penjelasan, BUKAN tabel kosong
   * dan bukan nol.
   */
  it("menjelaskan kapabilitas yang absen, bukan merender tabel kosong", async () => {
    renderMarket(new MockSource({omit: ["AGENT_POSITIONS"]}));
    expect(await screen.findByText(/posisi agent.*tidak tersedia/i)).toBeInTheDocument();
    expect(screen.queryByTestId("positions-table")).not.toBeInTheDocument();
  });

  it("menampilkan Unavailable, bukan nol, saat tape tidak tersedia", async () => {
    renderMarket(new MockSource({omit: ["TRADE_TAPE"]}));
    await waitFor(() =>
      expect(screen.getAllByText(/riwayat transaksi.*tidak tersedia/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("trade-tape")).toBeNull();
  });

  it("menampilkan Unavailable, bukan grafik kosong, saat riwayat harga tidak tersedia", async () => {
    renderMarket(new MockSource({omit: ["PRICE_HISTORY"]}));
    await waitFor(() =>
      expect(screen.getByText(/riwayat harga.*tidak tersedia/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("probability-chart")).toBeNull();
  });

  /** Market yang sudah diselesaikan: putusan komite DAN bukti yang bisa diperiksa. */
  it("market Settled menampilkan hasil akhir dan bukti resolusinya", async () => {
    renderMarket(new MockSource(), SETTLED);
    expect(await screen.findByTestId("final-outcome")).toBeInTheDocument();
    expect(await screen.findByTestId("resolution-evidence")).toBeInTheDocument();
  });

  it("market yang masih terbuka tidak menampilkan panel penyelesaian", async () => {
    renderMarket();
    expect(await screen.findByTestId("market-stats")).toBeInTheDocument();
    expect(screen.queryByTestId("final-outcome")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resolution-evidence")).not.toBeInTheDocument();
  });
});
