import {Database} from "lucide-react";
import {toTokensFloor} from "@0g-delphi/protocol";
import {Panel, PanelHeader, Row} from "@/components/primitives/Panel";
import {Skeleton} from "@/components/primitives/Skeleton";
import {Unavailable} from "@/components/primitives/Unavailable";
import {formatCollateral, formatFeeRate, shortAddress} from "@/lib/format";
import {volumeOf} from "@/lib/market-rows";
import type {MarketDetail, Query, Trade} from "@/lib/data/types";

/**
 * Registry facts about a market, with availability evaluated PER ROW rather than
 * per panel (spec §2). Every row but one comes from `market: MarketDetail` —
 * MARKET_STATE, which any mode can answer — so they are always populated. Only
 * volume depends on `trades`, because only events record what was traded
 * (TRADE_TAPE), which `chain` mode cannot answer. Were availability judged per
 * PANEL, this whole panel would go dark whenever volume is unknown: four facts
 * we have thrown away for one we do not.
 *
 * The lifecycle dates are NOT here; they live in `<Lifecycle>`, which shows them
 * as a sequence with the dispute window named. Listing them in both places meant
 * a reader had to check whether the two agreed.
 */
export function MarketStats({market, trades}: {market: MarketDetail; trades: Query<Trade[]>}) {
  const decimals = market.collateral.decimals;
  // floor, not ceil: this is a reading of pool liquidity, not funds moving in.
  // Rounding up would claim more collateral backs the market than actually does.
  const depth = toTokensFloor(market.poolWad, decimals);

  return (
    <Panel testId="market-stats">
      <PanelHeader eyebrow="Registry facts" title="Market statistics" icon={Database} />
      <div className="flex flex-col gap-2.5 p-4 md:p-5">
        <Row label="Volume" testId="stat-volume">
          <VolumeValue trades={trades} market={market} />
        </Row>
        <Row label="Depth" testId="stat-liquidity">
          <span className="font-mono">
            {formatCollateral(depth, decimals)}{" "}
            <span className="text-text-muted">{market.collateral.symbol}</span>
          </span>
        </Row>
        <Row label="Fee" testId="stat-fee">
          <span className="font-mono">{formatFeeRate(market.feeBps)}</span>
        </Row>
        <Row label="Collateral" testId="stat-collateral">
          <span className="font-mono" title={market.collateral.address}>
            {market.collateral.symbol}
          </span>
        </Row>
        <Row label="Creator" testId="stat-creator">
          <span className="font-mono" title={market.creator}>
            {shortAddress(market.creator)}
          </span>
        </Row>
        {/* The spec blob itself lives in 0G Storage and that integration does not
            exist yet, so this is the hash and nothing more — deliberately not a
            link, which would promise a viewer this page does not have. */}
        <Row label="Spec root" testId="stat-spec-root">
          <span className="font-mono text-text-muted" title={market.specRoot}>
            {shortAddress(market.specRoot)}
          </span>
        </Row>
      </div>
    </Panel>
  );
}

/**
 * An explicit non-nullable return type and no `default` on purpose. Under
 * `strict`, a function that falls off the end of a switch returns `undefined`,
 * which is not assignable to `React.JSX.Element` — so deleting a `case` fails to
 * compile (TS2366). Without the annotation TypeScript quietly infers
 * `| undefined` and the exhaustiveness guarantee evaporates; adding a `default`
 * destroys it just as thoroughly.
 */
function VolumeValue({
  trades,
  market,
}: {
  trades: Query<Trade[]>;
  market: MarketDetail;
}): React.JSX.Element {
  switch (trades.status) {
    case "ready":
      return (
        <span className="font-mono">
          {formatCollateral(volumeOf(trades.data), market.collateral.decimals)}{" "}
          <span className="text-text-muted">{market.collateral.symbol}</span>
        </span>
      );
    case "unavailable":
      return <Unavailable capability={trades.capability} mode={trades.mode} compact />;
    case "error":
      return <span className="text-neg">Failed to load</span>;
    case "loading":
      return <Skeleton className="h-3 w-20" />;
  }
}
