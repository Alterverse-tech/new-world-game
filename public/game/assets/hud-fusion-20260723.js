(() => {
  const hud = document.querySelector("#hud");
  const editorEntry = document.querySelector("#lobby-editor-entry");
  const multiplayerEntry = document.querySelector("#multiplayer-hud");
  const playerPanel = document.querySelector("#player-stats-panel");
  const playerClose = document.querySelector("#player-stats-close");
  const helpEntry = document.querySelector("#hud-help-entry");
  const helpOverlay = document.querySelector("#hud-help-overlay");
  const helpClose = document.querySelector("#hud-help-close");
  const mapEntry = document.querySelector("#hud-map-entry");
  const mapPanel = document.querySelector("#hud-map-panel");
  const mapClose = document.querySelector("#hud-map-close");
  const mapHomeAction = document.querySelector("#hud-map-home-action");
  const existingHomeAction = document.querySelector("#lobby-home-choose");

  const elements = [
    hud,
    editorEntry,
    multiplayerEntry,
    playerPanel,
    playerClose,
    helpEntry,
    helpOverlay,
    helpClose,
    mapEntry,
    mapPanel,
    mapClose,
    mapHomeAction,
    existingHomeAction,
  ];
  if (elements.some((element) => !element)) return;

  const setPanelOpen = (panel, trigger, open) => {
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", String(!open));
    trigger.setAttribute("aria-expanded", String(open));
  };

  const closePlayerPanel = () => setPanelOpen(playerPanel, multiplayerEntry, false);
  const closeMapPanel = () => setPanelOpen(mapPanel, mapEntry, false);
  const closeHelp = () => setPanelOpen(helpOverlay, helpEntry, false);

  const closeAllHudPanels = (except) => {
    if (except !== playerPanel) closePlayerPanel();
    if (except !== mapPanel) closeMapPanel();
    if (except !== helpOverlay) closeHelp();
  };

  const togglePlayerPanel = () => {
    if (multiplayerEntry.classList.contains("hidden")) return;
    const willOpen = playerPanel.hidden;
    closeAllHudPanels(willOpen ? playerPanel : null);
    setPanelOpen(playerPanel, multiplayerEntry, willOpen);
  };

  const toggleMapPanel = () => {
    if (mapEntry.classList.contains("hidden")) return;
    const willOpen = mapPanel.hidden;
    closeAllHudPanels(willOpen ? mapPanel : null);
    setPanelOpen(mapPanel, mapEntry, willOpen);
  };

  const toggleHelp = () => {
    if (helpEntry.classList.contains("hidden")) return;
    const willOpen = helpOverlay.hidden;
    closeAllHudPanels(willOpen ? helpOverlay : null);
    setPanelOpen(helpOverlay, helpEntry, willOpen);
    if (willOpen) helpClose.focus();
  };

  multiplayerEntry.addEventListener("click", togglePlayerPanel);
  playerClose.addEventListener("click", closePlayerPanel);
  mapEntry.addEventListener("click", toggleMapPanel);
  mapClose.addEventListener("click", closeMapPanel);
  helpEntry.addEventListener("click", toggleHelp);
  helpClose.addEventListener("click", closeHelp);
  helpOverlay.addEventListener("click", (event) => {
    if (event.target === helpOverlay) closeHelp();
  });

  mapHomeAction.addEventListener("click", () => {
    closeMapPanel();
    existingHomeAction.click();
  });

  const isTypingTarget = (target) =>
    target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

  window.addEventListener(
    "keydown",
    (event) => {
      if (isTypingTarget(event.target) || hud.classList.contains("hidden") || event.repeat) return;

      if (event.code === "Tab" && !multiplayerEntry.classList.contains("hidden")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        togglePlayerPanel();
        return;
      }

      if (event.code === "KeyM" && !mapEntry.classList.contains("hidden")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleMapPanel();
        return;
      }

      if (event.code === "KeyH" && !helpEntry.classList.contains("hidden")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleHelp();
        return;
      }

      if (event.code === "Escape" && (!playerPanel.hidden || !mapPanel.hidden || !helpOverlay.hidden)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAllHudPanels();
      }
    },
    true,
  );

  const syncHudAvailability = () => {
    const hasLobby = !editorEntry.classList.contains("hidden");
    const isBuilding = editorEntry.classList.contains("active");
    const showCornerEntries = hasLobby && !isBuilding && !hud.classList.contains("hidden");

    helpEntry.classList.toggle("hidden", !showCornerEntries);
    mapEntry.classList.toggle("hidden", !showCornerEntries);
    hud.classList.toggle("hud-build-mode", isBuilding);

    if (!showCornerEntries) {
      closeMapPanel();
      closeHelp();
    }
    if (hud.classList.contains("hidden") || multiplayerEntry.classList.contains("hidden")) closePlayerPanel();
  };

  const observer = new MutationObserver(syncHudAvailability);
  observer.observe(editorEntry, { attributes: true, attributeFilter: ["class"] });
  observer.observe(multiplayerEntry, { attributes: true, attributeFilter: ["class"] });
  observer.observe(hud, { attributes: true, attributeFilter: ["class"] });

  syncHudAvailability();
})();
