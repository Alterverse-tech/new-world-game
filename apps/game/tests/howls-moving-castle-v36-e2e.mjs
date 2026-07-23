import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(testDirectory);
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
const timeoutScale = Number(process.env.WHITEROOM_E2E_TIMEOUT_SCALE ?? (manualClock ? 1 : 3));
const platformBaseUrl = (
  process.env.WHITEROOM_PLATFORM_URL
  ?? (localGameHost ? 'http://127.0.0.1:8787' : parsedBaseUrl.origin)
).replace(/\/$/, '');
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT ?? 'test-results/howls-moving-castle-v36',
);
const channel = process.env.WHITEROOM_E2E_CHANNEL ?? `97${String(Date.now()).slice(-8)}`;
const viewport = { width: 1440, height: 900 };
const catalogId = 'code-howls-moving-castle';
const fixtureClientId = `howls-v36-e2e-${channel}`;
const requiredVehicleFeature = 'vehicle-lease-v1';
const placement = Object.freeze({
  position: { x: 0, y: 0, z: -2.5 },
  rotationY: 0,
  scale: 1,
});
const terminalCollider = Object.freeze({
  min: { x: -1.21, y: 0, z: -8.05 },
  max: { x: 1.21, y: 3.95, z: -6.79 },
});
const visualThresholds = Object.freeze({
  top: 0.025,
  left: 0.025,
  right: 0.025,
  bottom: 0.075,
  centerMinimum: 0.16,
  minimumCameraDistance: 5.25,
});

assert.match(channel, /^\d{4,12}$/, 'WHITEROOM_E2E_CHANNEL must be 4-12 digits');
assert.ok(
  Number.isFinite(timeoutScale) && timeoutScale > 0,
  'WHITEROOM_E2E_TIMEOUT_SCALE must be a positive finite number',
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
      // Intentionally omit cameraDistance. This is a fresh, unzoomed profile.
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
    // Do not run the simulation faster than wall clock. The production server
    // accepts at most 15 vehicle states/s and leases expire without heartbeats.
    await Promise.all(pages.map((page) => page.waitForTimeout(slice + 25)));
    remaining -= slice;
  }
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

async function createCastleFixture() {
  const initialState = await platformRequest(`/api/lobby/state?channel=${encodeURIComponent(channel)}`);
  assert.equal(initialState.response.status, 200, JSON.stringify(initialState.payload));
  assert.deepEqual(initialState.payload?.objects, [], 'the isolated fixture channel must start empty');

  const catalogResponse = await platformRequest('/api/lobby/catalog');
  assert.equal(catalogResponse.response.status, 200, JSON.stringify(catalogResponse.payload));
  const catalogItem = catalogResponse.payload?.items?.find((item) => item.id === catalogId);
  assert.ok(catalogItem, `${catalogId} is missing from the formal catalog`);
  assert.equal(catalogItem.kind, 'code');
  assert.equal(catalogItem.code, 'howls-moving-castle');
  assert.equal(catalogItem.vehicle?.kind, 'car');

  const identity = await platformRequest('/api/lobby/identity');
  assert.equal(identity.response.status, 200, JSON.stringify(identity.payload));
  const cookie = identity.response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie, 'platform identity did not set an owner cookie');

  const created = await platformRequest(
    `/api/lobby/objects?channel=${encodeURIComponent(channel)}`,
    'POST',
    { clientId: fixtureClientId, catalogId, ...placement },
    cookie,
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload?.object?.catalogId, catalogId);
  return {
    cookie,
    catalogItem,
    object: created.payload.object,
    deleted: false,
  };
}

async function cleanupCastleFixture(fixture) {
  if (!fixture?.object?.id || fixture.deleted) return;
  let latest;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    latest = await platformRequest(
      `/api/lobby/objects/${encodeURIComponent(fixture.object.id)}?channel=${encodeURIComponent(channel)}`,
      'DELETE',
      { clientId: fixtureClientId },
      fixture.cookie,
    ).catch(() => null);
    if (latest && [200, 404].includes(latest.response.status)) {
      fixture.deleted = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`fixture deletion failed: ${JSON.stringify(latest?.payload ?? latest)}`);
}

async function verifyExactCleanup() {
  const finalState = await platformRequest(`/api/lobby/state?channel=${encodeURIComponent(channel)}`);
  assert.equal(finalState.response.status, 200, JSON.stringify(finalState.payload));
  assert.deepEqual(finalState.payload?.objects, [], 'fixture cleanup must leave the isolated channel exactly empty');
  return finalState.payload.objects;
}

function observe(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('crash', () => errors.push(`${label} page crashed`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const source = location.url
      ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
      : '';
    errors.push(`${label} console: ${message.text()}${source}`);
  });
}

function recordVehicleFrame(frames, direction, payload) {
  if (typeof payload !== 'string') return;
  try {
    const message = JSON.parse(payload);
    if (
      message.type?.startsWith('vehicle_')
      || (message.type === 'error' && message.code?.startsWith('vehicle_'))
      || message.type === 'welcome'
      || message.type === 'channel_snapshot'
    ) {
      frames.push({
        direction,
        type: message.type,
        code: message.code ?? null,
        features: Array.isArray(message.features) ? message.features : null,
        objectId: message.objectId ?? message.vehicle?.objectId ?? null,
      });
    }
  } catch {
    // Ignore non-JSON and unrelated websocket traffic.
  }
}

async function createPlayer(browser, name, errors) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((save) => {
    localStorage.clear();
    localStorage.setItem('wr.save.v1', JSON.stringify(save));
    window.__wrV36WheelEvents = 0;
    window.addEventListener('wheel', () => { window.__wrV36WheelEvents += 1; }, { capture: true });
  }, saveFor(name));
  const page = await context.newPage();
  page.setDefaultTimeout(scaledTimeout(30_000));
  page.setDefaultNavigationTimeout(scaledTimeout(60_000));
  const vehicleFrames = [];
  observe(page, name, errors);
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/api/lobby/multiplayer') return;
    socket.on('framesent', ({ payload }) => recordVehicleFrame(vehicleFrames, 'sent', payload));
    socket.on('framereceived', ({ payload }) => recordVehicleFrame(vehicleFrames, 'received', payload));
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  if (manualClock) {
    await page.waitForFunction(() => typeof window.advanceTime === 'function');
    await page.evaluate(() => window.advanceTime(0));
  }
  return { name, context, page, vehicleFrames };
}

async function enterChannel(player) {
  await player.page.locator('#lobby-channel-input').fill(channel);
  await player.page.locator('#lobby-channel-input').press('Enter');
  return advanceUntil(
    [player.page],
    player.page,
    (state) => state.state === 'HUB'
      && state.lobbyChannel.selected === channel
      && state.multiplayer.connected
      && state.multiplayer.resources.vehicleLeaseSupported,
    `${player.name} enters a ${requiredVehicleFeature} channel`,
    30_000,
  );
}

function castleObject(state) {
  return state.lobbyEditor.objects.find((object) => object.catalogId === catalogId);
}

function signedAngleDeltaDegrees(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function vectorDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function parseTuple(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `could not read ${property} from the reviewed castle module`);
  const values = match[1].split(',').map((value) => Number(value.trim()));
  assert.equal(values.length, 3, `${property} must contain three numbers`);
  assert.ok(values.every(Number.isFinite), `${property} must contain finite numbers`);
  return values;
}

function worldAnchor(position, yawDegrees, localAnchor) {
  const yaw = yawDegrees * Math.PI / 180;
  const [localX, localY, localZ] = localAnchor;
  return {
    x: position.x + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
    y: position.y + localY,
    z: position.z - localX * Math.sin(yaw) + localZ * Math.cos(yaw),
  };
}

async function analyzeScreenshot(page, buffer) {
  return page.evaluate(async ({ src, expectedWidth, expectedHeight }) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (image.width !== expectedWidth || image.height !== expectedHeight) {
      throw new Error(`unexpected screenshot dimensions ${image.width}x${image.height}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D image analysis context is unavailable');
    context.drawImage(image, 0, 0);
    const regions = {
      top: { x: 180, y: 0, width: 1080, height: 18 },
      left: { x: 0, y: 160, width: 18, height: 650 },
      right: { x: 1422, y: 160, width: 18, height: 650 },
      bottom: { x: 180, y: 882, width: 1080, height: 18 },
      center: { x: 300, y: 150, width: 840, height: 650 },
    };
    const score = (region) => {
      const pixels = context.getImageData(region.x, region.y, region.width, region.height).data;
      let foreground = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        if (alpha >= 230 && (luminance < 105 || (chroma > 55 && luminance < 180))) foreground += 1;
      }
      return Number((foreground / (pixels.length / 4)).toFixed(5));
    };
    return Object.fromEntries(Object.entries(regions).map(([name, region]) => [name, score(region)]));
  }, {
    src: `data:image/png;base64,${buffer.toString('base64')}`,
    expectedWidth: viewport.width,
    expectedHeight: viewport.height,
  });
}

async function captureStableDefaultCamera(pages, driver, cameraAnchor) {
  let previous;
  let stableSamples = 0;
  let stableState;
  const startedAt = Date.now();
  while (Date.now() - startedAt < scaledTimeout(12_000)) {
    await stepPages(pages, 120);
    const current = await readState(driver.page);
    if (current.vehicle.phase !== 'driving') continue;
    const sample = {
      camera: current.camera.position,
      vehicle: current.vehicle.position,
      facingYawDeg: current.player.facingYawDeg,
    };
    if (
      previous
      && vectorDistance(previous.camera, sample.camera) <= 0.015
      && vectorDistance(previous.vehicle, sample.vehicle) <= 0.015
      && Math.abs(signedAngleDeltaDegrees(previous.facingYawDeg, sample.facingYawDeg)) <= 0.05
    ) {
      stableSamples += 1;
    } else {
      stableSamples = 0;
    }
    previous = sample;
    stableState = current;
    if (stableSamples >= 2) break;
  }
  assert.ok(stableSamples >= 2, `vehicle camera did not settle: ${JSON.stringify(stableState?.camera)}`);

  const requestedDistanceBefore = stableState.camera.requestedDistance;
  const frames = [];
  for (let index = 0; index < 3; index += 1) {
    const filename = `default-third-person-${index + 1}.png`;
    const buffer = await driver.page.screenshot({
      path: path.join(outputDirectory, filename),
      animations: 'disabled',
    });
    const analysis = await analyzeScreenshot(driver.page, buffer);
    frames.push({ filename, analysis });
    await stepPages(pages, 140);
  }
  const after = await readState(driver.page);
  const wheelEvents = await driver.page.evaluate(() => window.__wrV36WheelEvents ?? -1);
  const anchor = worldAnchor(after.vehicle.position, after.player.facingYawDeg, cameraAnchor);
  const cameraDistance = vectorDistance(after.camera.position, anchor);

  assert.equal(wheelEvents, 0, 'the default-camera acceptance path must not dispatch wheel input');
  assert.equal(
    after.camera.requestedDistance,
    requestedDistanceBefore,
    'the default camera distance must remain unchanged without wheel input',
  );
  assert.equal(after.camera.targetKind, 'vehicle');
  assert.ok(Math.abs(after.camera.vehicleAnchorNdc?.x ?? 99) <= 0.03, JSON.stringify(after.camera));
  assert.ok(Math.abs(after.camera.vehicleAnchorNdc?.y ?? 99) <= 0.03, JSON.stringify(after.camera));
  for (const frame of frames) {
    assert.ok(frame.analysis.top <= visualThresholds.top, `${frame.filename} clips at top: ${JSON.stringify(frame.analysis)}`);
    assert.ok(frame.analysis.left <= visualThresholds.left, `${frame.filename} clips at left: ${JSON.stringify(frame.analysis)}`);
    assert.ok(frame.analysis.right <= visualThresholds.right, `${frame.filename} clips at right: ${JSON.stringify(frame.analysis)}`);
    assert.ok(frame.analysis.bottom <= visualThresholds.bottom, `${frame.filename} clips at bottom: ${JSON.stringify(frame.analysis)}`);
    assert.ok(
      frame.analysis.center >= visualThresholds.centerMinimum,
      `${frame.filename} does not contain the centered castle: ${JSON.stringify(frame.analysis)}`,
    );
  }
  assert.ok(
    cameraDistance >= visualThresholds.minimumCameraDistance,
    `effective unzoomed vehicle camera distance ${cameraDistance.toFixed(3)} is too close: ${JSON.stringify(frames)}`,
  );
  return {
    requestedDistance: requestedDistanceBefore,
    effectiveDistance: Number(cameraDistance.toFixed(3)),
    wheelEvents,
    frames,
    strategy: [
      'fixed 1440x900 viewport and DPR 1',
      'fresh third-person save with no persisted camera distance',
      'reduced motion and settled pose/camera samples',
      'three temporally separated frames instead of a single animation frame',
      'coarse edge-occupancy thresholds instead of GPU-sensitive golden pixels',
      'center occupancy prevents a blank frame from passing',
    ],
  };
}

function negotiatedLeaseFeature(player) {
  return player.vehicleFrames.some((frame) => (
    frame.direction === 'received'
    && ['welcome', 'channel_snapshot'].includes(frame.type)
    && frame.features?.includes(requiredVehicleFeature)
  ));
}

const moduleSource = await readFile(
  path.join(projectDirectory, 'src/lobby-props/generated/howls-moving-castle.ts'),
  'utf8',
);
const cameraAnchor = parseTuple(moduleSource, 'cameraAnchor');
const collisionHalfExtents = parseTuple(moduleSource, 'collisionHalfExtents');
const initialTerminalPenetration = placement.position.z - collisionHalfExtents[2] - terminalCollider.max.z;
assert.ok(
  initialTerminalPenetration < 0,
  `fixture must start overlapped with the terminal collider: ${initialTerminalPenetration}`,
);

let fixture;
let mainReport;
let mainError;
let cleanupError;
let finalChannelObjects = null;
const browsers = [];
const players = [];
const errors = [];

try {
  fixture = await createCastleFixture();
  const castle = fixture.object;
  const launchOptions = {
    headless: process.env.HEADED !== '1',
    args: process.env.WHITEROOM_E2E_WEBGL === 'default'
      ? []
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
  const aliceBrowser = await chromium.launch(launchOptions);
  const bobBrowser = await chromium.launch(launchOptions);
  browsers.push(aliceBrowser, bobBrowser);
  const alice = await createPlayer(aliceBrowser, 'V36 Castle Alice', errors);
  const bob = await createPlayer(bobBrowser, 'V36 Castle Bob', errors);
  players.push(alice, bob);

  await Promise.all([enterChannel(alice), enterChannel(bob)]);
  await Promise.all([
    advanceUntil([alice.page, bob.page], alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice'),
  ]);

  for (const player of players) {
    const ready = await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => castleObject(state)?.id === castle.id
        && castleObject(state)?.drivable,
      `${player.name} sees the overlapped castle`,
      20_000,
    );
    assert.equal(castleObject(ready).z, placement.position.z);
    assert.ok(negotiatedLeaseFeature(player), `${player.name} did not negotiate ${requiredVehicleFeature}`);
  }

  // The collision-overlap fixture is deliberately farther from the normal
  // spawn than the catalog's root-based enter radius. Walk both fresh players
  // toward it identically, then stop as soon as both prompts are available.
  await Promise.all(players.map((player) => player.page.keyboard.down('KeyW')));
  let promptStates;
  try {
    const promptStartedAt = Date.now();
    while (Date.now() - promptStartedAt < scaledTimeout(8_000)) {
      await stepPages([alice.page, bob.page], 100);
      promptStates = await Promise.all(players.map((player) => readState(player.page)));
      if (promptStates.every((state) => state.nearbyInteraction === `驾驶 ${fixture.catalogItem.name}`)) break;
    }
  } finally {
    await Promise.all(players.map((player) => player.page.keyboard.up('KeyW')));
  }
  assert.ok(
    promptStates?.every((state) => state.nearbyInteraction === `驾驶 ${fixture.catalogItem.name}`),
    `both players must reach the drive prompt: ${JSON.stringify(promptStates)}`,
  );

  await Promise.all([alice.page.keyboard.press('KeyE'), bob.page.keyboard.press('KeyE')]);
  let aliceRace;
  let bobRace;
  const raceStartedAt = Date.now();
  while (Date.now() - raceStartedAt < scaledTimeout(8_000)) {
    await stepPages([alice.page, bob.page], 100);
    [aliceRace, bobRace] = await Promise.all([readState(alice.page), readState(bob.page)]);
    if (
      Number(aliceRace.vehicle.active) + Number(bobRace.vehicle.active) === 1
      && !aliceRace.vehicle.pendingObjectId
      && !bobRace.vehicle.pendingObjectId
    ) break;
  }
  assert.equal(
    Number(aliceRace.vehicle.active) + Number(bobRace.vehicle.active),
    1,
    `exactly one independent browser must win the lease: ${JSON.stringify({ aliceRace, bobRace })}`,
  );
  const driver = aliceRace.vehicle.active ? alice : bob;
  const observer = driver === alice ? bob : alice;
  const leaseLoser = driver === alice ? bobRace : aliceRace;
  assert.equal(leaseLoser.vehicle.active, false);
  await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    () => observer.vehicleFrames.some((frame) => frame.type === 'error' && frame.code === 'vehicle_busy'),
    'the lease loser receives vehicle_busy',
    5_000,
  );

  let driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.objectId === castle.id
      && state.vehicle.phase === 'driving'
      && state.input.controlTarget === 'vehicle',
    'the lease winner reaches driving',
    12_000,
  );
  const start = structuredClone(driving.vehicle);
  const cameraAcceptance = await captureStableDefaultCamera(
    [alice.page, bob.page],
    driver,
    cameraAnchor,
  );

  // The fixture starts 0.11 m inside the terminal collision box. S points
  // toward the terminal and must not increase penetration.
  await driver.page.keyboard.down('KeyS');
  await stepPages([alice.page, bob.page], 1_100);
  await driver.page.keyboard.up('KeyS');
  const blockedReverse = await readState(driver.page);
  assert.ok(blockedReverse.vehicle.throttle <= -0.7, JSON.stringify(blockedReverse.vehicle));
  assert.ok(
    blockedReverse.vehicle.position.z >= start.position.z - 0.035,
    `S moved deeper into the terminal: ${JSON.stringify({ start: start.position, blocked: blockedReverse.vehicle.position })}`,
  );

  // W moves away from the terminal. The depenetration rule must allow every
  // step that reduces the existing overlap until the castle is fully free.
  await driver.page.keyboard.down('KeyW');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.position.z > start.position.z + 0.85
      && state.vehicle.speedKph >= 5,
    'W escapes the initial overlap and moves forward',
    25_000,
  );
  const escapedForward = structuredClone(driving.vehicle);
  await driver.page.keyboard.up('KeyW');
  await driver.page.keyboard.down('Space');
  await stepPages([alice.page, bob.page], 900);
  await driver.page.keyboard.up('Space');

  // Once clear of the terminal, S is a real reverse control rather than a
  // permanently blocked input.
  const beforeReverse = (await readState(driver.page)).vehicle.position.z;
  await driver.page.keyboard.down('KeyS');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.throttle < -0.7
      && state.vehicle.position.z < beforeReverse - 0.22,
    'S reverses after the castle has escaped',
    20_000,
  );
  const reversed = structuredClone(driving.vehicle);
  await driver.page.keyboard.up('KeyS');
  await driver.page.keyboard.down('Space');
  await stepPages([alice.page, bob.page], 800);
  await driver.page.keyboard.up('Space');

  // A and D are each exercised while moving so both steering directions must
  // produce a measurable world-space turn, not only a UI input value.
  let turnStart = await readState(driver.page);
  await driver.page.keyboard.down('KeyW');
  await driver.page.keyboard.down('KeyA');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.steering < -0.2
      && Math.abs(signedAngleDeltaDegrees(turnStart.player.facingYawDeg, state.player.facingYawDeg)) > 0.7
      && Math.abs(state.vehicle.position.x - turnStart.vehicle.position.x) > 0.01,
    'A changes heading and lateral position',
    25_000,
  );
  const leftTurn = {
    position: structuredClone(driving.vehicle.position),
    facingYawDeg: driving.player.facingYawDeg,
  };
  await driver.page.keyboard.up('KeyA');
  await driver.page.keyboard.down('KeyD');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.steering > 0.2
      && signedAngleDeltaDegrees(leftTurn.facingYawDeg, state.player.facingYawDeg) > 0.7
      && Math.abs(state.vehicle.position.x - leftTurn.position.x) > 0.01,
    'D reverses steering direction and changes world position',
    25_000,
  );
  const rightTurn = {
    position: structuredClone(driving.vehicle.position),
    facingYawDeg: driving.player.facingYawDeg,
  };
  await driver.page.keyboard.up('KeyD');
  await driver.page.keyboard.up('KeyW');

  await driver.page.keyboard.down('Space');
  await driver.page.keyboard.down('KeyS');
  const stopped = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.speedKph <= 2.2 && state.vehicle.exitAllowed,
    'the castle stops for a safe exit',
    20_000,
  );
  await driver.page.keyboard.up('KeyS');
  await driver.page.keyboard.up('Space');
  await driver.page.keyboard.press('KeyE');
  await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => !state.vehicle.active && state.input.controlTarget === 'player',
    'the driver releases the lease',
    12_000,
  );
  await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => castleObject(state)?.occupiedBy === null,
    'the observer sees the released lease',
    12_000,
  );

  assert.deepEqual(errors, [], errors.join('\n'));
  mainReport = {
    ok: true,
    channel,
    baseUrl,
    platformBaseUrl,
    clock: manualClock ? 'manual' : 'realtime',
    scope: { desktop: true, mobile: false },
    objectId: castle.id,
    overlap: {
      placement,
      terminalCollider,
      collisionHalfExtents,
      initialPenetrationMeters: Number((-initialTerminalPenetration).toFixed(3)),
      blockedDeeperPosition: blockedReverse.vehicle.position,
      escapedPosition: escapedForward.position,
    },
    camera: cameraAcceptance,
    lease: {
      winner: driver.name,
      loser: observer.name,
      loserReceived: 'vehicle_busy',
      independentBrowserProcesses: 2,
    },
    controls: {
      W: { from: start.position, to: escapedForward.position },
      S: { fromZ: beforeReverse, to: reversed.position },
      A: leftTurn,
      D: rightTurn,
      stoppedSpeedKph: stopped.vehicle.speedKph,
    },
    browserErrors: errors,
    checks: [
      'unzoomed third-person camera contains the whole centered castle in three stable frames',
      'S cannot move the initially overlapped castle deeper into the fixed terminal',
      'W reduces the overlap, escapes it, and continues into open space',
      'S reverses after escape; A and D each change heading and world position',
      'two independent Chromium processes produce one lease winner and vehicle_busy for the loser',
      'console, page, and crash errors remain zero',
      'exact fixture cleanup is verified after browser shutdown',
    ],
  };
} catch (error) {
  mainError = error;
} finally {
  for (const player of players) {
    await player.page.keyboard.up('KeyW').catch(() => undefined);
    await player.page.keyboard.up('KeyS').catch(() => undefined);
    await player.page.keyboard.up('KeyA').catch(() => undefined);
    await player.page.keyboard.up('KeyD').catch(() => undefined);
    await player.page.keyboard.up('Space').catch(() => undefined);
  }
  await Promise.all(players.map((player) => player.context.close().catch(() => undefined)));
  await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)));
  try {
    await cleanupCastleFixture(fixture);
    finalChannelObjects = await verifyExactCleanup();
  } catch (error) {
    cleanupError = error;
  }
}

const finalReport = mainError || cleanupError
  ? {
      ok: false,
      channel,
      baseUrl,
      platformBaseUrl,
      clock: manualClock ? 'manual' : 'realtime',
      scope: { desktop: true, mobile: false },
      error: mainError instanceof Error ? mainError.stack ?? mainError.message : String(mainError ?? ''),
      cleanupError: cleanupError instanceof Error ? cleanupError.stack ?? cleanupError.message : cleanupError ?? null,
      cleanup: { channelObjects: finalChannelObjects },
      browserErrors: errors,
      players: players.map((player) => ({ name: player.name, frames: player.vehicleFrames.slice(-80) })),
    }
  : {
      ...mainReport,
      cleanup: { exact: true, channelObjects: finalChannelObjects },
    };

await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(finalReport, null, 2)}\n`);
if (mainError) throw mainError;
if (cleanupError) throw cleanupError;
console.log(JSON.stringify(finalReport, null, 2));
