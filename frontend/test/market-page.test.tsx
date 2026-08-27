import {render, screen, waitFor, within} from "@testing-library/react";
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
