import { describe, expect, it } from 'vitest';
import { parseDeployment, requireContracts } from '../src/deployments';

const valid = {
  chainId: 16602,
  deploymentBlock: 1234,
  deployedAt: 1790000000,
  contracts: {
    ConfigRegistry: '0x1111111111111111111111111111111111111111',
    MockUSDC: '0x2222222222222222222222222222222222222222',
  },
};

describe('parseDeployment', () => {
  it('menerima manifest yang sah', () => {
    const m = parseDeployment(valid);
    expect(m.chainId).toBe(16602);
    expect(m.contracts.ConfigRegistry).toBe('0x1111111111111111111111111111111111111111');
  });

  it('menolak ketidakcocokan chainId', () => {
    expect(() => parseDeployment(valid, 16661)).toThrow(/16661/);
  });

  it('menolak alamat yang tidak berbentuk 0x + 40 hex', () => {
    const bad = { ...valid, contracts: { ConfigRegistry: '0xnope' } };
    expect(() => parseDeployment(bad)).toThrow(/ConfigRegistry/);
  });

  it('menolak manifest tanpa contracts', () => {
    expect(() => parseDeployment({ chainId: 1, deploymentBlock: 0, deployedAt: 0 })).toThrow(/contracts/);
  });

  it('requireContracts menyebutkan yang hilang', () => {
    const m = parseDeployment(valid);
    expect(() => requireContracts(m, ['ConfigRegistry', 'MarketFactory'])).toThrow(/MarketFactory/);
    expect(() => requireContracts(m, ['ConfigRegistry'])).not.toThrow();
  });
});
