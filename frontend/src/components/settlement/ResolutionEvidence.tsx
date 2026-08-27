import {Badge} from "@/components/primitives/Badge";
import type {Outcome, ResolverVote, SettlementReceipt} from "@/lib/data/types";

function outcomeLabel(outcome: Outcome | null): string {
  if (outcome === null) return "no vote yet";
  return outcome === 1 ? "YES" : "NO";
}

/**
 * One resolver's vote, with the side it took. The committee in this fixture is
 * 2-1 DELIBERATELY — the dissenting resolver is still rendered here, with its own
 * argument visible through `reasoning` below. Hiding the minority vote makes the
 * consensus look more unanimous than it was — the same kind of lie as rendering
 * zero for data that is not known.
 */
function VoteRow({vote, finalOutcome}: {vote: ResolverVote; finalOutcome: Outcome | null}) {
  const dissents = finalOutcome !== null && vote.outcome !== null && vote.outcome !== finalOutcome;
  return (
    <li
      data-testid={`vote-${vote.model}`}
      className="flex items-center justify-between gap-3 py-1.5 text-[13px]"
    >
      <div className="flex items-center gap-2">
        {/* The model name is deliberately ONE element with no other text inside —
            getByText joins only an element's DIRECT text nodes, so a phrase that
            must match the model name exactly may not share an element with other
            text (see the same note in Unavailable.tsx). */}
        <span className="text-text">{vote.model}</span>
        {vote.teeVerified && <Badge tone="verified" label="TEE" />}
      </div>
      <div className="flex items-center gap-2">
        <span className={vote.outcome === 1 ? "text-pos" : vote.outcome === 0 ? "text-neg" : "text-text-faint"}>
          {outcomeLabel(vote.outcome)}
        </span>
        {dissents && <Badge tone="warning" label="Dissent" />}
      </div>
    </li>
  );
}

/**
 * The evidence that makes a resolution inspectable rather than merely trusted:
 * each resolver's vote, the criteria used, the reasoning verbatim, and the
 * sources cited. Two rules that must not be broken (spec F1 Task 6):
 *
 * 1. `reasoning` is shown VERBATIM — it may be folded behind <details>, but never
 *    summarized and never truncated. Summarizing it means the UI is judging the
 *    resolver's argument, and the reader loses precisely the part they wanted to
 *    examine themselves.
 * 2. `simulated: true` must be conspicuous — a stub receipt must never be
 *    mistaken for a real one.
 */
export function ResolutionEvidence({receipt}: {receipt: SettlementReceipt}) {
  return (
    <div data-testid="resolution-evidence" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      {receipt.simulated && (
        <div
          data-testid="simulated-badge"
          role="status"
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-warn"
        >
          Simulated result — not a real resolution by the AI committee
        </div>
      )}

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Resolver votes</h2>
        {receipt.votes.length === 0 ? (
          <p className="text-[13px] text-text-muted">No resolver votes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {receipt.votes.map((v) => (
              <VoteRow key={v.model} vote={v} finalOutcome={receipt.outcome} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Resolution criteria</h2>
        {/* A null outcome means this market IS NOT RESOLVED YET — the empty criteria
            in the PENDING_RECEIPT fixture are not "criteria that happen to be
            short", they genuinely do not exist yet. Rendering an empty
            <p data-testid="criteria"> here would make the panel read as "a
            resolution happened and produced nothing", when the truth is "no
            resolution has happened at all" — the same kind of lie as rendering zero
            for data that is not known. Gated per section (not the whole panel at
            once), just like the resolver-vote and source sections above and below:
            MarketStats.tsx already enforces the same pattern (availability judged
            PER ROW, not per panel) for an identical reason. */}
        {receipt.outcome === null ? (
          <p className="text-[13px] text-text-muted">No criteria yet — this market is not resolved.</p>
        ) : (
          <p data-testid="criteria" className="text-[13px] leading-relaxed text-text">
            {receipt.criteria}
          </p>
        )}
      </div>

      {receipt.outcome === null ? (
        // The "in full, verbatim" <details> is NEVER rendered empty: a disclosure
        // that promises the complete reasoning and then opens onto nothing is
        // exactly the lie rule #1 above forbids.
        <p className="text-[13px] text-text-muted">No resolver reasoning yet — this market is not resolved.</p>
      ) : (
        <div>
          {receipt.judgeModel !== null && (
            // The section is named explicitly ("The reasoning below") so it cannot
            // be confused with the criteria above it — and it sits immediately
            // beside the <details> it refers to, rather than near the vote list, so
            // that "below" points literally at the next element and not at some
            // other section of the page.
            <p className="mb-2 text-[12px] text-text-faint">
              The reasoning below was composed by the judge: {receipt.judgeModel}
            </p>
          )}
          <details data-testid="reasoning" className="text-[13px] leading-relaxed text-text">
            <summary className="cursor-pointer select-none text-text-muted">
              Resolver reasoning — in full, verbatim
            </summary>
            <p className="mt-2 whitespace-pre-wrap">{receipt.reasoning}</p>
          </details>
        </div>
      )}

      <div>
        <h2 className="mb-1 text-[12px] uppercase tracking-wide text-text-faint">Sources</h2>
        {receipt.sources.length === 0 ? (
          <p className="text-[13px] text-text-muted">No sources recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {receipt.sources.map((s) => (
              <li key={s}>
                <a
                  href={s}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[13px] text-accent underline underline-offset-2"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
