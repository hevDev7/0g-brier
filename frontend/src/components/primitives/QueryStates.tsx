import {Skeleton} from "./Skeleton";

/**
 * The two Query branches that carry no data of their own, given one shape so
 * they read the same on every screen. `unavailable` deliberately has no helper
 * here: it is not a generic state but a specific claim about a capability and a
 * mode, and it has its own component.
 */
export function ErrorNote({error, what}: {error: Error; what: string}) {
  return (
    <p role="alert" className="text-[13px] text-neg">
      Could not load {what}: {error.message}
    </p>
  );
}

export function LoadingNote({what, className}: {what: string; className?: string}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Skeleton className={className ?? "h-3 w-20"} />
      <span className="sr-only">Loading {what}…</span>
    </span>
  );
}
