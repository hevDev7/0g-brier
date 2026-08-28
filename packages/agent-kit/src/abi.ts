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
