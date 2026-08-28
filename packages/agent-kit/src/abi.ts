/**
 * The Market surface an agent needs — reads, on-chain quotes, and the four
 * verbs the human UI is forbidden to touch.
 *
 * Deliberately a DIFFERENT file from `frontend/src/lib/data/abi.ts`, which
 * carries only views. That separation is the write boundary (spec §1 F3) made
 * structural: the frontend's own test greps its data directory for these names,
 * so the ABI that can spend money cannot drift into the page that must not.
 */
export const MARKET_ABI = [
  // ── lifecycle, for an operator rather than a trader ──────────────────────
  // Both are permissionless by design: `close` once trading has ended, and
  // `fail` once the settlement deadline has passed. A market nobody can advance
  // is a market where every position is stuck, so the protocol lets anybody
  // advance it. See `examples/keeper.ts`.
  {type: "function", name: "close", stateMutability: "nonpayable", inputs: [], outputs: []},
  {type: "function", name: "fail", stateMutability: "nonpayable", inputs: [], outputs: []},
  {type: "function", name: "settlementDeadline", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {type: "function", name: "qArray", stateMutability: "view", inputs: [], outputs: [{type: "uint256[2]"}]},
  {type: "function", name: "poolWad", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "tier", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "category", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "tradingEnd", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {type: "function", name: "collateral", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "specRoot", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{type: "uint16"}]},
  {type: "function", name: "winningOutcome", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "resolvedAt", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {
    type: "function",
    name: "probability",
    stateMutability: "view",
    inputs: [{type: "uint8"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{type: "uint8"}, {type: "uint256"}],
    outputs: [{name: "tokensIn", type: "uint256"}, {name: "fee", type: "uint256"}],
  },
  {
    type: "function",
    name: "quoteBuySpend",
    stateMutability: "view",
    inputs: [{type: "uint8"}, {type: "uint256"}],
    outputs: [{name: "sharesOut", type: "uint256"}, {name: "fee", type: "uint256"}],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{type: "uint8"}, {type: "uint256"}],
    outputs: [{name: "tokensOut", type: "uint256"}, {name: "fee", type: "uint256"}],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{type: "uint8"}, {type: "uint256"}, {type: "uint256"}, {type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{type: "uint8"}, {type: "uint256"}, {type: "uint256"}, {type: "address"}],
    outputs: [{type: "uint256"}],
  },
  // Seed shares are held by the MARKET, not by OutcomeShares, and `redeem` pays
  // for them alongside the tradable position. A client that reads only
  // `balanceOfOutcome` sees a fraction of what it is about to be paid for.
  {
    type: "function",
    name: "seedSharesOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256[2]"}],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
] as const;

export const FACTORY_ABI = [
  {type: "function", name: "config", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "marketAt",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [{type: "address"}],
  },
] as const;

export const ERC20_ABI = [
  {type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{type: "string"}]},
  {type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [{type: "bool"}],
  },
] as const;

export const SHARES_ABI = [
  {
    type: "function",
    name: "balanceOfOutcome",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "address"}, {type: "uint8"}],
    outputs: [{type: "uint256"}],
  },
] as const;

export const CONFIG_ABI = [
  {
    type: "function",
    name: "addresses",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [{type: "address"}],
  },
  {
    type: "function",
    name: "params",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [{type: "uint256"}],
  },
] as const;

/**
 * `AgentRegistry` — identity, and the reverse index that makes a trade attributable.
 *
 * Registration is PERMISSIONLESS. Anyone can mint an agent for themselves, which is
 * the point: an identity here is a handle the protocol can show, not a licence
 * somebody grants. What it costs is a name nobody else has taken.
 */
export const AGENT_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{type: "uint8"}, {type: "address"}, {type: "bytes32"}, {type: "bytes32"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "setName",
    stateMutability: "nonpayable",
    inputs: [{type: "uint256"}, {type: "bytes32"}],
    outputs: [],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [{type: "uint256"}, {type: "address"}],
    outputs: [],
  },
  {type: "function", name: "agentOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]},
  {type: "function", name: "nameOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "bytes32"}]},
  {type: "function", name: "roleOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "uint8"}]},
  {type: "function", name: "nextAgentId", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "metadataRootOf", stateMutability: "view", inputs: [{type: "uint256"}], outputs: [{type: "bytes32"}]},
  {
    // The `proof` argument is the ERC-7857 hook and is ignored in v1 (spec §8.5);
    // it is in the signature so that P7 verification is a behaviour change rather
    // than an interface break.
    type: "function",
    name: "updateMetadata",
    stateMutability: "nonpayable",
    inputs: [{type: "uint256"}, {type: "bytes32"}, {type: "bytes"}],
    outputs: [],
  },
  {
    type: "function",
    name: "nameTaken",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [{type: "bool"}],
  },
] as const;
