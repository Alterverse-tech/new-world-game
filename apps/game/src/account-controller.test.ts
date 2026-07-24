import type { Session, User } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountController,
  accountDisplayName,
  authRedirectUrl,
  isAccountPasswordValid,
  normalizeAccountEmail,
  parseAuthConfig,
} from './account-controller';

function user(overrides: Partial<User> = {}): User {
  return {
    id: '8a91ccf8-b592-4a18-bba8-61baa6154ba6',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  } as User;
}

interface FakeProfileRow {
  display_name: string | null;
  game_nickname: string | null;
  avatar_id: string | null;
}

function bareController(options: {
  mode: 'guest' | 'email';
  client?: object | null;
  currentUser?: User | null;
  profile?: FakeProfileRow | null;
  profileLoaded?: boolean;
  onRender?: () => void;
}): AccountController {
  const controller = Object.create(AccountController.prototype) as AccountController;
  Object.assign(controller, {
    client: options.client ?? null,
    currentUser: options.currentUser ?? null,
    profileRow: options.profile ?? null,
    state: {
      ready: true,
      available: true,
      mode: options.mode,
      phase: options.mode === 'email' ? 'signed_in' : 'guest',
      displayName: null,
      email: null,
      profileLoaded: options.profileLoaded ?? Boolean(options.profile),
      message: '',
    },
    render: options.onRender ?? (() => {}),
  });
  return controller;
}

function authActions(controller: AccountController): {
  signInWithPassword(): Promise<void>;
  signUp(): Promise<void>;
} {
  return controller as unknown as {
    signInWithPassword(): Promise<void>;
    signUp(): Promise<void>;
  };
}

function sessionActions(controller: AccountController): {
  synchronizeSession(session: Session): Promise<void>;
} {
  return controller as unknown as {
    synchronizeSession(session: Session): Promise<void>;
  };
}

function initializedController(authService: object): AccountController {
  const element = () => ({
    dataset: {},
    textContent: '',
    value: '',
    disabled: false,
    open: false,
    classList: { toggle: vi.fn() },
    addEventListener: vi.fn(),
    focus: vi.fn(),
    showModal: vi.fn(),
    close: vi.fn(),
  });
  const elements = new Map([
    'account-panel',
    'account-user-name',
    'account-status',
    'account-login-open-btn',
    'account-signout-btn',
    'settings-account',
    'settings-account-status',
    'settings-account-action',
    'account-auth-dialog',
    'account-auth-form',
    'account-email-input',
    'account-password-input',
    'account-login-btn',
    'account-register-btn',
    'account-auth-close',
    'account-auth-message',
    'start-btn',
    'lobby-asset-account-note',
  ].map((id) => [id, element()]));
  vi.stubGlobal('document', { getElementById: (id: string) => elements.get(id) ?? null });
  vi.stubGlobal('window', {
    location: { href: 'https://altverse.fun/' },
    history: { replaceState: vi.fn() },
    setTimeout: vi.fn(),
    requestAnimationFrame: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    account: { signedIn: false },
  }), { status: 200 })));
  return new AccountController(authService as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account config', () => {
  it('parses disabled and enabled email auth configurations', () => {
    expect(parseAuthConfig({ enabled: false, provider: 'email' })).toEqual({
      enabled: false,
      provider: 'email',
    });
    expect(parseAuthConfig({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://project-ref.supabase.co/',
      publishableKey: 'sb_publishable_example',
    })).toEqual({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
  });

  it('rejects malformed, ambiguous, or unsafe account configurations', () => {
    expect(() => parseAuthConfig(null)).toThrow('账号配置响应无效');
    expect(() => parseAuthConfig({ enabled: 'yes', provider: 'email' })).toThrow('账号配置响应无效');
    expect(() => parseAuthConfig({ enabled: false, provider: 'google' })).toThrow('账号登录方式无效');
    expect(() => parseAuthConfig({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'http://project-ref.supabase.co',
      publishableKey: 'sb_publishable_example',
    })).toThrow('账号服务地址无效');
    expect(() => parseAuthConfig({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://project-ref.supabase.co/auth/v1',
      publishableKey: 'sb_publishable_example',
    })).toThrow('账号服务地址无效');
    expect(() => parseAuthConfig({
      enabled: true,
      provider: 'email',
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'not a valid key',
    })).toThrow('账号公开配置无效');
  });
});

describe('account email confirmation redirect', () => {
  it('always returns to the site root so relative Vite assets remain loadable', () => {
    expect(authRedirectUrl({ origin: 'https://altverse.fun' })).toBe('https://altverse.fun/');
    expect(authRedirectUrl({ origin: 'http://127.0.0.1:5173' })).toBe('http://127.0.0.1:5173/');
  });
});

describe('account credentials', () => {
  it('normalizes reasonable email addresses and rejects malformed values', () => {
    expect(normalizeAccountEmail('  Player.Name+world@Example.COM ')).toBe('player.name+world@example.com');
    for (const invalid of [
      '',
      'player',
      '@example.com',
      'player@example',
      '.player@example.com',
      'player..name@example.com',
      'player@-example.com',
      'player@example-.com',
      'player @example.com',
    ]) expect(normalizeAccountEmail(invalid)).toBeNull();
  });

  it('accepts passwords containing 8–72 characters without trimming or exposing them', () => {
    expect(isAccountPasswordValid('1234567')).toBe(false);
    expect(isAccountPasswordValid('12345678')).toBe(true);
    expect(isAccountPasswordValid('🔐'.repeat(8))).toBe(true);
    expect(isAccountPasswordValid('x'.repeat(72))).toBe(true);
    expect(isAccountPasswordValid('x'.repeat(73))).toBe(false);
    expect(isAccountPasswordValid(null)).toBe(false);
  });
});

describe('account display name', () => {
  it('prefers the game nickname, profile display name, auth metadata, then email', () => {
    const emailUser = user({
      email: 'email-player@example.com',
      user_metadata: { full_name: 'Account Full Name', name: 'Account Name' },
    });
    expect(accountDisplayName(emailUser, {
      game_nickname: '  Lobby   Hero  ',
      display_name: 'Profile Name',
      avatar_id: null,
    })).toBe('Lobby Hero');
    expect(accountDisplayName(emailUser, {
      game_nickname: '   ',
      display_name: 'Profile Name',
      avatar_id: null,
    })).toBe('Profile Name');
    expect(accountDisplayName(emailUser, null)).toBe('Account Full Name');
    expect(accountDisplayName(user({
      email: 'email-player@example.com',
      user_metadata: { name: 'Account Name' },
    }), null)).toBe('Account Name');
    expect(accountDisplayName(user({ email: 'email-player@example.com' }), null)).toBe('email-player');
    expect(accountDisplayName(user(), null)).toBe('WhiteRoom 玩家');
  });
});

describe('email auth operations', () => {
  it('initializes through the injected auth service', async () => {
    const client = {
      auth: {
        onAuthStateChange: vi.fn(),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
    };
    const loadConfig = vi.fn(async () => ({
      enabled: true as const,
      provider: 'email' as const,
      supabaseUrl: 'https://project-ref.supabase.co',
      publishableKey: 'sb_publishable_example',
    }));
    const getClient = vi.fn(async () => client);
    const controller = initializedController({ loadConfig, getClient });

    await controller.initialize();

    expect(loadConfig).toHaveBeenCalledOnce();
    expect(getClient).toHaveBeenCalledOnce();
    expect(client.auth.onAuthStateChange).toHaveBeenCalledOnce();
    expect(client.auth.getSession).toHaveBeenCalledOnce();
    expect(controller.getTextState()).toMatchObject({
      ready: true,
      available: true,
      mode: 'guest',
      phase: 'guest',
    });
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/config', expect.anything());
  });

  it('delegates password-login session exchange to the injected auth service', async () => {
    const session = {
      access_token: 'private-access-token',
      user: user({ email: 'player@example.com' }),
    } as Session;
    const exchangeSession = vi.fn(async () => {});
    const loadProfile = vi.fn(async () => ({ loaded: false, row: null }));
    const controller = bareController({ mode: 'guest' });
    Object.assign(controller, {
      authService: { exchangeSession },
      loadProfile,
    });

    await sessionActions(controller).synchronizeSession(session);

    expect(exchangeSession).toHaveBeenCalledWith(session);
    expect(loadProfile).toHaveBeenCalledWith(session.user);
    expect(JSON.stringify(controller.getTextState())).not.toContain('private-access-token');
  });

  it('signs in with normalized email/password and forwards only the returned session for exchange', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const passwordInput = { value: 'correct horse battery staple', focus: vi.fn() };
    const emailInput = { value: ' Player@Example.COM ', focus: vi.fn() };
    const session = { access_token: 'private-access-token', user: user({ email: 'player@example.com' }) };
    const signInWithPassword = vi.fn(async () => ({ data: { session }, error: null }));
    const synchronize = vi.fn(async () => {});
    const close = vi.fn();
    const controller = bareController({ mode: 'guest' });
    Object.assign(controller, {
      client: { auth: { signInWithPassword } },
      emailInput,
      passwordInput,
      enqueueSessionSync: synchronize,
      closeAuthDialog: close,
    });

    await authActions(controller).signInWithPassword();

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'correct horse battery staple',
    });
    expect(synchronize).toHaveBeenCalledWith(session);
    expect(close).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(passwordInput.value).toBe('');
    expect(JSON.stringify(controller.getTextState())).not.toContain('private-access-token');
  });

  it('registers with a root-domain confirmation redirect and waits safely for email confirmation', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://altverse.fun' } });
    const passwordInput = { value: 'register-password', focus: vi.fn() };
    const emailInput = { value: 'new-player@example.com', focus: vi.fn() };
    const signUp = vi.fn(async () => ({ data: { session: null, user: user() }, error: null }));
    const controller = bareController({ mode: 'guest' });
    Object.assign(controller, {
      client: { auth: { signUp } },
      emailInput,
      passwordInput,
    });

    await authActions(controller).signUp();

    expect(signUp).toHaveBeenCalledWith({
      email: 'new-player@example.com',
      password: 'register-password',
      options: { emailRedirectTo: 'https://altverse.fun/' },
    });
    expect(controller.getTextState()).toMatchObject({ mode: 'guest', phase: 'guest' });
    expect(passwordInput.value).toBe('');
  });

  it('reloads after an immediately confirmed registration so the account profile is applied', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://altverse.fun', reload } });
    const passwordInput = { value: 'register-password', focus: vi.fn() };
    const emailInput = { value: 'new-player@example.com', focus: vi.fn() };
    const session = { access_token: 'private-access-token', user: user({ email: 'new-player@example.com' }) };
    const signUp = vi.fn(async () => ({ data: { session, user: session.user }, error: null }));
    const synchronize = vi.fn(async () => {});
    const close = vi.fn();
    const controller = bareController({ mode: 'guest' });
    Object.assign(controller, {
      client: { auth: { signUp } },
      emailInput,
      passwordInput,
      enqueueSessionSync: synchronize,
      closeAuthDialog: close,
    });

    await authActions(controller).signUp();

    expect(synchronize).toHaveBeenCalledWith(session);
    expect(close).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(passwordInput.value).toBe('');
  });

  it('does not send invalid credentials to Supabase', async () => {
    const signInWithPassword = vi.fn();
    const controller = bareController({ mode: 'guest' });
    Object.assign(controller, {
      client: { auth: { signInWithPassword } },
      emailInput: { value: 'not-an-email', focus: vi.fn() },
      passwordInput: { value: 'short', focus: vi.fn() },
    });

    await authActions(controller).signInWithPassword();

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(controller.getTextState().phase).toBe('error');
  });
});

describe('account player profile', () => {
  it('returns only the loaded player nickname and Avatar without identity credentials', () => {
    const identity = user({ email: 'player@example.com' });
    const controller = bareController({
      mode: 'email',
      currentUser: identity,
      profile: {
        display_name: 'Account Player',
        game_nickname: '  Lobby   Player ',
        avatar_id: 'PRESET-INK-CHIBI',
      },
    });
    const profile = controller.getPlayerProfile();
    expect(profile).toEqual({ gameNickname: 'Lobby Player', avatarId: 'preset-ink-chibi' });
    expect(JSON.stringify(profile)).not.toContain(identity.id);
    expect(JSON.stringify(profile)).not.toContain('access_token');
    expect(bareController({ mode: 'guest', profile: null }).getPlayerProfile()).toBeNull();
    expect(bareController({
      mode: 'email',
      profile: { display_name: null, game_nickname: null, avatar_id: null },
      profileLoaded: false,
    }).getPlayerProfile()).toBeNull();
  });

  it('updates only the signed-in user row and refreshes the in-memory profile', async () => {
    const identity = user();
    const calls: Array<{ table: string; values: unknown; column: string; value: string }> = [];
    const returned = {
      display_name: 'Original Name',
      game_nickname: 'New Hero',
      avatar_id: 'preset-cloud-doll',
    };
    const client = {
      from(table: string) {
        return {
          update(values: unknown) {
            return {
              eq(column: string, value: string) {
                calls.push({ table, values, column, value });
                return {
                  select() {
                    return { single: async () => ({ data: returned, error: null }) };
                  },
                };
              },
            };
          },
        };
      },
    };
    let renders = 0;
    const controller = bareController({
      mode: 'email',
      client,
      currentUser: identity,
      profile: { display_name: 'Original Name', game_nickname: 'Old Hero', avatar_id: null },
      onRender: () => { renders += 1; },
    });

    await controller.savePlayerProfile('  New   Hero ', 'PRESET-CLOUD-DOLL');

    expect(calls).toEqual([{
      table: 'profiles',
      values: { game_nickname: 'New Hero', avatar_id: 'preset-cloud-doll' },
      column: 'id',
      value: identity.id,
    }]);
    expect(controller.getPlayerProfile()).toEqual({
      gameNickname: 'New Hero',
      avatarId: 'preset-cloud-doll',
    });
    expect(renders).toBe(1);
  });

  it('is a safe no-op for guests and throws a redacted error on a signed-in write failure', async () => {
    let guestWrites = 0;
    const guest = bareController({
      mode: 'guest',
      client: { from: () => { guestWrites += 1; } },
      currentUser: null,
    });
    await expect(guest.savePlayerProfile('Guest', 'bad')).resolves.toBeUndefined();
    expect(guestWrites).toBe(0);

    const identity = user();
    const failingClient = {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  select() {
                    return {
                      single: async () => ({
                        data: null,
                        error: { message: `secret token for ${identity.id}` },
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const signedIn = bareController({
      mode: 'email',
      client: failingClient,
      currentUser: identity,
      profile: { display_name: null, game_nickname: 'Before', avatar_id: null },
    });
    let caught: unknown;
    try {
      await signedIn.savePlayerProfile('After', 'preset-ink-chibi');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('玩家资料保存失败，请稍后重试');
    expect((caught as Error).message).not.toContain(identity.id);
    expect((caught as Error).message).not.toContain('token');
    expect(signedIn.getPlayerProfile()).toEqual({ gameNickname: 'Before', avatarId: null });
  });
});
