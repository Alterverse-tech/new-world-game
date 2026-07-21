(function () {
  'use strict';

  if (window.__whiteRoomGameExperienceInstalled) return;
  window.__whiteRoomGameExperienceInstalled = true;

  function quitGame(event) {
    event.preventDefault();
    event.stopPropagation();
    document.exitPointerLock?.();
    window.location.reload();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('quit-game-btn')?.addEventListener('click', quitGame);
  });
}());
