/**
 * A loading placeholder that occupies the FINAL content's dimensions.
 *
 * The point is not the shimmer, it is the size: a centred spinner collapses the
 * layout and then shoves it back when data lands. Callers pass the width and
 * height the real value will take, so nothing moves when `loading` becomes
 * `ready`. The pulse itself is suppressed under `prefers-reduced-motion` by the
 * global rule in globals.css.
 */
export function Skeleton({className = "h-4 w-24"}: {className?: string}) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-pulse rounded bg-border align-middle ${className}`}
    />
  );
}

/** The same, sized for one table row, so a loading table keeps its full height. */
export function SkeletonRows({rows = 4, cols = 4}: {rows?: number; cols?: number}) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({length: rows}, (_, r) => (
        <div key={r} className="flex items-center gap-3 border-t border-border px-3 py-2.5">
          {Array.from({length: cols}, (_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? "w-32" : "w-16"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
