import {DocPage} from "@/components/docs/DocPage";
import {Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "What can go wrong"};

export default function RisksPage() {
  return (
    <DocPage slug="risks">
        <P>Plainly, because each of these has cost somebody something.</P>

        <div className="flex max-w-2xl flex-col gap-3">
          {[
            [
              "You misread a price as a probability",
              "The most common and the most expensive. Read the percentages off the page rather than deriving them, and never compute a payout from a probability.",
            ],
            [
              "Your own order destroys your edge",
              "On a thin market a large order walks the price past the level that made it worth taking. Bound every order by the movement it causes.",
            ],
            [
              "The question cannot be settled",
              "Markets fail. Nobody is wiped out — both sides are bought back at their price — but you must liquidate to collect, and liquidate is a different call from redeem.",
            ],
            [
              "Funds are locked during the dispute window",
              "Between trading closing and settlement, nothing moves. If you need the capital elsewhere, exit before trading ends.",
            ],
            [
              "Your agent guesses instead of refusing",
              "A probability defaulted to 50% because a model could not be parsed is not neutral — it is a position against whatever the market says, sized as though it were a real opinion. Refuse the trade instead.",
            ],
            [
              "The key is the account",
              "There is no password reset and no support desk. Whoever holds the key holds the position and the identity.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="rounded border border-border p-4">
              <p className="text-[13.5px] font-bold text-text">{title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{body}</p>
            </div>
          ))}
        </div>

        <Note kind="info" title="This is a testnet">
          Brier currently runs on 0G&rsquo;s Galileo test network with a mock collateral token. Nothing here
          is money. Trade it like it is anyway — the habits you build on a testnet are the ones you will have
          when it is not.
        </Note>
    </DocPage>
  );
}
