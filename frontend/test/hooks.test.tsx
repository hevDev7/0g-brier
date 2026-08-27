import {renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {WAD} from "@0g-delphi/protocol";
import {AppProviders} from "@/hooks/provider";
import {useMarket} from "@/hooks/useMarket";
import {useQuote} from "@/hooks/useQuote";
import {useTrades} from "@/hooks/useTrades";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const ADDRESS = FIXTURE_MARKETS[0]!.address;

function wrapper(source: MockSource) {
  return function Wrapper({children}: {children: ReactNode}) {
    return <AppProviders source={source}>{children}</AppProviders>;
  };
}

describe("useMarket", () => {
  it("berpindah dari loading ke ready", async () => {
    const {result} = renderHook(() => useMarket(ADDRESS), {wrapper: wrapper(new MockSource())});
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("diharapkan ready");
    expect(result.current.data.address).toBe(ADDRESS);
  });
});

describe("useTrades", () => {
  it("mengembalikan tape saat kemampuan ada", async () => {
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(new MockSource())});
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  /** Kontrak inti: kemampuan yang absen jadi status `unavailable`, bukan `error`. */
  it("memetakan kemampuan yang hilang jadi unavailable, bukan error", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(limited)});
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    if (result.current.status !== "unavailable") throw new Error("diharapkan unavailable");
    expect(result.current.capability).toBe("TRADE_TAPE");
    expect(result.current.mode).toBe("mock");
  });
});

describe("useQuote", () => {
  const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD];

  it("menghitung lembar dan probabilitas secara sinkron, tanpa RPC", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBeGreaterThan(0n);
    expect(result.current.probBeforeWad).toBe(590_163_934_426_229_508n);
    expect(result.current.probAfterWad).toBeGreaterThan(result.current.probBeforeWad);
  });

  /** Pembelian menaikkan harga, jadi rata-rata WAJIB di atas marginal awal. */
  it("harga rata-rata di atas harga marginal sebelum trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.avgPriceWad).toBeGreaterThan(768_221_279_597_375_842n);
  });

  /** Membeli sisi ini menurunkan payout sisi ini — dilusi, terlihat sebagai angka. */
  it("payout sisi yang dibeli turun setelah trade", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 100n * WAD, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.payoutAfterWad).toBeLessThan(result.current.payoutBeforeWad);
  });

  it("mengembalikan nol untuk belanja nol tanpa melempar", () => {
    const {result} = renderHook(
      () => useQuote({q, outcome: 1, spendWad: 0n, feeBps: 100}),
      {wrapper: wrapper(new MockSource())},
    );
    expect(result.current.sharesOut).toBe(0n);
  });
});
