import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { AccountAuthService, authRedirectUrl } from './account-auth-service';

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
const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
const ACCOUNT_PASSWORD_MAX_LENGTH = 72;

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

export function isAccountPasswordValid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return length >= ACCOUNT_PASSWORD_MIN_LENGTH && length <= ACCOUNT_PASSWORD_MAX_LENGTH;
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
  private readonly passwordInput = byId<HTMLInputElement>('account-password-input');
  private readonly dialogLoginButton = byId<HTMLButtonElement>('account-login-btn');
  private readonly dialogRegisterButton = byId<HTMLButtonElement>('account-register-btn');
  private readonly authCloseButton = byId<HTMLButtonElement>('account-auth-close');
  private readonly authMessage = byId<HTMLElement>('account-auth-message');
  private readonly startButton = byId<HTMLButtonElement>('start-btn');
  private readonly assetNote = byId<HTMLElement>('lobby-asset-account-note');
  private readonly authService: AccountAuthService;
  private client: SupabaseClient | null = null;
  private currentUser: User | null = null;
  private profileRow: ProfileRow | null = null;
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

  constructor(authService = new AccountAuthService()) {
    this.authService = authService;
    this.loginOpenButton.addEventListener('click', () => this.openAuthDialog());
    this.signoutButton.addEventListener('click', () => void this.signOut());
    this.settingsAction.addEventListener('click', () => {
      if (this.state.mode === 'email') void this.signOut();
      else this.openAuthDialog();
    });
    this.authForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.signInWithPassword();
    });
    this.dialogLoginButton.addEventListener('click', (event) => {
      event.preventDefault();
      void this.signInWithPassword();
    });
    this.dialogRegisterButton.addEventListener('click', (event) => {
      event.preventDefault();
      void this.signUp();
    });
    this.authCloseButton.addEventListener('click', () => this.closeAuthDialog());
    this.authDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeAuthDialog();
    });
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
    this.loginOpenButton.textContent = '邮箱登录 / 注册';
    this.signoutButton.classList.toggle('hidden', !signedIn);
    this.signoutButton.disabled = busy;
    this.settingsAction.disabled = busy || (!signedIn && !this.state.available);
    this.settingsAction.textContent = signedIn ? '退出登录' : '邮箱登录 / 注册';
    this.emailInput.disabled = busy;
    this.passwordInput.disabled = busy;
    this.dialogLoginButton.disabled = busy || !this.state.available;
    this.dialogRegisterButton.disabled = busy || !this.state.available;
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
    this.setState({ phase: 'guest', message: '输入邮箱和密码登录，或创建新账号' });
    this.authDialog.showModal();
    window.requestAnimationFrame(() => this.emailInput.focus());
  }

  private closeAuthDialog(force = false): void {
    if (!this.authDialog.open) return;
    const busy = this.state.phase === 'signing_in' || this.state.phase === 'signing_up';
    if (busy && !force) return;
    this.passwordInput.value = '';
    this.authDialog.close();
    if (!force) this.loginOpenButton.focus();
  }

  private readCredentials(): { email: string; password: string } | null {
    const email = normalizeAccountEmail(this.emailInput.value);
    if (!email) {
      this.setState({ phase: 'error', message: '请输入有效的邮箱地址' });
      this.emailInput.focus();
      return null;
    }
    const password = this.passwordInput.value;
    if (!isAccountPasswordValid(password)) {
      this.setState({ phase: 'error', message: '密码需要 8–72 个字符' });
      this.passwordInput.focus();
      return null;
    }
    this.emailInput.value = email;
    return { email, password };
  }

  private async signInWithPassword(): Promise<void> {
    if (!this.client || !this.state.available || this.state.phase === 'signing_in' || this.state.phase === 'signing_up') return;
    const credentials = this.readCredentials();
    if (!credentials) return;
    this.setState({ phase: 'signing_in', message: '正在安全登录邮箱账号' });
    try {
      const { data, error } = await this.client.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (!data.session) throw new Error('session unavailable');
      await this.enqueueSessionSync(data.session);
      rememberChannel();
      this.closeAuthDialog(true);
      window.location.reload();
    } catch {
      this.setState({ phase: 'error', message: '登录失败 · 请检查邮箱、密码或邮箱确认状态' });
    } finally {
      this.passwordInput.value = '';
    }
  }

  private async signUp(): Promise<void> {
    if (!this.client || !this.state.available || this.state.phase === 'signing_in' || this.state.phase === 'signing_up') return;
    const credentials = this.readCredentials();
    if (!credentials) return;
    rememberChannel();
    this.setState({ phase: 'signing_up', message: '正在创建邮箱账号' });
    try {
      const { data, error } = await this.client.auth.signUp({
        ...credentials,
        options: { emailRedirectTo: authRedirectUrl(window.location) },
      });
      if (error) throw error;
      if (data.session) {
        await this.enqueueSessionSync(data.session);
        this.closeAuthDialog(true);
        window.location.reload();
      } else {
        this.setState({
          ready: true,
          mode: 'guest',
          phase: 'guest',
          message: '确认邮件已发送 · 请到邮箱完成确认后再登录',
        });
      }
    } catch {
      this.setState({ phase: 'error', message: '注册失败 · 请检查邮箱或稍后重试' });
    } finally {
      this.passwordInput.value = '';
    }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.setState({ phase: 'error', message: `退出失败，请重试 · ${message}` });
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
