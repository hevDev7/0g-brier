import {renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {AppProviders} from "@/hooks/provider";
import {useMarket} from "@/hooks/useMarket";
import {useCandles} from "@/hooks/useCandles";
import {useTrades} from "@/hooks/useTrades";
import {FIXTURE_MARKETS, MockSource} from "@/lib/data/mock";

const ADDRESS = FIXTURE_MARKETS[0]!.address;

function wrapper(source: MockSource) {
  return function Wrapper({children}: {children: ReactNode}) {
    return <AppProviders source={source}>{children}</AppProviders>;
  };
}

describe("useMarket", () => {
  it("moves from loading to ready", async () => {
    const {result} = renderHook(() => useMarket(ADDRESS), {wrapper: wrapper(new MockSource())});
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.address).toBe(ADDRESS);
  });
});

describe("useTrades", () => {
  it("returns the tape when the capability is present", async () => {
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(new MockSource())});
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  /** The core contract: an absent capability becomes status `unavailable`, not `error`. */
  it("maps a missing capability to unavailable, not to error", async () => {
    const limited = new MockSource({omit: ["TRADE_TAPE"]});
    const {result} = renderHook(() => useTrades(ADDRESS, 10), {wrapper: wrapper(limited)});
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    if (result.current.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.current.capability).toBe("TRADE_TAPE");
    expect(result.current.mode).toBe("mock");
  });
});

/**
 * `useCandles` had no test of its own. It mirrors `useTrades`/`useMarket`, both of which are
 * covered, and it is exercised indirectly through the market page — but "it is a copy of a
 * tested thing" is an argument about how the code was written, not about what it does. The
 * interval test below is the part that indirect coverage would not have caught: the page only
 * ever asks for `"1h"`, so a `queryKey` that had been copied across without its `interval`
 * segment would look perfectly healthy there and hand back stale candles the moment anything
 * offered a second interval.
 */
describe("useCandles", () => {
  it("returns candles when the capability is present", async () => {
    const {result} = renderHook(() => useCandles(ADDRESS, "1h"), {wrapper: wrapper(new MockSource())});
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("maps a missing PRICE_HISTORY to unavailable, not to error", async () => {
    const limited = new MockSource({omit: ["PRICE_HISTORY"]});
    const {result} = renderHook(() => useCandles(ADDRESS, "1h"), {wrapper: wrapper(limited)});
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    if (result.current.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.current.capability).toBe("PRICE_HISTORY");
    expect(result.current.mode).toBe("mock");
  });

  /**
   * Two intervals over one market must not share a cache entry. Rendered inside a single
   * provider so both hooks meet the same QueryClient — with two providers each would get its
   * own cache and the test would pass whatever the key looked like.
   */
  it("keys the cache by interval, so two intervals do not collide", async () => {
    const source = new MockSource();
    const Wrapper = wrapper(source);
    const {result} = renderHook(
      () => ({hourly: useCandles(ADDRESS, "1h"), daily: useCandles(ADDRESS, "1d")}),
      {wrapper: Wrapper},
    );
    await waitFor(() => {
      expect(result.current.hourly.status).toBe("ready");
      expect(result.current.daily.status).toBe("ready");
    });
    if (result.current.hourly.status !== "ready" || result.current.daily.status !== "ready") {
      throw new Error("expected both ready");
    }
    // The fixture is 24 hourly trades: 24 hourly buckets against 2 daily ones.
    expect(result.current.daily.data.length).toBe(2);
    expect(result.current.hourly.data.length).toBeGreaterThan(result.current.daily.data.length);
  });
});

// useQuote was once tested here. Its maths now lives in
// packages/protocol/src/quote.ts — pure, no React — so its tests no longer need
// renderHook either: see packages/protocol/test/quote.test.ts.
