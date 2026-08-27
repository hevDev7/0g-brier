# 0G-Delphi — repo conventions

Agent-native binary prediction market on 0G Chain. DPM (Pennock) pricing, an AI
resolver committee, and a strict separation between the human web UI and the agent SDK.

## Language

**English, throughout.** Comments, NatSpec, JSDoc, test descriptions, user-facing copy,
documentation, and commit messages. Locale formatting is `en-US`.

This is a change of convention: the project was written in Indonesian until
2026-08-27 and converted wholesale. If you find an Indonesian comment or string, it was
missed — translate it, don't match it.

## The three rules that are easiest to get wrong

**Probability is `pᵢ²`, not `pᵢ`.** `DPMMath.price` returns the marginal price
`pᵢ = qᵢ/C(q)`. The implied probability is its square, because `Σpᵢ² = WAD`. Anything
labelled with a percent sign comes from `dpm.probability`; a marginal price labelled as a
percentage is wrong by up to about five points at ordinary skew.

**Payout per share is `1/pᵢ`, not `1/Pᵢ`.** This one shipped in the spec once and was
corrected. At `P = 59%` the payout is `1.30×`; `1/P` would say `1.69×`. At `P = 10%` it is
`3.16×` against `1/P`'s `10.0×`. There must be no `1/probability` anywhere in the codebase.

**Dust bounds scale with `q`; they are never constants.** Three separate defects in this
project came from a guessed tolerance. If you need a rounding tolerance, derive it in
closed form from the live `q` and say where it comes from. The one genuine exception is
`Σ probability == WAD ± 2`, and only because the algebra makes it exactly constant.

## Structural boundaries

- **The human UI only observes.** `DataSource` has no method that writes to the chain and
  the frontend holds no signer. Every buy, sell, redeem, and liquidate goes through the
  agent SDK. A test enforces this; it is not a convention.
- **`unavailable` is a first-class `Query<T>` status**, alongside loading, ready, and
  error. The UI must never render `0` or `—` for something the current mode genuinely
  cannot know. TypeScript refuses to compile a consumer that forgets the case — provided
  the `switch` has an explicit non-nullable return type and no `default`.
- **`packages/protocol` is the TypeScript mirror of the Solidity DPM library**, pinned to
  it by a 512-vector differential test. Adding modules is fine; changing its arithmetic or
  its import conventions is not, absent evidence of a concrete failure.
- **Rounding always favours the pool**: money in uses `ceilDiv`, money out uses floor
  division, and `poolWad` is always `costUp`.
- **Pause never blocks an exit.** `sell`, `redeem`, and `liquidate` must succeed while
  paused. This is tested, not assumed.

## Two testing traps this project has paid for repeatedly

- **`getByText` joins only an element's *direct* text nodes** and does not descend into
  children, so a phrase split across elements will never match. `toHaveTextContent` reads
  recursively and is safe. This has caused four separate failures here.
- **`vm.expectRevert` binds to the very next external call.** It has been consumed twice by
  an unrelated call — once by an inline view in an assertion's arguments, once by the
  `CREATE` inside `Clones.clone`. Hoist arguments to locals, and bind the selector, never
  a bare `vm.expectRevert()`.

## Layout

```
contracts/          Foundry — Solidity 0.8.28, evm_version cancun, OpenZeppelin 5.4.0
packages/protocol/  TS mirror of the DPM math, units, network and deployment helpers
frontend/           Next.js 16 App Router, Tailwind v4 (CSS-first, no JS config)
docs/superpowers/   specs (the authority) and implementation plans (the argument)
```

`make demo` deploys the full stack to a local anvil and writes `deployments/31337.json`.
