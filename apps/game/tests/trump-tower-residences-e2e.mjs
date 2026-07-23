/* global process, URL, window, localStorage, location, fetch, document, HTMLButtonElement */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightEntry = process.env.PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightEntry).href);

const baseUrl = new URL(process.env.WHITEROOM_E2E_URL ?? 'http://127.0.0.1:15183/');
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT ?? '../trump-tower-e2e-results',
);
const channel = process.env.WHITEROOM_E2E_CHANNEL ?? `77${String(Date.now()).slice(-10)}`;
const catalogId = 'code-trump-tower-residences';
const towerPosition = { x: 0, y: 0, z: -3.2 };
const viewport = { width: 1440, height: 900 };
const expectedDestinations = [
  { sequence: 1, floor: '35F', position: { x: 0, y: 0.02, z: -3.02 }, file: '02-35f-manhattan-view.png' },
  { sequence: 2, floor: '52F', position: { x: 0, y: 2.72, z: -2.55 }, file: '03-52f-sunset-view.png' },
  { sequence: 3, floor: 'PH', position: { x: 0, y: 5.32, z: -2.55 }, file: '04-penthouse-night-view.png' },
  { sequence: 4, floor: 'Lobby', position: { x: 0, y: 0.02, z: -1.7 }, file: null },
];
const contexts = [];
const errors = [];
let browser;
let alice;
let bob;
let createdObject = null;

assert.match(channel, /^\d{4,12}$/, 'E2E channel must be 4-12 digits');
assert.notEqual(channel, '0000', 'Never run this test in production channel 0000');
await mkdir(outputDirectory, { recursive: true });

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
      lobbyView: 'first',
      lang: 'zh-CN',
    },
    history: [],
    stats: { totalCompleted: 0, totalDives: 0 },
    recent: [],
  };
}

function objectFrom(state, id) {
  return state.lobbyEditor.objects.find((object) => object.id === id);
}

function originMatches(state) {
  return state.state === 'HUB'
    && state.lobbyChannel?.selected === channel
    && state.lobbyEditor?.channel === channel
    && state.lobbyEditor?.environment?.kind === 'lobby'
    && state.multiplayer?.connected;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

async function readState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function writeJson(fileName, value) {
  await writeFile(path.join(outputDirectory, fileName), `${JSON.stringify(value, null, 2)}\n`);
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

async function screenshot(page, fileName) {
  await page.bringToFront();
  await page.evaluate(() => window.advanceTime(0));
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(outputDirectory, fileName) });
}

function observe(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
}

async function createPlayer(name) {
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
  return waitForState(player.page, originMatches, `${player.name} enters lobby ${channel}`);
}

async function enterEditor(player) {
  const current = await readState(player.page);
  if (current.state === 'HUB_EDIT') return current;
  await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB_EDIT'
      && state.lobbyEditor.enabled
      && state.lobbyEditor.channel === channel,
    `${player.name} opens decoration`,
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

async function addTower(player) {
  const selector = `[data-add-catalog-id="${catalogId}"]`;
  await player.page.waitForFunction((targetSelector) => {
    const button = document.querySelector(targetSelector);
    return button instanceof HTMLButtonElement && !button.disabled;
  }, selector);
  const responsePromise = player.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/lobby/objects'
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'POST';
  });
  await player.page.locator(selector).evaluate((button) => button.click());
  const response = await responsePromise;
  assert.equal(response.status(), 201, `tower create HTTP ${response.status()}`);
  const payload = await response.json();
  const requestBody = response.request().postDataJSON();
  assert.ok(payload.object?.id, 'tower creation must return an id');
  return {
    id: payload.object.id,
    clientId: requestBody.clientId,
    channel,
  };
}

async function patchTower(page, object) {
  return page.evaluate(async ({ target, position }) => {
    const url = new URL(`/api/lobby/objects/${encodeURIComponent(target.id)}`, location.origin);
    url.searchParams.set('channel', target.channel);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        clientId: target.clientId,
        position,
        rotationY: 0,
        scale: 1,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { target: object, position: towerPosition });
}

async function deleteTower(page, object) {
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

async function moveTowardZ(player, peers, targetZ) {
  const pages = [player.page, ...peers];
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = await readState(player.page);
    const delta = targetZ - state.player.position.z;
    if (Math.abs(delta) <= 0.09) return state;
    const key = delta > 0 ? 'KeyS' : 'KeyW';
    await player.page.keyboard.down(key);
    await stepPages(pages, 60);
    await player.page.keyboard.up(key);
    await stepPages(pages, 35);
  }
  throw new Error(`Unable to move ${player.name} to Z=${targetZ}: ${JSON.stringify(await readState(player.page))}`);
}

async function useElevator(destination, bobOrigin) {
  const ready = await waitForState(
    alice.page,
    (state) => state.nearbyInteraction?.includes('电梯')
      && state.availableActions.includes('E 交互'),
    `Alice can call the elevator for ${destination.floor}`,
  );
  assert.equal(objectFrom(ready, createdObject.id).interactionSequence, destination.sequence - 1);

  const responsePromise = alice.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lobby/objects/${createdObject.id}/interactions`
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'POST';
  });
  await alice.page.keyboard.press('KeyE');
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${destination.floor} interaction HTTP ${response.status()}`);
  await stepPages([alice.page, bob.page], 260);

  const aliceState = await waitForState(
    alice.page,
    (state) => objectFrom(state, createdObject.id)?.interactionSequence === destination.sequence
      && objectFrom(state, createdObject.id)?.interactionState === `floor:${destination.floor.toLowerCase()}`
      && distance(state.player.position, destination.position) < 0.16,
    `Alice arrives at ${destination.floor}`,
  );
  const bobState = await waitForState(
    bob.page,
    (state) => objectFrom(state, createdObject.id)?.interactionSequence === destination.sequence,
    `Bob receives shared ${destination.floor} elevator state`,
  );
  assert.ok(distance(bobState.player.position, bobOrigin) < 0.12, 'remote interaction must not teleport Bob');
  if (destination.file) await screenshot(alice.page, destination.file);
  await writeJson(`state-${destination.sequence}-${destination.floor.toLowerCase()}.json`, {
    alice: aliceState,
    bob: bobState,
  });

  await stepPages([alice.page, bob.page], 1_050);
  return { aliceState, bobState };
}

browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

let report;
try {
  [alice, bob] = await Promise.all([createPlayer('Tower Alice'), createPlayer('Tower Bob')]);
  await Promise.all([enterOrigin(alice), enterOrigin(bob)]);
  await Promise.all([
    waitForState(alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice'),
  ]);

  const baseline = await readState(alice.page);
  const terminal = baseline.lobbyEditor.objects.find((object) => object.system);
  assert.ok(terminal, 'the fixed lobby terminal must exist');
  assert.equal(terminal.canEdit, false);
  assert.equal(terminal.canDelete, false);

  await enterEditor(alice);
  createdObject = await addTower(alice);
  const patched = await patchTower(alice.page, createdObject);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  await Promise.all([
    waitForState(alice.page, (state) => {
      const object = objectFrom(state, createdObject.id);
      return object?.catalogId === catalogId
        && object.x === towerPosition.x
        && object.z === towerPosition.z
        && object.physicsKind === 'fixed';
    }, 'Alice sees positioned tower'),
    waitForState(bob.page, (state) => {
      const object = objectFrom(state, createdObject.id);
      return object?.catalogId === catalogId
        && object.x === towerPosition.x
        && object.z === towerPosition.z
        && object.interactionState === 'floor:lobby';
    }, 'Bob receives positioned tower'),
  ]);
  await exitEditor(alice);

  const exterior = await waitForState(alice.page, originMatches, 'Alice returns to walking mode');
  const tower = objectFrom(exterior, createdObject.id);
  assert.equal(tower.interactive, true);
  assert.equal(tower.physicsKind, 'fixed');
  assert.equal(tower.canEdit, true);
  assert.equal(tower.canDelete, true);
  await moveTowardZ(alice, [bob.page], 8);
  await screenshot(alice.page, '00-trump-tower-exterior.png');

  await moveTowardZ(alice, [bob.page], -1.1);
  const lobbyState = await waitForState(
    alice.page,
    (state) => state.nearbyInteraction?.includes('当前 Lobby')
      && state.nearbyInteraction.includes('35F')
      && state.availableActions.includes('E 交互'),
    'Alice enters the lobby and sees the floor selector',
  );
  await screenshot(alice.page, '01-gold-lobby-elevator.png');
  await writeJson('state-lobby-entry.json', lobbyState);

  const bobOrigin = { ...(await readState(bob.page)).player.position };
  const floorResults = [];
  for (const destination of expectedDestinations) {
    floorResults.push(await useElevator(destination, bobOrigin));
  }

  const finalAlice = floorResults.at(-1).aliceState;
  const finalBob = floorResults.at(-1).bobState;
  assert.equal(objectFrom(finalAlice, createdObject.id).interactionState, 'floor:lobby');
  assert.equal(objectFrom(finalBob, createdObject.id).interactionState, 'floor:lobby');

  report = {
    ok: true,
    channel,
    catalogId,
    objectId: createdObject.id,
    terminalProtected: true,
    multiplayerOnline: finalAlice.multiplayer.online,
    remotePlayerStayedPut: distance(finalBob.player.position, bobOrigin) < 0.12,
    visitedFloors: expectedDestinations.map(({ floor }) => floor),
    screenshots: [
      '00-trump-tower-exterior.png',
      '01-gold-lobby-elevator.png',
      ...expectedDestinations.filter(({ file }) => file).map(({ file }) => file),
    ],
    errors,
  };
  assert.deepEqual(errors, []);
  await writeJson('report.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (createdObject && alice?.page && !alice.page.isClosed()) {
    try {
      await deleteTower(alice.page, createdObject);
    } catch {
      // The test uses an isolated local channel and data directory; cleanup is best effort.
    }
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close();
}
