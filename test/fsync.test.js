import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function loadDirectorySync() {
  try {
    return await import('../src/fsync.js');
  } catch (error) {
    assert.fail(`shared directory fsync policy is missing: ${error.code ?? error.message}`);
  }
}

function errorWithCode(code) {
  return Object.assign(new Error(`fsync failed with ${code}`), { code });
}

async function withDirectorySyncFailure(code, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-directory-fsync-'));
  const probe = await open(directory, 'r');
  const prototype = Object.getPrototypeOf(probe);
  const originalSync = prototype.sync;
  await probe.close();

  prototype.sync = async function sync() {
    const info = await this.stat();
    if (info.isDirectory()) throw errorWithCode(code);
    return originalSync.call(this);
  };
  try {
    return await run(directory);
  } finally {
    prototype.sync = originalSync;
    await rm(directory, { recursive: true, force: true });
  }
}

test('directory fsync classifies only platform-specific unsupported errors', async () => {
  const { isUnsupportedDirectorySyncError } = await loadDirectorySync();

  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('EPERM'), 'win32'), true);
  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('EPERM'), 'linux'), false);
  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('EINVAL'), 'linux'), true);
  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('ENOTSUP'), 'darwin'), true);
  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('EOPNOTSUPP'), 'linux'), true);
  assert.equal(isUnsupportedDirectorySyncError(errorWithCode('EACCES'), 'win32'), false);
  assert.equal(isUnsupportedDirectorySyncError(null, 'win32'), false);
});

test('directory fsync ignores Windows EPERM but preserves real permission failures', async () => {
  const { syncDirectory } = await loadDirectorySync();

  await withDirectorySyncFailure('EPERM', async (directory) => {
    await assert.doesNotReject(syncDirectory(directory, { platform: 'win32' }));
    await assert.rejects(
      syncDirectory(directory, { platform: 'linux' }),
      (error) => error?.code === 'EPERM',
    );
  });
  await withDirectorySyncFailure('EACCES', async (directory) => {
    await assert.rejects(
      syncDirectory(directory, { platform: 'win32' }),
      (error) => error?.code === 'EACCES',
    );
  });
});

test('all durable writers use the shared directory fsync policy', async () => {
  for (const relative of [
    'src/avatar.js',
    'src/lobby-assets.js',
    'src/prop-creation.js',
    'src/store.js',
  ]) {
    const source = await readFile(new URL(relative, root), 'utf8');
    assert.match(source, /import \{ syncDirectory \} from '\.\/fsync\.js';/u, relative);
    assert.doesNotMatch(source, /async function syncDirectory/u, relative);
  }
});
