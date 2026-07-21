import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewServer } from '../scripts/preview-server.mjs';

test('local preview serves the page, runtime, prop module, and Three.js', async (context) => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /动漫羽球小赛场/);

  const runtime = await fetch(`${baseUrl}/preview/main.js`);
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get('content-type'), /^text\/javascript/);

  const prop = await fetch(`${baseUrl}/src/lobby-props/generated/anime-badminton-court.ts`);
  assert.equal(prop.status, 200);
  assert.match(prop.headers.get('content-type'), /^text\/javascript/);

  const three = await fetch(`${baseUrl}/node_modules/three/build/three.module.js`);
  assert.equal(three.status, 200);
  assert.match(three.headers.get('content-type'), /^text\/javascript/);
});

test('local preview does not expose files outside its game root', async (context) => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/..%2F..%2Fpackage.json`);
  assert.equal(response.status, 404);
});
