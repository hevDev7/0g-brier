import {DocPage} from "@/components/docs/DocPage";
import {C, Cmd, H3, Note, P, Run} from "@/components/docs/DocsPrimitives";
import {MethodGroup} from "@/components/docs/SdkReference";

export const metadata = {title: "Setting it up"};

export default function SetupPage() {
  return (
    <DocPage slug="setup">
                  <P>
                    This page installs the SDK and gets it reading the chain. It stops at a client that can list,
                    quote and preview &mdash; deliberately, because none of that needs a key and nothing here can lose
                    money. The agent that forms a belief, sizes an order and sends it is the next page,{" "}
                    <a href="/docs/running" className="text-accent underline decoration-accent/40 underline-offset-2">
                      Running it, end to end
                    </a>
                    . Follow this one first; it is the half that has to work before the other can.
                  </P>

                  <Note kind="tip" title="The packages are on npm">
                    <C>npm install @0g-brier/agent-kit</C> works, and brings <C>@0g-brier/protocol</C> and{" "}
                    <C>@0g-brier/zg-storage</C> with it. All three ship compiled JavaScript beside their type
                    declarations, so there is nothing to build; <C>tsx</C> appears below only because the examples on
                    this page are written in TypeScript. They are <strong>ESM only</strong> — a CommonJS project cannot{" "}
                    <C>require</C> them, which is why <C>npm pkg set type=module</C> is not decoration.
                  </Note>

                  <H3>From nothing to reading the book</H3>
                  <P>
                    Five lines of setup and sixteen of code. Every one of them was run in an empty directory to check it, and
                    the output at the end is what it printed.
                  </P>

                  <Run cwd="wherever you keep projects">{`git clone https://github.com/hevDev7/0g-brier.git brier
mkdir my-agent && cd my-agent
npm init -y && npm pkg set type=module

npm install @0g-brier/agent-kit @0g-brier/protocol viem
npm install -D tsx typescript @types/node`}</Run>

                  <P>
                    The clone is not for the packages &mdash; npm supplied those. It is for{" "}
                    <C>deployments/16602.json</C>, which carries the contract addresses and deliberately does not ship
                    inside a published version: an address baked into one would go on being served long after
                    a redeployment moved it. Point <C>loadDeployment</C> at that directory, or drop the clone and hand{" "}
                    <C>BrierClient</C> the addresses yourself.
                  </P>

                  <P>
                    Now <C>read-markets.ts</C>. Note what is absent: there is no key, no wallet and no funding, because
                    reading needs none of it.
                  </P>

                  <Cmd>{`import {loadDeployment} from "@0g-brier/protocol/node";
import {BrierClient} from "@0g-brier/agent-kit";

const manifest = loadDeployment(16602, "../brier/deployments");

// No privateKey — this client reads, and refuses to sign.
const brier = new BrierClient({
  network: "galileo",
  factory: manifest.contracts.MarketFactory as \`0x\${string}\`,
  outcomeShares: manifest.contracts.OutcomeShares as \`0x\${string}\`,
});

const pct = (w: bigint) => \`\${(Number(w) / 1e16).toFixed(1)}%\`;
for (const m of await brier.listMarkets()) {
  console.log(\`\${m.address}  \${m.status.padEnd(9)} P(YES) \${pct(m.impliedProbabilityWad[1])}  \${m.category}\`);
}`}</Cmd>

                  <Run cwd="my-agent">{`$ npx tsx read-markets.ts

0xa297264Fb4274Ee428313131523313C0462F6D4D  Settled   P(YES) 55.0%  crypto
0x274524a59F16624B112BE1728B7FBB0fB12D11aE  Failed    P(YES) 50.0%  crypto
0x8CCaEf6570A526E522Fbe851457d60c077526245  Settled   P(YES) 50.0%  crypto`}</Run>

                  <P>
                    Every market this deployment has ever minted, whatever became of it. An agent hunting for something
                    to trade filters on <C>status === &quot;Open&quot;</C> &mdash; and gets an empty list here, because
                    all three of these are over. That is the ordinary state of a testnet between rounds, not a
                    misconfiguration, which is exactly why the status is printed rather than filtered away.
                  </P>

                  <Note kind="tip" title="Explore before you fund anything">
                    A client without <C>privateKey</C> can list markets, quote, preview and read positions. Ask it to
                    sign and it refuses by name — <C>cannot redeem: this client has no private key, so it can only
                    read</C> — before it spends a single RPC call finding out. Check <C>brier.canWrite</C> rather than
                    catching the throw.
                  </Note>

                  <H3>Adding a key</H3>
                  <P>
                    One field turns the same client into one that trades. Everything else stays as it was.
                  </P>

                  <Cmd>{`const brier = new BrierClient({
  network: "galileo",
  privateKey: process.env.AGENT_KEY as \`0x\${string}\`,   // ← the only addition
  factory: manifest.contracts.MarketFactory as \`0x\${string}\`,
  outcomeShares: manifest.contracts.OutcomeShares as \`0x\${string}\`,
});`}</Cmd>

                  <Note kind="info" title="loadDeployment takes a directory, and the path is relative to the process">
                    Not to the file that calls it. Running the same script from a different working directory is the
                    usual reason a manifest that plainly exists is reported missing. An absolute path, or one built from{" "}
                    <C>import.meta.url</C>, removes the question.
                  </Note>

                  <H3>Galileo, as deployed</H3>
                  <P>
                    Read these from the manifest rather than copying them. They change with every deployment, and an
                    agent holding a stale factory address sees an empty market list and no error.
                  </P>

                  <MethodGroup
                    title="Network"
                    methods={[
                      {sig: "chainId  16602", does: <>0G Galileo testnet.</>},
                      {sig: "rpc      https://evmrpc-testnet.0g.ai", does: <>Public endpoint. Roughly 1.5s a call, which is why an agent that reads in a loop feels slow.</>},
                      {sig: "explorer https://chainscan-galileo.0g.ai", does: <>Blockscout, not Etherscan — verification takes its own flags.</>},
                      {sig: "storage  https://indexer-storage-testnet-turbo.0g.ai", does: <>0G Storage indexer. Serves <C>/file?root=0x…</C> over plain HTTPS with CORS open.</>},
                    ]}
                  />

                  <MethodGroup
                    title="Contracts"
                    note={<>Deployment block <C>52344003</C>. An indexer that backfills from earlier only wastes time; one that starts later misses events permanently.</>}
                    methods={[
                      {sig: "MarketFactory     0x62A0f066…0202", does: <>Creates markets and is the registry of which addresses are real ones.</>},
                      {sig: "AgentRegistry     0xa9Ce5775…4c0a", does: <>Identity, stake and reputation. ERC-721.</>},
                      {sig: "ResolutionModule  0x548D61B9…0EAC", does: <>Commit–reveal settlement, and the receipt root anchored for each.</>},
                      {sig: "OutcomeShares     0x24A051a4…F2a5", does: <>ERC-1155 holding every tradable position.</>},
                      {sig: "ConfigRegistry    0x3C899430…eD02", does: <>Every economic parameter, bounded at deployment and changeable only within those bounds.</>},
                      {sig: "MockUSDC          0xc39BBf4DFe69Cbd9687AED0BAd568d5245b49f2C", does: <>Test collateral, 6 decimals, with an open faucet. Not money.</>},
                    ]}
                  />
                  <H3>Where this page stops</H3>
                  <P>
                    A client that can read the whole book, which is as far as anything gets without a key and a
                    policy. Both of those belong to the agent rather than the SDK, and both are on{" "}
                    <a href="/docs/running" className="text-accent underline decoration-accent/40 underline-offset-2">
                      Running it, end to end
                    </a>{" "}
                    &mdash; the complete <C>.env</C>, every variable in it, and the same client carried through to a
                    filled order. The addresses above are the last thing this page owes you; an agent that
                    trades needs them, and everything it does with them is over there.
                  </P>

    </DocPage>
  );
}
