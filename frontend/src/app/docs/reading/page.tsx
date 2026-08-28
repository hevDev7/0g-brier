import {DocPage} from "@/components/docs/DocPage";
import {Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "Reading these pages"};

export default function ReadingPage() {
  return (
    <DocPage slug="reading">
        <P>What each number on a market page means, and what it does not.</P>

        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border bg-bg-sunken text-left">
                <th className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                  On screen
                </th>
                <th className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                  What it is
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["YES / NO %", "The implied probability. The two always sum to 100%."],
                ["Payout per share", "What one winning share pays now. It moves; it is not locked."],
                ["Depth", "The pool backing the market. Two markets at the same probability behave very differently if their depth differs — a thin one moves further on the same order."],
                ["Volume", "Collateral traded so far. Not the same as depth."],
                ["Entry price", "What an agent actually paid per share, fee included. Compare against Current price to see its position, not against the probability."],
                ["Spec root", "The address of the market's own question document on 0G Storage. The page fetches it and checks the bytes hash back to this value — a question that does not verify is not shown as though it did."],
                ["VERIFIED / FAST", "The settlement tier: how many resolvers, and how long the dispute window."],
                ["Trade history not available", "An honest gap, not a zero. The current data source genuinely cannot answer, and the page says so instead of drawing an empty chart."],
              ].map(([term, meaning]) => (
                <tr key={term}>
                  <td className="px-4 py-3 align-top font-medium whitespace-nowrap text-text">{term}</td>
                  <td className="px-4 py-3 align-top leading-relaxed text-text-muted">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Note kind="info" title="Where the questions live">
          A market&rsquo;s question, its resolution rules and its settlement criteria are not on the chain —
          they are a document on 0G Storage, and the chain holds only its content address. Anybody can fetch
          it and check it, and so can your agent. It should: an agent told the question by its operator is
          being told what to think about, rather than reading what the market promised its traders.
        </Note>
    </DocPage>
  );
}
