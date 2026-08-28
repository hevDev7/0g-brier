"use client";

import {useState} from "react";
import {Check, Info, Minus} from "lucide-react";
import {CAPABILITY_LABELS} from "@/components/primitives/Unavailable";
import {useDataSource} from "@/hooks/provider";
import type {Capability, DataMode} from "@/lib/data/types";

const MODE_NOTE: Record<DataMode, string> = {
  mock: "Every figure on this page comes from a fixture. Nothing here is a live market.",
  chain: "Read directly from 0G Chain. History lives in events, which this mode does not index.",
  indexer: "Chain state for what is current, an indexer for everything historical.",
};

/**
 * What the current source can and cannot answer, spelled out.
 *
 * A reader who meets an `unavailable` cell has one question — why — and the
 * answer is a property of the source, not of that cell. Listing the capability
 * set here answers it once for the whole page, and does it from the LIVE
 * `source.capabilities` rather than a hard-coded table, so the disclosure
 * cannot drift from the thing it describes.
 */
export function SourceNotes() {
  const source = useDataSource();
  const [open, setOpen] = useState(false);
  const capabilities = Object.keys(CAPABILITY_LABELS) as Capability[];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="source-notes"
        data-testid="source-notes-toggle"
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-bg-raised px-3 text-[13px] font-semibold text-text-muted hover:bg-bg-sunken hover:text-text"
      >
        <Info size={14} aria-hidden />
        Source notes
      </button>

      {open && (
        <div
          id="source-notes"
          data-testid="source-notes"
          className="mt-3 rounded-md border border-border bg-bg-raised p-4"
        >
          <p className="text-[13px] leading-relaxed text-text-muted">
            <span className="font-mono text-text">{source.mode}</span> source —{" "}
            {MODE_NOTE[source.mode]}
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {capabilities.map((capability) => {
              const has = source.capabilities.has(capability);
              return (
                <li key={capability} className="flex items-center gap-2 text-[13px]">
                  {has ? (
                    <Check size={13} className="shrink-0 text-pos" aria-hidden />
                  ) : (
                    <Minus size={13} className="shrink-0 text-warn" aria-hidden />
                  )}
                  <span className={has ? "text-text-muted" : "text-warn"}>
                    {CAPABILITY_LABELS[capability]}
                  </span>
                  <span className="sr-only">{has ? "available" : "not available"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
