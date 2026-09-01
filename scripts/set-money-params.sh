#!/usr/bin/env bash
# Bring a DEPLOYED registry's money parameters into line with the env file.
#
#   bash scripts/set-money-params.sh              # show what would change
#   bash scripts/set-money-params.sh --apply      # send it
#
# The deploy already applies these (Deploy.s.sol::_applyMoneyOverrides). This is for
# the window AFTER a deploy and BEFORE the cliff closes, when the deployer still owns
# the registry and the numbers turn out to be wrong for the balance actually on hand.
# Once governance owns the registry this script cannot help: the calls go through the
# timelock, which is handover.sh's job.
#
# Run it BEFORE setup-committee.sh. That script reads MIN_RESOLVER_STAKE to decide
# what to stake, so changing the parameter afterwards leaves a roster staked at the
# old number.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLY=""; [[ "${1:-}" == "--apply" ]] && APPLY=1

ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env"
  [[ -f "$ROOT/.env.mainnet" ]] && ENV_FILE="$ROOT/.env.mainnet"
fi
[[ -f "$ENV_FILE" ]] || { echo "✗ no env file at $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

die(){ echo "✗ $*" >&2; exit 1; }
[[ -n "${DEPLOYER_KEY:-}" ]] || die "DEPLOYER_KEY is not set."
[[ "$DEPLOYER_KEY" =~ ^[0-9a-fA-F]{64}$ ]] && DEPLOYER_KEY="0x$DEPLOYER_KEY"

RPC="${ZERO_G_MAINNET_RPC:-${ZERO_G_RPC:-https://evmrpc.0g.ai}}"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
MANIFEST="$ROOT/deployments/$CHAIN.json"
[[ -f "$MANIFEST" ]] || die "no manifest at $MANIFEST — nothing is deployed on chain $CHAIN."
J(){ python3 -c "import json;print(json.load(open('$MANIFEST'))['contracts']['$1'])"; }
CONFIG="$(J ConfigRegistry)"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"

OWNER="$(cast call "$CONFIG" 'owner()(address)' --rpc-url "$RPC" | awk '{print $1}')"
[[ "${OWNER,,}" == "${DEPLOYER,,}" ]] \
  || die "the registry is owned by $OWNER, not the deployer $DEPLOYER.
  If the cliff has closed, these are governance calls now: use handover.sh's timelock
  path rather than this script."

TOKEN="$(cast call "$CONFIG" 'addresses(bytes32)(address)' "$(cast keccak STAKE_TOKEN)" --rpc-url "$RPC" | awk '{print $1}')"
DEC="$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC" | awk '{print $1}')"
SYM="$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC" 2>/dev/null | tr -d '"' || echo '?')"
# python3, never $(( )): these are wei on an 18-decimal token and bash tops out at 9.22e18.
H(){ python3 -c "print(f'{$1/10**$DEC:,.6f}'.rstrip('0').rstrip('.') or '0')"; }

echo "chain $CHAIN   registry $CONFIG   stake token $SYM ($DEC decimals)"
echo "owner $OWNER"
echo ""

CHANGES=0
CALLS=()
for NAME in MIN_RESOLVER_STAKE DISPUTE_BOND MIN_SEED MIN_SETTLEMENT_DEPOSIT MIN_TRADE_TOKENS; do
  WANT="${!NAME:-}"
  [[ -z "$WANT" || "$WANT" == "0" ]] && { printf "  %-24s (not set in env — left alone)\n" "$NAME"; continue; }
  [[ "$WANT" =~ ^[0-9]+$ ]] || die "$NAME must be a whole number in ${SYM}'s base units, not '$WANT'."
  HAVE="$(cast call "$CONFIG" 'params(bytes32)(uint256)' "$(cast keccak "$NAME")" --rpc-url "$RPC" | awk '{print $1}')"
  if [[ "$HAVE" == "$WANT" ]]; then
    printf "  %-24s %s %s  (already)\n" "$NAME" "$(H "$HAVE")" "$SYM"
  else
    printf "  %-24s %s -> %s %s\n" "$NAME" "$(H "$HAVE")" "$(H "$WANT")" "$SYM"
    CALLS+=("$NAME=$WANT"); CHANGES=$((CHANGES + 1))
  fi
done

# The same guard the deploy enforces. A minimum trade at or above the seed forbids
# every trade smaller than the entire book.
FINAL_SEED="${MIN_SEED:-}"; [[ -z "$FINAL_SEED" || "$FINAL_SEED" == 0 ]] && FINAL_SEED="$(cast call "$CONFIG" 'params(bytes32)(uint256)' "$(cast keccak MIN_SEED)" --rpc-url "$RPC" | awk '{print $1}')"
FINAL_TRADE="${MIN_TRADE_TOKENS:-}"; [[ -z "$FINAL_TRADE" || "$FINAL_TRADE" == 0 ]] && FINAL_TRADE="$(cast call "$CONFIG" 'params(bytes32)(uint256)' "$(cast keccak MIN_TRADE_TOKENS)" --rpc-url "$RPC" | awk '{print $1}')"
[[ "$(python3 -c "print(1 if $FINAL_TRADE < $FINAL_SEED else 0)")" == "1" ]] \
  || die "MIN_TRADE_TOKENS ($(H "$FINAL_TRADE")) is not below MIN_SEED ($(H "$FINAL_SEED")).
  No trade smaller than the whole book would be allowed."

echo ""
echo "  a roster of fourteen would lock $(python3 -c "print(f'{${MIN_RESOLVER_STAKE:-0} * 2 * 14/10**$DEC:,.2f}')") $SYM  (setup-committee stakes 2x the floor)"

if (( CHANGES == 0 )); then echo ""; echo "✓ nothing to change."; exit 0; fi
if [[ -z "$APPLY" ]]; then
  echo ""; echo "▶ $CHANGES change(s). Nothing sent. Re-run with --apply."; exit 0
fi

for C in "${CALLS[@]}"; do
  NAME="${C%%=*}"; VAL="${C#*=}"
  echo "  setParam $NAME"
  cast send "$CONFIG" 'setParam(bytes32,uint256)' "$(cast keccak "$NAME")" "$VAL" \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" >/dev/null
  GOT="$(cast call "$CONFIG" 'params(bytes32)(uint256)' "$(cast keccak "$NAME")" --rpc-url "$RPC" | awk '{print $1}')"
  [[ "$GOT" == "$VAL" ]] || die "$NAME reads back as $GOT, not $VAL."
done
echo ""
echo "✓ applied and read back. Run setup-committee.sh now, not before."
