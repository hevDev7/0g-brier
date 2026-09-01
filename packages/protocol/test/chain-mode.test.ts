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
