# Verifying a settlement receipt yourself

Four commands. Every one of them was run against Galileo on 2026-08-30 and the
output below is what it printed.

Nothing here trusts the Brier website, and nothing here needs the protocol
repository — only `curl`, `node`, and one published package.

The example is the weather market
`0x5bccca83d6306440592d23b7e7c7b8fa508d8494`, settled YES by a committee of
three. Substitute any settled market's address.

---

## 1. Read the root the chain recorded

The receipt is *not* on the chain. Its Merkle root is, one per resolver, in
`receiptRootOf(market, agentId)` on the ResolutionModule.

```bash
MARKET=5bccca83d6306440592d23b7e7c7b8fa508d8494   # no 0x, lower case
AGENT=2

ROOT=$(curl -s -X POST https://evmrpc-testnet.0g.ai \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{
        \"to\":\"0x548D61B9A372cBa05407087eF0eD29B92D340EAC\",
        \"data\":\"0x036f5057000000000000000000000000${MARKET}$(printf '%064x' $AGENT)\"
      },\"latest\"]}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])')

echo "$ROOT"
```

```
0x0febad522d3ea8912579f88a14ab53c873d6704b2fc7620854c76f02dd6e276c
```

`0x036f5057` is the first four bytes of `keccak256("receiptRootOf(address,uint256)")`.
The calldata is that selector, then the market address left-padded to 32 bytes,
then the agent id left-padded to 32 bytes.

> **Why not the block explorer?** The ResolutionModule address is an ERC-1967
> proxy, and the explorer has only the proxy's ABI for it — its "Read Contract"
> tab lists no functions at all. The implementation is verified separately, but
> the two are not linked there. `eth_call` goes through the proxy the way any
> caller does, which is why this uses the RPC directly.

---

## 2. Fetch the document that root names

```bash
curl -s "https://indexer-storage-testnet-turbo.0g.ai/file?root=$ROOT" -o receipt.json
wc -c receipt.json
```

```
1782 receipt.json
```

---

## 3. Read what the resolver actually said

```bash
python3 -m json.tool receipt.json | head -30
```

The fields that matter:

| field | this receipt |
|---|---|
| `outcome` | `YES` |
| `inference.model` | `qwen/qwen2.5-omni-7b` |
| `inference.teeVerified` | `true` |
| `inference.providerAddress` | `0xa48f01287233509FD694a22Bf840225062E67836` |
| `inference.chatID` | the request's id at the provider |
| `rationale` | the resolver's own words, verbatim |

`teeVerified: true` means an enclave ran that model over that input. It does
**not** mean the answer is right, and the receipt does not claim it does — that
is what the criteria and the source are for, and you can check those yourself in
step 4 of the market's own spec.

---

## 4. Recompute the root from the bytes

This is the step that makes the other three worth doing. Anyone can serve you a
JSON file; only the real one hashes to the number the chain recorded.

```bash
mkdir verify && cd verify
npm init -y >/dev/null && npm pkg set type=module
npm install @0g-brier/zg-storage

cat > recompute.mjs <<'EOF'
import {readFileSync} from "node:fs";
import {zgMerkleRoot} from "@0g-brier/zg-storage";
const bytes = readFileSync(process.argv[2]);
const computed = zgMerkleRoot(new Uint8Array(bytes));
console.log(`computed: ${computed}`);
console.log(`anchored: ${process.argv[3]}`);
console.log(computed === process.argv[3] ? "MATCH" : "MISMATCH");
EOF

node recompute.mjs ../receipt.json "$ROOT"
```

```
computed: 0x0febad522d3ea8912579f88a14ab53c873d6704b2fc7620854c76f02dd6e276c
anchored: 0x0febad522d3ea8912579f88a14ab53c873d6704b2fc7620854c76f02dd6e276c
MATCH
```

**Hash the bytes you received, never a re-serialised object.** `JSON.parse` then
`JSON.stringify` will not reproduce the document's own whitespace and key order,
and its root will differ — which reads as tampering when it is only formatting.
That is why step 2 writes to a file instead of piping through a JSON tool.

The hash is 0G Storage's own — 256-byte chunks, 1024-chunk segments, and a
padding rule that rounds up to a sixteenth of the next power of two — not
`keccak256`. `zgMerkleRoot` is the same implementation the contracts use, tested
against 0G's reference vectors, which is why this check means something.

---

## Doing it for the whole committee

A committee settlement writes one receipt per resolver, and they are different
documents. Repeat step 1 with each `AGENT` id — `committeeOf(market)` lists
them — and you should get three distinct roots, three distinct documents, and
three independent statements of the same verdict.

Three identical roots would mean the resolvers copied one another's work.

---

## What this does not prove

That the model was right. A receipt establishes **what was claimed, by which
model, on which evidence, and that nobody edited it afterwards**. Whether the
claim is true is settled by reading the market's own source — the URL in its
spec, which pins the exact minute or hour — and comparing. The protocol makes
the judgement auditable; it does not make it correct.
