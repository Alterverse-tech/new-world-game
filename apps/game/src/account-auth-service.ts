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

function safeString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

export function parseAuthConfig(value: unknown): AuthConfig {
  if (!value || typeof value !== 'object') throw new Error('账号配置响应无效');
  const record = value as Record<string, unknown>;
  if (record.provider !== 'email') throw new Error('账号登录方式无效');
  if (record.enabled === false) return { enabled: false, provider: 'email' };
  if (record.enabled !== true) throw new Error('账号配置响应无效');
  const supabaseUrl = safeString(record.supabaseUrl, 2048);
  const publishableKey = safeString(record.publishableKey, 512);
  if (!supabaseUrl || !publishableKey || !/^[A-Za-z0-9._-]{16,512}$/u.test(publishableKey)) {
    throw new Error('账号公开配置无效');
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error('账号服务地址无效');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.port
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/u.test(parsed.hostname)
  ) {
    throw new Error('账号服务地址无效');
  }
  return {
    enabled: true,
    provider: 'email',
    supabaseUrl: parsed.origin,
    publishableKey,
  };
}

export function authRedirectUrl(locationLike: Pick<Location, 'origin'>): string {
  return new URL('/', locationLike.origin).href;
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
    if (!this.configPromise) {
      this.configPromise = this.fetchConfig().catch((error: unknown) => {
        this.configPromise = null;
        throw error;
      });
    }
    return this.configPromise;
  }

  public getClient(): Promise<SupabaseClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.createSharedClient().catch((error: unknown) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  public async sendOtp(email: string, redirectTo: string): Promise<void> {
    const client = await this.getClient();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw new Error('验证邮件发送失败，请稍后重试');
  }

  public async verifyOtp(email: string, token: string): Promise<Session> {
    const client = await this.getClient();
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data.session) throw new Error('邮箱验证失败，请检查验证码后重试');
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
    if (!response.ok) throw new Error('账号验证失败，请稍后重试');
    const payload = await safeJson(response, '账号验证响应无效');
    if (!isSignedInAccountResponse(payload)) throw new Error('账号验证响应无效');
  }

  private async fetchConfig(): Promise<AuthConfig> {
    const response = await this.fetchImpl('/api/auth/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`账号配置 HTTP ${response.status}`);
    return parseAuthConfig(await safeJson(response, '账号配置响应无效'));
  }

  private async createSharedClient(): Promise<SupabaseClient> {
    const config = await this.loadConfig();
    if (!config.enabled) throw new Error('账号登录功能未启用');
    return this.createClientImpl(config.supabaseUrl, config.publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        autoRefreshToken: true,
        persistSession: true,
      },
    });
  }
}

async function safeJson(response: Response, message: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(message);
  }
}

function isSignedInAccountResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const account = (value as { account?: unknown }).account;
  return Boolean(
    account
    && typeof account === 'object'
    && (account as { signedIn?: unknown }).signedIn === true,
  );
}
