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

  it('keeps verification controls busy until failure state is rendered, then focuses token', async () => {
    const ui = makePort(); let disabled = true; const focused: boolean[] = [];
    ui.render = vi.fn((state) => { disabled = state.busy; }); ui.focusToken = vi.fn(() => focused.push(disabled));
    const flow = new AccountRegistrationFlow({ port: ui, service: { sendOtp: vi.fn(async () => {}), verifyOtp: vi.fn(async () => { throw new Error('secret'); }), setPassword: vi.fn(), exchangeSession: vi.fn() }, storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }, now: Date.now, redirectTo: 'https://altverse.fun/', reload: vi.fn() });
    await flow.submit(); await flow.submit();
    expect(focused.at(-1)).toBe(false);
  });

  it('orders successful verification and reloads only after 700ms', async () => {
    vi.useFakeTimers();
    try {
      const ui = makePort(); const trace: string[] = []; const reload = vi.fn(() => trace.push('reload'));
      const flow = new AccountRegistrationFlow({ port: ui, service: { sendOtp: vi.fn(async () => { trace.push('send'); }), verifyOtp: vi.fn(async () => { trace.push('verify'); return { access_token: 'token' } as Session; }), setPassword: vi.fn(async (password) => { expect(password).toBe('register-password'); trace.push('password'); }), exchangeSession: vi.fn(async () => trace.push('exchange')) }, storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(() => trace.push('delete')) }, now: Date.now, redirectTo: 'https://altverse.fun/', reload });
      await flow.submit(); const verify = flow.submit(); await vi.advanceTimersByTimeAsync(699); expect(reload).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); await verify;
      expect(trace).toEqual(['send', 'verify', 'password', 'exchange', 'delete', 'reload']);
    } finally { vi.useRealTimers(); }
  });

  it('restores only matching email cooldown and deduplicates resend while busy', async () => {
    const values = { email: 'player@example.com', password: 'register-password', confirmation: 'register-password', token: '' };
    const ui = makePort(values); let resolveSend!: () => void;
    const storage = { get: vi.fn(() => JSON.stringify({ email: 'other@example.com', until: 61_000 })), set: vi.fn(), delete: vi.fn() };
    const sendOtp = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const flow = new AccountRegistrationFlow({ port: ui, service: { sendOtp, verifyOtp: vi.fn(), setPassword: vi.fn(), exchangeSession: vi.fn() }, storage, now: () => 1_000, redirectTo: 'https://altverse.fun/', reload: vi.fn() });
    const sending = flow.submit(); await flow.resend(); expect(sendOtp).toHaveBeenCalledOnce(); resolveSend(); await sending;
    storage.get.mockReturnValue(JSON.stringify({ email: 'player@example.com', until: 61_000 })); flow.open('player@example.com'); values.password = values.confirmation = 'register-password'; await flow.submit(); expect(flow.getState()).toMatchObject({ stage: 'verify', cooldownSeconds: 60 });
  });
});
