import { describe, expect, it } from 'vitest';
import { loadModes } from '../src/modes';

describe('loadModes', () => {
  it('safe defaults: anvil + memory + stub', () => {
    expect(loadModes({})).toEqual({ chain: 'anvil', storage: 'memory', inference: 'stub' });
  });

  it('reads all three switches from env', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'real', INFERENCE_MODE: 'compute' }))
      .toEqual({ chain: 'galileo', storage: 'real', inference: 'compute' });
  });

  it('rejects an unknown value and names the allowed ones', () => {
    expect(() => loadModes({ CHAIN_MODE: 'sepolia' })).toThrow(/anvil, galileo, mainnet/);
  });

  it('rejects stub inference on mainnet', () => {
    expect(() => loadModes({ CHAIN_MODE: 'mainnet', STORAGE_MODE: 'real', INFERENCE_MODE: 'stub' }))
      .toThrow(/INFERENCE_MODE=stub/);
  });

  it('rejects memory storage outside anvil', () => {
    expect(() => loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'memory' }))
      .toThrow(/STORAGE_MODE=memory/);
  });

  it('allows router on galileo', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'file', INFERENCE_MODE: 'router' }))
      .toEqual({ chain: 'galileo', storage: 'file', inference: 'router' });
  });
});
