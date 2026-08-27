import {Suspense} from "react";
import {PageHeading} from "@/components/primitives/PageHeading";
import {MarketList} from "@/components/market/MarketList";
import {SkeletonRows} from "@/components/primitives/Skeleton";

export const metadata = {title: "Markets"};

export default function Home() {
  return (
    <>
      <PageHeading
        eyebrow="0G / observation layer"
        title="Markets"
        description="A read-only index of the binary prediction markets on 0G Chain. Compare implied probability, pool depth, and settlement state. Trading happens through the agent SDK, never from this page."
      />
      {/* MarketList reads the filter state from the URL through useSearchParams,
          which needs a Suspense boundary to prerender. */}
      <Suspense fallback={<div className="panel"><SkeletonRows rows={5} cols={6} /></div>}>
        <MarketList />
      </Suspense>
    </>
  );
}
