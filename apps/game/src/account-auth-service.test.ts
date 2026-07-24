import { describe, expect, it, vi } from 'vitest';
import {
  AccountAuthService,
  authRedirectUrl,
  parseAuthConfig,
} from './account-auth-service';

describe('AccountAuthService', () => {
  it('loads config and creates exactly one shared client', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_example',
    }), { status: 200 }));
    const client = { auth: {} };
    const createClientImpl = vi.fn(() => client);
    const service = new AccountAuthService({ fetchImpl, createClientImpl: createClientImpl as never });

    expect(await service.getClient()).toBe(client);
    expect(await service.getClient()).toBe(client);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(createClientImpl).toHaveBeenCalledOnce();
  });

  it('sends OTP with account creation and exchanges only the returned session', async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        enabled: true,
        provider: 'email',
        supabaseUrl: 'https://project-ref.supabase.co',
        publishableKey: 'sb_publishable_example',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: { signedIn: true },
      }), { status: 200 }));
    const service = new AccountAuthService({
      fetchImpl,
      createClientImpl: () => ({ auth: { signInWithOtp } }) as never,
    });

    await service.sendOtp('player@example.com', 'https://altverse.fun/');
    await service.exchangeSession({ access_token: 'private-token' } as never);

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'player@example.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'https://altverse.fun/',
      },
    });
    expect(fetchImpl.mock.calls[1]).toEqual([
      '/api/auth/session',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer private-token' }),
      }),
    ]);
    expect(JSON.stringify(service)).not.toContain('private-token');
  });
});

describe('auth contract helpers', () => {
  it('keeps the validated config and root redirect contract', () => {
    expect(parseAuthConfig({ enabled: false, provider: 'email' })).toEqual({
      enabled: false,
      provider: 'email',
    });
    expect(authRedirectUrl({ origin: 'https://altverse.fun' })).toBe('https://altverse.fun/');
  });

  it('rejects a config that does not target a Supabase project origin', () => {
    expect(() => parseAuthConfig({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://not-supabase.example',
      publishableKey: 'sb_publishable_example',
    })).toThrow('账号服务地址无效');
  });
});
