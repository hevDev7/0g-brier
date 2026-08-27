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
