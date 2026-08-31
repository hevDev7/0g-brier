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

if [[ -f "$ROOT/.env" ]]; then
  _pre="$(export -p)"; set -a; . "$ROOT/.env"; set +a; eval "$_pre" 2>/dev/null || true
fi
[[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]] && DEPLOYER_KEY="0x${DEPLOYER_KEY}"
RPC="${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
J(){ python3 -c "import json;print(json.load(open('$ROOT/deployments/$CHAIN.json'))['contracts']['$1'])"; }
REG="$(J AgentRegistry)"; USDC="$(J MockUSDC)"
ACTOR="$(cast wallet address --private-key "$DEPLOYER_KEY")"

TIP=$(python3 -c "print(int('$(cast rpc --rpc-url "$RPC" eth_maxPriorityFeePerGas | tr -d '"')',16))")
CEIL=$(( TIP * 2 + $(cast base-fee --rpc-url "$RPC") ))
send(){ cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async "$@"; }
wait_ok(){ for _ in $(seq 1 60); do S=$(cast receipt --rpc-url "$RPC" "$1" status 2>/dev/null | awk '{print $1}' || true); [ -n "${S:-}" ] && { [ "$S" = "1" ] || { echo "✗ reverted: $1" >&2; exit 1; }; return; }; sleep 3; done; echo "✗ no receipt: $1" >&2; exit 1; }

STAKE=$(cast call --rpc-url "$RPC" "$(J ConfigRegistry)" 'params(bytes32)(uint256)' "$(cast keccak MIN_RESOLVER_STAKE)" | cut -d' ' -f1)
STAKE=$(( STAKE * 2 ))   # comfortably above the floor, so a slash cannot drop a member below it mid-demo
GAS_EACH=5000000000000000  # 0.005 0G — enough for a commit and a reveal

echo "committee of $COUNT on chain $CHAIN"
echo "  registry $REG   stake $STAKE per resolver"
H=$(send "$USDC" "mintTo(address,uint256)" "$ACTOR" $(( STAKE * COUNT ))); wait_ok "$H"
H=$(send "$USDC" "approve(address,uint256)" "$REG" $(( STAKE * COUNT ))); wait_ok "$H"

OUT="$ROOT/deployments/committee-$CHAIN.json"; echo "[" > "$OUT"
for i in $(seq 0 $((COUNT-1))); do
  OPKEY=$(cast keccak "$(cast concat-hex "$DEPLOYER_KEY" "$(cast to-bytes32 $i)")")
  OP=$(cast wallet address --private-key "$OPKEY")
  H=$(send "$REG" "register(uint8,address,bytes32)" 2 "$OP" "$(cast keccak "agent-$i")"); wait_ok "$H"
  ID=$(cast call --rpc-url "$RPC" "$REG" 'nextAgentId()(uint256)' | cut -d' ' -f1); ID=$(( ID - 1 ))
  H=$(send "$REG" "stake(uint256,uint256)" "$ID" "$STAKE"); wait_ok "$H"
  BAL=$(cast balance --rpc-url "$RPC" "$OP")
  if [ "$BAL" -lt "$GAS_EACH" ]; then
    H=$(send --value "$GAS_EACH" "$OP" 2>/dev/null || cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async --value "$GAS_EACH" "$OP"); wait_ok "$H"
  fi
  echo "  agent $ID  operator $OP  staked $(python3 -c "print(f\"{$STAKE/10**6:.2f}\")")  gas $(cast balance --rpc-url "$RPC" "$OP" --ether)"
  printf '  {"agentId": %s, "operator": "%s", "index": %s}%s\n' "$ID" "$OP" "$i" "$([ $i -lt $((COUNT-1)) ] && echo ,)" >> "$OUT"
done
echo "]" >> "$OUT"
echo "✓ $COUNT resolvers, written to $OUT"
