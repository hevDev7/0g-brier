import { describe, expect, it } from 'vitest';
import { loadModes } from '../src/modes.js';

describe('loadModes', () => {
  it('default aman: anvil + memory + stub', () => {
    expect(loadModes({})).toEqual({ chain: 'anvil', storage: 'memory', inference: 'stub' });
  });

  it('membaca ketiga saklar dari env', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'real', INFERENCE_MODE: 'compute' }))
      .toEqual({ chain: 'galileo', storage: 'real', inference: 'compute' });
  });

  it('menolak nilai tak dikenal dan menyebutkan yang diizinkan', () => {
    expect(() => loadModes({ CHAIN_MODE: 'sepolia' })).toThrow(/anvil, galileo, mainnet/);
  });

  it('menolak inferensi stub di mainnet', () => {
    expect(() => loadModes({ CHAIN_MODE: 'mainnet', STORAGE_MODE: 'real', INFERENCE_MODE: 'stub' }))
      .toThrow(/INFERENCE_MODE=stub/);
  });

  it('menolak penyimpanan memory di luar anvil', () => {
    expect(() => loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'memory' }))
      .toThrow(/STORAGE_MODE=memory/);
  });

  it('mengizinkan router di galileo', () => {
    expect(loadModes({ CHAIN_MODE: 'galileo', STORAGE_MODE: 'file', INFERENCE_MODE: 'router' }))
      .toEqual({ chain: 'galileo', storage: 'file', inference: 'router' });
  });
});
