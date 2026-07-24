import { describe, expect, it, vi } from 'vitest';
import { AccountRecoveryFlow, captureRecoveryHash, type AccountRecoveryPort } from './account-recovery-flow';
import { AccountRecoveryRequestError } from './account-auth-service';

function makePort(values = { email: ' player@example.com ', password: 'new-password', confirmation: 'new-password' }) {
  const port: AccountRecoveryPort & { values: typeof values; states: unknown[] } = { values, states: [], readEmail: () => values.email, readPassword: () => values.password, readConfirmation: () => values.confirmation, setEmail: vi.fn((email: string) => { values.email = email; }), clearSecrets: vi.fn(() => { values.password = values.confirmation = ''; }), render: vi.fn((state) => port.states.push(state)), focusEmail: vi.fn(), focusPassword: vi.fn(), focusConfirmation: vi.fn() };
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
  it('captures error callbacks and clears their URL hash', () => {
    const replaceState = vi.fn();
    expect(captureRecoveryHash({ location: { hash: '#error=access_denied', pathname: '/', search: '' }, replaceState })).toBe('#error=access_denied');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });
});

describe('AccountRecoveryFlow', () => {
  it('resets a reopened dialog to normalized email mode', () => {
    const port = makePort(); const flow = new AccountRecoveryFlow({ port, service: { sendRecoveryEmail: vi.fn(), updateRecoveredPassword: vi.fn() } });
    flow.openRecovery('#access_token=recovery-secret&type=recovery');
    flow.open(' Player@Example.COM ');
    expect(port.setEmail).toHaveBeenCalledWith('player@example.com');
    expect(flow.getState()).toMatchObject({ mode: 'email', busy: false, messageState: 'guest' });
  });
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

  it('preserves a retryable recovery token but clears it for an explicit fatal error', async () => {
    const port = makePort(); const updateRecoveredPassword = vi.fn().mockRejectedValueOnce(new Error('network-secret')).mockRejectedValueOnce(new AccountRecoveryRequestError('expired', false));
    const flow = new AccountRecoveryFlow({ port, service: { sendRecoveryEmail: vi.fn(), updateRecoveredPassword } });
    flow.openRecovery('#access_token=recovery-secret&type=recovery'); port.values.password = port.values.confirmation = 'new-password'; await flow.updatePassword();
    expect(flow.getState().mode).toBe('password'); expect(updateRecoveredPassword).toHaveBeenNthCalledWith(1, 'recovery-secret', 'new-password');
    await flow.updatePassword();
    expect(updateRecoveredPassword).toHaveBeenNthCalledWith(2, 'recovery-secret', 'new-password'); expect(flow.getState().mode).toBe('email'); expect(port.values.password).toBe('');
    expect(JSON.stringify(port.states)).not.toContain('recovery-secret');
  });

  it('clears secrets immediately and delays success callback by 650ms', async () => {
    vi.useFakeTimers();
    try {
      const port = makePort(); const onSuccess = vi.fn(); const flow = new AccountRecoveryFlow({ port, service: { sendRecoveryEmail: vi.fn(), updateRecoveredPassword: vi.fn(async () => {}) }, onSuccess });
      flow.openRecovery('#access_token=recovery-secret&type=recovery'); port.values.password = port.values.confirmation = 'new-password'; const update = flow.updatePassword();
      await vi.advanceTimersByTimeAsync(0); expect(port.values.password).toBe(''); expect(onSuccess).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(649); expect(onSuccess).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); await update; expect(onSuccess).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each(['#error=access_denied', '#type=recovery', '#not-a-query'])('invalid callback %s clears prior recovery secrets', async (hash) => {
    const port = makePort(); const updateRecoveredPassword = vi.fn(); const flow = new AccountRecoveryFlow({ port, service: { sendRecoveryEmail: vi.fn(), updateRecoveredPassword } });
    flow.openRecovery('#access_token=old-token&type=recovery'); port.values.password = port.values.confirmation = 'new-password'; flow.openRecovery(hash);
    expect(flow.getState()).toMatchObject({ mode: 'email', messageState: 'error' }); expect(port.values.password).toBe('');
    port.values.password = port.values.confirmation = 'new-password'; await flow.updatePassword();
    expect(updateRecoveredPassword).not.toHaveBeenCalled(); expect(flow.getState()).toMatchObject({ mode: 'email', messageState: 'error' });
  });
});
