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
