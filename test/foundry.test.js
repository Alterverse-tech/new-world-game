import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-foundry-tests';
const ADMIN_TOKEN = 'admin-token-for-foundry-tests';

async function createHarness() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-foundry-data-'));
  const foundryRootDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-foundry-root-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    foundryRootDirectory,
    logger: { error() {} },
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  return {
    application,
    dataDirectory,
    foundryRootDirectory,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      await Promise.all([
        rm(dataDirectory, { recursive: true, force: true }),
        rm(foundryRootDirectory, { recursive: true, force: true }),
      ]);
    },
  };
}

test('foundry workbench is allowlisted and exposes an honest empty snapshot', async () => {
  const harness = await createHarness();
  try {
    const redirect = await fetch(`${harness.baseUrl}/foundry`, { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/foundry/');

    const page = await fetch(`${harness.baseUrl}/foundry/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /WhiteRoom Foundry/);
    assert.match(html, /模型素材生产台/);
    assert.match(html, /\/foundry\/app\.js/);
    assert.doesNotMatch(html, /cdn\.tailwindcss|code\.iconify/);

    const script = await fetch(`${harness.baseUrl}/foundry/app.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /api\/foundry\/snapshot/);

    const snapshot = await fetch(`${harness.baseUrl}/api/foundry/snapshot`);
    assert.equal(snapshot.status, 200);
    const payload = await snapshot.json();
    assert.equal(payload.plan, null);
    assert.equal(payload.status.status, 'idle');
    assert.deepEqual(payload.status.items, []);
    assert.equal(payload.capabilities.startsGeneration, false);
  } finally {
    await harness.close();
  }
});

test('foundry plan writes require the administrator token and create canonical pending state', async () => {
  const harness = await createHarness();
  try {
    const body = {
      projectName: '测试角色生产',
      gamePrompt: '低多边形、清晰轮廓、适合 WhiteRoom 浏览器游戏。',
      route: 'gemini_reference',
      items: [{
        id: 'test-player',
        name: '测试玩家',
        role: 'player',
        assetKind: 'character',
        prompt: '原创的轻量未来风角色，T-pose，白底参考图。',
        actions: ['idle', 'walk'],
      }],
    };

    const unauthorized = await fetch(`${harness.baseUrl}/api/foundry/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(unauthorized.status, 401);

    const created = await fetch(`${harness.baseUrl}/api/foundry/plans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.match(payload.plan.runId, /^foundry-/);
    assert.equal(payload.status.status, 'pending');
    assert.equal(payload.status.items[0].id, 'test-player');
    assert.deepEqual(payload.status.items[0].clips.map((clip) => clip.name), ['idle', 'walk']);

    const plan = JSON.parse(await readFile(path.join(harness.foundryRootDirectory, 'regeneration-plan.json'), 'utf8'));
    assert.equal(plan.projectName, body.projectName);
    assert.equal(plan.items[0].prompt, body.items[0].prompt);

    await mkdir(path.join(harness.foundryRootDirectory, 'public/generated-assets'), { recursive: true });
    await writeFile(path.join(harness.foundryRootDirectory, 'public/generated-assets/test-player.glb'), Buffer.from('glTF-test'));
    const glb = await fetch(`${harness.baseUrl}/generated-assets/test-player.glb`);
    assert.equal(glb.status, 200);
    assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');

    const refreshed = await fetch(`${harness.baseUrl}/api/foundry/snapshot`).then((response) => response.json());
    assert.equal(refreshed.status.items[0].status, 'ready');
    assert.equal(refreshed.status.items[0].runtimeUrl, '/generated-assets/test-player.glb');
    assert.equal(refreshed.status.items[0].clips[0].status, 'pending');
  } finally {
    await harness.close();
  }
});
