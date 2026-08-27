import {render, screen} from "@testing-library/react";
import {describe, expect, it} from "vitest";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {CopyAddress} from "@/components/primitives/CopyAddress";
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
