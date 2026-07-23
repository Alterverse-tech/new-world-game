/* global process, URL, window, localStorage, location, fetch, document, console, HTMLButtonElement, HTMLElement, Image, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightEntry = process.env.PLAYWRIGHT_MODULE
  ?? process.env.WHITEROOM_PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightEntry).href);

const baseUrl = new URL(process.env.WHITEROOM_E2E_URL ?? 'http://127.0.0.1:5183/');
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT
    ?? process.env.OUTPUT
    ?? 'test-results/persistent-heaven-hell',
);
const channel = process.env.WHITEROOM_E2E_CHANNEL
  ?? process.env.CHANNEL
  ?? `98${String(Date.now()).slice(-8)}`;
const heavenChannel = `space-${channel}-heaven`;
const hellChannel = `space-${channel}-hell`;
const doorCatalogId = 'code-heaven-hell-door';
const glowCatalogId = 'code-glow-cube';
const dragonId = 'realm-celestial-dragon-0001';
const dragonCatalogId = 'code-celestial-riding-dragon';
const pianoId = 'realm-infernal-piano-0001';
const pianoCatalogId = 'code-infernal-concert-grand';
const viewport = { width: 1440, height: 900 };
const contexts = [];
const errors = [];
const createdObjects = [];
const screenshots = [];
const stateFiles = [];
let alice;
let bob;
let doorId = null;
let heavenGlowId = null;
let hellGlowId = null;
let baselines = null;

assert.match(channel, /^\d{4,12}$/, 'WHITEROOM_E2E_CHANNEL must be 4-12 digits');
assert.notEqual(
  channel,
  '0000',
  'Persistent-space E2E requires an isolated numeric origin channel; never use production channel 0000',
);
assert.match(baseUrl.protocol, /^https?:$/, 'WHITEROOM_E2E_URL must use http or https');
await mkdir(outputDirectory, { recursive: true });

function saveFor(name) {
  return {
    settings: {
      sensitivity: 1,
      fov: 75,
      headBob: false,
      // Keep Web Audio enabled so this release gate exercises the actual
      // synchronized piano scheduler, not only the persisted interaction row.
      volume: 0.2,
      reducedMotion: true,
      nickname: name,
      avatarId: '',
      lobbyView: 'first',
      lang: 'zh-CN',
    },
    history: [],
    stats: { totalCompleted: 0, totalDives: 0 },
    recent: [],
  };
}

function hasNoLevel(state) {
  return !Object.prototype.hasOwnProperty.call(state, 'level');
}

function objectFrom(state, id) {
  return state.lobbyEditor.objects.find((object) => object.id === id);
}

function stableObjects(payload) {
  assert.ok(Array.isArray(payload?.objects), `Lobby API did not return objects: ${JSON.stringify(payload)}`);
  return [...payload.objects].sort((left, right) => left.id.localeCompare(right.id));
}

function persistentSpaceMatches(state, id, stateChannel) {
  return state.state === 'HUB'
    && hasNoLevel(state)
    && state.persistentSpace?.id === id
    && state.persistentSpace?.stateChannel === stateChannel
    && state.persistentSpace?.returnChannel === channel
    && state.persistentSpace?.persistence === 'server-backed'
    && state.lobbyChannel?.selected === channel
    && state.lobbyEditor?.channel === stateChannel
    && state.lobbyEditor?.environment?.kind === 'persistent-space'
    && state.multiplayer?.party?.lobbyChannel === stateChannel
    && state.multiplayer?.connected;
}

function originMatches(state) {
  return state.state === 'HUB'
    && hasNoLevel(state)
    && state.persistentSpace === null
    && state.lobbyChannel?.selected === channel
    && state.lobbyEditor?.channel === channel
    && state.lobbyEditor?.environment?.kind === 'lobby'
    && state.multiplayer?.party?.lobbyChannel === channel
    && state.multiplayer?.connected;
}

async function readState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function writeJson(fileName, value) {
  await writeFile(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function writeState(fileName, state) {
  stateFiles.push(fileName);
  await writeJson(fileName, state);
}

async function screenshotIsNearlyWhite(page, buffer) {
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(72, image.naturalWidth);
    canvas.height = Math.min(45, image.naturalHeight);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Unable to inspect the persistent-space screenshot');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nearWhite = 0;
    let brightNeutral = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset] >= 248
        && pixels[offset + 1] >= 248
        && pixels[offset + 2] >= 248
        && pixels[offset + 3] >= 250
      ) nearWhite += 1;
      const minimum = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      const maximum = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      if (minimum >= 238 && maximum - minimum <= 8 && pixels[offset + 3] >= 250) {
        brightNeutral += 1;
      }
    }
    const sampleCount = pixels.length / 4;
    return nearWhite / sampleCount >= 0.995 || brightNeutral / sampleCount >= 0.72;
  }, buffer.toString('base64'));
}

async function flushScreenshotSurface(page) {
  await page.bringToFront();
  await page.waitForFunction(() => {
    const fade = document.querySelector('#screen-fade');
    if (!(fade instanceof HTMLElement)) return document.visibilityState === 'visible';
    return document.visibilityState === 'visible'
      && !fade.classList.contains('active')
      && Number.parseFloat(getComputedStyle(fade).opacity) <= 0.01;
  });
  await page.evaluate(async () => {
    window.advanceTime(0);
    const fade = document.querySelector('#screen-fade');
    const canvas = document.querySelector('#game-canvas');
    void fade?.getBoundingClientRect();
    void canvas?.getBoundingClientRect();
    if (fade instanceof HTMLElement) void getComputedStyle(fade).opacity;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function screenshot(page, fileName, options = {}) {
  screenshots.push(fileName);
  await flushScreenshotSurface(page);
  let capture = await page.screenshot({ fullPage: options.fullPage === true });
  if (await screenshotIsNearlyWhite(page, capture)) {
    await flushScreenshotSurface(page);
    await page.evaluate(() => window.advanceTime(0));
    await page.waitForTimeout(80);
    capture = await page.screenshot({ fullPage: options.fullPage === true });
    if (await screenshotIsNearlyWhite(page, capture)) {
      throw new Error(`Screenshot remained nearly all-white after compositor retry: ${fileName}`);
    }
  }
  await writeFile(path.join(outputDirectory, fileName), capture);
}

async function mobileScreenshot(page, fileName) {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.waitForTimeout(240);
    await screenshot(page, fileName);
  } finally {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(180);
  }
}

async function waitForState(page, predicate, description, timeout = 18_000) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < timeout) {
    latest = await readState(page);
    if (predicate(latest)) return latest;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(latest)}`);
}

async function stepPages(pages, milliseconds = 120) {
  const uniquePages = [...new Set(pages.filter(Boolean))];
  let remaining = milliseconds;
  while (remaining > 0) {
    const slice = Math.min(120, remaining);
    await Promise.all(uniquePages.map((page) => page.evaluate((ms) => window.advanceTime(ms), slice)));
    await Promise.all(uniquePages.map((page) => page.waitForTimeout(slice + 20)));
    remaining -= slice;
  }
}

async function advanceUntil(pages, page, predicate, description, timeout = 18_000) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < timeout) {
    await stepPages(pages, 120);
    latest = await readState(page);
    if (predicate(latest)) return latest;
  }
  throw new Error(`Timed out advancing for ${description}: ${JSON.stringify(latest)}`);
}

function observe(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
}

async function createPlayer(browser, name) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  contexts.push(context);
  await context.addInitScript((save) => {
    localStorage.setItem('wr.save.v1', JSON.stringify(save));
  }, saveFor(name));
  const page = await context.newPage();
  observe(page, name);
  await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  return { context, page, name };
}

async function enterOrigin(player) {
  await player.page.locator('#lobby-channel-input').fill(channel);
  await player.page.locator('#start-btn').click();
  return waitForState(
    player.page,
    originMatches,
    `${player.name} enters isolated origin ${channel}`,
  );
}

async function apiState(page, stateChannel) {
  return page.evaluate(async (requestedChannel) => {
    const url = new URL('/api/lobby/state', location.origin);
    url.searchParams.set('channel', requestedChannel);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return { status: response.status, body: await response.json() };
  }, stateChannel);
}

async function patchObject(page, object, fields) {
  return page.evaluate(async ({ target, updates }) => {
    const url = new URL(`/api/lobby/objects/${encodeURIComponent(target.id)}`, location.origin);
    url.searchParams.set('channel', target.channel);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ clientId: target.clientId, ...updates }),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }, { target: object, updates: fields });
}

async function deleteObject(page, object) {
  return page.evaluate(async (target) => {
    const url = new URL(`/api/lobby/objects/${encodeURIComponent(target.id)}`, location.origin);
    url.searchParams.set('channel', target.channel);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ clientId: target.clientId }),
    });
    return response.status;
  }, object);
}

function trackCreatedObject(object) {
  createdObjects.push(object);
  return object;
}

async function cleanupCreated(page) {
  const results = [];
  for (const object of [...createdObjects].reverse()) {
    let status = null;
    try {
      status = await deleteObject(page, object);
    } catch (error) {
      results.push({ ...object, status, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    results.push({ ...object, status });
    if (status === 200 || status === 404) {
      const index = createdObjects.findIndex((candidate) => (
        candidate.id === object.id && candidate.channel === object.channel
      ));
      if (index >= 0) createdObjects.splice(index, 1);
    }
  }
  return results;
}

async function enterEditor(player, expectedChannel, expectedEnvironment) {
  const current = await readState(player.page);
  if (current.state === 'HUB_EDIT') {
    assert.equal(current.lobbyEditor.channel, expectedChannel);
    return current;
  }
  assert.equal(current.state, 'HUB', `${player.name} must be in HUB before opening decoration`);
  await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB_EDIT'
      && state.lobbyEditor.enabled
      && state.lobbyEditor.channel === expectedChannel
      && state.lobbyEditor.environment.kind === expectedEnvironment,
    `${player.name} opens decoration for ${expectedChannel}`,
  );
}

async function exitEditor(player) {
  const current = await readState(player.page);
  if (current.state !== 'HUB_EDIT') return current;
  await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB' && !state.lobbyEditor.enabled,
    `${player.name} exits decoration`,
  );
}

async function addCatalogObject(player, catalogId, stateChannel, kind) {
  const selector = `[data-add-catalog-id="${catalogId}"]`;
  await player.page.waitForFunction(
    (targetSelector) => {
      const button = document.querySelector(targetSelector);
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    selector,
  );

  const responsePromise = player.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/lobby/objects'
      && url.searchParams.get('channel') === stateChannel
      && response.request().method() === 'POST';
  });
  await player.page.locator(selector).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error('Catalog add button is unavailable');
    }
    button.click();
  });
  const response = await responsePromise;
  assert.equal(response.status(), 201, `${kind} create HTTP ${response.status()}`);
  const payload = await response.json();
  const requestBody = response.request().postDataJSON();
  const object = trackCreatedObject({
    id: payload.object?.id,
    channel: stateChannel,
    clientId: requestBody?.clientId ?? 'persistent-space-e2e-cleanup-001',
    kind,
  });
  assert.ok(object.id, `${kind} creation did not return a canonical object id`);
  await waitForState(
    player.page,
    (state) => objectFrom(state, object.id)?.catalogId === catalogId
      && state.lobbyEditor.selected === object.id
      && state.lobbyEditor.sync === 'synced',
    `${player.name} sees canonical ${kind}`,
  );
  return object;
}

async function moveTowardX(page, peers, targetX) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await readState(page);
    const delta = targetX - state.player.position.x;
    if (Math.abs(delta) <= 0.1) return state;
    const key = delta > 0 ? 'KeyD' : 'KeyA';
    await page.keyboard.down(key);
    await stepPages([page, ...peers], 55);
    await page.keyboard.up(key);
    await stepPages([page, ...peers], 45);
  }
  return readState(page);
}

async function moveTowardZ(page, peers, targetZ) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await readState(page);
    const delta = targetZ - state.player.position.z;
    if (Math.abs(delta) <= 0.1) return state;
    const key = delta > 0 ? 'KeyS' : 'KeyW';
    await page.keyboard.down(key);
    await stepPages([page, ...peers], 55);
    await page.keyboard.up(key);
    await stepPages([page, ...peers], 45);
  }
  return readState(page);
}

async function moveForwardUntil(player, peers, predicate, description, timeout = 18_000) {
  const pages = [player.page, ...peers];
  const startedAt = Date.now();
  let latest = await readState(player.page);
  await player.page.keyboard.down('KeyW');
  try {
    while (Date.now() - startedAt < timeout) {
      await stepPages(pages, 90);
      latest = await readState(player.page);
      if (predicate(latest)) return latest;
    }
  } finally {
    await player.page.keyboard.up('KeyW');
    await stepPages(pages, 80);
  }
  throw new Error(`Timed out moving ${player.name} toward ${description}: ${JSON.stringify(latest)}`);
}

async function exerciseCelestialDragon(player, peers) {
  const ready = await moveForwardUntil(
    player,
    peers,
    (state) => state.persistentSpace?.id === 'heaven'
      && state.nearbyInteraction?.includes('骑乘')
      && state.availableActions.includes('E 交互'),
    'the celestial dragon',
  );
  const dragonBefore = objectFrom(ready, dragonId);
  assert.equal(dragonBefore?.catalogId, dragonCatalogId);
  assert.equal(dragonBefore?.drivable, true);
  assert.equal(dragonBefore?.canEdit, false);
  assert.equal(dragonBefore?.canDelete, false);

  await player.page.keyboard.press('KeyE');
  await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.vehicle.active
      && state.vehicle.objectId === dragonId
      && state.vehicle.catalogId === dragonCatalogId
      && state.vehicle.persistence === 'server-backed-parked-pose'
      && state.persistentSpace?.landmark.dragonOccupied,
    `${player.name} mounts the celestial dragon`,
  );

  await player.page.keyboard.down('Space');
  await player.page.keyboard.down('KeyW');
  await stepPages([player.page, ...peers], 1_650);
  await player.page.keyboard.up('KeyW');
  await player.page.keyboard.up('Space');
  await stepPages([player.page, ...peers], 220);
  const airborne = await readState(player.page);
  assert.equal(airborne.vehicle.active, true);
  assert.equal(airborne.vehicle.flightModel, 'rotorcraft');
  assert.ok((airborne.vehicle.altitude ?? 0) > 0.45, JSON.stringify(airborne.vehicle));
  assert.ok(
    Math.hypot(
      (airborne.vehicle.position?.x ?? dragonBefore.x) - dragonBefore.x,
      (airborne.vehicle.position?.z ?? dragonBefore.z) - dragonBefore.z,
    ) > 0.35,
    JSON.stringify({ dragonBefore, vehicle: airborne.vehicle }),
  );
  await player.page.keyboard.press('KeyV');
  const ridingView = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.vehicle.active && state.multiplayer.view === 'third',
    `${player.name} switches to the third-person dragon flight camera`,
  );
  await screenshot(player.page, 'heaven-dragon-riding.png');
  await mobileScreenshot(player.page, 'heaven-dragon-riding-mobile.png');
  await writeState('heaven-dragon-riding-state.json', ridingView);
  await player.page.keyboard.press('KeyV');
  await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.vehicle.active && state.multiplayer.view === 'first',
    `${player.name} restores the first-person flight camera`,
  );

  await player.page.keyboard.press('KeyE');
  const released = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => !state.vehicle.active
      && !state.persistentSpace?.landmark.dragonOccupied
      && objectFrom(state, dragonId)?.occupiedBy === null,
    `${player.name} safely lands and leaves the celestial dragon`,
    42_000,
  );
  const dragonAfter = objectFrom(released, dragonId);
  assert.equal(dragonAfter?.catalogId, dragonCatalogId);
  await writeState('heaven-dragon-parked-state.json', released);
  return { before: dragonBefore, clientAfter: dragonAfter, airborne, persisted: null };
}

async function exerciseInfernalPiano(player, peers) {
  await moveTowardX(player.page, peers, 1.65);
  await moveTowardZ(player.page, peers, 2.9);
  const ready = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.persistentSpace?.id === 'hell'
      && state.nearbyInteraction?.includes('原创钢琴曲')
      && state.availableActions.includes('E 交互'),
    `${player.name} stands beside the infernal concert grand`,
  );
  const piano = objectFrom(ready, pianoId);
  assert.equal(piano?.catalogId, pianoCatalogId);
  assert.equal(piano?.interactive, true);
  assert.equal(piano?.canEdit, false);
  assert.equal(piano?.canDelete, false);
  const interactionPromise = player.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${pianoId}/interactions`
      && url.searchParams.get('channel') === hellChannel
      && response.request().method() === 'POST';
  });
  await player.page.keyboard.press('KeyE');
  assert.equal((await interactionPromise).status(), 200);
  const playing = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.persistentSpace?.landmark.pianoPlaying
      && state.persistentSpace.landmark.activePianoKeys > 0
      && (objectFrom(state, pianoId)?.interactionSequence ?? 0) > 0,
    `${player.name} hears the synchronized infernal piano`,
  );
  await screenshot(player.page, 'hell-piano-playing.png');
  await moveTowardX(player.page, peers, 0);
  await moveTowardZ(player.page, peers, 3.5);
  const centeredPlaying = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.persistentSpace?.landmark.pianoPlaying
      && state.persistentSpace.landmark.activePianoKeys > 0,
    `${player.name} keeps the playing piano centered for the mobile view`,
  );
  await mobileScreenshot(player.page, 'hell-piano-playing-mobile.png');
  await writeState('hell-piano-playing-state.json', centeredPlaying);
  return centeredPlaying;
}

async function aimAtDoor(player, peers, destinationLabel) {
  const expectedX = destinationLabel === '天堂' ? -0.38 : 0.38;
  await moveTowardX(player.page, peers, expectedX);
  const matches = (state) => originMatches(state)
    && objectFrom(state, doorId)?.portal
    && state.nearbyInteraction?.includes(`当前瞄准：${destinationLabel}`);
  let current = await readState(player.page);
  if (matches(current)) return current;
  await player.page.keyboard.down('KeyW');
  try {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      await stepPages([player.page, ...peers], 85);
      current = await readState(player.page);
      if (matches(current)) return current;
    }
  } finally {
    await player.page.keyboard.up('KeyW');
    await stepPages([player.page, ...peers], 50);
  }
  throw new Error(
    `Timed out aiming ${player.name} at ${destinationLabel}: ${JSON.stringify(current)}`,
  );
}

async function enterPersistentSpace(player, peers, spaceId, destinationLabel, stateChannel) {
  await stepPages([player.page, ...peers], 650);
  const ready = await aimAtDoor(player, peers, destinationLabel);
  assert.equal(ready.availableActions.includes('E 交互'), true);
  const interactionPromise = player.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${doorId}/interactions`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'POST';
  });
  await player.page.keyboard.press('KeyE');
  const interactionResponse = await interactionPromise;
  assert.equal(interactionResponse.status(), 200);
  const pages = [player.page, ...peers];
  await advanceUntil(
    pages,
    player.page,
    (candidate) => persistentSpaceMatches(candidate, spaceId, stateChannel),
    `${player.name} enters persistent ${spaceId}`,
  );
  await stepPages(pages, 240);
  const state = await readState(player.page);
  assert.equal(
    persistentSpaceMatches(state, spaceId, stateChannel),
    true,
    `${player.name} must remain in persistent ${spaceId} after the transition fade clears`,
  );
  assert.equal(state.lobbyEditor.home.enabled, false);
  assert.equal(state.lobbyEditor.objects.some((object) => object.system), false);
  assert.equal(objectFrom(state, doorId), undefined, 'origin door must not leak into persistent space state');
  return state;
}

async function returnToOrigin(player, peers) {
  await exitEditor(player);
  const current = await readState(player.page);
  const returnPortal = current.persistentSpace?.returnPortalPosition;
  assert.ok(returnPortal, `${player.name} must have a persistent-space return portal`);
  // Persistent-space scenes reset camera yaw to 0. Walk along the connected
  // reef/cloud deck before moving sideways; crossing X first can step off the
  // narrow Hell approach. Finish on +Z so the portal stays in the forward cone.
  await moveTowardZ(player.page, peers, returnPortal.z + 1.8);
  await moveTowardX(player.page, peers, returnPortal.x);
  const ready = await advanceUntil(
    [player.page, ...peers],
    player.page,
    (state) => state.state === 'HUB'
      && state.persistentSpace
      && state.nearbyInteraction === '返回原大厅'
      && state.availableActions.includes('E 交互'),
    `${player.name} faces the persistent-space return portal`,
  );
  assert.ok(ready.persistentSpace.returnPortalPosition);
  await player.page.keyboard.press('KeyE');
  await advanceUntil(
    [player.page, ...peers],
    player.page,
    originMatches,
    `${player.name} returns to origin ${channel}`,
  );
  await stepPages([player.page, ...peers], 240);
  return waitForState(
    player.page,
    (state) => originMatches(state)
      && (!doorId || objectFrom(state, doorId)?.portal)
      && state.lobbyEditor.sync === 'synced',
    `${player.name} reloads persisted origin objects`,
  );
}

async function reloadToOrigin(player) {
  await exitEditor(player);
  await player.page.reload({ waitUntil: 'domcontentloaded' });
  await player.page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  return enterOrigin(player);
}

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

let report = null;
try {
  [alice, bob] = await Promise.all([
    createPlayer(browser, 'Persistent Alice'),
    createPlayer(browser, 'Persistent Bob'),
  ]);
  await Promise.all([enterOrigin(alice), enterOrigin(bob)]);
  await Promise.all([
    waitForState(alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob in origin'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice in origin'),
  ]);

  const [originBaseline, heavenBaseline, hellBaseline] = await Promise.all([
    apiState(alice.page, channel),
    apiState(alice.page, heavenChannel),
    apiState(alice.page, hellChannel),
  ]);
  for (const baseline of [originBaseline, heavenBaseline, hellBaseline]) {
    assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
    stableObjects(baseline.body);
  }
  baselines = {
    origin: originBaseline.body,
    heaven: heavenBaseline.body,
    hell: hellBaseline.body,
  };

  await enterEditor(alice, channel, 'lobby');
  const door = await addCatalogObject(alice, doorCatalogId, channel, 'portal-door');
  doorId = door.id;
  const positionedDoor = await patchObject(alice.page, door, {
    position: { x: 0, y: 0, z: 0.4 },
    rotationY: 0,
    scale: 1,
  });
  assert.equal(positionedDoor.status, 200, JSON.stringify(positionedDoor.body));
  await Promise.all([
    waitForState(alice.page, (state) => {
      const object = objectFrom(state, doorId);
      return object?.portal && object.x === 0 && object.y === 0 && object.z === 0.4;
    }, 'Alice sees positioned portal'),
    waitForState(bob.page, (state) => {
      const object = objectFrom(state, doorId);
      return object?.portal
        && object.portalDestination === '天堂'
        && object.x === 0
        && object.y === 0
        && object.z === 0.4;
    }, 'Bob receives positioned portal'),
  ]);
  await screenshot(alice.page, 'origin-door-editor.png', { fullPage: true });
  await exitEditor(alice);
  const originReady = await aimAtDoor(alice, [bob.page], '天堂');
  await screenshot(alice.page, 'origin-door-heaven-aim.png');
  await writeState('origin-door-state.json', originReady);

  await enterPersistentSpace(
    alice,
    [bob.page],
    'heaven',
    '天堂',
    heavenChannel,
  );
  const aliceHeaven = await waitForState(
    alice.page,
    (state) => persistentSpaceMatches(state, 'heaven', heavenChannel)
      && state.multiplayer.online === 1
      && state.lobbyEditor.online === 1
      && state.lobbyEditor.sync === 'synced',
    'Alice settles into server-backed Heaven',
  );
  await writeState('heaven-alice-entry-state.json', aliceHeaven);
  await screenshot(alice.page, 'heaven-alice-entry.png');

  assert.equal(aliceHeaven.persistentSpace.landmark.kind, 'celestial-riding-dragon');
  assert.equal(aliceHeaven.persistentSpace.landmark.statePersistence, 'server-backed');
  const dragonFlight = await exerciseCelestialDragon(alice, [bob.page]);
  const dragonPersistedApi = await apiState(alice.page, heavenChannel);
  assert.equal(dragonPersistedApi.status, 200);
  const persistedDragon = stableObjects(dragonPersistedApi.body).find((object) => object.id === dragonId);
  assert.equal(persistedDragon?.catalogId, dragonCatalogId);
  assert.ok(
    Math.hypot(
      persistedDragon.position.x - dragonFlight.before.x,
      persistedDragon.position.z - dragonFlight.before.z,
    ) > 0.25,
    JSON.stringify({ before: dragonFlight.before, persistedDragon }),
  );
  dragonFlight.persisted = persistedDragon;

  await enterEditor(alice, heavenChannel, 'persistent-space');
  const heavenGlow = await addCatalogObject(alice, glowCatalogId, heavenChannel, 'heaven-glow-cube');
  heavenGlowId = heavenGlow.id;
  const aliceHeavenEditor = await readState(alice.page);
  assert.equal(objectFrom(aliceHeavenEditor, heavenGlowId)?.scope, 'public');
  assert.equal(objectFrom(aliceHeavenEditor, heavenGlowId)?.canDelete, true);
  await screenshot(alice.page, 'heaven-glow-created.png', { fullPage: true });
  await writeState('heaven-glow-created-state.json', aliceHeavenEditor);

  await enterPersistentSpace(
    bob,
    [alice.page],
    'heaven',
    '天堂',
    heavenChannel,
  );
  const bobSeesHeavenGlow = await waitForState(
    bob.page,
    (state) => persistentSpaceMatches(state, 'heaven', heavenChannel)
      && objectFrom(state, heavenGlowId)?.catalogId === glowCatalogId
      && state.multiplayer.online === 2
      && state.lobbyEditor.online === 2,
    'Bob joins Heaven and sees Alice glow cube',
  );
  await waitForState(
    alice.page,
    (state) => state.multiplayer.online === 2 && state.lobbyEditor.online === 2,
    'Alice sees Bob join Heaven',
  );

  const beforeRotation = objectFrom(await readState(alice.page), heavenGlowId).rotationY;
  const rotateResponsePromise = alice.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${heavenGlowId}`
      && url.searchParams.get('channel') === heavenChannel
      && response.request().method() === 'PATCH';
  });
  await alice.page.locator('#lobby-rotate-right').click();
  assert.equal((await rotateResponsePromise).status(), 200);
  const bobLiveUpdate = await waitForState(
    bob.page,
    (state) => Math.abs((objectFrom(state, heavenGlowId)?.rotationY ?? beforeRotation) - beforeRotation) > 0.1,
    'Bob receives Heaven glow-cube transform in real time',
  );
  await screenshot(bob.page, 'heaven-bob-live-sync.png');
  await writeState('heaven-bob-live-sync-state.json', bobLiveUpdate);
  await writeState('heaven-bob-entry-state.json', bobSeesHeavenGlow);

  // The dragon can park far from the return portal. A clean page reload returns
  // to the origin channel and proves that the next entry hydrates durable state.
  const aliceOriginAfterHeaven = await reloadToOrigin(alice);
  assert.equal(objectFrom(aliceOriginAfterHeaven, doorId)?.portal, true);
  await enterPersistentSpace(
    alice,
    [bob.page],
    'heaven',
    '天堂',
    heavenChannel,
  );
  const aliceHeavenReentry = await waitForState(
    alice.page,
    (state) => persistentSpaceMatches(state, 'heaven', heavenChannel)
      && objectFrom(state, heavenGlowId)?.catalogId === glowCatalogId
      && state.lobbyEditor.sync === 'synced',
    'Alice reloads persisted Heaven glow cube after re-entry',
  );
  assert.equal(objectFrom(aliceHeavenReentry, heavenGlowId)?.catalogId, glowCatalogId);
  const reloadedDragon = objectFrom(aliceHeavenReentry, dragonId);
  assert.ok(Math.abs(reloadedDragon.x - dragonFlight.persisted.position.x) < 0.05);
  assert.ok(Math.abs(reloadedDragon.z - dragonFlight.persisted.position.z) < 0.05);
  assert.ok(
    Math.abs(objectFrom(aliceHeavenReentry, heavenGlowId).rotationY - objectFrom(bobLiveUpdate, heavenGlowId).rotationY) < 0.02,
    'Heaven transform must survive leaving and re-entering',
  );
  await screenshot(alice.page, 'heaven-alice-reentry-persisted.png');
  await writeState('heaven-alice-reentry-state.json', aliceHeavenReentry);

  await returnToOrigin(alice, [bob.page]);
  await enterPersistentSpace(
    alice,
    [bob.page],
    'hell',
    '地狱',
    hellChannel,
  );
  const aliceHell = await waitForState(
    alice.page,
    (state) => persistentSpaceMatches(state, 'hell', hellChannel)
      && state.multiplayer.online === 1
      && state.lobbyEditor.online === 1
      && state.lobbyEditor.sync === 'synced'
      && !objectFrom(state, heavenGlowId),
    'Alice settles into independent Hell state',
  );
  assert.equal(objectFrom(aliceHell, heavenGlowId), undefined, 'Heaven object must not leak into Hell');
  assert.equal(aliceHell.multiplayer.online, 1, 'Bob remains isolated in Heaven');
  const bobStillHeaven = await waitForState(
    bob.page,
    (state) => persistentSpaceMatches(state, 'heaven', heavenChannel)
      && objectFrom(state, heavenGlowId)?.catalogId === glowCatalogId
      && state.multiplayer.online === 1,
    'Bob remains in independent Heaven while Alice enters Hell',
  );
  await screenshot(alice.page, 'hell-isolated-from-heaven.png');
  await writeState('hell-isolated-state.json', aliceHell);
  await writeState('heaven-bob-isolated-state.json', bobStillHeaven);

  assert.equal(aliceHell.persistentSpace.landmark.kind, 'infernal-concert-grand');
  assert.equal(aliceHell.persistentSpace.landmark.statePersistence, 'server-backed');
  const pianoPlaying = await exerciseInfernalPiano(alice, [bob.page]);
  const pianoPersistedApi = await apiState(alice.page, hellChannel);
  assert.equal(pianoPersistedApi.status, 200);
  const persistedPiano = stableObjects(pianoPersistedApi.body).find((object) => object.id === pianoId);
  assert.equal(persistedPiano?.catalogId, pianoCatalogId);
  assert.equal(persistedPiano?.interaction.sequence, objectFrom(pianoPlaying, pianoId).interactionSequence);

  // Decoration places in front of the creative camera. Return to the center
  // approach so the first candidate ray lands on the broad reef surface rather
  // than grazing the piano-side rock edge.
  await moveTowardX(alice.page, [bob.page], 0);
  await moveTowardZ(alice.page, [bob.page], 5.2);
  await enterEditor(alice, hellChannel, 'persistent-space');
  const hellGlow = await addCatalogObject(alice, glowCatalogId, hellChannel, 'hell-glow-cube');
  hellGlowId = hellGlow.id;
  assert.notEqual(hellGlowId, heavenGlowId);
  await bob.page.waitForTimeout(350);
  assert.equal(objectFrom(await readState(bob.page), hellGlowId), undefined, 'Hell object must not leak into Heaven');
  await screenshot(alice.page, 'hell-glow-created.png', { fullPage: true });
  await writeState('hell-glow-created-state.json', await readState(alice.page));

  await returnToOrigin(alice, [bob.page]);
  await enterPersistentSpace(
    alice,
    [bob.page],
    'hell',
    '地狱',
    hellChannel,
  );
  const aliceHellReentry = await waitForState(
    alice.page,
    (state) => persistentSpaceMatches(state, 'hell', hellChannel)
      && objectFrom(state, hellGlowId)?.catalogId === glowCatalogId
      && !objectFrom(state, heavenGlowId)
      && state.lobbyEditor.sync === 'synced',
    'Alice reloads persisted Hell glow cube after re-entry',
  );
  assert.equal(objectFrom(aliceHellReentry, hellGlowId)?.catalogId, glowCatalogId);
  assert.equal(objectFrom(aliceHellReentry, heavenGlowId), undefined);
  await screenshot(alice.page, 'hell-alice-reentry-persisted.png');
  await writeState('hell-alice-reentry-state.json', aliceHellReentry);

  const [heavenPersistedApi, hellPersistedApi] = await Promise.all([
    apiState(alice.page, heavenChannel),
    apiState(alice.page, hellChannel),
  ]);
  assert.equal(heavenPersistedApi.status, 200);
  assert.equal(hellPersistedApi.status, 200);
  assert.ok(stableObjects(heavenPersistedApi.body).some((object) => object.id === heavenGlowId));
  assert.ok(stableObjects(hellPersistedApi.body).some((object) => object.id === hellGlowId));
  assert.equal(stableObjects(heavenPersistedApi.body).some((object) => object.id === hellGlowId), false);
  assert.equal(stableObjects(hellPersistedApi.body).some((object) => object.id === heavenGlowId), false);
  await writeJson('persistent-space-api-state.json', {
    heaven: heavenPersistedApi.body,
    hell: hellPersistedApi.body,
  });
  stateFiles.push('persistent-space-api-state.json');

  await returnToOrigin(alice, [bob.page]);
  await returnToOrigin(bob, [alice.page]);
  await Promise.all([
    waitForState(alice.page, (state) => originMatches(state) && state.multiplayer.online === 2, 'Alice reunites in origin'),
    waitForState(bob.page, (state) => originMatches(state) && state.multiplayer.online === 2, 'Bob reunites in origin'),
  ]);

  assert.equal(errors.length, 0, errors.join('\n'));
  const cleanup = await cleanupCreated(alice.page);
  assert.ok(cleanup.length >= 3, `Expected door and space objects to be cleaned: ${JSON.stringify(cleanup)}`);
  for (const result of cleanup) assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(createdObjects.length, 0);

  await Promise.all([
    waitForState(alice.page, (state) => !objectFrom(state, doorId), 'Alice sees origin door cleanup'),
    waitForState(bob.page, (state) => !objectFrom(state, doorId), 'Bob sees origin door cleanup'),
  ]);
  const [originFinal, heavenFinal, hellFinal] = await Promise.all([
    apiState(alice.page, channel),
    apiState(alice.page, heavenChannel),
    apiState(alice.page, hellChannel),
  ]);
  assert.deepEqual(stableObjects(originFinal.body), stableObjects(baselines.origin));
  const heavenFinalObjects = stableObjects(heavenFinal.body);
  const hellFinalObjects = stableObjects(hellFinal.body);
  assert.deepEqual(
    heavenFinalObjects.map((object) => object.id),
    stableObjects(baselines.heaven).map((object) => object.id),
    'Heaven cleanup must leave only the seeded persistent landmark set',
  );
  assert.deepEqual(
    hellFinalObjects.map((object) => object.id),
    stableObjects(baselines.hell).map((object) => object.id),
    'Hell cleanup must leave only the seeded persistent landmark set',
  );
  const finalDragon = heavenFinalObjects.find((object) => object.id === dragonId);
  const finalPiano = hellFinalObjects.find((object) => object.id === pianoId);
  assert.ok(Math.abs(finalDragon.position.x - dragonFlight.persisted.position.x) < 0.05);
  assert.ok(Math.abs(finalDragon.position.z - dragonFlight.persisted.position.z) < 0.05);
  assert.equal(finalPiano.interaction.sequence, persistedPiano.interaction.sequence);
  await writeJson('cleanup-api-state.json', {
    origin: originFinal.body,
    heaven: heavenFinal.body,
    hell: hellFinal.body,
  });
  stateFiles.push('cleanup-api-state.json');

  report = {
    ok: true,
    baseUrl: baseUrl.href,
    channels: {
      origin: channel,
      heaven: heavenChannel,
      hell: hellChannel,
    },
    objects: {
      door: { id: doorId, catalogId: doorCatalogId },
      heavenGlow: { id: heavenGlowId, catalogId: glowCatalogId },
      hellGlow: { id: hellGlowId, catalogId: glowCatalogId },
    },
    assertions: {
      persistentSpacesRemainHubState: true,
      currentLevelAbsent: true,
      serverBackedStateChannels: true,
      bobAimedAtAndEnteredHeaven: true,
      bobSawHeavenObjectAndLiveTransform: true,
      heavenSurvivedAliceReentry: true,
      heavenAndHellAreIndependent: true,
      hellSurvivedAliceReentry: true,
      celestialDragonMountedFlownAndParkedPersistently: true,
      infernalPianoInteractionAndPlaybackPersisted: true,
      originBaselineAndManagedSpaceLandmarksRestored: true,
    },
    baselines: {
      originObjects: baselines.origin.objects.length,
      heavenObjects: baselines.heaven.objects.length,
      hellObjects: baselines.hell.objects.length,
    },
    cleanup,
    screenshots,
    states: stateFiles,
    errors,
  };
  await writeJson('report.json', report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const cleanup = alice?.page ? await cleanupCreated(alice.page).catch(() => []) : [];
  report = {
    ok: false,
    baseUrl: baseUrl.href,
    channels: { origin: channel, heaven: heavenChannel, hell: hellChannel },
    objects: { doorId, heavenGlowId, hellGlowId },
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    cleanup,
    pendingCleanup: createdObjects,
    screenshots,
    states: stateFiles,
    errors,
  };
  await writeJson('report.json', report).catch(() => undefined);
  throw error;
} finally {
  if (alice?.page && createdObjects.length > 0) {
    await cleanupCreated(alice.page).catch(() => undefined);
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  await browser.close();
}
