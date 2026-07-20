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

test('the diver portal is served at the site root with allowlisted assets only', async () => {
  const harness = await createHarness();
  try {
    const index = await fetch(`${harness.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    const html = await index.text();
    assert.match(html, /眠海 · 潜航门户/);
    assert.match(html, /潜航协议/);
    assert.match(html, /\/portal\/app\.js/);

    const styles = await fetch(`${harness.baseUrl}/portal/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const script = await fetch(`${harness.baseUrl}/portal/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /text\/javascript/);
    assert.match(await script.text(), /api\/dreamsea\/worldview/);

    const head = await fetch(`${harness.baseUrl}/index.html`, { method: 'HEAD' });
    assert.equal(head.status, 200);

    // 白名单之外的路径一律 404（门户不做目录式服务，文件路径不由 URL 派生）
    for (const forbidden of ['/portal/', '/portal/index.html', '/portal/missing.js', '/portal/styles.css.bak']) {
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
