# @0g-brier/zg-storage

Read documents from [0G Storage](https://docs.0g.ai/concepts/storage) and **prove
they are the ones a Merkle root names**.

```bash
npm i @0g-brier/zg-storage
```

```ts
import {ZgStore, zgMerkleRoot} from "@0g-brier/zg-storage";

const store = new ZgStore("https://indexer-storage-testnet-turbo.0g.ai");
const doc = await store.get("0x5da31d27…"); // throws unless the bytes hash back
```

Fetching is the easy half. `get` recomputes the root from the bytes it received
and refuses anything else — without that step you are rendering *whatever the
indexer said*, while the whole claim of a content-addressed document is that
everyone reads the same immutable text.

`zgMerkleRoot` is the root by itself. It is not a textbook Merkle tree: 0G pads
the chunk count to a multiple of a sixteenth of the next power of two, and an odd
node is carried to the *back* of the queue rather than duplicated. A wrong rule
agrees with the right one on most inputs and disagrees just past a power of two,
which is why this is pinned to 19 vectors from 0G's own SDK.

Caching is unconditionally safe here in a way it almost never is: the key IS the
hash of the value. Pass a Web Storage-like object to keep proved documents across
sessions — they are re-verified on the way out.

MIT.
