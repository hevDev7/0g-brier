#!/usr/bin/env bash
# Verify a deployment's contracts on chainscan, so the explorer shows source.
#
#   bash scripts/verify-contracts.sh [chainId]      # default 16661
#
# WHY THIS EXISTS RATHER THAN A README LINE. Three things about 0G's explorer make
# the obvious `forge verify-contract` invocation fail, and each fails differently:
#
#   1. The API is at /open/api, NOT /api. The Galileo instance uses /api and the
#      runbook's old command was written for that.
#   2. Foundry has no built-in entry for chain 16661, so `--verifier etherscan`
#      refuses before it sends anything. `--verifier custom` with an explicit
#      --verifier-url is the path that works.
#   3. `--watch` ALWAYS FAILS HERE, even when verification succeeds. chainscan's
#      submit response does not carry the guid Foundry then polls with, so it asks
#      for status without one and gets "guid is required" five times before giving
#      up. The contract is verified by then. So: submit without --watch, and read
#      the result back from getsourcecode, which is the explorer's own answer.
#
# CONSTRUCTOR ARGUMENTS ARE RECOVERED, NOT RETYPED. A CREATE transaction's input is
# the creation bytecode followed by the encoded arguments, and the artifact holds
# the creation bytecode — so the tail is the arguments, exactly as they were sent.
# Retyping them by hand is how a proxy gets verified against the wrong
# implementation address and nobody notices, because the source still matches.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAIN="${1:-16661}"
case "$CHAIN" in
  16661) API="https://chainscan.0g.ai/open/api" ;;
  16602) API="https://chainscan-galileo.0g.ai/api" ;;
  *) echo "✗ no explorer known for chain $CHAIN" >&2; exit 1 ;;
esac
MANIFEST="$ROOT/deployments/$CHAIN.json"
BROADCAST="$ROOT/contracts/broadcast/Deploy.s.sol/$CHAIN/run-latest.json"
[[ -f "$MANIFEST" ]] || { echo "✗ no manifest at $MANIFEST" >&2; exit 1; }
[[ -f "$BROADCAST" ]] || { echo "✗ no broadcast log at $BROADCAST" >&2; exit 1; }

echo "▶ chain $CHAIN via $API"
echo "▶ manifest $(basename "$MANIFEST")"
echo ""

# name -> "address contractPath ctorArgsHex", built from the broadcast log so the
# arguments are the ones actually sent.
PLAN="$(python3 - "$BROADCAST" "$ROOT/contracts" <<'PY'
import json, os, sys

broadcast, contracts_dir = sys.argv[1], sys.argv[2]
d = json.load(open(broadcast))

# The CREATE order in Deploy.s.sol, and where each one's source lives. A proxy is
# named for what it fronts, which is what the manifest calls it.
PLAN = [
    ("ConfigRegistryImpl",   "src/core/ConfigRegistry.sol:ConfigRegistry"),
    ("ConfigRegistry",       "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"),
    ("OutcomeShares",        "src/core/OutcomeShares.sol:OutcomeShares"),
    ("MarketImplementation", "src/core/Market.sol:Market"),
    ("MarketFactoryImpl",    "src/core/MarketFactory.sol:MarketFactory"),
    ("MarketFactory",        "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"),
    ("AgentRegistryImpl",    "src/core/AgentRegistry.sol:AgentRegistry"),
    ("AgentRegistry",        "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"),
    ("ZgDataVerifier",       "src/core/ZgDataVerifier.sol:ZgDataVerifier"),
    ("AgentCard",            "src/core/AgentCard.sol:AgentCard"),
    ("ResolutionModuleImpl", "src/core/ResolutionModule.sol:ResolutionModule"),
    ("ResolutionModule",     "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"),
    ("Timelock",             "lib/openzeppelin-contracts/contracts/governance/TimelockController.sol:TimelockController"),
]

creates = [t for t in d["transactions"] if t.get("transactionType") == "CREATE" and t.get("hash")]
if len(creates) != len(PLAN):
    sys.exit(f"broadcast has {len(creates)} CREATEs, the plan expects {len(PLAN)}")

def creation_code(path):
    """The artifact's creation bytecode, so the constructor args can be split off."""
    src, name = path.split(":")
    art = os.path.join(contracts_dir, "out", os.path.basename(src), f"{name}.json")
    with open(art) as f:
        return json.load(f)["bytecode"]["object"].lower().removeprefix("0x")

for (name, path), tx in zip(PLAN, creates):
    addr = (tx.get("contractAddress") or "").lower()
    data = (tx["transaction"].get("input") or tx["transaction"].get("data") or "").lower().removeprefix("0x")
    code = creation_code(path)
    args = data[len(code):] if data.startswith(code) else ""
    print(f"{name}\t{addr}\t{path}\t{args}")
PY
)" || { echo "✗ could not build the plan" >&2; exit 1; }

verified(){ curl -s --max-time 25 "$API?module=contract&action=getsourcecode&address=$1" \
  | python3 -c "import sys,json;print('yes' if json.load(sys.stdin)['result'][0].get('SourceCode') else 'no')" 2>/dev/null || echo "?"; }

DONE=0; SKIP=0; FAIL=0
while IFS=$'\t' read -r NAME ADDR PATHSPEC ARGS; do
  [[ -z "$ADDR" ]] && continue
  if [[ "$(verified "$ADDR")" == "yes" ]]; then
    printf "  %-22s %s  already verified\n" "$NAME" "$ADDR"; SKIP=$((SKIP+1)); continue
  fi
  printf "  %-22s %s  submitting…\n" "$NAME" "$ADDR"
  ARGFLAG=()
  [[ -n "$ARGS" ]] && ARGFLAG=(--constructor-args "0x$ARGS")
  # No --watch: see the header. Submit, then ask the explorer itself.
  (cd "$ROOT/contracts" && forge verify-contract "$ADDR" "$PATHSPEC" \
      --chain-id "$CHAIN" --verifier custom --verifier-url "$API" \
      --compiler-version 0.8.28 --num-of-optimizations 800 \
      "${ARGFLAG[@]}" >/dev/null 2>&1)
  sleep 6
  if [[ "$(verified "$ADDR")" == "yes" ]]; then
    printf "  %-22s %s  ✓ verified\n" "" ""; DONE=$((DONE+1))
  else
    printf "  %-22s %s  ✗ still unverified\n" "" ""; FAIL=$((FAIL+1))
  fi
done <<< "$PLAN"

echo ""
echo "▶ $DONE verified now, $SKIP already were, $FAIL still unverified"
[[ "$FAIL" -eq 0 ]] || exit 1
