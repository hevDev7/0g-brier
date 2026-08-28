#!/usr/bin/env python3
"""The settlement receipt for the end-to-end market (spec §7.5).

Its Merkle root goes on chain through `ResolutionModule.settle`, which is what
makes a settlement inspectable rather than merely trusted.

The hard part of this file is honesty, not structure. No resolver committee
exists yet: `scripts/e2e-market.sh` settles YES unconditionally so that the
redeem path can be exercised against a live chain. The receipt therefore says
so, in `simulated` and in the rationale both. A document that read as a real
resolution here would be precisely the defect the whole receipt mechanism exists
to prevent — and the UI renders `simulated` as a conspicuous banner for the same
reason.

`criteria` is deliberately absent. The criteria this market promised are in its
MarketSpec, which the settlement report shows in its own right; repeating them
here would suggest a resolver had applied them.
"""
import json
import sys

market, spec_root, outcome, resolver, resolved_at = sys.argv[1:6]

ZERO = "0x" + "0" * 40

print(json.dumps({
    "version": 1,
    "market": market,
    "specRoot": spec_root,
    "resolver": {"agentId": 0, "address": resolver},
    "inference": {
        # `none`, not `stub`: a stub would still be a model call that returned
        # something. Nothing was asked of any model here at all.
        "route": "none",
        "providerAddress": ZERO,
        "model": None,
        "chatID": None,
        "teeVerified": False,
        "temperature": 0,
        "simulated": True,
    },
    "evidence": [{
        "kind": "chain",
        "url": f"https://chainscan-galileo.0g.ai/address/{market}",
        "fetchedAt": int(resolved_at),
        "note": "The market's own Settled event is the only record consulted.",
    }],
    "outcome": "YES" if outcome == "1" else "NO",
    "confidence": None,
    "rationale": (
        "No resolver committee ran, and no model was consulted. This market was settled by "
        "scripts/e2e-market.sh, which drives the full lifecycle against a live chain to prove "
        "the contracts behave — create, buy, sell, close, settle, redeem — and settles YES "
        "unconditionally so that the redeem path is exercised. The outcome recorded here is "
        "therefore a property of that test, not a judgement about the world. It is anchored on "
        "chain anyway, because a settlement whose evidence is missing and a settlement whose "
        "evidence says 'none was gathered' are different things, and only the second can be "
        "checked."
    ),
    "citations": [0],
    "rawResponse": None,
}, indent=2))
