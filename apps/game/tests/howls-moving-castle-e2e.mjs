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
const platformBaseUrl = (
  process.env.WHITEROOM_PLATFORM_URL
  ?? (localGameHost ? 'http://127.0.0.1:8787' : parsedBaseUrl.origin)
).replace(/\/$/, '');
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT ?? 'test-results/howls-moving-castle',
);
const captureScreenshots = process.env.WHITEROOM_E2E_SKIP_SCREENSHOTS !== '1';
const channel = process.env.WHITEROOM_E2E_CHANNEL
  ?? `96${String(Date.now()).slice(-8)}`;
const viewport = { width: 1440, height: 900 };
const catalogId = 'code-howls-moving-castle';
const fixtureClientId = `howls-e2e-${channel}`;
const requiredVehicleFeature = 'vehicle-lease-v1';

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
    // The v33 game test hook accepts one argument. Keep manual simulation at
    // or below wall-clock speed so the v24 vehicle rate limits stay realistic.
    await Promise.all(pages.map((page) => page.evaluate((ms) => window.advanceTime(ms), slice)));
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

async function screenshotWithDriverHeartbeat(observerPage, driverPage, outputPath) {
  if (!captureScreenshots) return;
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
    await driverPage.waitForTimeout(125);
  }
  await screenshot;
  if (screenshotError) throw screenshotError;
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
  const catalogResponse = await platformRequest('/api/lobby/catalog');
  assert.equal(catalogResponse.response.status, 200, JSON.stringify(catalogResponse.payload));
  const catalogItem = catalogResponse.payload?.items?.find((item) => item.id === catalogId);
  assert.ok(catalogItem, `${catalogId} is missing from the formal catalog`);
  assert.equal(catalogItem.name, '哈尔的移动城堡');
  assert.equal(catalogItem.kind, 'code');
  assert.equal(catalogItem.code, 'howls-moving-castle');
  assert.equal(catalogItem.vehicle?.kind, 'car');
  assert.equal(catalogItem.vehicle?.enterRadius, 6);

  const identity = await platformRequest('/api/lobby/identity');
  assert.equal(identity.response.status, 200, JSON.stringify(identity.payload));
  const cookie = identity.response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie, 'platform identity did not set an owner cookie');

  // The castle is tall, so interaction distance includes several metres of Y.
  // Place it directly ahead of spawn: the player remains just outside the
  // front hull, faces the bounds centre, and module +Z stays unobstructed.
  const placement = {
    position: { x: 0, y: 0, z: -1 },
    rotationY: 0,
    scale: 1,
  };
  const created = await platformRequest(
    `/api/lobby/objects?channel=${encodeURIComponent(channel)}`,
    'POST',
    {
      clientId: fixtureClientId,
      catalogId,
      ...placement,
    },
    cookie,
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload?.object?.catalogId, catalogId);
  return {
    cookie,
    catalogItem,
    object: created.payload.object,
    placement,
    deleted: false,
  };
}

async function cleanupCastleFixture(fixture) {
  if (!fixture?.object?.id || fixture.deleted) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await platformRequest(
      `/api/lobby/objects/${encodeURIComponent(fixture.object.id)}?channel=${encodeURIComponent(channel)}`,
      'DELETE',
      { clientId: fixtureClientId },
      fixture.cookie,
    ).catch(() => null);
    if (!result || [200, 404].includes(result.response.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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
      const vehicle = message.vehicle && typeof message.vehicle === 'object'
        ? message.vehicle
        : message.type === 'vehicle_state'
          ? message
          : null;
      frames.push({
        direction,
        type: message.type,
        code: message.code ?? null,
        channel: message.channel ?? null,
        features: Array.isArray(message.features) ? message.features : null,
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
        } : null,
      });
    }
  } catch {
    // The production client owns strict wire validation; ignore unrelated data.
  }
}

async function createPlayer(browser, name, errors) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((save) => {
    localStorage.setItem('wr.save.v1', JSON.stringify(save));
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
    socket.on('close', () => vehicleFrames.push({ direction: 'socket', type: 'closed' }));
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

function syncedCastle(state, objectId) {
  return state.multiplayer.vehicles.find((vehicle) => vehicle.objectId === objectId);
}

function signedAngleDeltaDegrees(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function negotiatedLeaseFeature(player) {
  return player.vehicleFrames.some((frame) => (
    frame.direction === 'received'
    && ['welcome', 'channel_snapshot'].includes(frame.type)
    && frame.features?.includes(requiredVehicleFeature)
  ));
}

let fixture;
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
  // Separate browser processes catch lease/session bugs hidden by shared state.
  const aliceBrowser = await chromium.launch(launchOptions);
  const bobBrowser = await chromium.launch(launchOptions);
  browsers.push(aliceBrowser, bobBrowser);

  const alice = await createPlayer(aliceBrowser, 'Castle Alice', errors);
  const bob = await createPlayer(bobBrowser, 'Castle Bob', errors);
  players.push(alice, bob);

  await Promise.all([enterChannel(alice), enterChannel(bob)]);
  await Promise.all([
    advanceUntil([alice.page, bob.page], alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice'),
  ]);
  await stepPages([alice.page, bob.page], 300);

  for (const player of players) {
    const loaded = await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => castleObject(state)?.id === castle.id
        && castleObject(state)?.drivable
        && castleObject(state)?.vehicleKind === 'car'
        && state.nearbyInteraction === `驾驶 ${fixture.catalogItem.name}`,
      `${player.name} sees the castle and its drive prompt`,
      20_000,
    );
    const object = castleObject(loaded);
    const terminal = loaded.lobbyEditor.objects.find((candidate) => candidate.id === 'system-terminal');
    assert.equal(object.name, '哈尔的移动城堡');
    assert.equal(object.catalogId, catalogId);
    assert.equal(object.vehicleKind, 'car');
    assert.equal(object.scale, 1);
    assert.ok(terminal, 'the fixed lobby terminal must remain present');
    assert.equal(terminal.system, true);
    assert.equal(terminal.locked, true);
    assert.equal(terminal.canEdit, false);
    assert.equal(terminal.canDelete, false);
    assert.ok(
      negotiatedLeaseFeature(player),
      `${player.name} must negotiate ${requiredVehicleFeature}: ${JSON.stringify(player.vehicleFrames)}`,
    );
  }
  if (captureScreenshots) {
    await alice.page.screenshot({ path: path.join(outputDirectory, 'castle-ready.png') });
  }
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
    `exactly one player may win the castle lease: ${JSON.stringify({
      alice: { vehicle: aliceRace.vehicle, frames: alice.vehicleFrames },
      bob: { vehicle: bobRace.vehicle, frames: bob.vehicleFrames },
    })}`,
  );

  const driver = aliceRace.vehicle.active ? alice : bob;
  const observer = driver === alice ? bob : alice;
  const driverRace = driver === alice ? aliceRace : bobRace;
  const observerRace = driver === alice ? bobRace : aliceRace;
  assert.equal(driverRace.vehicle.objectId, castle.id);
  assert.equal(driverRace.vehicle.catalogId, catalogId);
  assert.equal(driverRace.vehicle.kind, 'car');
  assert.equal(driverRace.input.controlTarget, 'vehicle');
  assert.equal(driverRace.player.visible, false);
  assert.equal(observerRace.vehicle.active, false);
  assert.equal(castleObject(observerRace).occupiedBy, driverRace.vehicle.driverId);
  await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    () => observer.vehicleFrames.some((frame) => (
      frame.direction === 'received'
      && frame.type === 'error'
      && frame.code === 'vehicle_busy'
    )),
    'the simultaneous-E lease loser receives vehicle_busy',
    5_000,
  );

  let driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.objectId === castle.id
      && state.vehicle.kind === 'car'
      && state.vehicle.phase === 'driving',
    'the castle entry animation reaches driving',
    12_000,
  );
  const start = structuredClone(driving.vehicle);
  const pilotId = driving.vehicle.driverId;

  const occupiedPatch = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(castle.id)}?channel=${encodeURIComponent(channel)}`,
    'PATCH',
    { clientId: fixtureClientId, scale: 1.1 },
    fixture.cookie,
  );
  assert.equal(occupiedPatch.response.status, 409, JSON.stringify(occupiedPatch.payload));
  assert.equal(occupiedPatch.payload?.error?.code, 'lobby_vehicle_in_use');
  const occupiedDelete = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(castle.id)}?channel=${encodeURIComponent(channel)}`,
    'DELETE',
    { clientId: fixtureClientId },
    fixture.cookie,
  );
  assert.equal(occupiedDelete.response.status, 409, JSON.stringify(occupiedDelete.payload));
  assert.equal(occupiedDelete.payload?.error?.code, 'lobby_vehicle_in_use');

  await driver.page.keyboard.down('KeyW');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.throttle > 0.7
      && state.vehicle.position.z > start.position.z + 0.6
      && state.vehicle.speedKph >= 6,
    'W moves the castle significantly along module +Z',
    25_000,
  );
  const forward = structuredClone(driving.vehicle);
  assert.ok(forward.position.z > start.position.z + 0.6);

  const beforeTurnYaw = driving.player.facingYawDeg;
  const beforeTurnX = driving.vehicle.position.x;
  await driver.page.keyboard.down('KeyD');
  driving = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.steering > 0.2
      && Math.abs(signedAngleDeltaDegrees(beforeTurnYaw, state.player.facingYawDeg)) > 0.5
      && Math.abs(state.vehicle.position.x - beforeTurnX) > 0.005,
    'D visibly steers the walking castle',
    25_000,
  );
  const turned = structuredClone(driving.vehicle);
  const turnedFacingYawDeg = driving.player.facingYawDeg;

  const observerDriving = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => {
      const vehicle = syncedCastle(state, castle.id);
      return vehicle?.driverId === pilotId
        && vehicle.seq >= 2
        && vehicle.z > start.position.z + 0.8
        && Math.abs(signedAngleDeltaDegrees(
          turnedFacingYawDeg,
          vehicle.yaw * 180 / Math.PI,
        )) < 12;
    },
    'the observer receives the driven position and yaw',
    15_000,
  );
  const observerPose = structuredClone(syncedCastle(observerDriving, castle.id));
  assert.equal(
    observerDriving.multiplayer.remote.find((player) => player.id === pilotId)?.visible,
    false,
    'the remote driver avatar remains hidden while seated',
  );

  await driver.page.keyboard.up('KeyD');
  await driver.page.keyboard.up('KeyW');
  await screenshotWithDriverHeartbeat(
    observer.page,
    driver.page,
    path.join(outputDirectory, 'castle-driving-synchronized.png'),
  );

  // Combine the handbrake with reverse-braking so the realtime public run
  // reaches the safe-exit threshold even when background frames are sparse.
  await driver.page.keyboard.down('Space');
  await driver.page.keyboard.down('KeyS');
  const stoppedState = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => state.vehicle.active
      && state.vehicle.speedKph <= 2.5
      && state.vehicle.exitAllowed,
    'Space stops the castle for a safe exit',
    20_000,
  );
  await driver.page.keyboard.up('KeyS');
  await driver.page.keyboard.up('Space');
  const stopped = structuredClone(stoppedState.vehicle);
  assert.equal(stopped.exitReason, 'ok');

  await driver.page.keyboard.press('KeyE');
  const exited = await advanceUntil(
    [alice.page, bob.page],
    driver.page,
    (state) => !state.vehicle.active
      && state.input.controlTarget === 'player'
      && state.player.visible
      && state.player.grounded,
    'low-speed E safely exits the castle',
    12_000,
  );
  assert.equal(exited.vehicle.persistence, 'runtime-only');

  const released = await advanceUntil(
    [alice.page, bob.page],
    observer.page,
    (state) => castleObject(state)?.occupiedBy === null
      && castleObject(state)?.canEdit === true
      && castleObject(state)?.canDelete === true
      && syncedCastle(state, castle.id)?.driverId === null,
    'the observer sees the released castle become editable and deletable',
    12_000,
  );
  const releasedPose = structuredClone(syncedCastle(released, castle.id));

  const deleted = await platformRequest(
    `/api/lobby/objects/${encodeURIComponent(castle.id)}?channel=${encodeURIComponent(channel)}`,
    'DELETE',
    { clientId: fixtureClientId },
    fixture.cookie,
  );
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.payload));
  fixture.deleted = true;

  for (const player of players) {
    await advanceUntil(
      [alice.page, bob.page],
      player.page,
      (state) => !state.lobbyEditor.objects.some((object) => object.id === castle.id)
        && !state.multiplayer.vehicles.some((vehicle) => vehicle.objectId === castle.id),
      `${player.name} removes the deleted castle from object and vehicle snapshots`,
      12_000,
    );
  }
  const finalChannelState = await platformRequest(
    `/api/lobby/state?channel=${encodeURIComponent(channel)}`,
  );
  assert.equal(finalChannelState.response.status, 200, JSON.stringify(finalChannelState.payload));
  assert.deepEqual(finalChannelState.payload?.objects, [], 'the isolated channel must be empty after deletion');
  if (captureScreenshots) {
    await observer.page.screenshot({ path: path.join(outputDirectory, 'castle-deleted.png') });
  }

  assert.deepEqual(errors, [], errors.join('\n'));
  const report = {
    ok: true,
    channel,
    baseUrl,
    platformBaseUrl,
    clock: manualClock ? 'manual' : 'realtime',
    catalog: {
      id: fixture.catalogItem.id,
      name: fixture.catalogItem.name,
      kind: fixture.catalogItem.kind,
      code: fixture.catalogItem.code,
      vehicle: fixture.catalogItem.vehicle,
    },
    objectId: castle.id,
    placement: fixture.placement,
    lease: {
      winner: driver.name,
      loser: observer.name,
      loserReceived: 'vehicle_busy',
      driverId: pilotId,
    },
    drive: {
      start: start.position,
      forward: forward.position,
      turned: turned.position,
      turnedFacingYawDeg,
      observerPose,
      stoppedSpeedKph: stopped.speedKph,
      safeExit: true,
      releasedPose,
    },
    occupiedMutations: {
      patchStatus: occupiedPatch.response.status,
      deleteStatus: occupiedDelete.response.status,
      errorCode: 'lobby_vehicle_in_use',
    },
    deletion: {
      status: deleted.response.status,
      channelObjects: finalChannelState.payload.objects,
    },
    browserErrors: errors,
    checks: [
      'formal catalog exposes the reviewed code prop as a car',
      'fixed system terminal remains locked and immutable',
      'two independent Chromium processes enter one isolated channel',
      'simultaneous E yields one lease winner and vehicle_busy for the loser',
      'entry reaches driving and hides local/remote occupied avatars',
      'W advances along module +Z and D changes heading/lateral position',
      'observer receives synchronized position and yaw',
      'occupied PATCH and DELETE return 409 lobby_vehicle_in_use',
      'Space stops the castle and low-speed E exits safely',
      'released castle becomes editable/deletable, then deletion empties the channel',
      'console, page, and crash errors remain zero',
    ],
    screenshots: captureScreenshots
      ? ['castle-ready.png', 'castle-driving-synchronized.png', 'castle-deleted.png']
      : [],
  };
  await writeFile(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const diagnostics = {
    ok: false,
    channel,
    baseUrl,
    platformBaseUrl,
    clock: manualClock ? 'manual' : 'realtime',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    browserErrors: errors,
    players: players.map((player) => ({
      name: player.name,
      frames: player.vehicleFrames.slice(-80),
    })),
  };
  await writeFile(
    path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  ).catch(() => undefined);
  throw error;
} finally {
  await Promise.all(players.map((player) => player.context.close().catch(() => undefined)));
  await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)));
  await cleanupCastleFixture(fixture);
}
