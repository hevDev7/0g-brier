import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {C, H3, Note, P, Step} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "How it settles"};

const link = "text-accent underline decoration-accent/40";

export default function SettlementPage() {
  return (
    <DocPage slug="settlement">
      <P>
        Trading stops and somebody has to say what happened. That somebody is a committee of resolvers, sampled
        against what they have at stake, voting blind, and publishing what they read. Six steps, and none of
        them can be skipped.
      </P>

      <div className="flex flex-col gap-6">
        <Step n={1} title="The market closes">
          <p>
            At <C>tradingEnd</C>, anyone can call <C>close()</C> — it is not privileged, because a market
            waiting to be closed is a market where positions are stuck. Buying and selling stop here. Nothing
            has been decided yet.
          </p>
        </Step>

        <Step n={2} title="A committee is drawn">
          <p>
            Drawing one takes <strong>two calls</strong>. <C>requestResolution</C> books a block a little way
            ahead; <C>openResolution</C> draws the committee from that block&rsquo;s hash once it has been
            mined. Both are permissionless, and the market must already be Closed.
          </p>
          <p>
            The gap between them is the point. Seed the draw from a block that already exists and the caller
            can compute the committee before deciding whether to send the transaction — so it simply waits for
            a draw it likes, and sampling becomes selection. A block that has not been mined yet cannot be
            read by anybody, the caller included.
          </p>
          <p>
            How many are drawn and how many must agree comes from the tier: three of five for FAST and for
            VERIFIED, two of three for DETERMINISTIC. A dispute round is six of nine. Every shape is a
            majority of a committee of at least three — a threshold at or below half could be cleared by two
            different answers at once.
          </p>
          <p>
            Sampling is weighted by <strong>active stake</strong> — bonded, and not already under notice of
            withdrawal. Stake given notice on is removed from the weighting the moment notice is given, not when
            it is withdrawn: otherwise a resolver could vote on stake it had already begun retrieving and be
            gone before anyone could dispute the result.
          </p>
        </Step>

        <Step n={3} title="Each resolver commits, blind">
          <p>
            A resolver does not publish its answer. It publishes a hash of it:
          </p>
          <p>
            <C>keccak256(abi.encode(market, outcome, salt, receiptRoot, msg.sender))</C>
          </p>
          <p>
            Blind because a resolver who could see the others first is no longer an independent judgement, and a
            committee of five agreeing because four of them read the first vote is worth what one vote is worth.
            The commitment binds <C>msg.sender</C>, so one lifted from another resolver&rsquo;s transaction
            cannot be replayed under a different name.
          </p>
        </Step>

        <Step n={4} title="Each reveals, with its evidence">
          <p>
            Revealing means supplying the outcome, the salt and the receipt root — the 0G Storage address of a
            document saying what the resolver read and why it concluded what it did. The hash must match what
            was committed, so the answer cannot change after seeing the others.
          </p>
          <p>
            <strong>A zero receipt root is rejected.</strong> There is no path by which a resolver settles a
            market and publishes no reasoning: the module refuses the reveal. That is the whole point of the
            mechanism, and it is enforced rather than encouraged.
          </p>
        </Step>

        <Step n={5} title="Anyone may dispute, once">
          <p>
            Once the threshold agrees, an outcome is <em>proposed</em>, not settled, and a dispute window opens
            — its length set by the tier. During it, one dispute can be raised, with evidence of its own.
          </p>
          <p>
            A dispute draws a second committee, and{" "}
            <strong>the second round excludes everyone who was in the first</strong>. A group that could
            re-sample itself into the round reviewing its own work would make the appeal a formality.
          </p>
        </Step>

        <Step n={6} title="Finalise, and the stakes move">
          <p>
            After the window, <C>finalize</C> writes the outcome to the market and settles up with the
            resolvers. Not showing up costs 5% of stake, disagreeing with the committee costs 1%, and being
            overturned on dispute costs 20%.
          </p>
          <p>
            The shape of those numbers is the policy. Being absent costs five times more than being outvoted,
            because a committee that cannot reach a threshold helps nobody, while an honest minority view is
            something a committee is supposed to be able to contain. Being wrong on appeal costs most of all.
          </p>
        </Step>
      </div>

      <H3>Three ways it can end</H3>
      <P>
        Settled is the normal one. If the committee concludes the question cannot be answered — the data never
        appeared, the rules turned out to be contradictory — the market <strong>fails</strong>, and if nobody
        settles it by the <C>settlementDeadline</C> it fails too. A failed market has no winner and pays both
        sides at their price, which needs <C>liquidate</C> rather than <C>redeem</C>. See{" "}
        <Link href="/docs/lifecycle" className={link}>
          A market&rsquo;s life
        </Link>
        .
      </P>

      <Note kind="warn" title="There is a shortcut, and you can tell when it was used">
        A single allowlisted key can settle a market directly, without a committee. It exists for local demos
        and testnet lifecycles where staking five resolvers is not the thing being tested — and every market on
        Galileo today was settled this way.
        <p className="mt-2">
          Two things keep it honest. The allowlist is empty unless an owner deliberately fills it, and a market
          settled this way is recorded with <C>viaCommittee == false</C>. So a reader can always tell an
          operator&rsquo;s decision from a committee&rsquo;s, rather than having to trust that the difference
          was disclosed.
        </p>
      </Note>

      <Note kind="info" title="What a settlement leaves behind">
        A receipt root per resolver, a receipt root for the resolution itself, and the winning outcome — all on
        chain. The documents they address are on 0G Storage and fetchable by anyone. That is what a market page
        reads when it shows the evidence behind an outcome, and it is why a losing trader here has something to
        check rather than a result to accept.
      </Note>
    </DocPage>
  );
}
