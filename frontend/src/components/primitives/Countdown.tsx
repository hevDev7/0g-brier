import {formatCountdown} from "@/lib/format";

/**
 * `nowSeconds` disuntik agar bisa diuji secara deterministik. Tanpa itu, uji
 * hitung mundur bergantung pada jam dinding dan akan flaky.
 */
export function Countdown({until, nowSeconds}: {until: number; nowSeconds?: number}) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return <span>{formatCountdown(until - now)}</span>;
}
