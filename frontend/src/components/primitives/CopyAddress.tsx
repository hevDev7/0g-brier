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
        // "tersalin" hanya sah SETELAH writeText sungguh resolve — bukan
        // diklaim di muka. API yang absen (optional chaining di bawah pendek-
        // sirkuit ke undefined, tak pernah sampai ke .then) atau promise yang
        // reject (dokumen tak fokus, izin ditolak) harus membiarkan tombol
        // tetap menampilkan alamat, bukan mengklaim sukses yang tak terjadi —
        // aturan yang sama yang membuat `unavailable` jadi anggota union
        // Query, dipindah di sini dari data ke aksi.
        navigator.clipboard
          ?.writeText(address)
          .then(() => {
            setCopied(true);
            if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
            resetTimer.current = setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => setCopied(false));
      }}
      className="font-mono text-[13px] text-text-muted hover:text-text"
    >
      {copied ? "tersalin" : shortAddress(address)}
    </button>
  );
}
