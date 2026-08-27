#!/usr/bin/env bash
# Deploys the P0+P1 stack to 0G Galileo testnet (16602) and writes
# deployments/16602.json. Refuses to guess anything it should be told.
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

RPC="${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}"
EXPECTED_CHAIN_ID=16602

die() { echo "✗ $1" >&2; exit 1; }

# ── preflight ────────────────────────────────────────────────────────────────
# Everything is checked BEFORE the first transaction. A deploy that fails halfway
# leaves a half-wired system on a public chain and burns funds getting there.

command -v forge >/dev/null || die "forge not on PATH"
command -v cast  >/dev/null || die "cast not on PATH"

# Shape-checked, not merely non-empty: a `DEPLOYER_KEY=0x` left over from the
# template is non-empty and would sail past a `-n` test, then fail further down
# inside `cast` with "Failed to decode private key", which names neither the
# variable nor the file to fix.
[[ "${DEPLOYER_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] \
  || die "DEPLOYER_KEY must be a 0x-prefixed 32-byte hex key — got ${#DEPLOYER_KEY} characters. Fill it in $ROOT/.env"
[[ -n "${TREASURY:-}"       ]] || die "TREASURY is unset — see DeployLib.resolveOperationalAddresses"
[[ -n "${CURATOR_SIGNER:-}" ]] || die "CURATOR_SIGNER is unset — the only key that can approve a market"

# The two addresses a real deployment most needs to be deliberate about. On anvil the
# script may fall back to the deployer; here it may not, and this is the friendlier
# half of that refusal — it fires before any gas is spent.
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"

# Pointing all three at one key is a legitimate testnet setup and a bad mainnet
# one, so it is confirmed rather than refused. `ASSUME_YES=1` is the
# non-interactive escape hatch: without it, `read` at EOF returns non-zero and
# `set -e` would abort a piped or CI run for the wrong reason.
confirm() {
  echo "⚠  $1"
  if [[ "${ASSUME_YES:-}" == "1" ]]; then echo "   ASSUME_YES=1 — continuing."; return 0; fi
  echo "   Ctrl-C to stop, Enter to continue."
  read -r || die "no terminal to confirm on; re-run with ASSUME_YES=1 if this is intended"
}
[[ "${TREASURY,,}"       == "${DEPLOYER,,}" ]] && confirm "TREASURY is the deployer itself."
[[ "${CURATOR_SIGNER,,}" == "${DEPLOYER,,}" ]] && confirm "CURATOR_SIGNER is the deployer itself."

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
