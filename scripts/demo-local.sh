#!/usr/bin/env bash
# Brings up anvil, deploys the P0 stack, prints the manifest, then stays running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
# anvil account #0 — a public test key that never holds value
export DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

ANVIL_PID=""
cleanup() { [[ -n "$ANVIL_PID" ]] && kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "▶ bringing up anvil on port ${PORT}"
anvil --port "$PORT" --silent &
ANVIL_PID=$!

for _ in $(seq 1 60); do
  if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
cast block-number --rpc-url "$RPC" >/dev/null

echo "▶ deploying the P0 stack"
cd "$ROOT/contracts"
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast -vv

echo "▶ manifest:"
cat "$ROOT/deployments/31337.json"

echo ""
echo "anvil is running on $RPC (PID $ANVIL_PID) — Ctrl-C to stop"
wait "$ANVIL_PID"
