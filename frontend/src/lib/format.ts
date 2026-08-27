/**
 * The only place the number-formatting rules live (spec §7.2). Components must
 * not format numbers themselves: differing formats between screens is the
 * fastest way for a numbers UI to lose its credibility.
 *
 * Every function goes from bigint to string directly. No Number() and no
 * parseFloat on monetary values — double precision cannot represent a wad
 * value, and silent rounding on money is unacceptable.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds half-up to `places` decimals, purely in bigint. */
function formatFixed(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const factor = 10n ** BigInt(places);
  const scaled = (magnitude * factor + scale / 2n) / scale;
  const whole = groupThousands((scaled / factor).toString());
  const body = places > 0 ? `${whole}.${(scaled % factor).toString().padStart(places, "0")}` : whole;
  return negative && scaled !== 0n ? `-${body}` : body;
}

/** Implied probability (p_i^2) in wad → "59.0%". */
export function formatProbability(probWad: bigint): string {
  return `${formatFixed(probWad * 100n, 18, 1)}%`;
}

/** Probability shift in percentage points, always signed. */
export function formatProbabilityDelta(fromWad: bigint, toWad: bigint): string {
  const delta = (toWad - fromWad) * 100n;
  const body = formatFixed(delta, 18, 1);
  // The sign comes from the already-rounded `body`, not from the raw `delta`:
  // formatFixed suppresses the minus sign when the magnitude rounds to zero, and
  // the sign decision here must agree with that — otherwise a negative shift
  // that rounds to zero would still lose its "+".
  return body.startsWith("-") ? `${body} pt` : `+${body} pt`;
}

/** Payout per share (1/p_i) in wad → "1.30×". */
export function formatPayout(payoutWad: bigint): string {
  return `${formatFixed(payoutWad, 18, 2)}×`;
}

/**
 * A fee in basis points (1 bps = 0.01%) → a percentage rate: 100 → "1.00%".
 *
 * `feeBps` is the one input here that is NOT a monetary bigint — it is a small
 * configuration integer (`MarketDetail.feeBps: number`) — but it is widened to
 * bigint immediately and formatted by `formatFixed` like everything else, so
 * this module has exactly ONE place where a sign is decided.
 *
 * That is the whole point of the shape. The previous version composed
 * `Math.trunc(bps / 100)` with `Math.abs(bps % 100)`, which handled magnitude
 * and sign on separate paths and dropped the sign for -100 < bps < 0:
 * `Math.trunc(-0.5)` is `-0`, and `${-0}` is `"0"`, so -50 bps rendered as
 * "0.50%" while -150 bps rendered correctly as "-1.50%". Sign handling in this
 * file has now leaked twice — the "-0.0" bug, then this one — and both leaks
 * were at a seam between a magnitude path and a sign path. Removing the seam is
 * the fix; a third special case would not have been.
 *
 * 1 bps = 1e-4 = 1e14 wad, so `bps * 1e16` is the rate in wad as a percentage.
 */
export function formatFeeRate(bps: number): string {
  if (!Number.isInteger(bps)) {
    throw new RangeError(`feeBps must be an integer: ${bps}`);
  }
  return `${formatFixed(BigInt(bps) * 10n ** 16n, 18, 2)}%`;
}

/** A collateral amount in the smallest token unit → "1,234.56". */
export function formatCollateral(amount: bigint, decimals: number): string {
  return formatFixed(amount, decimals, 2);
}

/** Outcome shares (18 decimals) → "126.32". */
export function formatShares(sharesWad: bigint): string {
  return formatFixed(sharesWad, 18, 2);
}

/** Price per share in wad → "0.7838". Four decimals: over the 0..1 range, two are not enough. */
export function formatPricePerShare(priceWad: bigint): string {
  return formatFixed(priceWad, 18, 4);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The two largest units; no seconds — second precision implies an accuracy blocks do not have. */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "closed";
  const days = Math.floor(secondsRemaining / 86_400);
  const hours = Math.floor((secondsRemaining % 86_400) / 3_600);
  const minutes = Math.floor((secondsRemaining % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Absolute time, in the reader's local zone. Used for the lifecycle timeline.
 *
 * There is deliberately no special edge-case handling here: 0 is a valid Unix
 * timestamp (the epoch, 1 Jan 1970) and is rendered as such, exactly as
 * formatCollateral(0n, ...) renders "0.00" rather than hiding it — "not yet
 * known" is Query.status's business, not something this function may infer from
 * a numeric value. Dates far in the future (say the year 9999, used by a very
 * loose settlementDeadline) also format without overflow: Date reaches roughly
 * the year 275760, far beyond the timestamp domain of any market here.
 */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
