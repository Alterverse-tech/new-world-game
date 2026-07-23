(() => {
  const RECENT_CHANNELS_KEY = "whiteroom.entry.recent-channels.v1";
  const entry = {
    boot: document.querySelector("#boot-overlay"),
    panel: document.querySelector("#account-panel"),
    userName: document.querySelector("#account-user-name"),
    accountStatus: document.querySelector("#account-status"),
    loginButton: document.querySelector("#account-login-open-btn"),
    signoutButton: document.querySelector("#account-signout-btn"),
    accountLog: document.querySelector("#entry-account-log"),
    accountLogCopy: document.querySelector("#entry-account-log-copy"),
    form: document.querySelector("#lobby-channel-form"),
    channelInput: document.querySelector("#lobby-channel-input"),
    channelStatus: document.querySelector("#lobby-channel-status"),
    startButton: document.querySelector("#start-btn"),
    recentSecondary: document.querySelector("#entry-recent-secondary"),
    loginNote: document.querySelector("#entry-login-lock-note"),
    loginInline: document.querySelector("#entry-login-inline"),
    transition: document.querySelector("#entry-transition"),
    transitionChannel: document.querySelector("#entry-transition-channel"),
  };

  if (Object.values(entry).some((element) => !element)) return;

  let transitionTimer = 0;
  let accountSyncQueued = false;

  const getRecentChannels = () => {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_CHANNELS_KEY) || "[]");
      return Array.isArray(value) ? value.filter((channel) => /^\d{4,12}$/.test(channel)).slice(0, 4) : [];
    } catch {
      return [];
    }
  };

  const saveRecentChannel = (channel) => {
    if (!/^\d{4,12}$/.test(channel)) return;
    const next = [channel, ...getRecentChannels().filter((item) => item !== channel)].slice(0, 4);
    try {
      localStorage.setItem(RECENT_CHANNELS_KEY, JSON.stringify(next));
    } catch {
      // The entrance remains functional when browser storage is unavailable.
    }
    renderRecentChannel();
  };

  const renderRecentChannel = () => {
    const recent = getRecentChannels().find((channel) => channel !== "0000") || "8848";
    entry.recentSecondary.dataset.entryChannel = recent;
    const label = entry.recentSecondary.querySelector("b");
    if (label && label.textContent !== `#${recent}`) label.textContent = `#${recent}`;
  };

  const isSignedIn = () =>
    entry.panel.dataset.state === "signed_in" || !entry.signoutButton.classList.contains("hidden");

  const isAccountBusy = () =>
    ["loading", "signing_in", "signing_up", "signing_out"].includes(entry.panel.dataset.state || "loading");

  const setText = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };

  const syncAccountUi = () => {
    accountSyncQueued = false;
    const signedIn = isSignedIn();
    const busy = isAccountBusy();
    const displayName = entry.userName.textContent.trim() || "玩家";
    const accountDetail = entry.accountStatus.textContent.trim().split(" · ")[0];
    const accountLabel = accountDetail.includes("@") ? accountDetail : displayName;

    entry.panel.dataset.entryAuth = signedIn ? "signed-in" : "guest";
    entry.loginNote.classList.toggle("is-hidden", signedIn);

    if (signedIn) {
      setText(entry.accountLogCopy, `${accountLabel} · SYNCED`);
      entry.startButton.dataset.action = "enter";
      if (entry.channelStatus.dataset.state !== "joining") entry.startButton.disabled = false;
      setText(entry.startButton, "进入频道");
    } else if (busy) {
      setText(entry.accountLogCopy, "正在检查账号 · CHECKING");
      entry.startButton.dataset.action = "checking";
      entry.startButton.disabled = true;
      setText(entry.startButton, "正在同步");
    } else {
      setText(entry.accountLogCopy, "未登录 · GUEST · 登录 →");
      entry.startButton.dataset.action = "login";
      entry.startButton.disabled = false;
      setText(entry.startButton, "登录后进入");
    }

    if (!signedIn && !busy) setText(entry.loginButton, "登录");
  };

  const queueAccountSync = () => {
    if (accountSyncQueued) return;
    accountSyncQueued = true;
    window.requestAnimationFrame(syncAccountUi);
  };

  const openLogin = () => {
    if (isSignedIn()) return;
    if (!entry.loginButton.disabled) {
      entry.loginButton.click();
      return;
    }
    if (entry.panel.dataset.state === "loading") {
      setText(entry.channelStatus, "正在检查账号服务，请稍候…");
      entry.channelStatus.dataset.state = "joining";
    } else {
      setText(entry.channelStatus, "账号服务暂不可用，请稍后重试");
      entry.channelStatus.dataset.state = "error";
    }
  };

  const showTransition = () => {
    const channel = entry.channelInput.value.trim();
    if (!/^\d{4,12}$/.test(channel) || entry.transition.classList.contains("is-visible")) return;
    setText(entry.transitionChannel, `#${channel}`);
    entry.transition.hidden = false;
    entry.transition.classList.add("is-visible");
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => {
      entry.transition.classList.remove("is-visible");
      entry.transition.hidden = true;
    }, 2850);
  };

  const hideTransition = () => {
    window.clearTimeout(transitionTimer);
    entry.transition.classList.remove("is-visible");
    entry.transition.hidden = true;
  };

  const handleEntryAttempt = (event) => {
    if (!isSignedIn()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openLogin();
      return;
    }
    showTransition();
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#start-btn")) {
        handleEntryAttempt(event);
        return;
      }

      const recentButton = target?.closest("[data-entry-channel]");
      if (recentButton instanceof HTMLButtonElement) {
        entry.channelInput.value = recentButton.dataset.entryChannel || "0000";
        entry.channelInput.dispatchEvent(new Event("input", { bubbles: true }));
        entry.channelInput.focus();
        return;
      }

      if (target?.closest("#entry-login-inline") || target?.closest("#entry-account-log")) openLogin();
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      if (event.target === entry.form) handleEntryAttempt(event);
    },
    true,
  );

  entry.channelInput.addEventListener("input", () => {
    const numeric = entry.channelInput.value.replace(/\D/g, "").slice(0, 12);
    if (numeric !== entry.channelInput.value) entry.channelInput.value = numeric;
  });

  const accountObserver = new MutationObserver(queueAccountSync);
  accountObserver.observe(entry.panel, {
    attributes: true,
    attributeFilter: ["class", "data-state"],
    childList: true,
    subtree: true,
    characterData: true,
  });

  const bootObserver = new MutationObserver(() => {
    if (!entry.boot.classList.contains("visible")) saveRecentChannel(entry.channelInput.value.trim());
  });
  bootObserver.observe(entry.boot, { attributes: true, attributeFilter: ["class"] });

  const channelStatusObserver = new MutationObserver(() => {
    if (entry.channelStatus.dataset.state === "error") hideTransition();
  });
  channelStatusObserver.observe(entry.channelStatus, {
    attributes: true,
    attributeFilter: ["data-state"],
    childList: true,
    characterData: true,
    subtree: true,
  });

  renderRecentChannel();
  syncAccountUi();
})();
