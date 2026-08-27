import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {MarketStats} from "@/components/market/MarketStats";
import {FIXTURE_MARKETS} from "@/lib/data/mock";
import {formatTimestamp} from "@/lib/format";
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

  // Ruling R-F1-1 (task-4 kontroler): Task 7 merakit panel ini ke halaman dan
  // ujinya bergantung pada `screen.findByTestId("market-stats")` di elemen
  // terluar panel.
  it("elemen terluar panel membawa data-testid market-stats", () => {
    render(<MarketStats market={m} trades={{status: "loading"}} />);
    expect(screen.getByTestId("market-stats")).toBeInTheDocument();
  });
});

describe("formatTimestamp", () => {
  // Dua bug tanda sebelumnya di format.ts (formatProbabilityDelta "-0.0", lalu
  // formatFeeRate kehilangan tanda pada input negatif) adalah alasan kasus tepi
  // di sini diuji eksplisit, bukan diasumsikan aman karena fungsinya "cuma"
  // membungkus Date.toLocaleString.
  //
  // Assertion sengaja TIDAK mem-pin string lokal-waktu persis (hari/jam
  // bergantung zona waktu mesin yang menjalankan test — lihat chart.ts, yang
  // memakai toLocaleDateString tanpa memin string persis dengan alasan yang
  // sama). Yang dikunci di sini adalah KEPUTUSAN perilaku di tepi: fungsi
  // tidak pernah menghasilkan "Invalid Date" / "NaN", dan tahunnya utuh.

  it("unixSeconds 0 dirender sebagai epoch sungguhan, bukan placeholder", () => {
    // 0 adalah timestamp Unix yang sah (1 Jan 1970) — formatTimestamp tidak
    // mengetahui apa pun tentang "belum diketahui"; itu urusan Query.status,
    // bukan urusan nilai numerik. Jadi 0 diformat apa adanya, sama seperti
    // formatCollateral(0n, ...) merender "0.00", bukan disembunyikan.
    const out = formatTimestamp(0);
    expect(out).not.toBe("Invalid Date");
    expect(out).not.toMatch(/nan/i);
    expect(out).toMatch(/19(69|70)/); // epoch, tahun tepat gantung zona waktu mesin
  });

  it("tanggal jauh di masa depan tetap terformat, tidak overflow", () => {
    // Tengah tahun & tengah hari UTC sengaja dipakai (bukan tengah malam/akhir
    // tahun) supaya offset zona waktu (-12..+14 jam) mana pun tidak pernah
    // menggeser tanggal ke tahun lain — angka tahun aman dipin di sini.
    const farFuture = Math.floor(Date.UTC(9999, 5, 15, 12, 0, 0) / 1000);
    const out = formatTimestamp(farFuture);
    expect(out).not.toBe("Invalid Date");
    expect(out).not.toMatch(/nan/i);
    expect(out).toContain("9999");
  });
});
