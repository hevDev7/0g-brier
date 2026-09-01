import type { ChainMode } from './modes.js';

export interface NetworkConfig {
  name: ChainMode;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
  /**
   * The 0G Storage indexer for this network, or null where there is none.
   *
   * IT BELONGS HERE BECAUSE THE TWO STORAGE NETWORKS DO NOT SHARE DATA. Each
   * indexer reports its own `networkIdentity`, and the SDK discovers the Flow
   * contract from whichever one it is given. The testnet Flow
   * (0x22E03a6A…105296) has NO CODE on 16661, so an upload aimed at mainnet
   * through the testnet indexer builds a contract at an address that does not
   * exist and reverts at gas estimation. Pointing both at testnet "works" and is
   * worse: a mainnet market's specRoot is immutable at birth, and Galileo has
   * already been reset onto a new chain id twice.
   */
  indexerUrl: string | null;
}

type Env = Record<string, string | undefined>;

/** Facts verified 2026-08-27 — see spec §3.1. */
export function networkFor(mode: ChainMode, env: Env = process.env): NetworkConfig {
  switch (mode) {
    case 'anvil':
      return {
        name: 'anvil',
        chainId: 31337,
        rpcUrl: env.LOCAL_RPC ?? 'http://127.0.0.1:8545',
        explorer: null,
        indexerUrl: null,
      };
    case 'galileo':
      return {
        name: 'galileo',
        chainId: 16602,
        rpcUrl: env.ZERO_G_TESTNET_RPC ?? 'https://evmrpc-testnet.0g.ai',
        explorer: 'https://chainscan-galileo.0g.ai',
        indexerUrl: env.ZG_INDEXER ?? 'https://indexer-storage-testnet-turbo.0g.ai',
      };
    case 'mainnet':
      return {
        name: 'mainnet',
        chainId: 16661,
        rpcUrl: env.ZERO_G_MAINNET_RPC ?? 'https://evmrpc.0g.ai',
        explorer: 'https://chainscan.0g.ai',
        // Turbo, not Standard. Both are live on 16661 and both are mainnet, but
        // Turbo is the one 0G's mainnet overview names and the one that is used:
        // 211,672 uploads against Standard's 57.
        indexerUrl: env.ZG_INDEXER ?? 'https://indexer-storage-turbo.0g.ai',
      };
  }
}

/**
 * The chain mode a chain id belongs to.
 *
 * This existed nine times across the examples as an inline ternary, and five of
 * those nine were written `CHAIN_ID === 16602 ? 'galileo' : 'anvil'` — a two-way
 * choice made before mainnet existed. On chain 16661 they all fell through to
 * `anvil`, so a keeper, a resolver, a redeem and a register pointed at 0G mainnet
 * silently addressed http://127.0.0.1:8545 instead. Nothing announced it: the
 * client simply had no markets to act on.
 *
 * One function, so a fourth network is one edit rather than nine, and so a wrong
 * chain id is a thrown error rather than a quiet fallback to localhost.
 */
export function modeForChainId(chainId: number): ChainMode {
  switch (chainId) {
    case 31337:
      return 'anvil';
    case 16602:
      return 'galileo';
    case 16661:
      return 'mainnet';
    default:
      throw new Error(
        `chain id ${chainId} is not a known 0G network. Expected 16661 (mainnet), ` +
          '16602 (Galileo) or 31337 (local anvil). Refusing to guess: the guess ' +
          'used to be localhost, which looks like an empty protocol rather than a ' +
          'misconfiguration.',
      );
  }
}

/** `networkFor(modeForChainId(id))`, which is what every caller actually wanted. */
export function networkForChainId(chainId: number, env: Env = process.env): NetworkConfig {
  return networkFor(modeForChainId(chainId), env);
}
