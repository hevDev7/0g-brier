#!/usr/bin/env python3
"""MarketSpec documents, one per category (spec §5.2).

    python3 scripts/market-spec.py <tradingEnd> <settlementDeadline> <tier> <agentId> [category]

The document's 0G Storage Merkle root becomes the market's `specRoot`, so what is
written here is what a trader reads and what a resolver is held to. It is not
decoration around a transaction.

A NOTE ON WHAT A COMMITTEE CAN ANSWER TODAY. These are real questions about the
world, and answering them needs step 2 of spec §7.4 — gathering the evidence from
`sources[]` and storing a snapshot of each. That step does not exist yet, so a
resolver reading only this document will honestly return UNRESOLVABLE for most of
them. That is the correct behaviour and not a bug: a model with no evidence that
guessed anyway would be worse. The `selftest` category below is the exception —
its question is answerable from the market's own chain state, which is what makes
it usable for a lifecycle demo.
"""
import json
import sys

TIERS = ["FAST", "VERIFIED", "DETERMINISTIC"]

SPECS = {
    "crypto": {
        "question": "Will the ETH/USD closing price on 2026-09-30 23:59 UTC be above $4,000?",
        "rules": (
            "Resolves YES if the Coinbase ETH-USD close for the minute ending 2026-09-30 23:59:59 UTC "
            "is strictly greater than 4000.00 USD. Resolves NO if it is 4000.00 or below. Deemed "
            "UNRESOLVABLE if Coinbase publishes no candle covering that minute and no listed fallback does."
        ),
        "settlementPrompt": (
            "Read the close price from the source. Compare it to 4000.00 USD. Answer YES if strictly "
            "greater, NO otherwise. Do not substitute a nearby minute."
        ),
        "sources": [
            {"kind": "http", "url": "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60",
             "selector": "$[0][4]"},
        ],
    },
    "politics": {
        "question": "Will the United Kingdom hold a general election before 1 January 2028?",
        "rules": (
            "Resolves YES if polling day for a UK general election falls on or before 2027-12-31, as "
            "recorded by the UK Parliament. Resolves NO if no such election has been held by that date. "
            "A scheduled or announced election that has not yet been held does not count."
        ),
        "settlementPrompt": (
            "Find whether a UK general election has been HELD on or before 2027-12-31. An announcement, "
            "a dissolution, or a scheduled date is not a held election. Answer NO if none has been held."
        ),
        "sources": [
            {"kind": "http", "url": "https://www.parliament.uk/about/how/elections-and-voting/general/",
             "selector": None},
        ],
    },
    "sports": {
        "question": "Will Manchester City win the 2026-27 English Premier League title?",
        "rules": (
            "Resolves YES if Manchester City are champions of the 2026-27 Premier League at the end of "
            "the season, per the official Premier League table. Resolves NO for any other champion. "
            "Deemed UNRESOLVABLE if the season is abandoned without a champion being declared."
        ),
        "settlementPrompt": (
            "Read the final 2026-27 Premier League table. Answer YES only if Manchester City are first. "
            "A league leader mid-season is not a champion."
        ),
        "sources": [
            {"kind": "http", "url": "https://www.premierleague.com/tables", "selector": "final standings"},
        ],
    },
    "economics": {
        "question": "Will euro-area annual HICP inflation for October 2026 come in below 2.0%?",
        "rules": (
            "Resolves YES if the Eurostat FLASH estimate of euro-area annual HICP inflation for October "
            "2026 is strictly below 2.0%. Resolves NO otherwise. Only the flash release counts; a member "
            "state's preliminary estimate and any later revision do not change the decision."
        ),
        "settlementPrompt": (
            "Read the euro-area annual rate from the Eurostat FLASH release for October 2026. Compare it "
            "to 2.0%. Ignore national preliminaries and subsequent revisions."
        ),
        "sources": [
            {"kind": "http", "url": "https://ec.europa.eu/eurostat/web/hicp/data/database",
             "selector": "euro area, annual rate, flash"},
        ],
    },
    "science": {
        "question": "Will NASA's Artemis III crewed lunar landing launch before 1 July 2028?",
        "rules": (
            "Resolves YES if the Artemis III mission lifts off on or before 2028-06-30 UTC, per NASA's "
            "own mission page. Resolves NO if it has not launched by then. A launch attempt that is "
            "scrubbed before liftoff does not count; a launch that fails after liftoff does."
        ),
        "settlementPrompt": (
            "Determine whether Artemis III has LIFTED OFF on or before 2028-06-30. A scheduled date, a "
            "scrubbed attempt, or a rollout is not a liftoff."
        ),
        "sources": [
            {"kind": "http", "url": "https://www.nasa.gov/mission/artemis-iii/", "selector": None},
        ],
    },
    "culture": {
        "question": "Will a film distributed by A24 win Best Picture at the 2027 Academy Awards?",
        "rules": (
            "Resolves YES if the film awarded Best Picture at the 99th Academy Awards was distributed in "
            "the United States by A24. Resolves NO for any other distributor. Deemed UNRESOLVABLE if the "
            "ceremony does not take place."
        ),
        "settlementPrompt": (
            "Identify the Best Picture winner at the 2027 Academy Awards and its US distributor. Answer "
            "YES only if that distributor is A24. A nomination is not a win."
        ),
        "sources": [
            {"kind": "http", "url": "https://www.oscars.org/oscars/ceremonies", "selector": "Best Picture"},
        ],
    },
    # Answerable from the market's own chain state, which is what makes it usable for
    # a lifecycle demo while evidence gathering does not exist. It is NOT a real
    # prediction market and its category is not one the registry knows.
    "selftest": {
        "question": "Will this end-to-end market be settled with outcome YES?",
        "rules": (
            "Resolves YES if the settlement transaction for this market records outcome 1 (YES). Resolves "
            "NO if it records outcome 0. Deemed UNRESOLVABLE if the settlement deadline passes with no "
            "proposal, in which case every side exits at its own price."
        ),
        "settlementPrompt": "Read the Settled event from this market and report the winning outcome.",
        "sources": [
            {"kind": "chain", "url": "https://chainscan-galileo.0g.ai", "selector": "Settled(uint8)"},
        ],
    },
}

trading_end, settlement_deadline, tier, agent_id = (int(a) for a in sys.argv[1:5])
category = sys.argv[5] if len(sys.argv) > 5 else "crypto"
if category not in SPECS:
    sys.exit(f"market-spec: unknown category {category!r}. Known: {', '.join(SPECS)}")

spec = SPECS[category]
# `selftest` is a demo scaffold; on chain it is filed under crypto, which the
# registry knows. Inventing a category the registry has never heard of would make
# `createMarket` revert with UnknownCategory, which is exactly right of it.
on_chain_category = "crypto" if category == "selftest" else category

print(json.dumps({
    "version": 1,
    "question": spec["question"],
    "rules": spec["rules"],
    "category": on_chain_category,
    "sources": spec["sources"],
    "settlementPrompt": spec["settlementPrompt"],
    "tier": TIERS[tier],
    "tradingEnd": trading_end,
    "settlementDeadline": settlement_deadline,
    "creatorAgentId": agent_id,
}, indent=2))
