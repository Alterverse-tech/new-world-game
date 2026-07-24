import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AccountRegistrationFlow, OTP_COOLDOWN_KEY, type AccountRegistrationPort } from './account-registration-flow';

function makePort(values = { email: ' new@example.com ', password: 'register-password', confirmation: 'register-password', token: '123456' }) {
  const port: AccountRegistrationPort & { values: typeof values; states: unknown[] } = {
    values, states: [], readEmail: () => values.email, readPassword: () => values.password,
    readConfirmation: () => values.confirmation, readToken: () => values.token,
    setEmail: vi.fn((email: string) => { values.email = email; }),
    clearSecrets: vi.fn(() => { values.password = values.confirmation = values.token = ''; }),
    render: vi.fn((state) => port.states.push(state)), focusEmail: vi.fn(), focusPassword: vi.fn(), focusConfirmation: vi.fn(), focusToken: vi.fn(),
  };
  return port;
}

describe('AccountRegistrationFlow', () => {
  it('sends, verifies, sets password, exchanges and clears private credentials', async () => {
    const port = makePort(); const session = { access_token: 'session-secret' } as Session; const trace: string[] = [];
    const service = { sendOtp: vi.fn(async () => { trace.push('send'); }), verifyOtp: vi.fn(async () => { trace.push('verify'); return session; }), setPassword: vi.fn(async () => { trace.push('password'); }), exchangeSession: vi.fn(async () => { trace.push('exchange'); }) };
    const storage = { get: vi.fn(), set: vi.fn(), delete: vi.fn((key) => trace.push(`delete:${key}`)) };
    const flow = new AccountRegistrationFlow({ port, service, storage, now: () => 1000, redirectTo: 'https://altverse.fun/', reload: vi.fn() });
    await flow.submit();
    expect(service.sendOtp).toHaveBeenCalledWith('new@example.com', 'https://altverse.fun/');
    expect(flow.getState()).toMatchObject({ stage: 'verify', email: 'new@example.com' });
    await flow.submit();
    expect(trace).toEqual(['send', 'verify', 'password', 'exchange', `delete:${OTP_COOLDOWN_KEY}`]);
    expect(port.clearSecrets).toHaveBeenCalled();
    expect(JSON.stringify([flow.getState(), port.states])).not.toContain('register-password');
    expect(JSON.stringify([flow.getState(), port.states])).not.toContain('session-secret');
  });

  it('uses an existing code without sending and clears secrets on cancel', async () => {
    const port = makePort(); const service = { sendOtp: vi.fn(), verifyOtp: vi.fn(), setPassword: vi.fn(), exchangeSession: vi.fn() };
    const flow = new AccountRegistrationFlow({ port, service, storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }, now: Date.now, redirectTo: 'https://altverse.fun/', reload: vi.fn() });
    flow.useExistingCode();
    expect(flow.getState()).toMatchObject({ stage: 'verify', email: 'new@example.com' });
    expect(service.sendOtp).not.toHaveBeenCalled();
    flow.cancel();
    expect(port.clearSecrets).toHaveBeenCalled();
    expect(flow.getState()).toMatchObject({ stage: 'details', email: '' });
  });

  it('writes normalized prefills and focuses password when reopening registration', () => {
    const ui = makePort();
    const flow = new AccountRegistrationFlow({ port: ui, service: { sendOtp: vi.fn(), verifyOtp: vi.fn(), setPassword: vi.fn(), exchangeSession: vi.fn() }, storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }, now: Date.now, redirectTo: 'https://altverse.fun/', reload: vi.fn() });
    flow.open(' Player@Example.COM ');
    expect(ui.setEmail).toHaveBeenCalledWith('player@example.com');
    expect(ui.focusPassword).toHaveBeenCalled();
  });
});
