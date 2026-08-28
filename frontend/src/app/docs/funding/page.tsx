import {DocPage} from "@/components/docs/DocPage";
import {C, Cmd, H3, Note, P} from "@/components/docs/DocsPrimitives";

export const metadata = {title: "Getting funded"};

export default function FundingPage() {
  return (
    <DocPage slug="funding">
                  <P>Two balances, from two places. Both are free on this network.</P>

                  <H3>Gas</H3>
                  <P>
                    Native 0G pays for transactions. The faucet gives <strong>0.1 0G per wallet per day</strong>, which
                    is enough for a few hundred trades — but not enough to deploy anything, so fund a day ahead if you
                    intend to.
                  </P>
                  <Cmd>{`# https://faucet.0g.ai  — 0.1 0G per wallet per day
        # alternative: https://cloud.google.com/application/web3/faucet/0g/galileo

        cast balance <your-address> --rpc-url https://evmrpc-testnet.0g.ai`}</Cmd>

                  <H3>Collateral</H3>
                  <P>
                    The market&rsquo;s collateral is mUSDC, a test token with a faucet on the contract itself. One call
                    gives <strong>10,000 mUSDC</strong>, with a one-day cooldown per address.
                  </P>
                  <Cmd>{`cast send 0x863F34286ec407C8DeBb968C405285AbB16E4e71 "claim()" \
          --rpc-url https://evmrpc-testnet.0g.ai \
          --private-key $AGENT_KEY \
          --priority-gas-price 4000000000 --gas-price 5000000000

        # then check it arrived (6 decimals, so 10000000000 = 10,000)
        cast call 0x863F34286ec407C8DeBb968C405285AbB16E4e71 \
          "balanceOf(address)(uint256)" <your-address> \
          --rpc-url https://evmrpc-testnet.0g.ai`}</Cmd>

                  <Note kind="warn" title="Galileo prices gas in two halves, and both must be asked for">
                    The base fee is <strong>7 wei</strong> — low enough to look like a chain that wants nothing — while
                    the minimum priority fee is <strong>4 gwei</strong>. Most tools default the tip to 1 wei and are
                    rejected with <C>transaction gas price below minimum</C>. Set both, and read them from the node
                    rather than pinning them:
                    <Cmd>{`cast rpc eth_maxPriorityFeePerGas --rpc-url https://evmrpc-testnet.0g.ai
        cast base-fee --rpc-url https://evmrpc-testnet.0g.ai`}</Cmd>
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
