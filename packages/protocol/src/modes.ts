export const CHAIN_MODES = ['anvil', 'galileo', 'mainnet'] as const;
export const STORAGE_MODES = ['memory', 'file', 'real'] as const;
export const INFERENCE_MODES = ['stub', 'router', 'compute'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];
export type StorageMode = (typeof STORAGE_MODES)[number];
export type InferenceMode = (typeof INFERENCE_MODES)[number];

export interface Modes {
  chain: ChainMode;
  storage: StorageMode;
  inference: InferenceMode;
}

type Env = Record<string, string | undefined>;

function pick<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${key}="${raw}" is not recognized; allowed: ${allowed.join(', ')}`);
}

/** Reads the three mode switches and enforces combinations that must not occur.
 *  The cross-checks below exist so a dangerous configuration fails at startup,
 *  not after it has already touched real funds. */
export function loadModes(env: Env = process.env): Modes {
  const chain = pick(env, 'CHAIN_MODE', CHAIN_MODES, 'anvil');
  const storage = pick(env, 'STORAGE_MODE', STORAGE_MODES, 'memory');
  const inference = pick(env, 'INFERENCE_MODE', INFERENCE_MODES, 'stub');

  if (chain === 'mainnet' && inference === 'stub') {
    throw new Error('INFERENCE_MODE=stub is forbidden when CHAIN_MODE=mainnet: simulated settlement must not touch real funds');
  }
  if (chain !== 'anvil' && storage === 'memory') {
    throw new Error(`STORAGE_MODE=memory is only for CHAIN_MODE=anvil; specRoot/receiptRoot must be re-fetchable on ${chain}`);
  }
  return { chain, storage, inference };
}
