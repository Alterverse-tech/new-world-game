import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';

const UPLOAD_TOKEN = 'upload-token-for-portal-tests';
const ADMIN_TOKEN = 'admin-token-for-portal-tests';

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-portal-test-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  return {
    application,
    dataDirectory,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`,
    async close({ remove = true } = {}) {
      if (application.server.listening) {
        await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      }
      if (remove) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

test('the WhiteRoom game is served at the site root and the diver portal stays at /portal/', async () => {
  const harness = await createHarness();
  try {
    const index = await fetch(`${harness.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    const html = await index.text();
    assert.match(html, /<title>WhiteRoom · 白房间<\/title>/);
    assert.match(html, /WHITEROOM OS · BUILD 1\.0/);
    assert.match(html, /\.\/assets\/index-C4bZ867h-authfix\.js/);

    const gameStyles = await fetch(`${harness.baseUrl}/assets/index-7Eajp7Zf.css`);
    assert.equal(gameStyles.status, 200);
    assert.match(gameStyles.headers.get('content-type'), /text\/css/);

    const gameModel = await fetch(`${harness.baseUrl}/generated-assets/whiteroom-default-avatar-idle.glb`, {
      method: 'HEAD',
    });
    assert.equal(gameModel.status, 200);
    assert.equal(gameModel.headers.get('content-type'), 'model/gltf-binary');

    const portalRedirect = await fetch(`${harness.baseUrl}/portal`, { redirect: 'manual' });
    assert.equal(portalRedirect.status, 308);
    assert.equal(portalRedirect.headers.get('location'), '/portal/');

    const portal = await fetch(`${harness.baseUrl}/portal/`);
    assert.equal(portal.status, 200);
    assert.match(await portal.text(), /眠海 · 潜航门户/);

    const styles = await fetch(`${harness.baseUrl}/portal/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const script = await fetch(`${harness.baseUrl}/portal/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.match(await script.text(), /api\/dreamsea\/worldview/);

    const head = await fetch(`${harness.baseUrl}/index.html`, { method: 'HEAD' });
    assert.equal(head.status, 200);

    // 白名单之外的门户路径一律 404（文件路径不由 URL 派生）。
    for (const forbidden of ['/portal/missing.js', '/portal/styles.css.bak']) {
      const response = await fetch(`${harness.baseUrl}${forbidden}`);
      assert.equal(response.status, 404, `${forbidden} must not be served`);
    }
  } finally {
    await harness.close();
  }
});

test('the admin console keeps serving and carries the dreamsea operations panel', async () => {
  const harness = await createHarness();
  try {
    const page = await fetch(`${harness.baseUrl}/admin/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /眠海 · 审势台/);
    assert.match(html, /眠海运维/);
    assert.match(html, /沉没巡查/);
    assert.match(html, /宣告梦灾/);

    const script = await fetch(`${harness.baseUrl}/admin/app.js`);
    assert.equal(script.status, 200);
    const source = await script.text();
    assert.match(source, /api\/admin\/dreamsea\/sink-patrol/);
    assert.match(source, /api\/admin\/dreamsea\/calamities/);
  } finally {
    await harness.close();
  }
});
