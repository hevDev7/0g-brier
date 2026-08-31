import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDeployment, type DeploymentManifest } from './deployments.js';

/**
 * Manifest loader from disk. This module is NOT exported from the barrel:
 * `node:fs` cannot enter a browser bundle. Node consumers import it via the
 * explicit subpath `@0g-brier/protocol/node`.
 */
export function loadDeployment(chainId: number, dir = join(process.cwd(), 'deployments')): DeploymentManifest {
  const path = join(dir, `${chainId}.json`);
  return parseDeployment(JSON.parse(readFileSync(path, 'utf8')), chainId);
}
