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
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface LoginService {
  sendOtp(email: string, redirectTo: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<Session>;
  exchangeSession(session: Session): Promise<void>;
}

export const OTP_COOLDOWN_MS = 60_000;
export const OTP_COOLDOWN_KEY = 'whiteroom.auth.login-otp-cooldown.v1';
export const SIX_DIGITS = /^\d{6}$/u;

export function browserStoragePort(storage: Storage): StoragePort {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
    delete: (key) => storage.removeItem(key),
  };
}

interface AccountLoginDependencies {
  port: AccountLoginPort;
  service: LoginService;
  storage: StoragePort;
  now: () => number;
  redirectTo: string;
  reload: () => void;
}

interface StoredCooldown {
  email: string;
  until: number;
}

const EMAIL_PROMPT = '输入邮箱获取验证码；新邮箱将自动创建账号。';

export class AccountLoginFlow {
  private state: AccountLoginState = {
    stage: 'email',
    busy: false,
    email: '',
    cooldownSeconds: 0,
    message: EMAIL_PROMPT,
    messageState: 'guest',
  };

  public constructor(private readonly dependencies: AccountLoginDependencies) {
    this.render();
  }

  public getState(): AccountLoginState {
    return { ...this.state };
  }

  public open(): void {
    this.updateCooldown();
    this.render();
    if (this.state.stage === 'verify') this.dependencies.port.focusToken();
    else this.dependencies.port.focusEmail();
  }

  public changeEmail(): void {
    this.setState({
      stage: 'email',
      cooldownSeconds: 0,
      message: EMAIL_PROMPT,
      messageState: 'guest',
    });
    this.dependencies.port.focusEmail();
  }

  public async resend(): Promise<void> {
    if (this.state.stage !== 'verify') return;
    await this.send(this.state.email);
  }

  public async submit(): Promise<void> {
    if (this.state.busy) return;
    if (this.state.stage === 'email') {
      const email = normalizeAccountEmail(this.dependencies.port.readEmail());
      if (!email) {
        this.setState({ message: '请输入有效的邮箱地址。', messageState: 'error' });
        this.dependencies.port.focusEmail();
        return;
      }
      this.setState({ email, message: EMAIL_PROMPT, messageState: 'guest' });
      const cooldownSeconds = this.remainingCooldown(email);
      if (cooldownSeconds > 0) {
        this.setState({
          stage: 'verify', cooldownSeconds,
          message: `请在 ${cooldownSeconds} 秒后重新发送验证码。`, messageState: 'guest',
        });
        this.dependencies.port.focusToken();
        return;
      }
      await this.send(email);
      return;
    }

    const token = this.dependencies.port.readToken().trim();
    if (!SIX_DIGITS.test(token)) {
      this.setState({ message: '请输入 6 位数字验证码。', messageState: 'error' });
      this.dependencies.port.focusToken();
      return;
    }
    await this.verify(token);
  }

  public updateCooldown(): void {
    if (!this.state.email) return;
    const cooldownSeconds = this.remainingCooldown(this.state.email);
    const stage = cooldownSeconds > 0 ? 'verify' : this.state.stage;
    this.setState({ cooldownSeconds, stage });
  }

  private async send(email: string): Promise<void> {
    if (this.state.busy) return;
    const cooldownSeconds = this.remainingCooldown(email);
    if (cooldownSeconds > 0) {
      this.setState({
        stage: 'verify', cooldownSeconds,
        message: `请在 ${cooldownSeconds} 秒后重新发送验证码。`, messageState: 'guest',
      });
      return;
    }
    this.setState({ busy: true, email, message: '正在发送验证码…', messageState: 'loading' });
    try {
      await this.dependencies.service.sendOtp(email, this.dependencies.redirectTo);
      this.saveCooldown(email);
      this.dependencies.port.clearToken();
      this.setState({
        stage: 'verify', cooldownSeconds: Math.ceil(OTP_COOLDOWN_MS / 1_000),
        message: '验证码已发送，请查看邮箱。', messageState: 'success',
      });
      this.dependencies.port.focusToken();
    } catch {
      this.setState({ message: '验证码发送失败，请稍后重试。', messageState: 'error' });
    } finally {
      this.setState({ busy: false });
    }
  }

  private async verify(token: string): Promise<void> {
    this.setState({ busy: true, message: '正在验证邮箱验证码…', messageState: 'loading' });
    try {
      const session = await this.dependencies.service.verifyOtp(this.state.email, token);
      await this.dependencies.service.exchangeSession(session);
      this.deleteCooldown();
      this.setState({ message: '登录成功，正在进入 WhiteRoom…', messageState: 'success' });
      this.dependencies.reload();
    } catch {
      this.setState({
        stage: 'verify', message: '验证码验证失败，请检查后重试。', messageState: 'error',
      });
      this.dependencies.port.focusToken();
    } finally {
      this.setState({ busy: false });
    }
  }

  private remainingCooldown(email: string): number {
    const stored = this.readCooldown();
    if (!stored || stored.email !== email) return 0;
    const remaining = stored.until - this.dependencies.now();
    if (remaining <= 0) {
      this.deleteCooldown();
      return 0;
    }
    return Math.ceil(remaining / 1_000);
  }

  private readCooldown(): StoredCooldown | null {
    try {
      const raw = this.dependencies.storage.get(OTP_COOLDOWN_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      const { email, until } = value as Partial<StoredCooldown>;
      return typeof email === 'string' && typeof until === 'number' && Number.isFinite(until)
        ? { email, until }
        : null;
    } catch {
      return null;
    }
  }

  private saveCooldown(email: string): void {
    try {
      this.dependencies.storage.set(OTP_COOLDOWN_KEY, JSON.stringify({
        email, until: this.dependencies.now() + OTP_COOLDOWN_MS,
      }));
    } catch {
      // OTP can still be used when private browsing blocks storage.
    }
  }

  private deleteCooldown(): void {
    try {
      this.dependencies.storage.delete(OTP_COOLDOWN_KEY);
    } catch {
      // Storage cleanup must not prevent successful login.
    }
  }

  private setState(patch: Partial<AccountLoginState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private render(): void {
    this.dependencies.port.render(this.getState());
  }
}
