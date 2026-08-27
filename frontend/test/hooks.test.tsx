import {renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {AppProviders} from "@/hooks/provider";
import {useMarket} from "@/hooks/useMarket";
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
    if (result.current.status !== "ready") throw new Error("diharapkan ready");
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
    if (result.current.status !== "unavailable") throw new Error("diharapkan unavailable");
    expect(result.current.capability).toBe("TRADE_TAPE");
    expect(result.current.mode).toBe("mock");
  });
});

// useQuote was once tested here. Its maths now lives in
// packages/protocol/src/quote.ts — pure, no React — so its tests no longer need
// renderHook either: see packages/protocol/test/quote.test.ts.
