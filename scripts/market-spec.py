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
import os
import sys
import time


def _iso(ts: int) -> str:
    """For people to read. NOT for a URL — it contains spaces."""
    return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _isoz(ts: int) -> str:
    """For a query string. The two formats are separate functions rather than one
    with a flag, because mixing them up produces a source URL that no resolver can
    fetch — and that failure surfaces at settlement, after the money is in."""
    return _dt.datetime.fromtimestamp(ts, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

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

    # The instrument is a parameter, not a constant. The design of this question
    # — a minute inside the window, a threshold about a percent away — holds for
    # any liquid pair; only the name changes. `LIVE_PRODUCT=BTC-USD` asks about
    # Bitcoin. The 1% gap is calibrated for a seven-minute horizon, so a pair
    # materially more volatile than ETH or BTC would want a wider one.
    product = os.environ.get("LIVE_PRODUCT", "ETH-USD")
    base = f"https://api.exchange.coinbase.com/products/{product}/candles?granularity=60"
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
        "question": f"Will the Coinbase {product} close for the minute ending {when} be above ${threshold:,.2f}?",
        "rules": (
            f"Resolves YES if the Coinbase {product} candle for the minute beginning {minute} "
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


def _http_json(url: str):
    """One fetch, or stop. A spec built on a guessed API shape is a market nobody
    can settle, and the failure would surface only after money was in it."""
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "brier-spec/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def _minute_before(trading_end: int) -> int:
    """The minute the question asks about: three before trading ends, so the
    observation exists by the time the market can be settled."""
    return (trading_end - 180) // 60 * 60


def _candle_spec(product: str, trading_end: int, settlement_deadline: int, dp: int, gap: float, subject: str) -> dict:
    """A threshold question on one pinned Coinbase minute.

    The minute is pinned with `start == end`, which is what makes the answer
    permanent: the range is inclusive at both ends, so the request returns exactly
    one candle and the SAME one on every later request, forever. `end = t + 60`
    would return two and Coinbase orders them newest-first, so `$[0]` would be the
    minute AFTER the one the question names.
    """
    minute = _minute_before(trading_end)
    if minute + 120 > settlement_deadline:
        sys.exit("market-spec: needs the settlement deadline at least 5 minutes past tradingEnd")
    base = f"https://api.exchange.coinbase.com/products/{product}/candles?granularity=60"
    spot = float(_http_json(f"{base}&limit=1")[0][4])
    threshold = round(spot * (1 - gap), dp)
    when = _dt.datetime.fromtimestamp(minute, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    fmt = f"{{:.{dp}f}}"
    t = fmt.format(threshold)
    return {
        "resolvesBy": minute + 120,
        "question": f"Will the Coinbase {product} close for the minute ending {when} be above ${t}?",
        "rules": (
            f"Resolves YES if the Coinbase {product} candle for the minute beginning {minute} "
            f"(unix seconds) has a close strictly greater than {t} USD. Resolves NO if it is {t} USD or "
            "below. Deemed UNRESOLVABLE only if Coinbase publishes no candle for that exact "
            "minute. The source URL pins that minute at both ends, so it returns one candle and "
            "the same one on every later request."
        ),
        "settlementPrompt": (
            f"Source 0 is the Coinbase {product} candle for the minute beginning {minute}, as "
            "[time, low, high, open, close, volume]. Read the close — the fifth element, which "
            f"the selector has already extracted. Answer YES if it is strictly greater than {t} USD, "
            "NO otherwise. Do not substitute a neighbouring minute or the current price."
        ),
        "sources": [{"kind": "http", "url": f"{base}&start={_isoz(minute)}&end={_isoz(minute)}", "selector": "$[0][4]"}],
        "context": [{"kind": "http", "url": f"{base}&limit=1", "selector": "$[0][4]"}],
        "_subject": subject,
    }


def _live_crypto(trading_end: int, settlement_deadline: int) -> dict:
    # 1% below spot: ETH essentially never travels that far in seven minutes, so a
    # forecaster can defensibly say "very likely" without saying "certain".
    product = os.environ.get("LIVE_PRODUCT", "ETH-USD")
    return _candle_spec(product, trading_end, settlement_deadline, 2, 0.01, "a crypto price")


def _live_economics(trading_end: int, settlement_deadline: int) -> dict:
    """The dollar peg, which is an economics question and not a crypto one.

    No gap below spot here, unlike ETH. USDT-USD sits within a few hundredths of a
    cent of 1.0000 and wanders across it minute to minute, so the threshold IS the
    current price: a genuine coin flip rather than a formality. The same 1% gap
    that makes an ETH question answerable would make this one certain.
    """
    return _candle_spec("USDT-USD", trading_end, settlement_deadline, 5, 0.0, "the dollar peg")


def _live_science(trading_end: int, settlement_deadline: int) -> dict:
    """How many earthquakes the USGS records in a pinned five-minute window.

    Seismicity is close to a Poisson process, so the count in a short window is
    genuinely unknown in advance — which is what a market needs and what a weather
    forecast at this horizon cannot give, its value being published before the
    market opens.

    The threshold is CALIBRATED, not guessed: the rate over the preceding hour sets
    it, so the question lands near a coin flip instead of near a formality.
    """
    t2 = trading_end - 60
    t1 = t2 - 300
    if t2 + 60 > settlement_deadline:
        sys.exit("market-spec: 'science' needs the settlement deadline at least 2 minutes past tradingEnd")
    api = "https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson&minmagnitude=1.0"
    hour = _http_json(f"{api}&starttime={_isoz(t1 - 3600)}&endtime={_isoz(t1)}")["count"]
    expected = hour * 300 / 3600
    threshold = max(0, int(round(expected)) - 1)
    url = f"{api}&starttime={_isoz(t1)}&endtime={_isoz(t2)}"
    return {
        "resolvesBy": t2 + 60,
        "question": (
            f"Will the USGS record more than {threshold} earthquakes of magnitude 1.0 or greater "
            f"worldwide between {_iso(t1)} and {_iso(t2)}?"
        ),
        "rules": (
            f"Resolves YES if the USGS event count for magnitude >= 1.0 with starttime {_isoz(t1)} "
            f"and endtime {_isoz(t2)} is strictly greater than {threshold} events. Resolves NO otherwise. "
            "The window is pinned at both ends, so the query is the same one on every later "
            "request. Note that the USGS catalogue is REVISED: events are sometimes added hours "
            "after the fact, so a count read later may exceed the count read at settlement. The "
            "count at settlement decides, and this rule says so rather than pretending the "
            "catalogue is frozen."
        ),
        "settlementPrompt": (
            "Source 0 is the USGS event count for the pinned window, already extracted by the "
            f"selector. Answer YES if it is strictly greater than {threshold} events, NO otherwise."
        ),
        "sources": [{"kind": "http", "url": url, "selector": "$.count"}],
        "context": [{"kind": "http", "url": f"{api}&starttime={_isoz(t1 - 3600)}&endtime={_isoz(t1)}", "selector": "$.count"}],
        "_subject": "seismic activity",
    }


def _live_sports(trading_end: int, settlement_deadline: int) -> dict:
    """The combined final score of one MLB game, against a threshold this function
    measures rather than picks.

    WHY BASEBALL. A short-horizon sports question needs three things at once: it
    must finish inside the settlement window, it must be BINARY with no draw, and
    its answer must be a NUMBER a resolver can compare. "Will team X win" fails the
    third — it needs a model to read a result, and a model is what settled a Galileo
    market wrong. A combined run total is an integer, so `decideByThreshold` settles
    it in code and 0G Compute is never called. MLB also has no draws and no
    penalty shoot-out, so extra innings lengthen the game without muddying it.

    THE THRESHOLD IS MEASURED. It comes from every completed game at that venue this
    season, taken as the median, so the question lands near a coin flip instead of
    near a formality. A market whose answer is already known is a market nobody
    learns anything from.

    Set LIVE_GAME_PK to pin a specific game; otherwise the earliest game today that
    still starts in the future is used, preferring a roofed venue because the one
    thing that can void this question is rain.
    """
    api = "https://statsapi.mlb.com/api/v1"
    day = time.strftime("%Y-%m-%d", time.gmtime(trading_end))
    pinned = os.environ.get("LIVE_GAME_PK")

    if pinned:
        sched = _http_json(f"{api}/schedule?sportId=1&gamePk={pinned}&hydrate=venue")
    else:
        sched = _http_json(f"{api}/schedule?sportId=1&date={day}&hydrate=venue")
    games = [g for d in sched.get("dates", []) for g in d.get("games", [])]
    # `codedGameState == "F"` is the ONLY safe gate. A gamePk can carry TWO records —
    # a postponement with `score: null` and the replay with the real one — so a
    # naive first-record read returns null for a game that was in fact played.
    playable = [g for g in games if g["status"]["codedGameState"] == "S"]
    if not playable:
        sys.exit(f"market-spec: no scheduled MLB game found for {day}. Set LIVE_GAME_PK, or pick another day.")

    def roofed(g):
        roof = (g.get("venue", {}).get("fieldInfo", {}) or {}).get("roofType", "")
        return 0 if roof in ("Dome", "Retractable") else 1

    game = sorted(playable, key=lambda g: (roofed(g), g["gameDate"]))[0]
    pk = game["gamePk"]
    away = game["teams"]["away"]["team"]["name"]
    home = game["teams"]["home"]["team"]["name"]
    venue = game["venue"]["name"]
    venue_id = game["venue"]["id"]
    first_pitch = int(time.mktime(time.strptime(game["gameDate"], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone)

    # A game runs about three hours. The committee cannot answer before it is Final,
    # so the deadline has to clear the finish AND the machinery behind it.
    if first_pitch >= settlement_deadline:
        sys.exit(
            f"market-spec: {away} @ {home} starts at {_isoz(first_pitch)}, at or after the "
            f"settlement deadline {_isoz(settlement_deadline)}. Nothing could settle it."
        )

    # The threshold, measured at this venue this season.
    season = time.strftime("%Y", time.gmtime(trading_end))
    hist = _http_json(
        f"{api}/schedule?sportId=1&venueIds={venue_id}&season={season}"
        f"&startDate={season}-03-01&endDate={day}&gameType=R"
    )
    totals = sorted(
        g["teams"]["away"]["score"] + g["teams"]["home"]["score"]
        for d in hist.get("dates", [])
        for g in d.get("games", [])
        if g["status"]["codedGameState"] == "F"
        and g["teams"]["away"].get("score") is not None
        and g["teams"]["home"].get("score") is not None
    )
    if len(totals) < 10:
        sys.exit(f"market-spec: only {len(totals)} completed games at {venue} this season — too few to set a fair threshold.")
    threshold = totals[len(totals) // 2]
    over = sum(1 for t in totals if t > threshold) / len(totals)

    line = f"{api}/game/{pk}/linescore"
    return {
        "resolvesBy": first_pitch + 4 * 3600,  # three hours of baseball, and an hour of not assuming
        "question": (
            f"Will the combined final score of {away} at {home} on {day} be more than {threshold} runs?"
        ),
        "rules": (
            f"Resolves YES if the sum of teams.away.runs and teams.home.runs for MLB game {pk}, read "
            f"once the game is Final, is strictly greater than {threshold} runs. Resolves NO if the sum "
            f"is {threshold} or fewer. Extra innings count toward the sum, and a game shortened by "
            "weather still counts once it is recorded Final. Deemed UNRESOLVABLE if the game has no "
            f"Final record by {_isoz(settlement_deadline)}, which covers a postponement or a suspension."
        ),
        "settlementPrompt": (
            f"Source 0 is the linescore for game {pk}. Add teams.away.runs to teams.home.runs and "
            f"compare the sum with {threshold}. Answer YES if strictly greater, NO otherwise. Before "
            "first pitch both objects are EMPTY rather than zero; an empty reading is not a score of "
            "nothing, and must not be settled as one."
        ),
        "sources": [{"kind": "http", "url": line, "selector": "$.teams.away.runs + $.teams.home.runs"}],
        "context": [
            {"kind": "http", "url": f"{api}/schedule?sportId=1&gamePk={pk}", "selector": "$.dates[0].games[0].status.codedGameState"},
        ],
        "_subject": f"a baseball score at {venue} (threshold {threshold}, {over:.0%} of {len(totals)} games this season went over)",
    }


def _live_culture(trading_end: int, settlement_deadline: int) -> dict:
    """Whether Hacker News reaches a given item id by a pinned second.

    Item ids are handed out in order and an item's `time` NEVER changes, so this is
    permanently checkable: fetch the item, read its timestamp, compare. An item that
    does not exist yet returns `null`, and the rule says what that means rather than
    leaving a resolver to guess.

    The target id is set from the site's measured posting rate over the preceding
    ~600 items, so it sits near the boundary instead of far on one side of it.
    """
    deadline = trading_end - 120
    if deadline + 60 > settlement_deadline:
        sys.exit("market-spec: 'culture' needs a longer settlement window")
    api = "https://hacker-news.firebaseio.com/v0/"
    top = int(_http_json(f"{api}maxitem.json"))
    now_t = int(_http_json(f"{api}item/{top}.json")["time"])
    old_t = int(_http_json(f"{api}item/{top - 600}.json")["time"])
    per_second = 600 / max(1, now_t - old_t)
    target = top + max(1, int(per_second * (deadline - now_t)))
    when = _dt.datetime.fromtimestamp(deadline, _dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return {
        "resolvesBy": deadline + 60,
        "question": f"Will Hacker News item #{target} have been posted before {when}?",
        "rules": (
            f"Resolves YES if https://hacker-news.firebaseio.com/v0/item/{target}.json returns an "
            f"item whose `time` is less than or equal to {deadline} (unix seconds). Resolves NO if "
            "the endpoint returns null — the id has not been reached — or if the item's `time` is "
            "greater than that. Item ids are issued in order and an item's timestamp never "
            "changes, so this answer is the same for anyone who checks it later. Deemed "
            "UNRESOLVABLE only if the endpoint cannot be reached at all."
        ),
        "settlementPrompt": (
            f"Source 0 is the `time` field of Hacker News item {target}, or null if no such item "
            f"exists yet. Answer YES if it is a number less than or equal to {deadline}. Answer NO "
            "if it is null or greater. Do not substitute a neighbouring item id."
        ),
        "sources": [{"kind": "http", "url": f"{api}item/{target}.json", "selector": "$.time"}],
        "context": [{"kind": "http", "url": f"{api}maxitem.json", "selector": "$"}],
        "_subject": "how fast a community is posting",
    }


LIVE = {
    "crypto": _live_crypto,
    "economics": _live_economics,
    "science": _live_science,
    "culture": _live_culture,
    "sports": _live_sports,
}


trading_end, settlement_deadline, tier, agent_id = (int(a) for a in sys.argv[1:5])
category = sys.argv[5] if len(sys.argv) > 5 else "crypto"
_live_of = category[5:] if category.startswith("live-") else None
if _live_of is not None and _live_of not in LIVE:
    sys.exit(f"market-spec: no short-horizon question for {_live_of!r}. Have: {', '.join(LIVE)}")
if _live_of is None and category != "live" and category not in SPECS:
    sys.exit(f"market-spec: unknown category {category!r}. Known: live, live-<{'|'.join(LIVE)}>, {', '.join(SPECS)}")

if _live_of is not None:
    spec = LIVE[_live_of](trading_end, settlement_deadline)
elif category == "live":
    spec = _live_spec(trading_end, settlement_deadline)
else:
    spec = SPECS[category]

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
on_chain_category = _live_of if _live_of is not None else ("crypto" if category in ("selftest", "live") else category)

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
