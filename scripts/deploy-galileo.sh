#!/usr/bin/env bash
# Deploys the P0+P1 stack to 0G Galileo testnet (16602) and writes
# deployments/16602.json. Refuses to guess anything it should be told.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}"
EXPECTED_CHAIN_ID=16602

die() { echo "✗ $1" >&2; exit 1; }

# ── preflight ────────────────────────────────────────────────────────────────
# Everything is checked BEFORE the first transaction. A deploy that fails halfway
# leaves a half-wired system on a public chain and burns funds getting there.

command -v forge >/dev/null || die "forge not on PATH"
command -v cast  >/dev/null || die "cast not on PATH"

[[ -n "${DEPLOYER_KEY:-}"   ]] || die "DEPLOYER_KEY is unset (a funded Galileo key)"
[[ -n "${TREASURY:-}"       ]] || die "TREASURY is unset — see DeployLib.resolveOperationalAddresses"
[[ -n "${CURATOR_SIGNER:-}" ]] || die "CURATOR_SIGNER is unset — the only key that can approve a market"

# The two addresses a real deployment most needs to be deliberate about. On anvil the
# script may fall back to the deployer; here it may not, and this is the friendlier
# half of that refusal — it fires before any gas is spent.
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"
if [[ "${TREASURY,,}" == "${DEPLOYER,,}" ]]; then
  echo "⚠  TREASURY is the deployer itself. Intended? (Ctrl-C to stop, Enter to continue)"; read -r
fi
if [[ "${CURATOR_SIGNER,,}" == "${DEPLOYER,,}" ]]; then
  echo "⚠  CURATOR_SIGNER is the deployer itself. Intended? (Ctrl-C to stop, Enter to continue)"; read -r
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] \
  || die "RPC reports chain $CHAIN_ID, expected $EXPECTED_CHAIN_ID — wrong endpoint"

BALANCE="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
# ~18M gas for seven contracts plus the configuration transactions, with headroom.
MIN_WEI=$(( 25000000 * $(cast gas-price --rpc-url "$RPC") ))
if (( BALANCE < MIN_WEI )); then
  die "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") 0G; needs about $(cast from-wei "$MIN_WEI")"
fi

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
  echo "⚠  working tree is dirty — the manifest will not correspond to a commit."
  echo "   (Ctrl-C to stop, Enter to continue)"; read -r
fi

echo "▶ chain        $CHAIN_ID via $RPC"
echo "▶ deployer     $DEPLOYER ($(cast from-wei "$BALANCE") 0G)"
echo "▶ treasury     $TREASURY"
echo "▶ curator      $CURATOR_SIGNER"
echo "▶ commit       $(git -C "$ROOT" rev-parse --short HEAD)"

# ── deploy ───────────────────────────────────────────────────────────────────
cd "$ROOT/contracts"
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  -vv

echo ""
echo "▶ manifest:"
cat "$ROOT/deployments/${EXPECTED_CHAIN_ID}.json"
echo ""
echo "Next: verify the sources on chainscan, which is a separate step because the"
echo "verifier is Blockscout rather than Etherscan and takes its own flags:"
echo "  forge verify-contract <address> <Contract> \\"
echo "    --chain-id $EXPECTED_CHAIN_ID --verifier blockscout \\"
echo "    --verifier-url https://chainscan-galileo.0g.ai/api"
