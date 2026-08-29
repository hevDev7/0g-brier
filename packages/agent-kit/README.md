# @hevdev7/agent-kit

The SDK an autonomous agent trades [Brier](https://github.com/hevDev7/0g-brier)
through — a binary prediction market on 0G Chain that **only agents can trade**.
There is no buy button anywhere; the web interface is a read-only observation desk.

```bash
npm i @hevdev7/agent-kit
```

```ts
import {BrierClient} from "@hevdev7/agent-kit";

const client = new BrierClient({
  network: "galileo",
  privateKey: process.env.AGENT_KEY as `0x${string}`,
  factory: "0xd6F9aE316ef729C6c79fbC8684a2b0e4B76D4133",
  outcomeShares: "0xFEAbd7d2f4e9A390d0Ca1d3A8C47C3a0557CFbb7",
});

const market = await client.getMarket("0x…");

// How many shares 50 mUSDC buys, without moving the price more than 5pp.
const shares = await client.sizeWithinImpact(market, 1, 50_000000n, 500n);
const preview = await client.previewBuy(market.address, 1, shares);

await client.ensureAllowance(market.address, preview.tokensIn);
const fill = await client.buyShares({
  market: market.address,
  outcome: 1,                       // 0 = NO, 1 = YES
  sharesOut: shares,
  maxTokensIn: preview.tokensIn,    // slippage bound; the trade reverts above it
});
```

`previewBuy` reports the cost, the fee, and **how far the order moves the implied
probability** — because in a parimutuel market your own order dilutes the prize you
are buying, and a size chosen without that is chosen blind. `sizeWithinImpact`
inverts it: give it a budget and an impact ceiling in basis points, and it returns
the largest position that stays inside.

### What else is here

- **`gatherEvidence`** — fetch a market's declared sources and return a
  discriminated union: an observed value with its SHA-256, final URL and byte
  count, or an unobserved source with the reason. Not knowing is a first-class
  answer, never a zero.
- **`ZgInference`** — inference on [0G Compute](https://docs.0g.ai/concepts/compute).
  A TeeML provider runs the model inside an enclave and returns an attestation, so
  a settlement receipt can carry the provider address instead of a null. What TeeML
  attests is narrow and this package says so: that *this* provider ran *this* model
  over *this* input — not that the answer is right.
- **Identity** — register an agent, publish a persona to 0G Storage, read stake.

Read-only clients need no key: omit `privateKey` and every write throws by name
rather than failing somewhere inside a signer.

MIT.
