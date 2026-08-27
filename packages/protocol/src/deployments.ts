export interface DeploymentManifest {
  chainId: number;
  /**
   * A LOWER BOUND on the block the contracts were deployed in, not the block itself.
   *
   * A forge script broadcasts after its body has run, so nothing inside it can observe the
   * block the transactions land in; the script records the block it saw beforehand. Lower is
   * the safe direction for the P3 indexer: backfilling from too early only costs time, while
   * starting too late misses events permanently. On a fresh anvil this is legitimately 0.
   *
   * Consumers must treat it as "start scanning here", never as "the deployment happened here".
   */
  deploymentBlock: number;
  deployedAt: number;
  contracts: Record<string, `0x${string}`>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`invalid manifest: ${label} must be an object`);
  }
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`invalid manifest: ${label} must be a number`);
  }
  return v;
}

export function parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest {
  const obj = asRecord(raw, 'manifest');
  const chainId = asNumber(obj.chainId, 'chainId');
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`manifest is for chainId ${chainId}, but ${expectedChainId} was requested`);
  }
  const rawContracts = asRecord(obj.contracts, 'contracts');
  const contracts: Record<string, `0x${string}`> = {};
  for (const [name, addr] of Object.entries(rawContracts)) {
    if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) {
      throw new Error(`invalid manifest: contracts.${name} is not an address: ${String(addr)}`);
    }
    contracts[name] = addr as `0x${string}`;
  }
  return {
    chainId,
    deploymentBlock: asNumber(obj.deploymentBlock, 'deploymentBlock'),
    deployedAt: asNumber(obj.deployedAt, 'deployedAt'),
    contracts,
  };
}

/** Fail fast at startup when a required contract is missing from the manifest. */
export function requireContracts(m: DeploymentManifest, names: readonly string[]): void {
  const missing = names.filter((n) => m.contracts[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`manifest chainId ${m.chainId} is missing contracts: ${missing.join(', ')}`);
  }
}
