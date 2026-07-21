import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const LEVEL_TYPES = new Set([
  'reach_zone', 'collect', 'puzzle', 'survive', 'eliminate', 'escape', 'custom',
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) {
      out[rawKey] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      out[rawKey] = argv[index + 1];
      index += 1;
    } else {
      out[rawKey] = true;
    }
  }
  return out;
}

export function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  if (slug) return slug;
  return `white-room-${createHash('sha256').update(String(value)).digest('hex').slice(0, 8)}`;
}

export function characterLength(value) {
  return Array.from(String(value ?? '')).length;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

export async function createCoverPng(filePath, { width = 960, height = 540, accent = '#38d9ff' } = {}) {
  const hex = accent.replace('#', '').padEnd(6, '0');
  const accentRgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const horizon = height * 0.42;
      const below = y > horizon;
      const gridX = below && Math.abs((x - width / 2) % Math.max(12, (y - horizon) * 0.18)) < 1.2;
      const gridY = below && Math.abs((y - horizon) % Math.max(9, (y - horizon) * 0.16)) < 1.1;
      const portal = Math.abs(x - width * 0.72) < width * 0.055 && Math.abs(y - height * 0.43) < height * 0.2;
      const portalEdge = portal && (
        Math.abs(Math.abs(x - width * 0.72) - width * 0.05) < 4
        || Math.abs(Math.abs(y - height * 0.43) - height * 0.19) < 4
      );
      const shade = below
        ? 218 - Math.round(((y - horizon) / (height - horizon)) * 64)
        : 239 - Math.round((y / horizon) * 22);
      const index = row + 1 + x * 3;
      if (portalEdge || gridX || gridY) {
        raw[index] = accentRgb[0];
        raw[index + 1] = accentRgb[1];
        raw[index + 2] = accentRgb[2];
      } else if (portal) {
        raw[index] = Math.round((shade + accentRgb[0]) * 0.42);
        raw[index + 1] = Math.round((shade + accentRgb[1]) * 0.42);
        raw[index + 2] = Math.round((shade + accentRgb[2]) * 0.42);
      } else {
        raw[index] = shade;
        raw[index + 1] = Math.min(255, shade + 3);
        raw[index + 2] = Math.min(255, shade + 7);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await fs.writeFile(filePath, png);
  return { width, height, bytes: png.length };
}

export async function walkLevelFiles(root) {
  const entries = [];
  async function visit(current, relative = '') {
    const dirents = await fs.readdir(current, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const dirent of dirents) {
      if (dirent.name === '.DS_Store' || dirent.name === '.git' || dirent.name === 'dist') continue;
      const absolute = path.join(current, dirent.name);
      const rel = path.posix.join(relative, dirent.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`E_SYMLINK: 不允许符号链接：${rel}`);
      if (stat.isDirectory()) await visit(absolute, rel);
      else if (stat.isFile() && !rel.endsWith('.wrlevel')) entries.push({ absolute, relative: rel, stat });
      else if (!stat.isFile()) throw new Error(`E_SPECIAL_FILE: 不允许特殊文件：${rel}`);
    }
  }
  await visit(root);
  return entries;
}

function readImageDimensions(buffer, extension) {
  if (extension === '.png' && buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }
  if ((extension === '.jpg' || extension === '.jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: 'jpeg' };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (extension === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buffer.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3), format: 'webp' };
    if (kind === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'webp' };
    }
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), format: 'webp' };
    }
  }
  return null;
}

function isFiniteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function hasSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 160) return false;
  if (value.includes('\\') || value.includes('\0') || value.includes('?') || value.includes('#')) return false;
  if (/^(?:[a-z]+:|\/)/i.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.startsWith('../') && !normalized.includes('/../');
}

const FORBIDDEN_CODE = [
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['dynamic import', /\bimport\s*\(/],
  ['document', /\bdocument\s*[.\[]/],
  ['window escape', /\bwindow\s*\.\s*(?:top|parent|open)\b/],
  ['storage', /\b(?:localStorage|sessionStorage|indexedDB)\b/],
  ['worker', /\b(?:Worker|SharedWorker|ServiceWorker)\b/],
  ['navigator', /\bnavigator\s*[.\[]/],
  ['remote source map', /\/\/[#@]\s*sourceMappingURL\s*=\s*https?:/i],
];

export async function validateLevel(levelDir, { packedBytes = null } = {}) {
  const root = path.resolve(levelDir);
  const errors = [];
  const warnings = [];
  const error = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  let files = [];
  try {
    files = await walkLevelFiles(root);
  } catch (caught) {
    error('E_PACKAGE_FILE', caught.message);
  }
  const byPath = new Map(files.map((item) => [item.relative, item]));
  for (const required of ['level.json', 'main.js', 'solution.md', 'cover.png']) {
    if (!byPath.has(required)) error('E_REQUIRED_FILE', `缺少 ${required}`);
  }

  let manifest = null;
  if (byPath.has('level.json')) {
    try {
      const raw = await fs.readFile(byPath.get('level.json').absolute, 'utf8');
      manifest = JSON.parse(raw);
    } catch (caught) {
      error('E_LEVEL_JSON', `level.json 不是有效 JSON：${caught.message}`);
    }
  }

  if (manifest) {
    if (manifest.schema !== 'wr-level') error('E_SCHEMA', 'schema 必须为 wr-level');
    if (manifest.schemaVersion !== 1) error('E_SCHEMA_VERSION', 'schemaVersion 必须为 1');
    if (manifest.engineApi !== '1') error('E_ENGINE_API', 'engineApi 必须为 "1"');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{6}$/.test(manifest.id ?? '')) error('E_ID', 'id 必须为 kebab-slug-6位十六进制');
    if (typeof manifest.name !== 'string' || characterLength(manifest.name) < 1 || characterLength(manifest.name) > 24) error('E_NAME', 'name 必须为 1–24 字符');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) error('E_VERSION', 'version 必须是 semver');
    if (!manifest.author || typeof manifest.author.name !== 'string' || !manifest.author.name.trim()) error('E_AUTHOR', 'author.name 必填');
    if (typeof manifest.description !== 'string' || characterLength(manifest.description) < 1 || characterLength(manifest.description) > 120) error('E_DESCRIPTION', 'description 必须为 1–120 字符');
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(manifest.language ?? '')) error('E_LANGUAGE', 'language 必须是 BCP-47，例如 zh-CN');
    if (!LEVEL_TYPES.has(manifest.type)) error('E_TYPE', `未知类型：${manifest.type}`);
    if (!manifest.winCondition || manifest.winCondition.type !== manifest.type) error('E_TYPE_MISMATCH', 'type 必须等于 winCondition.type');
    if (typeof manifest.objective !== 'string' || characterLength(manifest.objective) < 1 || characterLength(manifest.objective) > 30) error('E_OBJECTIVE', 'objective 必须为 1–30 字符');
    if (!Number.isInteger(manifest.difficulty) || manifest.difficulty < 1 || manifest.difficulty > 5) error('E_DIFFICULTY', 'difficulty 必须是 1–5 的整数');
    if (!Number.isInteger(manifest.estimatedMinutes) || manifest.estimatedMinutes < 1 || manifest.estimatedMinutes > 15) error('E_ESTIMATED_MINUTES', 'estimatedMinutes 必须是 1–15 的整数');
    if (!manifest.spawn || !isFiniteVector(manifest.spawn.position) || !Number.isFinite(manifest.spawn.yawDeg)) error('E_SPAWN', 'spawn 需要有限 position[3] 与 yawDeg');
    if (manifest.door !== null && (!manifest.door || !isFiniteVector(manifest.door.anchor) || !Number.isFinite(manifest.door.yawDeg))) error('E_DOOR', 'door 必须为 null 或有限 anchor[3] 与 yawDeg');
    if (!Number.isFinite(manifest.killY)) error('E_KILL_Y', 'killY 必须是有限数字');
    if (manifest.entry !== 'main.js' || !hasSafeRelativePath(manifest.entry)) error('E_ENTRY', 'v1 entry 必须为 main.js');
    if (manifest.cover !== 'cover.png' || !hasSafeRelativePath(manifest.cover)) error('E_COVER_PATH', 'v1 cover 必须为 cover.png');
    if (manifest.assetsManifest && !hasSafeRelativePath(manifest.assetsManifest)) error('E_ASSET_MANIFEST', 'assetsManifest 必须是安全包内相对路径');
    if (manifest.contentRating !== 'everyone') error('E_RATING', 'v1 contentRating 只允许 everyone');
    if (manifest.tags && (!Array.isArray(manifest.tags) || manifest.tags.length > 5 || new Set(manifest.tags).size !== manifest.tags.length)) error('E_TAGS', 'tags 必须是不重复且最多 5 项的数组');

    const win = manifest.winCondition ?? {};
    if (win.timeLimit !== undefined && (!Number.isFinite(win.timeLimit) || win.timeLimit <= 0)) error('E_TIME_LIMIT', 'timeLimit 必须是正数');
    if (win.parTime !== undefined && (!Number.isFinite(win.parTime) || win.parTime <= 0)) error('E_PAR_TIME', 'parTime 必须是正数');
    if (manifest.type === 'collect' && (!Number.isInteger(win.required) || win.required < 1)) error('E_WIN_REQUIRED', 'collect 需要 required 整数 ≥1');
    if (manifest.type === 'survive' && (!Number.isFinite(win.duration) || win.duration <= 0)) error('E_WIN_REQUIRED', 'survive 需要 duration 正数');
    if (manifest.type === 'puzzle' || manifest.type === 'escape') {
      if (!Array.isArray(win.flags) || win.flags.length < 1 || win.flags.some((flag) => typeof flag !== 'string' || !flag) || new Set(win.flags).size !== win.flags.length) {
        error('E_WIN_REQUIRED', `${manifest.type} 需要非空且不重复的 flags`);
      }
    }
    if (manifest.type === 'custom' && (typeof manifest.objectiveDetail !== 'string' || !manifest.objectiveDetail.trim())) error('E_WIN_REQUIRED', 'custom 需要 objectiveDetail');
  }

  if (byPath.has('solution.md')) {
    const solution = await fs.readFile(byPath.get('solution.md').absolute, 'utf8');
    if (solution.trim().length < 20) error('E_SOLUTION', 'solution.md 必须包含可执行的通关路径');
  }

  let source = '';
  if (byPath.has('main.js')) {
    const main = byPath.get('main.js');
    if (main.stat.size > 2 * 1024 * 1024) error('E_BUDGET', 'main.js 超过 2MB');
    source = await fs.readFile(main.absolute, 'utf8');
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
    if (syntax.status !== 0) error('E_JS_SYNTAX', (syntax.stderr || syntax.stdout).trim());
    if (!/\bexport\s+default\s+(?:async\s+)?function\b/.test(source)) error('E_ENTRY_EXPORT', 'main.js 必须默认导出 createLevel 函数');
    if (/\bimport\s+(?!\()|\bexport\s+(?!default\b)/.test(source)) error('E_SELF_CONTAINED', 'main.js 必须自包含，只允许 default export');
    if (/\b(?:from\s*|import\s*)[('"\s]*three(?:\/|['")])/i.test(source) || /three\.module(?:\.min)?\.js/i.test(source)) error('E_BUNDLED_THREE', '不得导入或打包 Three.js；使用 sdk.THREE');
    for (const [name, pattern] of FORBIDDEN_CODE) if (pattern.test(source)) error('E_FORBIDDEN_API', `main.js 使用了禁止 API：${name}`);

    if (manifest) {
      const goalCount = (source.match(/goal\s*:\s*true/g) ?? []).length;
      const collectibleCount = (source.match(/\.collectible\s*\(/g) ?? []).length;
      const targetCount = (source.match(/\.target\s*\(/g) ?? []).length;
      if ((manifest.type === 'reach_zone' || manifest.type === 'escape') && goalCount < 1) error('E_RUNTIME_REGISTRATION', `${manifest.type} 必须注册 goal:true 区域`);
      if (manifest.type === 'collect') {
        if (collectibleCount < 1) error('E_RUNTIME_REGISTRATION', 'collect 必须注册 collectible');
        else if (collectibleCount < manifest.winCondition.required) warn('W_RUNTIME_COUNT', '静态扫描看到的 collectible 少于 required；若使用循环创建，请在真实 Shell 验证数量');
      }
      if (manifest.type === 'eliminate' && targetCount < 1) error('E_RUNTIME_REGISTRATION', 'eliminate 必须注册 target');
      if (manifest.type === 'puzzle' || manifest.type === 'escape') {
        for (const flag of manifest.winCondition.flags ?? []) {
          if (!source.includes(JSON.stringify(flag)) && !source.includes(`'${flag}'`)) error('E_RUNTIME_REGISTRATION', `代码未引用 flag：${flag}`);
        }
      }
      if (manifest.type === 'custom' && !/\.state\.complete\s*\(/.test(source)) error('E_RUNTIME_REGISTRATION', 'custom 必须调用 sdk.state.complete()');
    }
  }

  if (byPath.has('cover.png')) {
    const cover = byPath.get('cover.png');
    const buffer = await fs.readFile(cover.absolute);
    const dimensions = readImageDimensions(buffer, '.png');
    if (!dimensions) error('E_COVER_FORMAT', 'cover.png 不是有效 PNG');
    else {
      if (dimensions.width < 960 || dimensions.height < 540) error('E_COVER_SIZE', 'cover.png 至少 960×540');
      if (Math.abs(dimensions.width / dimensions.height - 16 / 9) > 0.015) error('E_COVER_ASPECT', 'cover.png 必须为 16:9');
    }
    if (cover.stat.size > 512 * 1024) error('E_COVER_SIZE', 'cover.png 超过 512KB');
  }

  let audioBytes = 0;
  let rawBytes = 0;
  for (const item of files) {
    rawBytes += item.stat.size;
    const extension = path.extname(item.relative).toLowerCase();
    if (item.relative.includes('..') || item.relative.includes('\\') || item.relative.length > 180) error('E_PATH', `不安全路径：${item.relative}`);
    const allowedRoot = ['level.json', 'main.js', 'solution.md', 'cover.png', 'asset_manifest.json'].includes(item.relative) || item.relative.startsWith('assets/');
    if (!allowedRoot) error('E_PACKAGE_FILE', `包根含未知文件：${item.relative}`);
    if (extension === '.glb' && item.stat.size > 15 * 1024 * 1024) error('E_BUDGET', `${item.relative} 超过 15MB`);
    if (extension === '.wav') error('E_AUDIO_FORMAT', `禁止 WAV：${item.relative}`);
    if (extension === '.mp3' || extension === '.ogg') audioBytes += item.stat.size;
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension) && item.relative !== 'cover.png') {
      const buffer = await fs.readFile(item.absolute);
      const dimensions = readImageDimensions(buffer, extension);
      if (!dimensions) error('E_TEXTURE_FORMAT', `无法解析贴图：${item.relative}`);
      else if (dimensions.width > 2048 || dimensions.height > 2048) error('E_BUDGET', `${item.relative} 单边超过 2048px`);
    }
  }
  if (audioBytes > 10 * 1024 * 1024) error('E_BUDGET', '音频总量超过 10MB');
  if (rawBytes > 80 * 1024 * 1024) error('E_BUDGET', '解压后总量超过 80MB');
  if (files.length > 256) error('E_BUDGET', '文件数量超过 256');
  if (packedBytes !== null && packedBytes > 40 * 1024 * 1024) error('E_BUDGET', '.wrlevel 超过 40MB');

  return { valid: errors.length === 0, errors, warnings, manifest, files, rawBytes };
}

export function formatValidation(result) {
  const lines = [];
  for (const issue of result.errors) lines.push(`✗ [${issue.code}] ${issue.message}`);
  for (const issue of result.warnings) lines.push(`! [${issue.code}] ${issue.message}`);
  if (result.valid) lines.push(`✓ 校验通过：${result.files.length} 个文件，${result.rawBytes} bytes`);
  return lines.join('\n');
}

function normalizedManifest(manifest) {
  const copy = structuredClone(manifest);
  const slug = String(copy.id ?? 'white-room-level').replace(/-[0-9a-f]{6}$/i, '');
  copy.id = `${slugify(slug)}-000000`;
  return Buffer.from(`${JSON.stringify(copy, null, 2)}\n`, 'utf8');
}

export async function contentHashForLevel(levelDir, files, manifest) {
  const hash = createHash('sha256');
  for (const item of [...files].sort((a, b) => a.relative.localeCompare(b.relative, 'en'))) {
    const data = item.relative === 'level.json' ? normalizedManifest(manifest) : await fs.readFile(item.absolute);
    const name = Buffer.from(item.relative, 'utf8');
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32LE(name.length, 0);
    lengths.writeUInt32LE(data.length, 4);
    hash.update(lengths).update(name).update(data);
  }
  return hash.digest('hex');
}

export function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

export async function packLevel(levelDir, outDir) {
  const root = path.resolve(levelDir);
  let validation = await validateLevel(root);
  if (!validation.valid) {
    const caught = new Error(formatValidation(validation));
    caught.validation = validation;
    throw caught;
  }
  const fullHash = await contentHashForLevel(root, validation.files, validation.manifest);
  const baseSlug = slugify(validation.manifest.id.replace(/-[0-9a-f]{6}$/i, ''));
  const levelId = `${baseSlug}-${fullHash.slice(0, 6)}`;
  if (validation.manifest.id !== levelId) {
    const nextManifest = { ...validation.manifest, id: levelId };
    await fs.writeFile(path.join(root, 'level.json'), `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    validation = await validateLevel(root);
    if (!validation.valid) throw new Error(formatValidation(validation));
  }
  const entries = [];
  for (const item of validation.files) entries.push({ name: item.relative, data: await fs.readFile(item.absolute) });
  const zip = createStoredZip(entries.sort((a, b) => a.name.localeCompare(b.name, 'en')));
  const destination = path.resolve(outDir ?? path.join(root, 'dist'));
  await fs.mkdir(destination, { recursive: true });
  const outputPath = path.join(destination, `${levelId}.wrlevel`);
  await fs.writeFile(outputPath, zip);
  const packedValidation = await validateLevel(root, { packedBytes: zip.length });
  if (!packedValidation.valid) {
    await fs.rm(outputPath, { force: true });
    throw new Error(formatValidation(packedValidation));
  }
  return { outputPath, levelId, contentHash: fullHash, packageHash: sha256(zip), bytes: zip.length, validation: packedValidation };
}

export function isDirectExecution(metaUrl) {
  return process.argv[1] ? metaUrl === pathToFileURL(path.resolve(process.argv[1])).href : false;
}
