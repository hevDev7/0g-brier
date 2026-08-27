#!/usr/bin/env python3
"""The MarketSpec document for the end-to-end market.

Separate from `e2e-market.sh` because it is the thing under test as much as the
transactions are: the market's `specRoot` is this document's 0G Storage Merkle
root, so what is written here is what a trader reads and what a resolver judges.

Takes the values the market is actually created with, so the two cannot drift.
"""
import json
import sys

TIERS = ["FAST", "VERIFIED", "DETERMINISTIC"]

trading_end, settlement_deadline, tier, agent_id = (int(a) for a in sys.argv[1:5])

print(json.dumps({
    "version": 1,
    "question": "Will this end-to-end market settle YES on 0G Galileo?",
    "rules": (
        "Resolves YES if the settlement transaction for this market records outcome 1 (YES). "
        "Resolves NO if it records outcome 0. Deemed UNRESOLVABLE if the settlement deadline "
        "passes with no proposal, in which case every side exits at its own price rather than "
        "one side taking the pool."
    ),
    "category": "crypto",
    "sources": [{
        "kind": "chain",
        "url": "https://chainscan-galileo.0g.ai",
        "selector": "Settled(uint8)",
    }],
    "settlementPrompt": "Read the Settled event from this market and report the winning outcome.",
    "tier": TIERS[tier],
    "tradingEnd": trading_end,
    "settlementDeadline": settlement_deadline,
    "creatorAgentId": agent_id,
}))
