(() => {
  const OTP_COOLDOWN_MS = 60_000;
  const OTP_COOLDOWN_KEY = 'whiteroom.auth.login-otp-cooldown.v1';

  let stage = 'email';
  let busy = false;
  let loginEmail = '';
  let cooldownUntil = 0;
  let cooldownTimer = null;
  let supabaseClient = null;

  const get = (id) => document.getElementById(id);

  function setMessage(message, state = 'guest') {
    const element = get('account-auth-message');
    element.textContent = message;
    element.dataset.state = state;
  }

  function setStage(nextStage) {
    stage = nextStage;
    const emailField = get('account-email-input').closest('.account-auth-field');
    const otpPanel = get('account-login-otp-panel');
    emailField.hidden = stage !== 'email';
    otpPanel.hidden = stage !== 'verify';
    get('account-login-btn').textContent = stage === 'email' ? '发送验证码' : '验证并登录';
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    for (const id of [
      'account-email-input',
      'account-login-otp-input',
      'account-login-otp-change',
      'account-login-btn',
      'account-auth-close',
    ]) {
      get(id).disabled = busy;
    }
    updateCooldownButton();
  }

  function describeAuthError(error, action) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const messages = {
      email_address_invalid: '邮箱地址无效，请使用可接收验证码的真实邮箱。',
      over_email_send_rate_limit: '邮件发送过于频繁，请使用已收到的验证码或稍后重试。',
      over_request_rate_limit: '请求过于频繁，请稍后重试。',
      otp_expired: '验证码无效或已过期，请重新发送。',
      invalid_credentials: '验证码不正确，请检查后重试。',
    };
    return messages[code] || `${action}失败，请稍后重试。`;
  }

  async function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    const response = await fetch('/api/auth/config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`账号配置 HTTP ${response.status}`);
    const config = await response.json();
    if (!config.enabled || !config.supabaseUrl || !config.publishableKey) {
      throw new Error('邮箱账号服务尚未启用');
    }

    const { createClient } = await import('./index-5fZAOLQ3.js');
    supabaseClient = createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        autoRefreshToken: true,
        persistSession: true,
      },
    });
    return supabaseClient;
  }

  function validateEmail() {
    const input = get('account-email-input');
    input.value = input.value.trim().toLowerCase();
    if (!input.checkValidity()) {
      setMessage('请输入有效的邮箱地址。', 'error');
      input.focus();
      return false;
    }
    loginEmail = input.value;
    return true;
  }

  function restoreCooldown() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(OTP_COOLDOWN_KEY) || 'null');
      cooldownUntil = stored?.email === loginEmail && Number.isFinite(stored?.until)
        ? stored.until
        : 0;
    } catch {
      cooldownUntil = 0;
    }
  }

  function rememberCooldown() {
    try {
      sessionStorage.setItem(OTP_COOLDOWN_KEY, JSON.stringify({
        email: loginEmail,
        until: cooldownUntil,
      }));
    } catch {}
  }

  function updateCooldownButton() {
    const button = get('account-login-otp-resend');
    const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    button.disabled = busy || remaining > 0;
    button.textContent = remaining > 0 ? `重新发送（${remaining}s）` : '重新发送验证码';
    if (cooldownTimer) window.clearTimeout(cooldownTimer);
    cooldownTimer = remaining > 0
      ? window.setTimeout(updateCooldownButton, 1000)
      : null;
  }

  function startCooldown() {
    cooldownUntil = Date.now() + OTP_COOLDOWN_MS;
    rememberCooldown();
    updateCooldownButton();
  }

  async function sendCode({ resend = false } = {}) {
    if (busy) return;
    if (!resend && !validateEmail()) return;
    restoreCooldown();

    if (cooldownUntil > Date.now()) {
      get('account-login-otp-email').textContent = loginEmail;
      setStage('verify');
      updateCooldownButton();
      setMessage('验证码已发送，可直接输入；如需重发请等待倒计时结束。');
      return;
    }

    setBusy(true);
    setMessage(resend ? '正在重新发送验证码…' : '正在通过 Supabase 发送验证码…', 'loading');
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.signInWithOtp({
        email: loginEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: new URL('/', window.location.origin).href,
        },
      });
      if (error) throw error;

      get('account-login-otp-email').textContent = loginEmail;
      setStage('verify');
      startCooldown();
      setMessage('验证码已发送，请输入邮件中的 6 位数字。', 'success');
      requestAnimationFrame(() => get('account-login-otp-input').focus());
    } catch (error) {
      setMessage(describeAuthError(error, '验证码发送'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function establishWhiteRoomSession(session) {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`WhiteRoom 会话同步 HTTP ${response.status}`);
    const body = await response.json();
    if (body.account?.signedIn !== true) throw new Error('WhiteRoom 会话响应无效');
  }

  async function verifyCode() {
    if (busy) return;
    const input = get('account-login-otp-input');
    const token = input.value.replace(/\D/g, '');
    if (!/^\d{6}$/.test(token)) {
      setMessage('请输入邮件中的 6 位验证码。', 'error');
      input.focus();
      input.select();
      return;
    }

    setBusy(true);
    setMessage('正在验证并登录…', 'loading');
    try {
      const client = await getSupabaseClient();
      const { data, error } = await client.auth.verifyOtp({
        email: loginEmail,
        token,
        type: 'email',
      });
      if (error) throw error;
      if (!data.session) throw new Error('Supabase 未返回登录会话');

      await establishWhiteRoomSession(data.session);
      try { sessionStorage.removeItem(OTP_COOLDOWN_KEY); } catch {}
      setMessage('登录成功，正在进入 WhiteRoom…', 'success');
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setMessage(describeAuthError(error, '验证码验证'), 'error');
      input.focus();
      input.select();
      setBusy(false);
    }
  }

  function changeEmail() {
    if (busy) return;
    get('account-login-otp-input').value = '';
    setStage('email');
    setMessage('输入邮箱获取验证码；新邮箱将自动创建账号。');
    requestAnimationFrame(() => get('account-email-input').focus());
  }

  function normalizeEntryLabels() {
    get('account-login-open-btn').textContent = '邮箱验证码登录';
    if (get('settings-account-action').textContent !== '退出登录') {
      get('settings-account-action').textContent = '邮箱验证码登录';
    }
  }

  function resetDialog() {
    if (busy) return;
    normalizeEntryLabels();
    loginEmail = '';
    cooldownUntil = 0;
    get('account-login-otp-input').value = '';
    setStage('email');
    setMessage('输入邮箱获取验证码；新邮箱将自动创建账号。');
  }

  function handleAuthSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (stage === 'email') void sendCode();
    else void verifyCode();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = get('account-auth-dialog');
    normalizeEntryLabels();

    document.addEventListener('submit', (event) => {
      if (event.target === get('account-auth-form')) handleAuthSubmit(event);
    }, true);
    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('#account-login-btn') : null;
      if (button) handleAuthSubmit(event);
    }, true);

    get('account-login-otp-resend').addEventListener('click', () => sendCode({ resend: true }));
    get('account-login-otp-change').addEventListener('click', changeEmail);
    get('account-login-otp-input').addEventListener('input', (event) => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
      if (event.target.value.length === 6 && !busy) void verifyCode();
    });
    get('account-email-input').addEventListener('input', () => {
      if (stage === 'email') setMessage('输入邮箱获取验证码；新邮箱将自动创建账号。');
    });

    new MutationObserver(() => {
      if (dialog.open) resetDialog();
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });
})();
