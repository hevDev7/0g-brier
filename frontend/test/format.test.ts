import {describe, expect, it} from "vitest";
import {
  formatCollateral, formatCountdown, formatFeeRate, formatPayout, formatPricePerShare,
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

  it("tidak pernah menampilkan negatif nol", () => {
    expect(formatProbabilityDelta(1n, 0n)).toBe("+0.0 pt");
    expect(formatProbabilityDelta(0n, 1n)).toBe("+0.0 pt");
  });
});

describe("formatPayout", () => {
  it("2 desimal dengan tanda kali", () => {
    expect(formatPayout(1_301_700_000_000_000_000n)).toBe("1.30×");
    expect(formatPayout(1_562_000_000_000_000_000n)).toBe("1.56×");
  });
});

describe("formatFeeRate", () => {
  it("basis poin ke tarif persen 2 desimal", () => {
    expect(formatFeeRate(100)).toBe("1.00%");
    expect(formatFeeRate(1)).toBe("0.01%");
    expect(formatFeeRate(250)).toBe("2.50%");
    expect(formatFeeRate(10_000)).toBe("100.00%");
    expect(formatFeeRate(0)).toBe("0.00%");
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
