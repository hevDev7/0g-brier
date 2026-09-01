import {describe, expect, it} from 'vitest';
import {modeForChainId, networkForChainId, networkFor} from '../src/networks.js';

describe('which network a chain id means', () => {
  it('knows the three networks', () => {
    expect(modeForChainId(16661)).toBe('mainnet');
    expect(modeForChainId(16602)).toBe('galileo');
    expect(modeForChainId(31337)).toBe('anvil');
  });

  /**
   * The defect this replaces: `CHAIN_ID === 16602 ? 'galileo' : 'anvil'` sent
   * mainnet to localhost. A wrong id must be loud, because the quiet answer looked
   * like a protocol with nothing in it rather than a client on the wrong chain.
   */
  it('refuses an unknown chain instead of falling back to localhost', () => {
    expect(() => modeForChainId(1)).toThrow(/not a known 0G network/);
    expect(() => modeForChainId(0)).toThrow(/16661/);
  });

  it('resolves mainnet to 16661 and its own endpoint, never 127.0.0.1', () => {
    const net = networkForChainId(16661, {});
    expect(net.chainId).toBe(16661);
    expect(net.rpcUrl).toBe('https://evmrpc.0g.ai');
    expect(net.rpcUrl).not.toContain('127.0.0.1');
  });

  it('agrees with networkFor for every mode', () => {
    for (const [id, mode] of [
      [16661, 'mainnet'],
      [16602, 'galileo'],
      [31337, 'anvil'],
    ] as const) {
      expect(networkForChainId(id, {})).toEqual(networkFor(mode, {}));
    }
  });

  it('lets the environment override the endpoint without changing the chain id', () => {
    const net = networkForChainId(16661, {ZERO_G_MAINNET_RPC: 'https://example.invalid'});
    expect(net.rpcUrl).toBe('https://example.invalid');
    expect(net.chainId).toBe(16661);
  });
});

describe('which storage network a chain means', () => {
  /**
   * The two 0G Storage networks share no data and their Flow contracts have no
   * code on each other's chain, so an upload through the wrong indexer reverts at
   * gas estimation. Verified 2026-09-01: the mainnet indexer serves a real mainnet
   * root as 9555 bytes, the testnet one answers 51 bytes of "file not found", and
   * `cast code` on the testnet Flow against 16661 returns 0x.
   */
  it('never points mainnet at the testnet indexer', () => {
    const net = networkForChainId(16661, {});
    expect(net.indexerUrl).toBe('https://indexer-storage-turbo.0g.ai');
    expect(net.indexerUrl).not.toContain('testnet');
  });

  it('keeps galileo on the testnet indexer', () => {
    expect(networkForChainId(16602, {}).indexerUrl).toBe('https://indexer-storage-testnet-turbo.0g.ai');
  });

  it('has no indexer for anvil, rather than a wrong one', () => {
    expect(networkForChainId(31337, {}).indexerUrl).toBeNull();
  });

  it('lets ZG_INDEXER override without changing the chain', () => {
    const net = networkForChainId(16661, {ZG_INDEXER: 'https://example.invalid'});
    expect(net.indexerUrl).toBe('https://example.invalid');
    expect(net.chainId).toBe(16661);
  });
});
