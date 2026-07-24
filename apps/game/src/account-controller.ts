import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { AccountAuthService, authRedirectUrl } from './account-auth-service';
import {
  AccountLoginFlow,
  browserStoragePort,
  type AccountLoginPort,
  type AccountLoginState,
} from './account-login-flow';
import { AccountRegistrationFlow, type AccountRegistrationState } from './account-registration-flow';
import { AccountRecoveryFlow, type AccountRecoveryState } from './account-recovery-flow';

export { authRedirectUrl, parseAuthConfig } from './account-auth-service';

type AccountPhase = 'loading' | 'guest' | 'signing_in' | 'signing_up' | 'signed_in' | 'signing_out' | 'error';

interface AccountState {
  ready: boolean;
  available: boolean;
  mode: 'guest' | 'email';
  phase: AccountPhase;
  displayName: string | null;
  email: string | null;
  profileLoaded: boolean;
  message: string;
}

export interface AccountTextState {
  ready: boolean;
  available: boolean;
  mode: 'guest' | 'email';
  phase: AccountPhase;
  profileLoaded: boolean;
}

export interface AccountPlayerProfile {
  gameNickname: string | null;
  avatarId: string | null;
}

interface ProfileRow {
  display_name: string | null;
  game_nickname: string | null;
  avatar_id: string | null;
}

const AUTH_RETURN_CHANNEL_KEY = 'whiteroom.auth.return-channel';
const ACCOUNT_EMAIL_MAX_LENGTH = 254;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing account UI #${id}`);
  return element as T;
}

function safeString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function safeDisplayString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}

function normalizedProfileAvatarId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{8,63}$/.test(normalized) ? normalized : null;
}

function profileUpdateValues(nickname: string, avatarId: string): Pick<ProfileRow, 'game_nickname' | 'avatar_id'> {
  const gameNickname = safeDisplayString(nickname, 24);
  if (!gameNickname) throw new TypeError('玩家昵称必须为 1–24 个字符');
  const trimmedAvatarId = avatarId.trim();
  const normalizedAvatarId = trimmedAvatarId ? normalizedProfileAvatarId(trimmedAvatarId) : null;
  if (trimmedAvatarId && !normalizedAvatarId) throw new TypeError('Avatar 代码格式无效');
  return { game_nickname: gameNickname, avatar_id: normalizedAvatarId };
}

export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > ACCOUNT_EMAIL_MAX_LENGTH || /\s/.test(email)) return null;
  const separator = email.lastIndexOf('@');
  if (separator < 1 || separator > 64 || separator === email.length - 1) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const domainLabels = domain.split('.');
  if (
    local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || domainLabels.length < 2
    || domain.startsWith('.')
    || domain.endsWith('.')
    || domain.includes('..')
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    || domainLabels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) return null;
  return email;
}

export function accountDisplayName(user: User, profile?: ProfileRow | null): string {
  const metadata = user.user_metadata ?? {};
  return safeDisplayString(profile?.game_nickname, 80)
    ?? safeDisplayString(profile?.display_name, 80)
    ?? safeDisplayString(metadata.full_name, 120)
    ?? safeDisplayString(metadata.name, 120)
    ?? safeDisplayString(user.email?.split('@')[0], 80)
    ?? 'WhiteRoom 玩家';
}

function authCallbackErrorMessage(): string | null {
  const url = new URL(window.location.href);
  return safeString(url.searchParams.get('error_description'), 500)
    ?? safeString(url.searchParams.get('error'), 120);
}

function cleanAuthParameters(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['code', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(null, '', url);
}

function rememberChannel(): void {
  try {
    const channel = byId<HTMLInputElement>('lobby-channel-input').value.trim();
    if (/^\d{4,12}$/.test(channel)) sessionStorage.setItem(AUTH_RETURN_CHANNEL_KEY, channel);
  } catch {
    // Storage can be unavailable in hardened/private browser modes.
  }
}

function restoreChannel(): void {
  try {
    const channel = sessionStorage.getItem(AUTH_RETURN_CHANNEL_KEY);
    sessionStorage.removeItem(AUTH_RETURN_CHANNEL_KEY);
    if (!channel || !/^\d{4,12}$/.test(channel)) return;
    const input = byId<HTMLInputElement>('lobby-channel-input');
    input.value = channel;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('channel')) {
      url.searchParams.set('channel', channel);
      window.history.replaceState(null, '', url);
    }
  } catch {
    // The channel field keeps its safe default when storage is unavailable.
  }
}

export class AccountController {
  private readonly panel = byId<HTMLElement>('account-panel');
  private readonly userName = byId<HTMLElement>('account-user-name');
  private readonly status = byId<HTMLElement>('account-status');
  private readonly loginOpenButton = byId<HTMLButtonElement>('account-login-open-btn');
  private readonly signoutButton = byId<HTMLButtonElement>('account-signout-btn');
  private readonly settings = byId<HTMLElement>('settings-account');
  private readonly settingsStatus = byId<HTMLElement>('settings-account-status');
  private readonly settingsAction = byId<HTMLButtonElement>('settings-account-action');
  private readonly authDialog = byId<HTMLDialogElement>('account-auth-dialog');
  private readonly authForm = byId<HTMLFormElement>('account-auth-form');
  private readonly emailInput = byId<HTMLInputElement>('account-email-input');
  private readonly otpPanel = byId<HTMLElement>('account-login-otp-panel');
  private readonly otpEmail = byId<HTMLElement>('account-login-otp-email');
  private readonly otpInput = byId<HTMLInputElement>('account-login-otp-input');
  private readonly otpResendButton = byId<HTMLButtonElement>('account-login-otp-resend');
  private readonly otpChangeButton = byId<HTMLButtonElement>('account-login-otp-change');
  private readonly dialogLoginButton = byId<HTMLButtonElement>('account-login-btn');
  private readonly authCloseButton = byId<HTMLButtonElement>('account-auth-close');
  private readonly authMessage = byId<HTMLElement>('account-auth-message');
  private readonly registerDialog = byId<HTMLDialogElement>('account-register-dialog');
  private readonly registerForm = byId<HTMLFormElement>('account-register-form');
  private readonly registerEmail = byId<HTMLInputElement>('account-register-email');
  private readonly registerPassword = byId<HTMLInputElement>('account-register-password');
  private readonly registerConfirmation = byId<HTMLInputElement>('account-register-password-confirm');
  private readonly registerCode = byId<HTMLInputElement>('account-register-code');
  private readonly registerDetails = byId<HTMLElement>('account-register-details');
  private readonly registerVerify = byId<HTMLElement>('account-register-verify');
  private readonly registerMessage = byId<HTMLElement>('account-register-message');
  private readonly registerSubmit = byId<HTMLButtonElement>('account-register-submit');
  private readonly registerClose = byId<HTMLButtonElement>('account-register-close');
  private readonly registerResend = byId<HTMLButtonElement>('account-register-resend');
  private readonly registerExisting = byId<HTMLButtonElement>('account-register-have-code');
  private readonly registerOpen = byId<HTMLButtonElement>('account-register-btn');
  private readonly recoveryDialog = byId<HTMLDialogElement>('account-reset-dialog');
  private readonly recoveryForm = byId<HTMLFormElement>('account-reset-form');
  private readonly recoveryEmail = byId<HTMLInputElement>('account-reset-email');
  private readonly recoveryPassword = byId<HTMLInputElement>('account-reset-password');
  private readonly recoveryConfirmation = byId<HTMLInputElement>('account-reset-password-confirm');
  private readonly recoveryEmailPanel = byId<HTMLElement>('account-reset-email-panel');
  private readonly recoveryPasswordPanel = byId<HTMLElement>('account-reset-password-panel');
  private readonly recoveryMessage = byId<HTMLElement>('account-reset-message');
  private readonly recoverySubmit = byId<HTMLButtonElement>('account-reset-submit');
  private readonly recoveryClose = byId<HTMLButtonElement>('account-reset-close');
  private readonly recoveryBack = byId<HTMLButtonElement>('account-reset-back');
  private readonly recoveryOpen = byId<HTMLButtonElement>('account-reset-open');
  private readonly startButton = byId<HTMLButtonElement>('start-btn');
  private readonly assetNote = byId<HTMLElement>('lobby-asset-account-note');
  private readonly authService: AccountAuthService;
  private readonly loginFlow: AccountLoginFlow;
  private readonly registrationFlow: AccountRegistrationFlow;
  private readonly recoveryFlow: AccountRecoveryFlow;
  private client: SupabaseClient | null = null;
  private currentUser: User | null = null;
  private profileRow: ProfileRow | null = null;
  private cooldownTimer: number | null = null;
  private lastSyncedAccessToken: string | null = null;
  private syncQueue: Promise<void> = Promise.resolve();
  private state: AccountState = {
    ready: false,
    available: false,
    mode: 'guest',
    phase: 'loading',
    displayName: null,
    email: null,
    profileLoaded: false,
    message: '正在检查账号',
  };

  constructor(authService = new AccountAuthService(), recoveryHash: string | null = null) {
    this.authService = authService;
    this.loginFlow = new AccountLoginFlow({
      port: this.createLoginPort(),
      service: this.authService,
      storage: browserStoragePort(sessionStorage),
      now: Date.now,
      redirectTo: authRedirectUrl(window.location),
      reload: () => {
        rememberChannel();
        window.location.reload();
      },
    });
    this.registrationFlow = new AccountRegistrationFlow({ port: this.createRegistrationPort(), service: this.authService, storage: browserStoragePort(sessionStorage), now: Date.now, redirectTo: authRedirectUrl(window.location), reload: () => window.location.reload() });
    this.recoveryFlow = new AccountRecoveryFlow({ port: this.createRecoveryPort(), service: this.authService });
    this.loginOpenButton.addEventListener('click', () => this.openAuthDialog());
    this.signoutButton.addEventListener('click', () => void this.signOut());
    this.settingsAction.addEventListener('click', () => {
      if (this.state.mode === 'email') void this.signOut();
      else this.openAuthDialog();
    });
    this.authForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.loginFlow.submit();
    });
    this.dialogLoginButton.addEventListener('click', (event) => {
      event.preventDefault();
      void this.loginFlow.submit();
    });
    this.otpInput.addEventListener('input', () => {
      this.otpInput.value = this.otpInput.value.replace(/\D/g, '').slice(0, 6);
      const loginState = this.loginFlow.getState();
      if (this.otpInput.value.length === 6 && loginState.stage === 'verify' && !loginState.busy) {
        void this.loginFlow.submit();
      }
    });
    this.otpResendButton.addEventListener('click', () => void this.loginFlow.resend());
    this.otpChangeButton.addEventListener('click', () => this.loginFlow.changeEmail());
    this.authCloseButton.addEventListener('click', () => this.closeAuthDialog());
    this.authDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeAuthDialog();
    });
    this.registerOpen.addEventListener('click', () => { this.closeAuthDialog(true); this.registrationFlow.open(this.emailInput.value); this.registerDialog.showModal(); });
    this.registerForm.addEventListener('submit', (event) => { event.preventDefault(); void this.registrationFlow.submit(); });
    this.registerResend.addEventListener('click', () => void this.registrationFlow.resend());
    this.registerExisting.addEventListener('click', () => this.registrationFlow.useExistingCode());
    this.registerClose.addEventListener('click', () => { this.registrationFlow.cancel(); this.registerDialog.close(); });
    this.registerDialog.addEventListener('cancel', (event) => { event.preventDefault(); this.registrationFlow.cancel(); this.registerDialog.close(); });
    this.recoveryOpen.addEventListener('click', () => { this.closeAuthDialog(true); this.recoveryFlow.open(this.emailInput.value); this.recoveryDialog.showModal(); });
    this.recoveryForm.addEventListener('submit', (event) => { event.preventDefault(); void (this.recoveryFlow.getState().mode === 'email' ? this.recoveryFlow.sendEmail(new URL('/?password_reset=1', window.location.origin).href) : this.recoveryFlow.updatePassword()); });
    this.recoveryClose.addEventListener('click', () => { this.recoveryFlow.cancel(); this.recoveryDialog.close(); });
    this.recoveryBack.addEventListener('click', () => { this.recoveryFlow.cancel(); this.recoveryDialog.close(); });
    this.recoveryDialog.addEventListener('cancel', (event) => { event.preventDefault(); this.recoveryFlow.cancel(); this.recoveryDialog.close(); });
    if (recoveryHash) { this.recoveryFlow.openRecovery(recoveryHash); this.recoveryDialog.showModal(); }
    this.render();
  }

  public async initialize(): Promise<void> {
    const callbackError = authCallbackErrorMessage();
    restoreChannel();
    try {
      const config = await this.authService.loadConfig();
      if (!config.enabled) {
        this.setState({
          ready: true,
          available: false,
          mode: 'guest',
          phase: callbackError ? 'error' : 'guest',
          message: callbackError ? `邮箱确认未完成 · ${callbackError}` : '游客模式 · 登录功能待启用',
        });
        cleanAuthParameters();
        return;
      }

      this.client = await this.authService.getClient();
      this.setState({ available: true, message: '正在恢复账号会话' });
      this.client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          window.setTimeout(() => {
            void this.handleSessionSync(session);
          }, 0);
        } else if (event === 'SIGNED_OUT' && this.state.mode === 'email') {
          window.setTimeout(() => {
            void this.handleSignedOut();
          }, 0);
        }
      });
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      if (data.session) await this.enqueueSessionSync(data.session);
      else {
        await this.clearStaleServerSession();
        this.setState({
          ready: true,
          available: true,
          mode: 'guest',
          phase: callbackError ? 'error' : 'guest',
          message: callbackError ? `邮箱确认未完成 · ${callbackError}` : '游客模式 · 邮箱账号使用独立空间',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.setState({
        ready: true,
        mode: 'guest',
        phase: 'error',
        message: `账号服务暂不可用 · ${message}`,
      });
    } finally {
      cleanAuthParameters();
    }
  }

  public getTextState(): AccountTextState {
    return {
      ready: this.state.ready,
      available: this.state.available,
      mode: this.state.mode,
      phase: this.state.phase,
      profileLoaded: this.state.profileLoaded,
    };
  }

  public getPlayerProfile(): AccountPlayerProfile | null {
    if (this.state.mode !== 'email' || !this.state.profileLoaded || !this.profileRow) return null;
    return {
      gameNickname: safeDisplayString(this.profileRow.game_nickname, 24),
      avatarId: normalizedProfileAvatarId(this.profileRow.avatar_id),
    };
  }

  public async savePlayerProfile(nickname: string, avatarId: string): Promise<void> {
    if (this.state.mode !== 'email' || !this.client || !this.currentUser) return;
    const values = profileUpdateValues(nickname, avatarId);
    const { data, error } = await this.client
      .from('profiles')
      .update(values)
      .eq('id', this.currentUser.id)
      .select('display_name,game_nickname,avatar_id')
      .single<ProfileRow>();
    if (error || !data) throw new Error('玩家资料保存失败，请稍后重试');
    this.profileRow = data;
    this.setState({
      profileLoaded: true,
      displayName: accountDisplayName(this.currentUser, data),
      message: '玩家资料已同步',
    });
  }

  private setState(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private render(): void {
    const signedIn = this.state.mode === 'email';
    const busy = this.state.phase === 'loading'
      || this.state.phase === 'signing_in'
      || this.state.phase === 'signing_up'
      || this.state.phase === 'signing_out';
    this.panel.dataset.state = this.state.phase;
    this.settings.dataset.state = this.state.phase;
    this.userName.textContent = signedIn ? (this.state.displayName ?? '邮箱用户') : '游客玩家';
    this.status.textContent = signedIn && this.state.email
      ? `${this.state.email} · ${this.state.message}`
      : this.state.message;
    this.settingsStatus.textContent = signedIn
      ? `${this.state.displayName ?? '邮箱用户'} · 已跨设备同步`
      : this.state.message;
    this.loginOpenButton.classList.toggle('hidden', signedIn);
    this.loginOpenButton.disabled = busy || !this.state.available;
    this.loginOpenButton.textContent = '邮箱验证码登录';
    this.signoutButton.classList.toggle('hidden', !signedIn);
    this.signoutButton.disabled = busy;
    this.settingsAction.disabled = busy || (!signedIn && !this.state.available);
    this.settingsAction.textContent = signedIn ? '退出登录' : '邮箱验证码登录';
    this.dialogLoginButton.disabled = busy || !this.state.available;
    this.authCloseButton.disabled = busy;
    this.authMessage.dataset.state = this.state.phase;
    this.authMessage.textContent = this.state.message;
    this.startButton.textContent = signedIn ? '进入频道' : '游客进入频道';
    this.assetNote.textContent = signedIn
      ? '当前使用邮箱账号物件库；个人 GLB、昵称和形象可在其他设备继续使用。'
      : '游客家园与 GLB 仅属于当前浏览器；邮箱登录会使用新的账号资产空间，不会自动继承。';
  }

  private openAuthDialog(): void {
    if (!this.state.available || this.state.mode === 'email' || this.authDialog.open) return;
    this.setState({ phase: 'guest', message: '输入邮箱获取验证码。' });
    this.authDialog.showModal();
    this.loginFlow.open();
  }

  private closeAuthDialog(force = false): void {
    if (!this.authDialog.open) return;
    if (this.loginFlow.getState().busy && !force) return;
    if (!force) this.loginFlow.changeEmail();
    this.authDialog.close();
    if (!force) this.loginOpenButton.focus();
  }

  private createLoginPort(): AccountLoginPort {
    return {
      readEmail: () => this.emailInput.value,
      readToken: () => this.otpInput.value,
      render: (state) => this.renderLoginFlow(state),
      clearToken: () => { this.otpInput.value = ''; },
      focusEmail: () => this.emailInput.focus(),
      focusToken: () => this.otpInput.focus(),
    };
  }

  private createRegistrationPort() { return { readEmail: () => this.registerEmail.value, readPassword: () => this.registerPassword.value, readConfirmation: () => this.registerConfirmation.value, readToken: () => this.registerCode.value, clearSecrets: () => { this.registerPassword.value = ''; this.registerConfirmation.value = ''; this.registerCode.value = ''; }, focusEmail: () => this.registerEmail.focus(), focusPassword: () => this.registerPassword.focus(), focusConfirmation: () => this.registerConfirmation.focus(), focusToken: () => this.registerCode.focus(), render: (state: AccountRegistrationState) => this.renderRegistrationFlow(state) }; }
  private createRecoveryPort() { return { readEmail: () => this.recoveryEmail.value, readPassword: () => this.recoveryPassword.value, readConfirmation: () => this.recoveryConfirmation.value, clearSecrets: () => { this.recoveryPassword.value = ''; this.recoveryConfirmation.value = ''; }, focusEmail: () => this.recoveryEmail.focus(), focusPassword: () => this.recoveryPassword.focus(), focusConfirmation: () => this.recoveryConfirmation.focus(), render: (state: AccountRecoveryState) => this.renderRecoveryFlow(state) }; }
  private renderRegistrationFlow(state: AccountRegistrationState): void { const verify = state.stage === 'verify'; this.registerDetails.hidden = verify || state.stage === 'complete'; this.registerVerify.hidden = !verify; this.registerEmail.disabled = state.busy; this.registerPassword.disabled = state.busy; this.registerConfirmation.disabled = state.busy; this.registerCode.disabled = state.busy || !verify; this.registerSubmit.disabled = state.busy; this.registerResend.disabled = state.busy || state.cooldownSeconds > 0; this.registerSubmit.textContent = verify ? '验证并创建账号' : '发送验证码'; this.registerMessage.textContent = state.message; this.registerMessage.dataset.state = state.messageState; }
  private renderRecoveryFlow(state: AccountRecoveryState): void { const password = state.mode === 'password'; this.recoveryEmailPanel.hidden = password; this.recoveryPasswordPanel.hidden = !password; this.recoveryEmail.disabled = state.busy; this.recoveryPassword.disabled = state.busy || !password; this.recoveryConfirmation.disabled = state.busy || !password; this.recoverySubmit.disabled = state.busy; this.recoverySubmit.textContent = password ? '保存新密码' : '发送重置邮件'; this.recoveryMessage.textContent = state.message; this.recoveryMessage.dataset.state = state.messageState; }

  private renderLoginFlow(state: AccountLoginState): void {
    const verifying = state.stage === 'verify';
    this.otpPanel.hidden = !verifying;
    this.emailInput.closest('.account-login-email-field')?.toggleAttribute('hidden', verifying);
    this.otpEmail.textContent = state.email || '—';
    this.emailInput.disabled = state.busy;
    this.otpInput.disabled = state.busy || !verifying;
    this.otpResendButton.disabled = state.busy || state.cooldownSeconds > 0;
    this.otpResendButton.textContent = state.cooldownSeconds > 0
      ? `重新发送验证码（${state.cooldownSeconds}秒）`
      : '重新发送验证码';
    this.otpChangeButton.disabled = state.busy;
    this.dialogLoginButton.disabled = state.busy || !this.state.available;
    this.authCloseButton.disabled = state.busy || !this.state.available;
    this.dialogLoginButton.textContent = verifying ? '验证并登录' : '发送验证码';
    this.authMessage.dataset.state = state.messageState;
    this.authMessage.textContent = state.message;
    this.scheduleCooldownUpdate(state.cooldownSeconds);
  }

  private scheduleCooldownUpdate(cooldownSeconds: number): void {
    if (cooldownSeconds <= 0) {
      if (this.cooldownTimer !== null) window.clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
      return;
    }
    if (this.cooldownTimer !== null) return;
    this.cooldownTimer = window.setTimeout(() => {
      this.cooldownTimer = null;
      this.loginFlow.updateCooldown();
    }, 1_000);
  }

  private async signOut(): Promise<void> {
    if (!this.client || this.state.mode !== 'email' || this.state.phase === 'signing_out') return;
    this.setState({ phase: 'signing_out', message: '正在安全退出账号' });
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`退出 HTTP ${response.status}`);
      const { error } = await this.client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      window.location.reload();
    } catch {
      this.setState({ phase: 'error', message: '退出失败，请稍后重试' });
    }
  }

  private enqueueSessionSync(session: Session | null): Promise<void> {
    if (!session) return this.syncQueue;
    const task = this.syncQueue.then(async () => {
      if (session.access_token === this.lastSyncedAccessToken) return;
      await this.synchronizeSession(session);
    });
    this.syncQueue = task.catch(() => {});
    return task;
  }

  private async handleSessionSync(session: Session | null): Promise<void> {
    try {
      await this.enqueueSessionSync(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.setState({
        ready: true,
        phase: 'error',
        message: `账号会话同步失败 · ${message}`,
      });
    }
  }

  private async handleSignedOut(): Promise<void> {
    try {
      await this.clearServerSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.setState({
        ready: true,
        mode: 'guest',
        phase: 'error',
        message: `本地账号已退出，服务器会话清理失败 · ${message}`,
      });
    }
  }

  private async synchronizeSession(session: Session): Promise<void> {
    this.setState({ phase: 'signing_in', available: true, message: '正在连接 WhiteRoom 账号' });
    await this.authService.exchangeSession(session);
    const profile = await this.loadProfile(session.user);
    this.lastSyncedAccessToken = session.access_token;
    this.currentUser = session.user;
    this.profileRow = profile.row;
    this.setState({
      ready: true,
      available: true,
      mode: 'email',
      phase: 'signed_in',
      displayName: accountDisplayName(session.user, profile.row),
      email: safeString(session.user.email, 320),
      profileLoaded: profile.loaded,
      message: profile.loaded ? '账号空间已同步' : '已登录 · 用户资料表待初始化',
    });
  }

  private async loadProfile(user: User): Promise<{ loaded: boolean; row: ProfileRow | null }> {
    if (!this.client) return { loaded: false, row: null };
    const { data, error } = await this.client
      .from('profiles')
      .select('display_name,game_nickname,avatar_id')
      .eq('id', user.id)
      .maybeSingle<ProfileRow>();
    if (error) return { loaded: false, row: null };
    return { loaded: Boolean(data), row: data };
  }

  private async clearStaleServerSession(): Promise<void> {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json() as { account?: { signedIn?: boolean } };
      if (payload.account?.signedIn) await this.clearServerSession();
    } catch {
      // Guest mode remains usable even if the optional account status call fails.
    }
  }

  private async clearServerSession(): Promise<void> {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`退出 HTTP ${response.status}`);
    } finally {
      this.lastSyncedAccessToken = null;
      this.currentUser = null;
      this.profileRow = null;
      this.setState({
        ready: true,
        mode: 'guest',
        phase: 'guest',
        displayName: null,
        email: null,
        profileLoaded: false,
        message: '游客模式 · 邮箱账号使用独立空间',
      });
    }
  }
}
