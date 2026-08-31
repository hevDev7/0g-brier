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

# `.env.mainnet` wins over `.env`, and that separation is deliberate: the Galileo
# `.env` holds a deployer key that was burned into a transcript, and a mainnet key
# has no business sitting in the same file as one that must never touch this chain.
# Keeping them apart also means the testnet tooling keeps working untouched.
# .env.mainnet wins over .env so that mainnet keys never sit beside the testnet
# ones. ENV_FILE overrides both, which is how the checks below get exercised
# against a synthetic config without touching the real file.
if [[ -z "${ENV_FILE:-}" ]]; then
  ENV_FILE="$ROOT/.env"
  [[ -f "$ROOT/.env.mainnet" ]] && ENV_FILE="$ROOT/.env.mainnet"
fi
if [[ -f "$ENV_FILE" ]]; then
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '')"
  if [[ -n "$perms" && "${perms:1}" != "00" ]]; then
    echo "⚠  $ENV_FILE is mode $perms — it holds a private key. chmod 600 it."
  fi
  _pre_env="$(export -p)"
  set -a; . "$ENV_FILE"; set +a
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

# THE ONE PAIR THAT MUST AGREE. CURATOR_SIGNER is the address the contract checks
# a signature against; CURATOR_KEY is what produces that signature. Nothing
# reconciles them at deploy time — a mismatch surfaces at createMarket as
# BadCuratorSignature, after the curator has already signed and the creator has
# already paid for the attempt. Checked here, where it costs one derivation.
if [[ -n "${CURATOR_KEY:-}" ]]; then
  CK="$CURATOR_KEY"
  [[ "$CK" =~ ^[0-9a-fA-F]{64}$ ]] && CK="0x$CK"
  [[ "$CK" =~ ^0x[0-9a-fA-F]{64}$ ]] || die "CURATOR_KEY is set but is not a 32-byte hex key."
  CURATOR_FROM_KEY="$(cast wallet address --private-key "$CK")"
  if [[ "${CURATOR_FROM_KEY,,}" != "${CURATOR_SIGNER,,}" ]]; then
    # Two wallets, not one. Both remedies are legitimate and they are not the same
    # decision: the first puts the curator's power on THIS machine, the second keeps
    # it on whatever wallet already holds CURATOR_SIGNER.
    die "CURATOR_SIGNER and CURATOR_KEY are different wallets.
    CURATOR_SIGNER  $CURATOR_SIGNER
    CURATOR_KEY is  $CURATOR_FROM_KEY
  The contract checks every market-creation signature against CURATOR_SIGNER, so as
  written no market could ever be created. Pick one:
    (a) set CURATOR_SIGNER=$CURATOR_FROM_KEY — the curator becomes the key held here;
    (b) put the private key for $CURATOR_SIGNER in CURATOR_KEY, if that wallet is the
        one you meant to hold the power to approve markets.
  CURATOR_SIGNER is the whole of your exposure control: no market exists without it."
  fi
else
  echo "⚠  CURATOR_KEY is not set. The deploy does not need it, but no market can be created until whoever holds CURATOR_SIGNER signs an approval."
fi

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

# ── RESOLVER: refused on mainnet, and refused HERE rather than in forge ──────
# Deploy.s.sol requires `block.chainid != MAINNET_CHAIN_ID` when RESOLVER is set,
# because a direct-settlement resolver is a key that can settle any market to any
# outcome without a committee. That guard is correct, but it fires deep inside the
# simulation, minutes in, as a require string. Catching it here costs nothing and
# says what to do about it.
if [[ -n "${RESOLVER:-}" ]]; then
  die "RESOLVER is set to ${RESOLVER}, and mainnet refuses a direct-settlement resolver.
  That address could settle any market to any outcome on its own signature, with no
  committee, no commit-reveal and no dispute round. It exists for local demos.
  Leave RESOLVER empty; the committee is what settles markets on mainnet."
fi

# GOVERNANCE_KEY is not needed to deploy and is not wanted on this machine. Say so
# once, without refusing — the choice is the operator's, but it should be a choice.
if [[ -n "${GOVERNANCE_KEY:-}" ]]; then
  GK="$GOVERNANCE_KEY"
  [[ "$GK" =~ ^[0-9a-fA-F]{64}$ ]] && GK="0x$GK"
  [[ "$GK" =~ ^0x[0-9a-fA-F]{64}$ ]] || die "GOVERNANCE_KEY is set but is not a 32-byte hex key."
  GOV_FROM_KEY="$(cast wallet address --private-key "$GK")"
  # The timelock grants PROPOSER and EXECUTOR to the GOVERNANCE address and to nothing
  # else, and handover.sh signs with GOVERNANCE_KEY. A key for a different wallet is
  # not a second governance — it is no governance, and you find out at `handover.sh
  # schedule`, which is AFTER the deploy. Recoverable, because the deployer still owns
  # everything until the cliff closes, but it is the worst moment to discover it.
  if [[ "${GOV_FROM_KEY,,}" != "${GOVERNANCE,,}" ]]; then
    die "GOVERNANCE and GOVERNANCE_KEY are different wallets.
    GOVERNANCE      $GOVERNANCE
    GOVERNANCE_KEY  $GOV_FROM_KEY
  Only GOVERNANCE holds the timelock's proposer and executor roles, so the handover
  signed by this key would be rejected. Either set GOVERNANCE=$GOV_FROM_KEY, or clear
  GOVERNANCE_KEY and hand over with 'handover.sh --unsigned' from the wallet that
  actually is $GOVERNANCE."
  fi
  echo "⚠  GOVERNANCE_KEY is set and matches GOVERNANCE. The deploy does not use it, and"
  echo "   handover.sh can print unsigned calldata for a multisig instead (--unsigned)."
  echo "   A governance key held as a hot key on a build machine owns every upgradeable"
  echo "   contract after the cliff closes; the 48-hour timelock is then the only thing"
  echo "   between a stolen key and the protocol."
fi

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
#
# `python3`, NOT `$(( ))`, and this is not caution — it is a bug this check HAD.
# Bash arithmetic is 64-bit signed and stops at 9223372036854775807, which is 9.22
# 0G in wei. A deployer holding 12.3 0G read as -6145183701597500030 and was told
# it needed 0.18, so the check refused every deployer funded well enough to use it
# and passed the ones that were nearly empty. Observed on 2026-09-01 against a real
# .env.mainnet. The same overflow was found and fixed in setup-committee.sh the day
# before; this is the second place it lived.
MIN_WEI=$(python3 -c "print(45000000 * $(cast gas-price --rpc-url "$RPC"))")
if [ "$(python3 -c "print(1 if $BALANCE < $MIN_WEI else 0)")" = "1" ]; then
  die "deployer $DEPLOYER holds $(cast from-wei "$BALANCE") 0G; needs about $(cast from-wei "$MIN_WEI")"
fi

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
  die "working tree is dirty. A mainnet manifest must correspond to a commit you can point at."
fi

# Echo a money parameter in WHOLE TOKENS. The env values are raw base units, which
# is unambiguous for a machine and easy to get wrong by three digits for a person;
# printing them back scaled is what turns a wrong exponent into something seen
# before the broadcast rather than found after it.
money(){
  local raw="${!1:-}" fallback="$2"
  if [[ -z "$raw" || "$raw" == "0" ]]; then
    echo "$fallback $SYM (default)"
  elif [[ ! "$raw" =~ ^[0-9]+$ ]]; then
    die "$1 must be a whole number in ${SYM}'s base units, not '$raw'."
  else
    printf '%s %s\n' "$(python3 -c "print(f'{$raw/10**$DEC:,.6f}'.rstrip('0').rstrip('.'))")" "$SYM"
  fi
}
# What building the committee actually costs: setup-committee.sh stakes twice the
# floor per member, and a disputed VERIFIED market needs fourteen.
roster(){
  local raw="${MIN_RESOLVER_STAKE:-}"
  [[ -z "$raw" || "$raw" == "0" ]] && raw="$(python3 -c "print(100 * 10**$DEC)")"
  python3 -c "print(f'{$raw * 2 * 14/10**$DEC:,.2f}')"
}

cat <<EOF

▶ chain        $CHAIN_ID via $RPC
▶ commit       $(git -C "$ROOT" rev-parse --short HEAD)  ($(git -C "$ROOT" describe --tags --always 2>/dev/null || echo 'no tag'))
▶ env file     $ENV_FILE
▶ deployer     $DEPLOYER ($(cast from-wei "$BALANCE") 0G)
▶ collateral   $COLLATERAL  $SYM, $DEC decimals
▶ money        stake $(money MIN_RESOLVER_STAKE 100) · bond $(money DISPUTE_BOND 50)
               seed $(money MIN_SEED 100) · deposit $(money MIN_SETTLEMENT_DEPOSIT 20)
               min trade $(money MIN_TRADE_TOKENS 1) · roster of 14 locks $(roster) $SYM
               (read these: they are policy, not plumbing, and a $SYM is not a dollar)
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
