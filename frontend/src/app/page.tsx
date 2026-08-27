import {Suspense} from "react";
import {PageHeading} from "@/components/primitives/PageHeading";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {MarketList} from "@/components/market/MarketList";
import {ObservationLegend} from "@/components/source/ObservationLegend";
import {SourceNotes} from "@/components/source/SourceNotes";

export const metadata = {title: "Markets"};

export default function Home() {
  return (
    <>
      <PageHeading
        eyebrow="0G / observation layer"
        title="Markets"
        description="A read-only index of the binary prediction markets on 0G Chain. Compare implied probability, pool depth, and settlement state. Trading happens through the agent SDK, never from this page."
      />
      {/* Below the heading rather than in its action slot: the slot is
          `shrink-0`, so an expanding panel there steals width from the title and
          reflows it. The disclosure opens directly under its own button here. */}
      <div className="mb-5">
        <SourceNotes />
      </div>
      {/* MarketList reads the filter state from the URL through useSearchParams,
          which needs a Suspense boundary to prerender. */}
      <Suspense
        fallback={
          <div className="panel">
            <SkeletonRows rows={5} cols={6} />
          </div>
        }
      >
        <MarketList />
      </Suspense>
      {/* The legend sits after the table because it explains what a reader has
          just met in it, not what they are about to. */}
      <div className="mt-5">
        <ObservationLegend />
      </div>
    </>
  );
}
