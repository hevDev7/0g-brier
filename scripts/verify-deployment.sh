#!/usr/bin/env bash
# Audit a live deployment: who holds what, and what is still concentrated.
#
#   bash scripts/verify-deployment.sh [chainId]
#
# Reads only. Exits non-zero if anything would be unsafe on mainnet, so it can be
# the last gate before one — and the same checks are worth running on Galileo,
# where a green result is what makes the rehearsal mean something.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  _pre="$(export -p)"; set -a; . "$ROOT/.env"; set +a; eval "$_pre" 2>/dev/null || true
fi
RPC="${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}"
CHAIN="${1:-$(cast chain-id --rpc-url "$RPC")}"
MANIFEST="$ROOT/deployments/$CHAIN.json"
[[ -f "$MANIFEST" ]] || { echo "✗ no manifest at $MANIFEST" >&2; exit 1; }

J(){ python3 -c "
import json,sys
d=json.load(open('$MANIFEST'))['contracts']
print(d.get('$1',''))"; }
c(){ cast call --rpc-url "$RPC" "$@" 2>/dev/null | cut -d' ' -f1; }
k(){ cast keccak "$1"; }
lc(){ tr '[:upper:]' '[:lower:]' <<<"$1"; }

CONFIG=$(J ConfigRegistry); FACTORY=$(J MarketFactory); MODULE=$(J ResolutionModule)
REGISTRY=$(J AgentRegistry); TIMELOCK=$(J Timelock); COLL=$(J MockUSDC)
MAINNET=0; [[ "$CHAIN" == "16661" ]] && MAINNET=1

FAILS=0; WARNS=0
pass(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn(){ printf "  \033[33m!\033[0m %s\n" "$1"; WARNS=$((WARNS+1)); }
fail(){ printf "  \033[31m✗\033[0m %s\n" "$1"; FAILS=$((FAILS+1)); }
# On mainnet a concentration is a failure; on a testnet it is worth saying out loud.
gate(){ [[ $MAINNET == 1 ]] && fail "$1" || warn "$1"; }

echo "Brier deployment audit — chain $CHAIN"
echo "  manifest $MANIFEST"
echo

echo "ROLES"
DEPLOYER=""; [[ -n "${DEPLOYER_KEY:-}" ]] && DEPLOYER=$(cast wallet address --private-key "0x${DEPLOYER_KEY#0x}" 2>/dev/null || true)
GOV_OWNER=$(c "$CONFIG" 'owner()(address)')
GUARD=$(c "$CONFIG" 'guardian()(address)')
TREAS=$(c "$CONFIG" 'addresses(bytes32)(address)' "$(k TREASURY)")
CUR=$(c "$CONFIG" 'addresses(bytes32)(address)' "$(k CURATOR_SIGNER)")
printf "  %-18s %s\n" "ConfigRegistry.owner" "$GOV_OWNER"
printf "  %-18s %s\n" "guardian" "$GUARD"
printf "  %-18s %s\n" "treasury" "$TREAS"
printf "  %-18s %s\n" "curator" "$CUR"
[[ -n "$DEPLOYER" ]] && printf "  %-18s %s\n" "deployer (.env)" "$DEPLOYER"
echo
[[ "$(lc "$GUARD")" == "$(lc "$GOV_OWNER")" ]] \
  && gate "the guardian is also the owner — one key can pause AND rewrite the rules" \
  || pass "the guardian is not the owner"
for pair in "treasury:$TREAS" "curator:$CUR"; do
  n=${pair%%:*}; v=${pair#*:}
  [[ "$(lc "$v")" == "$(lc "$GOV_OWNER")" ]] && gate "the $n is also the owner" || pass "the $n is not the owner"
done
if [[ -n "$DEPLOYER" ]]; then
  for pair in "guardian:$GUARD" "treasury:$TREAS" "curator:$CUR"; do
    n=${pair%%:*}; v=${pair#*:}
    [[ "$(lc "$v")" == "$(lc "$DEPLOYER")" ]] && gate "the $n is the deployer's own key"
  done
fi

echo
echo "GOVERNANCE"
if [[ -z "$TIMELOCK" || "$TIMELOCK" == "0x0000000000000000000000000000000000000000" ]]; then
  gate "no timelock — every upgrade is one signature away"
else
  DELAY=$(c "$TIMELOCK" 'getMinDelay()(uint256)')
  printf "  %-18s %s (%s h)\n" "timelock" "$TIMELOCK" "$(python3 -c "print(f'{${DELAY:-0}/3600:.0f}')")"
  [[ "${DELAY:-0}" -ge 172800 ]] && pass "the upgrade delay is at least 48 hours" \
                                 || gate "the upgrade delay is under 48 hours (${DELAY}s)"
  for x in "ConfigRegistry:$CONFIG" "MarketFactory:$FACTORY" "AgentRegistry:$REGISTRY" "ResolutionModule:$MODULE"; do
    n=${x%%:*}; a=${x#*:}
    [[ -z "$a" ]] && continue
    O=$(c "$a" 'owner()(address)'); P=$(c "$a" 'pendingOwner()(address)')
    if [[ "$(lc "$O")" == "$(lc "$TIMELOCK")" ]]; then pass "$n is owned by the timelock"
    elif [[ "$(lc "$P")" == "$(lc "$TIMELOCK")" ]]; then gate "$n handover is PENDING — governance has not called acceptOwnership"
    else gate "$n is owned by $O, not the timelock"; fi
  done
fi

echo
echo "SETTLEMENT"
[[ -z "$REGISTRY" ]] && gate "no AgentRegistry — nothing stakes, so nothing can be slashed" || {
  N=$(c "$REGISTRY" 'resolverCount()(uint256)')
  MINSTAKE=$(c "$CONFIG" 'params(bytes32)(uint256)' "$(k MIN_RESOLVER_STAKE)")
  printf "  %-18s %s registered, minimum stake %s\n" "resolvers" "${N:-0}" "${MINSTAKE:-0}"
  [[ "${MINSTAKE:-0}" != "0" ]] && pass "resolution parameters are set" \
                                || fail "resolution parameters are UNSET — run script/ApplyResolutionParams.s.sol"
  [[ "${N:-0}" -ge 3 ]] && pass "enough resolvers for a committee" \
                        || gate "only ${N:-0} resolvers — a committee cannot be sampled"
}
if [[ -n "$DEPLOYER" && -n "$MODULE" ]]; then
  BYPASS=$(c "$MODULE" 'isResolver(address)(bool)' "$DEPLOYER")
  [[ "$BYPASS" == "true" ]] \
    && gate "the deployer can settle any market DIRECTLY, bypassing the committee" \
    || pass "no direct-settlement bypass for the deployer"
fi

echo
echo "COLLATERAL"
if [[ -n "$COLL" ]]; then
  SYM=$(cast call --rpc-url "$RPC" "$COLL" 'symbol()(string)' 2>/dev/null | tr -d '"')
  printf "  %-18s %s (%s)\n" "token" "$COLL" "${SYM:-?}"
  # An open mint is what makes MockUSDC a testnet-only token: anyone can print the
  # collateral backing every payout.
  if cast call --rpc-url "$RPC" "$COLL" 'mintTo(address,uint256)' "$COLL" 1 >/dev/null 2>&1; then
    gate "the collateral has an OPEN mintTo — anyone can print it"
  else
    pass "the collateral has no open mint"
  fi
fi

echo
if [[ $FAILS -gt 0 ]]; then
  printf "\033[31m✗ %d blocking, %d to note\033[0m\n" "$FAILS" "$WARNS"; exit 1
elif [[ $WARNS -gt 0 ]]; then
  printf "\033[33m! %d to note — acceptable on a testnet, blocking on mainnet\033[0m\n" "$WARNS"; exit 0
else
  printf "\033[32m✓ nothing concentrated\033[0m\n"; exit 0
fi
