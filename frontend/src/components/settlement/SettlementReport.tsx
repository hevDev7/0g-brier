"use client";

import {useEffect, useRef, useState} from "react";
import {FileText, X} from "lucide-react";
import {Badge} from "@/components/primitives/Badge";
import {ErrorNote} from "@/components/primitives/QueryStates";
import {Unavailable} from "@/components/primitives/Unavailable";
import {ResolutionEvidence} from "@/components/settlement/ResolutionEvidence";
import {payoutPerShareWad} from "@/lib/dpm-view";
import {formatPayout} from "@/lib/format";
import type {DataMode, MarketDetail, Outcome, Query, SettlementReceipt} from "@/lib/data/types";

/**
 * A settlement report has two halves, and keeping them apart is the whole point.
 *
 * WHAT WAS PROMISED comes from the MarketSpec on 0G Storage — the criteria, the
 * prompt the resolver was committed to, and the sources it was pointed at. Those
 * bytes are verified against `specRoot` before they reach this component, so the
 * reader is looking at the document the market was created under, not at
 * whatever a server chose to serve.
 *
 * WHAT THE RESOLVER DID comes from the settlement receipt. Today no mode outside
 * the fixtures can produce one: `settle(uint8)` stores the outcome and the
 * timestamp and anchors no receipt, so there is no root to fetch a record by.
 * That half therefore reports itself unavailable on a live market rather than
 * inventing an analyst panel that never sat.
 *
 * Judging a settlement means comparing the two. A report that fused them into
 * one list would let a resolver's account of the rules stand in for the rules
 * themselves — which is exactly the substitution the reader is here to check.
 */

function Field({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="border-t border-border px-4 py-3.5 md:px-5" data-testid={testId}>
      <h4 className="eyebrow mb-1.5 text-text-faint">{label}</h4>
      {children}
    </div>
  );
}

/**
 * The document WAS read and simply does not carry this field. Distinct from
 * `Unavailable`, which means the document could not be read at all — the reader
 * needs to know whether the creator left it out or whether we cannot see it.
 */
function NotInDocument({what}: {what: string}) {
  return <p className="text-[14px] text-text-muted">The MarketSpec {what}.</p>;
}

function OutcomeLine({market}: {market: MarketDetail}) {
  const outcome = market.winningOutcome;
  // Read from `Market.winningOutcome`, so this line survives the absence of a
  // receipt: the chain that pays out always knows who won.
  if (outcome === null) {
    return (
      <p className="text-[14px] text-text-muted">
        Not resolved — no outcome has been recorded on chain.
      </p>
    );
  }
  const label = outcome === 1 ? "YES" : "NO";
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        data-testid="report-winner"
        className={`font-mono text-[24px] leading-none font-medium ${
          outcome === 1 ? "text-pos" : "text-neg"
        }`}
      >
        {label}
      </span>
      <span className="text-[13px] text-text-muted">
        {/* 1/pᵢ, never 1/Pᵢ — see dpm-view.ts. */}
        {formatPayout(payoutPerShareWad(market.q, outcome as Outcome))} per winning share
      </span>
    </div>
  );
}

/** The resolver's half, in whichever of the four states the receipt is. */
function ResolverRecord({receipt}: {receipt: Query<SettlementReceipt | null>}): React.JSX.Element {
  switch (receipt.status) {
    case "ready":
      // Looked, and there is no record. Distinct from `unavailable` below, which
      // says this mode cannot look at all — a reader needs to know whether the
      // evidence is missing from the world or merely from here. Permanently true
      // of every market settled before receipts were anchored on chain.
      return receipt.data === null ? (
        <p
          data-testid="no-receipt-anchored"
          className="px-4 py-3.5 text-[14px] leading-relaxed text-text-muted md:px-5"
        >
          This settlement anchored no receipt. The market was resolved directly, without a
          resolution module to record which models judged it or on what evidence — so there is
          no resolver record to show, and there never will be for this market.
        </p>
      ) : (
        <ResolutionEvidence receipt={receipt.data} />
      );
    case "unavailable":
      return (
        <div className="px-4 py-3.5 md:px-5">
          <Unavailable capability={receipt.capability} mode={receipt.mode} />
        </div>
      );
    case "error":
      return (
        <div className="px-4 py-3.5 md:px-5">
          <ErrorNote error={receipt.error} what="the settlement record" />
        </div>
      );
    case "loading":
      return (
        <p className="px-4 py-3.5 text-[14px] text-text-muted md:px-5">
          Loading the settlement record…
        </p>
      );
  }
}

export function SettlementReport({
  market,
  receipt,
  mode,
}: {
  market: MarketDetail;
  receipt: Query<SettlementReceipt | null>;
  mode: DataMode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  // `showModal()` rather than the `open` attribute: it is what gives the focus
  // trap, the Escape key and the inert backdrop. Setting `open` renders the same
  // box with none of that, which looks identical and is not the same thing.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        data-testid="open-settlement-report"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-bg-sunken/50 px-4 py-2.5 text-[14px] font-medium text-text transition-colors hover:border-accent hover:text-accent"
      >
        <FileText size={14} />
        View settlement report
      </button>

      <dialog
        ref={ref}
        data-testid="settlement-report"
        aria-labelledby="settlement-report-title"
        // `close` fires for Escape and for the form below alike, so the state
        // cannot drift out of step with the element the browser actually closed.
        onClose={() => setOpen(false)}
        className="m-auto w-[min(46rem,92vw)] max-w-none rounded-lg border border-border bg-bg p-0 text-text backdrop:bg-black/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 md:px-5">
          <div className="min-w-0">
            <p className="eyebrow text-text-faint">Settlement report</p>
            <h2 id="settlement-report-title" className="text-[16px] leading-snug font-semibold">
              {market.question ?? market.address}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close settlement report"
            onClick={() => setOpen(false)}
            className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-sunken hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          <section aria-labelledby="promised-heading">
            <div className="flex items-center justify-between gap-3 bg-bg-sunken/50 px-4 py-2.5 md:px-5">
              <h3 id="promised-heading" className="eyebrow text-text">
                What was promised
              </h3>
              {/* The bytes hashed back to `specRoot` before they got here; saying so
                  is the difference between a document and a claim about one. */}
              {market.rules !== null && <Badge tone="verified" label="Verified against specRoot" />}
            </div>

            <Field label="Settlement criteria" testId="report-criteria">
              {market.rules === null ? (
                <Unavailable capability="MARKET_SPEC_BLOB" mode={mode} compact />
              ) : (
                <p className="text-[14px] leading-relaxed text-text">{market.rules}</p>
              )}
            </Field>

            <Field label="System prompt" testId="report-system-prompt">
              {market.settlementPrompt === null ? (
                <NotInDocument what="carries no settlement prompt" />
              ) : (
                <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-text">
                  {market.settlementPrompt}
                </p>
              )}
            </Field>

            <Field label="Data sources" testId="report-sources">
              {market.sources === null ? (
                <Unavailable capability="MARKET_SPEC_BLOB" mode={mode} compact />
              ) : market.sources.length === 0 ? (
                <NotInDocument what="names no sources" />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {market.sources.map((s) => (
                    <li key={s.url} className="text-[14px]">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-accent underline underline-offset-2"
                      >
                        {s.url}
                      </a>
                      {s.selector !== null && (
                        <span className="ml-2 font-mono text-[12px] text-text-faint">
                          {s.selector}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            <Field label="Committed as" testId="report-spec-root">
              <p className="font-mono text-[12px] break-all text-text-muted">{market.specRoot}</p>
            </Field>
          </section>

          <section aria-labelledby="performed-heading">
            <div className="border-t border-border bg-bg-sunken/50 px-4 py-2.5 md:px-5">
              <h3 id="performed-heading" className="eyebrow text-text">
                What the resolver did
              </h3>
            </div>

            <Field label="Final outcome" testId="report-outcome">
              <OutcomeLine market={market} />
            </Field>

            {/* The resolver states its own criteria and its own sources, and they
                appear again below. That is not duplication to be tidied away: the
                report exists so a reader can hold the resolver's account against
                what the market actually promised, and a single merged list would
                let the account quietly replace the promise. */}
            <p className="border-t border-border px-4 pt-3.5 text-[13px] text-text-muted md:px-5">
              The resolver&rsquo;s own account below — read it against what was promised above.
            </p>
            <ResolverRecord receipt={receipt} />
          </section>
        </div>
      </dialog>
    </>
  );
}
