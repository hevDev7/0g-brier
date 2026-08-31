import {DocPage} from "@/components/docs/DocPage";
import {A, C, Cmd, H3, Note, P, Run} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "What comes from npm"};

export default function PackagesPage() {
  return (
    <DocPage slug="packages">
      <P>
        Three packages. <C>agent-kit</C> is at <C>0.1.1</C>; <C>protocol</C> and{" "}
        <C>zg-storage</C> are at <C>0.1.0</C> and unchanged since, because nothing in either of them
        moved. An agent installs the first and receives the other two. They are worth telling apart: only one of the three can sign anything, and
        only one is safe to import into a browser.
      </P>

      <MethodGroup
        title="Published"
        note={
          <>
            All three are <strong>ESM only</strong> and ship compiled JavaScript beside its{" "}
            <C>.d.ts</C> declarations. Nothing has to be built after installing and nothing has to be
            transpiled before running &mdash; <C>tsx</C> appears in these pages only because the
            examples are written in TypeScript, not because the packages require it.
          </>
        }
        methods={[
          {
            sig: "@0g-brier/agent-kit",
            does: (
              <>
                The client. <C>BrierClient</C>, the ABIs, the 0G Compute inference wrapper, and every
                method that can send a transaction. Depends on the other two, so installing it alone
                is enough to run an agent.
              </>
            ),
          },
          {
            sig: "@0g-brier/protocol",
            does: (
              <>
                Arithmetic and types. No RPC, no keys, no state, and no <C>node:</C> import in its
                main entry &mdash; which is what lets this website import the very same module. The
                probability on a market page and the one your agent computes come from one
                implementation rather than two that agree by hand.
              </>
            ),
          },
          {
            sig: "@0g-brier/zg-storage",
            does: (
              <>
                Fetching a document from 0G Storage and proving the bytes are the bytes the root
                names. Kept apart from the client because a page that only reads has no business
                carrying a signer.
              </>
            ),
          },
        ]}
      />

      <Run cwd="your agent project">{`npm install @0g-brier/agent-kit`}</Run>

      <P>
        Name the others in the install as well if you import from them directly, which every example
        on these pages does: a package you import should be a package you depend on, not one you
        reach through somebody else&rsquo;s tree.
      </P>

      <Note kind="info" title="The sibling versions are pinned exactly, with no caret">
        <C>agent-kit@0.1.1</C> requires <C>@0g-brier/protocol@0.1.0</C> and{" "}
        <C>@0g-brier/zg-storage@0.1.0</C> &mdash; exact, not <C>^0.1.0</C>. The DPM mirror inside{" "}
        <C>protocol</C> is checked against the Solidity library&rsquo;s own test vectors, and a caret
        would let a later mirror be resolved beside a client that was never checked against it.{" "}
        <C>ethers</C> is pinned for the same reason. <C>viem</C> is not: nothing here is differential
        against it.
      </Note>

      <H3>@0g-brier/protocol</H3>
      <P>
        Two of its modules are exported as namespaces and the rest are flat, which decides how you
        import them. Everything is <C>bigint</C>; there is no floating point anywhere in this package.
      </P>

      <Cmd>{`import {WAD, toTokensFloor, dpm, quote} from "@0g-brier/protocol";

const shares = dpm.sharesForSpend(q, 1, spendWad);
const rate = quote.payoutPerShareWad(q, 1);`}</Cmd>

      <MethodGroup
        title="dpm — the cost function"
        note={
          <>
            The mirror of <C>DPMMath.sol</C>, tested against the vectors that library generates. Every
            number a market quotes falls out of <C>C(q) = √(Σqᵢ²)</C>.
          </>
        }
        methods={[
          {sig: "cost(q)", does: <>Collateral the pool must hold for share vector <C>q</C>, rounded down.</>},
          {
            sig: "costUp(q)",
            does: (
              <>
                The same, rounded up. This is the one the contract keeps: <C>poolWad == costUp(q)</C>{" "}
                at every transaction boundary, so every speck of rounding dust stays inside the pool
                rather than leaking to a trader.
              </>
            ),
          },
          {sig: "price(q, i)", does: <>Marginal price of outcome <C>i</C>, wad. <C>qᵢ / C(q)</C>.</>},
          {
            sig: "probability(q, i)",
            does: (
              <>
                The implied probability, which is <C>price²</C> and not <C>price</C>. Reading one for
                the other overstates a payout by roughly 30% at ordinary skew.
              </>
            ),
          },
          {sig: "sharesForSpend(q, i, spendWad)", does: <>Shares a budget buys, after the cost function curves under it.</>},
          {
            sig: "seedShares(seedWad)",
            does: (
              <>
                <C>√(seed² / 2)</C> &mdash; the position a creator holds on <strong>both</strong>{" "}
                sides. A seed is a position, not a deposit, and it is not returned.
              </>
            ),
          },
          {sig: "isqrt(n) · isqrtCeil(n)", does: <>Integer square root, floored and ceilinged. Exposed because the rounding direction is load-bearing.</>},
          {sig: "MAX_Q", does: <>The bound past which <C>q</C> would overflow the contract&rsquo;s own arithmetic.</>},
        ]}
      />

      <MethodGroup
        title="quote — what a budget buys"
        note={
          <>
            A reference implementation, not the authority. Before signing, call{" "}
            <C>quoteBuySpend</C> on the market itself: that number is the one the contract will
            honour, and this one exists so a UI and an agent can agree about it beforehand.
          </>
        }
        methods={[
          {sig: "quoteBuy({q, outcome, spendWad, feeBps})", does: <>Shares out, pool-in, fee, average price and the payout rate before and after. The whole preview in one call.</>},
          {sig: "payoutPerShareWad(q, outcome)", does: <>What one winning share redeems for, wad. <C>1/pᵢ</C> &mdash; never <C>1/Pᵢ</C>.</>},
          {sig: "qAfterBuy(q, outcome, shares)", does: <>The book after a purchase, for showing what a trade would do to the price it is paying.</>},
          {sig: "feeFromGross(grossWad, feeBps)", does: <>The fee contained <strong>within</strong> a gross budget. The denominator is <C>10000 + feeBps</C>, not <C>10000</C>.</>},
        ]}
      />

      <MethodGroup
        title="units — the two decimals"
        note={
          <>
            Shares carry 18 decimals; collateral carries the token&rsquo;s own, which is 6 for the
            mUSDC used here. Both are <C>bigint</C> and the types do not distinguish them, so a
            quantity converted with the wrong one is out by a factor of a trillion and still looks
            like a number.
          </>
        }
        methods={[
          {sig: "WAD", does: <>10¹⁸.</>},
          {sig: "scaleFor(decimals)", does: <>The multiplier between a token&rsquo;s units and wad.</>},
          {sig: "toWad(tokens, decimals)", does: <>Token units up to wad. Exact.</>},
          {
            sig: "toTokensFloor(wad, decimals) · toTokensCeil(wad, decimals)",
            does: (
              <>
                Wad down to token units. Which one you want depends on who the remainder should
                favour: floor what you pay out, ceil what you charge.
              </>
            ),
          },
        ]}
      />

      <MethodGroup
        title="categories, modes, networks, deployments"
        methods={[
          {sig: "CATEGORIES · isCategory(value)", does: <>The fixed category list, and the guard that keeps an unknown string out of it.</>},
          {sig: "categoryBit(category) · categoryMask(categories)", does: <>Categories as a bitmask, which is how a resolver&rsquo;s competence is recorded on chain.</>},
          {sig: "networkFor(mode, env)", does: <>Chain id, RPC and explorer for <C>anvil</C>, <C>galileo</C> or <C>mainnet</C>. Reads overrides from the environment you hand it.</>},
          {sig: "loadModes(env)", does: <>Validates a set of the three axes an agent is configured along &mdash; <C>CHAIN_MODES</C>, <C>STORAGE_MODES</C> and <C>INFERENCE_MODES</C>, each exported beside it.</>},
          {sig: "parseDeployment(raw, expectedChainId)", does: <>A manifest, checked rather than trusted. Refuses one whose chain id is not the one you asked for.</>},
          {sig: "requireContracts(m, names)", does: <>Asserts the addresses you are about to use are actually in the manifest, so a missing one names itself here instead of as an empty result later.</>},
        ]}
      />

      <Note kind="warn" title="loadDeployment lives on a subpath, and that is the whole point">
        It reads the manifest with <C>node:fs</C>, which cannot enter a browser bundle. Putting it
        behind <C>@0g-brier/protocol/node</C> rather than in the barrel is what keeps the main entry
        importable by this website. An agent reaches for the subpath; anything rendering in a browser
        must not.
      </Note>

      <Cmd>{`import {WAD, dpm, quote} from "@0g-brier/protocol";       // anywhere
import {loadDeployment} from "@0g-brier/protocol/node";  // Node only`}</Cmd>

      <MethodGroup
        title="@0g-brier/protocol/node"
        methods={[
          {
            sig: "loadDeployment(chainId, dir)",
            does: (
              <>
                Reads <C>{"<dir>/<chainId>.json"}</C> and parses it. <C>dir</C> defaults to{" "}
                <C>deployments/</C> under the <strong>process&rsquo;s</strong> working directory, not
                the calling file&rsquo;s &mdash; which is the usual reason a manifest that plainly
                exists is reported missing.
              </>
            ),
          },
        ]}
      />

      <Note kind="info" title="The manifest is not in the package">
        Addresses ship in{" "}
        <A href="https://github.com/hevDev7/0g-brier">the repository</A>, not in a published version,
        because an address baked into a published version would go on being served long after a redeployment
        moved it. Clone it for <C>deployments/</C>, or read the addresses off{" "}
        <a href="/docs/setup" className="text-accent underline decoration-accent/40 underline-offset-2">
          Setting it up
        </a>{" "}
        and hand them to <C>BrierClient</C> yourself.
      </Note>

      <H3>@0g-brier/zg-storage</H3>
      <P>
        A market&rsquo;s question and a settlement&rsquo;s receipt live in 0G Storage, addressed by
        Merkle root. The root is on chain; the bytes are not. This package is what closes that gap
        honestly.
      </P>

      <MethodGroup
        title="Exports"
        note={
          <>
            The root is recomputed from the bytes that came back, every time, and a mismatch throws
            rather than resolving. An unverified document is worth less than none, because on screen
            it looks exactly like a verified one.
          </>
        }
        methods={[
          {
            sig: "zgMerkleRoot(data)",
            does: (
              <>
                0G Storage&rsquo;s own root over the bytes: 256-byte chunks, 1024-chunk segments, and
                the padding rule that rounds to a sixteenth of the next power of two. Not{" "}
                <C>keccak256</C> &mdash; this is the number the file can be fetched back by.
              </>
            ),
          },
          {
            sig: "ZgStore(indexerUrl, fetchImpl, persist)",
            does: (
              <>
                A verifying reader over one indexer, with an in-memory cache and optional persistence.
                What gets stored is the response <strong>text</strong>, byte for byte, because a
                re-serialised object would not reproduce the document&rsquo;s own formatting and
                every entry would fail its own check on the way out.
              </>
            ),
          },
          {
            sig: "get(root)",
            does: (
              <>
                The verified document, parsed, or <C>null</C> when the root was genuinely never
                uploaded. Throws on a mismatch and on an unreachable indexer &mdash; both are wrong
                answers rather than absent ones, and the difference is what lets a page say &ldquo;not
                available&rdquo; without lying about a tampered one.
              </>
            ),
          },
          {sig: "SpecRootMismatchError", does: <>Thrown when the bytes behind a root are not the bytes that root names.</>},
        ]}
      />

      <H3>@0g-brier/agent-kit</H3>
      <P>
        Every method it exposes is on the next page. What is worth knowing here is what it drags in
        with it, because two of those are heavier than they look.
      </P>

      <MethodGroup
        title="Dependencies"
        methods={[
          {sig: "@0g-brier/protocol and @0g-brier/zg-storage", does: <>Pinned exactly, as above.</>},
          {sig: "viem ^2.56.0", does: <>Every read and every transaction. The one dependency you are likely to already have.</>},
          {
            sig: "ethers 6.13.1",
            does: (
              <>
                Required by 0G&rsquo;s compute SDK, which is built on it. Pinned exactly because it
                is imported across an ESM/CJS boundary that a minor release has broken before.
              </>
            ),
          },
          {
            sig: "@0gfoundation/0g-compute-ts-sdk ^0.9.0",
            does: (
              <>
                TeeML inference. Only reached if your agent asks a model for a belief; an agent that
                decides some other way never loads it.
              </>
            ),
          },
        ]}
      />
      <H3>Where these live</H3>
      <P>
        Every claim on this page can be checked against the thing it describes. The published
        tarballs are on npm; the sources they were built from, the contracts they talk to and the
        manifest they read are in one repository.
      </P>

      <MethodGroup
        title="Registry and source"
        methods={[
          {
            sig: "@0g-brier/agent-kit",
            does: (
              <>
                <A href="https://www.npmjs.com/package/@0g-brier/agent-kit">npm</A> &middot;{" "}
                <A href="https://github.com/hevDev7/0g-brier/tree/main/packages/agent-kit">
                  packages/agent-kit
                </A>
              </>
            ),
          },
          {
            sig: "@0g-brier/protocol",
            does: (
              <>
                <A href="https://www.npmjs.com/package/@0g-brier/protocol">npm</A> &middot;{" "}
                <A href="https://github.com/hevDev7/0g-brier/tree/main/packages/protocol">
                  packages/protocol
                </A>
              </>
            ),
          },
          {
            sig: "@0g-brier/zg-storage",
            does: (
              <>
                <A href="https://www.npmjs.com/package/@0g-brier/zg-storage">npm</A> &middot;{" "}
                <A href="https://github.com/hevDev7/0g-brier/tree/main/packages/zg-storage">
                  packages/zg-storage
                </A>
              </>
            ),
          },
          {
            sig: "the repository",
            does: (
              <>
                <A href="https://github.com/hevDev7/0g-brier">github.com/hevDev7/0g-brier</A>{" "}
                &mdash; the Solidity these packages mirror, the examples the following pages run, and{" "}
                <C>deployments/16602.json</C>. MIT.
              </>
            ),
          },
        ]}
      />
    </DocPage>
  );
}
