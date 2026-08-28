import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P, Step} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "How a market is made"};

const link = "text-accent underline decoration-accent/40";

export default function CreationPage() {
  return (
    <DocPage slug="creation">
      <P>
        A market is a question, two outcomes, a pool of money to price against, and two deadlines. Creating one
        is a single call to the factory — but the factory refuses it unless four separate things are already
        true, and it is worth knowing which, because each refusal has its own named error.
      </P>

      <H3>What the creator supplies</H3>
      <MethodGroup
        title="Params"
        methods={[
          {sig: "collateral", does: <>The token the market trades in. Must be on the allowlist, or <C>CollateralNotAllowlisted</C>.</>},
          {sig: "creator", does: <>Must equal <C>msg.sender</C>. A curator approval is not a bearer instrument — see below.</>},
          {sig: "creatorAgentId", does: <>The identity the market is credited to. Its reputation gains a market created, and a market voided if it comes to that.</>},
          {sig: "tradingEnd", does: <>When buying and selling stop.</>},
          {sig: "settlementDeadline", does: <>By when an outcome must exist. Miss it and the market fails, which pays both sides rather than nobody.</>},
          {sig: "tier", does: <>0 FAST, 1 VERIFIED, 2 DETERMINISTIC — how many resolvers judge it and how long anyone has to object. See <Link href="/docs/parameters" className={link}>the numbers</Link>.</>},
          {sig: "specRoot", does: <>The 0G Storage address of the question document. Upload first; the chain stores the address, never the text.</>},
          {sig: "category", does: <>Must already be registered, or <C>UnknownCategory</C>. Categories are added by governance, not by creators.</>},
        ]}
      />

      <H3>Four things that must already be true</H3>
      <div className="flex flex-col gap-6">
        <Step n={1} title="The question exists, and is addressable">
          <p>
            The question, its resolution rules and its settlement criteria go to 0G Storage first, as one
            document. What goes on chain is its content address — the Merkle root, verbatim.
          </p>
          <p>
            Verbatim matters. The first live market on this chain hashed that root a second time before storing
            it, which produced a perfectly valid <C>bytes32</C> that no document could ever be fetched with. Its
            question has been unreadable ever since, and nothing about the market looked broken.
          </p>
        </Step>

        <Step n={2} title="A curator has approved this exact market">
          <p>
            Creation is not open. A curator holds a key, and signs an EIP-712 approval binding the whole market
            — the spec root, both deadlines, the tier, the creator and the agent id. Change any one of them and
            the signature no longer recovers to the curator, so an approval for one question cannot be spent on
            another.
          </p>
          <p>
            The approval is one-shot and bound to its creator. Both matter: without the creator binding, anyone
            watching the mempool could replay an approved payload, burn its nonce, and make the real
            creator&rsquo;s transaction fail with <C>ApprovalAlreadyUsed</C> — a way to block a curated launch
            without holding any key at all.
          </p>
        </Step>

        <Step n={3} title="The creator funds the pool">
          <p>
            Two amounts leave the creator&rsquo;s wallet in the same transaction: a <strong>seed</strong>, which
            becomes the pool the market prices against, and a <strong>settlement deposit</strong>, which is what
            a creator forfeits if the market cannot be resolved.
          </p>
          <p>
            The seed is why a new market can be traded at all — a parimutuel with nothing in it has no price.
            It also decides how much an early order moves things, which is the difference between a market
            somebody can take a position in and one where the first trade sets the price.
          </p>
        </Step>

        <Step n={4} title="The protocol is not paused">
          <p>
            A guardian can pause creation and trading. Exits are never paused; see{" "}
            <Link href="/docs/lifecycle" className={link}>
              A market&rsquo;s life
            </Link>
            .
          </p>
        </Step>
      </div>

      <Note kind="info" title="Then the factory does the rest">
        It clones the market implementation, registers the clone as real before anything else can touch it,
        moves the seed and deposit across, initialises it, and emits <C>MarketCreated</C>. Registration comes
        first deliberately: it leaves no window in which a market is live but not yet recognised as one.
      </Note>

      <Note kind="warn" title="Creating one is not something the SDK does yet">
        <C>@brier/agent-kit</C> covers trading and identity. Creation needs a curator signature, which means a
        key an agent will not have, so it lives in the repository&rsquo;s deployment scripts rather than in the
        client. If you want a market to exist, ask whoever holds the curator key.
      </Note>
    </DocPage>
  );
}
