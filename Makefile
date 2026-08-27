.PHONY: build test fmt fmt-check prod invariant vectors demo clean

build:      ; cd contracts && forge build
prod:       ; cd contracts && FOUNDRY_PROFILE=prod forge build
test:       ; cd contracts && forge test -vv && npm test --workspaces --if-present
fmt:        ; cd contracts && forge fmt
fmt-check:  ; cd contracts && forge fmt --check
invariant:  ; cd contracts && FOUNDRY_PROFILE=ci forge test --match-path 'test/invariant/*' -vv
vectors:    ; npm run gen:vectors
demo:       ; bash scripts/demo-local.sh
clean:      ; cd contracts && forge clean
