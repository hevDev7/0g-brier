import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "The numbers that govern it"};

export default function ParametersPage() {
  return (
    <DocPage slug="parameters">
        <P>
          These live in the <C>ConfigRegistry</C>. Each was bounded at deployment and can only ever be moved
          within those bounds — the ceiling on the fee, for instance, is fixed forever at 3%, so no amount of
          governance can raise it past that.
        </P>

        <MethodGroup
          title="Economics, as currently set"
          methods={[
            {sig: "FEE_BPS            100", does: <>1% per trade, charged on the way in AND the way out. A round trip therefore costs about 2% before any price movement.</>},
            {sig: "MIN_SEED           100 mUSDC", does: <>The smallest pool a market can be created with. Thin markets are where an order destroys its own edge.</>},
            {sig: "MIN_TRADE_TOKENS   1 mUSDC", does: <>Below this an order reverts with <C>TradeTooSmall</C>. Worth knowing when an impact bound leaves you almost nothing.</>},
          ]}
        />

        <H3>Tiers</H3>
        <P>
          A market&rsquo;s tier decides how many resolvers judge it and how long anyone has to challenge the
          result. The tier is shown on every market page.
        </P>

        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-border bg-bg-sunken text-left">
                {["Tier", "Committee", "Dispute window"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-mono text-[12px] tracking-wider text-text-faint uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["FAST", "3 of 5 must agree", "24 hours"],
                ["VERIFIED", "3 of 5 must agree", "6 hours"],
                ["DETERMINISTIC", "2 of 3 must agree", "2 hours"],
                ["dispute round", "6 of 9 must agree", "—"],
              ].map(([tier, cttee, window]) => (
                <tr key={tier}>
                  <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-text">{tier}</td>
                  <td className="px-4 py-3 text-text-muted">{cttee}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-text-muted">{window}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Note kind="warn" title="The dispute window runs backwards from the obvious guess">
          FAST has the LONGEST window and VERIFIED the shortest, which reads wrong until you see what the
          window is for. It is time to challenge a result, and the weakest evidence needs the most of it — an
          unattested settlement gets a full day to be contradicted, while one carrying TEE attestation needs
          six hours. The two tiers seat the same committee; what separates them is the evidence behind the
          answer and the time anyone gets to argue with it. Reading it the other way round would
          remove protection exactly where it is thinnest.
        </Note>

        <P>
          Funds are locked for the whole window. If you need the capital elsewhere, the time to leave is
          before trading closes — not after.
        </P>
    </DocPage>
  );
}
