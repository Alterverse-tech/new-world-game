import { describe, expect, it, vi } from 'vitest';
import {
  AccountAuthService,
  AccountRecoveryRequestError,
  authRedirectUrl,
  parseAuthConfig,
} from './account-auth-service';

const enabledConfig = {
  enabled: true,
  provider: 'email',
  supabaseUrl: 'https://project-ref.supabase.co',
  publishableKey: 'sb_publishable_example',
} as const;

function configResponse() {
  return new Response(JSON.stringify(enabledConfig), { status: 200 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('AccountAuthService', () => {
  it('loads config and creates exactly one shared client', async () => {
    const fetchImpl = vi.fn(async () => configResponse());
    const client = { auth: {} };
    const createClientImpl = vi.fn(() => client);
    const service = new AccountAuthService({ fetchImpl, createClientImpl: createClientImpl as never });

    expect(await service.getClient()).toBe(client);
    expect(await service.getClient()).toBe(client);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(createClientImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/config', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
    expect(createClientImpl).toHaveBeenCalledWith(
      enabledConfig.supabaseUrl,
      enabledConfig.publishableKey,
      {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          autoRefreshToken: true,
          persistSession: true,
        },
      },
    );
  });

  it('sends OTP with account creation and exchanges only the returned session', async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(configResponse())
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
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer private-token',
        },
        credentials: 'same-origin',
        cache: 'no-store',
      },
    ]);
    expect(JSON.stringify(service)).not.toContain('private-token');
  });

  it('reuses the same in-flight config promise', async () => {
    const pendingResponse = deferred<Response>();
    const fetchImpl = vi.fn(() => pendingResponse.promise);
    const service = new AccountAuthService({ fetchImpl });

    const first = service.loadConfig();
    const second = service.loadConfig();

    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
    pendingResponse.resolve(configResponse());
    await expect(Promise.all([first, second])).resolves.toEqual([enabledConfig, enabledConfig]);
  });

  it('reuses the same in-flight client promise', async () => {
    const pendingClient = deferred<object>();
    const createClientImpl = vi.fn(() => pendingClient.promise);
    const service = new AccountAuthService({
      fetchImpl: vi.fn(async () => configResponse()),
      createClientImpl: createClientImpl as never,
    });

    const first = service.getClient();
    const second = service.getClient();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(createClientImpl).toHaveBeenCalledOnce());
    pendingClient.resolve({ auth: {} });
    await expect(Promise.all([first, second])).resolves.toEqual([{ auth: {} }, { auth: {} }]);
  });

  it('verifies an email token and returns only Supabase returned session', async () => {
    const session = { access_token: 'private-token', user: { id: 'player-id' } };
    const verifyOtp = vi.fn(async () => ({ data: { session }, error: null }));
    const service = new AccountAuthService({
      fetchImpl: vi.fn(async () => configResponse()),
      createClientImpl: () => ({ auth: { verifyOtp } }) as never,
    });

    await expect(service.verifyOtp('player@example.com', '123456')).resolves.toBe(session as never);
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'player@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('retries configuration loading after a failed request', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(configResponse());
    const service = new AccountAuthService({ fetchImpl });

    await expect(service.loadConfig()).rejects.toThrow('temporary failure');
    await expect(service.loadConfig()).resolves.toEqual(enabledConfig);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries client creation after a client factory failure', async () => {
    const client = { auth: {} };
    const createClientImpl = vi.fn()
      .mockImplementationOnce(() => { throw new Error('client creation failed'); })
      .mockReturnValueOnce(client);
    const service = new AccountAuthService({
      fetchImpl: vi.fn(async () => configResponse()),
      createClientImpl: createClientImpl as never,
    });

    await expect(service.getClient()).rejects.toThrow('client creation failed');
    await expect(service.getClient()).resolves.toBe(client);
    expect(createClientImpl).toHaveBeenCalledTimes(2);
  });

  it('redacts malformed config response bodies', async () => {
    const service = new AccountAuthService({
      fetchImpl: vi.fn(async () => new Response('config-private-token', { status: 200 })),
    });

    await expect(service.loadConfig()).rejects.toThrow('账号配置响应无效');
    await service.loadConfig().catch((error: unknown) => {
      expect(String(error)).not.toContain('config-private-token');
    });
  });

  it('redacts malformed session exchange response bodies', async () => {
    const service = new AccountAuthService({
      fetchImpl: vi.fn(async () => new Response('session-private-token', { status: 200 })),
    });

    await expect(service.exchangeSession({ access_token: 'private-token' } as never))
      .rejects.toThrow('账号验证响应无效');
    await service.exchangeSession({ access_token: 'private-token' } as never).catch((error: unknown) => {
      expect(String(error)).not.toContain('session-private-token');
      expect(String(error)).not.toContain('private-token');
    });
  });

  it('uses the recovery REST contracts and redacts recovery errors', async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(configResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const service = new AccountAuthService({ fetchImpl, createClientImpl: () => ({ auth: { updateUser } }) as never });
    await service.setPassword('register-password');
    await service.sendRecoveryEmail('player@example.com', 'https://altverse.fun/?password_reset=1');
    await service.updateRecoveredPassword('recovery-secret', 'new-password');
    expect(updateUser).toHaveBeenCalledWith({ password: 'register-password' });
    expect(fetchImpl.mock.calls[1]![0].toString()).toBe('https://project-ref.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Faltverse.fun%2F%3Fpassword_reset%3D1');
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ email: 'player@example.com' }) });
    expect(fetchImpl.mock.calls[2]![1]).toMatchObject({ method: 'PUT', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ password: 'new-password' }), headers: expect.objectContaining({ Authorization: 'Bearer recovery-secret' }) });
    const failing = new AccountAuthService({ fetchImpl: vi.fn().mockResolvedValueOnce(configResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unknown', token: 'private' }), { status: 400 })) });
    await expect(failing.sendRecoveryEmail('player@example.com', 'https://altverse.fun/')).rejects.toThrow('重置邮件发送失败，请稍后重试。');
  });

  it.each([
    ['weak_password', '新密码强度不足，请使用至少 8 位密码。', true],
    ['same_password', '新密码不能与当前密码相同。', true],
    ['email_address_invalid', '邮箱地址无效，请检查后重试。', true],
    ['over_email_send_rate_limit', '重置邮件发送过于频繁，请稍后再试。', true],
    ['over_request_rate_limit', '请求过于频繁，请稍后再试。', true],
  ])('maps recovery code %s without body exposure', async (code, message, retryable) => {
    const service = new AccountAuthService({ fetchImpl: vi.fn().mockResolvedValueOnce(configResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ code, secret: 'server-secret' }), { status: 400 })) });
    await service.sendRecoveryEmail('player@example.com', 'https://altverse.fun/').catch((error: unknown) => {
      expect(error).toBeInstanceOf(AccountRecoveryRequestError);
      expect((error as AccountRecoveryRequestError).message).toBe(message);
      expect((error as AccountRecoveryRequestError).canRetryPassword).toBe(retryable);
      expect(String(error)).not.toContain('server-secret');
    });
  });

  it('classifies only explicit unauthorized recovery responses as fatal', async () => {
    for (const [status, retryable] of [[401, false], [429, true], [500, true]] as const) {
      const service = new AccountAuthService({ fetchImpl: vi.fn().mockResolvedValueOnce(configResponse()).mockResolvedValueOnce(new Response('secret-body', { status })) });
      await service.updateRecoveredPassword('recovery-token', 'new-password').catch((error: unknown) => {
        expect(error).toBeInstanceOf(AccountRecoveryRequestError);
        expect((error as AccountRecoveryRequestError).canRetryPassword).toBe(retryable);
        expect(String(error)).not.toContain('secret-body');
      });
    }
  });

  it('rejects null and primitive successful session responses with a fixed error', async () => {
    for (const body of ['null', '"unexpected"', '42']) {
      const service = new AccountAuthService({
        fetchImpl: vi.fn(async () => new Response(body, { status: 200 })),
      });

      await expect(service.exchangeSession({ access_token: 'private-token' } as never))
        .rejects.toThrow('账号验证响应无效');
    }
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

  it('rejects invalid publishable keys and non-project Supabase URLs', () => {
    const invalidKeys = [
      'short-key',
      'a'.repeat(513),
      'sb_publishable+invalid',
    ];
    for (const publishableKey of invalidKeys) {
      expect(() => parseAuthConfig({ ...enabledConfig, publishableKey }))
        .toThrow('账号公开配置无效');
    }
    for (const supabaseUrl of [
      'https://project-ref.supabase.co:8443',
      'https://nested.project-ref.supabase.co',
      'https://.supabase.co',
    ]) {
      expect(() => parseAuthConfig({ ...enabledConfig, supabaseUrl }))
        .toThrow('账号服务地址无效');
    }
  });
});
