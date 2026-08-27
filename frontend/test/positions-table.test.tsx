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

  // Ruling R-F1-1 (task-5 kontroler): Task 7 merakit panel ini ke halaman dan
  // ujinya bergantung pada `screen.findByTestId("positions-table")` di elemen
  // terluar panel — di KEDUA cabang, baik terisi maupun kosong.
  it("elemen terluar membawa data-testid positions-table saat terisi", () => {
    render(<PositionsTable positions={positions} market={m} mode="mock" />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
  });

  it("elemen terluar membawa data-testid positions-table saat kosong", () => {
    render(<PositionsTable positions={[]} market={m} mode="mock" />);
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
  });
});
