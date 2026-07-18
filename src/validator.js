import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parse } from 'acorn';
import { ValidationError } from './errors.js';

const MIB = 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 40 * MIB;
const MAX_MAIN_BYTES = 2 * MIB;
const MAX_GLB_BYTES = 15 * MIB;
const MAX_AUDIO_BYTES = 10 * MIB;
const MAX_COVER_BYTES = 512 * 1024;
export const MAX_SOLUTION_BYTES = 1 * MIB;
const MAX_TEXTURE_DIMENSION = 2048;
const MAX_FILES = 512;

export const LEVEL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{6}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const WIN_TYPES = new Set([
  'reach_zone',
  'collect',
  'puzzle',
  'survive',
  'eliminate',
  'escape',
  'custom',
]);
const ALLOWED_EXTENSIONS = new Set([
  '.json',
  '.js',
  '.md',
  '.glb',
  '.gltf',
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ktx2',
  '.mp3',
  '.ogg',
]);

const FORBIDDEN_CODE = [
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['eval', /\beval\b/],
  ['Function constructor', /\bFunction\b/],
  ['dynamic import', /\bimport\s*\(/],
  ['static import', /(^|[;{}]\s*)import\s+(?!\()/m],
  ['CommonJS require', /\brequire\s*\(/],
  ['document', /\bdocument\b/],
  ['window.top/parent/open', /\bwindow\s*(?:\.\s*(?:top|parent|open)\b|\[\s*['"](?:top|parent|open)['"]\s*\])/],
  ['browser storage', /\b(?:localStorage|sessionStorage|indexedDB)\b/],
  ['Worker', /\b(?:Worker|SharedWorker|ServiceWorker)\b/],
  ['navigator', /\bnavigator\b/],
  ['Audio constructor', /\bnew\s+Audio\s*\(/],
  ['globalThis', /\bglobalThis\b/],
  ['computed forbidden API', /\[\s*['"](?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|localStorage|sessionStorage|indexedDB)['"]\s*\]/],
  ['bundled/imported three', /\bfrom\s*['"]three(?:\/[^'"]*)?['"]|\brequire\s*\(\s*['"]three(?:\/[^'"]*)?['"]|\bREVISION\s*=\s*['"]\d+/],
];
const FORBIDDEN_IDENTIFIERS = new Map([
  ['fetch', 'fetch'],
  ['XMLHttpRequest', 'XMLHttpRequest'],
  ['WebSocket', 'WebSocket'],
  ['EventSource', 'EventSource'],
  ['sendBeacon', 'sendBeacon'],
  ['eval', 'eval'],
  ['Function', 'Function constructor'],
  ['document', 'document'],
  ['window', 'window'],
  ['globalThis', 'globalThis'],
  ['localStorage', 'browser storage'],
  ['sessionStorage', 'browser storage'],
  ['indexedDB', 'browser storage'],
  ['Worker', 'Worker'],
  ['SharedWorker', 'Worker'],
  ['ServiceWorker', 'Worker'],
  ['navigator', 'navigator'],
  ['require', 'CommonJS require'],
]);

function codePointLength(value) {
  return [...value].length;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateString(errors, value, field, maximum, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
    return;
  }
  if (codePointLength(value) > maximum) errors.push(`${field} must be at most ${maximum} characters`);
}

function validateVec3(errors, value, field) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finiteNumber)) {
    errors.push(`${field} must be an array of three finite numbers`);
  }
}

function validateFlags(errors, value, field) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 64 ||
    value.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item)) ||
    new Set(value).size !== value.length
  ) {
    errors.push(`${field} must contain 1-64 unique flag names`);
  }
}

function validateWinCondition(errors, manifest) {
  const win = manifest.winCondition;
  if (!isObject(win) || !WIN_TYPES.has(win.type)) {
    errors.push('winCondition.type must be one supported win condition');
    return;
  }
  if (win.type === 'collect' && (!Number.isInteger(win.required) || win.required < 1)) {
    errors.push('winCondition.required must be an integer >= 1 for collect');
  }
  if (win.type === 'survive' && (!finiteNumber(win.duration) || win.duration <= 0)) {
    errors.push('winCondition.duration must be > 0 for survive');
  }
  if (win.type === 'puzzle' || win.type === 'escape') {
    validateFlags(errors, win.flags, 'winCondition.flags');
  }
  for (const field of ['timeLimit', 'parTime']) {
    if (win[field] !== undefined && (!finiteNumber(win[field]) || win[field] <= 0 || win[field] > 86400)) {
      errors.push(`winCondition.${field} must be between 0 and 86400 seconds`);
    }
  }
  if (win.type === 'custom') {
    validateString(errors, manifest.objectiveDetail, 'objectiveDetail', 500);
  }
}

function validateManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) throw new ValidationError('level.json must contain a JSON object');

  if (manifest.schema !== 'wr-level') errors.push('schema must equal "wr-level"');
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (manifest.engineApi !== '1') errors.push('engineApi must equal "1"');
  if (typeof manifest.id !== 'string' || !LEVEL_ID_PATTERN.test(manifest.id)) {
    errors.push('id must be a kebab slug ending in a six-character lowercase hex suffix');
  }
  validateString(errors, manifest.name, 'name', 24);
  if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push('version must be valid semantic versioning');
  }
  if (!isObject(manifest.author)) {
    errors.push('author must be an object');
  } else {
    validateString(errors, manifest.author.name, 'author.name', 60);
    validateString(errors, manifest.author.contact, 'author.contact', 200, { optional: true });
  }
  validateString(errors, manifest.description, 'description', 120);
  if (typeof manifest.language !== 'string' || !LANGUAGE_PATTERN.test(manifest.language)) {
    errors.push('language must be a BCP-47 language tag');
  }
  if (typeof manifest.type !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(manifest.type)) {
    errors.push('type must be a lowercase gameplay type');
  }
  validateString(errors, manifest.objective, 'objective', 30);
  if (!Number.isInteger(manifest.difficulty) || manifest.difficulty < 1 || manifest.difficulty > 5) {
    errors.push('difficulty must be an integer from 1 to 5');
  }
  if (
    !Number.isInteger(manifest.estimatedMinutes) ||
    manifest.estimatedMinutes < 1 ||
    manifest.estimatedMinutes > 120
  ) {
    errors.push('estimatedMinutes must be an integer from 1 to 120');
  }

  if (!isObject(manifest.spawn)) {
    errors.push('spawn must be an object');
  } else {
    validateVec3(errors, manifest.spawn.position, 'spawn.position');
    if (!finiteNumber(manifest.spawn.yawDeg)) errors.push('spawn.yawDeg must be a finite number');
  }
  if (manifest.door !== null) {
    if (!isObject(manifest.door)) {
      errors.push('door must be null or an object');
    } else {
      validateVec3(errors, manifest.door.anchor, 'door.anchor');
      if (!finiteNumber(manifest.door.yawDeg)) errors.push('door.yawDeg must be a finite number');
    }
  }
  if (!finiteNumber(manifest.killY)) errors.push('killY must be a finite number');
  if (manifest.entry !== 'main.js') errors.push('entry must equal "main.js"');
  if (manifest.cover !== 'cover.png') errors.push('cover must equal "cover.png"');
  if (manifest.contentRating !== 'everyone') errors.push('contentRating must equal "everyone"');

  if (manifest.tags !== undefined) {
    if (
      !Array.isArray(manifest.tags) ||
      manifest.tags.length > 5 ||
      manifest.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || codePointLength(tag) > 24)
    ) {
      errors.push('tags must contain at most five non-empty strings of 24 characters or fewer');
    }
  }
  if (manifest.credits !== undefined) {
    if (
      !Array.isArray(manifest.credits) ||
      manifest.credits.length > 50 ||
      manifest.credits.some((credit) => typeof credit !== 'string' || codePointLength(credit) > 200)
    ) {
      errors.push('credits must be an array of at most 50 strings');
    }
  }
  if (
    manifest.assetsManifest !== undefined &&
    (typeof manifest.assetsManifest !== 'string' ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.json$/.test(manifest.assetsManifest) ||
      manifest.assetsManifest.includes('..'))
  ) {
    errors.push('assetsManifest must be a safe relative JSON path');
  }
  validateWinCondition(errors, manifest);

  if (errors.length) throw new ValidationError('level.json does not match schema v1', errors);
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) {
    throw new ValidationError('PNG file has an invalid signature');
  }
  let offset = 8;
  let width;
  let height;
  let hasImageData = false;
  let hasEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > buffer.length) throw new ValidationError('PNG chunk exceeds the file boundary');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) {
      throw new ValidationError('PNG is missing a valid IHDR chunk');
    }
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    } else if (type === 'IDAT') {
      hasImageData = true;
    } else if (type === 'IEND') {
      hasEnd = length === 0;
      if (next !== buffer.length) throw new ValidationError('PNG has trailing data after IEND');
      break;
    }
    offset = next;
  }
  if (!width || !height || !hasImageData || !hasEnd) {
    throw new ValidationError('PNG is incomplete');
  }
  return { width, height };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new ValidationError('JPEG file has an invalid signature');
  }
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new ValidationError('JPEG dimensions could not be read');
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new ValidationError('WebP file has an invalid signature');
  }
  const type = buffer.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (type === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (type === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new ValidationError('WebP dimensions could not be read');
}

function ktx2Dimensions(buffer) {
  const signature = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 68 || !buffer.subarray(0, 12).equals(signature)) {
    throw new ValidationError('KTX2 file has an invalid header');
  }
  return { width: buffer.readUInt32LE(20), height: buffer.readUInt32LE(24) };
}

function imageDimensions(extension, buffer) {
  if (extension === '.png') return pngDimensions(buffer);
  if (extension === '.jpg' || extension === '.jpeg') return jpegDimensions(buffer);
  if (extension === '.webp') return webpDimensions(buffer);
  if (extension === '.ktx2') return ktx2Dimensions(buffer);
  throw new ValidationError(`Unsupported texture format: ${extension}`);
}

async function walkFiles(root, directory = root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new ValidationError('Package may not contain symbolic links');
    if (entry.isDirectory()) {
      await walkFiles(root, absolute, files);
    } else if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({
        absolute,
        relative: path.relative(root, absolute).split(path.sep).join('/'),
        size: info.size,
      });
    } else {
      throw new ValidationError('Package may contain only files and directories');
    }
  }
  return files;
}

function memberPropertyName(node) {
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return null;
}

function inspectAst(ast) {
  const violations = new Set();
  let hasDefaultExport = false;
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'ExportDefaultDeclaration') hasDefaultExport = true;
    if (
      node.type === 'ExportSpecifier' &&
      (node.exported?.name === 'default' || node.exported?.value === 'default')
    ) {
      hasDefaultExport = true;
    }
    if (node.type === 'ImportDeclaration') violations.add('static import');
    if (node.type === 'ImportExpression') violations.add('dynamic import');
    if (node.type === 'MetaProperty' && node.meta?.name === 'import') violations.add('import.meta');
    if (node.type === 'Identifier' && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      violations.add(FORBIDDEN_IDENTIFIERS.get(node.name));
    }
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'Audio') {
      violations.add('Audio constructor');
    }
    if (node.type === 'MemberExpression') {
      const property = memberPropertyName(node);
      if (property && FORBIDDEN_IDENTIFIERS.has(property)) {
        violations.add(FORBIDDEN_IDENTIFIERS.get(property));
      }
      if (
        node.object?.type === 'Identifier' &&
        node.object.name === 'window' &&
        ['top', 'parent', 'open'].includes(property)
      ) {
        violations.add('window.top/parent/open');
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end' || key === 'loc') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) stack.push(child);
      } else if (value?.type) {
        stack.push(value);
      }
    }
  }
  return { violations, hasDefaultExport };
}

function validateMainCode(source) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    throw new ValidationError('main.js is not valid JavaScript', {
      line: error.loc?.line,
      column: error.loc?.column,
      reason: error.message,
    });
  }
  const inspected = inspectAst(ast);
  const violations = new Set(inspected.violations);
  for (const [name, expression] of FORBIDDEN_CODE) {
    if (expression.test(source)) violations.add(name);
  }
  if (violations.size) {
    throw new ValidationError('main.js uses forbidden or non-self-contained APIs', [...violations].sort());
  }
  if (!inspected.hasDefaultExport) {
    throw new ValidationError('main.js must provide a default ES module export');
  }
}

function validateGlb(buffer, relative) {
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'glTF' ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length
  ) {
    throw new ValidationError(`GLB header is invalid: ${relative}`);
  }
}

export async function validatePackage(packageRoot, { archiveSize }) {
  if (archiveSize > MAX_ARCHIVE_BYTES) {
    throw new ValidationError('.wrlevel archive exceeds 40 MB');
  }
  const files = await walkFiles(packageRoot);
  if (files.length > MAX_FILES) throw new ValidationError(`Package contains more than ${MAX_FILES} files`);
  const byPath = new Map(files.map((file) => [file.relative, file]));
  for (const required of ['level.json', 'main.js', 'solution.md', 'cover.png']) {
    if (!byPath.has(required)) throw new ValidationError(`Required file is missing: ${required}`);
  }

  for (const file of files) {
    const extension = path.posix.extname(file.relative).toLowerCase();
    if (extension === '.wav') throw new ValidationError('WAV audio is not allowed');
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new ValidationError(`Unsupported package file type: ${file.relative}`);
    }
    if (extension === '.js' && file.relative !== 'main.js') {
      throw new ValidationError('main.js must be the package\'s only JavaScript file');
    }
  }

  const levelFile = byPath.get('level.json');
  if (levelFile.size > 256 * 1024) throw new ValidationError('level.json exceeds 256 KB');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(levelFile.absolute, 'utf8'));
  } catch {
    throw new ValidationError('level.json must be valid UTF-8 JSON');
  }
  validateManifest(manifest);

  if (manifest.assetsManifest && !byPath.has(manifest.assetsManifest)) {
    throw new ValidationError(`assetsManifest does not exist: ${manifest.assetsManifest}`);
  }
  if (manifest.assetsManifest) {
    try {
      JSON.parse(await readFile(byPath.get(manifest.assetsManifest).absolute, 'utf8'));
    } catch {
      throw new ValidationError('assetsManifest must contain valid JSON');
    }
  }

  const mainFile = byPath.get('main.js');
  if (mainFile.size > MAX_MAIN_BYTES) throw new ValidationError('main.js exceeds 2 MB');
  let mainSource;
  try {
    mainSource = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(mainFile.absolute));
  } catch {
    throw new ValidationError('main.js must be valid UTF-8');
  }
  validateMainCode(mainSource);

  const solutionFile = byPath.get('solution.md');
  if (solutionFile.size > MAX_SOLUTION_BYTES) throw new ValidationError('solution.md exceeds 1 MB');
  const solution = await readFile(solutionFile.absolute, 'utf8');
  if (!solution.trim()) throw new ValidationError('solution.md must not be empty');

  const coverFile = byPath.get('cover.png');
  if (coverFile.size > MAX_COVER_BYTES) throw new ValidationError('cover.png exceeds 512 KB');
  const cover = await readFile(coverFile.absolute);
  const coverSize = pngDimensions(cover);
  if (coverSize.width < 960 || coverSize.height < 540 || coverSize.width * 9 !== coverSize.height * 16) {
    throw new ValidationError('cover.png must be 16:9 and at least 960x540');
  }

  let audioBytes = 0;
  for (const file of files) {
    const extension = path.posix.extname(file.relative).toLowerCase();
    if (extension === '.glb') {
      if (file.size > MAX_GLB_BYTES) throw new ValidationError(`GLB exceeds 15 MB: ${file.relative}`);
      validateGlb(await readFile(file.absolute), file.relative);
    }
    if (extension === '.mp3' || extension === '.ogg') audioBytes += file.size;
    if (['.png', '.jpg', '.jpeg', '.webp', '.ktx2'].includes(extension)) {
      const dimensions = imageDimensions(extension, await readFile(file.absolute));
      if (dimensions.width > MAX_TEXTURE_DIMENSION || dimensions.height > MAX_TEXTURE_DIMENSION) {
        throw new ValidationError(`Texture exceeds 2048px: ${file.relative}`);
      }
    }
  }
  if (audioBytes > MAX_AUDIO_BYTES) throw new ValidationError('Combined MP3/OGG audio exceeds 10 MB');

  return {
    manifest,
    fileCount: files.length,
    uncompressedBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}
