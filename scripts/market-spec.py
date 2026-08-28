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
import datetime as _dt
import json
import sys


def _iso(ts: int) -> str:
    return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

TIERS = ["FAST", "VERIFIED", "DETERMINISTIC"]

SPECS = {
    "crypto": {
        "resolvesBy": 1790812799,  # the Coinbase close for 2026-09-30 23:59 UTC
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
        "resolvesBy": 1830297600,  # 1 January 2028, the date the question names
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
        "resolvesBy": 1810000000,  # the end of the 2026-27 Premier League season
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
        "resolvesBy": 1793318400,  # the flash HICP release for October 2026
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
        "resolvesBy": 1846022400,  # 1 July 2028, the date the question names
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
        "resolvesBy": 1804291200,  # the 2027 Academy Awards ceremony
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
        "resolvesBy": 0,  # the market's own settlement, so as soon as it is closed
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

def _live_spec(trading_end: int, settlement_deadline: int) -> dict:
    """A question built from THIS market's window, so it can actually be answered.

    Every other spec here names a fixed future date, which is fine for a market
    given months and impossible for one given hours. This one instead picks a
    minute inside the trading window and asks about that minute — so the
    observation exists before the deadline, by construction rather than by luck.

    The minute is pinned in the URL with `start` and `end` set to the same second.
    That matters: the range is inclusive at both ends, so `end = t + 60` returns
    TWO candles and Coinbase orders them newest-first — `$[0]` would then be the
    minute AFTER the one the question names, and the resolver would confidently
    read the wrong number. `end = t` returns exactly the candle asked for.

    The threshold sits about 1% BELOW the live price, and that number is the whole
    design of this question.

    At the spot price it is a coin flip: nobody can forecast a specific minute's
    close seven minutes out, and an honest agent says so and declines — which is
    exactly what happened the first time this category existed. A resolvable
    question is not automatically a forecastable one, and a market nobody can
    take a view on produces no trades to settle.

    Far from spot it is a formality — the answer is known at creation.

    One percent is the useful gap for this horizon: ETH essentially never travels
    that far in seven minutes, so a forecaster can defensibly say "very likely"
    without saying "certain", and has something to be measured against. Widen the
    window and this figure has to widen with it.
    """
    import urllib.request

    minute = (trading_end - 180) // 60 * 60
    if minute + 120 > settlement_deadline:
        sys.exit("market-spec: 'live' needs the settlement deadline at least 5 minutes past tradingEnd")

    def iso(ts: int) -> str:
        return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).isoformat().replace("+00:00", "Z")

    base = "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=60"
    url = f"{base}&start={iso(minute)}&end={iso(minute)}"

    # The threshold has to come from a price, and a price has to be fetched. If
    # that fails, stop: a spec with a made-up threshold is worse than no spec.
    try:
        req = urllib.request.Request(f"{base}&limit=1", headers={"User-Agent": "brier-spec/1.0"})
        latest = json.loads(urllib.request.urlopen(req, timeout=15).read())
        spot = float(latest[0][4])
    except Exception as exc:  # noqa: BLE001 — the reason belongs in the message
        sys.exit(f"market-spec: 'live' could not read a price to set its threshold: {exc}")
    threshold = round(spot * 0.99 / 5) * 5

    when = _dt.datetime.fromtimestamp(minute, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return {
        "resolvesBy": minute + 120,
        "question": f"Will the Coinbase ETH-USD close for the minute ending {when} be above ${threshold:,.2f}?",
        "rules": (
            f"Resolves YES if the Coinbase ETH-USD candle for the minute beginning {minute} "
            f"(unix seconds) has a close strictly greater than {threshold:.2f} USD. Resolves NO if "
            f"it is {threshold:.2f} or below. Deemed UNRESOLVABLE only if Coinbase publishes no "
            "candle for that exact minute. The source URL pins that minute at both ends, so it "
            "returns one candle and the same one on every later request."
        ),
        "settlementPrompt": (
            f"Source 0 is the Coinbase candle for the minute beginning {minute}, as "
            "[time, low, high, open, close, volume]. Read the close — the fifth element, which the "
            f"selector has already extracted. Answer YES if it is strictly greater than {threshold:.2f}, "
            "NO otherwise. Do not substitute a neighbouring minute or the current price."
        ),
        "sources": [{"kind": "http", "url": url, "selector": "$[0][4]"}],
        # What SETTLES the question is the minute above, and before that minute
        # arrives the source correctly answers "no candle". A forecaster given only
        # that has been handed an empty box. `context` is what bears on the
        # question NOW: the same instrument, most recent close.
        "context": [{"kind": "http", "url": f"{base}&limit=1", "selector": "$[0][4]"}],
    }


trading_end, settlement_deadline, tier, agent_id = (int(a) for a in sys.argv[1:5])
category = sys.argv[5] if len(sys.argv) > 5 else "crypto"
if category != "live" and category not in SPECS:
    sys.exit(f"market-spec: unknown category {category!r}. Known: live, {', '.join(SPECS)}")

spec = _live_spec(trading_end, settlement_deadline) if category == "live" else SPECS[category]

# ── the check that has to happen here, because nothing downstream can do it ──
#
# A market whose question resolves AFTER its own settlement deadline can never be
# settled. No resolver, however good, can observe a thing that has not happened.
# It is not a bad market, it is an impossible one — and three of them were created
# on this testnet: questions dated a month to sixteen months out, given a
# three-hour window. All three ran their clock down and had to be failed.
#
# The contract cannot catch this: `createMarket` sees a `bytes32` spec root and
# has no idea what the question means. The resolver cannot catch it either — by
# the time it looks, the market exists and the money is in it. This script is the
# last place that holds the question and the deadline at the same time, so the
# refusal belongs here.
#
# `resolvesBy == 0` means the question resolves from the market's own state
# (`selftest`), which is answerable the moment it closes.
resolves_by = spec["resolvesBy"]
if resolves_by and resolves_by > settlement_deadline:
    late = (resolves_by - settlement_deadline) / 3600
    sys.exit(
        f"market-spec: {category!r} cannot be settled in this window.\n"
        f"  the question resolves at {resolves_by} ({_iso(resolves_by)})\n"
        f"  the market must be settled by {settlement_deadline} ({_iso(settlement_deadline)})\n"
        f"  that is {late:,.1f} hours too early — no observation before the deadline can decide it.\n"
        f"  Use a longer settlementDeadline, or a category whose question resolves sooner."
    )
# `selftest` is a demo scaffold; on chain it is filed under crypto, which the
# registry knows. Inventing a category the registry has never heard of would make
# `createMarket` revert with UnknownCategory, which is exactly right of it.
on_chain_category = "crypto" if category in ("selftest", "live") else category

print(json.dumps({
    "version": 1,
    "question": spec["question"],
    "rules": spec["rules"],
    "category": on_chain_category,
    "sources": spec["sources"],
    "context": spec.get("context", []),
    "settlementPrompt": spec["settlementPrompt"],
    "tier": TIERS[tier],
    "tradingEnd": trading_end,
    "resolvesBy": resolves_by,
    "settlementDeadline": settlement_deadline,
    "creatorAgentId": agent_id,
}, indent=2))
