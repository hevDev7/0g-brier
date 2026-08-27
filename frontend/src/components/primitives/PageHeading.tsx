import type {ReactNode} from "react";

/**
 * The top of every route. One per page, which is why its eyebrow is allowed the
 * accent colour where a panel's is not: at one instance per page it is
 * wayfinding, not decoration competing with the data below it.
 */
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
      {/* min-w-0 for the same reason as the market page's columns: a flex item
          will not shrink below its content by default, so a long question would
          shove the action group off the edge instead of wrapping. */}
      <div className="min-w-0">
        <p className="eyebrow mb-2 text-accent">{eyebrow}</p>
        <h1 className="text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-balance text-text md:text-[30px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-muted">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
