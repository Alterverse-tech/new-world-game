import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('recovered game source contains a reproducible Vite TypeScript project', async () => {
  const required = [
    'apps/game/package.json',
    'apps/game/package-lock.json',
    'apps/game/tsconfig.json',
    'apps/game/vite.config.ts',
    'apps/game/index.html',
    'apps/game/src/main.ts',
    'apps/game/src/white-room-game.ts',
    'apps/game/src/ugc-runtime.ts',
    'apps/game/src/white-room-game.test.ts',
    'apps/game/src/ugc-runtime.test.ts',
  ];
  await Promise.all(required.map((relative) => access(new URL(relative, root))));

  const packageJson = JSON.parse(await readFile(new URL('apps/game/package.json', root), 'utf8'));
  assert.equal(packageJson.name, 'whiteroom-game');
  assert.equal(packageJson.scripts.build, 'tsc --noEmit && vite build');
  assert.equal(packageJson.scripts.test, 'vitest run');
  assert.equal(packageJson.dependencies.three, '0.179.1');
});

test('recovered source is the readable lineage of the tracked production bundle', async () => {
  const source = await readFile(new URL('apps/game/src/white-room-game.ts', root), 'utf8');
  const runtime = await readFile(new URL('apps/game/src/ugc-runtime.ts', root), 'utf8');
  const html = await readFile(new URL('public/game/index.html', root), 'utf8');
  const modulePath = html.match(/src="\.\/assets\/(index-[^"]+\.js)/u)?.[1];
  assert.ok(modulePath, 'tracked game HTML must identify its production module bundle');
  const bundle = await readFile(new URL(`public/game/assets/${modulePath}`, root), 'utf8');

  for (const marker of [
    'level.json 加载超时',
    'main.js 加载超时',
    'createLevel(sdk) 执行超时',
    '该世界已崩溃 · 正在安全返回桌面',
  ]) {
    assert.ok(source.includes(marker), `source must contain ${marker}`);
    assert.ok(bundle.includes(marker), `bundle must contain ${marker}`);
  }
  assert.match(runtime, /export function createUGCLevelSdk/u);
});
