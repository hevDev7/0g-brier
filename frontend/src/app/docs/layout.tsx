import type {ReactNode} from "react";
import {DocsSidebar} from "@/components/docs/DocsSidebar";

export const metadata = {
  title: {default: "Documentation", template: "%s · Docs · Brier"},
};

/**
 * Two columns above `lg`, one below.
 *
 * There was a third — an "on this page" rail, because that is what a GitBook
 * layout has. Counting the headings said otherwise: three of the fourteen pages
 * have two or more, so it would have been absent from eleven and shown two
 * entries on the rest. A contents list for a three-hundred-word page is
 * furniture, and inconsistent furniture at that. The sidebar is the navigation
 * and the pages are short enough to read.
 *
 * `minmax(0, 1fr)` on the content column rather than `1fr`: a grid item's
 * default minimum is its own content, so one wide code block would push the
 * columns apart instead of scrolling inside itself.
 */
export default function DocsLayout({children}: {children: ReactNode}) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
      <DocsSidebar />
      {children}
    </div>
  );
}
