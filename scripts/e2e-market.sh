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
# Tracing off, and not negotiable. `cast` has no environment variable for a
# signing key — `--private-key` on the command line is the only way — so any
# shell tracing this script inherits expands that argument in full. Running it
# as `bash -x` to debug a failing transaction is exactly when somebody reaches
# for tracing, and it is exactly when the key would be printed. It happened on
# 2026-08-30: a `bash -x` of this file put a deployer key that owned every
# protocol proxy into a session transcript.
{ set +x; } 2>/dev/null

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
# Galileo enforces a minimum priority fee and rejects cast's default tip of 1 wei
# outright: "transaction gas price below minimum: gas tip cap 1, minimum needed
# 2000000000". `forge script` never hit it because it estimates its own fees.
#
# Setting the tip alone is not enough either — the node then reports
# "max priority fee per gas higher than max fee per gas ... maxFeePerGas: 0",
# because with a zero base fee cast derives a ceiling of zero. Both halves have to
# be given, and both are asked of the node rather than hardcoded, so this keeps
# working on a chain with different economics.
GAS_FLAGS=()
TIP="$(cast rpc --rpc-url "$RPC" eth_maxPriorityFeePerGas 2>/dev/null | tr -d '"' || true)"
if [[ "$TIP" =~ ^0x[0-9a-fA-F]+$ ]] && (( $((TIP)) > 0 )); then
  TIP=$((TIP))
  GP="$(cast gas-price --rpc-url "$RPC")"
  MAXFEE=$(( (TIP > GP ? TIP : GP) * 2 ))   # headroom, so a base-fee bump mid-run does not strand a tx
  GAS_FLAGS=(--priority-gas-price "$TIP" --gas-price "$MAXFEE")
  echo "fees: tip $(python3 -c "print(f'{$TIP/10**9:.2f}')") gwei, ceiling $(python3 -c "print(f'{$MAXFEE/10**9:.2f}')") gwei (both from the node)"
fi

# A failed transaction must stop the run. `set -e` did not catch this on its own,
# and the script carried on printing an empty balance as though nothing had gone
# wrong — which is worse than crashing, because the output still looked like a
# result.
#
# Sent with --async and polled, rather than letting cast wait. This node
# intermittently answers eth_getTransactionReceipt with null before a transaction
# is mined ("server returned a null response when a non-null response was
# expected"); the deploy survived it only because `forge` retries and `cast` does
# not. Polling for the receipt ourselves also lets a revert be reported as a
# revert, instead of as a timeout.
send() {
  local hash status i
  hash="$(cast send --async --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" \
          ${GAS_FLAGS[@]+"${GAS_FLAGS[@]}"} "$@")" \
    || { echo "✗ could not submit: cast send $1 ${2:-}" >&2; exit 1; }
  for ((i = 0; i < 90; i++)); do
    # `cast receipt <tx> status` prints "1 (success)", not "1" — comparing against
    # the whole string reported a successful transaction as a revert, which cost an
    # hour of looking for a contract bug that was never there.
    status="$(cast receipt "$hash" status --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || true)"
    [[ -n "$status" ]] && break
    sleep 2
  done
  [[ -n "$status" ]] || { echo "✗ no receipt after 180s for $hash ($1 ${2:-})" >&2; exit 1; }
  [[ "$status" == "1" || "$status" == "0x1" ]] \
    || { echo "✗ transaction reverted on chain: $hash ($1 ${2:-})" >&2; exit 1; }
}
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
# `settle` is `onlyResolutionModule`, and this used to point that gate at our own
# EOA so the test could settle directly. It no longer does, and the difference is
# the whole point: settling through ResolutionModule is what anchors the receipt.
# An EOA can move a market to Settled and leave no evidence behind at all.
MODULE="$(j ResolutionModule)"
[[ "$MODULE" =~ ^0x[0-9a-fA-F]{40}$ ]] || {
  echo "✗ no ResolutionModule in $MANIFEST — run script/DeployResolutionModule.s.sol first" >&2
  exit 1
}
ONCHAIN_MODULE="$(call "$CONFIG" "addresses(bytes32)(address)" "$(cast keccak "RESOLUTION_MODULE")")"
[[ "${ONCHAIN_MODULE,,}" == "${MODULE,,}" ]] || {
  echo "✗ RESOLUTION_MODULE on chain is $ONCHAIN_MODULE, manifest says $MODULE" >&2
  exit 1
}
echo "   resolution module $MODULE"

step "1/8 fund the creator and approve the factory"
SEED=1000000000        # 1,000 mUSDC (MIN_SEED is 100)
DEPOSIT=20000000       #    20 mUSDC (MIN_SETTLEMENT_DEPOSIT)
send "$USDC" "mintTo(address,uint256)" "$ACTOR" 100000000000
send "$USDC" "approve(address,uint256)" "$FACTORY" 100000000000
echo "   mUSDC balance: $(cast call --rpc-url "$RPC" "$USDC" "balanceOf(address)(uint256)" "$ACTOR")"

step "2/8 sign a curator approval (EIP-712) and create the market"
TRADING_END=$(( $(now) + WINDOW ))
# Separate from the trading window on purpose. Trading length is a market-design
# choice; the settlement window has to FIT THE MACHINERY — opening the round, the
# commit window, the reveal window, the dispute window, and a 0G Storage upload per
# resolver inside the first of those. Sizing it off the trading window is how the
# first weather run got a deadline shorter than its own settlement, failed, and
# looked like a committee that never turned up.
SETTLEMENT_DEADLINE=$(( TRADING_END + ${SETTLEMENT_WINDOW_SECONDS:-$WINDOW} ))
# 0 = FAST, 1 = VERIFIED, 2 = DETERMINISTIC. The tier decides the committee's shape
# and its dispute window, so a run with three staked resolvers wants tier 2 (n=3, k=2)
# rather than the default VERIFIED (n=5, k=3), which would revert NotEnoughResolvers.
TIER="${TIER:-1}"
# ZERO, not 1, and the change is not cosmetic. The factory now verifies that whoever
# creates a market OWNS the identity it credits — `NotAgentOwner` otherwise — and this
# script signs with DEPLOYER_KEY, which owns no agent. It used to pass 1, which belongs
# to the trading agent's wallet, and the chain recorded that false attribution as fact.
# Zero is the registry's own sentinel for "none": a market crediting nobody is honest,
# a market crediting somebody else was not. Override with AGENT_ID=<id> when the signing
# key genuinely owns or operates one.
AGENT_ID="${AGENT_ID:-0}"
# One of the six the registry knows (spec §5.2), or `selftest` for a lifecycle demo.
# The factory REFUSES an unknown category: a market nobody can file is one nobody can
# filter for, no agent policy can match, and no settlement template can reach.
CATEGORY_NAME="${CATEGORY_NAME:-selftest}"
SPEC_DOC="$(python3 "$ROOT/scripts/market-spec.py" "$TRADING_END" "$SETTLEMENT_DEADLINE" "$TIER" "$AGENT_ID" "$CATEGORY_NAME")"
# The document decides what goes on chain — `selftest` files itself under crypto —
# so the bytes32 is read back OUT of it rather than set beside it, where the two
# could drift.
CATEGORY="$(cast format-bytes32-string "$(printf '%s' "$SPEC_DOC" | python3 -c "import json,sys;print(json.load(sys.stdin)['category'])")")"

# The MarketSpec, and the root that commits to it.
#
# This used to be `cast keccak "brier-live-e2e"` — a hash of a string, with no
# document behind it. The market it produced is readable in every respect EXCEPT
# the question it asks, because `specRoot` is a 0G Storage content address and
# that one addressed nothing. The document below is what the UI reads and what a
# resolver is meant to judge against, so it is built FROM the same values the
# market is created with rather than beside them.
# Uploading writes to 0G Chain, so a local anvil run computes the root without
# storing anything and says so, rather than pretending.
if [[ "$CHAIN_ID" == "16602" || "${ZG_UPLOAD:-0}" == "1" ]]; then
  echo "   uploading the MarketSpec to 0G Storage"
  SPEC_ROOT="$(printf '%s' "$SPEC_DOC" | UPLOADER_KEY="$DEPLOYER_KEY" node "$ROOT/scripts/upload-doc.mjs" --require question,rules)"
else
  SPEC_ROOT="$(printf '%s' "$SPEC_DOC" | node "$ROOT/scripts/upload-doc.mjs" --dry-run --require question,rules)"
fi
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

# A market to trade against, rather than a lifecycle to watch. The rest of this
# script closes and settles what it creates, which leaves nothing Open for an
# agent to buy into — so `STOP_AFTER_CREATE=1 TRADING_WINDOW_SECONDS=86400`
# leaves one standing.
if [[ "${STOP_AFTER_CREATE:-0}" == "1" ]]; then
  echo
  echo -e "\033[1;32m✓ market open for $((WINDOW / 60)) minutes on chain $CHAIN_ID\033[0m"
  echo "  market $MARKET"
  echo "  spec   $SPEC_ROOT"
  exit 0
fi

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

step "6/8 settle YES, with a receipt anchored on chain"
# The receipt is written and stored BEFORE the settlement, because its root is an
# argument to it. A settlement cannot land here without one: ResolutionModule
# rejects a zero root, which is the guard that stops this market repeating what
# the first Galileo market did with its specRoot.
RECEIPT_DOC="$(python3 "$ROOT/scripts/settlement-receipt.py" "$MARKET" "$SPEC_ROOT" 1 "$ACTOR" "$(now)")"
if [[ "$CHAIN_ID" == "16602" || "${ZG_UPLOAD:-0}" == "1" ]]; then
  echo "   uploading the settlement receipt to 0G Storage"
  RECEIPT_ROOT="$(printf '%s' "$RECEIPT_DOC" | UPLOADER_KEY="$DEPLOYER_KEY" node "$ROOT/scripts/upload-doc.mjs")"
else
  RECEIPT_ROOT="$(printf '%s' "$RECEIPT_DOC" | node "$ROOT/scripts/upload-doc.mjs" --dry-run)"
fi
send "$MODULE" "settle(address,uint8,bytes32)" "$MARKET" 1 "$RECEIPT_ROOT"
ANCHORED="$(call "$MODULE" "resolutionOf(address)(bytes32,address)" "$MARKET" | head -1)"
[[ "${ANCHORED,,}" == "${RECEIPT_ROOT,,}" ]] || {
  echo "✗ the module reports receipt $ANCHORED, not $RECEIPT_ROOT" >&2; exit 1; }
echo "   receipt $RECEIPT_ROOT anchored"
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
