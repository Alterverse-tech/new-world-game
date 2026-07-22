(() => {
  const hash = window.location.hash;
  if (!hash || !/(?:^|[&#])(type=recovery|access_token=|error(?:_description)?=)/.test(hash)) return;
  Object.defineProperty(window, '__WHITEROOM_RECOVERY_HASH__', {
    configurable: true,
    value: hash,
  });
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
})();
