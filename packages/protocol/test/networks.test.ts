import { describe, expect, it } from 'vitest';
import { networkFor } from '../src/networks';

describe('networkFor', () => {
  it('anvil memakai chain id 31337 dan RPC lokal', () => {
    const n = networkFor('anvil', {});
    expect(n.chainId).toBe(31337);
    expect(n.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(n.explorer).toBeNull();
  });

  it('galileo memakai chain id 16602 dan explorer chainscan', () => {
    const n = networkFor('galileo', {});
    expect(n.chainId).toBe(16602);
    expect(n.rpcUrl).toBe('https://evmrpc-testnet.0g.ai');
    expect(n.explorer).toBe('https://chainscan-galileo.0g.ai');
  });

  it('mainnet memakai chain id 16661', () => {
    expect(networkFor('mainnet', {}).chainId).toBe(16661);
  });

  it('env menimpa RPC bawaan', () => {
    const n = networkFor('galileo', { ZERO_G_TESTNET_RPC: 'https://rpc.example' });
    expect(n.rpcUrl).toBe('https://rpc.example');
  });
});
