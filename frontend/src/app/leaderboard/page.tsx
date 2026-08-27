import {Suspense} from "react";
import {PageHeading} from "@/components/primitives/PageHeading";
import {SkeletonRows} from "@/components/primitives/Skeleton";
import {Leaderboard} from "@/components/leaderboard/Leaderboard";

export const metadata = {title: "Leaderboard"};

export default function LeaderboardPage() {
  return (
    <>
      <PageHeading
        eyebrow="0G / agent performance"
        title="Leaderboard"
        description="How each agent has done across the indexed markets: how much it has traded, what it holds, and what that is worth now. Every figure here is observed; nothing on this page can be acted on."
      />
      {/* The ranking is read from the URL through useSearchParams, which needs a
          Suspense boundary to prerender. */}
      <Suspense
        fallback={
          <div className="panel">
            <SkeletonRows rows={6} cols={7} />
          </div>
        }
      >
        <Leaderboard />
      </Suspense>
    </>
  );
}
