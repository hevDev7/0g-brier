#!/usr/bin/env bash
# Deploys the P0+P1 stack to 0G Galileo testnet (16602) and writes
# deployments/16602.json. Refuses to guess anything it should be told.
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

RPC="${ZERO_G_TESTNET_RPC:-https://evmrpc-testnet.0g.ai}"
EXPECTED_CHAIN_ID=16602

die() { echo "✗ $1" >&2; exit 1; }

# ── preflight ────────────────────────────────────────────────────────────────
# Everything is checked BEFORE the first transaction. A deploy that fails halfway
# leaves a half-wired system on a public chain and burns funds getting there.

command -v forge >/dev/null || die "forge not on PATH"
command -v cast  >/dev/null || die "cast not on PATH"

# Wallets export a key with and without the prefix, and both are the same key —
# `cast` accepts either. `forge`'s `vm.envUint` does not: without `0x` it parses
# the string as DECIMAL, so an all-digit key would silently become a different
# one rather than fail. Normalise here, once, before anything reads it.
if [[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  DEPLOYER_KEY="0x${DEPLOYER_KEY}"; export DEPLOYER_KEY
fi
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
# python3, not $(( )): bash arithmetic is 64-bit signed and tops out at 9.22 0G in
# wei, so a well-funded deployer read as a negative number and was refused. The
# mainnet wrapper had the identical bug, found 2026-09-01 on a deployer holding
# 12.3 0G.
MIN_WEI=$(python3 -c "print(25000000 * $(cast gas-price --rpc-url "$RPC"))")
if [ "$(python3 -c "print(1 if $BALANCE < $MIN_WEI else 0)")" = "1" ]; then
  die "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") 0G; needs about $(cast from-wei "$MIN_WEI")"
fi

# Through `confirm`, like the role checks above: a bare `read -r` here ignored
# ASSUME_YES, so the one gate meant to be skippable in CI was the one that hung.
if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
  confirm "working tree is dirty — the manifest will not correspond to a commit."
fi

echo "▶ chain        $CHAIN_ID via $RPC"
echo "▶ deployer     $DEPLOYER ($(cast from-wei "$BALANCE") 0G)"
echo "▶ treasury     $TREASURY"
echo "▶ curator      $CURATOR_SIGNER"
echo "▶ commit       $(git -C "$ROOT" rev-parse --short HEAD)"

# ── deploy ───────────────────────────────────────────────────────────────────
# The manifest is written from the SCRIPT BODY, which forge runs during
# simulation — before `--broadcast` sends anything. A send that fails therefore
# leaves deployments/<chain>.json pointing at addresses that were only ever
# simulated and hold no code. Observed on 2026-08-28: a gas-price rejection
# clobbered a working manifest without a single transaction landing.
MANIFEST="$ROOT/deployments/${EXPECTED_CHAIN_ID}.json"
if [[ -f "$MANIFEST" ]]; then
  BACKUP="$MANIFEST.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$MANIFEST" "$BACKUP"
  echo "▶ manifest backed up to $(basename "$BACKUP")"
fi

# Galileo prices the two halves of an EIP-1559 fee very differently, and the node
# must be asked for BOTH. The base fee is 7 wei — low enough to look like a chain
# that wants nothing — while eth_maxPriorityFeePerGas is 4 gwei. Forge's default
# tip is 1 wei, which the node rejects outright:
#   "transaction gas price below minimum: gas tip cap 1"
# So the tip is read from the node rather than assumed, and a chain that later
# raises it does not need this script edited.
# BOTH halves, or neither works. Setting only the tip leaves forge to derive
# maxFeePerGas from the 7-wei base fee, and the node then rejects the very tip it
# asked for: "max priority fee per gas higher than max fee per gas". The ceiling
# must cover the tip plus room for the base fee to move under us.
TIP="$(cast rpc eth_maxPriorityFeePerGas --rpc-url "$RPC" | tr -d '"')"
TIP=$((TIP))
BASE="$(cast base-fee --rpc-url "$RPC")"
MAXFEE=$(( TIP + BASE * 4 + 1000000000 ))
echo "▶ fees: tip $TIP wei, base $BASE wei, cap $MAXFEE wei (all read from the node)"

cd "$ROOT/contracts"
if ! forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --broadcast \
  --slow \
  --priority-gas-price "$TIP" \
  --with-gas-price "$MAXFEE" \
  -vv
then
  if [[ -n "${BACKUP:-}" ]]; then
    cp "$BACKUP" "$MANIFEST"
    echo "✗ deploy failed — manifest restored from $(basename "$BACKUP")" >&2
  fi
  exit 1
fi

echo ""
echo "▶ manifest:"
cat "$ROOT/deployments/${EXPECTED_CHAIN_ID}.json"
echo ""
echo "Next: verify the sources on chainscan, which is a separate step because the"
echo "verifier is Blockscout rather than Etherscan and takes its own flags:"
echo "  forge verify-contract <address> <Contract> \\"
echo "    --chain-id $EXPECTED_CHAIN_ID --verifier blockscout \\"
echo "    --verifier-url https://chainscan-galileo.0g.ai/api"
