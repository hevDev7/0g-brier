import type { ChainMode } from './modes.js';

export interface NetworkConfig {
  name: ChainMode;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
}

type Env = Record<string, string | undefined>;

/** Facts verified 2026-08-27 — see spec §3.1. */
export function networkFor(mode: ChainMode, env: Env = process.env): NetworkConfig {
  switch (mode) {
    case 'anvil':
      return { name: 'anvil', chainId: 31337, rpcUrl: env.LOCAL_RPC ?? 'http://127.0.0.1:8545', explorer: null };
    case 'galileo':
      return {
        name: 'galileo',
        chainId: 16602,
        rpcUrl: env.ZERO_G_TESTNET_RPC ?? 'https://evmrpc-testnet.0g.ai',
        explorer: 'https://chainscan-galileo.0g.ai',
      };
    case 'mainnet':
      return {
        name: 'mainnet',
        chainId: 16661,
        rpcUrl: env.ZERO_G_MAINNET_RPC ?? 'https://evmrpc.0g.ai',
        explorer: null,
      };
  }
}
