#!/usr/bin/env bash
# One committee pass, wrapped so a scheduler can call it.
#
# Nothing in this protocol votes on its own. A committee is sampled the moment a
# market is drawn, its commit window runs for an hour and its reveal window for
# another, and every one of those steps needs somebody to send a transaction —
# and until this ran on a timer, nobody did. Market 0xCDc13Cc2… on 16661 went
# Open → Closed → Failed with commits=0 and reveals=0: three resolvers were
# seated, none of them ever heard about it, and the holders exited at their own
# price on a question the chain could have answered.
#
# WHY NOT scripts/committee-run.mjs UNDER A TIMER. It blocks in sleep() until the
# commit deadline and again until the dispute deadline — three hours for a
# DETERMINISTIC market and about seven for a VERIFIED one. Killed at any
# TimeoutStartSec a scheduler can honestly set, it leaves commits on chain with
# no reveals against them, which is the one outcome that actually costs stake.
# examples/committee-tick.ts is a pass instead: at most one phase per market,
# then it exits and says when to come back.
#
# THE KEY IS THE SEED THE SEATS WERE DERIVED FROM, not a wallet of the pass's own,
# and that is the one way this differs from the keeper. A committee member's
# operator key is DERIVED (`keccak256(abi.encode(key, "brier-resolver", i))`), so
# an unrelated unattended key could not sign for any seat.
#
# COMMITTEE_KEY IS NOT DEFAULTED TO DEPLOYER_KEY. On this deployment the deployer
# is still `owner()` of all four UUPS proxies and can upgrade any of them with no
# timelock, so falling back to it would arm a timer that holds unilateral upgrade
# authority over every contract — to do a job that only signs commitVote and
# revealVote. Where the seats really were derived from the deployer secret, naming
# the variable differently buys nothing: the fix is to re-derive the committee
# from a dedicated seed, which is a re-registration and an operator's call.
# Give this its own machine and its own file, chmod 600, and read
# scripts/setup-committee.sh before deciding it is acceptable.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .env.mainnet wins over .env, as in every other script here — and it matters
# more here than anywhere. A committee pointed at Galileo while a mainnet market
# runs its commit window looks exactly like a committee with nothing to do.
ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env"
  [[ -f "$ROOT/.env.mainnet" ]] && ENV_FILE="$ROOT/.env.mainnet"
fi
if [[ -f "$ENV_FILE" ]]; then
  # Full shell semantics, which is why this wrapper exists rather than pointing
  # systemd's EnvironmentFile at a file that may hold quoting it cannot parse.
  # Anything already exported wins, so systemd or a shell can override the file.
  _pre="$(export -p)"; set -a; . "$ENV_FILE"; set +a; eval "$_pre" 2>/dev/null || true
fi

: "${COMMITTEE_KEY:?set COMMITTEE_KEY — the operator keys are derived from it. It is NOT
  defaulted to DEPLOYER_KEY: that key owns every proxy here, and this runs unattended}"
export COMMITTEE_KEY

# Derived from the RPC rather than defaulted, so the chain id and the endpoint can
# never disagree. A committee acting on one chain while addressed to another is
# the worst shape this script can take: it finds no markets and reports a clean
# pass, which is indistinguishable from a committee that is up to date.
export RPC_URL="${RPC_URL:-${ZERO_G_RPC:-${ZERO_G_MAINNET_RPC:-${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}}}}"
DERIVED_CHAIN="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "")"
export CHAIN_ID="${CHAIN_ID:-$DERIVED_CHAIN}"
[[ -n "$CHAIN_ID" ]] || { echo "✗ could not read a chain id from $RPC_URL" >&2; exit 1; }
if [[ -n "$DERIVED_CHAIN" && "$CHAIN_ID" != "$DERIVED_CHAIN" ]]; then
  echo "✗ CHAIN_ID is $CHAIN_ID but $RPC_URL reports $DERIVED_CHAIN." >&2
  echo "  A committee voting on one chain while addressed to another is worse than one that is down." >&2
  exit 1
fi
case "$CHAIN_ID" in
  16661) echo "▶ committee on 0G MAINNET (16661) via $RPC_URL   env $(basename "$ENV_FILE")" ;;
  16602) echo "▶ committee on Galileo testnet (16602) via $RPC_URL   env $(basename "$ENV_FILE")" ;;
  *)     echo "▶ committee on chain $CHAIN_ID via $RPC_URL   env $(basename "$ENV_FILE")" ;;
esac

# Fail loudly on the wrong Node. The 0G compute SDK, which this pass uses for
# every judgement, throws "does not provide an export named 'C'" on some 22.x
# builds — an error that names neither the SDK nor the version. Better to say
# which node ran than to have a committee that silently never votes.
node_major_minor="$(node -p 'process.versions.node.split(".").slice(0,2).join(".")')"
case "$node_major_minor" in
  22.5|22.6|22.7|22.8|22.9|20.*|18.*)
    echo "committee: node $(node -v) at $(command -v node) cannot load the 0G compute SDK." >&2
    echo "           Use 22.20 or later — check PATH in the systemd unit if this is a timer run." >&2
    exit 1 ;;
esac

cd "$ROOT/packages/agent-kit"

# Run it, keeping the output so the last line can be acted on, then print it.
# Not piped through `tee /dev/stderr`: that works in a terminal and fails under
# systemd with "No such device or address", which takes the whole pass with it.
out="$(npx --no-install tsx examples/committee-tick.ts 2>&1)"
printf '%s\n' "$out"

# ── schedule the next wake ──────────────────────────────────────────────────
# Every deadline in this protocol is on chain and known in advance, so polling is
# work nobody asked for. The pass prints when the clock next makes something due;
# this turns that into a single one-shot timer and then stops.
#
# AFTER the instant, never on it. `revealVote` demands `block.timestamp >
# commitDeadline` and `finalize` demands `> disputeDeadline`; both revert on
# equality. The pass already adds the one second those `>` require, and LEAD adds
# slack on top for block time and clock skew, so it is a lag rather than a lead.
LEAD=10

# The ceiling is anchored on the window this pass must land inside rather than
# picked: COMMIT_WINDOW is 3600 s on the live ConfigRegistry, and a quarter of it
# means at least four passes fall inside any commit window — so three consecutive
# failures still leave one vote. The keeper can afford an hour here because a late
# close() costs time; a late commit costs the resolver's stake.
CEILING=900
FLOOR=30

next_due="$(printf '%s\n' "$out" | sed -n 's/^next-due \([0-9]*\)$/\1/p' | tail -1)"
now="$(date +%s)"

if [[ -z "$next_due" ]]; then
  # Either nothing is pending, or the pass failed before printing. Both want the
  # same thing — come back at the ceiling — but only one is worth saying.
  printf '%s\n' "$out" | grep -q '^next-due none$' \
    && delay="$CEILING" \
    || { echo "committee: no next-due line — treating as a failed pass" >&2; delay="$CEILING"; }
else
  delay=$(( next_due + LEAD - now ))
  (( delay < FLOOR )) && delay=$FLOOR
  (( delay > CEILING )) && delay=$CEILING
fi

if command -v systemd-run >/dev/null && [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
  # The pending wake is stopped first. `systemd-run --unit=` does NOT replace an
  # existing unit — it refuses, quietly, and the stale wake survives. On the
  # keeper that cost a five-minute market fifty-five minutes of being unclosed;
  # here the same silence would cost a resolver its stake, because a commit whose
  # reveal wake never fired is slashed exactly like a resolver that never showed.
  systemctl --user stop brier-committee-next.timer brier-committee-next.service 2>/dev/null || true
  systemd-run --user --quiet --unit=brier-committee-next \
    --on-active="${delay}s" --timer-property=AccuracySec=5s \
    --description="Brier committee — next scheduled wake" \
    systemctl --user start brier-committee.service 2>/dev/null \
    && echo "committee: next wake in ${delay}s" \
    || echo "committee: could not schedule the next wake — the fallback timer still covers it" >&2
fi
