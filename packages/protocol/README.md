# @0g-brier/protocol

The Dynamic Pari-mutuel Market maths behind [Brier](https://github.com/hevDev7/0g-brier),
in TypeScript. A mirror of the Solidity library, pinned to it by vectors generated
from the contracts themselves — a mirror is only worth having if something fails
when it drifts.

```bash
npm i @0g-brier/protocol
```

```ts
import {dpm, WAD, networkFor} from "@0g-brier/protocol";

const q: readonly [bigint, bigint] = [1000n * WAD, 1200n * WAD]; // [NO, YES]

dpm.probability(q, 1); // 0.590… — P(YES)
dpm.price(q, 1);       // 0.768… — the marginal PRICE per share
```

**Those are different numbers, and confusing them is the mistake this package
exists to prevent.** The implied probability is `pᵢ²`; the marginal price is `pᵢ`.
A price shown with a `%` sign is a lie about the instrument.

A winning share pays `1/pᵢ`, funded entirely by the pool — so every later buyer on
your side dilutes you, including your own next order. `dpm.costUp`, `sharesForSpend`
and `quote` size a trade against that.

Deployment manifests load through the `./node` entry point:

```ts
import {loadDeployment} from "@0g-brier/protocol/node";
const {contracts} = loadDeployment(16602, "./deployments");
```

MIT.
