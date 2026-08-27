"use client";
import {useEffect, useState} from "react";
import {formatCountdown} from "@/lib/format";

/**
 * `nowSeconds` is injected so this can be tested deterministically; when present,
 * the effect below is skipped entirely.
 *
 * Without that injection the wall clock is read in an EFFECT, not during render.
 * Reading it during render violates `react-hooks/purity` — and not because of a
 * fussy lint rule: the render result would then depend on when it was called, so
 * server and client could produce different numbers for the same input.
 *
 * Before the effect runs, this component renders an ellipsis, not a number. The
 * server genuinely DOES NOT KNOW the reader's clock, and guessing means showing a
 * wrong countdown and then silently correcting it.
 */
export function Countdown({until, nowSeconds}: {until: number; nowSeconds?: number}) {
  const [now, setNow] = useState<number | null>(nowSeconds ?? null);

  useEffect(() => {
    if (nowSeconds !== undefined) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    // The display granularity is minutes, so 30 seconds is more than enough.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nowSeconds]);

  return <span>{now === null ? "…" : formatCountdown(until - now)}</span>;
}
