(() => {
  let mode = 'email';
  let busy = false;
  let recoveryToken = null;
  let authConfigPromise = null;

  const get = (id) => document.getElementById(id);

  function setMessage(message, state = 'guest') {
    const element = get('account-reset-message');
    element.textContent = message;
    element.dataset.state = state;
  }

  function setMode(nextMode) {
    mode = nextMode;
    get('account-reset-email-panel').hidden = mode !== 'email';
    get('account-reset-password-panel').hidden = mode !== 'password';
    get('account-reset-submit').textContent = mode === 'email' ? '发送重置邮件' : '保存新密码';
    for (const step of document.querySelectorAll('[data-reset-step]')) {
      const name = step.dataset.resetStep;
      step.classList.toggle('is-active', name === mode);
      step.classList.toggle('is-complete', mode === 'password' && name === 'email');
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    for (const id of [
      'account-reset-email',
      'account-reset-password',
      'account-reset-password-confirm',
      'account-reset-submit',
      'account-reset-back',
      'account-reset-close',
    ]) {
      get(id).disabled = busy;
    }
  }

  async function getAuthConfig() {
    if (authConfigPromise) return authConfigPromise;
    authConfigPromise = fetch('/api/auth/config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`账号配置 HTTP ${response.status}`);
      const config = await response.json();
      if (!config.enabled || !config.supabaseUrl || !config.publishableKey) {
        throw new Error('邮箱账号服务尚未启用');
      }
      return config;
    }).catch((error) => {
      authConfigPromise = null;
      throw error;
    });
    return authConfigPromise;
  }

  async function responseError(response, fallback) {
    try {
      const body = await response.json();
      const code = body.error_code || body.code || '';
      const messages = {
        email_address_invalid: '邮箱地址无效，请检查后重试。',
        over_email_send_rate_limit: '重置邮件发送过于频繁，请稍后再试。',
        over_request_rate_limit: '请求过于频繁，请稍后再试。',
        weak_password: '新密码强度不足，请使用至少 8 位复杂密码。',
        same_password: '新密码不能与当前密码相同。',
      };
      return messages[code] || fallback;
    } catch {
      return fallback;
    }
  }

  async function sendRecoveryEmail() {
    const emailInput = get('account-reset-email');
    emailInput.value = emailInput.value.trim().toLowerCase();
    if (!emailInput.checkValidity()) {
      setMessage('请输入有效的注册邮箱。', 'error');
      emailInput.focus();
      return;
    }

    setBusy(true);
    setMessage('正在发送密码重置邮件…', 'loading');
    try {
      const config = await getAuthConfig();
      const redirect = new URL('/?password_reset=1', window.location.origin).href;
      const endpoint = new URL('/auth/v1/recover', config.supabaseUrl);
      endpoint.searchParams.set('redirect_to', redirect);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          apikey: config.publishableKey,
          Authorization: `Bearer ${config.publishableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: emailInput.value }),
      });
      if (!response.ok) throw new Error(await responseError(response, '重置邮件发送失败，请稍后重试。'));
      setMessage('如果该邮箱已注册，重置邮件会在几分钟内送达。请打开邮件中的链接继续。', 'success');
      get('account-reset-submit').textContent = '重新发送邮件';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置邮件发送失败，请稍后重试。', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword() {
    const password = get('account-reset-password');
    const confirmation = get('account-reset-password-confirm');
    if (password.value.length < 8 || password.value.length > 72) {
      setMessage('新密码需要 8–72 个字符。', 'error');
      password.focus();
      return;
    }
    if (password.value !== confirmation.value) {
      setMessage('两次输入的新密码不一致。', 'error');
      confirmation.focus();
      confirmation.select();
      return;
    }
    if (!recoveryToken) {
      setMessage('重置链接无效或已过期，请重新发送邮件。', 'error');
      setMode('email');
      return;
    }

    setBusy(true);
    setMessage('正在保存新密码…', 'loading');
    try {
      const config = await getAuthConfig();
      const response = await fetch(new URL('/auth/v1/user', config.supabaseUrl), {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          apikey: config.publishableKey,
          Authorization: `Bearer ${recoveryToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: password.value }),
      });
      if (!response.ok) throw new Error(await responseError(response, '密码更新失败，重置链接可能已过期。'));
      recoveryToken = null;
      password.value = '';
      confirmation.value = '';
      setMessage('密码已更新，正在返回登录…', 'success');
      window.setTimeout(() => returnToLogin('密码已更新，请使用新密码登录。'), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码更新失败，请重新发送重置邮件。', 'error');
      setBusy(false);
    }
  }

  function openDialog() {
    const loginDialog = get('account-auth-dialog');
    const resetDialog = get('account-reset-dialog');
    const sourceEmail = get('account-email-input').value.trim();
    if (loginDialog.open) loginDialog.close();
    get('account-reset-email').value = sourceEmail;
    setMode('email');
    setMessage('输入注册邮箱以接收重置邮件。');
    if (!resetDialog.open) resetDialog.showModal();
    requestAnimationFrame(() => get('account-reset-email').focus());
  }

  function openRecovery(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const error = params.get('error_description') || params.get('error');
    if (error) {
      setMode('email');
      setMessage('重置链接无效或已过期，请重新发送邮件。', 'error');
    } else if (params.get('type') === 'recovery' && params.get('access_token')) {
      recoveryToken = params.get('access_token');
      setMode('password');
      setMessage('邮箱验证完成，请设置新密码。', 'success');
    } else {
      return;
    }
    const dialog = get('account-reset-dialog');
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => (mode === 'password' ? get('account-reset-password') : get('account-reset-email')).focus());
  }

  function returnToLogin(message = '请输入邮箱和新密码登录。') {
    const resetDialog = get('account-reset-dialog');
    if (resetDialog.open) resetDialog.close();
    recoveryToken = null;
    get('account-reset-password').value = '';
    get('account-reset-password-confirm').value = '';
    const email = get('account-reset-email').value.trim();
    if (email) get('account-email-input').value = email;
    get('account-login-open-btn').click();
    get('account-auth-message').textContent = message;
    get('account-auth-message').dataset.state = 'success';
  }

  document.addEventListener('DOMContentLoaded', () => {
    get('account-reset-open').addEventListener('click', openDialog);
    get('account-reset-close').addEventListener('click', () => returnToLogin());
    get('account-reset-back').addEventListener('click', () => returnToLogin());
    get('account-reset-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      if (mode === 'email') await sendRecoveryEmail();
      else await updatePassword();
    });
    get('account-reset-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      returnToLogin();
    });

    const recoveryHash = window.__WHITEROOM_RECOVERY_HASH__;
    try { delete window.__WHITEROOM_RECOVERY_HASH__; } catch {}
    if (typeof recoveryHash === 'string') openRecovery(recoveryHash);
  });
})();
