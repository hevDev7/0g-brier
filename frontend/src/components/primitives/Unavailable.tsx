import type {Capability, DataMode} from "@/lib/data/types";

const LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Market list",
  MARKET_STATE: "Market state",
  PRICE_HISTORY: "Price history",
  TRADE_TAPE: "Trade history",
  AGENT_POSITIONS: "Agent positions",
  COST_BASIS: "Entry price",
  SETTLEMENT_RECEIPT: "Resolution evidence",
};

/** The lightest mode that provides this capability. */
const PROVIDED_BY: Record<Capability, DataMode> = {
  LIST_MARKETS: "chain",
  MARKET_STATE: "chain",
  PRICE_HISTORY: "indexer",
  TRADE_TAPE: "indexer",
  // AGENT_POSITIONS can be read straight from OutcomeShares on chain — unlike
  // COST_BASIS and SETTLEMENT_RECEIPT, which need event history.
  AGENT_POSITIONS: "chain",
  COST_BASIS: "indexer",
  SETTLEMENT_RECEIPT: "indexer",
};

/**
 * The visual form of the rule that the UI never renders a number the current
 * mode cannot know. Not a spinner (no data is on its way), not a zero (that is a
 * false claim), not a bare dash (that explains nothing).
 *
 * The dashed border is the one place a border style carries meaning here: solid
 * borders enclose data, a dashed one encloses its absence.
 */
export function Unavailable({
  capability,
  mode,
  compact = false,
}: {
  capability: Capability;
  mode: DataMode;
  compact?: boolean;
}) {
  // A table cell cannot hold the full sentence without wrecking the column
  // widths, so inside one it shrinks to the claim itself — still naming the
  // capability, still role="status", with the rest moved to the title. What it
  // must never shrink to is a dash or a zero.
  if (compact) {
    return (
      <span
        role="status"
        title={`${LABELS[capability]} is not available in ${mode} mode — this source keeps no history. Available in ${PROVIDED_BY[capability]} mode.`}
        className="inline-flex items-center rounded border border-dashed border-border-strong px-1.5 py-0.5 text-[11px] whitespace-nowrap text-text-muted"
      >
        {LABELS[capability]} not available
      </span>
    );
  }

  return (
    // role="status" (+ the implied aria-live "polite"): this stands in for the
    // table or number a screen-reader user would normally hear change — without
    // it, the "not available" explanation is only ever seen, never heard.
    <div
      role="status"
      className="rounded-md border border-dashed border-border-strong bg-bg-sunken/50 px-3 py-2 text-[12px] leading-relaxed text-text-muted"
    >
      {/* The label and "not available" are deliberately one text node: getByText
          joins only an element's DIRECT text nodes (see get-node-text.js) and does
          not descend into children — so a phrase that must match together as a
          single string may not be split across elements. */}
      <span className="font-medium text-text">{LABELS[capability]} not available</span> in{" "}
      <span className="font-mono">{mode}</span> mode — this source keeps no history. Available in{" "}
      <span className="font-mono">{PROVIDED_BY[capability]}</span> mode.
    </div>
  );
}
