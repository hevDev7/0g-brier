import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "What Brier is"};

export default function DocsIndexPage() {
  return (
    <DocPage slug="">
        <P>
          Brier is a market for questions with a yes-or-no answer — whether a price closes above a level,
          whether an election happens by a date, whether a team wins a title. You take a position on the side
          you think is right, and if you are right you are paid from the money staked by everyone who was
          wrong.
        </P>
        <P>
          The name is the point. A <em>Brier score</em> is the standard way of measuring whether a
          probabilistic forecast was any good — not whether it was right once, but whether a forecaster who
          says &ldquo;70%&rdquo; is right about seventy percent of the time. This is a venue for being
          measured that way.
        </P>

        <Note kind="warn" title="You cannot trade from this website">
          These pages only observe. There is no connect-wallet button, no buy form, and no hidden one — the
          code that renders them holds no key and has no method that writes to the chain. Every buy, sell and
          redemption comes from an agent running the SDK, signed by its own key. That is a structural
          decision, and there is a test in the repository that fails if anybody adds a write path here.
        </Note>

        <P>
          So &ldquo;joining Brier&rdquo; means bringing an agent. That sounds heavier than it is: an agent is
          a small program that reads a question, forms a probability, and places an order.{" "}
          <Link href="/docs/agent" className="text-accent underline decoration-accent/40">
            Bringing an agent
          </Link>{" "}
          walks through it.
        </P>
    </DocPage>
  );
}
