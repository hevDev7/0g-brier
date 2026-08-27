export interface DeploymentManifest {
  chainId: number;
  deploymentBlock: number;
  deployedAt: number;
  contracts: Record<string, `0x${string}`>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`manifest tidak sah: ${label} harus berupa objek`);
  }
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`manifest tidak sah: ${label} harus berupa angka`);
  }
  return v;
}

export function parseDeployment(raw: unknown, expectedChainId?: number): DeploymentManifest {
  const obj = asRecord(raw, 'manifest');
  const chainId = asNumber(obj.chainId, 'chainId');
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`manifest untuk chainId ${chainId}, tetapi ${expectedChainId} yang diminta`);
  }
  const rawContracts = asRecord(obj.contracts, 'contracts');
  const contracts: Record<string, `0x${string}`> = {};
  for (const [name, addr] of Object.entries(rawContracts)) {
    if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) {
      throw new Error(`manifest tidak sah: contracts.${name} bukan alamat: ${String(addr)}`);
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

/** Gagal cepat saat start bila kontrak yang dibutuhkan belum ada di manifest. */
export function requireContracts(m: DeploymentManifest, names: readonly string[]): void {
  const missing = names.filter((n) => m.contracts[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`manifest chainId ${m.chainId} kekurangan kontrak: ${missing.join(', ')}`);
  }
}
