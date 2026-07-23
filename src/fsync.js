import { open } from 'node:fs/promises';

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  'EINVAL',
  'ENOTSUP',
  'EOPNOTSUPP',
]);

export function isUnsupportedDirectorySyncError(error, platform = process.platform) {
  return (
    (platform === 'win32' && error?.code === 'EPERM')
    || UNSUPPORTED_DIRECTORY_SYNC_CODES.has(error?.code)
  );
}

export async function syncDirectory(directory, { platform = process.platform } = {}) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error, platform)) throw error;
  } finally {
    await handle?.close();
  }
}
