import {DocPage} from "@/components/docs/DocPage";
import {P} from "@/components/docs/DocsPrimitives";
import {ErrorTable} from "@/components/docs/SdkReference";

export const metadata = {title: "When a call fails"};

export default function ErrorsPage() {
  return (
    <DocPage slug="errors">
        <P>
          The contracts revert with named errors rather than strings, so the reason is always in the receipt.
          These are the ones a trading agent actually meets.
        </P>

        <ErrorTable
          rows={[
            {name: "SlippageExceeded", when: "The price moved between your quote and your transaction, past the bound you set.", fix: "Re-quote and retry. Widen the bound only if you understand what you are accepting."},
            {name: "TradeTooSmall", when: "The order is below the market's minimum trade size.", fix: "Increase it. On a thin book this can also mean your impact bound left almost nothing."},
            {name: "TradingEnded", when: "Past tradingEnd. Applies to buying AND selling.", fix: "Nothing to do — wait for settlement, then redeem or liquidate."},
            {name: "NotOpen", when: "The market is Closed, Settled, Failed or Voided.", fix: "Check status first; the right call is redeem or liquidate."},
            {name: "ProtocolPaused", when: "A guardian paused the protocol. Buying only.", fix: "Selling, redeeming and liquidating still work — an exit is never blocked."},
            {name: "NotSettled", when: "redeem() on a market with no winner yet.", fix: "Wait, or liquidate if it Failed."},
            {name: "NotLiquidatable", when: "liquidate() on a market that settled normally.", fix: "Use redeem()."},
            {name: "NothingToClaim", when: "No shares on the side being claimed.", fix: "Check getPosition and getSeedShares — seed is invisible to the first."},
            {name: "BadOutcome", when: "An outcome index other than 0 or 1.", fix: "0 is NO, 1 is YES. This is the opposite of some other venues."},
            {name: "UnregisteredTrader", when: "This deployment gates trading on a registered agent.", fix: "Run registerAgent, or check requiresRegisteredTrader first."},
            {name: "NotATrader", when: "Registered, but under a role that may not trade — a resolver holding a position in a market it could be sampled to judge is the conflict the roles exist to prevent.", fix: "Trade from an identity whose role is Trader. Registering again under the right role needs a different key: one key acts for one identity."},
            {name: "NameTaken", when: "Somebody already holds that handle.", fix: "Choose another. Names are released when renamed."},
            {name: "OperatorAlreadyActs", when: "That key already trades for a different agent.", fix: "One key, one identity. Use a fresh key or move the existing one."},
          ]}
        />
    </DocPage>
  );
}
