import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightEntry = process.env.PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightEntry).href);

const requestedBaseUrl = process.env.WHITEROOM_E2E_URL ?? 'http://127.0.0.1:5188/';
const parsedBaseUrl = new URL(requestedBaseUrl);
const baseUrl = parsedBaseUrl.href.endsWith('/') ? parsedBaseUrl.href : `${parsedBaseUrl.href}/`;
const localGameHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsedBaseUrl.hostname);
const manualClock = process.env.WHITEROOM_E2E_MANUAL_CLOCK
  ? process.env.WHITEROOM_E2E_MANUAL_CLOCK === '1'
  : localGameHost;
const timeoutScale = Number(
  process.env.WHITEROOM_E2E_TIMEOUT_SCALE ?? (manualClock ? 1 : 3),
);
const renderStallMs = Number(process.env.WHITEROOM_E2E_RENDER_STALL_MS ?? 0);
const sharedBrowser = process.env.WHITEROOM_E2E_SHARED_BROWSER === '1';
const platformBaseUrl = (
  process.env.WHITEROOM_PLATFORM_URL
  ?? (localGameHost ? 'http://127.0.0.1:8787' : parsedBaseUrl.origin)
).replace(/\/$/, '');
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT ?? 'test-results/lobby-vehicle',
);
const channel = process.env.WHITEROOM_E2E_CHANNEL
  ?? `94${String(Date.now()).slice(-8)}`;
const viewport = { width: 1440, height: 900 };
const catalogId = 'code-precision-rescue-helicopter';
const fixtureClientId = `vehicle-e2e-${channel}`;
const requiredVehicleFeatures = ['vehicle-lease-v1', 'vehicle-autoland-v1'];

assert.match(channel, /^\d{4,12}$/, 'WHITEROOM_E2E_CHANNEL must be 4-12 digits');
assert.ok(
  Number.isFinite(timeoutScale) && timeoutScale > 0,
  'WHITEROOM_E2E_TIMEOUT_SCALE must be a positive finite number',
);
assert.ok(
  Number.isFinite(renderStallMs) && renderStallMs >= 0,
  'WHITEROOM_E2E_RENDER_STALL_MS must be a non-negative finite number',
);
await mkdir(outputDirectory, { recursive: true });

function scaledTimeout(milliseconds) {
  return Math.max(1, Math.round(milliseconds * timeoutScale));
}

function saveFor(name) {
  return {
    settings: {
      sensitivity: 1,
      fov: 75,
      headBob: false,
      volume: 0,
      reducedMotion: true,
      nickname: name,
      avatarId: '',
      lobbyView: 'third',
      lang: 'zh-CN',
    },
    history: [],
    stats: { totalCompleted: 0, totalDives: 0 },
    recent: [],
  };
}

async function readState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function waitForState(page, predicate, description, timeout = 12_000) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < scaledTimeout(timeout)) {
    latest = await readState(page);
    if (predicate(latest)) return latest;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(latest)}`);
}

async function stepPages(pages, milliseconds = 100) {
  if (!manualClock) {
    await Promise.all(pages.map((page) => page.waitForTimeout(milliseconds)));
    return;
  }
  let remaining = milliseconds;
  while (remaining > 0) {
    const slice = Math.min(100, remaining);
    await Promise.all(pages.map((page) => page.evaluate((ms) => window.advanceTime(ms), slice)));
    await Promise.all(pages.map((page) => page.waitForTimeout(slice + 25)));
    remaining -= slice;
  }
}

async function screenshotWithDriverHeartbeat(observerPage, driverPage, outputPath) {
  if (!manualClock) {
    await observerPage.screenshot({ path: outputPath });
    return;
  }
  let completed = false;
  let screenshotError;
  const screenshot = observerPage.screenshot({ path: outputPath })
    .catch((error) => { screenshotError = error; })
    .finally(() => { completed = true; });
  while (!completed) {
    await driverPage.evaluate(() => window.advanceTime(100));
    // Keep the manual simulation at or below real time. Faster pacing can
    // exceed the production 15 vehicle-state/s and 30 total-message/s caps.
    await driverPage.waitForTimeout(125);
  }
  await screenshot;
  if (screenshotError) throw screenshotError;
}

async function advanceUntil(pages, page, predicate, description, timeout = 12_000) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < scaledTimeout(timeout)) {
    await stepPages(pages, 100);
    latest = await readState(page);
    if (predicate(latest)) return latest;
  }
  throw new Error(`Timed out advancing for ${description}: ${JSON.stringify(latest)}`);
}

async function platformRequest(pathname, method = 'GET', body = null, cookie = '') {
  const headers = { Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${platformBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function createVehicleFixture() {
  const identity = await platformRequest('/api/lobby/identity');
  assert.equal(identity.response.status, 200, JSON.stringify(identity.payload));
  const cookie = identity.response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie, 'platform identity did not set an owner cookie');

  const created = await platformRequest(
    `/api/lobby/objects?channel=${encodeURIComponent(channel)}`,
    'POST',
    {
      clientId: fixtureClientId,
      catalogId,
      // Stay outside the protected 2.25 m spawn circle, remain inside the
      // reviewed 4.2 m enter radius, and sit in front of the initial -Z view.
      position: { x: 0, y: 0, z: 1.5 },
      // Face away from spawn so forward-flight screenshots keep the aircraft
      // in front of the observing player's initial camera.
      rotationY: Math.PI,
      scale: 1,
    },
    cookie,
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload?.object?.catalogId, catalogId);
  return { cookie, object: created.payload.object };
}

async function cleanupVehicleFixture(fixture) {
  if (!fixture?.object?.id) return;
  await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(fixture.object.id)}?channel=${encodeURIComponent(channel)}`,
    'DELETE',
    { clientId: fixtureClientId },
    fixture.cookie,
  ).catch(() => undefined);
}

function observe(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
}

async function saturatedUiReport(page) {
  return page.evaluate(() => {
    const exempt = [
      '#game-canvas',
      '.avatar-preset-preview',
      '.lobby-catalog-preview',
      '.lobby-home-cell',
      '.lobby-home-public-cell',
      '.multiplayer-live',
      '.creative-live',
      '#lobby-sync',
      '[role="status"]',
    ].join(',');
    const parseColors = (value) => {
      const colors = [];
      const pattern = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/gi;
      let match;
      while ((match = pattern.exec(value)) !== null) {
        colors.push({
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4]),
        });
      }
      return colors;
    };
    const failures = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (!(element instanceof HTMLElement) || element.matches(exempt) || element.closest(exempt)) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') === 0) continue;
      for (const [property, value] of [
        ['backgroundColor', style.backgroundColor],
        ['backgroundImage', style.backgroundImage],
        ['borderColor', style.borderTopColor],
      ]) {
        for (const color of parseColors(value)) {
          if (color.a < 0.3) continue;
          const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
          if (spread > 42) failures.push({
            element: element.id ? `#${element.id}` : element.className || element.tagName,
            property,
            value,
            spread,
          });
        }
      }
    }
    return failures.slice(0, 16);
  });
}

function recordVehicleFrame(frames, direction, payload) {
  if (typeof payload !== 'string') return;
  try {
    const message = JSON.parse(payload);
    if (
      message.type?.startsWith('vehicle_')
      || (message.type === 'error' && message.code?.startsWith('vehicle_'))
      || message.type === 'pose'
      || message.type === 'welcome'
      || message.type === 'channel_snapshot'
    ) {
      const vehicle = message.vehicle && typeof message.vehicle === 'object'
        ? message.vehicle
        : message.type === 'vehicle_state'
          ? message
          : null;
      const vehicles = Array.isArray(message.vehicles)
        ? message.vehicles.map((snapshot) => ({
          objectId: snapshot?.objectId ?? null,
          driverId: snapshot?.driverId ?? null,
          x: snapshot?.x ?? null,
          y: snapshot?.y ?? null,
          z: snapshot?.z ?? null,
          yaw: snapshot?.yaw ?? null,
          seq: snapshot?.seq ?? null,
          recovering: snapshot?.recovering === true,
        }))
        : null;
      frames.push({
        direction,
        type: message.type,
        code: message.code ?? null,
        reason: message.reason ?? null,
        channel: message.channel ?? null,
        features: Array.isArray(message.features) ? message.features : null,
        wallTime: Date.now(),
        driverId: message.driverId ?? vehicle?.driverId ?? null,
        pose: message.type === 'pose' ? {
          id: message.id ?? null,
          x: message.x ?? null,
          y: message.y ?? null,
          z: message.z ?? null,
          yaw: message.yaw ?? null,
          moving: message.moving === true,
        } : null,
        vehicle: vehicle ? {
          objectId: vehicle.objectId ?? null,
          driverId: vehicle.driverId ?? null,
          x: vehicle.x ?? null,
          y: vehicle.y ?? null,
          z: vehicle.z ?? null,
          yaw: vehicle.yaw ?? null,
          pitch: vehicle.pitch ?? null,
          roll: vehicle.roll ?? null,
          vx: vehicle.vx ?? null,
          vy: vehicle.vy ?? null,
          vz: vehicle.vz ?? null,
          seq: vehicle.seq ?? null,
          recovering: vehicle.recovering === true,
        } : null,
        vehicles,
      });
    }
  } catch {
    // Ignore unrelated protocol noise; the multiplayer parser validates schemas.
  }
}

async function createPlayer(browser, name, errors) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((save) => {
    localStorage.setItem('wr.save.v1', JSON.stringify(save));
  }, saveFor(name));
  const page = await context.newPage();
  page.setDefaultTimeout(scaledTimeout(30_000));
  page.setDefaultNavigationTimeout(60_000);
  const vehicleFrames = [];
  observe(page, name, errors);
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/api/lobby/multiplayer') return;
    socket.on('framesent', ({ payload }) => recordVehicleFrame(vehicleFrames, 'sent', payload));
    socket.on('framereceived', ({ payload }) => recordVehicleFrame(vehicleFrames, 'received', payload));
    socket.on('close', () => vehicleFrames.push({ direction: 'socket', type: 'closed', code: null }));
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  return { name, context, page, vehicleFrames };
}

async function enterChannel(player) {
  await player.page.locator('#lobby-channel-input').fill(channel);
  await player.page.locator('#lobby-channel-input').press('Enter');
  try {
    return await waitForState(
      player.page,
      (state) => state.state === 'HUB'
        && state.lobbyChannel.selected === channel
        && state.multiplayer.connected
        && state.multiplayer.resources.vehicleLeaseSupported
        && state.multiplayer.resources.vehicleAutolandSupported,
      `${player.name} enters vehicle-lease-v1 + vehicle-autoland-v1 channel`,
    );
  } catch (error) {
    error.message += `\n${player.name} WebSocket frames: ${JSON.stringify(player.vehicleFrames)}`;
    throw error;
  }
}

function vehicleObject(state) {
  return state.lobbyEditor.objects.find((object) => object.catalogId === catalogId);
}

function syncedVehicle(state, objectId) {
  return state.multiplayer.vehicles.find((vehicle) => vehicle.objectId === objectId);
}

function signedAngleDeltaDegrees(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function uniqueFrameTypes(player, direction) {
  return [...new Set(
    player.vehicleFrames
      .filter((frame) => frame.direction === direction)
      .map((frame) => frame.code ? `${frame.type}:${frame.code}` : frame.type),
  )];
}

function negotiatedVehicleFeatureFrame(player) {
  return player.vehicleFrames.find((frame) => (
    frame.direction === 'received'
    && ['welcome', 'channel_snapshot'].includes(frame.type)
    && [channel, `lobby:${channel}`].includes(frame.channel)
    && requiredVehicleFeatures.every((feature) => frame.features?.includes(feature))
  ));
}

function vehicleWelcomeFeatureFrame(player) {
  return player.vehicleFrames.find((frame) => (
    frame.direction === 'received'
    && frame.type === 'welcome'
    && requiredVehicleFeatures.every((feature) => frame.features?.includes(feature))
  ));
}

function outsideLegacyFlightBoundary(pose, margin = 54) {
  return Boolean(pose) && Math.max(Math.abs(pose.x), Math.abs(pose.z)) > margin;
}

async function enterEditor(player) {
  const current = await readState(player.page);
  if (current.state !== 'HUB_EDIT') await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB_EDIT'
      && state.lobbyEditor.enabled
      && state.lobbyEditor.channel === channel,
    `${player.name} opens lobby decoration`,
  );
}

async function waitForEditorButtonEnabled(player, selector, description) {
  await player.page.waitForFunction((buttonSelector) => {
    const button = document.querySelector(buttonSelector);
    return button instanceof HTMLButtonElement && !button.disabled;
  }, selector, { timeout: scaledTimeout(12_000) });
  const state = await readState(player.page);
  assert.equal(state.lobbyEditor.selected === null, false, description);
  return state;
}

async function selectExistingObject(player, objectId) {
  const canvas = player.page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds, 'game canvas must have a visible bounding box');
  const ratios = [
    [0.5, 0.5], [0.5, 0.58], [0.5, 0.42], [0.42, 0.5], [0.58, 0.5],
    [0.42, 0.58], [0.58, 0.58], [0.42, 0.42], [0.58, 0.42],
  ];
  for (let y = 0.18; y <= 0.82; y += 0.08) {
    for (let x = 0.18; x <= 0.82; x += 0.08) ratios.push([x, y]);
  }
  for (const [ratioX, ratioY] of ratios) {
    const x = bounds.x + bounds.width * ratioX;
    const y = bounds.y + bounds.height * ratioY;
    const hitsCanvas = await player.page.evaluate(({ clientX, clientY }) => (
      document.elementFromPoint(clientX, clientY)?.id === 'game-canvas'
    ), { clientX: x, clientY: y });
    if (!hitsCanvas) continue;
    await player.page.mouse.click(x, y);
    const state = await readState(player.page);
    if (state.lobbyEditor.selected === objectId) return { state, x, y };
  }
  throw new Error(`Could not select ${objectId} from the visible canvas`);
}

let fixture;
const browsers = [];
const players = [];
const errors = [];

try {
  fixture = await createVehicleFixture();
  const helicopter = fixture.object;

  const aliceBrowser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const bobBrowser = sharedBrowser
    ? aliceBrowser
    : await chromium.launch({
      headless: process.env.HEADED !== '1',
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    });
  browsers.push(aliceBrowser);
  if (bobBrowser !== aliceBrowser) browsers.push(bobBrowser);
  const alice = await createPlayer(aliceBrowser, 'Helicopter Alice', errors);
  const bob = await createPlayer(bobBrowser, 'Helicopter Bob', errors);
  players.push(alice, bob);

  assert.deepEqual(await saturatedUiReport(alice.page), [], 'boot UI must remain neutral black, white, and gray');
  await alice.page.screenshot({ path: path.join(outputDirectory, 'boot-neutral.png') });

  await Promise.all([enterChannel(alice), enterChannel(bob)]);
  for (const player of [alice, bob]) {
    assert.ok(
      vehicleWelcomeFeatureFrame(player),
      `${player.name} welcome must advertise ${requiredVehicleFeatures.join(' + ')}: ${JSON.stringify(player.vehicleFrames)}`,
    );
    assert.ok(
      negotiatedVehicleFeatureFrame(player),
      `${player.name} must negotiate ${requiredVehicleFeatures.join(' + ')}: ${JSON.stringify(player.vehicleFrames)}`,
    );
  }
  await Promise.all([
    waitForState(alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice'),
  ]);
  await stepPages([alice.page, bob.page], 300);

  for (const player of [alice, bob]) {
    const loaded = await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => {
        const object = vehicleObject(state);
        return object?.id === helicopter.id
          && object.drivable
          && object.vehicleKind === 'aircraft'
          && state.nearbyInteraction?.startsWith('驾驶 ')
          && state.nearbyInteraction.includes('直升机');
      },
      `${player.name} sees the reviewed rotorcraft and drive prompt`,
    );
    const object = vehicleObject(loaded);
    const terminal = loaded.lobbyEditor.objects.find((candidate) => candidate.id === 'system-terminal');
    assert.equal(object.catalogId, catalogId);
    assert.equal(object.name, '苍隼救援直升机');
    assert.equal(object.vehicleKind, 'aircraft');
    assert.ok(terminal, 'the fixed lobby terminal must remain present');
    assert.equal(terminal.system, true);
    assert.equal(terminal.locked, true);
    assert.equal(terminal.canEdit, false);
    assert.equal(terminal.canDelete, false);
  }
  assert.deepEqual(await saturatedUiReport(alice.page), [], 'in-game HUD must remain neutral black, white, and gray');
  await alice.page.screenshot({ path: path.join(outputDirectory, 'helicopter-ready.png') });
  await stepPages([alice.page, bob.page], 200);

  await Promise.all([
    alice.page.keyboard.press('KeyE'),
    bob.page.keyboard.press('KeyE'),
  ]);

  let aliceRace;
  let bobRace;
  const raceStartedAt = Date.now();
  while (Date.now() - raceStartedAt < scaledTimeout(8_000)) {
    await stepPages([alice.page, bob.page], 100);
    [aliceRace, bobRace] = await Promise.all([readState(alice.page), readState(bob.page)]);
    const activeCount = Number(aliceRace.vehicle.active) + Number(bobRace.vehicle.active);
    if (activeCount === 1 && !aliceRace.vehicle.pendingObjectId && !bobRace.vehicle.pendingObjectId) break;
  }
  assert.equal(
    Number(aliceRace.vehicle.active) + Number(bobRace.vehicle.active),
    1,
    `exactly one player may win the same helicopter lease: ${JSON.stringify({
      alice: {
        player: aliceRace.player.position,
        vehicle: aliceRace.vehicle,
        interaction: aliceRace.nearbyInteraction,
        frames: alice.vehicleFrames,
      },
      bob: {
        player: bobRace.player.position,
        vehicle: bobRace.vehicle,
        interaction: bobRace.nearbyInteraction,
        frames: bob.vehicleFrames,
      },
    })}`,
  );

  const driver = aliceRace.vehicle.active ? alice : bob;
  const observer = driver === alice ? bob : alice;
  const loser = observer;
  const driverRace = driver === alice ? aliceRace : bobRace;
  const observerRace = driver === alice ? bobRace : aliceRace;
  assert.equal(driverRace.vehicle.objectId, helicopter.id);
  assert.equal(driverRace.vehicle.catalogId, catalogId);
  assert.equal(driverRace.vehicle.kind, 'aircraft');
  assert.equal(driverRace.vehicle.flightModel, 'rotorcraft');
  assert.equal(driverRace.input.controlTarget, 'vehicle');
  assert.equal(driverRace.player.visible, false, 'local driver avatar is hidden while occupied');
  assert.equal(observerRace.vehicle.active, false);
  assert.equal(vehicleObject(observerRace).occupiedBy, driverRace.vehicle.driverId);
  assert.ok(
    loser.vehicleFrames.some((frame) => frame.direction === 'received'
      && frame.type === 'error'
      && frame.code === 'vehicle_busy'),
    `lease loser must receive vehicle_busy: ${JSON.stringify(loser.vehicleFrames)}`,
  );

  let pilotState;
  try {
    pilotState = await advanceUntil(
      [alice.page, bob.page],
      driver.page,
      (state) => state.vehicle.phase === 'driving'
        && state.vehicle.kind === 'aircraft'
        && state.vehicle.flightModel === 'rotorcraft',
      'helicopter enter animation completes',
      12_000,
    );
  } catch (error) {
    error.message += `\nVehicle frames: ${JSON.stringify(driver.vehicleFrames)}`;
    throw error;
  }
  const start = structuredClone(pilotState.vehicle);
  const pilotId = pilotState.vehicle.driverId;
  const drivingFrameStart = driver.vehicleFrames.length;

  const occupiedPatch = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(helicopter.id)}?channel=${encodeURIComponent(channel)}`,
    'PATCH',
    { clientId: fixtureClientId, scale: 1.1 },
    fixture.cookie,
  );
  assert.equal(occupiedPatch.response.status, 409, JSON.stringify(occupiedPatch.payload));
  assert.equal(occupiedPatch.payload?.error?.code, 'lobby_vehicle_in_use');
  const occupiedDelete = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(helicopter.id)}?channel=${encodeURIComponent(channel)}`,
    'DELETE',
    { clientId: fixtureClientId },
    fixture.cookie,
  );
  assert.equal(occupiedDelete.response.status, 409, JSON.stringify(occupiedDelete.payload));
  assert.equal(occupiedDelete.payload?.error?.code, 'lobby_vehicle_in_use');

  if (renderStallMs > 0) {
    const driverFrameStart = driver.vehicleFrames.length;
    const observerFrameStart = observer.vehicleFrames.length;
    await driver.page.evaluate((milliseconds) => {
      const end = performance.now() + milliseconds;
      while (performance.now() < end) {
        // Intentionally block RAF, physics, and page timers to reproduce a
        // background/debugger pause while the server process remains alive.
      }
    }, renderStallMs);
    await stepPages([alice.page, bob.page], 300);
    pilotState = await readState(driver.page);
    assert.equal(pilotState.vehicle.active, true, 'render stall must retain the active driver lease');
    assert.equal(pilotState.vehicle.safeExitMode, 'none', 'render stall must not start recovery or autoland');
    const postStallFrames = [
      ...driver.vehicleFrames.slice(driverFrameStart),
      ...observer.vehicleFrames.slice(observerFrameStart),
    ];
    assert.equal(
      postStallFrames.some((frame) => (
        frame.type === 'vehicle_recovery'
        || frame.type === 'vehicle_released'
        || (frame.type === 'error' && [
          'vehicle_lease_rejected',
          'vehicle_state_rejected',
        ].includes(frame.code))
      )),
      false,
      `render stall must not interrupt driving: ${JSON.stringify(postStallFrames)}`,
    );
  }

  await driver.page.keyboard.down('Space');
  pilotState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.altitude >= 9
      && state.vehicle.velocity.y > 0.45
      && state.vehicle.vertical > 0.1
      && state.vehicle.grounded === false,
    'Space raises the helicopter above the retired 7.4 m ceiling',
    18_000,
  );
  await driver.page.keyboard.up('Space');
  const takeoff = structuredClone(pilotState.vehicle);
  assert.ok(takeoff.altitude >= 9, 'driver text state must exceed the retired 7.4 m ceiling');

  const observerHigh = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const vehicle = syncedVehicle(state, helicopter.id);
      return vehicle?.driverId === pilotId && vehicle.y > 7.4;
    },
    'observer text state sees the helicopter above the retired ceiling',
  );
  const observerHighPose = structuredClone(syncedVehicle(observerHigh, helicopter.id));
  const driverHighFrame = [...driver.vehicleFrames].reverse().find((frame) => (
    frame.direction === 'sent'
    && frame.type === 'vehicle_state'
    && frame.vehicle?.objectId === helicopter.id
    && frame.vehicle.y > 7.4
  ));
  const observerHighFrame = [...observer.vehicleFrames].reverse().find((frame) => (
    frame.direction === 'received'
    && frame.type === 'vehicle_state'
    && frame.vehicle?.objectId === helicopter.id
    && frame.vehicle.y > 7.4
  ));
  assert.ok(driverHighFrame, 'driver WebSocket state must carry altitude above 7.4 m');
  assert.ok(observerHighFrame, 'observer WebSocket state must carry altitude above 7.4 m');

  pilotState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.altitude > 8.5 && Math.abs(state.vehicle.velocity.y) < 0.18,
    'helicopter stabilizes above the retired ceiling after releasing Space',
  );
  const highHover = structuredClone(pilotState.vehicle);

  const forwardStart = structuredClone(pilotState.vehicle);
  await driver.page.keyboard.down('KeyW');
  try {
    pilotState = await advanceUntil(
      [alice.page, bob.page],
      driver.page,
      (state) => state.vehicle.throttle > 0.65
        && outsideLegacyFlightBoundary(state.vehicle.position, 56)
        && Math.hypot(state.vehicle.velocity.x, state.vehicle.velocity.z) > 1.8,
      'W flies the rotorcraft beyond the retired +/-54 m lobby boundary',
      60_000,
    );
  } catch (error) {
    error.message += `\nDriver WebSocket frames: ${JSON.stringify(driver.vehicleFrames)}`;
    throw error;
  }
  await driver.page.keyboard.up('KeyW');
  const boundaryDriver = structuredClone(pilotState.vehicle);
  assert.ok(
    outsideLegacyFlightBoundary(boundaryDriver.position),
    'driver text state must exceed the retired horizontal boundary',
  );
  assert.ok(
    boundaryDriver.position.z < forwardStart.position.z - 54,
    'yaw PI forward flight must cross the old -Z boundary',
  );

  const observerBoundary = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const vehicle = syncedVehicle(state, helicopter.id);
      return vehicle?.driverId === pilotId
        && vehicle.kind === 'aircraft'
        && vehicle.seq >= 2
        && outsideLegacyFlightBoundary(vehicle);
    },
    'observer text state receives the authoritative pose beyond +/-54 m',
  );
  const observerBoundaryPose = structuredClone(syncedVehicle(observerBoundary, helicopter.id));
  const driverBoundaryFrame = [...driver.vehicleFrames].reverse().find((frame) => (
    frame.direction === 'sent'
    && frame.type === 'vehicle_state'
    && frame.vehicle?.objectId === helicopter.id
    && outsideLegacyFlightBoundary(frame.vehicle)
  ));
  const observerBoundaryFrame = [...observer.vehicleFrames].reverse().find((frame) => (
    frame.direction === 'received'
    && frame.type === 'vehicle_state'
    && frame.vehicle?.objectId === helicopter.id
    && outsideLegacyFlightBoundary(frame.vehicle)
  ));
  assert.ok(driverBoundaryFrame, 'driver WebSocket state must exceed the retired horizontal boundary');
  assert.ok(observerBoundaryFrame, 'observer WebSocket state must exceed the retired horizontal boundary');

  const remoteDriver = observerBoundary.multiplayer.remote.find(
    (player) => player.id === pilotId,
  );
  assert.equal(remoteDriver?.visible, false, 'remote driver avatar is hidden while occupied');
  assert.equal(remoteDriver?.vehicle?.objectId, helicopter.id);

  await screenshotWithDriverHeartbeat(
    driver.page,
    driver.page,
    path.join(outputDirectory, 'helicopter-unbounded-flight.png'),
  );
  await stepPages([alice.page, bob.page], 200);
  assert.equal((await readState(driver.page)).vehicle.active, true, 'unbounded-flight screenshot must retain the lease');

  const beforeRightYaw = pilotState.player.facingYawDeg;
  await driver.page.keyboard.down('KeyD');
  const observerRightYaw = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const vehicle = syncedVehicle(state, helicopter.id);
      return vehicle?.driverId === pilotState.vehicle.driverId
        && signedAngleDeltaDegrees(beforeRightYaw, vehicle.yaw * 180 / Math.PI) < -14
        && Math.abs(vehicle.roll) > 0.035;
    },
    'D yaws and banks the helicopter to the right',
  );
  const rightPose = structuredClone(syncedVehicle(observerRightYaw, helicopter.id));
  await driver.page.keyboard.up('KeyD');
  const afterRightYaw = (await readState(driver.page)).player.facingYawDeg;
  assert.ok(signedAngleDeltaDegrees(beforeRightYaw, afterRightYaw) < -12, 'D turns screen-right with negative yaw');

  await driver.page.keyboard.down('KeyA');
  pilotState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => signedAngleDeltaDegrees(afterRightYaw, state.player.facingYawDeg) > 14,
    'A yaws the helicopter back to the left',
  );
  await driver.page.keyboard.up('KeyA');
  const afterLeftYaw = pilotState.player.facingYawDeg;

  assert.equal(pilotState.vehicle.grounded, false);
  assert.equal(pilotState.vehicle.exitAllowed, false);
  assert.equal(pilotState.vehicle.safeExitMode, 'none');
  assert.ok(pilotState.vehicle.altitude > 7.4, 'single-key safe exit starts above the retired ceiling');
  const autolandRequestedFrom = structuredClone(pilotState.vehicle);
  const vehicleExitFramesBefore = driver.vehicleFrames.filter(
    (frame) => frame.direction === 'sent' && frame.type === 'vehicle_exit',
  ).length;
  const observerReleaseFramesBefore = observer.vehicleFrames.filter(
    (frame) => frame.direction === 'received'
      && frame.type === 'vehicle_released'
      && frame.vehicle?.objectId === helicopter.id,
  ).length;

  // One airborne E is the complete user gesture. No Shift/C descent input is
  // sent after this point; the rotorcraft must brake, descend, land, and exit.
  await driver.page.keyboard.press('KeyE');
  const autolandStartedState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.safeExitMode === 'autoland'
      && state.vehicle.grounded === false
      && state.input.controlTarget === 'vehicle'
      && state.player.visible === false,
    'one airborne E engages client autoland while retaining the occupied seat',
  );
  const autolandStarted = structuredClone(autolandStartedState.vehicle);
  assert.equal(
    driver.vehicleFrames.filter(
      (frame) => frame.direction === 'sent' && frame.type === 'vehicle_exit',
    ).length,
    vehicleExitFramesBefore,
    'autoland must not release the lease while airborne',
  );

  const observerAutoland = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const vehicle = syncedVehicle(state, helicopter.id);
      const remote = state.multiplayer.remote.find((player) => player.id === pilotId);
      return vehicle?.driverId === pilotId
        && vehicle.y > 0
        && remote?.visible === false
        && remote.vehicle?.objectId === helicopter.id;
    },
    'observer keeps the pilot avatar hidden while autoland owns the occupied helicopter',
  );
  assert.equal(vehicleObject(observerAutoland).occupiedBy, pilotId);

  const autolandDescentState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.safeExitMode === 'autoland'
      && state.vehicle.altitude <= autolandStarted.altitude - 1
      && state.vehicle.altitude > 0.5
      && state.vehicle.velocity.y < -0.35
      && state.player.visible === false,
    'automatic landing descends without Shift or C',
    20_000,
  );
  const autolandDescent = structuredClone(autolandDescentState.vehicle);
  const observerDescent = await readState(observer.page);
  const observerDescentPose = structuredClone(syncedVehicle(observerDescent, helicopter.id));
  assert.equal(
    observerDescent.multiplayer.remote.find((player) => player.id === pilotId)?.visible,
    false,
    'remote pilot remains hidden during automatic descent',
  );
  assert.equal(observerDescentPose.driverId, pilotId);

  const groundedAutolandState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.safeExitMode === 'awaiting-release'
      && state.vehicle.phase === 'exiting'
      && state.vehicle.grounded
      && state.vehicle.altitude <= 0.02
      && state.vehicle.speedKph <= 4.2
      && state.player.visible === false,
    'autoland reaches grounded exiting state before release',
    35_000,
  );
  const groundedAutoland = structuredClone(groundedAutolandState.vehicle);
  const observerBeforeRelease = await readState(observer.page);
  assert.equal(
    observerBeforeRelease.multiplayer.remote.find((player) => player.id === pilotId)?.visible,
    false,
    'observer avatar stays hidden through grounded exit animation',
  );
  assert.equal(vehicleObject(observerBeforeRelease).occupiedBy, pilotId);
  assert.equal(
    observer.vehicleFrames.filter(
      (frame) => frame.direction === 'received'
        && frame.type === 'vehicle_released'
        && frame.vehicle?.objectId === helicopter.id,
    ).length,
    observerReleaseFramesBefore,
    'observer must not receive final release before the grounded exit phase',
  );
  assert.equal(
    driver.vehicleFrames.filter(
      (frame) => frame.direction === 'sent' && frame.type === 'vehicle_exit',
    ).length,
    vehicleExitFramesBefore,
    'vehicle_exit is deferred until the grounded exit animation completes',
  );

  const exited = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => !state.vehicle.active
      && state.input.controlTarget === 'player'
      && state.player.visible
      && state.player.grounded,
    'single-key autoland completes the grounded pilot exit',
    12_000,
  );
  assert.equal(exited.vehicle.persistence, 'runtime-only');
  const vehicleExitFramesAfter = driver.vehicleFrames.filter(
    (frame) => frame.direction === 'sent' && frame.type === 'vehicle_exit',
  ).length;
  assert.equal(
    vehicleExitFramesAfter,
    vehicleExitFramesBefore + 1,
    'one delayed vehicle_exit must finalize the one-key autoland',
  );

  const observerReleased = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => vehicleObject(state)?.occupiedBy === null
      && syncedVehicle(state, helicopter.id)?.driverId === null
      && state.multiplayer.remote.find((player) => player.id === pilotId)?.visible === true,
    'observer shows the pilot only after authoritative final release',
  );
  const releasedPose = structuredClone(syncedVehicle(observerReleased, helicopter.id));
  const releaseFrame = [...observer.vehicleFrames].reverse().find((frame) => (
    frame.direction === 'received'
    && frame.type === 'vehicle_released'
    && frame.vehicle?.objectId === helicopter.id
  ));
  assert.ok(releaseFrame, 'observer must receive the authoritative vehicle_released frame');
  assert.equal(releaseFrame.reason, 'exit');
  assert.ok(releaseFrame.vehicle.y <= 0.02, 'released WebSocket pose must be grounded');
  assert.equal(releaseFrame.vehicle.driverId, null);
  assert.equal(releasedPose.driverId, null);
  assert.equal(releasedPose.recovering, false);
  assert.ok(releasedPose.y <= 0.02, 'observer final text pose must be grounded');
  assert.ok(Math.hypot(releasedPose.vx, releasedPose.vy, releasedPose.vz) < 0.05);
  assert.equal(
    observer.vehicleFrames.filter(
      (frame) => frame.direction === 'received'
        && frame.type === 'vehicle_released'
        && frame.vehicle?.objectId === helicopter.id,
    ).length,
    observerReleaseFramesBefore + 1,
    'observer sees exactly one final release for the fixture',
  );
  assert.equal(
    observerReleased.multiplayer.remote.find((player) => player.id === pilotId)?.visible,
    true,
    'remote pilot avatar becomes visible only after release',
  );
  const driverReleaseFrameIndex = driver.vehicleFrames.findIndex((frame, index) => (
    index >= drivingFrameStart
    && frame.direction === 'received'
    && frame.type === 'vehicle_released'
    && frame.vehicle?.objectId === helicopter.id
  ));
  assert.ok(driverReleaseFrameIndex >= drivingFrameStart, 'driver must receive the final release frame');
  assert.equal(
    driver.vehicleFrames.slice(drivingFrameStart, driverReleaseFrameIndex + 1).some((frame) => (
      frame.direction === 'sent' && frame.type === 'pose'
    )),
    false,
    'ordinary avatar poses stay suppressed for the complete occupied interval',
  );
  const resumedPose = driver.vehicleFrames.slice(driverReleaseFrameIndex + 1).find((frame) => (
    frame.direction === 'sent' && frame.type === 'pose'
  ));
  assert.ok(resumedPose?.pose, 'avatar pose sync resumes immediately after the grounded release');
  assert.ok(
    Math.hypot(
      resumedPose.pose.x - exited.player.position.x,
      resumedPose.pose.y - exited.player.position.y,
      resumedPose.pose.z - exited.player.position.z,
    ) < 0.02,
    'the first resumed pose matches the grounded exit position',
  );
  const remoteExitedPilot = observerReleased.multiplayer.remote.find((player) => player.id === pilotId);
  assert.ok(remoteExitedPilot, 'observer keeps the released pilot in the remote-player snapshot');
  assert.ok(
    Math.hypot(
      remoteExitedPilot.x - exited.player.position.x,
      remoteExitedPilot.y - exited.player.position.y,
      remoteExitedPilot.z - exited.player.position.z,
    ) < 0.05,
    'the observer receives the grounded exit pose after release',
  );

  await observer.page.screenshot({ path: path.join(outputDirectory, 'helicopter-released.png') });

  const releasedEditableStates = [];
  for (const player of players) {
    releasedEditableStates.push(await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => {
        const object = vehicleObject(state);
        return object?.id === helicopter.id
          && object.occupiedBy === null
          && object.canEdit === true
          && object.canDelete === true;
      },
      `${player.name} can decorate the idle parked helicopter after release`,
    ));
  }

  assert.ok(
    outsideLegacyFlightBoundary(releasedPose),
    'the grounded helicopter must remain beyond the retired horizontal editor boundary',
  );
  const farParkedBeforeEdit = structuredClone(releasedPose);
  const farEditorEntered = await enterEditor(driver);
  assert.equal(
    farEditorEntered.creativeCamera.bounds.horizontal,
    'unbounded',
    'creative-camera text state must advertise unbounded horizontal travel',
  );
  const farSelected = await selectExistingObject(driver, helicopter.id);
  assert.equal(
    farSelected.state.lobbyEditor.objects.find((object) => object.id === helicopter.id)?.canEdit,
    true,
  );

  const farScaleResponsePromise = driver.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'PATCH';
  });
  await driver.page.locator('#lobby-scale-up').click();
  assert.equal((await farScaleResponsePromise).status(), 200);
  const farScaled = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const runtime = syncedVehicle(state, helicopter.id);
      return vehicleObject(state)?.scale === 1.1
        && runtime?.driverId === null
        && outsideLegacyFlightBoundary(runtime)
        && Math.hypot(runtime.x - farParkedBeforeEdit.x, runtime.z - farParkedBeforeEdit.z) < 0.05;
    },
    'far parked helicopter scale synchronizes without snapping into the old editor boundary',
  );
  const farScaledObject = structuredClone(vehicleObject(farScaled));
  const farScaledRuntime = structuredClone(syncedVehicle(farScaled, helicopter.id));
  assert.ok(
    Math.hypot(
      farScaledRuntime.x - farParkedBeforeEdit.x,
      farScaledRuntime.y - farParkedBeforeEdit.y,
      farScaledRuntime.z - farParkedBeforeEdit.z,
    ) < 0.05,
    'scale-only editing must preserve the actual far parked pose',
  );
  await waitForEditorButtonEnabled(
    driver,
    '#lobby-rotate-right',
    'far-position scale save must finish before the next transform',
  );

  const beforeFarRotation = vehicleObject(await readState(driver.page)).rotationY;
  const farRotateResponsePromise = driver.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'PATCH';
  });
  await driver.page.locator('#lobby-rotate-right').click();
  assert.equal((await farRotateResponsePromise).status(), 200);
  const farRotated = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const object = vehicleObject(state);
      const runtime = syncedVehicle(state, helicopter.id);
      return object
        && Math.abs(signedAngleDeltaDegrees(beforeFarRotation * 180 / Math.PI, object.rotationY * 180 / Math.PI)) > 10
        && runtime?.driverId === null
        && outsideLegacyFlightBoundary(runtime)
        && Math.hypot(runtime.x - farParkedBeforeEdit.x, runtime.z - farParkedBeforeEdit.z) < 0.05
        && Math.abs(signedAngleDeltaDegrees(object.rotationY * 180 / Math.PI, runtime.yaw * 180 / Math.PI)) < 0.5;
    },
    'far parked helicopter rotation synchronizes without changing its parked position',
  );
  const farRotatedObject = structuredClone(vehicleObject(farRotated));
  const farRotatedRuntime = structuredClone(syncedVehicle(farRotated, helicopter.id));
  assert.ok(
    Math.hypot(
      farRotatedRuntime.x - farParkedBeforeEdit.x,
      farRotatedRuntime.y - farParkedBeforeEdit.y,
      farRotatedRuntime.z - farParkedBeforeEdit.z,
    ) < 0.05,
    'rotation editing must preserve the actual far parked position',
  );
  await waitForEditorButtonEnabled(
    driver,
    '#lobby-rotate-right',
    'far-position rotation save must finish before leaving decoration',
  );
  await screenshotWithDriverHeartbeat(
    driver.page,
    observer.page,
    path.join(outputDirectory, 'helicopter-far-editable.png'),
  );
  await driver.page.keyboard.press('KeyB');
  await waitForState(
    driver.page,
    (state) => state.state === 'HUB' && state.lobbyEditor.enabled === false,
    `${driver.name} exits far-position decoration before the reset regression checks`,
  );

  const resetPatch = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(helicopter.id)}?channel=${encodeURIComponent(channel)}`,
    'PATCH',
    {
      clientId: fixtureClientId,
      position: { x: 0, y: 0, z: 1.5 },
      rotationY: Math.PI,
      scale: 1,
    },
    fixture.cookie,
  );
  assert.equal(resetPatch.response.status, 200, JSON.stringify(resetPatch.payload));

  const resetStates = [];
  for (const player of players) {
    resetStates.push(await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => {
        const object = vehicleObject(state);
        const runtime = syncedVehicle(state, helicopter.id);
        return object?.x === 0
          && object.y === 0
          && object.z === 1.5
          && object.scale === 1
          && object.canEdit === true
          && object.canDelete === true
          && runtime?.driverId === null
          && Math.abs(runtime.x) < 0.02
          && Math.abs(runtime.y) < 0.02
          && Math.abs(runtime.z - 1.5) < 0.02;
      },
      `${player.name} receives the idle runtime reset through object and vehicle snapshots`,
    ));
  }
  assert.ok(
    players.every((player) => player.vehicleFrames.some((frame) => (
      frame.direction === 'received'
      && frame.type === 'vehicle_snapshot'
      && frame.vehicles?.some((vehicle) => vehicle.objectId === helicopter.id
        && vehicle.driverId === null
        && Math.abs(vehicle.x) < 0.02
        && Math.abs(vehicle.z - 1.5) < 0.02)
    ))),
    'both clients must receive the authoritative idle vehicle snapshot after repositioning',
  );

  const editorPlayer = observer;
  const editorPeer = driver;
  await enterEditor(editorPlayer);
  const selected = await selectExistingObject(editorPlayer, helicopter.id);
  assert.equal(selected.state.lobbyEditor.objects.find((object) => object.id === helicopter.id)?.canEdit, true);
  assert.equal(selected.state.lobbyEditor.objects.find((object) => object.id === helicopter.id)?.canDelete, true);

  const scaleResponsePromise = editorPlayer.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'PATCH';
  });
  await editorPlayer.page.locator('#lobby-scale-up').click();
  assert.equal((await scaleResponsePromise).status(), 200);
  const scaled = await advanceUntil(
    [alice.page, bob.page],
    editorPeer.page,
    (state) => vehicleObject(state)?.scale === 1.1,
    'idle helicopter scale synchronizes to the second client',
  );
  const scaledRuntime = structuredClone(syncedVehicle(scaled, helicopter.id));
  assert.ok(Math.abs(scaledRuntime.x) < 0.02 && Math.abs(scaledRuntime.z - 1.5) < 0.02);
  assert.ok(
    Math.abs(signedAngleDeltaDegrees(Math.PI * 180 / Math.PI, scaledRuntime.yaw * 180 / Math.PI)) < 0.5,
    'scale-only PATCH must preserve the parked runtime yaw',
  );
  await waitForEditorButtonEnabled(
    editorPlayer,
    '#lobby-rotate-right',
    'scale save must finish before the rotation regression check',
  );

  const beforeRotation = vehicleObject(await readState(editorPlayer.page)).rotationY;
  const rotateResponsePromise = editorPlayer.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'PATCH';
  });
  await editorPlayer.page.locator('#lobby-rotate-right').click();
  assert.equal((await rotateResponsePromise).status(), 200);
  const rotated = await advanceUntil(
    [alice.page, bob.page],
    editorPeer.page,
    (state) => {
      const object = vehicleObject(state);
      const runtime = syncedVehicle(state, helicopter.id);
      return object
        && Math.abs(signedAngleDeltaDegrees(beforeRotation * 180 / Math.PI, object.rotationY * 180 / Math.PI)) > 10
        && runtime
        && Math.abs(signedAngleDeltaDegrees(object.rotationY * 180 / Math.PI, runtime.yaw * 180 / Math.PI)) < 0.5;
    },
    'idle helicopter rotation synchronizes to object and runtime state',
  );
  const rotatedObject = structuredClone(vehicleObject(rotated));
  await waitForEditorButtonEnabled(
    editorPlayer,
    '#lobby-rotate-right',
    'rotation save must finish before the drag regression check',
  );

  const moveResponsePromise = editorPlayer.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'PATCH';
  });
  await editorPlayer.page.mouse.move(selected.x, selected.y);
  await editorPlayer.page.mouse.down();
  await editorPlayer.page.mouse.move(selected.x + 110, selected.y, { steps: 8 });
  await editorPlayer.page.mouse.up();
  assert.equal((await moveResponsePromise).status(), 200);
  const moved = await advanceUntil(
    [alice.page, bob.page],
    editorPeer.page,
    (state) => {
      const object = vehicleObject(state);
      const runtime = syncedVehicle(state, helicopter.id);
      return object
        && Math.hypot(object.x, object.z - 1.5) > 0.2
        && runtime
        && Math.abs(runtime.x - object.x) < 0.03
        && Math.abs(runtime.y - object.y) < 0.03
        && Math.abs(runtime.z - object.z) < 0.03;
    },
    'idle helicopter drag synchronizes the parked runtime pose to the second client',
  );
  const movedObject = structuredClone(vehicleObject(moved));
  await editorPlayer.page.screenshot({ path: path.join(outputDirectory, 'helicopter-editable.png') });

  const deleteResponsePromise = editorPlayer.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${helicopter.id}`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'DELETE';
  });
  await editorPlayer.page.locator('#lobby-delete').click();
  assert.equal((await deleteResponsePromise).status(), 200);
  for (const player of players) {
    await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => !state.lobbyEditor.objects.some((object) => object.id === helicopter.id)
        && !state.multiplayer.vehicles.some((vehicle) => vehicle.objectId === helicopter.id),
      `${player.name} removes the deleted helicopter from object and runtime snapshots`,
    );
  }
  assert.ok(
    players.every((player) => player.vehicleFrames.some((frame) => (
      frame.direction === 'received'
      && frame.type === 'vehicle_snapshot'
      && Array.isArray(frame.vehicles)
      && !frame.vehicles.some((vehicle) => vehicle.objectId === helicopter.id)
    ))),
    'both clients must receive the authoritative runtime removal snapshot',
  );
  await editorPlayer.page.screenshot({ path: path.join(outputDirectory, 'helicopter-deleted.png') });

  const allFrames = players.flatMap((player) => player.vehicleFrames);
  assert.equal(
    allFrames.some((frame) => frame.type === 'vehicle_pose'),
    false,
    'obsolete vehicle-pose messages must never appear',
  );
  assert.ok(driver.vehicleFrames.some((frame) => frame.direction === 'sent' && frame.type === 'vehicle_state'));
  assert.ok(driver.vehicleFrames.some((frame) => frame.direction === 'sent' && frame.type === 'vehicle_exit'));
  assert.ok(driver.vehicleFrames.some((frame) => frame.direction === 'received' && frame.type === 'vehicle_entered'));
  assert.ok(driver.vehicleFrames.some((frame) => frame.direction === 'received' && frame.type === 'vehicle_released'));
  assert.deepEqual(errors, [], errors.join('\n'));

  const report = {
    ok: true,
    baseUrl,
    platformBaseUrl,
    channel,
    catalogId,
    helicopterId: helicopter.id,
    leaseWinner: driver.name,
    protocol: {
      features: requiredVehicleFeatures,
      welcomeBy: players.map((player) => ({
        player: player.name,
        channel: vehicleWelcomeFeatureFrame(player).channel,
        features: vehicleWelcomeFeatureFrame(player).features,
      })),
      negotiatedBy: players.map((player) => ({
        player: player.name,
        frameType: negotiatedVehicleFeatureFrame(player).type,
        features: negotiatedVehicleFeatureFrame(player).features,
      })),
      flightModel: 'rotorcraft',
      driverSent: uniqueFrameTypes(driver, 'sent'),
      driverReceived: uniqueFrameTypes(driver, 'received'),
      loserReceived: uniqueFrameTypes(loser, 'received'),
      obsoleteVehiclePoseSeen: false,
    },
    flight: {
      start: start.position,
      renderStallMs,
      retiredCeilingExceeded: {
        retiredCeiling: 7.4,
        targetAltitude: 9,
        driverTextPose: takeoff.position,
        stabilizedDriverTextPose: highHover.position,
        observerTextPose: observerHighPose,
        driverWebSocketPose: driverHighFrame.vehicle,
        observerWebSocketPose: observerHighFrame.vehicle,
        upwardVelocity: takeoff.velocity.y,
      },
      retiredHorizontalBoundaryExceeded: {
        retiredBoundary: 54,
        from: forwardStart.position,
        driverTextPose: boundaryDriver.position,
        observerTextPose: observerBoundaryPose,
        driverWebSocketPose: driverBoundaryFrame.vehicle,
        observerWebSocketPose: observerBoundaryFrame.vehicle,
        throttle: boundaryDriver.throttle,
        horizontalSpeed: Math.hypot(boundaryDriver.velocity.x, boundaryDriver.velocity.z),
      },
      yaw: {
        beforeRightDeg: beforeRightYaw,
        afterRightDeg: afterRightYaw,
        afterLeftDeg: afterLeftYaw,
        synchronizedRightPose: rightPose,
      },
      oneKeyAutoland: {
        gesture: 'KeyE once while airborne',
        manualDescentInputs: [],
        requestedFrom: autolandRequestedFrom,
        engaged: autolandStarted,
        descending: autolandDescent,
        observerDescendingPose: observerDescentPose,
        groundedBeforeRelease: groundedAutoland,
        vehicleExitFramesBefore,
        vehicleExitFramesAfter,
        releasedFrame: {
          reason: releaseFrame.reason,
          vehicle: releaseFrame.vehicle,
        },
        releasedPose,
        exitedPlayerPosition: exited.player.position,
      },
    },
    editing: {
      occupiedMutations: {
        patchStatus: occupiedPatch.response.status,
        deleteStatus: occupiedDelete.response.status,
        errorCode: 'lobby_vehicle_in_use',
      },
      releasedEditableBy: players.map((player, index) => ({
        player: player.name,
        object: vehicleObject(releasedEditableStates[index]),
      })),
      farPositionUiEditing: {
        player: driver.name,
        cameraBounds: farEditorEntered.creativeCamera.bounds,
        parkedBefore: farParkedBeforeEdit,
        selectedAt: { x: farSelected.x, y: farSelected.y },
        scaledObject: farScaledObject,
        scaledRuntime: farScaledRuntime,
        rotatedObject: farRotatedObject,
        rotatedRuntime: farRotatedRuntime,
      },
      resetObject: resetPatch.payload?.object ?? null,
      resetRuntimeBy: players.map((player, index) => ({
        player: player.name,
        runtime: syncedVehicle(resetStates[index], helicopter.id),
      })),
      scaledObject: vehicleObject(scaled),
      scaledRuntime,
      rotatedObject,
      movedObject,
      deletedFromObjectAndRuntimeSnapshots: true,
    },
    checks: [
      'neutral monochrome boot and HUD',
      'reviewed code-precision-rescue-helicopter aircraft capability',
      'two-player server-authoritative exclusive vehicle lease',
      ...(renderStallMs > 0
        ? [`${renderStallMs} ms blocked driver render loop retains the lease`]
        : []),
      'local and remote occupied-avatar hiding',
      'welcome/channel snapshot negotiates vehicle-lease-v1 and vehicle-autoland-v1',
      'Space reaches at least 9 m and exceeds the retired 7.4 m ceiling',
      'W crosses retired +/-54 m bounds in driver text, observer text, and WebSocket poses',
      'D right yaw and A left yaw with synchronized bank pose',
      'one airborne E engages autoland without Shift/C input',
      'occupied avatar stays hidden through descent, touchdown, and grounded exit animation',
      'grounded release restores the observer avatar exactly after vehicle_released',
      'vehicle lease/autoland messages only; no vehicle-pose protocol',
      'occupied helicopter PATCH and DELETE both return 409 lobby_vehicle_in_use',
      'idle parked helicopter restores move, rotate, scale, and delete controls',
      'released pilot enters horizontal-unbounded decoration and UI-selects the far parked helicopter before any reset',
      'far-position UI scale and rotation synchronize without snapping the parked pose back inside +/-54 m',
      'scale-only edit preserves parked pose; rotate and drag reconcile the runtime snapshot',
      'two clients receive strict full vehicle_snapshot updates and deletion removal',
    ],
    screenshots: [
      'boot-neutral.png',
      'helicopter-ready.png',
      'helicopter-unbounded-flight.png',
      'helicopter-released.png',
      'helicopter-far-editable.png',
      'helicopter-editable.png',
      'helicopter-deleted.png',
    ],
  };
  await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const diagnostics = players.map((player) => ({
    name: player.name,
    frames: player.vehicleFrames,
  }));
  await writeFile(
    path.join(outputDirectory, 'failure-frames.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  ).catch(() => undefined);
  error.message += `\nAll WebSocket diagnostics: ${JSON.stringify(diagnostics)}`;
  throw error;
} finally {
  await Promise.all(players.map((player) => player.context.close().catch(() => undefined)));
  await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)));
  await cleanupVehicleFixture(fixture);
}
