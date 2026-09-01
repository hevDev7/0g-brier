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
# .env.mainnet wins over .env when it exists, as in deploy-mainnet.sh and
# handover.sh. One file decides everything downstream — the endpoint, and therefore
# the chain, and therefore the manifest, and therefore which key signs — so mixing
# two of them is how a mainnet key ends up signing on Galileo or the reverse. Set
# ENV_FILE or ZERO_G_RPC to override; the banner below says which one won.
ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env"
  [[ -f "$ROOT/.env.mainnet" ]] && ENV_FILE="$ROOT/.env.mainnet"
fi
if [[ -f "$ENV_FILE" ]]; then
  _pre="$(export -p)"; set -a; . "$ENV_FILE"; set +a; eval "$_pre" 2>/dev/null || true
fi
[[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]] && DEPLOYER_KEY="0x${DEPLOYER_KEY}"
RPC="${ZERO_G_RPC:-${ZERO_G_MAINNET_RPC:-${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}}}"
CHAIN="$(cast chain-id --rpc-url "$RPC")"

# SAY WHICH CHAIN, BEFORE STAKING ANYTHING. This script registers agents and moves
# real collateral, and it used to fall back to the testnet endpoint in silence — so
# `bash scripts/setup-committee.sh 14` against a fresh mainnet deployment would have
# built the committee on Galileo and reported success. handover.sh had the identical
# hole, found the same day. A roster on the wrong chain is not recoverable by
# re-running: the stake is locked behind UNSTAKE_COOLDOWN wherever it landed.
CHAIN_NAME="chain $CHAIN"
case "$CHAIN" in
  16661) CHAIN_NAME="0G MAINNET (16661)" ;;
  16602) CHAIN_NAME="Galileo testnet (16602)" ;;
  31337) CHAIN_NAME="local anvil (31337)" ;;
esac
echo "▶ $CHAIN_NAME via $RPC"
echo "▶ manifest $CHAIN.json   env $(basename "$ENV_FILE")"
J(){ python3 -c "import json;print(json.load(open('$ROOT/deployments/$CHAIN.json'))['contracts']['$1'])"; }
REG="$(J AgentRegistry)"; USDC="$(J MockUSDC)"
ACTOR="$(cast wallet address --private-key "$DEPLOYER_KEY")"

TIP=$(python3 -c "print(int('$(cast rpc --rpc-url "$RPC" eth_maxPriorityFeePerGas | tr -d '"')',16))")
CEIL=$(( TIP * 2 + $(cast base-fee --rpc-url "$RPC") ))
send(){ cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async "$@"; }
# `--async` IS LOAD-BEARING. Without it `cast receipt` BLOCKS until the node serves
# the receipt, so the "60 tries at 3s" budget below is never spent: the first call
# never returns and the script hangs with no output. On this endpoint, which drops
# receipts for transactions it has already mined, that is not hypothetical — the
# mainnet deploy hit it eight times. With --async the call returns immediately and
# an empty answer is what the loop is written to retry.
wait_ok(){
  for _ in $(seq 1 60); do
    S=$(cast receipt --async --rpc-url "$RPC" "$1" status 2>/dev/null | awk '{print $1}' || true)
    if [ -n "${S:-}" ]; then
      [ "$S" = "1" ] || { echo "✗ reverted: $1" >&2; exit 1; }
      return
    fi
    sleep 3
  done
  echo "✗ no receipt after 180s: $1" >&2
  echo "  The transaction may still have landed — this endpoint returns null for" >&2
  echo "  receipts of mined transactions. Check it before re-running:" >&2
  echo "    cast receipt $1 --rpc-url $RPC" >&2
  exit 1
}

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

# The manifest is written ATOMICALLY AT THE END, and merged with what is already
# there. Three defects lived in the previous four lines:
#   - `echo "[" > "$OUT"` truncated the record BEFORE the loop, so a re-run destroyed
#     the members it was about to discover it could not rebuild.
#   - entries were appended with trailing commas and the closing `]` written after
#     the loop, so any interruption left INVALID JSON. That happened here on mainnet.
#   - a top-up wrote a `slice-N` file and "left the caller to merge", but nothing in
#     this repository merges one. The only two mentions of `slice-` were those lines.
OUT="$ROOT/deployments/committee-$CHAIN.json"
NEW_MEMBERS=""
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
  # `agentOf(OP)`, NOT `nextAgentId() - 1`. The counter is GLOBAL and `register` is
  # permissionless, so a stranger's registration landing between ours and this read
  # makes the counter name THEIR agent — and `stake` has no ownership check, so the
  # 0.4 W0G would be paid into a record this deployer cannot withdraw from. A read
  # served by a lagging node does the same thing one block earlier. `agentOf` is tied
  # to the operator WE just registered and cannot drift.
  ID=$(cast call --rpc-url "$RPC" "$REG" 'agentOf(address)(uint256)' "$OP" | cut -d' ' -f1)
  [ -n "$ID" ] && [ "$ID" != "0" ] || { echo "✗ registration for $OP did not take: agentOf is 0" >&2; exit 1; }
  OWNER=$(cast call --rpc-url "$RPC" "$REG" 'ownerOf(uint256)(address)' "$ID" | awk '{print $1}')
  [ "${OWNER,,}" = "${ACTOR,,}" ] || { echo "✗ agent $ID is owned by $OWNER, not $ACTOR — refusing to stake into it" >&2; exit 1; }
  H=$(send "$REG" "stake(uint256,uint256)" "$ID" "$STAKE"); wait_ok "$H"
  BAL=$(cast balance --rpc-url "$RPC" "$OP")
  if [ "$(python3 -c "print(1 if $BAL < $GAS_EACH else 0)")" = "1" ]; then
    H=$(send --value "$GAS_EACH" "$OP" 2>/dev/null || cast send --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --priority-gas-price "$TIP" --gas-price "$CEIL" --async --value "$GAS_EACH" "$OP"); wait_ok "$H"
  fi
  echo "  agent $ID  operator $OP  staked $(HUMAN "$STAKE") $SYM  gas $(cast balance --rpc-url "$RPC" "$OP" --ether)"
  NEW_MEMBERS="$NEW_MEMBERS$ID $OP $i"$'\n'
done

# Merge by agentId: members already recorded stay, this run's are added or updated,
# and the file is replaced in one move so it is never seen half-written.
python3 - "$OUT" <<PYEOF
import json, os, sys
path = sys.argv[1]
existing = []
if os.path.exists(path):
    try:
        existing = json.load(open(path))
    except Exception:
        # An earlier interrupted run could leave invalid JSON. Losing it is better
        # than refusing to record the members this run just paid for, and the chain
        # is the real record either way.
        print("  (the manifest on disk was not valid JSON; rebuilding it)")
by_id = {m["agentId"]: m for m in existing if isinstance(m, dict) and "agentId" in m}
for line in """$NEW_MEMBERS""".strip().splitlines():
    if not line.strip():
        continue
    agent_id, operator, index = line.split()
    by_id[int(agent_id)] = {"agentId": int(agent_id), "operator": operator, "index": int(index)}
out = [by_id[k] for k in sorted(by_id)]
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
print(f"  manifest now holds {len(out)} member(s)")
PYEOF
echo "✓ $COUNT resolvers this run, merged into $(basename "$OUT")"
