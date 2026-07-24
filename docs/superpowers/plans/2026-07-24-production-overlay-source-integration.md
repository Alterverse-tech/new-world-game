# WhiteRoom Production Overlay Source Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `public/game` 当前通过 overlay 和压缩 bundle 补丁提供的账号、玩家状态、退出游戏和本地昵称行为，回收到 `apps/game` 的可维护源码与自动化测试中，同时保持 `public/game` 不变。

**Architecture:** `AccountController` 继续拥有账号生命周期，但使用唯一的 `AccountAuthService` 和三个可测试 flow；`LobbyMultiplayer` 继续唯一持有多人 WebSocket，并把 telemetry 交给独立控制器；退出和昵称行为直接接入现有游戏类。每个功能切片遵循 red-green-refactor，单独提交并保持候选源码可运行。

**Tech Stack:** Node.js 20+、TypeScript 5.8.3、Vite 7.3.6、Vitest 3.2.7、Three.js 0.179.1、Supabase JS 2.109.0、Node test runner。

---

## 执行边界

- 工作目录：`C:\Users\jimmy\OneDrive\Documents\Altverse\new-world-game`
- 分支：`codex/game-source-integration`
- 设计依据：`docs/superpowers/specs/2026-07-24-production-overlay-source-integration-design.md`
- 禁止修改：`public/game/**`
- 不在本计划中删除生产 overlay；只有后续行为对照和发布切换阶段才处理生产成品。
- 每个任务提交前运行该任务的定向测试；Task 8 再运行完整平台与游戏验证。

## 文件结构

### 新文件

- `apps/game/src/account-auth-service.ts`：唯一 Supabase 客户端、认证网络调用和服务端 session 交换。
- `apps/game/src/account-auth-service.test.ts`：认证 service 的网络、安全和单例契约。
- `apps/game/src/account-login-flow.ts`：OTP 登录状态机与 DOM port。
- `apps/game/src/account-login-flow.test.ts`：OTP 校验、冷却、自动提交和清理。
- `apps/game/src/account-registration-flow.ts`：邮箱、密码、OTP 注册状态机。
- `apps/game/src/account-registration-flow.test.ts`：注册状态、密码清理和错误恢复。
- `apps/game/src/account-recovery-flow.ts`：recovery hash、恢复邮件和新密码状态机。
- `apps/game/src/account-recovery-flow.test.ts`：hash 清理、枚举安全和 token 生命周期。
- `apps/game/src/player-telemetry.ts`：玩家 telemetry 模型、采样、定时器和 UI 渲染。
- `apps/game/src/player-telemetry.test.ts`：telemetry 规范化、状态与资源释放。

### 修改文件

- `apps/game/index.html`：加入生产账号、玩家状态和退出按钮 DOM。
- `apps/game/src/openai-theme.css`：合并生产 overlay 样式。
- `apps/game/src/main.ts`：在账号初始化前捕获 recovery hash。
- `apps/game/src/account-controller.ts`：组合 service 和三个 flow，保留账号/Profile 单一权威状态。
- `apps/game/src/account-controller.test.ts`：更新 service 注入和现有账号回归测试。
- `apps/game/src/lobby-multiplayer.ts`：解析 telemetry，通过现有 socket 收发，并保持本地昵称可见。
- `apps/game/src/lobby-multiplayer.test.ts`：多人 telemetry 与昵称回归测试。
- `apps/game/src/white-room-game.ts`：绑定退出按钮。
- `apps/game/src/white-room-game.test.ts`：退出行为回归测试。
- `test/game-source-integration.test.js`：源码拥有生产功能且不引用 legacy overlay 的仓库契约。
- `docs/source-recovery/v39-v30.md`：记录 overlay 已源码化但生产切换仍未发生。

## Task 1：建立唯一账号认证 Service

**Files:**

- Create: `apps/game/src/account-auth-service.ts`
- Create: `apps/game/src/account-auth-service.test.ts`
- Modify: `apps/game/src/account-controller.ts`
- Modify: `apps/game/src/account-controller.test.ts`

- [ ] **Step 1：先写失败的 service 测试**

创建以下最小契约；测试必须验证配置只请求一次、Supabase 客户端只创建一次、OTP 不泄露秘密、session 只发到同源交换接口：

```ts
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
    const service = new AccountAuthService({ fetchImpl, createClientImpl });

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
});
```

- [ ] **Step 2：运行测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-auth-service.test.ts
```

Expected: FAIL，错误包含 `Cannot find module './account-auth-service'`。

- [ ] **Step 3：实现 service，并让现有 AccountController 使用它**

`account-auth-service.ts` 使用以下公开 API；所有请求都必须带明确的 credentials/cache，错误信息不得包含响应体或 token：

```ts
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

export interface EnabledAuthConfig {
  enabled: true;
  provider: 'email';
  supabaseUrl: string;
  publishableKey: string;
}

export interface DisabledAuthConfig {
  enabled: false;
  provider: 'email';
}

export type AuthConfig = EnabledAuthConfig | DisabledAuthConfig;

interface AuthServiceDependencies {
  fetchImpl?: typeof fetch;
  createClientImpl?: typeof createClient;
}

export function authRedirectUrl(locationLike: Pick<Location, 'origin'>): string {
  return new URL('/', locationLike.origin).href;
}

export function parseAuthConfig(value: unknown): AuthConfig {
  if (!value || typeof value !== 'object') throw new Error('账号配置响应无效');
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') throw new Error('账号配置响应无效');
  if (record.provider !== 'email') throw new Error('账号登录方式无效');
  if (!record.enabled) return { enabled: false, provider: 'email' };
  if (typeof record.supabaseUrl !== 'string' || typeof record.publishableKey !== 'string') {
    throw new Error('账号配置响应无效');
  }
  const url = new URL(record.supabaseUrl);
  if (url.protocol !== 'https:' || url.pathname !== '/' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('账号服务地址无效');
  }
  if (!/^[A-Za-z0-9._-]{16,512}$/u.test(record.publishableKey)) {
    throw new Error('账号公开配置无效');
  }
  return {
    enabled: true,
    provider: 'email',
    supabaseUrl: url.origin,
    publishableKey: record.publishableKey,
  };
}

export class AccountAuthService {
  private readonly fetchImpl: typeof fetch;
  private readonly createClientImpl: typeof createClient;
  private configPromise: Promise<AuthConfig> | null = null;
  private clientPromise: Promise<SupabaseClient> | null = null;

  public constructor(dependencies: AuthServiceDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.createClientImpl = dependencies.createClientImpl ?? createClient;
  }

  public loadConfig(): Promise<AuthConfig> {
    this.configPromise ??= this.fetchImpl('/api/auth/config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`账号配置 HTTP ${response.status}`);
      return parseAuthConfig(await response.json());
    }).catch((error) => {
      this.configPromise = null;
      throw error;
    });
    return this.configPromise;
  }

  public getClient(): Promise<SupabaseClient> {
    this.clientPromise ??= this.loadConfig().then((config) => {
      if (!config.enabled) throw new Error('邮箱账号服务尚未启用');
      return this.createClientImpl(config.supabaseUrl, config.publishableKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          autoRefreshToken: true,
          persistSession: true,
        },
      });
    }).catch((error) => {
      this.clientPromise = null;
      throw error;
    });
    return this.clientPromise;
  }

  public async sendOtp(email: string, redirectTo: string): Promise<void> {
    const client = await this.getClient();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  public async verifyOtp(email: string, token: string): Promise<Session> {
    const client = await this.getClient();
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    if (!data.session) throw new Error('Supabase 未返回登录会话');
    return data.session;
  }

  public async exchangeSession(session: Session): Promise<void> {
    const response = await this.fetchImpl('/api/auth/session', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`账号校验 HTTP ${response.status}`);
    const payload = await response.json() as { account?: { signedIn?: boolean } };
    if (payload.account?.signedIn !== true) throw new Error('账号校验响应无效');
  }
}
```

在 `account-controller.ts` 中删除本地 `parseAuthConfig`、`authRedirectUrl` 和直接 `createClient` 调用，改为：

```ts
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import {
  AccountAuthService,
  authRedirectUrl,
  parseAuthConfig,
} from './account-auth-service';

export { authRedirectUrl, parseAuthConfig } from './account-auth-service';

export class AccountController {
  private readonly authService: AccountAuthService;
  private client: SupabaseClient | null = null;

  public constructor(authService = new AccountAuthService()) {
    this.authService = authService;
    // 保留现有事件绑定；Task 2 才替换登录流程。
  }
}
```

`initialize()` 通过 `await this.authService.loadConfig()` 和 `await this.authService.getClient()` 获取同一个配置与客户端；现有 password 登录、退出、profile 读写行为在本提交中保持不变。

- [ ] **Step 4：运行定向回归**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-auth-service.test.ts src/account-controller.test.ts
```

Expected: 两个测试文件全部 PASS。

- [ ] **Step 5：提交 service 切片**

```text
git add apps/game/src/account-auth-service.ts apps/game/src/account-auth-service.test.ts apps/game/src/account-controller.ts apps/game/src/account-controller.test.ts
git commit -m "refactor: centralize game account auth service"
```

## Task 2：回收生产 OTP 登录

**Files:**

- Create: `apps/game/src/account-login-flow.ts`
- Create: `apps/game/src/account-login-flow.test.ts`
- Modify: `apps/game/index.html`
- Modify: `apps/game/src/openai-theme.css`
- Modify: `apps/game/src/account-controller.ts`
- Modify: `apps/game/src/account-controller.test.ts`

- [ ] **Step 1：写 OTP 状态机失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { AccountLoginFlow, type AccountLoginPort } from './account-login-flow';

function port(): AccountLoginPort {
  return {
    readEmail: vi.fn(() => ' Player@Example.COM '),
    readToken: vi.fn(() => '123456'),
    render: vi.fn(),
    clearToken: vi.fn(),
    focusEmail: vi.fn(),
    focusToken: vi.fn(),
  };
}

describe('AccountLoginFlow', () => {
  it('sends OTP, verifies six digits, exchanges the session, and reloads', async () => {
    const view = port();
    const session = { access_token: 'secret' };
    const service = {
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => session),
      exchangeSession: vi.fn(async () => {}),
    };
    const reload = vi.fn();
    const flow = new AccountLoginFlow({
      port: view,
      service,
      storage: new Map(),
      now: () => 1_000,
      redirectTo: 'https://altverse.fun/',
      reload,
    });

    await flow.submit();
    expect(service.sendOtp).toHaveBeenCalledWith('player@example.com', 'https://altverse.fun/');
    expect(flow.getState()).toMatchObject({ stage: 'verify', email: 'player@example.com' });

    await flow.submit();
    expect(service.verifyOtp).toHaveBeenCalledWith('player@example.com', '123456');
    expect(service.exchangeSession).toHaveBeenCalledWith(session);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('restores an email-scoped cooldown and rejects malformed tokens', async () => {
    const view = port();
    const storage = new Map<string, string>();
    storage.set('whiteroom.auth.login-otp-cooldown.v1', JSON.stringify({
      email: 'player@example.com',
      until: 61_000,
    }));
    const service = {
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => ({ access_token: 'secret' })),
      exchangeSession: vi.fn(async () => {}),
    };
    const flow = new AccountLoginFlow({
      port: view,
      service,
      storage,
      now: () => 2_000,
      redirectTo: 'https://altverse.fun/',
      reload: vi.fn(),
    });

    await flow.submit();
    expect(service.sendOtp).not.toHaveBeenCalled();
    expect(flow.getState()).toMatchObject({ stage: 'verify', cooldownSeconds: 59 });
    vi.mocked(view.readToken).mockReturnValue('12ab');
    await flow.submit();
    expect(service.verifyOtp).not.toHaveBeenCalled();
    expect(flow.getState().messageState).toBe('error');
  });
});
```

- [ ] **Step 2：运行测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-login-flow.test.ts
```

Expected: FAIL，错误包含 `Cannot find module './account-login-flow'`。

- [ ] **Step 3：实现 OTP flow**

公开接口固定为：

```ts
import type { Session } from '@supabase/supabase-js';
import { normalizeAccountEmail } from './account-controller';

export type LoginStage = 'email' | 'verify';
export type AuthMessageState = 'guest' | 'loading' | 'success' | 'error';

export interface AccountLoginPort {
  readEmail(): string;
  readToken(): string;
  render(state: AccountLoginState): void;
  clearToken(): void;
  focusEmail(): void;
  focusToken(): void;
}

export interface AccountLoginState {
  stage: LoginStage;
  busy: boolean;
  email: string;
  cooldownSeconds: number;
  message: string;
  messageState: AuthMessageState;
}

export interface StoragePort {
  get(key: string): string | undefined;
  set(key: string, value: string): unknown;
  delete(key: string): unknown;
}

export function browserStoragePort(storage: Storage): StoragePort {
  return {
    get: (key) => storage.getItem(key) ?? undefined,
    set: (key, value) => storage.setItem(key, value),
    delete: (key) => storage.removeItem(key),
  };
}

interface LoginService {
  sendOtp(email: string, redirectTo: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<Session>;
  exchangeSession(session: Session): Promise<void>;
}

export class AccountLoginFlow {
  public constructor(private readonly dependencies: {
    port: AccountLoginPort;
    service: LoginService;
    storage: StoragePort;
    now: () => number;
    redirectTo: string;
    reload: () => void;
  }) {}

  public getState(): Readonly<AccountLoginState>;
  public open(): void;
  public changeEmail(): void;
  public async resend(): Promise<void>;
  public async submit(): Promise<void>;
  public updateCooldown(): void;
}
```

实现必须使用常量：

```ts
const OTP_COOLDOWN_MS = 60_000;
const OTP_COOLDOWN_KEY = 'whiteroom.auth.login-otp-cooldown.v1';
const SIX_DIGITS = /^\d{6}$/u;
```

`submit()` 在 email 阶段规范化邮箱并调用 `sendOtp`；verify 阶段只接受六位数字，依次调用 `verifyOtp`、`exchangeSession`、删除冷却存储和 `reload()`。`finally` 必须恢复 busy；失败时保留 verify 阶段供重试。

- [ ] **Step 4：接入生产 DOM 与样式**

先将 `apps/game/index.html` CSP 中的旧 Supabase origin 精确替换为当前生产 origin：

```text
Remove: https://hwbjybuwgarkitejqism.supabase.co
Allow:  https://uzshphuobuaeyadxgriv.supabase.co
```

保持其他 CSP 指令不变，不同时允许两个 Supabase origin。

从 `public/game/index.html` 向 `apps/game/index.html` 机械复制以下完整节点，保持 ID、中文文案、hidden、autocomplete 和 aria 属性不变：

```text
Source node                         Target anchor
#account-auth-dialog               替换现有 #account-auth-dialog
#account-login-otp-panel           包含在新的 #account-auth-dialog 内
.account-password-legacy           保留 password 兼容字段但 hidden
#account-reset-open                保留 hidden；Task 3 接线
#account-register-btn              保留 hidden；Task 3 接线
```

将 `public/game/assets/account-login-otp-20260722.css` 的完整规则追加到 `apps/game/src/openai-theme.css`；不要把 overlay 文件复制到 `apps/game/public`。

在 `AccountController` 构造函数中创建 DOM port，并用 bubble phase 的普通事件直接调用 flow；不得使用 capture phase、`stopImmediatePropagation` 或 `MutationObserver`：

```ts
this.loginFlow = new AccountLoginFlow({
  port: createAccountLoginDomPort(),
  service: this.authService,
  storage: browserStoragePort(sessionStorage),
  now: Date.now,
  redirectTo: authRedirectUrl(window.location),
  reload: () => window.location.reload(),
});

this.authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void this.loginFlow.submit();
});
this.dialogLoginButton.addEventListener('click', (event) => {
  event.preventDefault();
  void this.loginFlow.submit();
});
```

删除 `signInWithPassword()` 和 `readCredentials()` 的调用路径；登录入口文案固定为“邮箱验证码登录”。已登录、退出和 profile 行为保持原实现。

- [ ] **Step 5：运行 OTP 与账号回归**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-login-flow.test.ts src/account-auth-service.test.ts src/account-controller.test.ts
```

Expected: 三个测试文件全部 PASS。

- [ ] **Step 6：提交 OTP 切片**

```text
git add apps/game/index.html apps/game/src/openai-theme.css apps/game/src/account-login-flow.ts apps/game/src/account-login-flow.test.ts apps/game/src/account-controller.ts apps/game/src/account-controller.test.ts
git commit -m "feat: restore source-owned OTP login"
```

## Task 3：回收注册与密码恢复

**Files:**

- Create: `apps/game/src/account-registration-flow.ts`
- Create: `apps/game/src/account-registration-flow.test.ts`
- Create: `apps/game/src/account-recovery-flow.ts`
- Create: `apps/game/src/account-recovery-flow.test.ts`
- Modify: `apps/game/src/account-auth-service.ts`
- Modify: `apps/game/src/account-auth-service.test.ts`
- Modify: `apps/game/src/account-controller.ts`
- Modify: `apps/game/index.html`
- Modify: `apps/game/src/openai-theme.css`
- Modify: `apps/game/src/main.ts`

- [ ] **Step 1：写注册秘密值生命周期失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { AccountRegistrationFlow } from './account-registration-flow';

describe('AccountRegistrationFlow', () => {
  it('verifies email, sets the chosen password, exchanges session, then clears secrets', async () => {
    const port = {
      readDetails: vi.fn(() => ({
        email: 'new@example.com',
        password: 'register-password',
        confirmation: 'register-password',
      })),
      readToken: vi.fn(() => '123456'),
      render: vi.fn(),
      clearSecrets: vi.fn(),
      focus: vi.fn(),
    };
    const session = { access_token: 'secret' };
    const service = {
      sendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => session),
      setPassword: vi.fn(async () => {}),
      exchangeSession: vi.fn(async () => {}),
    };
    const flow = new AccountRegistrationFlow({
      port,
      service,
      storage: new Map(),
      now: () => 1_000,
      redirectTo: 'https://altverse.fun/',
      reload: vi.fn(),
    });

    await flow.submit();
    await flow.submit();

    expect(service.setPassword).toHaveBeenCalledWith('register-password');
    expect(service.exchangeSession).toHaveBeenCalledWith(session);
    expect(port.clearSecrets).toHaveBeenCalled();
    expect(JSON.stringify(flow.getState())).not.toContain('register-password');
    expect(JSON.stringify(flow.getState())).not.toContain('secret');
  });

  it('clears password and token when cancelled', () => {
    const port = {
      readDetails: vi.fn(),
      readToken: vi.fn(),
      render: vi.fn(),
      clearSecrets: vi.fn(),
      focus: vi.fn(),
    };
    const flow = new AccountRegistrationFlow({
      port,
      service: {} as never,
      storage: new Map(),
      now: Date.now,
      redirectTo: 'https://altverse.fun/',
      reload: vi.fn(),
    });
    flow.cancel();
    expect(port.clearSecrets).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2：写 recovery hash 与枚举安全失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  AccountRecoveryFlow,
  captureRecoveryHash,
} from './account-recovery-flow';

describe('account recovery', () => {
  it('captures and removes a recovery hash before auth initialization', () => {
    const replaceState = vi.fn();
    const hash = '#access_token=recovery-secret&type=recovery';
    expect(captureRecoveryHash({
      location: { hash, pathname: '/', search: '?password_reset=1' },
      replaceState,
    })).toBe(hash);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?password_reset=1');
  });

  it('uses an enumeration-safe success message and never exposes the token', async () => {
    const port = {
      readEmail: vi.fn(() => 'player@example.com'),
      readPasswords: vi.fn(() => ({ password: 'new-password', confirmation: 'new-password' })),
      render: vi.fn(),
      clearPasswords: vi.fn(),
      focus: vi.fn(),
    };
    const service = {
      sendRecoveryEmail: vi.fn(async () => {}),
      updateRecoveredPassword: vi.fn(async () => {}),
    };
    const flow = new AccountRecoveryFlow({ port, service });
    await flow.sendEmail('https://altverse.fun/?password_reset=1');
    expect(flow.getState().message).toContain('如果该邮箱已注册');
    flow.openRecovery('#access_token=recovery-secret&type=recovery');
    await flow.updatePassword();
    expect(service.updateRecoveredPassword).toHaveBeenCalledWith('recovery-secret', 'new-password');
    expect(JSON.stringify(flow.getState())).not.toContain('recovery-secret');
  });
});
```

- [ ] **Step 3：运行两个新测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-registration-flow.test.ts src/account-recovery-flow.test.ts
```

Expected: FAIL，两个模块均不存在。

- [ ] **Step 4：扩展 auth service**

新增以下方法并覆盖测试：

```ts
public async setPassword(password: string): Promise<void> {
  const client = await this.getClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

public async sendRecoveryEmail(email: string, redirectTo: string): Promise<void> {
  const config = await this.loadConfig();
  if (!config.enabled) throw new Error('邮箱账号服务尚未启用');
  const endpoint = new URL('/auth/v1/recover', config.supabaseUrl);
  endpoint.searchParams.set('redirect_to', redirectTo);
  const response = await this.fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      apikey: config.publishableKey,
      Authorization: `Bearer ${config.publishableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await safeRecoveryError(response));
}

public async updateRecoveredPassword(accessToken: string, password: string): Promise<void> {
  const config = await this.loadConfig();
  if (!config.enabled) throw new Error('邮箱账号服务尚未启用');
  const response = await this.fetchImpl(new URL('/auth/v1/user', config.supabaseUrl), {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      apikey: config.publishableKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error(await safeRecoveryError(response));
}
```

`safeRecoveryError()` 只映射 `email_address_invalid`、`over_email_send_rate_limit`、`over_request_rate_limit`、`weak_password` 和 `same_password`，其他响应返回固定中文错误，不拼接服务端 body。

- [ ] **Step 5：实现两个 flow**

`AccountRegistrationFlow` 的公开状态与动作：

```ts
import type {
  AuthMessageState,
  StoragePort,
} from './account-login-flow';

export type RegistrationStage = 'details' | 'verify' | 'complete';
export interface RegistrationState {
  stage: RegistrationStage;
  busy: boolean;
  email: string;
  cooldownSeconds: number;
  message: string;
  messageState: AuthMessageState;
}
export class AccountRegistrationFlow {
  public getState(): Readonly<RegistrationState>;
  public open(prefilledEmail: string): void;
  public async submit(): Promise<void>;
  public async resend(): Promise<void>;
  public useExistingCode(): void;
  public cancel(): void;
}
```

密码仅存于类的 private 字段；`getState()` 不返回密码。成功与 `cancel()` 都调用 `port.clearSecrets()` 并把 private 密码置空。冷却 key 固定为 `whiteroom.auth.otp-cooldown.v1`。

`AccountRecoveryFlow` 的公开状态与动作：

```ts
import type { AuthMessageState } from './account-login-flow';

export type RecoveryMode = 'email' | 'password';
export interface RecoveryState {
  mode: RecoveryMode;
  busy: boolean;
  message: string;
  messageState: AuthMessageState;
}
export function captureRecoveryHash(input: {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  replaceState: History['replaceState'];
}): string | null;
export class AccountRecoveryFlow {
  public getState(): Readonly<RecoveryState>;
  public open(prefilledEmail: string): void;
  public openRecovery(hash: string): void;
  public async sendEmail(redirectTo: string): Promise<void>;
  public async updatePassword(): Promise<void>;
  public cancel(): void;
}
```

`captureRecoveryHash()` 只捕获 `type=recovery` 或带 `error` 的 hash，捕获后调用 `replaceState(null, '', pathname + search)`。token 只保存在 private 字段；成功、取消和无效 hash 都清空它。

- [ ] **Step 6：接入完整生产 DOM、CSS 和 main**

从 `public/game/index.html` 机械复制以下完整节点到 `apps/game/index.html`，放在 `#account-auth-dialog` 后、`#hud` 前：

```text
#account-reset-dialog
#account-register-dialog
```

在 OTP 对话框内保留生产中的 `#account-reset-open` 和 `#account-register-btn` hidden 状态，确保当前可见入口仍只有 OTP 登录。

将以下文件的完整 CSS 规则追加到 `apps/game/src/openai-theme.css`：

```text
public/game/assets/account-register-20260721.css
public/game/assets/account-reset-20260721.css
```

`main.ts` 在创建 controller 前捕获 hash：

```ts
import { AccountAuthService } from './account-auth-service';
import { captureRecoveryHash } from './account-recovery-flow';

const recoveryHash = captureRecoveryHash({
  location: window.location,
  replaceState: window.history.replaceState.bind(window.history),
});
const account = new AccountController(new AccountAuthService(), recoveryHash);
```

`AccountController` 构造函数固定为：

```ts
public constructor(
  authService = new AccountAuthService(),
  recoveryHash: string | null = null,
) {
  this.authService = authService;
  // 在现有 DOM 事件绑定中组合 login、registration 和 recovery flow。
  if (recoveryHash) this.recoveryFlow.openRecovery(recoveryHash);
}
```

用普通 click/submit/cancel 事件接线。不得保留独立 bootstrap、document capture listener 或重复 Supabase client。

- [ ] **Step 7：运行完整账号切片测试**

Run:

```text
npm.cmd --prefix apps/game test -- src/account-auth-service.test.ts src/account-login-flow.test.ts src/account-registration-flow.test.ts src/account-recovery-flow.test.ts src/account-controller.test.ts
```

Expected: 五个测试文件全部 PASS。

- [ ] **Step 8：提交注册与恢复切片**

```text
git add apps/game/index.html apps/game/src/openai-theme.css apps/game/src/main.ts apps/game/src/account-auth-service.ts apps/game/src/account-auth-service.test.ts apps/game/src/account-registration-flow.ts apps/game/src/account-registration-flow.test.ts apps/game/src/account-recovery-flow.ts apps/game/src/account-recovery-flow.test.ts apps/game/src/account-controller.ts
git commit -m "feat: restore source-owned account recovery flows"
```

## Task 4：建立可独立测试的 Player Telemetry 核心

**Files:**

- Create: `apps/game/src/player-telemetry.ts`
- Create: `apps/game/src/player-telemetry.test.ts`

- [ ] **Step 1：写 telemetry 模型失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  PlayerTelemetryController,
  normalizePlayerTelemetry,
} from './player-telemetry';

describe('player telemetry', () => {
  it('clamps untrusted telemetry and accepts only known activity states', () => {
    expect(normalizePlayerTelemetry({
      fps: 999,
      rttMs: -4,
      state: 'hacked',
      region: '<img>',
      updatedAt: 12,
    })).toEqual({
      fps: 240,
      rttMs: 0,
      state: 'online',
      region: '<img>',
      updatedAt: 12,
    });
  });

  it('measures RTT, sends bounded telemetry, and releases resources on stop', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const render = vi.fn();
    let now = 1_000;
    const controller = new PlayerTelemetryController({
      send,
      render,
      now: () => now,
      region: () => 'China',
    });
    controller.connect('self-0001', 'lobby:0000', [{
      id: 'self-0001',
      name: 'Alice',
      telemetry: { fps: 0, rttMs: 0, state: 'online', region: 'Unknown', updatedAt: 0 },
    }]);
    controller.recordFrame(1_000);
    controller.recordFrame(1_900);
    controller.ping();
    const nonce = JSON.parse(vi.mocked(send).mock.calls.at(-1)![0]).nonce;
    now = 1_042;
    controller.handlePong(nonce);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('"rttMs":42'));

    controller.stop();
    vi.runOnlyPendingTimers();
    expect(controller.getState().connection).toBe('offline');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2：运行测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/player-telemetry.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3：实现 telemetry 核心**

公开类型固定为：

```ts
export type PlayerActivity = 'online' | 'moving' | 'driving' | 'playing' | 'away';
export interface PlayerTelemetry {
  fps: number;
  rttMs: number;
  state: PlayerActivity;
  region: string;
  updatedAt: number;
}
export interface PlayerTelemetryRow extends PlayerTelemetry {
  id: string;
  name: string;
  connected: boolean;
}
export interface PlayerTelemetryState {
  connection: 'connecting' | 'online' | 'offline';
  selfId: string | null;
  channel: string;
  players: PlayerTelemetryRow[];
}
export interface PlayerTelemetryDependencies {
  send(payload: string): void;
  render(state: Readonly<PlayerTelemetryState>): void;
  now(): number;
  region(): string;
}
export function normalizePlayerTelemetry(value: unknown): PlayerTelemetry;
export function detectPlayerRegion(): string;
export class PlayerTelemetryController {
  public constructor(dependencies: PlayerTelemetryDependencies);
  public connect(selfId: string, channel: string, players: unknown[]): void;
  public replacePlayers(players: unknown[]): void;
  public playerJoined(player: unknown): void;
  public playerLeft(id: string): void;
  public updateProfile(id: string, name: string): void;
  public updateActivity(id: string, activity: PlayerActivity): void;
  public receive(id: string, telemetry: unknown): void;
  public recordFrame(now: number): void;
  public ping(): void;
  public handlePong(nonce: number): void;
  public setLocalActivity(activity: PlayerActivity): void;
  public stop(): void;
  public getState(): Readonly<PlayerTelemetryState>;
}
```

实现约束：

- FPS：整数 `0..240`。
- RTT：整数 `0..60000`。
- region：去控制字符、trim、最多 24 字符，空值为 `Unknown`。
- 只接受五个 `PlayerActivity` 枚举。
- ping nonce 单调递增；10 秒后删除未完成 ping。
- 每 2 秒 ping；telemetry 发送间隔不得小于服务端限制。
- `render` 接收已排序的纯数据；DOM 渲染层只能用 `textContent`。
- `stop()` 清除 interval、timeout、pending ping 和玩家表。

- [ ] **Step 4：运行 telemetry 测试**

Run:

```text
npm.cmd --prefix apps/game test -- src/player-telemetry.test.ts
```

Expected: PASS，且 fake timer 计数归零。

- [ ] **Step 5：提交 telemetry 核心**

```text
git add apps/game/src/player-telemetry.ts apps/game/src/player-telemetry.test.ts
git commit -m "feat: add source-owned player telemetry core"
```

## Task 5：把 Telemetry 接入现有 Multiplayer Socket

**Files:**

- Modify: `apps/game/src/lobby-multiplayer.ts`
- Modify: `apps/game/src/lobby-multiplayer.test.ts`
- Modify: `apps/game/src/player-telemetry.ts`
- Modify: `apps/game/index.html`
- Modify: `apps/game/src/openai-theme.css`

- [ ] **Step 1：写协议解析失败测试**

在 `lobby-multiplayer.test.ts` 的 protocol describe 中加入：

```ts
it('strictly parses player telemetry and ping acknowledgements', () => {
  expect(parseLobbyMultiplayerMessage({
    type: 'telemetry',
    id: 'alice-0001',
    fps: 59,
    rttMs: 42,
    state: 'moving',
    region: 'China',
    updatedAt: 123,
  })).toEqual({
    type: 'telemetry',
    id: 'alice-0001',
    telemetry: {
      fps: 59,
      rttMs: 42,
      state: 'moving',
      region: 'China',
      updatedAt: 123,
    },
  });
  expect(parseLobbyMultiplayerMessage({
    type: 'telemetry_pong',
    nonce: 7,
  })).toEqual({ type: 'telemetry_pong', nonce: 7 });
  expect(parseLobbyMultiplayerMessage({
    type: 'telemetry',
    id: '../bad',
    fps: 59,
    rttMs: 42,
    state: 'moving',
    region: 'China',
    updatedAt: 123,
  })).toBeNull();
});
```

- [ ] **Step 2：运行协议测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/lobby-multiplayer.test.ts
```

Expected: FAIL，telemetry 消息当前返回 `null`。

- [ ] **Step 3：扩展协议类型并接入 controller**

给 `LobbyPlayerSnapshot` 增加可选字段：

```ts
telemetry?: PlayerTelemetry;
```

给 `MultiplayerMessage` 增加：

```ts
| { type: 'telemetry'; id: string; telemetry: PlayerTelemetry }
| { type: 'telemetry_pong'; nonce: number }
```

`parseLobbyMultiplayerMessage()` 使用 `normalizePlayerTelemetry()`，但在 normalize 前必须校验合法 client ID 和有限 nonce。`welcome`、`channel_snapshot` 中的 player telemetry 同样保留。

`LobbyMultiplayer` 创建一个 controller，send 始终通过现有 socket：

```ts
private readonly telemetry = new PlayerTelemetryController({
  send: (payload) => {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
  },
  render: renderPlayerStats,
  now: () => performance.now(),
  region: detectPlayerRegion,
});
```

接线规则：

```text
socket open              标记 connection 为 online
welcome                  telemetry.connect(selfId, channel, players)
channel_snapshot         telemetry.connect(selfId, channel, players)
join                     telemetry.playerJoined(player)
leave                    telemetry.playerLeft(id)
profile                  telemetry.updateProfile(id, name)
pose                     moving/online activity
vehicle_claimed/state    driver activity
vehicle_released         online/playing activity
party_launch             playing activity
telemetry                telemetry.receive(id, message.telemetry)
telemetry_pong           telemetry.handlePong(nonce)
socket close/disconnect  telemetry.stop()
update frame             telemetry.recordFrame(performance.now())
visibilitychange         away / current activity
```

不得给 `window.WebSocket` 赋值，也不得创建第二条多人连接。

- [ ] **Step 4：加入生产玩家状态 DOM 和 CSS**

从 `public/game/index.html` 复制完整 `#player-stats-panel`，插入 `#multiplayer-hud` 后、`#avatar-wardrobe-entry` 前。

将 `public/game/assets/player-stats-20260721.css` 的完整规则追加到 `apps/game/src/openai-theme.css`。

在 `player-telemetry.ts` 导出 `renderPlayerStats(state)`；通过 `document.createElement` 和 `textContent` 创建玩家行，禁止 `innerHTML`。

- [ ] **Step 5：运行多人和 telemetry 测试**

Run:

```text
npm.cmd --prefix apps/game test -- src/player-telemetry.test.ts src/lobby-multiplayer.test.ts
```

Expected: 两个测试文件全部 PASS。

- [ ] **Step 6：静态确认没有全局 WebSocket 替换**

Run:

```text
rg -n "window\.WebSocket\s*=|class .* extends WebSocket" apps/game/src
```

Expected: 无输出，退出码 1。

- [ ] **Step 7：提交多人接入切片**

```text
git add apps/game/index.html apps/game/src/openai-theme.css apps/game/src/player-telemetry.ts apps/game/src/lobby-multiplayer.ts apps/game/src/lobby-multiplayer.test.ts
git commit -m "feat: integrate player telemetry with lobby multiplayer"
```

## Task 6：回收退出游戏与本地昵称补丁

**Files:**

- Modify: `apps/game/index.html`
- Modify: `apps/game/src/white-room-game.ts`
- Modify: `apps/game/src/white-room-game.test.ts`
- Modify: `apps/game/src/lobby-multiplayer.ts`
- Modify: `apps/game/src/lobby-multiplayer.test.ts`

- [ ] **Step 1：写退出与昵称失败测试**

在 `white-room-game.test.ts` 添加：

```ts
import { quitWhiteRoomGame } from './white-room-game';

describe('quit game', () => {
  it('releases pointer lock and reloads the current URL', () => {
    const exitPointerLock = vi.fn();
    const reload = vi.fn();
    quitWhiteRoomGame({ exitPointerLock, reload });
    expect(exitPointerLock).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
});
```

在 `lobby-multiplayer.test.ts` 添加：

```ts
import { lobbyNicknameLabelVisible } from './lobby-multiplayer';

describe('lobby nickname labels', () => {
  it('shows both self and remote nicknames', () => {
    expect(lobbyNicknameLabelVisible(true)).toBe(true);
    expect(lobbyNicknameLabelVisible(false)).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试确认红灯**

Run:

```text
npm.cmd --prefix apps/game test -- src/white-room-game.test.ts src/lobby-multiplayer.test.ts
```

Expected: FAIL，两个导出函数不存在。

- [ ] **Step 3：实现退出行为**

在 `index.html` 的 `#settings-btn` 后加入生产按钮：

```html
<button id="quit-game-btn" class="menu-btn danger">退出游戏</button>
```

在 `white-room-game.ts` 导出纯函数并在现有按钮绑定处调用：

```ts
export function quitWhiteRoomGame(actions: {
  exitPointerLock(): void;
  reload(): void;
}): void {
  actions.exitPointerLock();
  actions.reload();
}

byId<HTMLButtonElement>('quit-game-btn').addEventListener('click', () => {
  quitWhiteRoomGame({
    exitPointerLock: () => document.exitPointerLock?.(),
    reload: () => window.location.reload(),
  });
});
```

刷新当前页面，不重写 pathname/search/hash。

- [ ] **Step 4：让本地昵称原生可见**

在 `lobby-multiplayer.ts` 增加：

```ts
export function lobbyNicknameLabelVisible(isSelf: boolean): boolean {
  void isSelf;
  return true;
}
```

替换两个补丁目标：

```ts
label.visible = lobbyNicknameLabelVisible(isSelf);
actor.label.visible = lobbyNicknameLabelVisible(actor.self);
```

角色 group 的第一/第三人称、驾驶和遮挡可见性逻辑保持不变；这里只改变 sprite label 的 self 判断。

- [ ] **Step 5：运行定向测试**

Run:

```text
npm.cmd --prefix apps/game test -- src/white-room-game.test.ts src/lobby-multiplayer.test.ts
```

Expected: 两个测试文件全部 PASS。

- [ ] **Step 6：提交体验补丁切片**

```text
git add apps/game/index.html apps/game/src/white-room-game.ts apps/game/src/white-room-game.test.ts apps/game/src/lobby-multiplayer.ts apps/game/src/lobby-multiplayer.test.ts
git commit -m "feat: restore source-owned game experience patches"
```

## Task 7：固化“源码是唯一候选来源”的仓库契约

**Files:**

- Modify: `test/game-source-integration.test.js`
- Modify: `docs/source-recovery/v39-v30.md`

- [ ] **Step 1：写完整源码所有权契约**

```js
test('game source owns every current production overlay behavior', async () => {
  const html = await readFile(new URL('apps/game/index.html', root), 'utf8');
  const main = await readFile(new URL('apps/game/src/main.ts', root), 'utf8');
  const account = await readFile(new URL('apps/game/src/account-controller.ts', root), 'utf8');
  const multiplayer = await readFile(new URL('apps/game/src/lobby-multiplayer.ts', root), 'utf8');
  const game = await readFile(new URL('apps/game/src/white-room-game.ts', root), 'utf8');
  const theme = await readFile(new URL('apps/game/src/openai-theme.css', root), 'utf8');
  const productionHtml = await readFile(new URL('public/game/index.html', root), 'utf8');

  for (const id of [
    'account-login-otp-panel',
    'account-register-dialog',
    'account-reset-dialog',
    'player-stats-panel',
    'quit-game-btn',
  ]) assert.match(html, new RegExp(`id="${id}"`, 'u'));

  for (const asset of [
    'account-login-otp-20260722.js',
    'account-register-20260721.js',
    'account-reset-bootstrap-20260721.js',
    'account-reset-20260721.js',
    'player-stats-20260721.js',
    'game-experience-20260721.js',
    'account-login-otp-20260722.css',
    'account-register-20260721.css',
    'account-reset-20260721.css',
    'player-stats-20260721.css',
  ]) assert.doesNotMatch(html, new RegExp(asset.replaceAll('.', '\\.'), 'u'));

  assert.match(main, /captureRecoveryHash/u);
  assert.match(account, /AccountLoginFlow/u);
  assert.match(account, /AccountRegistrationFlow/u);
  assert.match(account, /AccountRecoveryFlow/u);
  assert.match(multiplayer, /PlayerTelemetryController/u);
  assert.doesNotMatch(multiplayer, /window\.WebSocket\s*=/u);
  assert.match(game, /quitWhiteRoomGame/u);
  assert.match(theme, /\.player-stats-panel/u);
  assert.match(html, /connect-src[^"]*https:\/\/uzshphuobuaeyadxgriv\.supabase\.co/u);
  assert.doesNotMatch(html, /hwbjybuwgarkitejqism\.supabase\.co/u);
  assert.match(productionHtml, /connect-src[^"]*https:\/\/uzshphuobuaeyadxgriv\.supabase\.co/u);
});
```

- [ ] **Step 2：运行契约测试**

Run:

```text
npm.cmd test -- --test-name-pattern="game source owns every current production overlay behavior"
```

Expected: PASS。

- [ ] **Step 3：更新恢复文档**

在 `docs/source-recovery/v39-v30.md` 的“当前差距”后增加以下事实：

```markdown
## 生产 overlay 源码化

`apps/game` 已原生拥有 OTP 登录、注册、密码恢复、玩家 telemetry、退出游戏和本地第三人称昵称行为。候选构建不再依赖独立 overlay，也不替换全局 WebSocket。

本变更没有更新 `public/game`。正式切换仍需要浏览器新旧行为对照、性能检查和发布回滚演练。
```

- [ ] **Step 4：确认本阶段没有触碰生产成品**

Run:

```text
git diff --exit-code 7405fe2 -- public/game
```

Expected: 无输出，退出码 0。

- [ ] **Step 5：提交契约与文档**

```text
git add test/game-source-integration.test.js docs/source-recovery/v39-v30.md
git commit -m "test: guard source-owned game production behavior"
```

## Task 8：完整验证与阶段验收

**Files:**

- No source changes expected.
- If a command fails, stop and use `superpowers:systematic-debugging`; do not combine unrelated fixes into the verification commit.

- [ ] **Step 1：安装状态检查**

Run:

```text
npm.cmd ci
npm.cmd ci --prefix apps/game
```

Expected: 两个安装命令退出码 0，lockfile 无变化。

- [ ] **Step 2：运行平台测试**

Run:

```text
npm.cmd test
```

Expected: 159 个或更多测试全部 PASS，0 fail。

- [ ] **Step 3：运行游戏单测**

Run:

```text
npm.cmd run test:game
```

Expected: 所有 Vitest 文件和测试全部 PASS，0 fail。

- [ ] **Step 4：运行 lint**

Run:

```text
npm.cmd run lint:game
```

Expected: 退出码 0，0 warning，0 error。

- [ ] **Step 5：运行类型检查与生产构建**

Run:

```text
npm.cmd run build:game
```

Expected: `tsc --noEmit` 和 `vite build` 都退出码 0。

- [ ] **Step 6：检查构建 HTML 不引用 overlay**

Run:

```text
rg -n "account-(login-otp|register|reset)-202607|player-stats-202607|game-experience-202607" apps/game/dist
```

Expected: 无输出，退出码 1。

- [ ] **Step 7：检查生产目录与 Git 范围**

Run:

```text
git diff --exit-code 7405fe2 -- public/game
git diff --check 73f98f3..HEAD
git status --short
```

Expected:

- `public/game` diff 为空。
- `git diff --check` 退出码 0。
- `git status --short` 为空。

- [ ] **Step 8：记录阶段结果**

在任务交付信息中明确写出：

```text
源码化完成，不代表生产切换完成。
下一阶段：统一 SDK/schema/security limits，然后接入浏览器 E2E 和新旧行为对照。
```

本任务不推送、不创建 PR、不替换 `public/game`，除非用户另行明确要求。
