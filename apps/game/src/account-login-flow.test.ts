import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  AccountLoginFlow,
  OTP_COOLDOWN_KEY,
  type AccountLoginPort,
  type AccountLoginState,
  type StoragePort,
} from './account-login-flow';

function port(values: { email: string; token: string }): AccountLoginPort & { renders: AccountLoginState[] } {
  const result = {
    renders: [] as AccountLoginState[],
    readEmail: vi.fn(() => values.email),
    readToken: vi.fn(() => values.token),
    render: vi.fn((state: AccountLoginState) => result.renders.push(state)),
    clearToken: vi.fn(),
    focusEmail: vi.fn(),
    focusToken: vi.fn(),
  };
  return result;
}

function storage(initial: Record<string, string> = {}): StoragePort {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn((key) => values.get(key) ?? null),
    set: vi.fn((key, value) => values.set(key, value)),
    delete: vi.fn((key) => values.delete(key)),
  };
}

describe('AccountLoginFlow', () => {
  it('normalizes an email, sends OTP, then verifies, exchanges and reloads once', async () => {
    const ui = port({ email: ' Player@Example.COM ', token: '123456' });
    const store = storage();
    const session = { access_token: 'private-token' } as Session;
    const service = {
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => session),
      exchangeSession: vi.fn(async () => {}),
    };
    const reload = vi.fn();
    const flow = new AccountLoginFlow({
      port: ui, service, storage: store, now: () => 1_000,
      redirectTo: 'https://altverse.fun/', reload,
    });

    await flow.submit();

    expect(service.sendOtp).toHaveBeenCalledWith('player@example.com', 'https://altverse.fun/');
    expect(flow.getState()).toMatchObject({ stage: 'verify', email: 'player@example.com', busy: false });

    await flow.submit();

    expect(service.verifyOtp).toHaveBeenCalledWith('player@example.com', '123456');
    expect(service.exchangeSession).toHaveBeenCalledWith(session);
    expect(store.delete).toHaveBeenCalledWith(OTP_COOLDOWN_KEY);
    expect(reload).toHaveBeenCalledOnce();
    expect(JSON.stringify(ui.renders)).not.toContain('private-token');
  });

  it('restores a matching cooldown and rejects malformed OTP without verifying', async () => {
    const ui = port({ email: 'player@example.com', token: '12ab' });
    const store = storage({
      [OTP_COOLDOWN_KEY]: JSON.stringify({ email: 'player@example.com', until: 61_000 }),
    });
    const service = {
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => ({ access_token: 'private-token' } as Session)),
      exchangeSession: vi.fn(async () => {}),
    };
    const flow = new AccountLoginFlow({
      port: ui, service, storage: store, now: () => 2_000,
      redirectTo: 'https://altverse.fun/', reload: vi.fn(),
    });

    await flow.submit();

    expect(service.sendOtp).not.toHaveBeenCalled();
    expect(flow.getState()).toMatchObject({ stage: 'verify', cooldownSeconds: 59 });

    await flow.submit();

    expect(service.verifyOtp).not.toHaveBeenCalled();
    expect(flow.getState()).toMatchObject({ stage: 'verify', messageState: 'error', busy: false });
  });
});
