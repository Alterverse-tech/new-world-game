import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { ValidationError } from './errors.js';

export const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 512;
const MAX_ENTRY_PATH_BYTES = 240;
const REGULAR_FILE = 0o100000;
const DIRECTORY = 0o040000;
const FILE_TYPE_MASK = 0o170000;

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      {
        lazyEntries: true,
        autoClose: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => (error ? reject(error) : resolve(zipFile)),
    );
  });
}

function openEntryStream(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

function safeEntryName(entryName) {
  if (
    !entryName ||
    Buffer.byteLength(entryName) > MAX_ENTRY_PATH_BYTES ||
    entryName.includes('\0') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    /^[A-Za-z]:/.test(entryName) ||
    /[\u0000-\u001f\u007f]/.test(entryName) ||
    /[#?%]/.test(entryName)
  ) {
    throw new ValidationError('ZIP contains an unsafe path', { path: entryName });
  }

  const isDirectory = entryName.endsWith('/');
  const trimmed = isDirectory ? entryName.slice(0, -1) : entryName;
  const segments = trimmed.split('/');
  if (
    !trimmed ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    path.posix.normalize(trimmed) !== trimmed ||
    trimmed !== trimmed.normalize('NFC')
  ) {
    throw new ValidationError('ZIP contains an unsafe or ambiguous path', { path: entryName });
  }
  return { relative: trimmed, isDirectory };
}

function validateEntryType(entry, isDirectory) {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new ValidationError('Encrypted ZIP entries are not supported');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ValidationError('ZIP uses an unsupported compression method');
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = unixMode & FILE_TYPE_MASK;
  if (type && type !== REGULAR_FILE && type !== DIRECTORY) {
    throw new ValidationError('ZIP may contain only regular files and directories');
  }
  if ((type === DIRECTORY) !== isDirectory && type !== 0) {
    throw new ValidationError('ZIP entry type does not match its path');
  }
}

async function extractEntry(zipFile, entry, destinationRoot, state) {
  const { relative, isDirectory } = safeEntryName(entry.fileName);
  validateEntryType(entry, isDirectory);

  state.entries += 1;
  if (state.entries > MAX_ZIP_ENTRIES) {
    throw new ValidationError(`ZIP contains more than ${MAX_ZIP_ENTRIES} entries`);
  }
  state.uncompressedBytes += entry.uncompressedSize;
  if (state.uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new ValidationError('ZIP expands beyond the 80 MB safety limit');
  }

  const collisionKey = relative.normalize('NFC').toLocaleLowerCase('en-US');
  if (state.paths.has(collisionKey)) {
    throw new ValidationError('ZIP contains duplicate or case-colliding paths', { path: relative });
  }
  state.paths.add(collisionKey);

  const destination = path.resolve(destinationRoot, relative);
  const rootPrefix = `${path.resolve(destinationRoot)}${path.sep}`;
  if (!destination.startsWith(rootPrefix)) {
    throw new ValidationError('ZIP path escapes the extraction directory', { path: relative });
  }

  if (isDirectory) {
    await mkdir(destination, { recursive: true, mode: 0o755 });
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  const input = await openEntryStream(zipFile, entry);
  let actualBytes = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      actualBytes += chunk.length;
      if (actualBytes > entry.uncompressedSize || actualBytes > MAX_UNCOMPRESSED_BYTES) {
        callback(new ValidationError('ZIP entry expands beyond its declared size'));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(input, counter, createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
  if (actualBytes !== entry.uncompressedSize) {
    throw new ValidationError('ZIP entry size does not match its directory record');
  }
}

export async function extractZip(zipPath, destinationRoot) {
  await mkdir(destinationRoot, { recursive: false, mode: 0o700 });
  let zipFile;
  try {
    zipFile = await openZip(zipPath);
  } catch (error) {
    throw new ValidationError('Uploaded file is not a valid standard ZIP archive', {
      reason: error.message,
    });
  }

  const state = { entries: 0, uncompressedBytes: 0, paths: new Set() };
  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(
        error instanceof ValidationError
          ? error
          : new ValidationError('ZIP extraction failed', { reason: error.message }),
      );
    };
    zipFile.once('error', fail);
    zipFile.once('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zipFile.on('entry', (entry) => {
      extractEntry(zipFile, entry, destinationRoot, state)
        .then(() => zipFile.readEntry())
        .catch(fail);
    });
    zipFile.readEntry();
  });

  if (state.entries === 0) {
    throw new ValidationError('ZIP archive is empty');
  }
  return state;
}

async function hasRequiredFiles(directory) {
  try {
    await Promise.all(
      ['level.json', 'main.js', 'solution.md', 'cover.png'].map((name) =>
        access(path.join(directory, name)),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export async function findPackageRoot(extractionRoot) {
  if (await hasRequiredFiles(extractionRoot)) return extractionRoot;
  const entries = await readdir(extractionRoot, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(extractionRoot, entries[0].name);
    if (await hasRequiredFiles(nested)) return nested;
  }
  throw new ValidationError(
    'Package root must contain level.json, main.js, solution.md, and cover.png',
  );
}
