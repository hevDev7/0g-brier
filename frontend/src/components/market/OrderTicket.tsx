"use client";

import {useState, type ReactNode} from "react";
import {toTokensCeil, toWad} from "@0g-delphi/protocol";
import {useDataSource} from "@/hooks/provider";
import {useQuote} from "@/hooks/useQuote";
import {
  formatCollateral,
  formatPayout,
  formatPricePerShare,
  formatProbability,
  formatProbabilityDelta,
  formatShares,
} from "@/lib/format";
import type {MarketDetail, Outcome} from "@/lib/data/types";

const SLIPPAGE_BPS = 50n; // 0,5%

/** Mengurai input desimal pengguna jadi satuan token terkecil, tanpa float. */
function parseAmount(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function OrderTicket({market}: {market: MarketDetail}) {
  const source = useDataSource();
  const [outcome, setOutcome] = useState<Outcome>(1);
  const [amountText, setAmountText] = useState("");

  const decimals = market.collateral.decimals;
  const amountTokens = parseAmount(amountText, decimals);
  const quote = useQuote({
    q: market.q,
    outcome,
    spendWad: toWad(amountTokens, decimals),
    feeBps: market.feeBps,
  });

  const hasQuote = quote.sharesOut > 0n;
  // Batas atas yang akan ditandatangani pengguna, BUKAN kuotasi itu sendiri:
  // sebelum eksekusi, F1 memanggil quoteBuy di rantai dan harga bisa bergeser
  // di antara pratinjau ini dan konfirmasi. maxTokensIn adalah janji "tidak
  // akan membayar lebih dari ini", dihitung dari kuotasi plus toleransi tetap.
  const maxPaidTokens = toTokensCeil(
    (quote.totalWad * (10_000n + SLIPPAGE_BPS)) / 10_000n,
    decimals,
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="grid grid-cols-2 gap-2">
        {([1, 0] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setOutcome(side)}
            className={`rounded-md border px-3 py-2 text-left ${
              outcome === side ? "border-accent text-text" : "border-border text-text-muted"
            }`}
          >
            <div className="text-[12px] font-medium">{side === 1 ? "YES" : "NO"}</div>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[12px] text-text-muted">
        Belanjakan
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-[15px] text-text outline-none"
          />
          <span className="text-[12px] text-text-faint">{market.collateral.symbol}</span>
        </div>
      </label>

      {hasQuote ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-[13px]">
          <Row label="Terima">
            <span data-testid="quote-shares">
              {formatShares(quote.sharesOut)} lembar {outcome === 1 ? "YES" : "NO"}
            </span>
          </Row>
          <Row label="Harga rata-rata">{formatPricePerShare(quote.avgPriceWad)}</Row>
          <Row label="Fee">{formatCollateral(toTokensCeil(quote.feeWad, decimals), decimals)}</Row>

          {/* Dampak harga sebagai TRANSISI: "59.0% → 63.8%" mengatakan apa yang
              dilakukan pembelian ini pada market. Angka delta sendirian tidak. */}
          <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-text-muted">P({outcome === 1 ? "YES" : "NO"})</span>
            <span>
              <span data-testid="prob-before">{formatProbability(quote.probBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="prob-after">{formatProbability(quote.probAfterWad)}</span>
              <span data-testid="prob-delta" className="ml-2 text-text-muted">
                {formatProbabilityDelta(quote.probBeforeWad, quote.probAfterWad)}
              </span>
            </span>
          </div>

          {/* Payout juga sebagai transisi: dilusi jadi konkret karena pengguna
              melihatnya terjadi pada pembeliannya sendiri, bukan sebagai klaim abstrak. */}
          <Row label="Payout jika menang">
            <span>
              <span data-testid="payout-before">{formatPayout(quote.payoutBeforeWad)}</span>
              <span className="mx-1.5 text-text-faint">→</span>
              <span data-testid="payout-after">{formatPayout(quote.payoutAfterWad)}</span>
            </span>
          </Row>

          <Row label="Maks dibayar (slippage 0.5%)">
            <span data-testid="max-paid">{formatCollateral(maxPaidTokens, decimals)}</span>
          </Row>

          <p className="mt-2 text-[12px] leading-relaxed text-warn">
            Pembelian ini sendiri menurunkan payout-mu. Pembeli berikutnya di sisi ini
            menurunkannya lagi.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40"
      >
        Beli {outcome === 1 ? "YES" : "NO"}
      </button>
      <p className="text-[11px] text-text-faint">
        Mode mock — kuotasi dihitung dari cermin DPM, tetapi tidak ada transaksi yang dikirim.
        Eksekusi baru aktif di mode <span className="font-mono">chain</span> — saat ini mode {source.mode} yang aktif.
      </p>
    </div>
  );
}

function Row({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}
