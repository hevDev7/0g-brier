import type {Metadata} from "next";
import Link from "next/link";
import {ArrowLeft} from "lucide-react";
import {PageHeading} from "@/components/primitives/PageHeading";
import {AgentBook} from "@/components/portfolio/AgentBook";
import {shortAddress} from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{agent: string}>;
}): Promise<Metadata> {
  const {agent} = await params;
  return {title: `${shortAddress(agent)} · book`};
}

export default async function AgentPage({params}: {params: Promise<{agent: string}>}) {
  const {agent} = await params;
  return (
    <>
      <Link
        href="/portfolio"
        className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft size={14} aria-hidden />
        Another address
      </Link>
      <PageHeading
        eyebrow="Observed agent / cross-market"
        title={shortAddress(agent)}
        description="Positions attributed to this address across the indexed markets, with what each cost and what it is worth now. Read-only."
        action={
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-raised px-3 py-2 font-mono text-[10px] tracking-[0.08em] text-text-muted uppercase">
            <span className="size-1.5 rounded-full bg-accent" />
            Read only
          </span>
        }
      />
      <AgentBook agent={agent} />
    </>
  );
}
