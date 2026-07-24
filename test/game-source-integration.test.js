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

function assertCurrentGameCsp(html, label) {
  const expected = ["'self'", 'blob:', currentSupabaseOrigin].sort();
  assert.deepEqual(
    [...cspConnectSources(html)].sort(),
    expected,
    `${label} HTML connect-src must contain exactly the intended sources`,
  );
}

function sourceTokens(source) {
  const tokens = [];
  let index = 0;
  const punctuators = [
    '>>>=', '===', '!==', '>>>', '**=', '&&=', '||=', '??=', '<<=', '>>=', '...',
    '=>', '==', '!=', '<=', '>=', '++', '--', '&&', '||', '??', '+=', '-=', '*=',
    '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**', '?.',
  ];
  const regexPrefixes = new Set([
    '(', '[', '{', ',', ';', ':', '=', '==', '===', '!=', '!==', '!', '?', '&&',
    '||', '??', '=>', 'return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof',
    'in', 'of', 'yield', 'await',
  ]);
  const escapeValues = new Map([
    ['n', '\n'], ['r', '\r'], ['t', '\t'], ['b', '\b'], ['f', '\f'], ['v', '\v'],
    ['0', '\0'],
  ]);

  const readQuotedString = (quote) => {
    let value = '';
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === quote) {
        index += 1;
        break;
      }
      if (character !== '\\') {
        value += character;
        index += 1;
        continue;
      }
      const escaped = source[index + 1];
      if (escaped === '\n' || escaped === '\r') {
        index += escaped === '\r' && source[index + 2] === '\n' ? 3 : 2;
        continue;
      }
      value += escapeValues.get(escaped) ?? escaped ?? '';
      index += 2;
    }
    tokens.push({ type: 'string', value });
  };

  const canStartRegex = () => {
    const previous = tokens.at(-1);
    return !previous || regexPrefixes.has(previous.value);
  };

  const readRegex = () => {
    index += 1;
    let inCharacterClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') index += 2;
      else if (character === '[') {
        inCharacterClass = true;
        index += 1;
      } else if (character === ']' && inCharacterClass) {
        inCharacterClass = false;
        index += 1;
      } else if (character === '/' && !inCharacterClass) {
        index += 1;
        while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1;
        break;
      } else index += 1;
    }
    tokens.push({ type: 'regex', value: '' });
  };

  const scanCode = (templateExpression = false) => {
    let nestedBraces = 0;
    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];
      if (templateExpression && character === '}' && nestedBraces === 0) {
        index += 1;
        return;
      }
      if (/\s/u.test(character)) {
        index += 1;
      } else if (character === '/' && next === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n') index += 1;
      } else if (character === '/' && next === '*') {
        index += 2;
        while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
        index += 2;
      } else if (character === '"' || character === "'") {
        readQuotedString(character);
      } else if (character === '`') {
        index += 1;
        while (index < source.length) {
          if (source[index] === '\\') index += 2;
          else if (source[index] === '`') {
            index += 1;
            break;
          } else if (source[index] === '$' && source[index + 1] === '{') {
            index += 2;
            scanCode(true);
          } else index += 1;
        }
      } else if (/[A-Za-z_$]/u.test(character)) {
        const start = index;
        index += 1;
        while (/[A-Za-z0-9_$]/u.test(source[index] ?? '')) index += 1;
        tokens.push({ type: 'identifier', value: source.slice(start, index) });
      } else if (/[0-9]/u.test(character)) {
        const start = index;
        index += 1;
        while (/[A-Za-z0-9._]/u.test(source[index] ?? '')) index += 1;
        tokens.push({ type: 'number', value: source.slice(start, index) });
      } else if (character === '/' && canStartRegex()) {
        readRegex();
      } else {
        const punctuator = punctuators.find((candidate) => source.startsWith(candidate, index)) ?? character;
        tokens.push({ type: 'punctuator', value: punctuator });
        index += punctuator.length;
        if (templateExpression && punctuator === '{') nestedBraces += 1;
        else if (templateExpression && punctuator === '}') nestedBraces -= 1;
      }
    }
  };

  scanCode();
  return tokens;
}

function hasTokenSequence(tokens, values) {
  return tokens.some((_, start) => values.every((value, offset) => tokens[start + offset]?.value === value));
}

function hasNewExpression(tokens, name) {
  return hasTokenSequence(tokens, ['new', name, '(']);
}

function hasExportedFunction(tokens, name) {
  return hasTokenSequence(tokens, ['export', 'function', name, '(']);
}

function hasCallExpression(tokens, name) {
  return tokens.some((token, index) =>
    token.value === name
    && tokens[index + 1]?.value === '('
    && tokens[index - 1]?.value !== 'function'
    && tokens[index - 1]?.value !== 'new');
}

function hasGlobalWebSocketReplacement(tokens) {
  const assignmentOperators = new Set(['=', '&&=', '||=', '??=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=']);
  for (let index = 0; index < tokens.length; index += 1) {
    const globalName = tokens[index]?.value;
    if (globalName === 'window' || globalName === 'globalThis') {
      if (
        tokens[index + 1]?.value === '.'
        && tokens[index + 2]?.value === 'WebSocket'
        && assignmentOperators.has(tokens[index + 3]?.value)
      ) return true;
      if (
        tokens[index + 1]?.value === '['
        && tokens[index + 2]?.type === 'string'
        && tokens[index + 2]?.value === 'WebSocket'
        && tokens[index + 3]?.value === ']'
        && assignmentOperators.has(tokens[index + 4]?.value)
      ) return true;
    }
    const owner = tokens[index]?.value;
    const method = tokens[index + 2]?.value;
    if (
      ((owner === 'Object' && method === 'defineProperty') || (owner === 'Reflect' && method === 'set'))
      && tokens[index + 1]?.value === '.'
      && tokens[index + 3]?.value === '('
      && (tokens[index + 4]?.value === 'window' || tokens[index + 4]?.value === 'globalThis')
      && tokens[index + 5]?.value === ','
      && tokens[index + 6]?.type === 'string'
      && tokens[index + 6]?.value === 'WebSocket'
    ) return true;
  }
  return false;
}

function assertImports(source, importedName, moduleSpecifier) {
  const tokens = sourceTokens(source);
  const matchingImport = tokens.some((token, start) => {
    if (token.value !== 'import') return false;
    let end = start + 1;
    while (end < tokens.length && tokens[end].value !== ';') end += 1;
    const declaration = tokens.slice(start, end);
    const from = declaration.findIndex((candidate) => candidate.value === 'from');
    return from > 0
      && declaration[from + 1]?.type === 'string'
      && declaration[from + 1]?.value === moduleSpecifier
      && declaration.slice(0, from).some((candidate) => candidate.value === importedName);
  });
  assert.ok(matchingImport, `source must import ${importedName} from ${moduleSpecifier}`);
}

async function runtimeBuildInputs() {
  const textExtensions = /\.(?:[cm]?js|jsx|tsx?|css|html|json)$/u;
  const files = [
    'apps/game/index.html',
    'apps/game/package.json',
    'apps/game/vite.config.ts',
  ];
  const visit = async (relativeDirectory, excludeTests) => {
    for (const entry of await readdir(new URL(`${relativeDirectory}/`, root), { withFileTypes: true })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative, excludeTests);
      else if (
        textExtensions.test(entry.name)
        && !(excludeTests && /\.test\.[cm]?[jt]sx?$/u.test(entry.name))
      ) files.push(relative);
    }
  };
  await visit('apps/game/src', true);
  await visit('apps/game/public', false);
  return files;
}

test('runtime build input inventory includes Vite public text assets but not binary blobs', async () => {
  const inputs = await runtimeBuildInputs();
  assert.ok(inputs.includes('apps/game/public/registry.json'));
  assert.ok(inputs.includes('apps/game/public/levels/community-signal-demo/main.js'));
  assert.ok(inputs.includes('apps/game/public/levels/community-signal-demo/level.json'));
  assert.ok(!inputs.some((relative) => relative.endsWith('.glb')));
});

test('source structure scanner ignores literal decoys and recognizes executable ownership', () => {
  const decoys = sourceTokens([
    'const examples = [',
    "  'new AccountLoginFlow()',",
    '  "quitWhiteRoomGame()",',
    '  `export function quitWhiteRoomGame() {}`,',
    String.raw`  /new AccountLoginFlow\(\)/,`,
    '];',
    '// new AccountLoginFlow(); quitWhiteRoomGame();',
    '/* export function quitWhiteRoomGame() {} */',
  ].join('\n'));
  assert.equal(hasNewExpression(decoys, 'AccountLoginFlow'), false);
  assert.equal(hasCallExpression(decoys, 'quitWhiteRoomGame'), false);
  assert.equal(hasExportedFunction(decoys, 'quitWhiteRoomGame'), false);

  const executable = sourceTokens(`
    new AccountLoginFlow();
    export function quitWhiteRoomGame() {}
    quitWhiteRoomGame();
  `);
  assert.equal(hasNewExpression(executable, 'AccountLoginFlow'), true);
  assert.equal(hasExportedFunction(executable, 'quitWhiteRoomGame'), true);
  assert.equal(hasCallExpression(executable, 'quitWhiteRoomGame'), true);
});

test('WebSocket replacement scanner catches executable forms and ignores quoted examples', () => {
  for (const source of [
    'window.WebSocket = FakeSocket;',
    "globalThis['WebSocket'] = FakeSocket;",
    "Object.defineProperty(window, 'WebSocket', { value: FakeSocket });",
    'Reflect.set(globalThis, "WebSocket", FakeSocket);',
    '`template ${window.WebSocket = FakeSocket}`;',
  ]) assert.equal(hasGlobalWebSocketReplacement(sourceTokens(source)), true, source);

  const examples = sourceTokens([
    'const docs = [',
    "  'window.WebSocket = FakeSocket',",
    "  \"globalThis['WebSocket'] = FakeSocket\",",
    "  `Object.defineProperty(window, 'WebSocket', value)`,",
    String.raw`  /window\.WebSocket\s*=/,`,
    '];',
    "// Reflect.set(globalThis, 'WebSocket', FakeSocket);",
  ].join('\n'));
  assert.equal(hasGlobalWebSocketReplacement(examples), false);
});

test('game CSP connect-src accepts exactly the intended sources', () => {
  const html = (sources) => `<meta http-equiv="Content-Security-Policy" content="connect-src ${sources}">`;
  assert.doesNotThrow(() => assertCurrentGameCsp(html(`'self' blob: ${currentSupabaseOrigin}`), 'fixture'));
  for (const sources of [
    `'self' blob: ${currentSupabaseOrigin} https:`,
    `'self' blob: ${currentSupabaseOrigin} wss:`,
    `'self' blob: ${currentSupabaseOrigin} *`,
    `'self' blob: ${currentSupabaseOrigin} ${currentSupabaseOrigin}`,
  ]) assert.throws(() => assertCurrentGameCsp(html(sources), 'fixture'));
});

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
  assert.equal(hasCallExpression(sourceTokens(main), 'captureRecoveryHash'), true);
  for (const [owner, moduleSpecifier] of [
    ['AccountLoginFlow', './account-login-flow'],
    ['AccountRegistrationFlow', './account-registration-flow'],
    ['AccountRecoveryFlow', './account-recovery-flow'],
  ]) {
    assertImports(account, owner, moduleSpecifier);
    assert.equal(hasNewExpression(sourceTokens(account), owner), true, `account source must instantiate ${owner}`);
  }
  assertImports(multiplayer, 'PlayerTelemetryController', './player-telemetry');
  assert.equal(hasNewExpression(sourceTokens(multiplayer), 'PlayerTelemetryController'), true);
  const gameTokens = sourceTokens(game);
  assert.equal(hasExportedFunction(gameTokens, 'quitWhiteRoomGame'), true);
  assert.equal(hasCallExpression(gameTokens, 'quitWhiteRoomGame'), true);
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

  for (const relative of buildInputs.filter((file) => /\.[cm]?[jt]sx?$/u.test(file))) {
    const source = await readFile(new URL(relative, root), 'utf8');
    assert.equal(
      hasGlobalWebSocketReplacement(sourceTokens(source)),
      false,
      `${relative} must not replace the global WebSocket`,
    );
  }

  for (const [label, document] of [
    ['source', html],
    ['production', productionHtml],
  ]) assertCurrentGameCsp(document, label);
});
