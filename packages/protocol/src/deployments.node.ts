import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDeployment, type DeploymentManifest } from './deployments';

/**
 * Pemuat manifest dari disk. Modul ini TIDAK diekspor dari barrel: `node:fs`
 * tidak bisa masuk bundel browser. Konsumen Node mengimpornya lewat
 * subpath eksplisit `@0g-delphi/protocol/node`.
 */
export function loadDeployment(chainId: number, dir = join(process.cwd(), 'deployments')): DeploymentManifest {
  const path = join(dir, `${chainId}.json`);
  return parseDeployment(JSON.parse(readFileSync(path, 'utf8')), chainId);
}
