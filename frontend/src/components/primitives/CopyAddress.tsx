"use client";

import {useEffect, useRef, useState} from "react";
import {shortAddress} from "@/lib/format";

export function CopyAddress({address}: {address: string}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    };
  }, []);

  return (
    <button
      type="button"
      title={address}
      aria-live="polite"
      onClick={() => {
        // "copied" is only true AFTER writeText genuinely resolves — never
        // claimed up front. An absent API (the optional chaining below
        // short-circuits to undefined and never reaches .then) or a rejected
        // promise (document not focused, permission denied) must leave the button
        // showing the address rather than claiming a success that did not happen —
        // the same rule that makes `unavailable` a member of the Query union,
        // moved here from data to action.
        navigator.clipboard
          ?.writeText(address)
          .then(() => {
            setCopied(true);
            if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => setCopied(false));
      }}
      className="font-mono text-[14px] text-text-muted hover:text-text"
    >
      {copied ? "copied" : shortAddress(address)}
    </button>
  );
}
