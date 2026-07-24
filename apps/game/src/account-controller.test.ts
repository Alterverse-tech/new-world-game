import type { Session, User } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountController,
  accountDisplayName,
  authRedirectUrl,
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

function sessionActions(controller: AccountController): {
  synchronizeSession(session: Session): Promise<void>;
} {
  return controller as unknown as {
    synchronizeSession(session: Session): Promise<void>;
  };
}

class FakeElement extends EventTarget {
  public readonly listenerCalls: Array<{ type: string; options: boolean | AddEventListenerOptions | undefined }> = [];
  public readonly dataset: Record<string, string> = {};
  private readonly classes = new Set<string>();
  public readonly classList = {
    toggle: vi.fn((name: string, force?: boolean) => {
      const enabled = force ?? !this.classes.has(name);
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
      return enabled;
    }),
    contains: vi.fn((name: string) => this.classes.has(name)),
  };
  public textContent = '';
  public value = '';
  public disabled = false;
  public open = false;
  public hidden = false;
  public readonly focusDisabledAtCall: boolean[] = [];
  public readonly focus = vi.fn(() => this.focusDisabledAtCall.push(this.disabled));
  public readonly showModal = vi.fn(() => { this.open = true; });
  public readonly close = vi.fn(() => { this.open = false; });

  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.listenerCalls.push({ type, options });
    super.addEventListener(type, listener, options);
  }

  public closest(): FakeElement {
    return this;
  }

  public toggleAttribute(_name: string, force?: boolean): boolean {
    this.hidden = force ?? true;
    return this.hidden;
  }
}

function initializedController(authService: object, recoveryHash: string | null = null) {
  const element = () => new FakeElement();
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
    'account-login-otp-panel',
    'account-login-otp-email',
    'account-login-otp-input',
    'account-login-otp-resend',
    'account-login-otp-change',
    'account-login-btn',
    'account-register-btn',
    'account-register-dialog',
    'account-register-form',
    'account-register-email',
    'account-register-password',
    'account-register-password-confirm',
    'account-register-code',
    'account-register-code-email',
    'account-register-details',
    'account-register-verify',
    'account-register-message',
    'account-register-submit',
    'account-register-close',
    'account-register-resend',
    'account-register-have-code',
    'account-reset-dialog',
    'account-reset-form',
    'account-reset-email',
    'account-reset-password',
    'account-reset-password-confirm',
    'account-reset-email-panel',
    'account-reset-password-panel',
    'account-reset-message',
    'account-reset-submit',
    'account-reset-close',
    'account-reset-back',
    'account-reset-open',
    'account-auth-close',
    'account-auth-message',
    'start-btn',
    'lobby-asset-account-note',
    'lobby-channel-input',
  ].map((id) => [id, element()]));
  const timeouts: Array<{ id: number; callback: () => void; delay: number }> = [];
  const registrationSteps = ['details', 'verify', 'complete'].map((stage) => {
    const step = element();
    step.dataset.registerStep = stage;
    return step;
  });
  const recoverySteps = ['email', 'password'].map((mode) => {
    const step = element();
    step.dataset.resetStep = mode;
    return step;
  });
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-register-step]') return registrationSteps;
      if (selector === '[data-reset-step]') return recoverySteps;
      return [];
    },
  });
  vi.stubGlobal('window', {
    location: { href: 'https://altverse.fun/', origin: 'https://altverse.fun', reload: vi.fn() },
    history: { replaceState: vi.fn() },
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      const id = timeouts.length + 1;
      timeouts.push({ id, callback, delay });
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      const index = timeouts.findIndex((timeout) => timeout.id === id);
      if (index >= 0) timeouts.splice(index, 1);
    }),
    requestAnimationFrame: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    account: { signedIn: false },
  }), { status: 200 })));
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  return {
    controller: new AccountController(authService as never, recoveryHash),
    elements,
    recoverySteps,
    registrationSteps,
    timeouts,
  };
}

function enableAccountUi(controller: AccountController): void {
  const internals = controller as unknown as {
    state: { ready: boolean; available: boolean; mode: 'guest'; phase: 'guest' };
    render(): void;
  };
  internals.state = { ...internals.state, ready: true, available: true, mode: 'guest', phase: 'guest' };
  internals.render();
}

afterEach(() => {
  vi.restoreAllMocks();
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
    const { controller } = initializedController({ loadConfig, getClient });

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

  it('uses bubbling form and button events and unlocks resend when the cooldown expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const session = { access_token: 'private-access-token', user: user({ email: 'player@example.com' }) } as Session;
    const sendOtp = vi.fn(async () => {});
    const verifyOtp = vi.fn(async () => session);
    const exchangeSession = vi.fn(async () => {});
    const { elements, timeouts } = initializedController({ sendOtp, verifyOtp, exchangeSession });
    const email = elements.get('account-email-input')!;
    email.value = ' Player@Example.COM ';
    const form = elements.get('account-auth-form')!;
    const submit = new Event('submit', { cancelable: true });

    expect(form.dispatchEvent(submit)).toBe(false);
    await vi.waitFor(() => expect(sendOtp).toHaveBeenCalledWith('player@example.com', 'https://altverse.fun/'));

    expect(submit.defaultPrevented).toBe(true);
    expect(form.listenerCalls).toContainEqual({ type: 'submit', options: undefined });
    expect(elements.get('account-login-otp-panel')!.hidden).toBe(false);
    expect(elements.get('account-login-otp-email')!.textContent).toBe('player@example.com');
    expect(timeouts).toHaveLength(1);
    now.mockReturnValue(60_000);
    timeouts[0]!.callback();
    expect(elements.get('account-login-otp-resend')!.disabled).toBe(false);
    expect(elements.get('account-login-otp-resend')!.textContent).toBe('重新发送验证码');
    const token = elements.get('account-login-otp-input')!;
    token.value = '123456';
    const loginButton = elements.get('account-login-btn')!;
    const loginClick = new Event('click', { cancelable: true });
    expect(loginButton.dispatchEvent(loginClick)).toBe(false);
    await vi.waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('player@example.com', '123456'));
    await vi.waitFor(() => expect(exchangeSession).toHaveBeenCalledWith(session));
    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledOnce());
    expect(loginClick.defaultPrevented).toBe(true);
    expect(loginButton.listenerCalls).toContainEqual({ type: 'click', options: undefined });
    expect(elements.get('account-register-btn')!.listenerCalls).toContainEqual({ type: 'click', options: undefined });
  });

  it('remembers a valid lobby channel before reloading after OTP verification', async () => {
    const session = { access_token: 'private-access-token', user: user({ email: 'player@example.com' }) } as Session;
    const sendOtp = vi.fn(async () => {});
    const verifyOtp = vi.fn(async () => session);
    const exchangeSession = vi.fn(async () => {});
    const { elements } = initializedController({ sendOtp, verifyOtp, exchangeSession });
    elements.get('lobby-channel-input')!.value = '778899';
    elements.get('account-email-input')!.value = 'player@example.com';
    elements.get('account-auth-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(sendOtp).toHaveBeenCalledOnce());
    elements.get('account-login-otp-input')!.value = '123456';
    elements.get('account-login-btn')!.dispatchEvent(new Event('click', { cancelable: true }));

    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledOnce());
    expect(sessionStorage.setItem).toHaveBeenCalledWith('whiteroom.auth.return-channel', '778899');
  });

  it('sanitizes bubbling OTP input and auto-verifies exactly six digits', async () => {
    const session = { access_token: 'private-access-token', user: user({ email: 'player@example.com' }) } as Session;
    const sendOtp = vi.fn(async () => {});
    const verifyOtp = vi.fn(async () => session);
    const exchangeSession = vi.fn(async () => {});
    const { controller, elements } = initializedController({ sendOtp, verifyOtp, exchangeSession });
    enableAccountUi(controller);
    elements.get('account-email-input')!.value = 'player@example.com';
    elements.get('account-auth-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(sendOtp).toHaveBeenCalledOnce());
    const otp = elements.get('account-login-otp-input')!;

    otp.value = '12a34';
    otp.dispatchEvent(new Event('input'));
    expect(otp.value).toBe('1234');
    expect(verifyOtp).not.toHaveBeenCalled();

    otp.value = '12a34 5678';
    otp.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('player@example.com', '123456'));
    expect(otp.value).toBe('123456');
    expect(exchangeSession).toHaveBeenCalledWith(session);
    expect(otp.listenerCalls).toContainEqual({ type: 'input', options: undefined });
  });

  it('disables login and close controls while OTP work is in flight', async () => {
    let finishSend!: () => void;
    const sendOtp = vi.fn(() => new Promise<void>((resolve) => { finishSend = resolve; }));
    const { controller, elements } = initializedController({
      sendOtp,
      verifyOtp: vi.fn(async () => ({ access_token: 'private-token' } as Session)),
      exchangeSession: vi.fn(async () => {}),
    });
    enableAccountUi(controller);
    elements.get('account-email-input')!.value = 'player@example.com';
    elements.get('account-auth-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(sendOtp).toHaveBeenCalledOnce());

    expect(elements.get('account-login-btn')!.disabled).toBe(true);
    expect(elements.get('account-auth-close')!.disabled).toBe(true);

    finishSend();
    await vi.waitFor(() => expect(elements.get('account-login-btn')!.disabled).toBe(false));
    expect(elements.get('account-login-otp-input')!.focusDisabledAtCall).toEqual([false]);
  });

  it('clears OTP input when a non-busy dialog is closed or cancelled', () => {
    const { controller, elements } = initializedController({});
    enableAccountUi(controller);
    const dialog = elements.get('account-auth-dialog')!;
    const otp = elements.get('account-login-otp-input')!;

    dialog.open = true;
    otp.value = '123456';
    elements.get('account-auth-close')!.dispatchEvent(new Event('click'));
    expect(dialog.open).toBe(false);
    expect(otp.value).toBe('');

    dialog.open = true;
    otp.value = '654321';
    const cancel = new Event('cancel', { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(otp.value).toBe('');
  });

  it('opens recovery callbacks through ordinary controller wiring without exposing their token', () => {
    const { elements } = initializedController({});
    const service = { sendOtp: vi.fn(), verifyOtp: vi.fn(), exchangeSession: vi.fn(), sendRecoveryEmail: vi.fn(), updateRecoveredPassword: vi.fn() };
    const controller = new AccountController(service as never, '#access_token=recovery-secret&type=recovery');
    expect(elements.get('account-reset-dialog')!.open).toBe(true);
    expect(elements.get('account-reset-password-panel')!.hidden).toBe(false);
    expect(JSON.stringify(controller.getTextState())).not.toContain('recovery-secret');
    elements.get('account-reset-close')!.dispatchEvent(new Event('click'));
    expect(elements.get('account-reset-password')!.value).toBe('');
  });

  it('prefills registration through bubbling click and renders the code target', () => {
    const { elements } = initializedController({});
    const email = elements.get('account-email-input')!;
    email.value = ' Player@Example.COM ';
    elements.get('account-register-btn')!.dispatchEvent(new Event('click'));
    expect(elements.get('account-register-dialog')!.open).toBe(true);
    expect(elements.get('account-register-email')!.value).toBe('player@example.com');
    expect(elements.get('account-register-password')!.focus).toHaveBeenCalled();
  });

  it('guards registration close while an OTP request is busy', async () => {
    let resolveSend!: () => void;
    const { elements } = initializedController({ sendOtp: vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; })), verifyOtp: vi.fn(), setPassword: vi.fn(), exchangeSession: vi.fn() });
    elements.get('account-register-btn')!.dispatchEvent(new Event('click'));
    elements.get('account-register-email')!.value = 'player@example.com';
    elements.get('account-register-password')!.value = 'register-password';
    elements.get('account-register-password-confirm')!.value = 'register-password';
    elements.get('account-register-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(elements.get('account-register-close')!.disabled).toBe(true));
    elements.get('account-register-close')!.dispatchEvent(new Event('click'));
    expect(elements.get('account-register-dialog')!.open).toBe(true);
    resolveSend();
    await vi.waitFor(() => expect(elements.get('account-register-close')!.disabled).toBe(false));
  });

  it('guards recovery close and back while a reset-mail request is busy', async () => {
    let resolveMail!: () => void;
    const { elements } = initializedController({ sendRecoveryEmail: vi.fn(() => new Promise<void>((resolve) => { resolveMail = resolve; })) });
    elements.get('account-reset-open')!.dispatchEvent(new Event('click'));
    elements.get('account-reset-email')!.value = 'player@example.com';
    elements.get('account-reset-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(elements.get('account-reset-close')!.disabled).toBe(true));
    elements.get('account-reset-back')!.dispatchEvent(new Event('click'));
    expect(elements.get('account-reset-dialog')!.open).toBe(true);
    resolveMail();
    await vi.waitFor(() => expect(elements.get('account-reset-back')!.disabled).toBe(false));
  });

  it('sanitizes a bubbling registration OTP input and auto-submits six digits', async () => {
    const verifyOtp = vi.fn(async () => ({ access_token: 'token' } as Session));
    const { elements } = initializedController({ sendOtp: vi.fn(async () => {}), verifyOtp, setPassword: vi.fn(async () => {}), exchangeSession: vi.fn(async () => {}) });
    elements.get('account-register-btn')!.dispatchEvent(new Event('click')); elements.get('account-register-email')!.value = 'player@example.com'; elements.get('account-register-password')!.value = 'register-password'; elements.get('account-register-password-confirm')!.value = 'register-password'; elements.get('account-register-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(elements.get('account-register-code-email')!.textContent).toBe('player@example.com'));
    const code = elements.get('account-register-code')!; code.value = '12a34 5678'; code.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('player@example.com', '123456')); expect(code.value).toBe('123456');
  });

  it('renders registration completion steps and the completed submit label', async () => {
    const session = { access_token: 'private-token' } as Session;
    const { elements, registrationSteps } = initializedController({
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => session),
      setPassword: vi.fn(async () => {}),
      exchangeSession: vi.fn(async () => {}),
    });
    elements.get('account-register-btn')!.dispatchEvent(new Event('click'));
    elements.get('account-register-email')!.value = 'player@example.com';
    elements.get('account-register-password')!.value = 'register-password';
    elements.get('account-register-password-confirm')!.value = 'register-password';
    elements.get('account-register-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(elements.get('account-register-code')!.disabled).toBe(false));
    elements.get('account-register-code')!.value = '123456';
    elements.get('account-register-form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    await vi.waitFor(() => expect(elements.get('account-register-submit')!.textContent).toBe('注册完成'));
    expect(registrationSteps[0]!.classList.contains('is-complete')).toBe(true);
    expect(registrationSteps[0]!.classList.contains('is-active')).toBe(false);
    expect(registrationSteps[1]!.classList.contains('is-complete')).toBe(true);
    expect(registrationSteps[1]!.classList.contains('is-active')).toBe(false);
    expect(registrationSteps[2]!.classList.contains('is-complete')).toBe(false);
    expect(registrationSteps[2]!.classList.contains('is-active')).toBe(true);
  });

  it('renders recovery email and password step progress', () => {
    const { recoverySteps } = initializedController({});
    expect(recoverySteps[0]!.classList.contains('is-active')).toBe(true);
    expect(recoverySteps[0]!.classList.contains('is-complete')).toBe(false);
    expect(recoverySteps[1]!.classList.contains('is-active')).toBe(false);
    expect(recoverySteps[1]!.classList.contains('is-complete')).toBe(false);

    const service = {
      sendRecoveryEmail: vi.fn(),
      updateRecoveredPassword: vi.fn(),
    };
    const controller = new AccountController(service as never, '#access_token=recovery-secret&type=recovery');
    expect(controller.getTextState()).not.toHaveProperty('accessToken');
    expect(recoverySteps[0]!.classList.contains('is-active')).toBe(false);
    expect(recoverySteps[0]!.classList.contains('is-complete')).toBe(true);
    expect(recoverySteps[1]!.classList.contains('is-active')).toBe(true);
    expect(recoverySteps[1]!.classList.contains('is-complete')).toBe(false);
  });

  it('returns a successful password recovery to login after 650ms', async () => {
    vi.useFakeTimers();
    try {
      const updateRecoveredPassword = vi.fn(async () => {});
      const { controller, elements } = initializedController(
        { updateRecoveredPassword },
        '#access_token=recovery-secret&type=recovery',
      );
      enableAccountUi(controller);
      elements.get('account-reset-email')!.value = 'player@example.com';
      elements.get('account-reset-password')!.value = 'new-password';
      elements.get('account-reset-password-confirm')!.value = 'new-password';
      elements.get('account-reset-form')!.dispatchEvent(new Event('submit', { cancelable: true }));

      await vi.advanceTimersByTimeAsync(0);
      expect(updateRecoveredPassword).toHaveBeenCalledWith('recovery-secret', 'new-password');
      expect(elements.get('account-reset-password')!.value).toBe('');
      expect(elements.get('account-reset-password-confirm')!.value).toBe('');
      expect(elements.get('account-reset-dialog')!.open).toBe(true);
      expect(elements.get('account-auth-dialog')!.open).toBe(false);

      await vi.advanceTimersByTimeAsync(649);
      expect(elements.get('account-reset-dialog')!.open).toBe(true);
      await vi.advanceTimersByTimeAsync(1);

      expect(elements.get('account-reset-dialog')!.open).toBe(false);
      expect(elements.get('account-auth-dialog')!.open).toBe(true);
      expect(elements.get('account-email-input')!.value).toBe('player@example.com');
      expect(elements.get('account-auth-message')!.textContent).toBe('密码已更新，请使用新密码登录。');
      expect(elements.get('account-auth-message')!.dataset.state).toBe('success');
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefills reset email through bubbling open and visibly ticks registration resend', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0); const { elements, timeouts } = initializedController({ sendOtp: vi.fn(async () => {}) });
    elements.get('account-email-input')!.value = ' Player@Example.COM '; elements.get('account-reset-open')!.dispatchEvent(new Event('click'));
    expect(elements.get('account-reset-email')!.value).toBe('player@example.com');
    elements.get('account-register-btn')!.dispatchEvent(new Event('click')); elements.get('account-register-email')!.value = 'player@example.com'; elements.get('account-register-password')!.value = 'register-password'; elements.get('account-register-password-confirm')!.value = 'register-password'; elements.get('account-register-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(elements.get('account-register-resend')!.textContent).toBe('重新发送验证码（60s）')); expect(elements.get('account-register-resend')!.disabled).toBe(true);
    now.mockReturnValue(60_000); timeouts.at(-1)!.callback(); expect(elements.get('account-register-resend')!.disabled).toBe(false);
  });

  it('signs out locally after clearing the server session and redacts provider errors', async () => {
    const reload = vi.fn();
    const signOut = vi.fn(async () => ({ error: null }));
    const logout = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('fetch', logout);
    const controller = bareController({ mode: 'email', client: { auth: { signOut } } });

    await (controller as unknown as { signOut(): Promise<void> }).signOut();

    expect(logout).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(reload).toHaveBeenCalledOnce();

    const failing = bareController({
      mode: 'email', client: { auth: { signOut: vi.fn(async () => ({ error: new Error('provider secret') })) } },
    });
    await (failing as unknown as { signOut(): Promise<void> }).signOut();
    expect((failing as unknown as { state: { message: string } }).state.message).not.toContain('provider secret');
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
