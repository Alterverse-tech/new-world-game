import { createHash } from 'node:crypto';
import { open, mkdir, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { HttpError } from './errors.js';
import { FixedWindowCounter } from './lobby.js';
import { atomicWriteJson } from './store.js';

export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
export const MAX_AVATARS = 1_000;
export const MAX_AVATAR_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_AVATARS_PER_OWNER = 10;
export const AVATAR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{8,63}$/;
export const AVATAR_OWNER_ID_PATTERN = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AVATAR_BUDGETS = Object.freeze({
  nodes: 256,
  meshes: 64,
  primitives: 256,
  accessors: 1_024,
  bufferViews: 1_024,
  materials: 128,
  textures: 128,
  images: 64,
  samplers: 128,
  scenes: 32,
  animations: 32,
  animationChannels: 256,
  animationSamplers: 256,
  skins: 16,
  joints: 256,
  vertices: 500_000,
  indices: 1_500_000,
  triangles: 500_000,
  morphTargets: 128,
  instances: 200,
  accessorElements: 3_000_000,
  texturePixels: 8_388_608,
});

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_TEXTURE_DIMENSION = 2_048;
const MAX_STRICT_JSON_NUMBER = 1_000_000_000_000;
const MAX_STRICT_WORLD_MATRIX_COMPONENT = 1_000_000_000_000;
const AFFINE_EPSILON = 1e-8;
const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
  'EXT_mesh_gpu_instancing',
  'EXT_texture_webp',
  'KHR_materials_anisotropy',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_variants',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
]);
const RECORD_FIELDS = new Set([
  'schemaVersion',
  'avatarId',
  'name',
  'author',
  'hash',
  'bytes',
  'uploadedAt',
  'avatarUrl',
  'launchUrl',
  'stats',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireArray(value, field, maximum, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new HttpError(422, 'invalid_avatar_glb', `${field} must be an array`);
  if (value.length > maximum) {
    throw new HttpError(422, 'avatar_budget_exceeded', `${field} exceeds its safety budget`, {
      field,
      maximum,
      actual: value.length,
    });
  }
  return value;
}

function requireIndex(value, length, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new HttpError(422, 'invalid_avatar_glb', `${field} contains an invalid index`);
  }
  return value;
}

function budget(field, actual) {
  const maximum = AVATAR_BUDGETS[field];
  if (actual > maximum) {
    throw new HttpError(422, 'avatar_budget_exceeded', `${field} exceeds its safety budget`, {
      field,
      maximum,
      actual,
    });
  }
}

function parseGlb(buffer, { maximumBytes = MAX_AVATAR_BYTES, label = 'Avatar' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    throw new HttpError(422, 'invalid_avatar_glb', `${label} is not a complete GLB file`);
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('GLB maximumBytes is invalid');
  if (buffer.length > maximumBytes) {
    throw new HttpError(413, 'avatar_too_large', `${label} GLB exceeds its size limit`);
  }
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    throw new HttpError(422, 'invalid_avatar_glb', `${label} must use the glTF 2.0 GLB format`);
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new HttpError(422, 'invalid_avatar_glb', 'GLB declared length does not match the upload');
  }

  let cursor = 12;
  let jsonChunk = null;
  let binaryChunk = null;
  let chunkIndex = 0;
  while (cursor < buffer.length) {
    if (cursor + 8 > buffer.length) {
      throw new HttpError(422, 'invalid_avatar_glb', 'GLB contains a truncated chunk header');
    }
    const length = buffer.readUInt32LE(cursor);
    const type = buffer.readUInt32LE(cursor + 4);
    cursor += 8;
    if (length % 4 !== 0 || cursor + length > buffer.length) {
      throw new HttpError(422, 'invalid_avatar_glb', 'GLB contains an invalid chunk length');
    }
    const chunk = buffer.subarray(cursor, cursor + length);
    cursor += length;
    if (chunkIndex === 0 && type !== JSON_CHUNK) {
      throw new HttpError(422, 'invalid_avatar_glb', 'GLB JSON must be the first chunk');
    }
    if (type === JSON_CHUNK) {
      if (jsonChunk) throw new HttpError(422, 'invalid_avatar_glb', 'GLB must contain one JSON chunk');
      jsonChunk = chunk;
    } else if (type === BIN_CHUNK) {
      if (binaryChunk) throw new HttpError(422, 'invalid_avatar_glb', 'GLB must contain at most one BIN chunk');
      binaryChunk = chunk;
    } else {
      throw new HttpError(422, 'invalid_avatar_glb', 'GLB contains an unsupported chunk type');
    }
    chunkIndex += 1;
  }
  if (!jsonChunk || cursor !== buffer.length) {
    throw new HttpError(422, 'invalid_avatar_glb', 'GLB is missing a valid JSON chunk');
  }

  let document;
  try {
    const source = new TextDecoder('utf-8', { fatal: true })
      .decode(jsonChunk)
      .replace(/[\u0000\u0020]+$/g, '');
    document = JSON.parse(source);
  } catch {
    throw new HttpError(422, 'invalid_avatar_glb', 'GLB JSON is not valid UTF-8 JSON');
  }
  if (!isPlainObject(document) || document.asset?.version !== '2.0') {
    throw new HttpError(422, 'invalid_avatar_glb', `${label} must declare glTF asset version 2.0`);
  }
  return { document, binaryChunk: binaryChunk ?? Buffer.alloc(0) };
}

function inspectStrictDocument(document, extensionsUsed) {
  const stack = [{ value: document, depth: 0 }];
  let entries = 0;
  let stringBytes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 64) {
      throw new HttpError(422, 'avatar_budget_exceeded', 'GLB JSON nesting exceeds its safety budget', {
        field: 'jsonDepth', maximum: 64, actual: depth,
      });
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > MAX_STRICT_JSON_NUMBER) {
        throw new HttpError(422, 'invalid_avatar_glb', 'GLB JSON numbers must be finite and bounded');
      }
      continue;
    }
    if (typeof value === 'string') {
      stringBytes += Buffer.byteLength(value);
      if (Buffer.byteLength(value) > 64 * 1024 || stringBytes > 1024 * 1024) {
        throw new HttpError(422, 'avatar_budget_exceeded', 'GLB JSON strings exceed their safety budget', {
          field: 'jsonStringBytes', maximum: 1024 * 1024, actual: stringBytes,
        });
      }
      continue;
    }
    if (Array.isArray(value)) {
      entries += value.length;
      for (const child of value) stack.push({ value: child, depth: depth + 1 });
    } else if (isPlainObject(value)) {
      const pairs = Object.entries(value);
      entries += pairs.length;
      for (const [key, child] of pairs) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          throw new HttpError(422, 'invalid_avatar_glb', 'GLB JSON contains an unsafe object key');
        }
        if (/^(?:audio|sound|emitter|emitters)$/i.test(key)) {
          throw new HttpError(422, 'avatar_forbidden_scene_feature', 'GLB cannot contain audio emitters');
        }
        if (key === 'extensions') {
          if (!isPlainObject(child)) {
            throw new HttpError(422, 'invalid_avatar_glb', 'GLB extensions containers must be objects');
          }
          for (const extensionName of Object.keys(child)) {
            if (!extensionsUsed.includes(extensionName) || !SUPPORTED_REQUIRED_EXTENSIONS.has(extensionName)) {
              throw new HttpError(
                422,
                'avatar_unsupported_extension',
                `Extension ${extensionName} is not available in the game loader`,
                { extension: extensionName },
              );
            }
          }
        }
        stack.push({ value: child, depth: depth + 1 });
      }
    }
    if (entries > 50_000) {
      throw new HttpError(422, 'avatar_budget_exceeded', 'GLB JSON structure exceeds its safety budget', {
        field: 'jsonEntries', maximum: 50_000, actual: entries,
      });
    }
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  CRC_TABLE[index] = value >>> 0;
}

function crc32(parts) {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateImageDimensions(width, height, mimeType) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new HttpError(422, 'invalid_avatar_image', `${mimeType} image dimensions are invalid`);
  }
  if (width > MAX_TEXTURE_DIMENSION || height > MAX_TEXTURE_DIMENSION) {
    throw new HttpError(422, 'avatar_image_dimensions_exceeded', `Avatar image dimensions cannot exceed ${MAX_TEXTURE_DIMENSION}px`, {
      width,
      height,
      maximum: MAX_TEXTURE_DIMENSION,
    });
  }
  return { width, height, pixels: width * height };
}

function pngDecodedBytes(width, height, bitDepth, colorType, interlace) {
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const validDepths = new Map([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]).get(colorType);
  if (!channels || !validDepths.has(bitDepth)) {
    throw new HttpError(422, 'invalid_avatar_image', 'PNG color type or bit depth is invalid');
  }
  const bitsPerPixel = channels * bitDepth;
  const passBytes = (startX, startY, stepX, stepY) => {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    return passWidth && passHeight ? (Math.ceil(passWidth * bitsPerPixel / 8) + 1) * passHeight : 0;
  };
  if (interlace === 0) return passBytes(0, 0, 1, 1);
  if (interlace !== 1) throw new HttpError(422, 'invalid_avatar_image', 'PNG interlace method is invalid');
  return [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
  ].reduce((total, pass) => total + passBytes(...pass), 0);
}

function inspectPng(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 45 || !data.subarray(0, 8).equals(signature)) {
    throw new HttpError(422, 'invalid_avatar_image', 'Embedded PNG signature is invalid');
  }
  let cursor = 8;
  let width;
  let height;
  let expectedDecodedBytes;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  const idat = [];
  while (cursor < data.length) {
    if (cursor + 12 > data.length) throw new HttpError(422, 'invalid_avatar_image', 'PNG contains a truncated chunk');
    const length = data.readUInt32BE(cursor);
    const type = data.subarray(cursor + 4, cursor + 8);
    const payloadStart = cursor + 8;
    const payloadEnd = payloadStart + length;
    if (payloadEnd + 4 > data.length) throw new HttpError(422, 'invalid_avatar_image', 'PNG chunk exceeds the embedded image');
    const suppliedCrc = data.readUInt32BE(payloadEnd);
    if (crc32([type, data.subarray(payloadStart, payloadEnd)]) !== suppliedCrc) {
      throw new HttpError(422, 'invalid_avatar_image', 'PNG chunk CRC is invalid');
    }
    const chunkType = type.toString('ascii');
    if (!sawIhdr && chunkType !== 'IHDR') throw new HttpError(422, 'invalid_avatar_image', 'PNG IHDR must be first');
    if (chunkType === 'IHDR') {
      if (sawIhdr || length !== 13) throw new HttpError(422, 'invalid_avatar_image', 'PNG IHDR is invalid');
      width = data.readUInt32BE(payloadStart);
      height = data.readUInt32BE(payloadStart + 4);
      const bitDepth = data[payloadStart + 8];
      const colorType = data[payloadStart + 9];
      if (data[payloadStart + 10] !== 0 || data[payloadStart + 11] !== 0) {
        throw new HttpError(422, 'invalid_avatar_image', 'PNG compression or filter method is invalid');
      }
      validateImageDimensions(width, height, 'PNG');
      expectedDecodedBytes = pngDecodedBytes(width, height, bitDepth, colorType, data[payloadStart + 12]);
      sawIhdr = true;
    } else if (chunkType === 'IDAT') {
      if (!sawIhdr || sawIend || !length) throw new HttpError(422, 'invalid_avatar_image', 'PNG IDAT is invalid');
      sawIdat = true;
      idat.push(data.subarray(payloadStart, payloadEnd));
    } else if (chunkType === 'IEND') {
      if (!sawIdat || sawIend || length !== 0 || payloadEnd + 4 !== data.length) {
        throw new HttpError(422, 'invalid_avatar_image', 'PNG IEND is invalid');
      }
      sawIend = true;
    }
    cursor = payloadEnd + 4;
  }
  if (!sawIhdr || !sawIdat || !sawIend) throw new HttpError(422, 'invalid_avatar_image', 'PNG is incomplete');
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedDecodedBytes + 1 });
  } catch {
    throw new HttpError(422, 'invalid_avatar_image', 'PNG pixel data is malformed or exceeds its declared dimensions');
  }
  if (decoded.length !== expectedDecodedBytes) {
    throw new HttpError(422, 'invalid_avatar_image', 'PNG decoded size does not match its declared dimensions');
  }
  return validateImageDimensions(width, height, 'PNG');
}

function inspectJpeg(data) {
  if (data.length < 12 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new HttpError(422, 'invalid_avatar_image', 'Embedded JPEG signature is invalid');
  }
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let cursor = 2;
  let width;
  let height;
  let sawScan = false;
  let sawEnd = false;
  let inEntropy = false;
  while (cursor < data.length) {
    let marker;
    if (inEntropy) {
      while (cursor < data.length && data[cursor] !== 0xff) cursor += 1;
      if (cursor >= data.length) break;
      while (cursor < data.length && data[cursor] === 0xff) cursor += 1;
      if (cursor >= data.length) break;
      marker = data[cursor];
      cursor += 1;
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      inEntropy = false;
    } else {
      if (data[cursor] !== 0xff) throw new HttpError(422, 'invalid_avatar_image', 'JPEG marker stream is malformed');
      while (cursor < data.length && data[cursor] === 0xff) cursor += 1;
      if (cursor >= data.length) break;
      marker = data[cursor];
      cursor += 1;
    }
    if (marker === 0xd9) {
      sawEnd = cursor === data.length;
      break;
    }
    if (marker === 0xd8 || marker === 0x00) throw new HttpError(422, 'invalid_avatar_image', 'JPEG contains an invalid marker');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > data.length) throw new HttpError(422, 'invalid_avatar_image', 'JPEG segment is truncated');
    const length = data.readUInt16BE(cursor);
    if (length < 2 || cursor + length > data.length) throw new HttpError(422, 'invalid_avatar_image', 'JPEG segment length is invalid');
    if (startOfFrame.has(marker)) {
      if (length < 8) throw new HttpError(422, 'invalid_avatar_image', 'JPEG frame header is invalid');
      height = data.readUInt16BE(cursor + 3);
      width = data.readUInt16BE(cursor + 5);
      validateImageDimensions(width, height, 'JPEG');
    }
    if (marker === 0xda) {
      sawScan = true;
      inEntropy = true;
    }
    cursor += length;
  }
  if (!width || !height || !sawScan || !sawEnd) throw new HttpError(422, 'invalid_avatar_image', 'JPEG is incomplete or missing dimensions');
  return validateImageDimensions(width, height, 'JPEG');
}

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function inspectWebp(data) {
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) {
    throw new HttpError(422, 'invalid_avatar_image', 'Embedded WebP RIFF signature or length is invalid');
  }
  let cursor = 12;
  let canvas;
  let frame;
  while (cursor < data.length) {
    if (cursor + 8 > data.length) throw new HttpError(422, 'invalid_avatar_image', 'WebP contains a truncated chunk');
    const type = data.toString('ascii', cursor, cursor + 4);
    const length = data.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = start + length;
    if (end > data.length) throw new HttpError(422, 'invalid_avatar_image', 'WebP chunk exceeds the embedded image');
    if (type === 'ANIM' || type === 'ANMF') throw new HttpError(422, 'invalid_avatar_image', 'Animated WebP is not allowed for avatars');
    if (type === 'VP8X') {
      if (canvas) throw new HttpError(422, 'invalid_avatar_image', 'WebP must contain at most one VP8X canvas');
      if (length !== 10) throw new HttpError(422, 'invalid_avatar_image', 'WebP VP8X header is invalid');
      if ((data[start] & 0x02) !== 0) throw new HttpError(422, 'invalid_avatar_image', 'Animated WebP is not allowed for avatars');
      canvas = { width: readUint24LE(data, start + 4) + 1, height: readUint24LE(data, start + 7) + 1 };
      validateImageDimensions(canvas.width, canvas.height, 'WebP');
    } else if (type === 'VP8 ') {
      if (frame) throw new HttpError(422, 'invalid_avatar_image', 'WebP must contain exactly one image frame');
      if (length < 10 || data[start + 3] !== 0x9d || data[start + 4] !== 0x01 || data[start + 5] !== 0x2a) {
        throw new HttpError(422, 'invalid_avatar_image', 'WebP VP8 frame header is invalid');
      }
      frame = { width: data.readUInt16LE(start + 6) & 0x3fff, height: data.readUInt16LE(start + 8) & 0x3fff };
      validateImageDimensions(frame.width, frame.height, 'WebP');
    } else if (type === 'VP8L') {
      if (frame) throw new HttpError(422, 'invalid_avatar_image', 'WebP must contain exactly one image frame');
      if (length < 5 || data[start] !== 0x2f) throw new HttpError(422, 'invalid_avatar_image', 'WebP VP8L frame header is invalid');
      const bits = data.readUInt32LE(start + 1);
      frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      validateImageDimensions(frame.width, frame.height, 'WebP');
    }
    cursor = end + (length % 2);
    if (cursor > data.length) throw new HttpError(422, 'invalid_avatar_image', 'WebP chunk padding is invalid');
  }
  if (cursor !== data.length || !frame) throw new HttpError(422, 'invalid_avatar_image', 'WebP is incomplete or missing an image frame');
  if (canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) {
    throw new HttpError(422, 'invalid_avatar_image', 'WebP canvas and frame dimensions do not match');
  }
  return validateImageDimensions(frame.width, frame.height, 'WebP');
}

function inspectEmbeddedImage(data, mimeType) {
  if (mimeType === 'image/png') return inspectPng(data);
  if (mimeType === 'image/jpeg') return inspectJpeg(data);
  if (mimeType === 'image/webp') return inspectWebp(data);
  throw new HttpError(422, 'invalid_avatar_image', 'Avatar image mimeType is unsupported');
}

function primitiveTriangleCount(primitive, accessors) {
  let count;
  if (primitive.indices !== undefined) {
    count = accessors[requireIndex(primitive.indices, accessors.length, 'mesh primitive indices')].count;
  } else {
    const positionIndex = primitive.attributes?.POSITION;
    count = accessors[requireIndex(positionIndex, accessors.length, 'mesh primitive POSITION')].count;
  }
  const mode = primitive.mode ?? 4;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function strictNodeLocalMatrix(node) {
  if (node.matrix !== undefined) return node.matrix;
  const [translationX, translationY, translationZ] = node.translation ?? [0, 0, 0];
  const [rotationX, rotationY, rotationZ, rotationW] = node.rotation ?? [0, 0, 0, 1];
  const [scaleX, scaleY, scaleZ] = node.scale ?? [1, 1, 1];
  const xx = rotationX * rotationX;
  const xy = rotationX * rotationY;
  const xz = rotationX * rotationZ;
  const xw = rotationX * rotationW;
  const yy = rotationY * rotationY;
  const yz = rotationY * rotationZ;
  const yw = rotationY * rotationW;
  const zz = rotationZ * rotationZ;
  const zw = rotationZ * rotationW;
  return [
    (1 - 2 * (yy + zz)) * scaleX,
    2 * (xy + zw) * scaleX,
    2 * (xz - yw) * scaleX,
    0,
    2 * (xy - zw) * scaleY,
    (1 - 2 * (xx + zz)) * scaleY,
    2 * (yz + xw) * scaleY,
    0,
    2 * (xz + yw) * scaleZ,
    2 * (yz - xw) * scaleZ,
    (1 - 2 * (xx + yy)) * scaleZ,
    0,
    translationX,
    translationY,
    translationZ,
    1,
  ];
}

function multiplyStrictWorldMatrix(parent, local, nodeIndex) {
  const world = new Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let component = 0; component < 4; component += 1) {
        value += parent[component * 4 + row] * local[column * 4 + component];
      }
      if (!Number.isFinite(value) || Math.abs(value) > MAX_STRICT_WORLD_MATRIX_COMPONENT) {
        throw new HttpError(
          422,
          'invalid_avatar_glb',
          `nodes[${nodeIndex}] cumulative world transform is not finite and bounded`,
        );
      }
      world[column * 4 + row] = value;
    }
  }
  if (
    Math.abs(world[3]) > AFFINE_EPSILON
    || Math.abs(world[7]) > AFFINE_EPSILON
    || Math.abs(world[11]) > AFFINE_EPSILON
    || Math.abs(world[15] - 1) > AFFINE_EPSILON
  ) {
    throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}] cumulative world transform must be affine`);
  }
  return world;
}

function textureInfoIndex(value, textures, field) {
  if (value === undefined) return;
  if (!isPlainObject(value)) throw new HttpError(422, 'invalid_avatar_glb', `${field} is invalid`);
  requireIndex(value.index, textures.length, `${field}.index`);
}

function validateMaterialTextures(material, textures, index) {
  if (!isPlainObject(material)) throw new HttpError(422, 'invalid_avatar_glb', `materials[${index}] is invalid`);
  textureInfoIndex(material.pbrMetallicRoughness?.baseColorTexture, textures, `materials[${index}].pbrMetallicRoughness.baseColorTexture`);
  textureInfoIndex(material.pbrMetallicRoughness?.metallicRoughnessTexture, textures, `materials[${index}].pbrMetallicRoughness.metallicRoughnessTexture`);
  textureInfoIndex(material.normalTexture, textures, `materials[${index}].normalTexture`);
  textureInfoIndex(material.occlusionTexture, textures, `materials[${index}].occlusionTexture`);
  textureInfoIndex(material.emissiveTexture, textures, `materials[${index}].emissiveTexture`);
  const extensions = material.extensions;
  if (extensions !== undefined && !isPlainObject(extensions)) {
    throw new HttpError(422, 'invalid_avatar_glb', `materials[${index}].extensions is invalid`);
  }
  const extensionTextureFields = new Map([
    ['KHR_materials_anisotropy', ['anisotropyTexture']],
    ['KHR_materials_clearcoat', ['clearcoatTexture', 'clearcoatRoughnessTexture', 'clearcoatNormalTexture']],
    ['KHR_materials_iridescence', ['iridescenceTexture', 'iridescenceThicknessTexture']],
    ['KHR_materials_sheen', ['sheenColorTexture', 'sheenRoughnessTexture']],
    ['KHR_materials_specular', ['specularTexture', 'specularColorTexture']],
    ['KHR_materials_transmission', ['transmissionTexture']],
    ['KHR_materials_volume', ['thicknessTexture']],
  ]);
  for (const [extensionName, fields] of extensionTextureFields) {
    const extension = extensions?.[extensionName];
    if (extension === undefined) continue;
    if (!isPlainObject(extension)) throw new HttpError(422, 'invalid_avatar_glb', `materials[${index}].extensions.${extensionName} is invalid`);
    for (const field of fields) textureInfoIndex(extension[field], textures, `materials[${index}].extensions.${extensionName}.${field}`);
  }
}

export function validateAvatarGlb(buffer, {
  maximumBytes = MAX_AVATAR_BYTES,
  label = 'Avatar',
  strictExtensions = false,
  strictDocument = false,
  strictGeometry = false,
} = {}) {
  const { document, binaryChunk } = parseGlb(buffer, { maximumBytes, label });
  const extensionsUsed = requireArray(document.extensionsUsed, 'extensionsUsed', 64);
  const requiredExtensions = requireArray(document.extensionsRequired, 'extensionsRequired', 32);
  if (!extensionsUsed.every((value) => typeof value === 'string') || !requiredExtensions.every((value) => typeof value === 'string')) {
    throw new HttpError(422, 'invalid_avatar_glb', 'glTF extension names must be strings');
  }
  if (
    extensionsUsed.includes('KHR_lights_punctual')
    || requiredExtensions.includes('KHR_lights_punctual')
    || document.extensions?.KHR_lights_punctual !== undefined
  ) {
    throw new HttpError(422, 'avatar_forbidden_scene_feature', 'Avatar GLBs cannot contain scene lights');
  }
  const audioExtension = [...extensionsUsed, ...requiredExtensions]
    .find((value) => typeof value === 'string' && /(?:audio|sound|emitter)/i.test(value));
  if (audioExtension) {
    throw new HttpError(422, 'avatar_forbidden_scene_feature', 'GLB cannot contain audio emitters', {
      extension: audioExtension,
    });
  }
  if (new Set(requiredExtensions).size !== requiredExtensions.length || requiredExtensions.some((value) => !extensionsUsed.includes(value))) {
    throw new HttpError(422, 'invalid_avatar_glb', 'extensionsRequired must be unique and listed in extensionsUsed');
  }
  if (strictExtensions) {
    if (new Set(extensionsUsed).size !== extensionsUsed.length) {
      throw new HttpError(422, 'invalid_avatar_glb', 'extensionsUsed must be unique');
    }
    const unsupportedUsedExtension = extensionsUsed.find((value) => !SUPPORTED_REQUIRED_EXTENSIONS.has(value));
    if (unsupportedUsedExtension) {
      throw new HttpError(
        422,
        'avatar_unsupported_extension',
        `Extension ${unsupportedUsedExtension} is not available in the game loader`,
        { extension: unsupportedUsedExtension },
      );
    }
  }
  if (strictDocument) inspectStrictDocument(document, extensionsUsed);
  const unsupportedExtension = requiredExtensions.find((value) => !SUPPORTED_REQUIRED_EXTENSIONS.has(value));
  if (unsupportedExtension) {
    throw new HttpError(
      422,
      'avatar_unsupported_extension',
      `Required extension ${unsupportedExtension} is not available in the game avatar loader`,
      { extension: unsupportedExtension },
    );
  }
  const nodes = requireArray(document.nodes, 'nodes', AVATAR_BUDGETS.nodes, { required: true });
  const meshes = requireArray(document.meshes, 'meshes', AVATAR_BUDGETS.meshes, { required: true });
  const accessors = requireArray(document.accessors, 'accessors', AVATAR_BUDGETS.accessors, { required: true });
  const bufferViews = requireArray(document.bufferViews, 'bufferViews', AVATAR_BUDGETS.bufferViews);
  const buffers = requireArray(document.buffers, 'buffers', 1, { required: true });
  const materials = requireArray(document.materials, 'materials', AVATAR_BUDGETS.materials);
  const textures = requireArray(document.textures, 'textures', AVATAR_BUDGETS.textures);
  const images = requireArray(document.images, 'images', AVATAR_BUDGETS.images);
  const samplers = requireArray(document.samplers, 'samplers', AVATAR_BUDGETS.samplers);
  const scenes = requireArray(document.scenes, 'scenes', AVATAR_BUDGETS.scenes, { required: true });
  const cameras = requireArray(document.cameras, 'cameras', 32);
  const animations = requireArray(document.animations, 'animations', AVATAR_BUDGETS.animations);
  const skins = requireArray(document.skins, 'skins', AVATAR_BUDGETS.skins);

  if (cameras.length) {
    throw new HttpError(422, 'avatar_forbidden_scene_feature', 'Avatar GLBs cannot contain cameras');
  }

  if (!nodes.length || !meshes.length || !accessors.length || !scenes.length || buffers.length !== 1 || !binaryChunk.length) {
    throw new HttpError(422, 'invalid_avatar_glb', 'Avatar GLB must contain an embedded rendered model');
  }
  if (!isPlainObject(buffers[0]) || Object.hasOwn(buffers[0], 'uri')) {
    throw new HttpError(422, 'avatar_external_resource', 'Avatar buffers must be embedded in the GLB');
  }
  if (!Number.isSafeInteger(buffers[0].byteLength) || buffers[0].byteLength < 1 || buffers[0].byteLength > binaryChunk.length || binaryChunk.length - buffers[0].byteLength > 3) {
    throw new HttpError(422, 'invalid_avatar_glb', 'Embedded buffer length is invalid');
  }

  for (const [index, view] of bufferViews.entries()) {
    if (!isPlainObject(view) || (view.buffer ?? 0) !== 0) {
      throw new HttpError(422, 'invalid_avatar_glb', `bufferViews[${index}] is invalid`);
    }
    const offset = view.byteOffset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || offset + view.byteLength > buffers[0].byteLength) {
      throw new HttpError(422, 'invalid_avatar_glb', `bufferViews[${index}] exceeds the embedded buffer`);
    }
    if (view.byteStride !== undefined && (!Number.isSafeInteger(view.byteStride) || view.byteStride < 4 || view.byteStride > 252 || view.byteStride % 4 !== 0)) {
      throw new HttpError(422, 'invalid_avatar_glb', `bufferViews[${index}].byteStride is invalid`);
    }
  }

  const componentBytes = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
  const typeComponents = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT2', 4], ['MAT3', 9], ['MAT4', 16]]);
  let accessorElements = 0;
  for (const [index, accessor] of accessors.entries()) {
    if (!isPlainObject(accessor) || !Number.isSafeInteger(accessor.count) || accessor.count < 1) {
      throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}] has an invalid count`);
    }
    const bytesPerComponent = componentBytes.get(accessor.componentType);
    const components = typeComponents.get(accessor.type);
    if (!bytesPerComponent || !components) {
      throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}] has an invalid componentType or type`);
    }
    accessorElements += accessor.count;
    budget('accessorElements', accessorElements);
    const elementBytes = bytesPerComponent * components;
    const byteOffset = accessor.byteOffset ?? 0;
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % bytesPerComponent !== 0) {
      throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}].byteOffset is invalid`);
    }
    if (accessor.bufferView !== undefined) {
      const viewIndex = requireIndex(accessor.bufferView, bufferViews.length, `accessors[${index}].bufferView`);
      const view = bufferViews[viewIndex];
      const stride = view.byteStride ?? elementBytes;
      if (stride < elementBytes || byteOffset + (accessor.count - 1) * stride + elementBytes > view.byteLength) {
        throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}] exceeds its bufferView`);
      }
    } else if (!isPlainObject(accessor.sparse)) {
      throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}] must reference a bufferView or sparse data`);
    }
    if (accessor.sparse !== undefined) {
      const sparse = accessor.sparse;
      if (!isPlainObject(sparse) || !Number.isSafeInteger(sparse.count) || sparse.count < 1 || sparse.count > accessor.count) {
        throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}].sparse is invalid`);
      }
      const sparseIndexBytes = componentBytes.get(sparse.indices?.componentType);
      if (![5121, 5123, 5125].includes(sparse.indices?.componentType) || !isPlainObject(sparse.values)) {
        throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}].sparse indices or values are invalid`);
      }
      const indexView = bufferViews[requireIndex(sparse.indices.bufferView, bufferViews.length, `accessors[${index}].sparse.indices.bufferView`)];
      const valueView = bufferViews[requireIndex(sparse.values.bufferView, bufferViews.length, `accessors[${index}].sparse.values.bufferView`)];
      const indexOffset = sparse.indices.byteOffset ?? 0;
      const valueOffset = sparse.values.byteOffset ?? 0;
      if (
        !Number.isSafeInteger(indexOffset) || indexOffset < 0 || indexOffset + sparse.count * sparseIndexBytes > indexView.byteLength
        || !Number.isSafeInteger(valueOffset) || valueOffset < 0 || valueOffset + sparse.count * elementBytes > valueView.byteLength
      ) {
        throw new HttpError(422, 'invalid_avatar_glb', `accessors[${index}].sparse exceeds its bufferViews`);
      }
    }
  }

  let texturePixels = 0;
  for (const [index, image] of images.entries()) {
    if (!isPlainObject(image) || Object.hasOwn(image, 'uri')) {
      throw new HttpError(422, 'avatar_external_resource', 'Avatar images must use embedded bufferViews');
    }
    const view = bufferViews[requireIndex(image.bufferView, bufferViews.length, `images[${index}].bufferView`)];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) {
      throw new HttpError(422, 'invalid_avatar_glb', `images[${index}] has an unsupported mimeType`);
    }
    const start = view.byteOffset ?? 0;
    const inspected = inspectEmbeddedImage(binaryChunk.subarray(start, start + view.byteLength), image.mimeType);
    texturePixels += inspected.pixels;
    budget('texturePixels', texturePixels);
  }

  for (const [index, sampler] of samplers.entries()) {
    if (!isPlainObject(sampler)) throw new HttpError(422, 'invalid_avatar_glb', `samplers[${index}] is invalid`);
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter)) {
      throw new HttpError(422, 'invalid_avatar_glb', `samplers[${index}].magFilter is invalid`);
    }
    if (sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)) {
      throw new HttpError(422, 'invalid_avatar_glb', `samplers[${index}].minFilter is invalid`);
    }
    for (const field of ['wrapS', 'wrapT']) {
      if (sampler[field] !== undefined && ![33071, 33648, 10497].includes(sampler[field])) {
        throw new HttpError(422, 'invalid_avatar_glb', `samplers[${index}].${field} is invalid`);
      }
    }
  }

  for (const [index, texture] of textures.entries()) {
    if (!isPlainObject(texture)) throw new HttpError(422, 'invalid_avatar_glb', `textures[${index}] is invalid`);
    if (texture.sampler !== undefined) requireIndex(texture.sampler, samplers.length, `textures[${index}].sampler`);
    const sources = [
      texture.source,
      texture.extensions?.EXT_texture_webp?.source,
    ].filter((value) => value !== undefined);
    if (!sources.length) throw new HttpError(422, 'invalid_avatar_glb', `textures[${index}] is missing an image source`);
    for (const source of sources) requireIndex(source, images.length, `textures[${index}].source`);
  }
  for (const [index, material] of materials.entries()) validateMaterialTextures(material, textures, index);

  let primitiveCount = 0;
  let vertices = 0;
  let indices = 0;
  let triangles = 0;
  let morphTargets = 0;
  let instances = 0;
  const strictPositionData = strictGeometry ? new Map() : null;
  for (const [meshIndex, mesh] of meshes.entries()) {
    if (!isPlainObject(mesh) || !Array.isArray(mesh.primitives) || !mesh.primitives.length) {
      throw new HttpError(422, 'invalid_avatar_glb', `meshes[${meshIndex}] must contain primitives`);
    }
    primitiveCount += mesh.primitives.length;
    budget('primitives', primitiveCount);
    for (const primitive of mesh.primitives) {
      if (!isPlainObject(primitive) || !isPlainObject(primitive.attributes)) {
        throw new HttpError(422, 'invalid_avatar_glb', 'Mesh primitive attributes are invalid');
      }
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        requireIndex(accessorIndex, accessors.length, `mesh primitive attribute ${semantic}`);
      }
      const positionAccessorIndex = requireIndex(primitive.attributes.POSITION, accessors.length, 'mesh primitive POSITION');
      const positionAccessor = accessors[positionAccessorIndex];
      if (strictGeometry) {
        if ((primitive.mode ?? 4) !== 4) {
          throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset mesh primitives must use TRIANGLES mode');
        }
        if (
          positionAccessor.type !== 'VEC3'
          || positionAccessor.componentType !== 5126
          || positionAccessor.normalized === true
          || positionAccessor.bufferView === undefined
          || positionAccessor.sparse !== undefined
        ) {
          throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset POSITION accessors must use embedded float VEC3 data');
        }
        for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
          if (accessors[accessorIndex].count !== positionAccessor.count) {
            throw new HttpError(422, 'invalid_avatar_glb', `Lobby asset attribute ${semantic} count must match POSITION`);
          }
        }
        if (!strictPositionData.has(positionAccessorIndex)) {
          const positionView = bufferViews[positionAccessor.bufferView];
          const positionStride = positionView.byteStride ?? 12;
          const positionStart = (positionView.byteOffset ?? 0) + (positionAccessor.byteOffset ?? 0);
          const positionData = new Float64Array(positionAccessor.count * 3);
          for (let vertex = 0; vertex < positionAccessor.count; vertex += 1) {
            const start = positionStart + vertex * positionStride;
            for (let component = 0; component < 3; component += 1) {
              const coordinate = binaryChunk.readFloatLE(start + component * 4);
              if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 10_000) {
                throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset POSITION data must be finite and bounded');
              }
              positionData[vertex * 3 + component] = coordinate;
            }
          }
          strictPositionData.set(positionAccessorIndex, positionData);
        }
      }
      vertices += positionAccessor.count;
      if (primitive.indices !== undefined) {
        const indexAccessor = accessors[requireIndex(primitive.indices, accessors.length, 'mesh primitive indices')];
        if (strictGeometry) {
          if (
            indexAccessor.type !== 'SCALAR'
            || ![5121, 5123, 5125].includes(indexAccessor.componentType)
            || indexAccessor.normalized === true
            || indexAccessor.bufferView === undefined
            || indexAccessor.sparse !== undefined
            || indexAccessor.count % 3 !== 0
            || bufferViews[indexAccessor.bufferView].byteStride !== undefined
          ) {
            throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset indices must be embedded unsigned TRIANGLES indices');
          }
          const indexView = bufferViews[indexAccessor.bufferView];
          const indexBytes = componentBytes.get(indexAccessor.componentType);
          const indexStride = indexView.byteStride ?? indexBytes;
          const indexStart = (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0);
          for (let element = 0; element < indexAccessor.count; element += 1) {
            const offset = indexStart + element * indexStride;
            const indexValue = indexAccessor.componentType === 5121
              ? binaryChunk.readUInt8(offset)
              : indexAccessor.componentType === 5123
                ? binaryChunk.readUInt16LE(offset)
                : binaryChunk.readUInt32LE(offset);
            if (indexValue >= positionAccessor.count) {
              throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset index exceeds the POSITION vertex count');
            }
          }
        }
        indices += indexAccessor.count;
      } else if (strictGeometry && positionAccessor.count % 3 !== 0) {
        throw new HttpError(422, 'invalid_avatar_glb', 'Non-indexed Lobby asset TRIANGLES require a multiple of three vertices');
      }
      if (primitive.material !== undefined) requireIndex(primitive.material, materials.length, 'mesh primitive material');
      triangles += primitiveTriangleCount(primitive, accessors);
      if (primitive.targets !== undefined) {
        if (!Array.isArray(primitive.targets)) throw new HttpError(422, 'invalid_avatar_glb', 'Morph targets must be an array');
        morphTargets += primitive.targets.length;
        for (const target of primitive.targets) {
          if (!isPlainObject(target)) throw new HttpError(422, 'invalid_avatar_glb', 'Morph target is invalid');
          for (const [semantic, accessorIndex] of Object.entries(target)) {
            requireIndex(accessorIndex, accessors.length, `morph target ${semantic}`);
          }
        }
      }
    }
  }
  budget('vertices', vertices);
  budget('indices', indices);
  budget('triangles', triangles);
  budget('morphTargets', morphTargets);

  const parentByChild = new Map();
  for (const [nodeIndex, node] of nodes.entries()) {
    if (!isPlainObject(node)) throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}] is invalid`);
    if (node.mesh !== undefined) requireIndex(node.mesh, meshes.length, `nodes[${nodeIndex}].mesh`);
    if (node.skin !== undefined) requireIndex(node.skin, skins.length, `nodes[${nodeIndex}].skin`);
    if (node.camera !== undefined) requireIndex(node.camera, cameras.length, `nodes[${nodeIndex}].camera`);
    if (node.extensions?.KHR_lights_punctual !== undefined) {
      throw new HttpError(422, 'avatar_forbidden_scene_feature', `nodes[${nodeIndex}] cannot contain a scene light`);
    }
    if (strictGeometry) {
      const hasMatrix = node.matrix !== undefined;
      const hasTrs = node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined;
      if (hasMatrix && hasTrs) {
        throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}] cannot mix matrix and TRS transforms`);
      }
      const finiteTuple = (value, length, maximum, field) => {
        if (
          value !== undefined
          && (!Array.isArray(value)
            || value.length !== length
            || value.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > maximum))
        ) {
          throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}].${field} must be finite and bounded`);
        }
      };
      finiteTuple(node.matrix, 16, 10_000, 'matrix');
      finiteTuple(node.translation, 3, 1_000, 'translation');
      finiteTuple(node.scale, 3, 100, 'scale');
      finiteTuple(node.rotation, 4, 1.001, 'rotation');
      if (node.rotation !== undefined) {
        const length = Math.hypot(...node.rotation);
        if (length < 0.999 || length > 1.001) {
          throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}].rotation must be a normalized quaternion`);
        }
      }
      if (
        hasMatrix
        && (Math.abs(node.matrix[3]) > AFFINE_EPSILON
          || Math.abs(node.matrix[7]) > AFFINE_EPSILON
          || Math.abs(node.matrix[11]) > AFFINE_EPSILON
          || Math.abs(node.matrix[15] - 1) > AFFINE_EPSILON)
      ) {
        throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}].matrix must be affine`);
      }
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}].children is invalid`);
      for (const child of node.children) {
        requireIndex(child, nodes.length, `nodes[${nodeIndex}].children`);
        if (child === nodeIndex) throw new HttpError(422, 'invalid_avatar_glb', `nodes[${nodeIndex}] cannot be its own child`);
        if (parentByChild.has(child)) {
          throw new HttpError(422, 'invalid_avatar_glb', `nodes[${child}] cannot have multiple parents`);
        }
        parentByChild.set(child, nodeIndex);
      }
    }
    const instanceAttributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (instanceAttributes !== undefined) {
      if (!isPlainObject(instanceAttributes)) throw new HttpError(422, 'invalid_avatar_glb', 'GPU instance attributes are invalid');
      const counts = Object.values(instanceAttributes).map((value) => accessors[requireIndex(value, accessors.length, 'GPU instance accessor')].count);
      if (counts.length && !counts.every((count) => count === counts[0])) {
        throw new HttpError(422, 'invalid_avatar_glb', 'GPU instance accessor counts must match');
      }
      instances += counts[0] ?? 0;
    }
  }
  budget('instances', instances);

  const nodeState = new Uint8Array(nodes.length);
  const visitNode = (index) => {
    if (nodeState[index] === 1) throw new HttpError(422, 'invalid_avatar_glb', 'Node hierarchy contains a directed cycle');
    if (nodeState[index] === 2) return;
    nodeState[index] = 1;
    for (const child of nodes[index].children ?? []) visitNode(child);
    nodeState[index] = 2;
  };
  for (let index = 0; index < nodes.length; index += 1) visitNode(index);

  let joints = 0;
  for (const [skinIndex, skin] of skins.entries()) {
    if (!isPlainObject(skin) || !Array.isArray(skin.joints) || !skin.joints.length) {
      throw new HttpError(422, 'invalid_avatar_glb', `skins[${skinIndex}] is invalid`);
    }
    joints += skin.joints.length;
    for (const joint of skin.joints) requireIndex(joint, nodes.length, `skins[${skinIndex}].joints`);
    if (skin.skeleton !== undefined) requireIndex(skin.skeleton, nodes.length, `skins[${skinIndex}].skeleton`);
    if (skin.inverseBindMatrices !== undefined) requireIndex(skin.inverseBindMatrices, accessors.length, `skins[${skinIndex}].inverseBindMatrices`);
  }
  budget('joints', joints);

  for (const [cameraIndex, camera] of cameras.entries()) {
    if (!isPlainObject(camera) || !['perspective', 'orthographic'].includes(camera.type) || !isPlainObject(camera[camera.type])) {
      throw new HttpError(422, 'invalid_avatar_glb', `cameras[${cameraIndex}] is invalid`);
    }
  }

  let animationChannels = 0;
  let animationSamplers = 0;
  for (const [animationIndex, animation] of animations.entries()) {
    if (!isPlainObject(animation) || !Array.isArray(animation.channels) || !animation.channels.length || !Array.isArray(animation.samplers) || !animation.samplers.length) {
      throw new HttpError(422, 'invalid_avatar_glb', `animations[${animationIndex}] is invalid`);
    }
    animationChannels += animation.channels.length;
    animationSamplers += animation.samplers.length;
    budget('animationChannels', animationChannels);
    budget('animationSamplers', animationSamplers);
    for (const [samplerIndex, sampler] of animation.samplers.entries()) {
      if (!isPlainObject(sampler)) throw new HttpError(422, 'invalid_avatar_glb', `animations[${animationIndex}].samplers[${samplerIndex}] is invalid`);
      requireIndex(sampler.input, accessors.length, `animations[${animationIndex}].samplers[${samplerIndex}].input`);
      requireIndex(sampler.output, accessors.length, `animations[${animationIndex}].samplers[${samplerIndex}].output`);
      if (sampler.interpolation !== undefined && !['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation)) {
        throw new HttpError(422, 'invalid_avatar_glb', `animations[${animationIndex}].samplers[${samplerIndex}].interpolation is invalid`);
      }
    }
    for (const [channelIndex, channel] of animation.channels.entries()) {
      if (!isPlainObject(channel) || !isPlainObject(channel.target)) {
        throw new HttpError(422, 'invalid_avatar_glb', `animations[${animationIndex}].channels[${channelIndex}] is invalid`);
      }
      requireIndex(channel.sampler, animation.samplers.length, `animations[${animationIndex}].channels[${channelIndex}].sampler`);
      if (channel.target.node !== undefined) requireIndex(channel.target.node, nodes.length, `animations[${animationIndex}].channels[${channelIndex}].target.node`);
      if (!['translation', 'rotation', 'scale', 'weights', 'pointer'].includes(channel.target.path)) {
        throw new HttpError(422, 'invalid_avatar_glb', `animations[${animationIndex}].channels[${channelIndex}].target.path is invalid`);
      }
    }
  }

  for (const [sceneIndex, scene] of scenes.entries()) {
    if (!isPlainObject(scene) || !Array.isArray(scene.nodes) || !scene.nodes.length) {
      throw new HttpError(422, 'invalid_avatar_glb', `scenes[${sceneIndex}] must contain root nodes`);
    }
    const seenRoots = new Set();
    for (const node of scene.nodes) {
      requireIndex(node, nodes.length, `scenes[${sceneIndex}].nodes`);
      if (seenRoots.has(node) || parentByChild.has(node)) {
        throw new HttpError(422, 'invalid_avatar_glb', `scenes[${sceneIndex}] contains a duplicate or non-root node`);
      }
      seenRoots.add(node);
    }
  }
  const defaultSceneIndex = document.scene === undefined
    ? 0
    : requireIndex(document.scene, scenes.length, 'scene');
  const reachable = new Set();
  const strictWorldMatrices = strictGeometry ? new Map() : null;
  const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const markReachable = (index, parentWorld = identityMatrix) => {
    if (reachable.has(index)) return;
    reachable.add(index);
    const world = strictGeometry
      ? multiplyStrictWorldMatrix(parentWorld, strictNodeLocalMatrix(nodes[index]), index)
      : parentWorld;
    if (strictGeometry) strictWorldMatrices.set(index, world);
    for (const child of nodes[index].children ?? []) markReachable(child, world);
  };
  for (const root of scenes[defaultSceneIndex].nodes) markReachable(root);
  if (![...reachable].some((index) => nodes[index].mesh !== undefined)) {
    throw new HttpError(422, 'invalid_avatar_glb', 'Default scene does not contain a rendered mesh');
  }

  let renderedMeshes = 0;
  let renderedPrimitives = 0;
  let renderedVertices = 0;
  let renderedTriangles = 0;
  if (strictGeometry) {
    for (const nodeIndex of reachable) {
      const meshIndex = nodes[nodeIndex].mesh;
      if (meshIndex === undefined) continue;
      const mesh = meshes[meshIndex];
      const world = strictWorldMatrices.get(nodeIndex);
      renderedMeshes += 1;
      renderedPrimitives += mesh.primitives.length;
      for (const primitive of mesh.primitives) {
        const positionIndex = primitive.attributes.POSITION;
        const position = accessors[positionIndex];
        const positionData = strictPositionData.get(positionIndex);
        for (let vertex = 0; vertex < position.count; vertex += 1) {
          const offset = vertex * 3;
          const x = positionData[offset];
          const y = positionData[offset + 1];
          const z = positionData[offset + 2];
          const worldX = world[0] * x + world[4] * y + world[8] * z + world[12];
          const worldY = world[1] * x + world[5] * y + world[9] * z + world[13];
          const worldZ = world[2] * x + world[6] * y + world[10] * z + world[14];
          if (![worldX, worldY, worldZ].every(Number.isFinite)) {
            throw new HttpError(422, 'invalid_avatar_glb', 'Lobby asset world-space POSITION data must be finite');
          }
        }
        renderedVertices += position.count;
        renderedTriangles += primitiveTriangleCount(primitive, accessors);
      }
    }
  }

  return Object.freeze({
    nodes: nodes.length,
    meshes: meshes.length,
    primitives: primitiveCount,
    accessors: accessors.length,
    bufferViews: bufferViews.length,
    materials: materials.length,
    textures: textures.length,
    images: images.length,
    samplers: samplers.length,
    scenes: scenes.length,
    cameras: cameras.length,
    animations: animations.length,
    animationChannels,
    animationSamplers,
    skins: skins.length,
    joints,
    vertices,
    indices,
    triangles,
    morphTargets,
    instances,
    accessorElements,
    texturePixels,
    ...(strictGeometry ? {
      renderedMeshes,
      renderedPrimitives,
      renderedVertices,
      renderedTriangles,
    } : {}),
    requiredExtensions: [...requiredExtensions].sort(),
  });
}

export function validateAvatarText(value, field) {
  if (typeof value !== 'string') throw new HttpError(422, 'invalid_avatar_metadata', `${field} is required`);
  const normalized = value.normalize('NFC').trim();
  const length = [...normalized].length;
  if (!normalized || length > 64 || Buffer.byteLength(normalized) > 192 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpError(422, 'invalid_avatar_metadata', `${field} must be 1-64 safe characters`);
  }
  return normalized;
}

function slug(value) {
  const candidate = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return candidate || 'avatar';
}

function publicRecord(record) {
  return {
    avatarId: record.avatarId,
    name: record.name,
    author: record.author,
    hash: record.hash,
    avatarUrl: record.avatarUrl,
    launchUrl: record.launchUrl,
    bytes: record.bytes,
    uploadedAt: record.uploadedAt,
    stats: structuredClone(record.stats),
  };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    await handle?.close();
  }
}

async function writeImmutable(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o640);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function storedRecordIsValid(record, expectedId) {
  if (!isPlainObject(record) || Object.keys(record).some((key) => !RECORD_FIELDS.has(key))) return false;
  return record.schemaVersion === 1
    && record.avatarId === expectedId
    && AVATAR_ID_PATTERN.test(record.avatarId)
    && typeof record.name === 'string'
    && typeof record.author === 'string'
    && /^[a-f0-9]{64}$/.test(record.hash ?? '')
    && Number.isSafeInteger(record.bytes)
    && record.bytes > 0
    && record.bytes <= MAX_AVATAR_BYTES
    && typeof record.uploadedAt === 'string'
    && Number.isFinite(Date.parse(record.uploadedAt))
    && record.avatarUrl === `/avatars/${record.avatarId}/avatar.glb`
    && record.launchUrl === `/?avatar=${encodeURIComponent(record.avatarId)}`
    && isPlainObject(record.stats);
}

export class AvatarStore {
  constructor({
    dataDirectory,
    clock = Date.now,
    maxAvatars = MAX_AVATARS,
    maxTotalBytes = MAX_AVATAR_TOTAL_BYTES,
    maxPerOwner = MAX_AVATARS_PER_OWNER,
  } = {}) {
    if (
      !dataDirectory
      || typeof clock !== 'function'
      || !Number.isSafeInteger(maxAvatars)
      || maxAvatars < 1
      || !Number.isSafeInteger(maxTotalBytes)
      || maxTotalBytes < 1
      || !Number.isSafeInteger(maxPerOwner)
      || maxPerOwner < 1
    ) {
      throw new Error('AvatarStore settings are invalid');
    }
    this.root = path.join(path.resolve(dataDirectory), 'avatars');
    this.recordsDirectory = path.join(this.root, 'records');
    this.modelsDirectory = path.join(this.root, 'models');
    this.registryPath = path.join(this.root, 'registry.json');
    this.ownersPath = path.join(this.root, 'owners.json');
    this.clock = clock;
    this.maxAvatars = maxAvatars;
    this.maxTotalBytes = maxTotalBytes;
    this.maxPerOwner = maxPerOwner;
    this.totalBytes = 0;
    this.records = new Map();
    this.hashes = new Map();
    this.ownerAvatars = new Map();
    this.registry = { schemaVersion: 1, generatedAt: new Date(0).toISOString(), avatars: [] };
    this.queue = Promise.resolve();
  }

  recordPath(id) {
    if (!AVATAR_ID_PATTERN.test(id ?? '')) throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
    return path.join(this.recordsDirectory, `${id}.json`);
  }

  modelPath(id) {
    if (!AVATAR_ID_PATTERN.test(id ?? '')) throw new HttpError(404, 'avatar_not_found', 'Avatar was not found');
    return path.join(this.modelsDirectory, id, 'avatar.glb');
  }

  async initialize() {
    await Promise.all([
      mkdir(this.recordsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.modelsDirectory, { recursive: true, mode: 0o750 }),
    ]);
    this.records.clear();
    this.hashes.clear();
    this.ownerAvatars.clear();
    this.totalBytes = 0;
    const names = (await readdir(this.recordsDirectory)).filter((name) => name.endsWith('.json')).sort();
    if (names.length > this.maxAvatars) throw new Error('Stored avatar count exceeds configured maximum');
    for (const fileName of names) {
      const id = fileName.slice(0, -5);
      const record = JSON.parse(await readFile(path.join(this.recordsDirectory, fileName), 'utf8'));
      if (!storedRecordIsValid(record, id)) throw new Error(`Invalid stored avatar record: ${fileName}`);
      const model = await readFile(this.modelPath(id));
      if (model.length !== record.bytes || createHash('sha256').update(model).digest('hex') !== record.hash) {
        throw new Error(`Stored avatar hash mismatch: ${id}`);
      }
      const stats = validateAvatarGlb(model);
      if (JSON.stringify(stats) !== JSON.stringify(record.stats)) {
        throw new Error(`Stored avatar validation metadata mismatch: ${id}`);
      }
      if (this.hashes.has(record.hash)) throw new Error(`Duplicate stored avatar hash: ${record.hash}`);
      this.records.set(id, Object.freeze(record));
      this.hashes.set(record.hash, id);
      this.totalBytes += record.bytes;
    }
    if (this.totalBytes > this.maxTotalBytes) throw new Error('Stored avatars exceed configured byte capacity');
    for (const modelName of await readdir(this.modelsDirectory)) {
      if (!this.records.has(modelName)) await rm(path.join(this.modelsDirectory, modelName), { recursive: true, force: true });
    }
    let storedOwners = null;
    try {
      storedOwners = JSON.parse(await readFile(this.ownersPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (storedOwners !== null) {
      if (
        !isPlainObject(storedOwners)
        || Object.keys(storedOwners).some((key) => !['schemaVersion', 'owners'].includes(key))
        || storedOwners.schemaVersion !== 1
        || !Array.isArray(storedOwners.owners)
      ) {
        throw new Error('Stored Avatar owner index is invalid');
      }
      for (const entry of storedOwners.owners) {
        if (
          !isPlainObject(entry)
          || Object.keys(entry).some((key) => !['ownerId', 'avatarIds'].includes(key))
          || !AVATAR_OWNER_ID_PATTERN.test(entry.ownerId ?? '')
          || !Array.isArray(entry.avatarIds)
          || entry.avatarIds.length > this.maxPerOwner
          || this.ownerAvatars.has(entry.ownerId)
        ) {
          throw new Error('Stored Avatar owner entry is invalid');
        }
        const avatarIds = new Set();
        for (const avatarId of entry.avatarIds) {
          if (!AVATAR_ID_PATTERN.test(avatarId ?? '') || !this.records.has(avatarId) || avatarIds.has(avatarId)) {
            throw new Error('Stored Avatar owner reference is invalid');
          }
          avatarIds.add(avatarId);
        }
        if (avatarIds.size) this.ownerAvatars.set(entry.ownerId, avatarIds);
      }
    }
    await this.rebuildRegistry();
    await this.rebuildOwnerIndex();
  }

  get count() {
    return this.records.size;
  }

  getRegistry() {
    return structuredClone(this.registry);
  }

  get(id) {
    if (!AVATAR_ID_PATTERN.test(id ?? '')) return null;
    const record = this.records.get(id);
    return record ? publicRecord(record) : null;
  }

  getStored(id) {
    if (!AVATAR_ID_PATTERN.test(id ?? '')) return null;
    return this.records.get(id) ?? null;
  }

  getOwnerRegistry(ownerId) {
    if (!AVATAR_OWNER_ID_PATTERN.test(ownerId ?? '')) {
      throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
    }
    const avatarIds = this.ownerAvatars.get(ownerId) ?? new Set();
    return {
      schemaVersion: 1,
      avatars: [...avatarIds]
        .map((avatarId) => this.records.get(avatarId))
        .filter(Boolean)
        .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt) || left.avatarId.localeCompare(right.avatarId))
        .map(publicRecord),
    };
  }

  async rebuildRegistry() {
    const avatars = [...this.records.values()]
      .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt) || left.avatarId.localeCompare(right.avatarId))
      .map(publicRecord);
    this.registry = {
      schemaVersion: 1,
      generatedAt: new Date(this.clock()).toISOString(),
      avatars,
    };
    await atomicWriteJson(this.registryPath, this.registry, 0o640);
  }

  async rebuildOwnerIndex() {
    const owners = [...this.ownerAvatars]
      .filter(([, avatarIds]) => avatarIds.size)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ownerId, avatarIds]) => ({ ownerId, avatarIds: [...avatarIds].sort() }));
    await atomicWriteJson(this.ownersPath, { schemaVersion: 1, owners }, 0o640);
  }

  createForOwner({ ownerId, name, author, buffer }) {
    if (!AVATAR_OWNER_ID_PATTERN.test(ownerId ?? '')) {
      throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
    }
    return this.create({ name, author, buffer, ownerId, strict: true });
  }

  create({ name, author, buffer, ownerId = null, strict = false }) {
    const operation = this.queue.then(async () => {
      const cleanName = validateAvatarText(name, 'name');
      const cleanAuthor = validateAvatarText(author, 'author');
      if (ownerId !== null && !AVATAR_OWNER_ID_PATTERN.test(ownerId)) {
        throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
      }
      if (strict) {
        validateAvatarGlb(buffer, {
          strictExtensions: true,
          strictDocument: true,
          strictGeometry: true,
        });
      }
      const stats = validateAvatarGlb(buffer);
      const hash = createHash('sha256').update(buffer).digest('hex');
      const existingId = this.hashes.get(hash);
      if (existingId) {
        if (ownerId !== null) {
          const current = this.ownerAvatars.get(ownerId) ?? new Set();
          if (!current.has(existingId)) {
            if (current.size >= this.maxPerOwner) {
              throw new HttpError(507, 'avatar_owner_capacity_reached', 'This account has reached its Avatar limit', {
                maximum: this.maxPerOwner,
              });
            }
            const updated = new Set(current);
            updated.add(existingId);
            this.ownerAvatars.set(ownerId, updated);
            try {
              await this.rebuildOwnerIndex();
            } catch (error) {
              if (current.size) this.ownerAvatars.set(ownerId, current);
              else this.ownerAvatars.delete(ownerId);
              throw error;
            }
          }
        }
        return { record: this.records.get(existingId), deduplicated: true };
      }
      if (ownerId !== null && (this.ownerAvatars.get(ownerId)?.size ?? 0) >= this.maxPerOwner) {
        throw new HttpError(507, 'avatar_owner_capacity_reached', 'This account has reached its Avatar limit', {
          maximum: this.maxPerOwner,
        });
      }
      if (this.records.size >= this.maxAvatars) {
        throw new HttpError(507, 'avatar_capacity_reached', 'Avatar registry has reached its capacity', {
          maximum: this.maxAvatars,
        });
      }
      if (this.totalBytes + buffer.length > this.maxTotalBytes) {
        throw new HttpError(507, 'avatar_storage_capacity_reached', 'Avatar storage has reached its byte capacity', {
          maximumBytes: this.maxTotalBytes,
          usedBytes: this.totalBytes,
        });
      }
      const avatarId = `${slug(cleanName)}-${hash.slice(0, 16)}`;
      if (!AVATAR_ID_PATTERN.test(avatarId)) throw new Error('Generated avatar ID is invalid');
      if (this.records.has(avatarId)) throw new HttpError(409, 'avatar_id_conflict', 'Avatar ID conflict');
      const uploadedAt = new Date(this.clock()).toISOString();
      const record = Object.freeze({
        schemaVersion: 1,
        avatarId,
        name: cleanName,
        author: cleanAuthor,
        hash,
        bytes: buffer.length,
        uploadedAt,
        avatarUrl: `/avatars/${avatarId}/avatar.glb`,
        launchUrl: `/?avatar=${encodeURIComponent(avatarId)}`,
        stats,
      });
      const modelPath = this.modelPath(avatarId);
      try {
        await writeImmutable(modelPath, buffer);
        await atomicWriteJson(this.recordPath(avatarId), record);
      } catch (error) {
        await rm(path.dirname(modelPath), { recursive: true, force: true }).catch(() => {});
        await unlink(this.recordPath(avatarId)).catch(() => {});
        throw error;
      }
      this.records.set(avatarId, record);
      this.hashes.set(hash, avatarId);
      this.totalBytes += record.bytes;
      const previousOwnerAvatars = ownerId === null ? null : this.ownerAvatars.get(ownerId) ?? null;
      if (ownerId !== null) {
        const updated = new Set(previousOwnerAvatars ?? []);
        updated.add(avatarId);
        this.ownerAvatars.set(ownerId, updated);
      }
      try {
        await this.rebuildRegistry();
        if (ownerId !== null) await this.rebuildOwnerIndex();
      } catch (error) {
        this.records.delete(avatarId);
        this.hashes.delete(hash);
        this.totalBytes -= record.bytes;
        if (ownerId !== null) {
          if (previousOwnerAvatars?.size) this.ownerAvatars.set(ownerId, previousOwnerAvatars);
          else this.ownerAvatars.delete(ownerId);
        }
        await rm(path.dirname(modelPath), { recursive: true, force: true }).catch(() => {});
        await unlink(this.recordPath(avatarId)).catch(() => {});
        await this.rebuildRegistry().catch(() => {});
        if (ownerId !== null) await this.rebuildOwnerIndex().catch(() => {});
        throw error;
      }
      return { record, deduplicated: false };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export class AvatarUploadRateLimiter {
  constructor({ clock = Date.now, windowMs = 60_000, maximum = 10 } = {}) {
    if (![windowMs, maximum].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Avatar upload rate limits are invalid');
    }
    this.clock = clock;
    this.ip = new FixedWindowCounter(maximum, windowMs, clock);
    this.accountIp = new FixedWindowCounter(maximum, windowMs, clock);
    this.token = new FixedWindowCounter(maximum, windowMs, clock);
    this.owner = new FixedWindowCounter(maximum, windowMs, clock);
  }

  check(ip) {
    const ipEntry = this.ip.inspect(ip);
    const tokenEntry = this.token.inspect('creator');
    const now = this.clock();
    if (ipEntry.count >= this.ip.limit || tokenEntry.count >= this.token.limit) {
      const resetAt = Math.max(
        ipEntry.count >= this.ip.limit ? ipEntry.resetAt : now,
        tokenEntry.count >= this.token.limit ? tokenEntry.resetAt : now,
      );
      throw new HttpError(429, 'avatar_upload_rate_limited', 'Too many avatar uploads; please try again later', {
        retryAfterMs: Math.max(1, resetAt - now),
      });
    }
    this.ip.consume(ip, ipEntry);
    this.token.consume('creator', tokenEntry);
  }

  checkOwner(ownerId, ip) {
    if (!AVATAR_OWNER_ID_PATTERN.test(ownerId ?? '')) {
      throw new HttpError(401, 'account_session_required', 'A signed-in email account is required');
    }
    const ipEntry = this.accountIp.inspect(ip);
    const ownerEntry = this.owner.inspect(ownerId);
    const now = this.clock();
    if (ipEntry.count >= this.accountIp.limit || ownerEntry.count >= this.owner.limit) {
      const resetAt = Math.max(
        ipEntry.count >= this.accountIp.limit ? ipEntry.resetAt : now,
        ownerEntry.count >= this.owner.limit ? ownerEntry.resetAt : now,
      );
      throw new HttpError(429, 'avatar_upload_rate_limited', 'Too many avatar uploads; please try again later', {
        retryAfterMs: Math.max(1, resetAt - now),
      });
    }
    this.accountIp.consume(ip, ipEntry);
    this.owner.consume(ownerId, ownerEntry);
  }
}

export class AvatarUploadGate {
  constructor(maximum = 2) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('Avatar upload concurrency is invalid');
    }
    this.maximum = maximum;
    this.active = 0;
  }

  enter() {
    if (this.active >= this.maximum) {
      throw new HttpError(429, 'avatar_upload_busy', 'Avatar validation is busy; please try again shortly');
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
