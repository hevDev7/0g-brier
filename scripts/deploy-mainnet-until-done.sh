#!/usr/bin/env bash
# Resume the mainnet deploy until all of its transactions have landed.
#
#   bash scripts/deploy-mainnet-until-done.sh [max-attempts]
#
# WHY. 0G's RPC drops receipts for transactions it has already mined, and Foundry
# treats a dropped receipt as a failed run — so a 91-transaction deploy stops
# somewhere in the middle, having spent the gas and moved the nonce. Every attempt so
# far ended that way, at 8, 19, 21, 27 and 29 transactions, and every "failed"
# transaction was on chain with status 1.
#
# Resuming is safe and cumulative: forge replays the recorded sequence and sends only
# what never made it. So the remedy is not cleverness, it is persistence. This loops
# --resume until the wrapper exits 0, and stops the moment it does.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAX="${1:-40}"
BROADCAST="$ROOT/contracts/broadcast/Deploy.s.sol/16661/run-latest.json"

sent(){ python3 -c "
import json
try:
    d=json.load(open('$BROADCAST'))
    print(len([t for t in d.get('transactions',[]) if t.get('hash')]), len(d.get('transactions',[])))
except Exception: print(0,0)
"; }

for i in $(seq 1 "$MAX"); do
  read -r S T <<<"$(sent)"
  echo ""
  echo "── percobaan $i/$MAX — $S dari $T transaksi sudah mendarat ──"
  if ZERO_G_MAINNET_RPC="${ZERO_G_MAINNET_RPC:-http://127.0.0.1:8547}" \
     bash "$ROOT/scripts/deploy-mainnet.sh" --resume 2>&1 | tail -40; then
    echo ""
    echo "✓ selesai pada percobaan $i"
    exit 0
  fi
  read -r S2 T2 <<<"$(sent)"
  if [ "$S2" = "$S" ]; then
    echo "⚠  tidak ada kemajuan pada percobaan $i ($S -> $S2). Berhenti daripada membakar gas tanpa maju." >&2
    exit 1
  fi
done
echo "✗ masih belum selesai setelah $MAX percobaan." >&2
exit 1
