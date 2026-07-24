import { describe, expect, it, vi } from 'vitest';
import { AccountRecoveryFlow, captureRecoveryHash, type AccountRecoveryPort } from './account-recovery-flow';

function makePort(values = { email: ' player@example.com ', password: 'new-password', confirmation: 'new-password' }) {
  const port: AccountRecoveryPort & { values: typeof values; states: unknown[] } = { values, states: [], readEmail: () => values.email, readPassword: () => values.password, readConfirmation: () => values.confirmation, clearSecrets: vi.fn(() => { values.password = values.confirmation = ''; }), render: vi.fn((state) => port.states.push(state)), focusEmail: vi.fn(), focusPassword: vi.fn(), focusConfirmation: vi.fn() };
  return port;
}

describe('captureRecoveryHash', () => {
  it('captures recovery callbacks and removes their hash immediately', () => {
    const replaceState = vi.fn();
    expect(captureRecoveryHash({ location: { hash: '#access_token=recovery-secret&type=recovery', pathname: '/', search: '?password_reset=1' }, replaceState })).toBe('#access_token=recovery-secret&type=recovery');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?password_reset=1');
  });
  it('does not clear unrelated hashes', () => {
    const replaceState = vi.fn();
    expect(captureRecoveryHash({ location: { hash: '#chapter=2', pathname: '/', search: '' }, replaceState })).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('AccountRecoveryFlow', () => {
  it('uses enumeration-safe mail feedback and keeps token/password private', async () => {
    const port = makePort(); const service = { sendRecoveryEmail: vi.fn(async () => {}), updateRecoveredPassword: vi.fn(async () => {}) };
    const flow = new AccountRecoveryFlow({ port, service });
    await flow.sendEmail('https://altverse.fun/?password_reset=1');
    expect(service.sendRecoveryEmail).toHaveBeenCalledWith('player@example.com', 'https://altverse.fun/?password_reset=1');
    expect(flow.getState().message).toContain('如果该邮箱已注册');
    flow.openRecovery('#access_token=recovery-secret&type=recovery');
    port.values.password = port.values.confirmation = 'new-password';
    await flow.updatePassword();
    expect(service.updateRecoveredPassword).toHaveBeenCalledWith('recovery-secret', 'new-password');
    expect(JSON.stringify([flow.getState(), port.states])).not.toContain('recovery-secret');
    expect(JSON.stringify([flow.getState(), port.states])).not.toContain('new-password');
  });
});
