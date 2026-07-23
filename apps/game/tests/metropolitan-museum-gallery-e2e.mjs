/* global process, URL, window, localStorage, document, HTMLButtonElement, location, fetch */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';
import { createApplication } from '../../whiteroom-platform/src/server.js';
import { SupabaseAuthVerifier } from '../../whiteroom-platform/src/supabase-auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(here, '..');
const executeFile = promisify(execFile);
const playwrightEntry = process.env.PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const webGameClient = process.env.WEB_GAME_CLIENT
  ?? path.join(os.homedir(), '.codex/skills/develop-web-game/scripts/web_game_playwright_client.js');
const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const outputDirectory = path.resolve(
  process.env.WHITEROOM_E2E_OUTPUT ?? path.join(gameRoot, 'test-results/metropolitan-museum-gallery'),
);
const channel = process.env.WHITEROOM_E2E_CHANNEL ?? `82${String(Date.now()).slice(-8)}`;
const catalogId = 'code-metropolitan-museum-gallery';
const museumPosition = { x: 8, y: 0, z: 0 };
const viewport = { width: 1440, height: 900 };
const contexts = [];
const errors = [];
let browser;
let alice;
let bob;
let createdObject;

assert.match(channel, /^\d{4,12}$/);
assert.notEqual(channel, '0000', 'Never run the museum E2E in the production channel');
await mkdir(outputDirectory, { recursive: true });
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-met-museum-'));
const application = await createApplication({
  uploadToken: 'museum-e2e-creator-token-123456',
  adminToken: 'museum-e2e-admin-token-12345678',
  lobbyOwnerSecret: 'museum-e2e-owner-secret-that-is-long-enough-123456',
  supabaseAuth: new SupabaseAuthVerifier(),
  dataDirectory,
  logger: { error() {}, warn() {}, info() {} },
});
await new Promise((resolve, reject) => {
  application.server.once('error', reject);
  application.server.listen(0, '127.0.0.1', resolve);
});
const platformAddress = application.server.address();
if (!platformAddress || typeof platformAddress === 'string') throw new Error('Platform did not bind a TCP port');
const platformUrl = `http://127.0.0.1:${platformAddress.port}`;

const vite = await createViteServer({
  root: gameRoot,
  configFile: false,
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    proxy: {
      '/api': { target: platformUrl, changeOrigin: false, secure: false, ws: true },
      '/avatars': { target: platformUrl, changeOrigin: false, secure: false },
      '/lobby-assets': { target: platformUrl, changeOrigin: false, secure: false },
    },
  },
});
await vite.listen();
const gameUrl = vite.resolvedUrls?.local?.[0];
if (!gameUrl) throw new Error('Vite did not expose a local URL');

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
  await Promise.all(uniquePages.map((page) => page.evaluate((ms) => window.advanceTime(ms), milliseconds)));
  await Promise.all(uniquePages.map((page) => page.waitForTimeout(25)));
}

async function screenshot(page, fileName) {
  await page.bringToFront();
  await page.evaluate(() => window.advanceTime(0));
  await page.waitForTimeout(140);
  await page.screenshot({ path: path.join(outputDirectory, fileName) });
}

function observe(page, label) {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
}

async function createPlayer(name) {
  const context = await browser.newContext({
    viewport: name === 'Museum Bob' ? { width: 480, height: 320 } : viewport,
    deviceScaleFactor: 1,
  });
  contexts.push(context);
  await context.addInitScript((save) => {
    localStorage.setItem('wr.save.v1', JSON.stringify(save));
  }, saveFor(name));
  const page = await context.newPage();
  observe(page, name);
  await page.goto(new URL(`?channel=${channel}`, gameUrl).href, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  try {
    await page.waitForFunction(
      () => typeof window.render_game_to_text === 'function',
      null,
      { timeout: 45_000 },
    );
  } catch (error) {
    console.error('[museum-e2e] client boot diagnostics', JSON.stringify({
      url: page.url(),
      errors,
      body: await page.locator('body').innerText().catch(() => ''),
    }, null, 2));
    throw error;
  }
  return { context, page, name };
}

async function enterOrigin(player) {
  await player.page.locator('#start-btn').click();
  return waitForState(
    player.page,
    (state) => state.state === 'HUB'
      && state.lobbyChannel?.selected === channel
      && state.lobbyEditor?.channel === channel
      && state.multiplayer?.connected,
    `${player.name} enters lobby ${channel}`,
  );
}

async function enterEditor(player) {
  const current = await readState(player.page);
  if (current.state !== 'HUB_EDIT') await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB_EDIT'
      && state.lobbyEditor.enabled
      && state.lobbyEditor.identityReady
      && state.lobbyEditor.sync === 'synced',
    `${player.name} opens decoration`,
  );
}

async function exitEditor(player) {
  const current = await readState(player.page);
  if (current.state === 'HUB_EDIT') await player.page.keyboard.press('KeyB');
  return waitForState(
    player.page,
    (state) => state.state === 'HUB' && !state.lobbyEditor.enabled,
    `${player.name} exits decoration`,
  );
}

async function dragMuseum(player) {
  const card = player.page.locator(`[data-catalog-id="${catalogId}"]`);
  const canvas = player.page.locator('#game-canvas');
  await enterEditor(player);
  await card.waitFor({ state: 'attached' });
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await player.page.waitForFunction((selector) => {
    const item = document.querySelector(selector);
    const button = item?.querySelector('[data-add-catalog-id]');
    return item instanceof HTMLElement
      && item.draggable
      && button instanceof HTMLButtonElement
      && !button.disabled;
  }, `[data-catalog-id="${catalogId}"]`);
  await player.page.keyboard.down('KeyD');
  await stepPages([player.page], 850);
  await player.page.keyboard.up('KeyD');
  await stepPages([player.page], 80);
  await waitForState(
    player.page,
    (state) => state.creativeCamera?.position.x > 3,
    'creative camera moves clear of the protected spawn zone',
  );
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox, 'game canvas must have a visible bounding box');
  const lookX = canvasBox.x + canvasBox.width * 0.5;
  const lookY = canvasBox.y + canvasBox.height * 0.42;
  await player.page.mouse.move(lookX, lookY);
  await player.page.mouse.down({ button: 'right' });
  await player.page.mouse.move(lookX, lookY + 220, { steps: 12 });
  await player.page.mouse.up({ button: 'right' });
  await player.page.evaluate(() => window.advanceTime(120));
  await waitForState(
    player.page,
    (state) => state.creativeCamera?.pitchDeg < -18,
    'creative camera looks down toward a legal public drop point',
  );
  const responsePromise = player.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/lobby/objects'
      && url.searchParams.get('channel') === channel
      && response.request().method() === 'POST';
  }, { timeout: 15_000 });
  await player.page.evaluate((id) => {
    const source = document.querySelector(`[data-catalog-id="${id}"]`);
    const target = document.querySelector('#game-canvas');
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLCanvasElement)) {
      throw new Error('museum drag source or canvas target is missing');
    }
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width * 0.65;
    const clientY = rect.top + rect.height * 0.45;
    const transfer = new DataTransfer();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX,
      clientY,
    };
    source.dispatchEvent(new DragEvent('dragstart', eventOptions));
    target.dispatchEvent(new DragEvent('dragenter', eventOptions));
    target.dispatchEvent(new DragEvent('dragover', eventOptions));
    target.dispatchEvent(new DragEvent('drop', eventOptions));
    source.dispatchEvent(new DragEvent('dragend', eventOptions));
  }, catalogId);
  const response = await responsePromise;
  assert.equal(response.status(), 201, `museum drag create HTTP ${response.status()}`);
  const payload = await response.json();
  const requestBody = response.request().postDataJSON();
  assert.ok(payload.object?.id, 'dragging the museum must return a canonical object id');
  return { id: payload.object.id, clientId: requestBody.clientId, channel };
}

async function patchMuseum(page, object) {
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
  }, { target: object, position: museumPosition });
}

async function deleteMuseum(page, object) {
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

async function moveTowardX(page, peers, targetX) {
  void peers;
  for (let attempt = 0; attempt < 110; attempt += 1) {
    const state = await readState(page);
    const delta = targetX - state.player.position.x;
    if (Math.abs(delta) <= 0.1) return state;
    const key = delta > 0 ? 'KeyD' : 'KeyA';
    const burst = Math.max(20, Math.min(180, Math.abs(delta) * 100));
    await page.keyboard.down(key);
    await stepPages([page], burst);
    await page.keyboard.up(key);
    await stepPages([page], 16);
  }
  throw new Error(`Unable to move player to X=${targetX}: ${JSON.stringify(await readState(page))}`);
}

async function moveTowardZ(page, peers, targetZ) {
  void peers;
  for (let attempt = 0; attempt < 110; attempt += 1) {
    const state = await readState(page);
    const delta = targetZ - state.player.position.z;
    if (Math.abs(delta) <= 0.1) return state;
    const key = delta > 0 ? 'KeyS' : 'KeyW';
    const burst = Math.max(20, Math.min(180, Math.abs(delta) * 100));
    await page.keyboard.down(key);
    await stepPages([page], burst);
    await page.keyboard.up(key);
    await stepPages([page], 16);
  }
  throw new Error(`Unable to move player to Z=${targetZ}: ${JSON.stringify(await readState(page))}`);
}

async function runOfficialClient() {
  const officialDirectory = path.join(outputDirectory, 'official-client');
  await mkdir(officialDirectory, { recursive: true });
  return executeFile(process.execPath, [
    webGameClient,
    '--url', new URL(`?channel=${channel}`, gameUrl).href,
    '--click-selector', '#start-btn',
    '--actions-json', JSON.stringify({ steps: [
      { buttons: [], frames: 3 },
      { buttons: ['b'], frames: 2 },
      { buttons: [], frames: 5 },
    ] }),
    '--iterations', '1',
    '--pause-ms', '300',
    '--screenshot-dir', officialDirectory,
  ], { cwd: gameRoot, maxBuffer: 4 * 1024 * 1024 });
}

browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

let report;
try {
  if (process.env.SKIP_OFFICIAL_CLIENT === '1') {
    console.log('[museum-e2e] reusing the previously verified official-client artifacts');
  } else {
    const officialClient = await runOfficialClient();
    assert.equal(officialClient.stderr.includes('Error:'), false, officialClient.stderr);
    console.log('[museum-e2e] official client passed');
  }

  alice = await createPlayer('Museum Alice');
  bob = await createPlayer('Museum Bob');
  await Promise.all([enterOrigin(alice), enterOrigin(bob)]);
  await Promise.all([
    waitForState(alice.page, (state) => state.multiplayer.online === 2, 'Alice sees Bob'),
    waitForState(bob.page, (state) => state.multiplayer.online === 2, 'Bob sees Alice'),
  ]);
  console.log('[museum-e2e] two players synchronized');

  const initial = await readState(alice.page);
  const terminal = initial.lobbyEditor.objects.find((object) => object.system);
  assert.ok(terminal, 'the fixed lobby terminal must exist');
  assert.equal(terminal.canEdit, false);
  assert.equal(terminal.canDelete, false);

  await enterEditor(alice);
  const preview = alice.page.locator(`[data-preview-id="${catalogId}"]`);
  await preview.waitFor({ state: 'visible' });
  await preview.scrollIntoViewIfNeeded();
  await alice.page.evaluate(() => window.advanceTime(180));
  await alice.page.waitForFunction(
    (id) => document.querySelector(`[data-preview-id="${id}"]`)?.getAttribute('data-preview-state') === 'ready',
    catalogId,
  );
  await screenshot(alice.page, '00-catalog-and-preview.png');
  console.log('[museum-e2e] catalog preview ready');

  createdObject = await dragMuseum(alice);
  console.log('[museum-e2e] catalog drag created the museum');
  const patched = await patchMuseum(alice.page, createdObject);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const [alicePlaced, bobPlaced] = await Promise.all([
    waitForState(alice.page, (state) => {
      const object = objectFrom(state, createdObject.id);
      return object?.catalogId === catalogId
        && object.x === museumPosition.x
        && object.z === museumPosition.z
        && object.physicsKind === 'fixed';
    }, 'Alice sees the positioned museum'),
    waitForState(bob.page, (state) => {
      const object = objectFrom(state, createdObject.id);
      return object?.catalogId === catalogId
        && object.x === museumPosition.x
        && object.z === museumPosition.z
        && object.physicsKind === 'fixed';
    }, 'Bob receives the positioned museum'),
  ]);
  assert.equal(objectFrom(alicePlaced, createdObject.id).id, objectFrom(bobPlaced, createdObject.id).id);
  assert.equal(alicePlaced.lobbyEditor.objects.find((object) => object.system)?.canEdit, false);
  assert.equal(bobPlaced.lobbyEditor.objects.find((object) => object.system)?.canDelete, false);
  await exitEditor(alice);
  console.log('[museum-e2e] canonical placement synchronized');

  await moveTowardZ(alice.page, [bob.page], 9.15);
  const exterior = await moveTowardX(alice.page, [bob.page], 8);
  await screenshot(alice.page, '01-fifth-avenue-exterior.png');
  await writeJson('state-01-exterior.json', exterior);
  console.log('[museum-e2e] Fifth Avenue exterior visited');

  const entrance = await moveTowardZ(alice.page, [bob.page], 4.35);
  assert.ok(entrance.player.position.z < 4.5, 'the player must cross the open front collider gap');
  await screenshot(alice.page, '02-central-hall-entry.png');
  await writeJson('state-02-entry.json', entrance);
  console.log('[museum-e2e] central hall entered');

  const centralHall = await moveTowardZ(alice.page, [bob.page], 1.25);
  assert.ok(centralHall.player.position.z < 1.4, 'the player must walk inside the central hall');
  await screenshot(alice.page, '03-washington-central-gallery.png');
  await writeJson('state-03-central-hall.json', centralHall);
  console.log('[museum-e2e] central gallery visited');

  await moveTowardZ(alice.page, [bob.page], 1.7);
  const leftGallery = await moveTowardX(alice.page, [bob.page], 4.65);
  assert.ok(leftGallery.player.position.x < 4.8, 'the player must enter the left gallery');
  await screenshot(alice.page, '04-left-gallery.png');
  await writeJson('state-04-left-gallery.json', leftGallery);
  console.log('[museum-e2e] left gallery visited');

  await moveTowardX(alice.page, [bob.page], 11.35);
  const rightGallery = await moveTowardZ(alice.page, [bob.page], -2.8);
  assert.ok(rightGallery.player.position.x > 11.2, 'the player must enter the right gallery');
  await screenshot(alice.page, '05-right-gallery.png');
  await writeJson('state-05-right-gallery.json', rightGallery);
  console.log('[museum-e2e] right gallery visited');

  const finalBob = await readState(bob.page);
  assert.equal(objectFrom(finalBob, createdObject.id)?.catalogId, catalogId);
  assert.equal(finalBob.multiplayer.online, 2);
  assert.deepEqual(errors, []);

  report = {
    ok: true,
    channel,
    catalogId,
    objectId: createdObject.id,
    draggedFromCatalog: true,
    multiplayerSynchronized: true,
    terminalProtected: true,
    physicsKind: objectFrom(finalBob, createdObject.id)?.physicsKind,
    visited: ['Fifth Avenue facade', 'central hall', 'left gallery', 'right gallery'],
    screenshots: [
      '00-catalog-and-preview.png',
      '01-fifth-avenue-exterior.png',
      '02-central-hall-entry.png',
      '03-washington-central-gallery.png',
      '04-left-gallery.png',
      '05-right-gallery.png',
      'official-client/shot-0.png',
    ],
    errors,
  };
  await writeJson('report.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (createdObject && alice?.page && !alice.page.isClosed()) {
    try {
      assert.equal(await deleteMuseum(alice.page, createdObject), 200);
      await waitForState(
        bob.page,
        (state) => !objectFrom(state, createdObject.id),
        'museum deletion synchronizes to Bob',
      );
    } catch {
      // Isolated local data is removed below even if browser cleanup cannot finish.
    }
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close();
  await vite.close();
  await new Promise((resolve) => application.server.close(resolve));
  await rm(dataDirectory, { recursive: true, force: true });
}
