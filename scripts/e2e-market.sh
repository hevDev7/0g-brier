#!/usr/bin/env bash
# One market, all the way through, against a real chain: create -> buy -> sell ->
# close -> settle -> redeem. Reads the deployment manifest, so it runs unchanged
# on anvil and on Galileo.
#
#   ZERO_G_TESTNET_RPC=... DEPLOYER_KEY=... CURATOR_KEY=... bash scripts/e2e-market.sh
#
# Nothing here is a mock. Every number printed is read back from the chain after
# the transaction that produced it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── .env ─────────────────────────────────────────────────────────────────────
# Loaded from the repo root so a private key never has to be typed on a command
# line, where it would land in shell history — and, if this session is driven by
# an agent, in a transcript. `.env` is gitignored; `.env.example` is the template.
if [[ -f "$ROOT/.env" ]]; then
  perms="$(stat -c '%a' "$ROOT/.env" 2>/dev/null || echo '')"
  if [[ -n "$perms" && "${perms:1}" != "00" ]]; then
    echo "⚠  $ROOT/.env is mode $perms — it holds a private key. chmod 600 it."
  fi
  # The environment wins over the file, which is the convention everywhere else
  # and the only thing that makes `RPC=... bash scripts/e2e-market.sh` mean
  # anything. Done by snapshotting the exported environment and restoring it
  # after sourcing, so `.env` keeps full shell semantics — quoting, expansion —
  # rather than being re-parsed by hand.
  _pre_env="$(export -p)"
  set -a; . "$ROOT/.env"; set +a
  eval "$_pre_env" 2>/dev/null || true
  unset _pre_env
fi

RPC="${RPC:-${ZERO_G_TESTNET_RPC:-http://127.0.0.1:8545}}"
# Wallets export a key with and without the prefix, and both are the same key —
# `cast` accepts either. `forge`'s `vm.envUint` does not: without `0x` it parses
# the string as DECIMAL, so an all-digit key would silently become a different
# one rather than fail. Normalise here, once, before anything reads it.
if [[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  DEPLOYER_KEY="0x${DEPLOYER_KEY}"; export DEPLOYER_KEY
fi
[[ "${DEPLOYER_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] \
  || { echo "✗ DEPLOYER_KEY must be a 0x-prefixed 32-byte hex key — fill it in $ROOT/.env" >&2; exit 1; }
CURATOR_KEY="${CURATOR_KEY:-$DEPLOYER_KEY}"
if [[ "$CURATOR_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then CURATOR_KEY="0x${CURATOR_KEY}"; fi

# The trading window has to be short enough to sit through. On anvil we move the
# clock; on a real chain there is nothing to do but wait, so keep it small.
WINDOW="${TRADING_WINDOW_SECONDS:-180}"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
MANIFEST="$ROOT/deployments/${CHAIN_ID}.json"
[[ -f "$MANIFEST" ]] || { echo "✗ no manifest at $MANIFEST — deploy first" >&2; exit 1; }

j() { python3 -c "import json,sys;print(json.load(open('$MANIFEST'))['contracts']['$1'])"; }
CONFIG="$(j ConfigRegistry)"; FACTORY="$(j MarketFactory)"
USDC="$(j MockUSDC)";        SHARES="$(j OutcomeShares)"

ACTOR="$(cast wallet address --private-key "$DEPLOYER_KEY")"
CURATOR="$(cast wallet address --private-key "$CURATOR_KEY")"
send() { cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

echo "chain $CHAIN_ID · actor $ACTOR · curator $CURATOR"

# ── the clock ────────────────────────────────────────────────────────────────
# A market cannot close before `tradingEnd`, and no cheatcode exists on a public
# chain. anvil gets `evm_increaseTime`; everything else waits in real time.
now() { cast block latest --rpc-url "$RPC" --field timestamp; }

# Waits until the chain's own clock passes a target, rather than sleeping a fixed
# span. On a real chain the buy and sell above have already consumed wall time, so
# a fixed sleep would overshoot; and the thing that gates `close()` is the chain's
# timestamp, not ours.
advance_to() {
  local target="$1" left
  if [[ "$CHAIN_ID" == "31337" ]]; then
    left=$(( target - $(now) + 2 ))
    if (( left > 0 )); then
      cast rpc --rpc-url "$RPC" evm_increaseTime "$left" >/dev/null
      cast rpc --rpc-url "$RPC" evm_mine >/dev/null
    fi
    return
  fi
  while (( $(now) < target )); do
    left=$(( target - $(now) ))
    echo "   chain clock $left s short of tradingEnd..."
    sleep $(( left > 15 ? 15 : left ))
  done
}

# ── settlement authority ─────────────────────────────────────────────────────
# `settle` is `onlyResolutionModule`, and a fresh deployment leaves
# RESOLUTION_MODULE unset — so nothing could ever settle. P2 replaces this with
# the real committee contract; until then the test drives it from a key we hold,
# which is why this line is here and not in the deploy script: it is a property of
# the test, not of the deployment.
RESOLUTION_KEY="$(cast keccak "RESOLUTION_MODULE")"
send "$CONFIG" "setAddress(bytes32,address)" "$RESOLUTION_KEY" "$ACTOR"

step "1/8 fund the creator and approve the factory"
SEED=1000000000        # 1,000 mUSDC (MIN_SEED is 100)
DEPOSIT=20000000       #    20 mUSDC (MIN_SETTLEMENT_DEPOSIT)
send "$USDC" "mintTo(address,uint256)" "$ACTOR" 100000000000
send "$USDC" "approve(address,uint256)" "$FACTORY" 100000000000
echo "   mUSDC balance: $(cast call --rpc-url "$RPC" "$USDC" "balanceOf(address)(uint256)" "$ACTOR")"

step "2/8 sign a curator approval (EIP-712) and create the market"
TRADING_END=$(( $(now) + WINDOW ))
SETTLEMENT_DEADLINE=$(( TRADING_END + WINDOW ))
TIER=1
AGENT_ID=1
SPEC_ROOT="$(cast keccak "0g-delphi-live-e2e")"
CATEGORY="$(cast format-bytes32-string crypto)"
NONCE=$(( $(now) ))

TYPEHASH="$(call "$FACTORY" "MARKET_APPROVAL_TYPEHASH()(bytes32)")"
STRUCT_HASH="$(cast keccak "$(cast abi-encode \
  'f(bytes32,bytes32,uint64,uint64,uint8,uint256,bytes32,address,address,uint256,uint256,uint256)' \
  "$TYPEHASH" "$SPEC_ROOT" "$TRADING_END" "$SETTLEMENT_DEADLINE" "$TIER" "$AGENT_ID" \
  "$CATEGORY" "$ACTOR" "$USDC" "$SEED" "$DEPOSIT" "$NONCE")")"
DIGEST="$(call "$FACTORY" "hashTypedData(bytes32)(bytes32)" "$STRUCT_HASH")"
SIG="$(cast wallet sign --no-hash --private-key "$CURATOR_KEY" "$DIGEST")"
echo "   digest $DIGEST"

send "$FACTORY" \
  "createMarket((address,address,uint256,uint64,uint64,uint8,bytes32,bytes32),uint256,uint256,uint256,bytes)" \
  "($USDC,$ACTOR,$AGENT_ID,$TRADING_END,$SETTLEMENT_DEADLINE,$TIER,$SPEC_ROOT,$CATEGORY)" \
  "$SEED" "$DEPOSIT" "$NONCE" "$SIG"

COUNT="$(call "$FACTORY" "marketCount()(uint256)")"
MARKET="$(call "$FACTORY" "marketAt(uint256)(address)" $(( ${COUNT%% *} - 1 )))"
echo "   market $MARKET"

p() { call "$MARKET" "probability(uint8)(uint256)" "$1" | cut -d' ' -f1; }
pool() { call "$MARKET" "poolWad()(uint256)" | cut -d' ' -f1; }
pct() { python3 -c "print(f'{int('$1')/10**16:.2f}%')"; }
usd() { python3 -c "print(f\"{int('${1%% *}')/10**6:.6f}\")"; }
# poolWad is wad, not token units — the collateral is 6-decimal but every DPM
# quantity on this contract is 18. Mixing the two is the single easiest way to
# print a number that is wrong by 1e12 and looks plausible.
wad() { python3 -c "print(f\"{int('${1%% *}')/10**18:.6f}\")"; }

echo "   P(YES) $(pct "$(p 1)")  ·  pool $(wad "$(pool)") mUSDC"

step "3/8 buy 300 YES shares"
send "$USDC" "approve(address,uint256)" "$MARKET" 100000000000
BEFORE_YES="$(p 1)"
send "$MARKET" "buy(uint8,uint256,uint256,address)" 1 300000000000000000000 100000000000 "$ACTOR"
AFTER_YES="$(p 1)"
echo "   P(YES) $(pct "$BEFORE_YES") -> $(pct "$AFTER_YES")"
[[ "$AFTER_YES" -gt "$BEFORE_YES" ]] || { echo "✗ buying YES did not raise P(YES)" >&2; exit 1; }
echo "   shares held: $(call "$SHARES" "balanceOfOutcome(address,address,uint8)(uint256)" "$ACTOR" "$MARKET" 1)"

step "4/8 sell 100 of them back"
send "$MARKET" "sell(uint8,uint256,uint256,address)" 1 100000000000000000000 0 "$ACTOR"
echo "   P(YES) now $(pct "$(p 1)")"
echo "   shares held: $(call "$SHARES" "balanceOfOutcome(address,address,uint8)(uint256)" "$ACTOR" "$MARKET" 1)"

step "5/8 cross tradingEnd and close"
advance_to "$TRADING_END"
send "$MARKET" "close()"
echo "   status $(call "$MARKET" "status()(uint8)")  (1 = Closed)"

step "6/8 settle YES"
send "$MARKET" "settle(uint8)" 1
echo "   status $(call "$MARKET" "status()(uint8)")  (4 = Settled)"
echo "   payout/share $(python3 -c "print(f\"{int('$(call "$MARKET" "payoutPerShareWad()(uint256)" | cut -d' ' -f1)')/10**18:.4f}x\")")"

step "7/8 redeem"
BAL_BEFORE="$(call "$USDC" "balanceOf(address)(uint256)" "$ACTOR" | cut -d' ' -f1)"
send "$MARKET" "redeem(address)" "$ACTOR"
BAL_AFTER="$(call "$USDC" "balanceOf(address)(uint256)" "$ACTOR" | cut -d' ' -f1)"
echo "   redeemed $(usd $(( BAL_AFTER - BAL_BEFORE ))) mUSDC"

step "8/8 solvency, on chain, after everything"
OWED="$(call "$MARKET" "collateralOwed()(uint256)" | cut -d' ' -f1)"
HELD="$(call "$USDC" "balanceOf(address)(uint256)" "$MARKET" | cut -d' ' -f1)"
echo "   market holds $(usd "$HELD") mUSDC, owes $(usd "$OWED")"
[[ "$HELD" -ge "$OWED" ]] || { echo "✗ INV-2 violated on a live chain" >&2; exit 1; }

printf '\n\033[1;32m✓ full lifecycle on chain %s\033[0m\n' "$CHAIN_ID"
echo "  market $MARKET"
