/**
 * The reads the human UI performs, and nothing else.
 *
 * Hand-written rather than generated from Foundry artifacts, and deliberately
 * incomplete: not one entry is state-changing. Nothing that opens, closes or
 * unwinds a position appears, so the frontend could not send such a call even if
 * a component tried — an ABI that cannot describe a transaction cannot submit
 * one. The write boundary (spec §1 F3) is a property of what this file contains,
 * not only of what `DataSource` exposes.
 *
 * The four exit and entry verbs are paraphrased rather than named, as they are in
 * `types.ts`: `write-boundary.test.ts` greps every file in this directory for
 * those literal tokens, comments included, and a comment boasting about their
 * absence would trip it.
 */
export const FACTORY_ABI = [
  // The registry this factory obeys, so a client can find the AgentRegistry the same
  // way the contracts do rather than being told where to look by configuration that
  // could disagree with the chain.
  {type: "function", name: "config", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "marketAt",
    stateMutability: "view",
    inputs: [{name: "index", type: "uint256"}],
    outputs: [{type: "address"}],
  },
] as const;

export const MARKET_ABI = [
  {type: "function", name: "qArray", stateMutability: "view", inputs: [], outputs: [{type: "uint256[2]"}]},
  {type: "function", name: "poolWad", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  // The winner, and when it was decided. Both are plain public getters, so the
  // single most important fact about a settled market needs no indexer and no
  // 0G Storage document — it was simply never asked for.
  {type: "function", name: "winningOutcome", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "resolvedAt", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  // The registry this market obeys. Reading it lets a client find the resolution
  // module the same way the contract does, rather than being told where to look
  // by a configuration value that could disagree with the chain.
  {type: "function", name: "config", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "tier", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {type: "function", name: "category", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "tradingEnd", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {type: "function", name: "settlementDeadline", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {type: "function", name: "collateral", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
  {type: "function", name: "specRoot", stateMutability: "view", inputs: [], outputs: [{type: "bytes32"}]},
  {type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{type: "uint16"}]},
] as const;

export const ERC20_ABI = [
  {type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{type: "string"}]},
  {type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{type: "uint8"}]},
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
] as const;

/**
 * The two events history is rebuilt from.
 *
 * `Trade` carries `probAfter` because the contract puts it there on purpose — its
 * NatSpec says so — "so that an indexer can reconstruct the probability curve
 * without a single historical eth_call". That one field is why a price chart
 * needs no archive node and no state replay: the curve is already in the log.
 */
export const TRADE_EVENT = {
  type: "event",
  name: "Trade",
  inputs: [
    {name: "trader", type: "address", indexed: true},
    {name: "recipient", type: "address", indexed: true},
    {name: "outcome", type: "uint8", indexed: true},
    {name: "sharesDelta", type: "int256", indexed: false},
    {name: "tokens", type: "uint256", indexed: false},
    {name: "fee", type: "uint256", indexed: false},
    {name: "qAfter", type: "uint256[2]", indexed: false},
    {name: "probAfter", type: "uint256", indexed: false},
  ],
} as const;

/** Its block is the only place a market's creation time exists. */
export const MARKET_CREATED_EVENT = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    {name: "market", type: "address", indexed: true},
    {name: "creator", type: "address", indexed: true},
    {name: "creatorAgentId", type: "uint256", indexed: true},
    {name: "specRoot", type: "bytes32", indexed: false},
    {name: "seed", type: "uint256", indexed: false},
    {name: "tier", type: "uint8", indexed: false},
  ],
} as const;

/** The one lookup a client needs from ConfigRegistry. */
export const CONFIG_ABI = [
  {
    type: "function",
    name: "addresses",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [{type: "address"}],
  },
] as const;

/**
 * `ResolutionModule.resolutionOf` — the settlement receipt's 0G Storage root, and
 * the key that anchored it. A zero root means no receipt was anchored for this
 * market, which is a fact about the settlement rather than a gap in this client.
 */
export const RESOLUTION_ABI = [
  {
    type: "function",
    name: "resolutionOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "bytes32"}, {type: "address"}],
  },
  {
    // A committee settlement writes NO market-level receipt. `resolutionOf` is
    // filled only by the direct `settle`/`fail` path; `finalize` records one
    // root per resolver instead, because a committee produces one judgement per
    // member and collapsing them to a single document would throw away the very
    // independence the committee exists for. Reading them means asking who was
    // sampled, then asking each what they anchored.
    type: "function",
    name: "committeeOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256[]"}],
  },
  {
    type: "function",
    name: "receiptRootOf",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [{type: "bytes32"}],
  },
  {
    // What each member actually voted. `3` is `Outcomes.NONE` — not a vote, the
    // ABSENCE of one — and the contract stores reveals plus one precisely so that
    // "did not reveal" cannot be read as "voted NO". A page that collapsed the two
    // would accuse a resolver of a verdict it never gave.
    type: "function",
    name: "revealOf",
    stateMutability: "view",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [{type: "uint8"}],
  },
  {
    // Whether a COMMITTEE decided it, or one allowlisted key did. The module
    // keeps this flag so the shortcut cannot pass itself off as a committee, and
    // reading it is the only way a page can tell the two apart.
    type: "function",
    name: "viaCommittee",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "bool"}],
  },
] as const;

/**
 * `AgentRegistry.nameOfOperator` — the handle behind a key that signed a trade.
 *
 * A `Trade` event carries `msg.sender` and nothing else, so a name is only ever
 * reachable by going backwards from the key. Zero means the key acts for no
 * registered agent, which is a fact about that key and not a gap in this client.
 */
export const AGENT_REGISTRY_ABI = [
  {
    type: "function",
    name: "nameOfOperator",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "bytes32"}],
  },
] as const;
