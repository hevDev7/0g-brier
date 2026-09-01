#!/usr/bin/env bash
# One keeper pass, wrapped so a scheduler can call it.
#
# Nothing in this protocol advances on its own. `close()` becomes callable the
# second `tradingEnd` passes and `fail()` the second `settlementDeadline` does,
# but both still need somebody to send a transaction — and until this ran on a
# timer, nobody did. A market sat four hours past its window reading "Open"
# while every buy, sell and exit reverted.
#
# WHAT THIS DOES NOT DO. It never decides an outcome. `fail()` is not a verdict:
# it is the deadline being enforced, after which every side exits at its own
# price. Settling a market YES or NO is the resolution committee's job and needs
# staked resolvers and evidence — see scripts/committee-run.mjs.
#
# The key is KEEPER_KEY, deliberately its own wallet. The keeper signs
# unattended, and it only ever needs gas — it never touches collateral — so a
# leaked keeper key costs the price of a few transactions and nothing else.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .env.mainnet wins over .env, as in every other script here. This was the one
# mainnet-relevant script that did not, and combined with the 16602 defaults below
# it meant a keeper started for the mainnet deployment would have polled Galileo
# forever while the first mainnet market ran past its settlement deadline and
# failed — with no error, because a keeper with nothing to do looks exactly like a
# keeper that is up to date.
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

: "${KEEPER_KEY:?set KEEPER_KEY in the env file — the keeper signs with its own wallet}"
# Derived from the RPC rather than defaulted, so the chain id and the endpoint can
# never disagree. A keeper pointed at one chain while believing another is the
# worst shape this script can take.
export RPC_URL="${RPC_URL:-${ZERO_G_RPC:-${ZERO_G_MAINNET_RPC:-${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}}}}"
DERIVED_CHAIN="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "")"
export CHAIN_ID="${CHAIN_ID:-$DERIVED_CHAIN}"
[[ -n "$CHAIN_ID" ]] || { echo "✗ could not read a chain id from $RPC_URL" >&2; exit 1; }
if [[ -n "$DERIVED_CHAIN" && "$CHAIN_ID" != "$DERIVED_CHAIN" ]]; then
  echo "✗ CHAIN_ID is $CHAIN_ID but $RPC_URL reports $DERIVED_CHAIN." >&2
  echo "  A keeper acting on one chain while addressed to another is worse than one that is down." >&2
  exit 1
fi
case "$CHAIN_ID" in
  16661) echo "▶ keeper on 0G MAINNET (16661) via $RPC_URL   env $(basename "$ENV_FILE")" ;;
  16602) echo "▶ keeper on Galileo testnet (16602) via $RPC_URL   env $(basename "$ENV_FILE")" ;;
  *)     echo "▶ keeper on chain $CHAIN_ID via $RPC_URL   env $(basename "$ENV_FILE")" ;;
esac

# Fail loudly on the wrong Node. The 0G compute SDK, which agent-kit pulls in,
# throws "does not provide an export named 'C'" on some 22.x builds — an error
# that names neither the SDK nor the version. Better to say which node ran.
node_major_minor="$(node -p 'process.versions.node.split(".").slice(0,2).join(".")')"
case "$node_major_minor" in
  22.5|22.6|22.7|22.8|22.9|20.*|18.*)
    echo "keeper: node $(node -v) at $(command -v node) cannot load the 0G compute SDK." >&2
    echo "        Use 22.20 or later — check PATH in the systemd unit if this is a timer run." >&2
    exit 1 ;;
esac

cd "$ROOT/packages/agent-kit"

# Run it, keeping the output so the last line can be acted on, then print it.
# Not piped through `tee /dev/stderr`: that works in a terminal and fails under
# systemd with "No such device or address", which takes the whole pass with it.
out="$(npx --no-install tsx examples/keeper.ts 2>&1)"
printf '%s\n' "$out"

# ── schedule the next wake ──────────────────────────────────────────────────
# Every deadline in this protocol is on chain and known in advance, so polling
# is work nobody asked for. The keeper prints when the clock next makes
# something due; this turns that into a single one-shot timer and then stops.
#
# AFTER the deadline, not before. `close()` reverts with `TradingNotEnded` and
# `fail()` with `SettlementNotDue` when they are early, so waking a few minutes
# ahead would only buy a guaranteed revert. LEAD is therefore a lag.
LEAD=10

# The ceiling is a judgement call, not a derived number: this deployment sets no
# MIN_TRADING_WINDOW, so a market can be created with a one-minute window and
# nothing in the protocol bounds how soon a new deadline can appear. An hour
# means a market created while the keeper sleeps is picked up within the hour.
# Lower it if markets here are routinely shorter-lived than that.
CEILING=3600
FLOOR=30

next_due="$(printf '%s\n' "$out" | sed -n 's/^next-due \([0-9]*\)$/\1/p' | tail -1)"
now="$(date +%s)"

if [[ -z "$next_due" ]]; then
  # Either nothing is pending, or the keeper failed before printing. Both want
  # the same thing — come back at the ceiling — but only one is worth saying.
  printf '%s\n' "$out" | grep -q '^next-due none$' \
    && delay="$CEILING" \
    || { echo "keeper: no next-due line — treating as a failed pass" >&2; delay="$CEILING"; }
else
  delay=$(( next_due + LEAD - now ))
  (( delay < FLOOR )) && delay=$FLOOR
  (( delay > CEILING )) && delay=$CEILING
fi

if command -v systemd-run >/dev/null && [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
  # The pending wake is stopped first. `systemd-run --unit=` does NOT replace an
  # existing unit — it refuses, quietly, and the stale wake survives. That is
  # not theoretical: a five-minute market created while an hour-long sleep was
  # pending computed a correct four-minute wake, failed to arm it, and would
  # have sat unclosed for fifty-five minutes past its deadline.
  systemctl --user stop brier-keeper-next.timer brier-keeper-next.service 2>/dev/null || true
  systemd-run --user --quiet --unit=brier-keeper-next \
    --on-active="${delay}s" --timer-property=AccuracySec=5s \
    --description="Brier keeper — next scheduled wake" \
    systemctl --user start brier-keeper.service 2>/dev/null \
    && echo "keeper: next wake in ${delay}s" \
    || echo "keeper: could not schedule the next wake — the fallback timer still covers it" >&2
fi
