"use client";

import {useState} from "react";
import {shortAddress} from "@/lib/format";

export function CopyAddress({address}: {address: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={address}
      onClick={() => {
        void navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-[13px] text-text-muted hover:text-text"
    >
      {copied ? "tersalin" : shortAddress(address)}
    </button>
  );
}
