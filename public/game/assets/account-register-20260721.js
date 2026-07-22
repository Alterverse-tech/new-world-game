(() => {
  let stage = 'details';
  let busy = false;
  let registrationEmail = '';
  let registrationPassword = '';
  let supabaseClient = null;
  let cooldownUntil = 0;
  let cooldownTimer = null;

  const OTP_COOLDOWN_MS = 60_000;
  const OTP_COOLDOWN_KEY = 'whiteroom.auth.otp-cooldown.v1';

  const get = (id) => document.getElementById(id);

  function setMessage(message, state = 'guest') {
    const element = get('account-register-message');
    element.textContent = message;
    element.dataset.state = state;
  }

  function setStage(nextStage) {
    stage = nextStage;
    get('account-register-details').hidden = stage !== 'details';
    get('account-register-verify').hidden = stage !== 'verify';
    get('account-register-submit').textContent = stage === 'details' ? '发送验证码' : '验证并创建账号';

    for (const step of document.querySelectorAll('[data-register-step]')) {
      const stepName = step.dataset.registerStep;
      const order = ['details', 'verify', 'complete'];
      step.classList.toggle('is-active', stepName === stage);
      step.classList.toggle('is-complete', order.indexOf(stepName) < order.indexOf(stage));
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    for (const id of [
      'account-register-email',
      'account-register-password',
      'account-register-password-confirm',
      'account-register-code',
      'account-register-submit',
      'account-register-close',
      'account-register-have-code',
    ]) {
      get(id).disabled = busy;
    }
    updateCooldownButton();
  }

  function rememberCooldown() {
    try {
      sessionStorage.setItem(OTP_COOLDOWN_KEY, JSON.stringify({
        email: registrationEmail,
        until: cooldownUntil,
      }));
    } catch {}
  }

  function restoreCooldown() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(OTP_COOLDOWN_KEY) || 'null');
      cooldownUntil = stored?.email === registrationEmail && Number.isFinite(stored?.until)
        ? stored.until
        : 0;
    } catch {
      cooldownUntil = 0;
    }
    updateCooldownButton();
  }

  function updateCooldownButton() {
    const button = get('account-register-resend');
    if (!button) return;
    const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    button.disabled = busy || remaining > 0;
    button.textContent = remaining > 0 ? `重新发送验证码（${remaining}s）` : '重新发送验证码';
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

  function clearSecrets() {
    registrationPassword = '';
    get('account-register-password').value = '';
    get('account-register-password-confirm').value = '';
    get('account-register-code').value = '';
  }

  function describeAuthError(error, action) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const messages = {
      email_address_invalid: '邮箱地址无效，请使用可接收验证码的真实邮箱。',
      email_exists: '该邮箱已注册，请返回登录。',
      user_already_exists: '该邮箱已注册，请返回登录。',
      weak_password: '密码强度不足，请使用至少 8 位复杂密码。',
      over_email_send_rate_limit: 'Supabase 邮件发送额度已触发限制；这不是 60 秒冷却，请使用已收到的验证码，或约 1 小时后重试。',
      over_request_rate_limit: '请求过于频繁，请稍后再试。',
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

  function validateDetails() {
    const email = get('account-register-email');
    const password = get('account-register-password');
    const confirmation = get('account-register-password-confirm');

    email.value = email.value.trim().toLowerCase();
    if (!email.checkValidity()) {
      setMessage('请输入有效的邮箱地址。', 'error');
      email.focus();
      return false;
    }
    if (password.value.length < 8 || password.value.length > 72) {
      setMessage('密码需要 8–72 个字符。', 'error');
      password.focus();
      return false;
    }
    if (password.value !== confirmation.value) {
      setMessage('两次输入的密码不一致。', 'error');
      confirmation.focus();
      confirmation.select();
      return false;
    }

    registrationEmail = email.value;
    registrationPassword = password.value;
    restoreCooldown();
    return true;
  }

  async function sendCode({ resend = false } = {}) {
    if (busy || (!resend && !validateDetails())) return;
    if (cooldownUntil > Date.now()) {
      updateCooldownButton();
      get('account-register-code-email').textContent = registrationEmail;
      setStage('verify');
      setMessage('Supabase 要求同一邮箱至少间隔 60 秒。已有验证码可直接输入，否则等待倒计时结束。', 'error');
      return;
    }
    setBusy(true);
    setMessage(resend ? '正在重新发送验证码…' : '正在通过 Supabase 发送验证码…', 'loading');
    try {
      const client = await getSupabaseClient();
      const { error } = await client.auth.signInWithOtp({
        email: registrationEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: new URL('/', window.location.origin).href,
        },
      });
      if (error) throw error;
      get('account-register-code-email').textContent = registrationEmail;
      setStage('verify');
      startCooldown();
      setMessage('验证码已发送，请输入邮件中的 6 位数字。', 'success');
      requestAnimationFrame(() => get('account-register-code').focus());
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'over_email_send_rate_limit') {
        get('account-register-code-email').textContent = registrationEmail;
        setStage('verify');
        startCooldown();
        setMessage('Supabase 已拒绝发送：这是服务器邮件额度限制，不是 60 秒冷却。已有验证码可直接输入；没有验证码请约 1 小时后重试，正式使用需配置自定义 SMTP。', 'error');
      } else {
        setMessage(describeAuthError(error, '验证码发送'), 'error');
      }
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
    const codeInput = get('account-register-code');
    const token = codeInput.value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) {
      setMessage('请输入邮件中的 6 位验证码。', 'error');
      codeInput.focus();
      codeInput.select();
      return;
    }

    setBusy(true);
    setMessage('正在验证邮箱并创建账号…', 'loading');
    try {
      const client = await getSupabaseClient();
      const { data, error } = await client.auth.verifyOtp({
        email: registrationEmail,
        token,
        type: 'email',
      });
      if (error) throw error;
      if (!data.session) throw new Error('Supabase 未返回登录会话');

      const { error: passwordError } = await client.auth.updateUser({
        password: registrationPassword,
      });
      if (passwordError) throw passwordError;
      await establishWhiteRoomSession(data.session);

      clearSecrets();
      try { sessionStorage.removeItem(OTP_COOLDOWN_KEY); } catch {}
      setStage('complete');
      setMessage('注册完成，正在进入 WhiteRoom…', 'success');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(describeAuthError(error, '验证码验证'), 'error');
      codeInput.focus();
      codeInput.select();
      setBusy(false);
    }
  }

  function openRegisterDialog(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const loginDialog = get('account-auth-dialog');
    const registerDialog = get('account-register-dialog');
    const sourceEmail = get('account-email-input').value.trim();
    if (loginDialog.open) loginDialog.close();

    get('account-register-email').value = sourceEmail;
    registrationEmail = '';
    cooldownUntil = 0;
    clearSecrets();
    setStage('details');
    setBusy(false);
    setMessage('填写后由 Supabase 向邮箱发送 6 位验证码。');
    if (!registerDialog.open) registerDialog.showModal();
    requestAnimationFrame(() => {
      (sourceEmail ? get('account-register-password') : get('account-register-email')).focus();
    });
  }

  function returnToLogin() {
    const registerDialog = get('account-register-dialog');
    if (registerDialog.open) registerDialog.close();
    clearSecrets();
    get('account-email-input').value = registrationEmail || get('account-register-email').value.trim();
    get('account-login-open-btn').click();
  }

  function closeRegistration() {
    const registerDialog = get('account-register-dialog');
    if (registerDialog.open) registerDialog.close();
    clearSecrets();
    get('account-login-open-btn').focus();
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (stage === 'details') await sendCode();
    else if (stage === 'verify') await verifyCode();
  }

  function useExistingCode() {
    if (!validateDetails()) return;
    get('account-register-code-email').textContent = registrationEmail;
    setStage('verify');
    setMessage('请输入之前收到、且仍在有效期内的 6 位验证码。');
    requestAnimationFrame(() => get('account-register-code').focus());
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#account-register-btn') : null;
    if (target) openRegisterDialog(event);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    get('account-register-form').addEventListener('submit', submitRegistration);
    get('account-register-resend').addEventListener('click', () => sendCode({ resend: true }));
    get('account-register-have-code').addEventListener('click', useExistingCode);
    get('account-register-close').addEventListener('click', closeRegistration);
    get('account-register-code').addEventListener('input', (event) => {
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
      if (stage === 'verify' && event.target.value.length === 6 && !busy) {
        void verifyCode();
      }
    });
    get('account-register-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      returnToLogin();
    });
  });
})();
