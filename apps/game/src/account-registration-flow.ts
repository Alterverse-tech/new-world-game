import type { Session } from '@supabase/supabase-js';
import { normalizeAccountEmail } from './account-auth-service';
import {
  OTP_COOLDOWN_MS,
  SIX_DIGITS,
  type AuthMessageState,
  type StoragePort,
} from './account-login-flow';

export type RegistrationStage = 'details' | 'verify' | 'complete';
export const OTP_COOLDOWN_KEY = 'whiteroom.auth.otp-cooldown.v1';
const DEFAULT_MESSAGE = '填写后由 Supabase 向邮箱发送 6 位验证码。';

export interface AccountRegistrationPort {
  readEmail(): string;
  setEmail(email: string): void;
  readPassword(): string;
  readConfirmation(): string;
  readToken(): string;
  clearSecrets(): void;
  render(state: AccountRegistrationState): void;
  focusEmail(): void;
  focusPassword(): void;
  focusConfirmation(): void;
  focusToken(): void;
}

export interface AccountRegistrationState {
  stage: RegistrationStage;
  busy: boolean;
  email: string;
  cooldownSeconds: number;
  message: string;
  messageState: AuthMessageState;
}

export interface RegistrationService {
  sendOtp(email: string, redirectTo: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<Session>;
  setPassword(password: string): Promise<void>;
  exchangeSession(session: Session): Promise<void>;
}

interface Dependencies {
  port: AccountRegistrationPort;
  service: RegistrationService;
  storage: StoragePort;
  now: () => number;
  redirectTo: string;
  reload: () => void;
}

export class AccountRegistrationFlow {
  private state: AccountRegistrationState = {
    stage: 'details',
    busy: false,
    email: '',
    cooldownSeconds: 0,
    message: DEFAULT_MESSAGE,
    messageState: 'guest',
  };
  private password = '';
  private verifiedSession: Session | null = null;
  private passwordSet = false;

  public constructor(private readonly d: Dependencies) {
    this.render();
  }

  public getState(): Readonly<AccountRegistrationState> {
    return { ...this.state };
  }

  public open(prefilledEmail = ''): void {
    if (this.state.busy) return;
    const email = normalizeAccountEmail(prefilledEmail) ?? '';
    this.clear();
    this.d.port.setEmail(email);
    this.set({
      stage: 'details',
      busy: false,
      email,
      cooldownSeconds: 0,
      message: DEFAULT_MESSAGE,
      messageState: 'guest',
    });
    if (email) this.d.port.focusPassword();
    else this.d.port.focusEmail();
  }

  public cancel(): void {
    if (!this.state.busy) this.open();
  }

  public async submit(): Promise<void> {
    if (this.state.busy) return;
    if (this.state.stage === 'details') {
      await this.send(false);
      return;
    }
    if (this.verifiedSession) {
      await this.finishVerifiedRegistration();
      return;
    }
    const token = this.d.port.readToken().trim();
    if (!SIX_DIGITS.test(token)) {
      this.set({ message: '请输入邮件中的 6 位验证码。', messageState: 'error' });
      this.d.port.focusToken();
      return;
    }
    await this.verify(token);
  }

  public async resend(): Promise<void> {
    if (!this.state.busy && this.state.stage === 'verify') await this.send(true);
  }

  public useExistingCode(): void {
    if (this.state.busy || !this.captureDetails()) return;
    this.set({
      stage: 'verify',
      cooldownSeconds: this.remaining(),
      message: '请输入之前收到、且仍在有效期内的 6 位验证码。',
      messageState: 'guest',
    });
    this.d.port.focusToken();
  }

  public updateCooldown(): void {
    if (this.state.stage === 'verify') this.set({ cooldownSeconds: this.remaining() });
  }

  private captureDetails(): boolean {
    const email = normalizeAccountEmail(this.d.port.readEmail());
    const password = this.d.port.readPassword();
    const confirmation = this.d.port.readConfirmation();
    if (!email) {
      this.set({ message: '请输入有效的邮箱地址。', messageState: 'error' });
      this.d.port.focusEmail();
      return false;
    }
    if (password.length < 8 || password.length > 72) {
      this.set({ message: '密码需要 8–72 个字符。', messageState: 'error' });
      this.d.port.focusPassword();
      return false;
    }
    if (password !== confirmation) {
      this.set({ message: '两次输入的密码不一致。', messageState: 'error' });
      this.d.port.focusConfirmation();
      return false;
    }
    this.password = password;
    this.d.port.setEmail(email);
    this.set({ email });
    return true;
  }

  private async send(resend: boolean): Promise<void> {
    if (this.state.busy || (!resend && !this.captureDetails())) return;
    const cooldownSeconds = this.remaining();
    if (cooldownSeconds > 0) {
      this.set({
        stage: 'verify',
        cooldownSeconds,
        message: `请在 ${cooldownSeconds} 秒后重新发送验证码。`,
        messageState: 'guest',
      });
      this.d.port.focusToken();
      return;
    }
    this.set({
      busy: true,
      message: resend ? '正在重新发送验证码…' : '正在发送验证码…',
      messageState: 'loading',
    });
    try {
      await this.d.service.sendOtp(this.state.email, this.d.redirectTo);
      this.save();
      this.set({
        stage: 'verify',
        cooldownSeconds: 60,
        message: '验证码已发送，请输入邮件中的 6 位数字。',
        messageState: 'success',
      });
    } catch {
      this.set({ message: '验证码发送失败，请稍后重试。', messageState: 'error' });
    } finally {
      this.set({ busy: false });
      if (this.state.stage === 'verify') this.d.port.focusToken();
    }
  }

  private async verify(token: string): Promise<void> {
    this.set({ busy: true, message: '正在验证邮箱并创建账号…', messageState: 'loading' });
    try {
      this.verifiedSession = await this.d.service.verifyOtp(this.state.email, token);
      await this.finishVerifiedRegistration();
    } catch {
      this.set({
        stage: 'verify',
        busy: false,
        message: '验证码验证失败，请检查后重试。',
        messageState: 'error',
      });
      this.d.port.focusToken();
    } finally {
      if (this.state.stage !== 'complete') this.set({ busy: false });
    }
  }

  private async finishVerifiedRegistration(): Promise<void> {
    if (!this.verifiedSession) return;
    this.set({ busy: true, message: '正在完成账号创建…', messageState: 'loading' });
    try {
      if (!this.passwordSet) {
        await this.d.service.setPassword(this.password);
        this.passwordSet = true;
      }
      await this.d.service.exchangeSession(this.verifiedSession);
      this.clear();
      this.remove();
      this.set({
        stage: 'complete',
        cooldownSeconds: 0,
        message: '注册完成，正在进入 WhiteRoom…',
        messageState: 'success',
      });
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 700));
      this.d.reload();
    } catch {
      this.set({
        stage: 'verify',
        busy: false,
        message: '账号创建未完成，请重试。',
        messageState: 'error',
      });
      this.d.port.focusToken();
    }
  }

  private clear(): void {
    this.password = '';
    this.verifiedSession = null;
    this.passwordSet = false;
    this.d.port.clearSecrets();
  }

  private remaining(): number {
    try {
      const raw = this.d.storage.get(OTP_COOLDOWN_KEY);
      const value = raw ? JSON.parse(raw) as { email?: unknown; until?: unknown } : null;
      return value?.email === this.state.email && typeof value.until === 'number'
        ? Math.max(0, Math.ceil((value.until - this.d.now()) / 1000))
        : 0;
    } catch {
      return 0;
    }
  }

  private save(): void {
    try {
      this.d.storage.set(OTP_COOLDOWN_KEY, JSON.stringify({
        email: this.state.email,
        until: this.d.now() + OTP_COOLDOWN_MS,
      }));
    } catch {
      // Storage is optional in hardened/private browser modes.
    }
  }

  private remove(): void {
    try {
      this.d.storage.delete(OTP_COOLDOWN_KEY);
    } catch {
      // Storage is optional in hardened/private browser modes.
    }
  }

  private set(patch: Partial<AccountRegistrationState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private render(): void {
    this.d.port.render(this.getState());
  }
}
