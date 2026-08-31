#!/usr/bin/env bash
# Register, fund and stake a resolver committee.
#
#   DEPLOYER_KEY=... bash scripts/setup-committee.sh [count]
#
# Each resolver gets its OWN operator key, and that is not decoration: a vote
# commitment binds `msg.sender`, so operators sharing a key would make their
# commitments interchangeable and quietly undo what commit–reveal is for.
#
# Operator keys are derived from the deployer's, so a re-run reaches the same
# five and the script is idempotent. That is fine for a testnet demo and wrong
# for anything else — a real committee's operators are independent parties whose
# keys the protocol never sees.
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
COUNT="${1:-5}"
# Where to start numbering. Lets a committee be TOPPED UP rather than rebuilt:
# names and operator keys both derive from the index, so re-running from zero
# would collide on both. The dispute round draws nine members from OUTSIDE round
# one's five, so a deployment that started with five and later wants a real
# dispute has to add nine more without disturbing the ones already staked.
START="${2:-0}"

# ENV_FILE lets a mainnet run read .env.mainnet without the testnet key in .env
# shadowing it. Everything below reads the chain from the RPC and the manifest from
# the chain, so pointing those two at mainnet is the whole of the difference.
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [[ -f "$ENV_FILE" ]]; then
  _pre="$(export -p)"; set -a; . "$ENV_FILE"; set +a; eval "$_pre" 2>/dev/null || true
fi
[[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]] && DEPLOYER_KEY="0x${DEPLOYER_KEY}"
RPC="${ZERO_G_RPC:-${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}}"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
J(){ python3 -c "import json;print(json.load(open('$ROOT/deployments/$CHAIN.json'))['contracts']['$1'])"; }
REG="$(J AgentRegistry)"; USDC="$(J MockUSDC)"
ACTOR="$(cast wallet address --private-key "$DEPLOYER_KEY")"

TIP=$(python3 -c "print(int('$(cast rpc --rpc-url "$RPC" eth_maxPriorityFeePerGas | tr -d '"')',16))")
CEIL=$(( TIP * 2 + $(cast base-fee --rpc-url "$RPC") ))
send(){ cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async "$@"; }
wait_ok(){ for _ in $(seq 1 60); do S=$(cast receipt --rpc-url "$RPC" "$1" status 2>/dev/null | awk '{print $1}' || true); [ -n "${S:-}" ] && { [ "$S" = "1" ] || { echo "✗ reverted: $1" >&2; exit 1; }; return; }; sleep 3; done; echo "✗ no receipt: $1" >&2; exit 1; }

STAKE=$(cast call --rpc-url "$RPC" "$(J ConfigRegistry)" 'params(bytes32)(uint256)' "$(cast keccak MIN_RESOLVER_STAKE)" | cut -d' ' -f1)
# `python3`, NOT `$(( ))`. Bash arithmetic is 64-bit signed, and its ceiling is
# 9.22e18 — smaller than ONE whole token of an 18-decimal collateral once doubled.
# `$(( STAKE * 2 ))` against a 100e18 floor silently produces a negative number, and
# the approve that follows would have been for garbage.
STAKE=$(python3 -c "print($STAKE * 2)")   # comfortably above the floor, so a slash cannot drop a member below it mid-demo
GAS_EACH=5000000000000000  # 0.005 0G — enough for a commit and a reveal

DEC=$(cast call --rpc-url "$RPC" "$USDC" 'decimals()(uint8)' | awk '{print $1}')
SYM=$(cast call --rpc-url "$RPC" "$USDC" 'symbol()(string)' 2>/dev/null | tr -d '"' || echo '?')
NEED=$(python3 -c "print($STAKE * $COUNT)")
HUMAN(){ python3 -c "print(f'{$1/10**$DEC:,.4f}')"; }

echo "committee of $COUNT on chain $CHAIN (indices $START..$((START + COUNT - 1)))"
echo "  registry $REG   stake $(HUMAN "$STAKE") $SYM per resolver"
echo "  total    $(HUMAN "$NEED") $SYM locked (recoverable after UNSTAKE_COOLDOWN, not spent)"

# The stake token is MINTABLE ONLY ON A TESTNET. `MockUSDC` has an open `mintTo`;
# W0G does not, and neither does any real token. So: hold the stake first, and let
# the mint be the testnet convenience it always was rather than a precondition.
BAL=$(cast call --rpc-url "$RPC" "$USDC" 'balanceOf(address)(uint256)' "$ACTOR" | cut -d' ' -f1)
if [ "$(python3 -c "print(1 if $BAL < $NEED else 0)")" = "1" ]; then
  if H=$(send "$USDC" "mintTo(address,uint256)" "$ACTOR" "$NEED" 2>/dev/null); then
    wait_ok "$H"
  else
    echo "✗ $ACTOR holds $(HUMAN "$BAL") $SYM but $COUNT resolvers need $(HUMAN "$NEED")." >&2
    echo "  $SYM has no mintTo — acquire it first. For W0G that is deposit() on the" >&2
    echo "  wrapper, which takes native 0G one-for-one." >&2
    exit 1
  fi
fi
H=$(send "$USDC" "approve(address,uint256)" "$REG" "$NEED"); wait_ok "$H"

OUT="$ROOT/deployments/committee-$CHAIN.json"
# A top-up writes its own slice and leaves the caller to merge. Overwriting the
# manifest here would drop the members this run is deliberately not touching.
if [ "$START" != "0" ]; then OUT="$ROOT/deployments/committee-$CHAIN.slice-$START.json"; fi
echo "[" > "$OUT"
for i in $(seq "$START" $((START + COUNT - 1))); do
  # `printf '%064x'`, NOT `cast to-bytes32`. That helper reads its argument as a
  # HEX STRING and pads it on the RIGHT, so `10` becomes 0x1000… — byte-identical
  # to what `1` produces. Indices 1 and 10 therefore derived the SAME operator
  # key, and the eleventh registration failed with `OperatorAlreadyActs` naming
  # the second agent. Observed on Galileo, 2026-08-31, building a committee of
  # fourteen for a dispute round.
  OPKEY=$(cast keccak "$(cast concat-hex "$DEPLOYER_KEY" "$(printf '0x%064x' "$i")")")
  OP=$(cast wallet address --private-key "$OPKEY")
  # FOUR arguments. `register` gained `metadataRoot` after this line was written, and
  # a three-argument call hashes to a selector the registry does not have — so every
  # registration reverted, and the script reported it as a resolver that refused to
  # register rather than as a script calling a function that is not there. Caught by
  # checking every signature in this file against the deployed bytecode, 2026-08-31.
  H=$(send "$REG" "register(uint8,address,bytes32,bytes32)" 2 "$OP" \
        "$(cast keccak "agent-$i")" "$(cast keccak "meta-$i")"); wait_ok "$H"
  ID=$(cast call --rpc-url "$RPC" "$REG" 'nextAgentId()(uint256)' | cut -d' ' -f1); ID=$(( ID - 1 ))
  H=$(send "$REG" "stake(uint256,uint256)" "$ID" "$STAKE"); wait_ok "$H"
  BAL=$(cast balance --rpc-url "$RPC" "$OP")
  if [ "$(python3 -c "print(1 if $BAL < $GAS_EACH else 0)")" = "1" ]; then
    H=$(send --value "$GAS_EACH" "$OP" 2>/dev/null || cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async --value "$GAS_EACH" "$OP"); wait_ok "$H"
  fi
  echo "  agent $ID  operator $OP  staked $(HUMAN "$STAKE") $SYM  gas $(cast balance --rpc-url "$RPC" "$OP" --ether)"
  printf '  {"agentId": %s, "operator": "%s", "index": %s}%s\n' "$ID" "$OP" "$i" "$([ $i -lt $((START + COUNT - 1)) ] && echo ,)" >> "$OUT"
done
echo "]" >> "$OUT"
echo "✓ $COUNT resolvers, written to $OUT"
