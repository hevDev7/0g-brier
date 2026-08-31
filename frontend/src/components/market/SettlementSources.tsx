import {Crosshair} from "lucide-react";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import {Unavailable} from "@/components/primitives/Unavailable";
import type {DataMode, MarketDetail} from "@/lib/data/types";

/**
 * The feeds that will decide this market, shown from the moment it opens.
 *
 * These were only ever visible inside the settlement report — which opens after
 * the market has settled, when knowing them is too late to act on. For a price
 * question that gap is the whole argument: Coinbase, Binance and Kraken quote
 * the same asset tens of dollars apart, and a trader who assumed one venue and
 * got another has a grievance nothing on chain can answer. Every dispute of
 * that kind is a fact that was knowable at creation and simply not shown.
 *
 * The HOST leads, because that is the part that decides the answer. The rest of
 * the URL — the pinned minute, the granularity — is the part a reader checks
 * second, so it sits underneath in full and is copyable rather than truncated
 * away. The selector is shown as written: `$[0][4]` is not decoration, it names
 * which number in the response is read, and a market that reads the high rather
 * than the close is a different market.
 */
export function SettlementSources({market, mode}: {market: MarketDetail; mode: DataMode}) {
  return (
    <Panel testId="settlement-sources">
      <PanelHeader
        eyebrow="What decides it"
        title="Settlement sources"
        icon={Crosshair}
      />
      {market.sources === null ? (
        // Not "this market names no source" — that would be a claim about the
        // market. The spec could not be read here, which is a claim about this
        // page, and the two must not be confused for one another.
        <div className="p-4 md:p-5">
          <Unavailable capability="MARKET_SPEC_BLOB" mode={mode} />
        </div>
      ) : market.sources.length === 0 ? (
        <p className="p-4 text-[14px] leading-relaxed text-text-muted md:p-5">
          This market names no external source. Its question is answered from the chain&rsquo;s
          own state, so there is no feed to disagree about.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {market.sources.map((source, i) => (
            <li key={`${source.url}-${i}`} className="flex flex-col gap-1.5 p-4 md:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[13.5px] break-all text-text">{hostOf(source.url)}</span>
                {market.sources!.length > 1 && (
                  <span className="shrink-0 font-mono text-[11px] tracking-wider text-text-faint uppercase">
                    source {i}
                  </span>
                )}
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11.5px] leading-relaxed break-all text-text-muted underline decoration-border underline-offset-2 hover:text-text hover:decoration-text-faint"
              >
                {source.url}
              </a>
              {source.selector !== null && (
                <p className="text-[12px] text-text-faint">
                  reads <code className="font-mono text-text-muted">{source.selector}</code> from the response
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The host, or the whole string when it is not a URL at all.
 *
 * A spec is a document somebody else wrote, so `source.url` is not guaranteed to
 * parse — and throwing here would take the settlement rules, the statistics and
 * the lifecycle down with it, over a cosmetic line.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
