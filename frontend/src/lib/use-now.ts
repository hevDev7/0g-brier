"use client";

import {useEffect, useState} from "react";

/**
 * The reader's clock, in seconds, or `null` until the browser has one.
 *
 * `null` on the server and on the first client render, deliberately. The server
 * does not know the reader's clock, and a component that guesses shows something
 * wrong and then silently corrects it — which is how a market past its
 * `tradingEnd` came to be painted green and labelled Open.
 *
 * Read it ONCE near the top of a list rather than per row: sixty rows each
 * running their own interval is sixty timers reporting the same second, and they
 * will not agree on which second it is.
 */
export function useNowSeconds(intervalMs = 1_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
