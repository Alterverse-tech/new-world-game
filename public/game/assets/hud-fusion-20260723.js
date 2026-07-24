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
  const mapPlazaAction = document.querySelector("#hud-map-plaza-action");
  const mapHomeAction = document.querySelector("#hud-map-home-action");
  const mapHomeMeta = document.querySelector("#hud-map-home-meta");
  const compactMapMarker = mapEntry?.querySelector(".hud-map-player");
  const expandedMapMarker = mapPanel?.querySelector(".hud-map-canvas > b");
  const existingHomeAction = document.querySelector("#lobby-home-choose");
  const existingHomeStatus = document.querySelector("#lobby-home-status");
  const avatarEntry = document.querySelector("#avatar-wardrobe-entry");
  const avatarDialog = document.querySelector("#avatar-wardrobe-dialog");
  const avatarClose = document.querySelector("#avatar-wardrobe-close");

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
    mapPlazaAction,
    mapHomeAction,
    mapHomeMeta,
    compactMapMarker,
    expandedMapMarker,
    existingHomeAction,
    existingHomeStatus,
    avatarEntry,
    avatarDialog,
    avatarClose,
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
  const closeAvatarPanel = () => {
    if (avatarDialog.open) avatarClose.click();
  };

  const closeAllHudPanels = (except) => {
    if (except !== playerPanel) closePlayerPanel();
    if (except !== mapPanel) closeMapPanel();
    if (except !== helpOverlay) closeHelp();
    if (except !== avatarDialog) closeAvatarPanel();
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
  avatarEntry.addEventListener("click", () => closeAllHudPanels(avatarDialog));
  new MutationObserver(() => {
    if (avatarDialog.open) closeAllHudPanels(avatarDialog);
  }).observe(avatarDialog, { attributes: true, attributeFilter: ["open"] });
  helpOverlay.addEventListener("click", (event) => {
    if (event.target === helpOverlay) closeHelp();
  });

  mapHomeAction.addEventListener("click", () => {
    closeMapPanel();
    existingHomeAction.click();
  });

  mapPlazaAction.addEventListener("click", () => {
    const returned = window.__WHITEROOM_HUD_ACTIONS__?.returnToPlaza?.() === true;
    if (returned) closeMapPanel();
  });

  const LOBBY_MAP_HALF_EXTENT = 54;
  const PUBLIC_AREA_HALF_EXTENT = 15;
  const MAP_EDGE_PADDING = 3;
  const mapMarkers = [compactMapMarker, expandedMapMarker];
  let mapContextAvailable = true;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const syncMapPlayerPosition = ({ x, z, yaw = 0, channel = "", controlTarget = "player" }) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;

    const nextMapContextAvailable = !String(channel).includes("space-");
    const mapContextChanged = mapContextAvailable !== nextMapContextAvailable;
    mapContextAvailable = nextMapContextAvailable;
    const inCentralPlaza = Math.abs(x) <= PUBLIC_AREA_HALF_EXTENT && Math.abs(z) <= PUBLIC_AREA_HALF_EXTENT;
    mapPlazaAction.disabled = inCentralPlaza || controlTarget === "vehicle" || !mapContextAvailable;
    mapPlazaAction.textContent = controlTarget === "vehicle"
      ? "请先下车"
      : inCentralPlaza
        ? "当前位置"
        : "返回广场";

    const usablePercent = 100 - MAP_EDGE_PADDING * 2;
    const worldSize = LOBBY_MAP_HALF_EXTENT * 2;
    const left = MAP_EDGE_PADDING + clamp((x + LOBBY_MAP_HALF_EXTENT) / worldSize, 0, 1) * usablePercent;
    const top = MAP_EDGE_PADDING + clamp((z + LOBBY_MAP_HALF_EXTENT) / worldSize, 0, 1) * usablePercent;
    const yawDegrees = -(yaw * 180) / Math.PI;

    mapMarkers.forEach((marker) => {
      marker.style.setProperty("--hud-map-player-x", `${left.toFixed(2)}%`);
      marker.style.setProperty("--hud-map-player-y", `${top.toFixed(2)}%`);
      marker.style.setProperty("--hud-map-player-yaw", `${yawDegrees.toFixed(2)}deg`);
    });
    if (mapContextChanged) window.requestAnimationFrame(() => syncHudAvailability());
  };

  document.addEventListener("whiteroom:local-pose", (event) => syncMapPlayerPosition(event.detail ?? {}));
  syncMapPlayerPosition({ x: 0, z: 4.2, yaw: 0 });

  const syncHomeMapRow = () => {
    const status = existingHomeStatus.textContent?.trim() || "尚未认领领地";
    const isUnclaimed = status.includes("尚未") || status.includes("未认领");
    mapHomeMeta.textContent = status;
    mapHomeAction.textContent = isUnclaimed ? "选择领地" : "管理领地";
  };

  new MutationObserver(syncHomeMapRow).observe(existingHomeStatus, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  syncHomeMapRow();

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
    mapEntry.classList.toggle("hidden", !showCornerEntries || !mapContextAvailable);
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
