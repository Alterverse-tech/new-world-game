#!/usr/bin/env node

import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const RESERVED = /terminal|computer|system/i;
const MAX_GLB_BYTES = 15 * 1024 * 1024;
const MAX_CODE_BYTES = 100 * 1024;
const VEHICLE_FIELDS = new Set(['kind', 'enterRadius', 'maxSpeed', 'maxAcceleration', 'maxAngularSpeed']);
const VEHICLE_ARGUMENTS = ['vehicleKind', 'enterRadius', 'maxSpeed', 'maxAcceleration', 'maxAngularSpeed'];
const PHYSICS_BASE_FIELDS = new Set(['body', 'mass', 'friction', 'restitution', 'colliders']);
const APPROVED_MODULES_RELATIVE_PATH = path.join('src', 'lobby-props', 'approved-modules.ts');
const FORBIDDEN_RUNTIME_IDENTIFIERS = new Set([
  'window', 'document', 'globalThis', 'location', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker',
  'ServiceWorker', 'BroadcastChannel', 'importScripts', 'eval', 'Function', 'require',
  'process', 'Deno', 'Bun', 'Object', 'Reflect', 'Proxy', 'setTimeout', 'setInterval',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
]);
const FORBIDDEN_RUNTIME_PROPERTIES = new Set(['constructor', '__proto__', 'prototype']);
const VEHICLE_LIMITS = Object.freeze({
  car: Object.freeze({
    enterRadius: Object.freeze({ min: 1, max: 6 }),
    maxSpeed: Object.freeze({ min: 1, max: 35 }),
    maxAcceleration: Object.freeze({ min: 1, max: 30 }),
    maxAngularSpeed: Object.freeze({ min: 0.1, max: 4 }),
  }),
  aircraft: Object.freeze({
    enterRadius: Object.freeze({ min: 1, max: 8 }),
    maxSpeed: Object.freeze({ min: 1, max: 80 }),
    maxAcceleration: Object.freeze({ min: 1, max: 50 }),
    maxAngularSpeed: Object.freeze({ min: 0.1, max: 3 }),
  }),
});

function argsFrom(argv) {
  const values = { command: argv[2] ?? 'help' };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} 缺少值`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function required(value, label) {
  if (!value) throw new Error(`缺少 --${label}`);
  return path.resolve(value);
}

function itemError(item, message) {
  throw new Error(`${item?.id ?? 'unknown'}: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function boundedNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function physicsVector(value, minimum, maximum) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => boundedNumber(entry, minimum, maximum));
}

function validatePhysicsCollider(item, collider, index) {
  if (!isPlainObject(collider)) itemError(item, `physics.colliders[${index}] 必须是对象`);
  if (!physicsVector(collider.position, -16, 16) || !physicsVector(collider.rotation, -Math.PI, Math.PI)) {
    itemError(item, `physics.colliders[${index}] 的 position/rotation 无效`);
  }
  if (collider.shape === 'box') {
    if (!exactFields(collider, new Set(['shape', 'halfExtents', 'position', 'rotation']))) {
      itemError(item, `physics.colliders[${index}] box 字段不精确`);
    }
    if (!physicsVector(collider.halfExtents, 0.05, 12)) itemError(item, `physics.colliders[${index}].halfExtents 无效`);
    return;
  }
  if (collider.shape === 'ball') {
    if (!exactFields(collider, new Set(['shape', 'radius', 'position', 'rotation']))) {
      itemError(item, `physics.colliders[${index}] ball 字段不精确`);
    }
    if (!boundedNumber(collider.radius, 0.05, 8)) itemError(item, `physics.colliders[${index}].radius 无效`);
    return;
  }
  if (collider.shape === 'capsule') {
    if (!exactFields(collider, new Set(['shape', 'radius', 'halfHeight', 'position', 'rotation']))) {
      itemError(item, `physics.colliders[${index}] capsule 字段不精确`);
    }
    if (!boundedNumber(collider.radius, 0.05, 4) || !boundedNumber(collider.halfHeight, 0.05, 8)) {
      itemError(item, `physics.colliders[${index}] capsule 尺寸无效`);
    }
    return;
  }
  itemError(item, `physics.colliders[${index}].shape 必须是 box、ball 或 capsule`);
}

function validatePhysicsMetadata(item) {
  if (!Object.hasOwn(item, 'physics')) return false;
  if (item.kind !== 'code' || !isPlainObject(item.physics)) itemError(item, 'physics 只能用于 code 且必须是对象');
  if (Object.hasOwn(item, 'vehicle')) itemError(item, 'physics 与 vehicle 不得同时登记');
  const expected = new Set(PHYSICS_BASE_FIELDS);
  if (Object.hasOwn(item.physics, 'breakImpulse')) {
    itemError(item, '频道级破坏同步尚未上线，当前禁止登记 breakImpulse');
  }
  if (!exactFields(item.physics, expected)) itemError(item, 'physics 顶层字段不精确');
  if (item.physics.body !== 'fixed' && item.physics.body !== 'dynamic') itemError(item, 'physics.body 必须是 fixed 或 dynamic');
  if (item.physics.body === 'fixed' ? item.physics.mass !== 0 : !boundedNumber(item.physics.mass, 0.1, 5_000)) {
    itemError(item, 'fixed mass 必须为 0；dynamic mass 必须为 0.1–5000');
  }
  if (!boundedNumber(item.physics.friction, 0, 2) || !boundedNumber(item.physics.restitution, 0, 1)) {
    itemError(item, 'physics friction/restitution 超出范围');
  }
  if (!Array.isArray(item.physics.colliders) || item.physics.colliders.length < 1 || item.physics.colliders.length > 8) {
    itemError(item, 'physics.colliders 必须包含 1–8 项');
  }
  if (item.physics.body === 'dynamic' && item.physics.colliders.length !== 1) {
    itemError(item, '当前 dynamic physics 必须精确包含 1 个 collider');
  }
  item.physics.colliders.forEach((collider, index) => validatePhysicsCollider(item, collider, index));
  return true;
}

function validateVehicleMetadata(item) {
  if (!Object.hasOwn(item, 'vehicle')) return null;
  if (item.kind !== 'code' || !isPlainObject(item.vehicle)) itemError(item, 'vehicle 只能用于 code 且必须是对象');
  const keys = Object.keys(item.vehicle);
  const limits = VEHICLE_LIMITS[item.vehicle.kind];
  if (
    !limits
    || keys.length !== VEHICLE_FIELDS.size
    || keys.some((key) => !VEHICLE_FIELDS.has(key))
  ) {
    itemError(item, 'vehicle 必须精确包含 kind、enterRadius、maxSpeed、maxAcceleration、maxAngularSpeed');
  }
  for (const field of ['enterRadius', 'maxSpeed', 'maxAcceleration', 'maxAngularSpeed']) {
    const value = item.vehicle[field];
    const range = limits[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
      itemError(item, `vehicle.${field} 必须为 ${range.min}–${range.max} 的有限数`);
    }
  }
  return item.vehicle.kind;
}

function declaredVehicleKind(source, item) {
  const declaration = /\bexport\s+const\s+vehicle\s*=/.exec(source);
  if (!declaration) return null;
  const body = source.slice(declaration.index, declaration.index + 1_200);
  const kind = /\bkind\s*:\s*['"](car|aircraft)['"]/.exec(body)?.[1];
  if (!kind) itemError(item, '模块 vehicle 必须声明 kind: car 或 aircraft');
  return kind;
}

async function declaredVehicleValue(source, gameDir, modulePath, item) {
  if (!/\bexport\s+const\s+vehicle\s*=/.test(source)) return null;
  const ts = await loadTypescript(gameDir);
  const file = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const constants = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = evaluatePhysicsExpression(ts, declaration.initializer, constants, item);
      constants.set(declaration.name.text, value);
      if (exported && declaration.name.text === 'vehicle') return value;
    }
  }
  itemError(item, '模块 vehicle 必须是可静态审核的 export const 对象');
}

function validateVehicleEnvelope(item, moduleVehicle) {
  if (!moduleVehicle) return;
  if (!isPlainObject(moduleVehicle) || !isPlainObject(moduleVehicle.physics)) {
    itemError(item, '模块 vehicle/vehicle.physics 必须可静态审核');
  }
  const physics = moduleVehicle.physics;
  let requiredSpeed;
  let requiredAcceleration;
  let requiredAngularSpeed;
  if (moduleVehicle.kind === 'car') {
    requiredSpeed = Math.max(physics.maxForwardSpeed ?? 0, physics.maxReverseSpeed ?? 0);
    requiredAcceleration = Math.max(
      physics.engineAcceleration ?? 0,
      physics.reverseAcceleration ?? 0,
      physics.brakeDeceleration ?? 0,
    );
    requiredAngularSpeed = physics.maxSteerAngle ?? 0;
  } else if (moduleVehicle.kind === 'aircraft') {
    requiredSpeed = physics.maxSpeed ?? 0;
    requiredAcceleration = Math.max(physics.engineAcceleration ?? 0, physics.gravity ?? 0);
    requiredAngularSpeed = Math.max(
      physics.pitchRate ?? 0,
      physics.yawRate ?? 0,
      physics.rollRate ?? 0,
      physics.bankTurnRate ?? 0,
    );
  } else {
    itemError(item, '模块 vehicle.kind 必须为 car 或 aircraft');
  }
  if (![requiredSpeed, requiredAcceleration, requiredAngularSpeed].every((value) => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
  ))) itemError(item, '模块 vehicle 物理包络包含无效数值');
  if (item.vehicle.maxSpeed < requiredSpeed) {
    itemError(item, `目录 vehicle.maxSpeed ${item.vehicle.maxSpeed} 小于模块需要的 ${requiredSpeed}`);
  }
  if (item.vehicle.maxAcceleration < requiredAcceleration) {
    itemError(item, `目录 vehicle.maxAcceleration ${item.vehicle.maxAcceleration} 小于模块需要的 ${requiredAcceleration}`);
  }
  if (item.vehicle.maxAngularSpeed < requiredAngularSpeed) {
    itemError(item, `目录 vehicle.maxAngularSpeed ${item.vehicle.maxAngularSpeed} 小于模块需要的 ${requiredAngularSpeed}`);
  }
}

function declaresPhysics(source) {
  return /\bexport\s+const\s+physics\s*=/.test(source);
}

let typescriptPromise;

async function loadTypescript(gameDir) {
  if (!typescriptPromise) {
    const entry = path.join(gameDir, 'node_modules', 'typescript', 'lib', 'typescript.js');
    typescriptPromise = import(pathToFileURL(entry).href).catch(() => null);
  }
  const typescript = await typescriptPromise;
  if (!typescript) throw new Error('无法加载游戏目录中的 TypeScript，不能审核 physics 模块常量');
  return typescript;
}

function unwrapExpression(ts, expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) current = current.expression;
  return current;
}

function evaluatePhysicsExpression(ts, expression, constants, item) {
  const node = unwrapExpression(ts, expression);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    if (!constants.has(node.text)) itemError(item, `physics 引用了无法静态审核的常量 ${node.text}`);
    return constants.get(node.text);
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'Math' && node.name.text === 'PI') return Math.PI;
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = evaluatePhysicsExpression(ts, node.operand, constants, item);
    if (typeof operand !== 'number') itemError(item, 'physics 一元运算只允许数字');
    if (node.operator === ts.SyntaxKind.MinusToken) return -operand;
    if (node.operator === ts.SyntaxKind.PlusToken) return operand;
    itemError(item, 'physics 包含不允许的一元运算');
  }
  if (ts.isBinaryExpression(node)) {
    const left = evaluatePhysicsExpression(ts, node.left, constants, item);
    const right = evaluatePhysicsExpression(ts, node.right, constants, item);
    if (typeof left !== 'number' || typeof right !== 'number') itemError(item, 'physics 二元运算只允许数字');
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
    if (node.operatorToken.kind === ts.SyntaxKind.SlashToken) return left / right;
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) return left ** right;
    itemError(item, 'physics 包含不允许的二元运算');
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((entry) => evaluatePhysicsExpression(ts, entry, constants, item));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || property.name === undefined) {
        itemError(item, 'physics 对象只允许显式属性赋值');
      }
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        || ts.isNumericLiteral(property.name)
        ? property.name.text
        : null;
      if (!name || Object.hasOwn(value, name)) itemError(item, 'physics 对象包含无效或重复属性');
      value[name] = evaluatePhysicsExpression(ts, property.initializer, constants, item);
    }
    return value;
  }
  itemError(item, `physics 包含无法静态审核的 TypeScript 语法 ${ts.SyntaxKind[node.kind]}`);
}

async function declaredPhysicsValue(source, gameDir, modulePath, item) {
  if (!declaresPhysics(source)) return null;
  const ts = await loadTypescript(gameDir);
  const file = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const constants = new Map();
  let physics = null;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = evaluatePhysicsExpression(ts, declaration.initializer, constants, item);
      constants.set(declaration.name.text, value);
      if (exported && declaration.name.text === 'physics') physics = value;
    }
  }
  if (!physics) itemError(item, '模块 physics 必须是可静态审核的 export const 对象');
  return physics;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(Object.is(value, -0) ? 0 : value);
}

function validateModuleImports(ts, source, modulePath, item) {
  if (/\bimport\s*\(/.test(source)) itemError(item, '不得使用动态 import');
  if (/^\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*\s*(?:as\s+\w+\s*)?)\s+from\s*['"]/m.test(source)) {
    itemError(item, '不得使用再导出');
  }
  const file = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let threeImports = 0;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) itemError(item, '存在无法审核的 import 语句');
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (specifier === 'three') {
      const namespace = clause?.namedBindings;
      if (
        clause?.isTypeOnly
        || clause?.name
        || !namespace
        || !ts.isNamespaceImport(namespace)
        || namespace.name.text !== 'THREE'
      ) {
        itemError(item, 'three 只能使用精确的 import * as THREE from \'three\'');
      }
      threeImports += 1;
      continue;
    }
    if (
      specifier === '../types'
      && clause?.isTypeOnly
      && !clause.name
      && clause.namedBindings
      && ts.isNamedImports(clause.namedBindings)
    ) continue;
    itemError(item, specifier === '../types'
      ? '../types 只能通过 import type { ... } 导入'
      : `禁止导入 ${specifier}；运行时只允许 import * as THREE from 'three'`);
  }
  if (threeImports !== 1) itemError(item, '代码模块必须且只能导入一次 THREE 命名空间');
}

function auditRuntimeAst(ts, source, modulePath, item) {
  const file = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const violation = (message) => itemError(item, `代码模块静态安全检查失败：${message}`);
  const visit = (node) => {
    if (ts.isComputedPropertyName(node)) {
      violation('禁止计算属性名；请使用可静态审核的固定字段');
    }
    if (ts.isIdentifier(node) && FORBIDDEN_RUNTIME_IDENTIFIERS.has(node.text)) {
      violation(`禁止标识符 ${node.text}`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const property = node.name.text;
      if (FORBIDDEN_RUNTIME_PROPERTIES.has(property) || FORBIDDEN_RUNTIME_IDENTIFIERS.has(property)) {
        violation(`禁止属性 ${property}`);
      }
      if (/Loader$/.test(property) || ['LoadingManager', 'Cache', 'ImageUtils'].includes(property)) {
        violation(`禁止 Three.js 资源加载入口 ${property}`);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = unwrapExpression(ts, node.argumentExpression);
      if (!ts.isNumericLiteral(argument)) {
        violation('下标访问只能使用可静态证明的数字字面量');
      }
    }
    if (ts.isBindingElement(node)) {
      const property = node.propertyName ?? node.name;
      const name = ts.isIdentifier(property) || ts.isStringLiteral(property)
        || ts.isNoSubstitutionTemplateLiteral(property)
        ? property.text
        : null;
      if (
        name
        && (
          FORBIDDEN_RUNTIME_PROPERTIES.has(name)
          || FORBIDDEN_RUNTIME_IDENTIFIERS.has(name)
          || /Loader$/.test(name)
          || ['LoadingManager', 'Cache', 'ImageUtils'].includes(name)
        )
      ) violation(`禁止解构属性 ${name}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      violation('禁止动态 import');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

function approvedModulesSource(codeKeys) {
  const sorted = [...codeKeys].sort();
  const imports = sorted.map((code, index) => `import * as module${index} from './generated/${code}';`);
  const entries = sorted.map((_, index) => `  module${index},`);
  return [
    '// Generated from the reviewed platform catalog by whiteroom-lobby-prop.',
    '// Keep this list explicit: import.meta.glob({ eager: true }) would execute',
    '// unregistered or failed-review files merely because they exist on disk.',
    ...imports,
    '',
    'export const approvedLobbyPropModules = [',
    ...entries,
    '] as const;',
    '',
  ].join('\n');
}

async function requireApprovedModulesManifest(gameDir, codeKeys) {
  const manifestPath = path.join(gameDir, APPROVED_MODULES_RELATIVE_PATH);
  const actual = await readFile(manifestPath, 'utf8').catch(() => null);
  const expected = approvedModulesSource(codeKeys);
  if (actual !== expected) {
    throw new Error(`审核模块清单与目录不一致：${manifestPath}；请重新登记，不得使用 eager glob`);
  }
}

async function validateCodeModule(gameDir, item) {
  if (!ID.test(item.code ?? '')) itemError(item, 'code 必须是 kebab-case');
  const modulePath = path.join(gameDir, 'src', 'lobby-props', 'generated', `${item.code}.ts`);
  const info = await stat(modulePath).catch(() => null);
  if (!info?.isFile()) itemError(item, `缺少代码模块 ${modulePath}`);
  if (info.size > MAX_CODE_BYTES) itemError(item, '代码模块超过 100 KB');
  const source = await readFile(modulePath, 'utf8');
  const ts = await loadTypescript(gameDir);
  if (!/export\s+const\s+code\s*=/.test(source) || !/export\s+function\s+createLobbyProp\s*\(/.test(source)) {
    itemError(item, '代码模块缺少 code 或 createLobbyProp 导出');
  }
  const declared = /export\s+const\s+code\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  if (declared !== item.code) itemError(item, '模块 code 与目录不一致');
  const banned = [
    /\b(?:require|importScripts)\s*\(/,
    /\b(?:fetch|eval|Function)\s*\(/,
    /\bnew\s+(?:XMLHttpRequest|WebSocket|Worker)\b/,
    /\b(?:document|localStorage|sessionStorage|navigator|globalThis)\s*[.[]/,
    /\bwindow\s*\.\s*(?:document|fetch|localStorage|sessionStorage|navigator|location|open|postMessage|parent|top|frames|eval|Function|XMLHttpRequest|WebSocket|Worker)\b/,
  ];
  if (banned.some((pattern) => pattern.test(source))) itemError(item, '代码模块包含禁用 API');
  validateModuleImports(ts, source, modulePath, item);
  auditRuntimeAst(ts, source, modulePath, item);
  return {
    vehicleKind: declaredVehicleKind(source, item),
    vehicle: await declaredVehicleValue(source, gameDir, modulePath, item),
    physics: await declaredPhysicsValue(source, gameDir, modulePath, item),
  };
}

async function validateGlb(gameDir, item) {
  if (typeof item.assetUrl !== 'string' || !/^\/generated-assets\/[a-z0-9-]+\.glb$/.test(item.assetUrl)) {
    itemError(item, 'assetUrl 必须是 /generated-assets/ 下的小写单层 .glb 路径');
  }
  const publicRoot = await realpath(path.join(gameDir, 'public'));
  const assetPath = path.resolve(publicRoot, `.${item.assetUrl}`);
  const resolved = await realpath(assetPath).catch(() => null);
  if (!resolved || !resolved.startsWith(`${publicRoot}${path.sep}`)) itemError(item, 'GLB 不在 public 目录');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > MAX_GLB_BYTES) itemError(item, 'GLB 缺失或超过 15 MB');
  const header = (await readFile(resolved)).subarray(0, 12);
  if (header.length < 12 || header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2) {
    itemError(item, 'GLB 不是 glTF 2.0 binary');
  }
}

async function validateCatalog(catalog, gameDir) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error('lobby-catalog.json schema 无效');
  const seen = new Set();
  for (const item of catalog.items) {
    if (!ID.test(item?.id ?? '') || RESERVED.test(item.id)) itemError(item, 'id 无效或使用系统保留词');
    if (seen.has(item.id)) itemError(item, 'id 重复');
    seen.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40) itemError(item, 'name 必须为 1–40 字符');
    if (typeof item.category !== 'string' || !item.category.trim() || item.category.length > 20) itemError(item, 'category 必须为 1–20 字符');
    if (typeof item.defaultScale !== 'number' || item.defaultScale < 0.25 || item.defaultScale > 3) itemError(item, 'defaultScale 必须为 0.25–3');
    const catalogVehicleKind = validateVehicleMetadata(item);
    const catalogPhysics = validatePhysicsMetadata(item);
    if (item.kind === 'code') {
      const module = await validateCodeModule(gameDir, item);
      if (module.vehicleKind !== catalogVehicleKind) {
        itemError(item, '模块 vehicle.kind 与目录 vehicle.kind 必须存在且一致');
      }
      validateVehicleEnvelope(item, module.vehicle);
      if (Boolean(module.physics) !== Boolean(catalogPhysics)) {
        itemError(item, '模块 physics 导出与目录 physics 必须同时存在或同时缺失');
      }
      if (module.physics && canonicalJson(module.physics) !== canonicalJson(item.physics)) {
        itemError(item, '模块 physics 与目录 physics 必须逐字段完全一致');
      }
    } else if (item.kind === 'glb') await validateGlb(gameDir, item);
    else itemError(item, 'kind 必须是 code 或 glb');
  }
  return {
    count: catalog.items.length,
    codeKeys: catalog.items.filter((item) => item.kind === 'code').map((item) => item.code).sort(),
  };
}

async function main() {
  const args = argsFrom(process.argv);
  if (!['check', 'register'].includes(args.command)) {
    console.log('用法：register-prop.mjs check|register --game-dir <dir> --platform-dir <dir> [--physics-file <json>] [登记参数]');
    return;
  }
  const gameDir = required(args.gameDir, 'game-dir');
  const platformDir = required(args.platformDir, 'platform-dir');
  const catalogPath = path.join(platformDir, 'src', 'lobby-catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  if (args.command === 'register') {
    const item = {
      id: args.id,
      name: args.name,
      category: args.category,
      kind: args.kind,
      defaultScale: Number(args.defaultScale ?? 1),
    };
    if (args.kind === 'code') item.code = args.code;
    if (args.kind === 'glb') item.assetUrl = args.assetUrl;
    if (args.physicsFile) {
      if (args.kind !== 'code') throw new Error('只有 --kind code 可以登记 physics');
      const physicsPath = path.resolve(args.physicsFile);
      item.physics = JSON.parse(await readFile(physicsPath, 'utf8'));
    }
    const hasVehicleArguments = VEHICLE_ARGUMENTS.some((key) => Object.hasOwn(args, key));
    if (hasVehicleArguments) {
      if (args.kind !== 'code') throw new Error('只有 --kind code 可以登记载具');
      if (item.physics) throw new Error('physics 与 vehicle 不得同时登记');
      for (const key of VEHICLE_ARGUMENTS) {
        if (!Object.hasOwn(args, key)) throw new Error(`载具登记缺少 --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
      }
      item.vehicle = {
        kind: args.vehicleKind,
        enterRadius: Number(args.enterRadius),
        maxSpeed: Number(args.maxSpeed),
        maxAcceleration: Number(args.maxAcceleration),
        maxAngularSpeed: Number(args.maxAngularSpeed),
      };
    }
    if (catalog.items.some((candidate) => candidate.id === item.id)) throw new Error(`目录已存在 ${item.id}`);
    catalog.items.push(item);
    catalog.items.sort((left, right) => left.id.localeCompare(right.id));
    const validated = await validateCatalog(catalog, gameDir);
    const temporary = `${catalogPath}.${process.pid}.${Date.now()}.tmp`;
    const approvedPath = path.join(gameDir, APPROVED_MODULES_RELATIVE_PATH);
    const approvedTemporary = `${approvedPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    await writeFile(approvedTemporary, approvedModulesSource(validated.codeKeys), { flag: 'wx', mode: 0o644 });
    // Fail closed on interruption: the catalog is committed before its import
    // manifest, so an incomplete registration cannot execute an unapproved file.
    await rename(temporary, catalogPath);
    await rename(approvedTemporary, approvedPath);
    console.log(JSON.stringify({ ok: true, action: 'registered', item, catalogPath }, null, 2));
    return;
  }

  const validated = await validateCatalog(catalog, gameDir);
  await requireApprovedModulesManifest(gameDir, validated.codeKeys);
  console.log(JSON.stringify({ ok: true, action: 'checked', items: validated.count, catalogPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
