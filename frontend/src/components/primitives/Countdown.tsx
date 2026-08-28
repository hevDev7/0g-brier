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
export function Countdown({
  until,
  nowSeconds,
  prefix,
}: {
  until: number;
  nowSeconds?: number;
  /**
   * Shown only while there is time left. It lives here rather than beside the
   * component because a caller writing `closes in <Countdown/>` cannot know
   * whether the instant has passed without reading the clock during render,
   * which React forbids — and doing it anyway is what produced "closes in
   * closed" on every market past its tradingEnd.
   */
  prefix?: string;
}) {
  const [now, setNow] = useState<number | null>(nowSeconds ?? null);

  useEffect(() => {
    if (nowSeconds !== undefined) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    // The display granularity is minutes, so 30 seconds is more than enough.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [nowSeconds]);

  if (now === null) return <span>…</span>;
  const remaining = until - now;
  // Past the instant, a countdown has nothing left to count. It says the window
  // has ended and NOT that the market is closed: `Closed` is an on-chain status
  // a market only reaches when somebody calls `close()`, which nobody is
  // obliged to do promptly. Saying "closed" here put that word beside an `Open`
  // badge on the same row, and on the market page produced "closes in closed".
  if (remaining <= 0) return <span>trading ended</span>;
  return (
    <span>
      {prefix}
      {formatCountdown(remaining)}
    </span>
  );
}
