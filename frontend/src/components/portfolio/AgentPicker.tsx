"use client";

import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {ArrowRight, Fingerprint, LockKeyhole, Search} from "lucide-react";
import {Panel} from "@/components/primitives/Panel";
import {Skeleton} from "@/components/primitives/Skeleton";
import {usePositionsByMarket} from "@/hooks/useMarketRows";
import {useMarkets} from "@/hooks/useMarkets";
import {agentsSeen} from "@/lib/agent-book";
import {shortAddress} from "@/lib/format";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The way into a portfolio, and deliberately NOT a Connect Wallet button.
 *
 * The human pages hold no signer, so there is no "my" address to connect. What
 * this page inspects is a public address, typed or picked — which is also why
 * the route is `/portfolio/[agent]` rather than a session-scoped `/portfolio`.
 */
export function AgentPicker() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[640px]">
      <span className="mb-6 grid size-12 place-items-center rounded-lg border border-border bg-accent/10 text-accent">
        <Fingerprint size={22} aria-hidden />
      </span>
      <p className="eyebrow mb-2 text-accent">Address observation</p>
      <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-text">
        Inspect an agent&rsquo;s book
      </h2>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-text-muted">
        Enter a public agent address to see the positions it holds across the indexed markets. No
        credentials, no wallet connection — this page only reads.
      </p>

      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const candidate = value.trim();
          if (!ADDRESS.test(candidate)) {
            // Navigating to a malformed address would render a book that is
            // empty for the wrong reason — "this agent holds nothing" reads very
            // differently from "that is not an address".
            setError("That is not a 0x address (42 characters, hexadecimal).");
            return;
          }
          setError(null);
          router.push(`/portfolio/${candidate}`);
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Agent address</span>
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute top-3 left-3 text-text-faint"
          />
          <input
            data-testid="agent-address"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0x…"
            aria-invalid={error !== null}
            aria-describedby={error ? "agent-address-error" : undefined}
            className="h-10 w-full rounded-md border border-border bg-bg-raised pr-3 pl-9 font-mono text-[13px] text-text placeholder:text-text-faint"
          />
        </label>
        <button
          type="submit"
          data-testid="inspect-agent"
          className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90"
        >
          Inspect book
          <ArrowRight size={14} aria-hidden />
        </button>
      </form>
      {error && (
        <p id="agent-address-error" role="alert" className="mt-2 text-[13px] text-neg">
          {error}
        </p>
      )}

      <KnownAgents />

      <Panel as="div" className="mt-6 flex gap-3 p-4">
        <LockKeyhole size={16} className="mt-0.5 shrink-0 text-text-faint" aria-hidden />
        <p className="text-[13px] leading-relaxed text-text-muted">
          Observation only. Redeeming and liquidating are execution, and execution runs through
          <span className="font-mono"> @hevdev7/agent-kit</span> — never from a browser.
        </p>
      </Panel>
    </div>
  );
}

/** The agents this source can actually see, so the page is usable without one to hand. */
function KnownAgents() {
  const markets = useMarkets();
  const addresses = markets.status === "ready" ? markets.data.map((m) => m.address) : [];
  const positions = usePositionsByMarket(addresses);

  if (markets.status !== "ready") return null;
  if (positions.length === 0 || positions.some((p) => p.status === "loading")) {
    return <Skeleton className="mt-6 h-4 w-48" />;
  }
  // An unreadable position list is not an error here: this is a convenience
  // shortcut, and the address field above works regardless.
  const seen = agentsSeen(positions.map((p) => (p.status === "ready" ? p.data : []))).slice(0, 8);
  if (seen.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="eyebrow mb-2 text-text-faint">Agents in this source</p>
      <ul className="flex flex-wrap gap-2">
        {seen.map((agent) => (
          <li key={agent}>
            <Link
              href={`/portfolio/${agent}`}
              className="inline-block rounded-md border border-border bg-bg-raised px-2 py-1 font-mono text-[12px] text-text-muted hover:border-accent hover:text-accent"
            >
              {shortAddress(agent)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
