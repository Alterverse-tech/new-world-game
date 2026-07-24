import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const currentSupabaseOrigin = 'https://uzshphuobuaeyadxgriv.supabase.co';

function withoutComments(source, kind = 'source') {
  if (kind === 'html') return source.replace(/<!--[\s\S]*?-->/gu, '');
  let result = '';
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === '\\') {
        result += next ?? '';
        index += 1;
      } else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
    } else if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
    } else if (character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 1;
    } else result += character;
  }
  return result;
}

function htmlIds(html) {
  const ids = new Set();
  for (const tag of withoutComments(html, 'html').matchAll(/<[A-Za-z][^>]*>/gu)) {
    const id = tag[0].match(/\bid\s*=\s*["']([^"']+)["']/u)?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

function cspConnectSources(html) {
  const document = withoutComments(html, 'html');
  const cspMeta = [...document.matchAll(/<meta\b[^>]*>/gu)].find((match) =>
    /\bhttp-equiv\s*=\s*["']Content-Security-Policy["']/iu.test(match[0]));
  assert.ok(cspMeta, 'game HTML must define a Content-Security-Policy meta tag');
  const contentMatch = cspMeta[0].match(/\scontent\s*=\s*(["'])(.*?)\1/isu);
  const content = contentMatch?.[2];
  assert.ok(content, 'Content-Security-Policy meta tag must define content');
  const connect = content
    .split(';')
    .map((directive) => directive.trim().split(/\s+/u))
    .find(([name]) => name === 'connect-src');
  assert.ok(connect, 'Content-Security-Policy must define connect-src');
  return connect.slice(1);
}

function assertImports(source, importedName, moduleSpecifier) {
  const uncommented = withoutComments(source);
  const escapedModule = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const declaration = new RegExp(
    `(?:^|\\n)\\s*import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escapedModule}['"]\\s*;`,
    'u',
  ).exec(uncommented);
  assert.ok(declaration, `source must import from ${moduleSpecifier}`);
  const importedNames = declaration[1]
    .split(',')
    .map((name) => name.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0]);
  assert.ok(importedNames.includes(importedName), `source must import ${importedName} from ${moduleSpecifier}`);
}

async function runtimeBuildInputs() {
  const files = [
    'apps/game/index.html',
    'apps/game/package.json',
    'apps/game/vite.config.ts',
  ];
  const visit = async (relativeDirectory) => {
    for (const entry of await readdir(new URL(`${relativeDirectory}/`, root), { withFileTypes: true })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if ((entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) || entry.name.endsWith('.css')) {
        files.push(relative);
      }
    }
  };
  await visit('apps/game/src');
  return files;
}

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

test('game source owns every current production overlay behavior', async () => {
  const html = await readFile(new URL('apps/game/index.html', root), 'utf8');
  const main = await readFile(new URL('apps/game/src/main.ts', root), 'utf8');
  const account = await readFile(new URL('apps/game/src/account-controller.ts', root), 'utf8');
  const multiplayer = await readFile(new URL('apps/game/src/lobby-multiplayer.ts', root), 'utf8');
  const game = await readFile(new URL('apps/game/src/white-room-game.ts', root), 'utf8');
  const theme = await readFile(new URL('apps/game/src/openai-theme.css', root), 'utf8');
  const productionHtml = await readFile(new URL('public/game/index.html', root), 'utf8');

  const requiredIds = htmlIds(html);
  for (const id of [
    'account-login-otp-panel',
    'account-register-dialog',
    'account-reset-dialog',
    'player-stats-panel',
    'quit-game-btn',
  ]) assert.ok(requiredIds.has(id), `game source HTML must own #${id}`);

  assertImports(main, 'captureRecoveryHash', './account-recovery-flow');
  assert.match(withoutComments(main), /\bcaptureRecoveryHash\s*\(/u);
  for (const [owner, moduleSpecifier] of [
    ['AccountLoginFlow', './account-login-flow'],
    ['AccountRegistrationFlow', './account-registration-flow'],
    ['AccountRecoveryFlow', './account-recovery-flow'],
  ]) {
    assertImports(account, owner, moduleSpecifier);
    assert.match(withoutComments(account), new RegExp(`\\bnew\\s+${owner}\\s*\\(`, 'u'));
  }
  assertImports(multiplayer, 'PlayerTelemetryController', './player-telemetry');
  assert.match(withoutComments(multiplayer), /\bnew\s+PlayerTelemetryController\s*\(/u);
  const gameSource = withoutComments(game);
  assert.match(gameSource, /\bexport\s+function\s+quitWhiteRoomGame\s*\(/u);
  assert.ok(
    [...gameSource.matchAll(/\bquitWhiteRoomGame\s*\(/gu)].length >= 2,
    'white-room-game must both declare and call quitWhiteRoomGame',
  );
  assert.match(withoutComments(theme), /(?:^|\})\s*\.player-stats-panel\s*\{/u);

  const overlayAssets = [
    'account-login-otp-20260722.js',
    'account-register-20260721.js',
    'account-reset-bootstrap-20260721.js',
    'account-reset-20260721.js',
    'player-stats-20260721.js',
    'game-experience-20260721.js',
    'account-login-otp-20260722.css',
    'account-register-20260721.css',
    'account-reset-20260721.css',
    'player-stats-20260721.css',
  ];
  const buildInputs = await runtimeBuildInputs();
  for (const relative of buildInputs) {
    const source = await readFile(new URL(relative, root), 'utf8');
    const executableSource = withoutComments(source, relative.endsWith('.html') ? 'html' : 'source');
    for (const asset of overlayAssets) {
      assert.ok(!executableSource.includes(asset), `${relative} must not load legacy overlay ${asset}`);
    }
  }

  for (const relative of buildInputs.filter((file) => file.endsWith('.ts'))) {
    const source = withoutComments(await readFile(new URL(relative, root), 'utf8'));
    for (const pattern of [
      /\b(?:window|globalThis)\s*(?:\.\s*WebSocket|\[\s*["']WebSocket["']\s*\])\s*=/u,
      /\bObject\.defineProperty\s*\(\s*(?:window|globalThis)\s*,\s*["']WebSocket["']/u,
      /\bReflect\.set\s*\(\s*(?:window|globalThis)\s*,\s*["']WebSocket["']/u,
    ]) assert.doesNotMatch(source, pattern, `${relative} must not replace the global WebSocket`);
  }

  for (const [label, document] of [
    ['source', html],
    ['production', productionHtml],
  ]) {
    const connectSources = cspConnectSources(document);
    assert.ok(connectSources.includes(currentSupabaseOrigin), `${label} HTML must allow the current Supabase origin`);
    assert.deepEqual(
      connectSources.filter((source) => /^https?:\/\//u.test(source)),
      [currentSupabaseOrigin],
      `${label} HTML must not allow another remote connect-src origin`,
    );
  }
});
