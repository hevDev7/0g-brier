import {ShieldCheck} from "lucide-react";
import {Badge} from "@/components/primitives/Badge";
import {Panel, PanelHeader} from "@/components/primitives/Panel";
import type {Outcome, ResolverVote, SettlementReceipt} from "@/lib/data/types";

function outcomeLabel(outcome: Outcome | null): string {
  if (outcome === null) return "no vote yet";
  return outcome === 1 ? "YES" : "NO";
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="border-t border-border px-4 py-3.5 md:px-5">
      <h3 className="eyebrow mb-2 text-text-faint">{title}</h3>
      {children}
    </div>
  );
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
      className="flex items-center justify-between gap-3 py-2 text-[14px]"
    >
      <span className="flex items-center gap-2">
        {/* The model name is deliberately ONE element with no other text inside —
            getByText joins only an element's DIRECT text nodes, so a phrase that
            must match the model name exactly may not share an element with other
            text (see the same note in Unavailable.tsx). */}
        <span className="font-mono text-[13px] text-text">{vote.model}</span>
        {vote.teeVerified && <Badge tone="verified" label="TEE" />}
      </span>
      <span className="flex items-center gap-2">
        <span
          className={`font-mono text-[13px] ${
            vote.outcome === 1 ? "text-pos" : vote.outcome === 0 ? "text-neg" : "text-text-faint"
          }`}
        >
          {outcomeLabel(vote.outcome)}
        </span>
        {dissents && <Badge tone="warning" label="Dissent" />}
      </span>
    </li>
  );
}

const ZERO = "0x0000000000000000000000000000000000000000";

function InferenceProvenance({receipt}: {receipt: SettlementReceipt}) {
  const attested = receipt.votes.some((v) => v.teeVerified);
  const provider = receipt.provider.toLowerCase() === ZERO ? null : receipt.provider;

  if (receipt.route === "0g-compute" || provider !== null) {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="leading-relaxed text-text-muted">
          {attested ? (
            <>
              Run on <span className="text-text">0G Compute</span> inside a TEE. The attestation says
              this provider ran this model over this input — not that the answer is right.
            </>
          ) : (
            <>
              Run on <span className="text-text">0G Compute</span>, but{" "}
              <span className="text-warn">no attestation could be established</span>. Treat it as
              unverified: a provider that cannot attest is a remote API.
            </>
          )}
        </p>
        <Field label="Provider" value={provider ?? "not recorded"} />
        <Field label="Request" value={receipt.chatId ?? "not recorded"} />
      </div>
    );
  }

  return (
    <p data-testid="no-attestation" className="text-[13px] leading-relaxed text-warn">
      No attestation. This judgement was made on a private endpoint
      {receipt.route === null ? "" : ` (${receipt.route})`}, and nothing on chain or in this
      document lets you check which model ran or what it was given. The reasoning and the sources
      below are still verbatim — but they are the resolver&rsquo;s own account of itself.
    </p>
  );
}

function Field({label, value}: {label: string; value: string}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-[12px] break-all text-text">{value}</span>
    </p>
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
    <Panel testId="resolution-evidence" className="overflow-hidden">
      <PanelHeader eyebrow="Settlement record" title="Resolution evidence" icon={ShieldCheck} />

      {receipt.simulated && (
        <div
          data-testid="simulated-badge"
          role="status"
          className="border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-[12px] font-semibold tracking-wide text-warn uppercase md:px-5"
        >
          Simulated result — not a real resolution by the AI committee
        </div>
      )}

      <Section title="Resolver votes">
        {receipt.votes.length === 0 ? (
          // "Yet" is only true before a decision. Once the market is resolved with
          // no models named, none were consulted and none ever will be for this
          // settlement — promising a list that cannot arrive is the same defect as
          // rendering a zero for something unknown.
          <p className="text-[14px] text-text-muted">
            {receipt.outcome === null
              ? "No resolver votes yet."
              : "No models were consulted for this settlement."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {receipt.votes.map((v) => (
              <VoteRow key={v.model} vote={v} finalOutcome={receipt.outcome} />
            ))}
          </ul>
        )}
      </Section>

      {/*
        WHAT BACKS THE BADGE. A "TEE" chip beside a model name is a claim this page
        makes; what makes it checkable is the provider that ran it and the request
        id under which the attestation is recorded. Both were parsed into the
        receipt and neither was ever rendered, so the strongest thing the protocol
        can say about a settlement reached the screen as four characters and no way
        to follow them up.

        The absence is said OUT LOUD rather than left as a missing chip. A reader
        does not notice a badge that is not there, and "this ran somewhere nobody
        can check" is the fact they most need when it is true.
      */}
      <Section title="Where the judgement ran">
        <InferenceProvenance receipt={receipt} />
      </Section>

      <Section title="Resolution criteria">
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
          <p className="text-[14px] text-text-muted">
            No criteria yet — this market is not resolved.
          </p>
        ) : receipt.criteria === null ? (
          // Resolved, but the resolver stated no criteria of its own. Filling this
          // in from the MarketSpec would be the report answering its own question:
          // whether the resolver judged against what was promised is the thing the
          // reader came to check, and it cannot be checked against a copy.
          <p className="text-[14px] text-text-muted">
            The resolver recorded no criteria of its own — compare what the market promised.
          </p>
        ) : (
          <p data-testid="criteria" className="text-[14px] leading-relaxed text-text">
            {receipt.criteria}
          </p>
        )}
      </Section>

      <Section title="Resolver reasoning">
        {receipt.outcome === null ? (
          // The "in full, verbatim" <details> is NEVER rendered empty: a disclosure
          // that promises the complete reasoning and then opens onto nothing is
          // exactly the lie rule #1 above forbids.
          <p className="text-[14px] text-text-muted">
            No resolver reasoning yet — this market is not resolved.
          </p>
        ) : (
          <>
            {receipt.judgeModel !== null && (
              // The section is named explicitly ("The reasoning below") so it cannot
              // be confused with the criteria above it — and it sits immediately
              // beside the <details> it refers to, rather than near the vote list, so
              // that "below" points literally at the next element and not at some
              // other section of the page.
              // The judge's name shares this paragraph's text node ON PURPOSE and
              // must not be wrapped in an element of its own: the judge is
              // usually also one of the voters, and giving its name a dedicated
              // element makes `getByText("<model>")` match twice — once in the
              // vote list, once here — which is ambiguous rather than wrong.
              <p className="mb-2 font-mono text-[12px] text-text-faint">
                Reasoning below composed by the judge: {receipt.judgeModel}
              </p>
            )}
            <details data-testid="reasoning" className="text-[14px] leading-relaxed text-text">
              <summary className="cursor-pointer text-text-muted select-none">
                Resolver reasoning — in full, verbatim
              </summary>
              <p className="mt-2 whitespace-pre-wrap">{receipt.reasoning}</p>
            </details>
          </>
        )}
      </Section>

      <Section title="Sources">
        {receipt.sources.length === 0 ? (
          <p className="text-[14px] text-text-muted">
            {receipt.outcome === null
              ? "No sources recorded yet."
              : "The resolver cited no sources."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {receipt.sources.map((s) => (
              <li key={s}>
                <a
                  href={s}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] break-all text-accent underline underline-offset-2"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Panel>
  );
}
