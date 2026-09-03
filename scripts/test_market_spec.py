#!/usr/bin/env python3
"""The one piece of judgement in scripts/market-spec.py: whether a question can
still be COMMITTED and REVEALED before its market's settlement deadline.

    python3 -m unittest discover -s scripts -p 'test_*.py' -v

There is no other python test in this repo, so this file is the place it starts.
It is stdlib-only and entirely OFFLINE by construction: every case here either
calls the check directly or drives the CLI with `crypto` or `selftest`, whose
specs are literals in the file. Every `live-*` category fetches a price, a
schedule or an event count, and a test that reaches the network fails for
reasons that have nothing to do with the code under it.

What is pinned here is a market that DIED on 0G mainnet:
0xCDc13Cc2830240518ce76a0a6ecbA51a4DBA8c35 went Open → Closed → Failed with
commits=0. Its spec passes this check and should — the defect that killed it was
elsewhere — and half of these tests exist to stop that fact being "corrected".
"""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().with_name("market-spec.py")

# 0G mainnet 16661, ConfigRegistry 0x3289fcb307714774ac45de9606af6f95d2b2b4dd. The
# same numbers the script defaults to, restated here rather than imported: a test
# that reads its expectation out of the code under test proves only that the code
# agrees with itself.
COMMIT_WINDOW = 3600
REVEAL_WINDOW = 3600

# The two markets that exist on mainnet, exactly as the chain holds them.
MARKET_1 = {"resolvesBy": 1788316800, "settlementDeadline": 1788331216}  # the baseball market that failed
MARKET_0 = {"resolvesBy": 1790812799, "settlementDeadline": 1791417612}  # `crypto`, and still open


def _load_market_spec():
    """Import market-spec.py, which is a CLI and therefore RUNS on import.

    There is no `__main__` guard to hide behind, so the import is handed a valid
    invocation instead — `selftest`, whose spec is a literal — and its JSON is
    swallowed rather than printed into the test output. The hyphen in the file
    name is why this is importlib and not an `import` statement.
    """
    loader = importlib.util.spec_from_file_location("market_spec", SCRIPT)
    module = importlib.util.module_from_spec(loader)
    argv = [str(SCRIPT), "1788302416", "1788331216", "1", "0", "selftest"]
    with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()):
        loader.loader.exec_module(module)
    return module


@contextlib.contextmanager
def _windows(commit=None, reveal=None):
    """The windows this case means, and no others.

    Cleared rather than merely overridden: a developer who has COMMIT_WINDOW=300
    exported to run committee-run.mjs would otherwise see the default-value cases
    pass or fail for a reason that is nowhere in this file.
    """
    env = {k: v for k, v in os.environ.items() if k not in ("COMMIT_WINDOW", "REVEAL_WINDOW")}
    if commit is not None:
        env["COMMIT_WINDOW"] = str(commit)
    if reveal is not None:
        env["REVEAL_WINDOW"] = str(reveal)
    with mock.patch.dict(os.environ, env, clear=True):
        yield


class TheRoundMustFitAfterTheEvent(unittest.TestCase):
    """`resolvesBy + COMMIT_WINDOW + REVEAL_WINDOW <= settlementDeadline`."""

    @classmethod
    def setUpClass(cls):
        cls.spec = _load_market_spec()

    def refuse(self, resolves_by, settlement_deadline, category="crypto"):
        """The message, if the check refuses. Fails the test if it does not."""
        with self.assertRaises(SystemExit) as raised:
            self.spec._refuse_if_unsettlable(category, resolves_by, settlement_deadline)
        return str(raised.exception)

    def test_mainnet_market_1_passes_with_7216_seconds_to_spare(self):
        # THE CALIBRATION CASE. This market failed with zero commits, and it is
        # still the wrong thing to reject: the game it asked about was decidable
        # a full commit-reveal round before its deadline. What burned it was the
        # keeper drawing the committee 117s after tradingEnd. A check tuned until
        # this line goes red would hide that.
        with _windows():
            self.spec._refuse_if_unsettlable("live-sports", MARKET_1["resolvesBy"], MARKET_1["settlementDeadline"])
        slack = MARKET_1["settlementDeadline"] - (MARKET_1["resolvesBy"] + COMMIT_WINDOW + REVEAL_WINDOW)
        self.assertEqual(slack, 7216)

    def test_mainnet_market_0_passes(self):
        # Closes 2026-10-01 and is the next one to run this gauntlet.
        with _windows():
            self.spec._refuse_if_unsettlable("crypto", MARKET_0["resolvesBy"], MARKET_0["settlementDeadline"])
        slack = MARKET_0["settlementDeadline"] - (MARKET_0["resolvesBy"] + COMMIT_WINDOW + REVEAL_WINDOW)
        self.assertEqual(slack, 597613)

    def test_the_exact_boundary_passes(self):
        # A round that ends ON the deadline is a round that fits. The boundary is
        # derived from the windows, not chosen: settlementDeadline is exactly
        # resolvesBy + COMMIT_WINDOW + REVEAL_WINDOW.
        resolves_by = MARKET_1["resolvesBy"]
        with _windows():
            self.spec._refuse_if_unsettlable("crypto", resolves_by, resolves_by + COMMIT_WINDOW + REVEAL_WINDOW)

    def test_one_second_too_late_is_refused_and_the_shortfall_is_named(self):
        # One second past the boundary, which is the case the old arithmetic
        # (`resolvesBy > settlementDeadline`) waved through: the question resolves
        # 7,199s before the deadline, and the committee needs 7,200.
        settlement_deadline = MARKET_1["settlementDeadline"]
        resolves_by = settlement_deadline - COMMIT_WINDOW - REVEAL_WINDOW + 1
        with _windows():
            message = self.refuse(resolves_by, settlement_deadline)
        self.assertIn("that is 1 second short", message)         # the shortfall, not rounded away to "0.0 hours"
        self.assertIn(str(resolves_by), message)                 # the question's own instant
        self.assertIn(str(settlement_deadline), message)         # the deadline it misses
        self.assertIn(str(resolves_by + COMMIT_WINDOW + REVEAL_WINDOW), message)  # the deadline that would work
        self.assertIn(self.spec._iso(resolves_by), message)      # and all three in a form a person can read
        self.assertIn(self.spec._iso(settlement_deadline), message)
        self.assertIn("COMMIT_WINDOW", message)                  # the remedy if this chain's windows differ

    def test_resolving_before_the_deadline_is_not_enough(self):
        # The regression this fix is for, stated plainly: a question decidable an
        # hour before the deadline satisfies the OLD check and is still
        # unvotable, because a commit and a reveal need two.
        settlement_deadline = MARKET_1["settlementDeadline"]
        resolves_by = settlement_deadline - 3600
        self.assertLess(resolves_by, settlement_deadline)
        with _windows():
            self.assertIn("that is 3,600 seconds (1.0 hours) short", self.refuse(resolves_by, settlement_deadline))

    def test_resolves_by_zero_always_passes(self):
        # 0 means "answerable from the market's own state the moment it closes"
        # (`selftest`), so there is no event to wait for and nothing to add to.
        with _windows():
            self.spec._refuse_if_unsettlable("selftest", 0, MARKET_1["settlementDeadline"])

    def test_the_deployed_windows_decide_the_verdict(self):
        # The windows are ConfigRegistry parameters, so a chain that has moved
        # them moves this boundary with them — in both directions. Same spec,
        # three answers.
        resolves_by = MARKET_1["resolvesBy"]
        settlement_deadline = resolves_by + COMMIT_WINDOW + REVEAL_WINDOW  # fits exactly at mainnet's 3600s
        with _windows():
            self.spec._refuse_if_unsettlable("crypto", resolves_by, settlement_deadline)
        with _windows(commit=7200):
            self.assertIn("(7200s)", self.refuse(resolves_by, settlement_deadline))
        with _windows(reveal=7200):
            self.assertIn("(7200s)", self.refuse(resolves_by, settlement_deadline))
        # committee-run.mjs shortens both to run a demo in minutes; against those
        # a window this check would otherwise refuse is genuinely settlable.
        with _windows(commit=300, reveal=120):
            self.spec._refuse_if_unsettlable("crypto", resolves_by, resolves_by + 420)


class TheCliRefusesTheSpecItself(unittest.TestCase):
    """The check is wired into the document, not merely defined beside it.

    Offline: `crypto` is a literal in SPECS, and its resolvesBy is the one mainnet
    market 0 was created with.
    """

    def run_spec(self, settlement_deadline, category="crypto", **env):
        trading_end = settlement_deadline - 14400  # MIN_SETTLEMENT_WINDOW on mainnet
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(trading_end), str(settlement_deadline), "1", "0", category],
            capture_output=True, text=True,
            env={**{k: v for k, v in os.environ.items() if k not in ("COMMIT_WINDOW", "REVEAL_WINDOW")}, **env},
        )

    def test_market_0s_own_numbers_still_produce_a_document(self):
        done = self.run_spec(MARKET_0["settlementDeadline"])
        self.assertEqual(done.returncode, 0, done.stderr)
        doc = json.loads(done.stdout)
        self.assertEqual(doc["resolvesBy"], MARKET_0["resolvesBy"])
        self.assertEqual(doc["settlementDeadline"], MARKET_0["settlementDeadline"])

    def test_a_window_too_short_for_a_round_is_refused_before_anything_is_printed(self):
        # One second short of a full round after the event. Nothing on stdout:
        # a caller pipes this into upload-doc.mjs, so a half-written document
        # would be uploaded and made a specRoot forever.
        done = self.run_spec(MARKET_0["resolvesBy"] + COMMIT_WINDOW + REVEAL_WINDOW - 1)
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual(done.stdout, "")
        self.assertIn("cannot be settled in this window", done.stderr)
        self.assertIn("that is 1 second short", done.stderr)

    def test_the_windows_reach_the_cli_from_the_environment(self):
        # The same deadline, refused or accepted according to the chain's own
        # parameters rather than a constant baked into this script.
        deadline = MARKET_0["resolvesBy"] + 420
        self.assertNotEqual(self.run_spec(deadline).returncode, 0)
        done = self.run_spec(deadline, COMMIT_WINDOW="300", REVEAL_WINDOW="120")
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_selftest_needs_no_room_after_its_event(self):
        done = self.run_spec(MARKET_0["settlementDeadline"], category="selftest")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["resolvesBy"], 0)


if __name__ == "__main__":
    unittest.main()
