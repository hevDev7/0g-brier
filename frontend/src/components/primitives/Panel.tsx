import type {ComponentType, ReactNode} from "react";

/**
 * The single container shape in this UI. Every panel is a raised surface with a
 * hairline border and one radius — depth comes from the surface step, not from
 * a shadow, so it reads the same in both themes.
 */
export function Panel({
  children,
  className = "",
  testId,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag data-testid={testId} className={`panel ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * A panel's header: the eyebrow names its KIND, the title names this instance.
 *
 * The eyebrow is `text-faint`, not the accent colour. On a page carrying eight
 * panels an accent eyebrow on every one of them competes with the numbers,
 * which are the only things here that earn colour. The accent is reserved for
 * the page heading (one per page, wayfinding) and for interactive chrome.
 */
export function PanelHeader({
  eyebrow,
  title,
  icon: Icon,
  action,
}: {
  eyebrow: string;
  title: string;
  icon?: ComponentType<{size?: number; className?: string}>;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5">
      <div>
        <p className="eyebrow text-text-faint">{eyebrow}</p>
        <h2 className="mt-1 text-[14px] font-bold text-text">{title}</h2>
      </div>
      {action ?? (Icon ? <Icon size={16} className="mt-0.5 shrink-0 text-text-faint" /> : null)}
    </div>
  );
}

/** A label/value row. Used wherever a panel lists facts rather than tabulating them. */
export function Row({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-baseline justify-between gap-4 text-[14px]"
    >
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text">{children}</span>
    </div>
  );
}
