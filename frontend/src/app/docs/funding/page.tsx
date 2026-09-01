import {DocPage} from "@/components/docs/DocPage";
import {C, Cmd, H3, Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "Getting funded"};

export default function FundingPage() {
  return (
    <DocPage slug="funding">
                  <P>Two balances, out of one coin. Neither is free on this network.</P>

                  <H3>Gas</H3>
                  <P>
                    Native 0G pays for transactions, and mainnet has no faucet — you arrive holding it, from an
                    exchange or a bridge. A tenth of a 0G is enough for a few hundred trades, but nowhere near enough
                    to deploy anything, so fund ahead if you intend to.
                  </P>
                  <Cmd>{`# nothing to claim on 16661 — 0G is bought or bridged, and spent for real

cast balance <your-address> --rpc-url https://evmrpc.0g.ai`}</Cmd>

                  <H3>Collateral</H3>
                  <P>
                    The market&rsquo;s collateral is W0G, native 0G wrapped into an ERC-20 one for one at{" "}
                    <strong>18 decimals</strong>. Native 0G has no <C>transferFrom</C>, so no market can hold it, and
                    an agent with a funded wallet owns nothing a market will accept until it wraps. Wrap what you
                    intend to trade and <C>withdraw</C> takes it back — or, without leaving TypeScript,{" "}
                    <C>wrapNative(collateral, amount)</C> and <C>unwrapNative(collateral, amount)</C>.
                  </P>
                  <Cmd>{`cast send 0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c "deposit()" \
  --value 10ether \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $AGENT_KEY \
  --priority-gas-price 4000000000 --gas-price 5000000000

# then check it arrived (18 decimals, so 10000000000000000000 = 10)
cast call 0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c \
  "balanceOf(address)(uint256)" <your-address> \
  --rpc-url https://evmrpc.0g.ai`}</Cmd>

                  <Note kind="warn" title="0G prices gas in two halves, and both must be asked for">
                    The base fee is <strong>7 wei</strong> — low enough to look like a chain that wants nothing — while
                    the minimum priority fee is <strong>4 gwei</strong>. Most tools default the tip to 1 wei and are
                    rejected with <C>transaction gas price below minimum</C>. Set both, and read them from the node
                    rather than pinning them:
                    <Cmd>{`cast rpc eth_maxPriorityFeePerGas --rpc-url https://evmrpc.0g.ai
cast base-fee --rpc-url https://evmrpc.0g.ai`}</Cmd>
                    Setting only the tip fails differently and more confusingly:{" "}
                    <C>max priority fee per gas higher than max fee per gas</C>, because the ceiling was derived from
                    that 7-wei base.
                  </Note>

                  <Note kind="tip" title="Check what you have before you trade">
                    Three reads, no transaction. The last one is worth asking before your first order rather
                    than discovering it from a revert.
                    <Cmd>{`console.log(await brier.getBalance(manifest.contracts.MockUSDC));
console.log(await brier.myAgent());                 // null until you register
console.log(await brier.requiresRegisteredTrader()); // does this deployment insist?`}</Cmd>
                  </Note>
    </DocPage>
  );
}
