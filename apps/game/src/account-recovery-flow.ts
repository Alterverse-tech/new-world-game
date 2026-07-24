import { AccountRecoveryRequestError, normalizeAccountEmail } from './account-auth-service';
import type { AuthMessageState } from './account-login-flow';

export interface RecoveryHashLocation {
  hash: string;
  pathname: string;
  search: string;
}

export function captureRecoveryHash({
  location,
  replaceState,
}: {
  location: RecoveryHashLocation;
  replaceState: History['replaceState'];
}): string | null {
  const raw = location.hash;
  if (!raw) return null;
  try {
    const params = new URLSearchParams(raw.slice(1));
    if (
      params.get('type') !== 'recovery'
      && !params.has('error')
      && !params.has('error_description')
    ) return null;
  } catch {
    return null;
  }
  replaceState(null, '', `${location.pathname}${location.search}`);
  return raw;
}

export type RecoveryMode = 'email' | 'password';

export interface AccountRecoveryState {
  mode: RecoveryMode;
  busy: boolean;
  message: string;
  messageState: AuthMessageState;
}

export interface AccountRecoveryPort {
  readEmail(): string;
  setEmail(email: string): void;
  readPassword(): string;
  readConfirmation(): string;
  clearSecrets(): void;
  render(state: AccountRecoveryState): void;
  focusEmail(): void;
  focusPassword(): void;
  focusConfirmation(): void;
}

export interface RecoveryService {
  sendRecoveryEmail(email: string, redirectTo: string): Promise<void>;
  updateRecoveredPassword(accessToken: string, password: string): Promise<void>;
}

interface Dependencies {
  port: AccountRecoveryPort;
  service: RecoveryService;
  onSuccess?: () => void;
}

const DEFAULT_MESSAGE = '输入注册邮箱以接收重置邮件。';
const INVALID_LINK = '重置链接无效或已过期，请重新发送邮件。';

export class AccountRecoveryFlow {
  private state: AccountRecoveryState = {
    mode: 'email',
    busy: false,
    message: DEFAULT_MESSAGE,
    messageState: 'guest',
  };
  private token = '';

  public constructor(private readonly d: Dependencies) {
    this.render();
  }

  public getState(): Readonly<AccountRecoveryState> {
    return { ...this.state };
  }

  public open(prefilledEmail = ''): void {
    if (this.state.busy) return;
    const email = normalizeAccountEmail(prefilledEmail) ?? '';
    this.clear();
    this.d.port.setEmail(email);
    this.set({
      mode: 'email',
      busy: false,
      message: DEFAULT_MESSAGE,
      messageState: 'guest',
    });
    this.d.port.focusEmail();
  }

  public openRecovery(hash: string): void {
    this.clear();
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(hash.replace(/^#/, ''));
    } catch {
      params = new URLSearchParams();
    }
    const token = params.get('access_token');
    if (
      params.get('error')
      || params.get('error_description')
      || params.get('type') !== 'recovery'
      || !token
    ) {
      this.set({
        mode: 'email',
        busy: false,
        message: INVALID_LINK,
        messageState: 'error',
      });
      this.d.port.focusEmail();
      return;
    }
    this.token = token;
    this.set({
      mode: 'password',
      busy: false,
      message: '邮箱验证完成，请设置新密码。',
      messageState: 'success',
    });
    this.d.port.focusPassword();
  }

  public async sendEmail(redirectTo: string): Promise<void> {
    if (this.state.busy) return;
    const email = normalizeAccountEmail(this.d.port.readEmail());
    if (!email) {
      this.set({ message: '请输入有效的注册邮箱。', messageState: 'error' });
      this.d.port.focusEmail();
      return;
    }
    this.set({ busy: true, message: '正在发送密码重置邮件…', messageState: 'loading' });
    try {
      await this.d.service.sendRecoveryEmail(email, redirectTo);
      this.set({
        message: '如果该邮箱已注册，重置邮件会在几分钟内送达。请打开邮件中的链接继续。',
        messageState: 'success',
      });
    } catch (error) {
      this.set({
        message: error instanceof AccountRecoveryRequestError
          ? error.message
          : '重置邮件发送失败，请稍后重试。',
        messageState: 'error',
      });
    } finally {
      this.set({ busy: false });
    }
  }

  public async updatePassword(): Promise<void> {
    if (this.state.busy) return;
    const password = this.d.port.readPassword();
    if (password.length < 8 || password.length > 72) {
      this.set({ message: '新密码需要 8–72 个字符。', messageState: 'error' });
      this.d.port.focusPassword();
      return;
    }
    if (password !== this.d.port.readConfirmation()) {
      this.set({ message: '两次输入的新密码不一致。', messageState: 'error' });
      this.d.port.focusConfirmation();
      return;
    }
    if (!this.token) {
      this.open();
      this.set({ message: INVALID_LINK, messageState: 'error' });
      return;
    }
    this.set({ busy: true, message: '正在保存新密码…', messageState: 'loading' });
    try {
      await this.d.service.updateRecoveredPassword(this.token, password);
      this.clear();
      this.set({
        mode: 'email',
        message: '密码已更新，请使用新密码登录。',
        messageState: 'success',
      });
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 650));
      this.set({ busy: false });
      this.d.onSuccess?.();
    } catch (error) {
      if (!(error instanceof AccountRecoveryRequestError) || error.canRetryPassword) {
        this.set({
          busy: false,
          message: error instanceof AccountRecoveryRequestError
            ? error.message
            : '密码更新失败，请稍后重试。',
          messageState: 'error',
        });
      } else {
        this.clear();
        this.set({
          mode: 'email',
          busy: false,
          message: INVALID_LINK,
          messageState: 'error',
        });
        this.d.port.focusEmail();
      }
    } finally {
      this.set({ busy: false });
    }
  }

  public cancel(): void {
    if (!this.state.busy) this.open();
  }

  private clear(): void {
    this.token = '';
    this.d.port.clearSecrets();
  }

  private set(patch: Partial<AccountRecoveryState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private render(): void {
    this.d.port.render(this.getState());
  }
}
