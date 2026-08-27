import {ChainSource} from "./chain";
import {LogSource} from "./logs";
import {MockSource} from "./mock";
import type {DataMode, DataSource} from "./types";

/**
 * F0 had only MockSource. `chain` lands here in F2; `indexer` (F4) will WRAP
 * ChainSource rather than duplicate it, which makes "state always comes from the
 * chain" a structural property rather than a promise.
 */

/**
 * Read as whole literals, never as `process.env[name]`. Next inlines
 * `NEXT_PUBLIC_*` at build time by substituting the exact expression it finds in
 * the source, so a computed lookup compiles to `undefined` in the browser while
 * working perfectly in a Node test — the worst possible split.
 */
function chainConfig() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID;
  const factory = process.env.NEXT_PUBLIC_MARKET_FACTORY;
  const fromBlock = process.env.NEXT_PUBLIC_FROM_BLOCK;
  const zgIndexer = process.env.NEXT_PUBLIC_ZG_INDEXER;

  const missing = [
    rpcUrl ? null : "NEXT_PUBLIC_RPC_URL",
    chainId ? null : "NEXT_PUBLIC_CHAIN_ID",
    factory ? null : "NEXT_PUBLIC_MARKET_FACTORY",
  ].filter((name): name is string => name !== null);

  // Failing at construction, by name, rather than letting the first `eth_call`
  // fail somewhere inside a panel where it would read as "the chain is down".
  if (missing.length > 0) {
    throw new Error(`DATA_MODE=chain needs ${missing.join(", ")} — see .env.example`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(factory!)) {
    throw new Error(`NEXT_PUBLIC_MARKET_FACTORY is not an address: ${factory}`);
  }
  const id = Number(chainId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`NEXT_PUBLIC_CHAIN_ID is not a chain id: ${chainId}`);
  }
  return {
    rpcUrl: rpcUrl!,
    chainId: id,
    factory: factory as `0x${string}`,
    // Absent means "from the beginning". Defensible only because a missing lower
    // bound scans wider than necessary, whereas a wrong one drops the events
    // below it and shows a market as having no history at all.
    fromBlock: fromBlock ? BigInt(fromBlock) : 0n,
    // Deliberately NOT in `missing`. 0G Storage is a separate network from the
    // EVM RPC, and a deployment without it is a real configuration rather than a
    // broken one — it just cannot read questions, and says so.
    zgIndexerUrl: zgIndexer,
  };
}

export function getDataSource(): DataSource {
  const mode = (process.env.NEXT_PUBLIC_DATA_MODE ?? "mock") as DataMode;
  switch (mode) {
    case "mock":
      return new MockSource();
    case "chain":
      return new ChainSource(chainConfig());
    case "indexer":
      // Decorates `chain` rather than replacing it: state still comes from
      // eth_call, and only history is added. See LogSource.
      return new LogSource(chainConfig());
  }
}

export * from "./types";
