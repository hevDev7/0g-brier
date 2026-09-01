#!/usr/bin/env bash
# Complete the ownership handover: governance takes the four upgradeable contracts
# from the deployer, through the timelock.
#
#   schedule the four calls          bash scripts/handover.sh schedule
#   …wait out the timelock delay…
#   then carry them out              bash scripts/handover.sh execute
#   check where things stand         bash scripts/handover.sh status
#
# Signed by GOVERNANCE, not by the deployer — that is the whole point. Set
# GOVERNANCE_KEY for a hot key, or use --unsigned to print the calldata for a
# multisig to submit however it normally does.
#
# Until `execute` lands, the DEPLOYER still owns everything. `transferOwnership`
# is two-step on purpose: a one-step transfer to a wrong address is unrecoverable
# on exactly the contracts you least want to lose.
set -euo pipefail
# Tracing off, and not negotiable. `cast` has no environment variable for a
# signing key — `--private-key` on the command line is the only way — so any
# shell tracing this script inherits expands that argument in full. Running it
# as `bash -x` to debug a failing transaction is exactly when somebody reaches
# for tracing, and it is exactly when the key would be printed. It happened on
# 2026-08-30: a `bash -x` of this file put a deployer key that owned every
# protocol proxy into a session transcript.
{ set +x; } 2>/dev/null
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-status}"

# .env.mainnet wins over .env, as everywhere else, so that running this against a
# mainnet deployment does not silently read the testnet's endpoint.
ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env"
  [[ -f "$ROOT/.env.mainnet" ]] && ENV_FILE="$ROOT/.env.mainnet"
fi
if [[ -f "$ENV_FILE" ]]; then
  _pre="$(export -p)"; set -a; . "$ENV_FILE"; set +a; eval "$_pre" 2>/dev/null || true
fi
RPC="${ZERO_G_RPC:-${ZERO_G_MAINNET_RPC:-${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}}}"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
M="$ROOT/deployments/$CHAIN.json"

# SAY WHICH CHAIN. This script is what closes the cliff, and it used to default to
# the testnet endpoint and print a timelock address with no chain beside it. Run
# against a fresh mainnet deployment on 2026-09-01 it reported Galileo's timelock and
# Galileo's four pending contracts — an answer that looks exactly like the right one
# and is about a different network.
CHAIN_NAME="chain $CHAIN"
case "$CHAIN" in
  16661) CHAIN_NAME="0G MAINNET (16661)" ;;
  16602) CHAIN_NAME="Galileo testnet (16602)" ;;
  31337) CHAIN_NAME="local anvil (31337)" ;;
esac
echo "▶ $CHAIN_NAME via $RPC"
echo "▶ manifest $(basename "$M")   env $(basename "$ENV_FILE")"
echo ""
J(){ python3 -c "import json;print(json.load(open('$M'))['contracts'].get('$1',''))"; }
TIMELOCK="$(J Timelock)"
[[ -n "$TIMELOCK" && "$TIMELOCK" != "0x0000000000000000000000000000000000000000" ]] \
  || { echo "✗ no timelock in $M — this deployment has none to hand over to" >&2; exit 1; }

CONTRACTS=(ConfigRegistry MarketFactory AgentRegistry ResolutionModule)
DATA="$(cast calldata 'acceptOwnership()')"
# One predecessor and salt for all four: they are independent of each other, and a
# distinct salt per call would only make the multisig's job longer.
SALT=0x0000000000000000000000000000000000000000000000000000000000000000
DELAY="$(cast call --rpc-url "$RPC" "$TIMELOCK" 'getMinDelay()(uint256)' | cut -d' ' -f1)"

if [[ "$ACTION" == "status" ]]; then
  echo "timelock $TIMELOCK   delay ${DELAY}s ($(python3 -c "print(f'{$DELAY/3600:.0f}')")h)"
  for n in "${CONTRACTS[@]}"; do
    A="$(J "$n")"; [[ -z "$A" ]] && continue
    O=$(cast call --rpc-url "$RPC" "$A" 'owner()(address)' | cut -d' ' -f1)
    P=$(cast call --rpc-url "$RPC" "$A" 'pendingOwner()(address)' | cut -d' ' -f1)
    ID=$(cast call --rpc-url "$RPC" "$TIMELOCK" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$A" 0 "$DATA" "$SALT" "$SALT" | cut -d' ' -f1)
    READY=$(cast call --rpc-url "$RPC" "$TIMELOCK" 'isOperationReady(bytes32)(bool)' "$ID" | cut -d' ' -f1)
    DONE=$(cast call --rpc-url "$RPC" "$TIMELOCK" 'isOperationDone(bytes32)(bool)' "$ID" | cut -d' ' -f1)
    if [[ "${O,,}" == "${TIMELOCK,,}" ]]; then printf "  %-18s owned by the timelock\n" "$n"
    elif [[ "$DONE" == "true" ]]; then printf "  %-18s executed, but owner is still %s\n" "$n" "$O"
    elif [[ "$READY" == "true" ]]; then printf "  %-18s SCHEDULED and ready to execute\n" "$n"
    elif [[ "${P,,}" == "${TIMELOCK,,}" ]]; then printf "  %-18s pending — not scheduled yet\n" "$n"
    else printf "  %-18s owner %s, pending %s\n" "$n" "$O" "$P"; fi
  done
  exit 0
fi

for n in "${CONTRACTS[@]}"; do
  A="$(J "$n")"; [[ -z "$A" ]] && continue
  if [[ "$ACTION" == "schedule" ]]; then
    ARGS=('schedule(address,uint256,bytes,bytes32,bytes32,uint256)' "$A" 0 "$DATA" "$SALT" "$SALT" "$DELAY")
  else
    ARGS=('execute(address,uint256,bytes,bytes32,bytes32)' "$A" 0 "$DATA" "$SALT" "$SALT")
  fi
  if [[ "${2:-}" == "--unsigned" || -z "${GOVERNANCE_KEY:-}" ]]; then
    echo "$n:"
    echo "  to   $TIMELOCK"
    echo "  data $(cast calldata "${ARGS[@]}")"
  else
    H=$(cast send --rpc-url "$RPC" --private-key "$GOVERNANCE_KEY" "$TIMELOCK" "${ARGS[@]}" --async)
    echo "  $ACTION $n → $H"
  fi
done
[[ "$ACTION" == "schedule" ]] && echo && echo "Wait ${DELAY}s, then: bash scripts/handover.sh execute"
exit 0
