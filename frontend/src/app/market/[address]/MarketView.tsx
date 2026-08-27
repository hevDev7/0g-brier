"use client";

import {Badge} from "@/components/primitives/Badge";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Countdown} from "@/components/primitives/Countdown";
import {Unavailable} from "@/components/primitives/Unavailable";
import {OrderTicket} from "@/components/market/OrderTicket";
import {PayoutPanel} from "@/components/market/PayoutPanel";
import {ProbabilityPanel} from "@/components/market/ProbabilityPanel";
import {TradeTape} from "@/components/market/TradeTape";
import {useMarket} from "@/hooks/useMarket";
import {useTrades} from "@/hooks/useTrades";

export function MarketView({address}: {address: `0x${string}`}) {
  const market = useMarket(address);
  const trades = useTrades(address, 24);

  if (market.status === "loading") return <Shell>Memuat…</Shell>;
  if (market.status === "error") return <Shell>Gagal memuat: {market.error.message}</Shell>;
  if (market.status === "unavailable") {
    return (
      <Shell>
        <Unavailable capability={market.capability} mode={market.mode} />
      </Shell>
    );
  }

  const m = market.data;
  return (
    <Shell>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" label={m.tier} />
          <Badge tone={m.status === "Open" ? "positive" : "neutral"} label={m.status} />
          <span className="text-[12px] text-text-muted">{m.category}</span>
          <span className="text-[12px] text-text-muted">
            tutup dalam <Countdown until={m.tradingEnd} />
          </span>
          <CopyAddress address={m.address} />
        </div>
        <h1 className="max-w-3xl text-[20px] leading-snug text-text">{m.question}</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <ProbabilityPanel q={m.q} />
          <PayoutPanel q={m.q} />
          {trades.status === "ready" ? (
            <TradeTape trades={trades.data} collateral={m.collateral} />
          ) : trades.status === "unavailable" ? (
            <Unavailable capability={trades.capability} mode={trades.mode} />
          ) : trades.status === "error" ? (
            <div className="text-[13px] text-neg">Gagal memuat transaksi.</div>
          ) : (
            <div className="text-[13px] text-text-muted">Memuat transaksi…</div>
          )}
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-[12px] uppercase tracking-wide text-text-faint">
              Aturan penyelesaian
            </h2>
            <p className="text-[13px] leading-relaxed text-text-muted">{m.rules}</p>
          </section>
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <OrderTicket market={m} />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({children}: {children: React.ReactNode}) {
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>;
}
