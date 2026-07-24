import assert from 'node:assert/strict';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const repositoryRoot = fileURLToPath(root);
const appRoot = fileURLToPath(new URL('apps/game/', root));
const appRequire = createRequire(new URL('apps/game/package.json', root));
const typescript = appRequire('typescript');
const currentSupabaseOrigin = 'https://uzshphuobuaeyadxgriv.supabase.co';

function withoutComments(source, kind = 'source') {
  if (kind === 'html') return source.replace(/<!--[\s\S]*?-->/gu, '');
  if (kind === 'css') return source.replace(/\/\*[\s\S]*?\*\//gu, '');
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

function parseSourceFile(source, fileName = 'fixture.ts') {
  const scriptKind = /\.[cm]?jsx?$/u.test(fileName)
    ? typescript.ScriptKind.JSX
    : /\.tsx$/u.test(fileName)
      ? typescript.ScriptKind.TSX
      : typescript.ScriptKind.TS;
  return typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function visitSource(sourceFile, predicate) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) {
      found = true;
      return;
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function hasNamedValueImport(sourceFile, importedName, moduleSpecifier) {
  return sourceFile.statements.some((statement) => {
    if (!typescript.isImportDeclaration(statement)) return false;
    if (!typescript.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== moduleSpecifier) {
      return false;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !typescript.isNamedImports(clause.namedBindings)) {
      return false;
    }
    return clause.namedBindings.elements.some((element) =>
      !element.isTypeOnly
      && (element.propertyName?.text ?? element.name.text) === importedName
      && element.name.text === importedName);
  });
}

function hasNewExpression(sourceFile, name) {
  return visitSource(sourceFile, (node) =>
    typescript.isNewExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === name);
}

function hasExportedFunction(sourceFile, name) {
  return sourceFile.statements.some((statement) =>
    typescript.isFunctionDeclaration(statement)
    && statement.name?.text === name
    && Boolean(statement.body)
    && statement.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword));
}

function hasCallExpression(sourceFile, name) {
  return visitSource(sourceFile, (node) =>
    typescript.isCallExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === name);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    typescript.isParenthesizedExpression(current)
    || typescript.isAsExpression(current)
    || typescript.isTypeAssertionExpression(current)
    || typescript.isNonNullExpression(current)
    || typescript.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function isGlobalObject(expression) {
  const unwrapped = unwrapExpression(expression);
  return typescript.isIdentifier(unwrapped)
    && (unwrapped.text === 'window' || unwrapped.text === 'globalThis');
}

function propertyNameText(name) {
  if (!name) return null;
  if (typescript.isIdentifier(name) || typescript.isStringLiteralLike(name)) return name.text;
  if (typescript.isComputedPropertyName(name) && typescript.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function isWebSocketAssignmentTarget(expression) {
  const unwrapped = unwrapExpression(expression);
  if (typescript.isIdentifier(unwrapped)) return unwrapped.text === 'WebSocket';
  if (typescript.isPropertyAccessExpression(unwrapped)) {
    return isGlobalObject(unwrapped.expression) && unwrapped.name.text === 'WebSocket';
  }
  return typescript.isElementAccessExpression(unwrapped)
    && isGlobalObject(unwrapped.expression)
    && Boolean(unwrapped.argumentExpression)
    && typescript.isStringLiteralLike(unwrapExpression(unwrapped.argumentExpression))
    && unwrapExpression(unwrapped.argumentExpression).text === 'WebSocket';
}

function isObjectMethodCall(call, owner, method) {
  const expression = unwrapExpression(call.expression);
  return typescript.isPropertyAccessExpression(expression)
    && typescript.isIdentifier(unwrapExpression(expression.expression))
    && unwrapExpression(expression.expression).text === owner
    && expression.name.text === method;
}

function objectLiteralDefinesWebSocket(expression) {
  const unwrapped = unwrapExpression(expression);
  return typescript.isObjectLiteralExpression(unwrapped)
    && unwrapped.properties.some((property) => propertyNameText(property.name) === 'WebSocket');
}

function hasGlobalWebSocketReplacement(sourceFile) {
  const assignmentOperators = new Set([
    typescript.SyntaxKind.EqualsToken,
    typescript.SyntaxKind.PlusEqualsToken,
    typescript.SyntaxKind.MinusEqualsToken,
    typescript.SyntaxKind.AsteriskEqualsToken,
    typescript.SyntaxKind.AsteriskAsteriskEqualsToken,
    typescript.SyntaxKind.SlashEqualsToken,
    typescript.SyntaxKind.PercentEqualsToken,
    typescript.SyntaxKind.LessThanLessThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.AmpersandEqualsToken,
    typescript.SyntaxKind.BarEqualsToken,
    typescript.SyntaxKind.CaretEqualsToken,
    typescript.SyntaxKind.BarBarEqualsToken,
    typescript.SyntaxKind.AmpersandAmpersandEqualsToken,
    typescript.SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  return visitSource(sourceFile, (node) => {
    if (
      typescript.isBinaryExpression(node)
      && assignmentOperators.has(node.operatorToken.kind)
      && isWebSocketAssignmentTarget(node.left)
    ) return true;
    if (!typescript.isCallExpression(node)) return false;
    if (
      (isObjectMethodCall(node, 'Object', 'defineProperty')
        || isObjectMethodCall(node, 'Reflect', 'set')
        || isObjectMethodCall(node, 'Reflect', 'defineProperty'))
      && node.arguments.length >= 2
      && isGlobalObject(node.arguments[0])
      && typescript.isStringLiteralLike(unwrapExpression(node.arguments[1]))
      && unwrapExpression(node.arguments[1]).text === 'WebSocket'
    ) return true;
    if (
      isObjectMethodCall(node, 'Object', 'defineProperties')
      && isGlobalObject(node.arguments[0])
      && node.arguments[1]
      && objectLiteralDefinesWebSocket(node.arguments[1])
    ) return true;
    return isObjectMethodCall(node, 'Object', 'assign')
      && isGlobalObject(node.arguments[0])
      && node.arguments.slice(1).some(objectLiteralDefinesWebSocket);
  });
}

function assertImports(source, importedName, moduleSpecifier) {
  assert.ok(
    hasNamedValueImport(parseSourceFile(source), importedName, moduleSpecifier),
    `source must import ${importedName} as a value from ${moduleSpecifier}`,
  );
}

function normalizedPathKey(path) {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathIsContained(rootPath, targetPath) {
  const child = relative(resolve(rootPath), resolve(targetPath));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function assertContainedPath(rootPath, targetPath, label) {
  assert.ok(pathIsContained(rootPath, targetPath), `${label} escapes ${rootPath}: ${targetPath}`);
}

function assertAllowedViteModulePath({ appRoot: approvedRoot, logicalPath, realPath: resolvedPath }) {
  const nodeModulesRoot = join(approvedRoot, 'node_modules');
  if (pathIsContained(nodeModulesRoot, logicalPath)) return;
  assertContainedPath(approvedRoot, logicalPath, 'Vite module path');
  assertContainedPath(approvedRoot, resolvedPath, 'Vite module real path');
}

function decodeNonBinaryUtf8(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text) ? null : text;
}

function displayPath(path) {
  const repositoryRelative = relative(repositoryRoot, path);
  const displayed = pathIsContained(repositoryRoot, path) ? repositoryRelative : path;
  return displayed.replaceAll('\\', '/');
}

function viteModuleIdPath(id) {
  if (!id || id.includes('\0')) return null;
  let value = id.startsWith('/@fs/') ? id.slice('/@fs/'.length) : id;
  const suffix = value.search(/[?#]/u);
  if (suffix >= 0) value = value.slice(0, suffix);
  if (value.startsWith('file:')) value = fileURLToPath(value);
  if (process.platform === 'win32' && /^\/[A-Za-z]:\//u.test(value)) value = value.slice(1);
  return isAbsolute(value) ? resolve(value) : null;
}

let viteModuleGraphPromise;

function viteRuntimeModuleFiles() {
  viteModuleGraphPromise ??= (async () => {
    const capturedModules = [];
    const capturePlugin = {
      name: 'capture-whiteroom-runtime-module-graph',
      buildEnd(error) {
        if (error) return;
        for (const id of this.getModuleIds()) {
          capturedModules.push({ id, external: this.getModuleInfo(id)?.isExternal === true });
        }
      },
    };
    const { build } = await import(pathToFileURL(appRequire.resolve('vite')).href);
    await build({
      root: appRoot,
      configFile: join(appRoot, 'vite.config.ts'),
      logLevel: 'silent',
      clearScreen: false,
      plugins: [capturePlugin],
      build: { write: false },
    });
    assert.ok(capturedModules.length > 0, 'Vite build must expose a non-empty Rollup module graph');
    const files = [];
    const seen = new Set();
    for (const module of capturedModules) {
      if (module.external) continue;
      const logicalPath = viteModuleIdPath(module.id);
      if (!logicalPath) continue;
      const resolvedPath = await realpath(logicalPath);
      assertAllowedViteModulePath({ appRoot, logicalPath, realPath: resolvedPath });
      const key = normalizedPathKey(resolvedPath);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ logicalPath, realPath: resolvedPath });
    }
    return files;
  })().catch((error) => {
    viteModuleGraphPromise = undefined;
    throw error;
  });
  return viteModuleGraphPromise;
}

async function publicRuntimeTextFiles(
  publicRoot = join(appRoot, 'public'),
  { approvedRoot = appRoot, labelPrefix = 'apps/game/public' } = {},
) {
  const resolvedAppRoot = await realpath(approvedRoot);
  const resolvedPublicRoot = await realpath(publicRoot);
  assertContainedPath(resolvedAppRoot, resolvedPublicRoot, 'Vite public root');
  const visitedDirectories = new Set();
  const files = [];

  const visit = async (logicalPath) => {
    await lstat(logicalPath);
    const resolvedPath = await realpath(logicalPath);
    assertContainedPath(resolvedPublicRoot, resolvedPath, `Vite public entry ${logicalPath}`);
    const information = await stat(logicalPath);
    if (information.isDirectory()) {
      const key = normalizedPathKey(resolvedPath);
      if (visitedDirectories.has(key)) return;
      visitedDirectories.add(key);
      for (const entry of await readdir(logicalPath, { withFileTypes: true })) {
        await visit(join(logicalPath, entry.name));
      }
      return;
    }
    if (!information.isFile()) return;
    const buffer = await readFile(logicalPath);
    const text = decodeNonBinaryUtf8(buffer);
    if (text === null) return;
    files.push({
      label: `${labelPrefix}/${relative(publicRoot, logicalPath).replaceAll('\\', '/')}`,
      logicalPath,
      realPath: resolvedPath,
      text,
      publicFile: true,
    });
  };

  await visit(publicRoot);
  return files;
}

let runtimeBuildInputsPromise;

function runtimeBuildInputs() {
  runtimeBuildInputsPromise ??= (async () => {
    const graphFiles = await viteRuntimeModuleFiles();
    const explicitFiles = [
      join(appRoot, 'index.html'),
      join(appRoot, 'package.json'),
      join(appRoot, 'vite.config.ts'),
    ].map((logicalPath) => ({ logicalPath, realPath: logicalPath }));
    const files = [];
    const seen = new Set();
    for (const file of [...graphFiles, ...explicitFiles]) {
      const resolvedPath = await realpath(file.realPath);
      const key = normalizedPathKey(resolvedPath);
      if (seen.has(key)) continue;
      seen.add(key);
      const buffer = await readFile(resolvedPath);
      files.push({
        label: displayPath(file.logicalPath),
        logicalPath: file.logicalPath,
        realPath: resolvedPath,
        text: decodeNonBinaryUtf8(buffer),
        publicFile: false,
      });
    }
    files.push(...await publicRuntimeTextFiles());
    return files;
  })().catch((error) => {
    runtimeBuildInputsPromise = undefined;
    throw error;
  });
  return runtimeBuildInputsPromise;
}

test('runtime build input inventory includes Vite public text assets but not binary blobs', async () => {
  const inputs = await runtimeBuildInputs();
  const labels = inputs.map((input) => input.label);
  assert.ok(labels.includes('apps/game/public/registry.json'));
  assert.ok(labels.includes('apps/game/public/levels/community-signal-demo/main.js'));
  assert.ok(labels.includes('apps/game/public/levels/community-signal-demo/level.json'));
  assert.ok(!labels.some((label) => label.endsWith('.glb')));
  assert.ok(labels.includes('apps/game/index.html'));
  assert.ok(labels.includes('apps/game/package.json'));
  assert.ok(labels.includes('apps/game/vite.config.ts'));
  assert.ok(labels.includes('apps/game/src/main.ts'));
  assert.ok(labels.some((label) => label.includes('/node_modules/three/')));
});

test('public inventory scans UTF-8 text regardless of extension and skips binary by content', async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'whiteroom-public-inventory-'));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixturePublic = join(fixtureRoot, 'public');
  await mkdir(fixturePublic);
  await writeFile(join(fixturePublic, 'diagram.svg'), '<svg>account-register-20260721.css</svg>');
  await writeFile(join(fixturePublic, 'page.htm'), '<script src="game-experience-20260721.js"></script>');
  await writeFile(join(fixturePublic, 'extensionless'), 'plain UTF-8 runtime text');
  await writeFile(join(fixturePublic, 'looks-like-text.js'), Buffer.from([0x67, 0x6c, 0x54, 0x46, 0, 1, 2, 3]));

  const inputs = await publicRuntimeTextFiles(fixturePublic, {
    approvedRoot: fixtureRoot,
    labelPrefix: 'fixture/public',
  });
  const labels = inputs.map((input) => input.label);
  assert.ok(labels.includes('fixture/public/diagram.svg'));
  assert.ok(labels.includes('fixture/public/page.htm'));
  assert.ok(labels.includes('fixture/public/extensionless'));
  assert.ok(!labels.includes('fixture/public/looks-like-text.js'));
});

test('source structure scanner ignores literal decoys and recognizes executable ownership', () => {
  const decoys = parseSourceFile([
    'const examples = [',
    "  'new AccountLoginFlow()',",
    '  "quitWhiteRoomGame()",',
    '  `export function quitWhiteRoomGame() {}`,',
    String.raw`  /new AccountLoginFlow\(\)/,`,
    '];',
    'const object = { quitWhiteRoomGame() {} };',
    'class Example { quitWhiteRoomGame() {} }',
    '// new AccountLoginFlow(); quitWhiteRoomGame();',
    '/* export function quitWhiteRoomGame() {} */',
  ].join('\n'));
  assert.equal(hasNewExpression(decoys, 'AccountLoginFlow'), false);
  assert.equal(hasCallExpression(decoys, 'quitWhiteRoomGame'), false);
  assert.equal(hasExportedFunction(decoys, 'quitWhiteRoomGame'), false);

  const executable = parseSourceFile(`
    new AccountLoginFlow();
    export function quitWhiteRoomGame() {}
    quitWhiteRoomGame();
  `);
  assert.equal(hasNewExpression(executable, 'AccountLoginFlow'), true);
  assert.equal(hasExportedFunction(executable, 'quitWhiteRoomGame'), true);
  assert.equal(hasCallExpression(executable, 'quitWhiteRoomGame'), true);
});

test('only a named value import establishes source ownership', () => {
  assert.equal(hasNamedValueImport(
    parseSourceFile("import type { AccountLoginFlow } from './account-login-flow';"),
    'AccountLoginFlow',
    './account-login-flow',
  ), false);
  assert.equal(hasNamedValueImport(
    parseSourceFile("import { AccountLoginFlow as LoginFlow } from './account-login-flow';"),
    'AccountLoginFlow',
    './account-login-flow',
  ), false);
  assert.equal(hasNamedValueImport(
    parseSourceFile("import { type Other, AccountLoginFlow } from './account-login-flow';"),
    'AccountLoginFlow',
    './account-login-flow',
  ), true);
});

test('WebSocket replacement scanner catches executable forms and ignores quoted examples', () => {
  for (const source of [
    'WebSocket = FakeSocket;',
    'window.WebSocket = FakeSocket;',
    "globalThis['WebSocket'] = FakeSocket;",
    "Object.defineProperty(window, 'WebSocket', { value: FakeSocket });",
    "Object.defineProperties(window, { WebSocket: { value: FakeSocket } });",
    "Object.assign(globalThis, { ['WebSocket']: FakeSocket });",
    'Reflect.set(globalThis, "WebSocket", FakeSocket);',
    "Reflect.defineProperty(window, 'WebSocket', { value: FakeSocket });",
    '`template ${window.WebSocket = FakeSocket}`;',
  ]) assert.equal(hasGlobalWebSocketReplacement(parseSourceFile(source)), true, source);

  const examples = parseSourceFile([
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

test('CSS comment stripping retains absolute and protocol-relative overlay URLs', () => {
  const css = [
    '/* account-register-20260721.css */',
    '@import url(https://cdn.example/account-register-20260721.css);',
    '@import url(//cdn.example/account-reset-20260721.css);',
  ].join('\n');
  const scanned = withoutComments(css, 'css');
  assert.ok(!scanned.startsWith('/*'));
  assert.ok(scanned.includes('https://cdn.example/account-register-20260721.css'));
  assert.ok(scanned.includes('//cdn.example/account-reset-20260721.css'));
});

test('runtime inventory content and containment helpers reject binary data and path escapes', () => {
  const fixtureApp = resolve('fixture-game');
  const fixturePublic = join(fixtureApp, 'public');
  assert.equal(decodeNonBinaryUtf8(Buffer.from('<svg>hello</svg>')), '<svg>hello</svg>');
  assert.equal(decodeNonBinaryUtf8(Buffer.from([0x67, 0x6c, 0x54, 0x46, 0, 1, 2, 3])), null);
  assert.doesNotThrow(() => assertContainedPath(fixturePublic, join(fixturePublic, 'levels', 'demo'), 'fixture'));
  assert.throws(() => assertContainedPath(fixturePublic, resolve('outside-fixture', 'demo'), 'fixture'));
  assert.doesNotThrow(() => assertAllowedViteModulePath({
    appRoot: fixtureApp,
    logicalPath: join(fixtureApp, 'node_modules', 'package', 'index.js'),
    realPath: resolve('dependency-cache', 'package', 'index.js'),
  }));
  assert.throws(() => assertAllowedViteModulePath({
    appRoot: fixtureApp,
    logicalPath: join(fixtureApp, 'src', 'escaped.ts'),
    realPath: resolve('outside-fixture', 'escaped.ts'),
  }));
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

  const mainSourceFile = parseSourceFile(main, 'main.ts');
  const accountSourceFile = parseSourceFile(account, 'account-controller.ts');
  const multiplayerSourceFile = parseSourceFile(multiplayer, 'lobby-multiplayer.ts');
  const gameSourceFile = parseSourceFile(game, 'white-room-game.ts');
  assertImports(main, 'captureRecoveryHash', './account-recovery-flow');
  assert.equal(hasCallExpression(mainSourceFile, 'captureRecoveryHash'), true);
  for (const [owner, moduleSpecifier] of [
    ['AccountLoginFlow', './account-login-flow'],
    ['AccountRegistrationFlow', './account-registration-flow'],
    ['AccountRecoveryFlow', './account-recovery-flow'],
  ]) {
    assertImports(account, owner, moduleSpecifier);
    assert.equal(hasNewExpression(accountSourceFile, owner), true, `account source must instantiate ${owner}`);
  }
  assertImports(multiplayer, 'PlayerTelemetryController', './player-telemetry');
  assert.equal(hasNewExpression(multiplayerSourceFile, 'PlayerTelemetryController'), true);
  assert.equal(hasExportedFunction(gameSourceFile, 'quitWhiteRoomGame'), true);
  assert.equal(hasCallExpression(gameSourceFile, 'quitWhiteRoomGame'), true);
  assert.match(withoutComments(theme, 'css'), /(?:^|\})\s*\.player-stats-panel\s*\{/u);

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
  for (const input of buildInputs) {
    const commentKind = /\.css$/iu.test(input.label)
      ? 'css'
      : /\.(?:html?|svg)$/iu.test(input.label)
        ? 'html'
        : 'source';
    const executableSource = input.text === null ? '' : withoutComments(input.text, commentKind);
    for (const asset of overlayAssets) {
      assert.ok(
        !input.label.includes(asset) && !executableSource.includes(asset),
        `${input.label} must not load legacy overlay ${asset}`,
      );
    }
  }

  for (const input of buildInputs.filter((file) => file.text !== null && /\.[cm]?[jt]sx?$/u.test(file.label))) {
    assert.equal(
      hasGlobalWebSocketReplacement(parseSourceFile(input.text, input.label)),
      false,
      `${input.label} must not replace the global WebSocket`,
    );
  }

  for (const [label, document] of [
    ['source', html],
    ['production', productionHtml],
  ]) assertCurrentGameCsp(document, label);
});
