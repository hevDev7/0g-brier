import type {Capability, DataMode} from "@/lib/data/types";

/**
 * Exported so the source-notes disclosure and the observation legend name a
 * capability exactly as the `unavailable` cell does. A second copy of these
 * strings is how a reader ends up told about "Trade history" in one place and
 * "Trade tape" in another, for the same missing thing.
 */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  LIST_MARKETS: "Market list",
  MARKET_STATE: "Market state",
  PRICE_HISTORY: "Price history",
  TRADE_TAPE: "Trade history",
  AGENT_POSITIONS: "Agent positions",
  AGENT_BALANCE: "Free collateral",
  COST_BASIS: "Entry price",
  MARKET_SPEC_BLOB: "Question and rules",
  SETTLEMENT_RECEIPT: "Resolution evidence",
};

/**
 * Why a capability can be missing, and the lightest mode that supplies it.
 *
 * `provider: null` means NO implemented mode supplies it, and the sentence then
 * stops after the reason instead of promising a mode. Exported so a test can
 * check each `provider` against what that mode's DataSource actually declares —
 * a claim about another mode is the one thing this component cannot verify for
 * itself. Two entries here used to
 * name `indexer`, which produced the flatly self-contradicting line a live page
 * showed: "Resolution evidence not available in indexer mode … Available in
 * indexer mode."
 */
export const WHY: Record<Capability, {reason: string; provider: DataMode | null}> = {
  LIST_MARKETS: {reason: "this source cannot reach the chain", provider: "chain"},
  MARKET_STATE: {reason: "this source cannot reach the chain", provider: "chain"},
  PRICE_HISTORY: {reason: "this source keeps no history", provider: "indexer"},
  TRADE_TAPE: {reason: "this source keeps no history", provider: "indexer"},
  // AGENT_POSITIONS was listed as `chain` here, and in the spec's §2 table, on the
  // grounds that `OutcomeShares.balanceOfOutcome` is a plain view. That holds for
  // ONE KNOWN account — but `DataSource.getPositions(market)` returns every agent's
  // position, and enumerating holders is precisely what a view cannot do. The set
  // of holders lives in transfer events, so this needs an indexer like the rest.
  AGENT_POSITIONS: {reason: "this source keeps no history", provider: "indexer"},
  // The mirror image of the note above, and the reason this one really is
  // `chain`: `IERC20.balanceOf(agent)` is a view, so ONE KNOWN agent's balance
  // needs no indexer. Discovering WHICH agents exist still does — which is why a
  // leaderboard is indexer-tier as a whole even though this column is not.
  AGENT_BALANCE: {reason: "this source cannot reach the chain", provider: "chain"},
  COST_BASIS: {reason: "this source keeps no history", provider: "indexer"},
  // Not a matter of mode at all, which is why there is no mode to point at. Only
  // `specRoot` is on chain; the question and rules are a 0G Storage document, and
  // either no storage indexer is configured or nothing was ever stored at that
  // root. The second case is a market that genuinely has no readable question —
  // no mode can fix it.
  MARKET_SPEC_BLOB: {
    reason: "no 0G Storage indexer is configured, or nothing is stored at this market's specRoot",
    provider: null,
  },
  // No mode supplies this yet: the receipt is a 0G Storage document and the
  // contract holds no root to fetch it by. `mock` has one because a fixture can
  // invent anything.
  SETTLEMENT_RECEIPT: {
    reason: "the settlement receipt is a 0G Storage document and no root for it is on chain yet",
    provider: null,
  },
};

/**
 * One sentence, built once. The compact badge puts it in a `title` and the panel
 * renders it, and the two saying different things is how a reader gets a
 * different explanation depending on where they hover.
 */
function explain(capability: Capability, mode: DataMode): string {
  const {reason, provider} = WHY[capability];
  const sentence = `${CAPABILITY_LABELS[capability]} is not available in ${mode} mode — ${reason}.`;
  // Never point at the mode the reader is already in.
  return provider && provider !== mode ? `${sentence} Available in ${provider} mode.` : sentence;
}

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
        title={explain(capability, mode)}
        // `whitespace-nowrap` kept the badge on one line and let it spill into the
        // next grid column — "Trade history not available" printed straight across
        // the depth figure beside it. A badge may wrap; overlapping a neighbouring
        // value is how two unrelated numbers get read as one.
        className="inline-flex max-w-full items-center rounded border border-dashed border-border-strong px-1.5 py-0.5 text-left text-[12px] text-text-muted"
      >
        {CAPABILITY_LABELS[capability]} not available
      </span>
    );
  }

  return (
    // role="status" (+ the implied aria-live "polite"): this stands in for the
    // table or number a screen-reader user would normally hear change — without
    // it, the "not available" explanation is only ever seen, never heard.
    <div
      role="status"
      className="rounded-md border border-dashed border-border-strong bg-bg-sunken/50 px-3 py-2 text-[13px] leading-relaxed text-text-muted"
    >
      {/* The label and "not available" are deliberately one text node: getByText
          joins only an element's DIRECT text nodes (see get-node-text.js) and does
          not descend into children — so a phrase that must match together as a
          single string may not be split across elements. */}
      <span className="font-medium text-text">{CAPABILITY_LABELS[capability]} not available</span> in{" "}
      <span className="font-mono">{mode}</span> mode — {WHY[capability].reason}.
      {WHY[capability].provider && WHY[capability].provider !== mode && (
        <>
          {" "}
          Available in <span className="font-mono">{WHY[capability].provider}</span> mode.
        </>
      )}
    </div>
  );
}
