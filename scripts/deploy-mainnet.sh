#!/usr/bin/env bash
# Deploys Brier to 0G mainnet (16661) and writes deployments/16661.json.
#
#   bash scripts/deploy-mainnet.sh            # SIMULATE only. Sends nothing.
#   bash scripts/deploy-mainnet.sh --broadcast   # actually deploy
#
# Simulation is the DEFAULT, and that is the one difference from the Galileo
# script that matters. On a testnet a wrong deploy costs a redeploy; here the
# bounds set in the first transaction are permanent and the money is real, so
# sending has to be something you asked for rather than something you got.
set -euo pipefail
# Tracing off, and not negotiable. `cast` has no environment variable for a
# signing key — `--private-key` on the command line is the only way — so any
# shell tracing this script inherits expands that argument in full. It happened
# on 2026-08-30: a `bash -x` of the Galileo script put a deployer key that owned
# every protocol proxy into a session transcript. That key is why this file
# refuses it by address, below.
{ set +x; } 2>/dev/null

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_CHAIN_ID=16661
BROADCAST=""
[[ "${1:-}" == "--broadcast" ]] && BROADCAST=1

# The Galileo deployer, burned into a transcript on 2026-08-30. Refused by
# ADDRESS rather than by key, so it stays refused however the key is spelled —
# with or without the 0x, from the file or from the environment.
COMPROMISED="0x71a89a7e692dac4d6bd7c3f1cca9155592d87bae"

if [[ -f "$ROOT/.env" ]]; then
  perms="$(stat -c '%a' "$ROOT/.env" 2>/dev/null || echo '')"
  if [[ -n "$perms" && "${perms:1}" != "00" ]]; then
    echo "⚠  $ROOT/.env is mode $perms — it holds a private key. chmod 600 it."
  fi
  _pre_env="$(export -p)"
  set -a; . "$ROOT/.env"; set +a
  eval "$_pre_env" 2>/dev/null || true
  unset _pre_env
fi

RPC="${ZERO_G_MAINNET_RPC:-https://evmrpc.0g.ai}"
die() { echo "✗ $1" >&2; exit 1; }

command -v forge >/dev/null || die "forge not on PATH"
command -v cast  >/dev/null || die "cast not on PATH"

# ── the key ──────────────────────────────────────────────────────────────────
if [[ "${DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  DEPLOYER_KEY="0x${DEPLOYER_KEY}"; export DEPLOYER_KEY
fi
[[ "${DEPLOYER_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]] \
  || die "DEPLOYER_KEY must be a 0x-prefixed 32-byte hex key — got ${#DEPLOYER_KEY} characters."
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"
[[ "${DEPLOYER,,}" == "$COMPROMISED" ]] \
  && die "that is the COMPROMISED Galileo deployer ($DEPLOYER). It was printed into a transcript on 2026-08-30 and must never touch mainnet. Generate a fresh key."

# ── the four roles ───────────────────────────────────────────────────────────
# DeployLib.resolveRoles refuses all of this too, and refusing it twice is the
# point: there it costs a simulation, here it costs nothing and names the
# variable rather than a Solidity selector.
for v in GOVERNANCE GUARDIAN TREASURY CURATOR_SIGNER; do
  [[ -n "${!v:-}" ]] || die "$v is unset. Mainnet requires all four roles, and none may be the deployer."
  [[ "${!v}" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "$v is not an address: ${!v}"
  [[ "${!v,,}" == "${DEPLOYER,,}" ]] && die "$v is the deployer itself. On mainnet that is refused: the deployer's power must end at the handover."
done
[[ "${GOVERNANCE,,}" == "${GUARDIAN,,}" ]] \
  && die "GOVERNANCE and GUARDIAN are the same address. A guardian that is also governance can pause the protocol AND rewrite the rules under it, which is the concentration the split exists to prevent."

# ── the collateral ───────────────────────────────────────────────────────────
# There is no fallback here on purpose. On anvil the deploy script mints a
# MockUSDC; on mainnet a mock stablecoin is not a smaller version of the real
# thing, it is a market whose collateral anyone can print.
[[ -n "${COLLATERAL:-}" ]] \
  || die "COLLATERAL is unset. Mainnet has no default — name the token this deployment settles in."
[[ "${COLLATERAL}" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "COLLATERAL is not an address: ${COLLATERAL}"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] \
  || die "RPC reports chain $CHAIN_ID, expected $EXPECTED_CHAIN_ID — wrong endpoint. Set ZERO_G_MAINNET_RPC."

# Checked against the CHAIN, not against a token list. An address copied from a
# testnet or another network is the most common way this goes wrong, and it
# fails at `Market.initialize` long after the deploy looked successful.
[[ -n "$(cast code "$COLLATERAL" --rpc-url "$RPC")" && "$(cast code "$COLLATERAL" --rpc-url "$RPC")" != "0x" ]] \
  || die "COLLATERAL $COLLATERAL has NO CODE on chain $CHAIN_ID. That is not a token here."
DEC="$(cast call "$COLLATERAL" 'decimals()(uint8)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')" \
  || die "COLLATERAL does not answer decimals() — Market.initialize calls it and will revert."
[[ -n "$DEC" ]] || die "COLLATERAL does not answer decimals()."
(( DEC <= 18 )) || die "COLLATERAL reports $DEC decimals. Market refuses anything above 18 (UnsupportedDecimals)."
SYM="$(cast call "$COLLATERAL" 'symbol()(string)' --rpc-url "$RPC" 2>/dev/null | tr -d '"' || echo '?')"

# ── ERC-8004, which is optional but must be deliberate ───────────────────────
# Until 2026-08-31 these were wired only by an upgrade script, so every fresh
# deployment was born with reputation publishing silently off. Deploy.s.sol sets
# them now; this makes the choice visible rather than defaulted.
if [[ -n "${ERC8004_IDENTITY:-}" || -n "${ERC8004_REPUTATION:-}" ]]; then
  for v in ERC8004_IDENTITY ERC8004_REPUTATION; do
    [[ -n "${!v:-}" ]] || die "$v is unset while the other is set. Wire both or neither."
    C="$(cast code "${!v}" --rpc-url "$RPC")"
    [[ -n "$C" && "$C" != "0x" ]] || die "$v ${!v} has no code on chain $CHAIN_ID."
    # Code is not enough. On 0G mainnet both canonical ERC-8004 addresses hold an
    # ERC-1967 proxy with an EMPTY implementation slot: 130 bytes of bytecode and
    # every call through it reverts. `name()` is the cheapest proof that anything
    # is actually behind the address.
    cast call "${!v}" 'name()(string)' --rpc-url "$RPC" >/dev/null 2>&1 \
      || die "$v ${!v} has code but answers nothing — an uninitialised proxy. Leave both ERC8004_* unset rather than wiring a dead registry."
  done
  ERC8004_NOTE="$ERC8004_IDENTITY / $ERC8004_REPUTATION"
else
  ERC8004_NOTE="NOT SET — reputation publishing will be off, permanently unless governance sets it later"
fi

BALANCE="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
# 45M gas, not the 25M the Galileo script uses. MEASURED, not guessed: a dry run
# of Deploy.s.sol against live 16661 state on 2026-08-31 estimated 36,787,692 gas
# — 0.1472 0G at the 4 gwei the node was quoting. The 25M inherited from the
# testnet wrapper would have waved through a deployer that runs dry two thirds of
# the way in, which on this chain means a half-wired protocol and a manifest
# pointing at contracts that were never configured.
MIN_WEI=$(( 45000000 * $(cast gas-price --rpc-url "$RPC") ))
(( BALANCE >= MIN_WEI )) \
  || die "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") 0G; needs about $(cast from-wei "$MIN_WEI")"

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
  die "working tree is dirty. A mainnet manifest must correspond to a commit you can point at."
fi

cat <<EOF

▶ chain        $CHAIN_ID via $RPC
▶ commit       $(git -C "$ROOT" rev-parse --short HEAD)  ($(git -C "$ROOT" describe --tags --always 2>/dev/null || echo 'no tag'))
▶ deployer     $DEPLOYER ($(cast from-wei "$BALANCE") 0G)
▶ collateral   $COLLATERAL  $SYM, $DEC decimals
▶ governance   $GOVERNANCE
▶ guardian     $GUARDIAN
▶ treasury     $TREASURY
▶ curator      $CURATOR_SIGNER
▶ erc-8004     $ERC8004_NOTE
▶ timelock     ${TIMELOCK_DELAY:-172800} s

EOF

if [[ -z "$BROADCAST" ]]; then
  echo "▶ SIMULATING. Nothing will be sent. Re-run with --broadcast to deploy."
  echo ""
fi

MANIFEST="$ROOT/deployments/${EXPECTED_CHAIN_ID}.json"
if [[ -n "$BROADCAST" && -f "$MANIFEST" ]]; then
  BACKUP="$MANIFEST.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$MANIFEST" "$BACKUP"
  echo "▶ manifest backed up to $(basename "$BACKUP")"
fi

# Both halves of the fee, read from the node. See the note in deploy-galileo.sh:
# 0G prices base fee and priority fee very differently and forge's defaults are
# rejected outright.
TIP="$(cast rpc eth_maxPriorityFeePerGas --rpc-url "$RPC" | tr -d '"')"; TIP=$((TIP))
BASE="$(cast base-fee --rpc-url "$RPC")"
MAXFEE=$(( TIP + BASE * 4 + 1000000000 ))
echo "▶ fees: tip $TIP wei, base $BASE wei, cap $MAXFEE wei (all read from the node)"

cd "$ROOT/contracts"
set +e
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  ${BROADCAST:+--broadcast} \
  --slow \
  --priority-gas-price "$TIP" \
  --with-gas-price "$MAXFEE" \
  -vv
STATUS=$?
set -e

if (( STATUS != 0 )); then
  if [[ -n "${BACKUP:-}" ]]; then
    cp "$BACKUP" "$MANIFEST"
    echo "✗ deploy failed — manifest restored from $(basename "$BACKUP")" >&2
  fi
  exit "$STATUS"
fi

if [[ -z "$BROADCAST" ]]; then
  echo ""
  echo "✓ simulation succeeded. Nothing was sent."
  echo "  Re-run with --broadcast when the addresses above are the ones you mean."
  exit 0
fi

echo ""
echo "▶ manifest:"
cat "$MANIFEST"
cat <<EOF

NOW READ docs/mainnet-runbook.md STEP 4. Ownership has NOT moved: transferOwnership
is the first half of an Ownable2Step handover, and until governance executes
acceptOwnership on each contract the deployer still controls all of them. Every
owner-only act is cheap during that window and costs 48 hours after it — the
categories beyond the six, the resolver allowlist, and staking enough resolvers
to form a committee.

Then: bash scripts/handover.sh status
EOF
