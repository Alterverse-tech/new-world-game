import { describe, expect, it } from 'vitest';
import {
  formatLobbyAssetBytes,
  LOBBY_ASSET_MAX_BYTES,
  lobbyAssetErrorMessage,
  lobbyAssetNameFromFilename,
  normalizeLobbyAssetLabel,
  preflightLobbyGlbFile,
  type LobbyGlbFileLike,
} from './lobby-asset-upload';

function glbFile(
  name = 'lamp.glb',
  overrides: Partial<{ magic: number; version: number; declaredBytes: number; chunkBytes: number; chunkType: number }> = {},
): LobbyGlbFileLike {
  const json = new TextEncoder().encode('{}  ');
  const bytes = new Uint8Array(20 + json.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, overrides.magic ?? 0x46546c67, true);
  view.setUint32(4, overrides.version ?? 2, true);
  view.setUint32(8, overrides.declaredBytes ?? bytes.byteLength, true);
  view.setUint32(12, overrides.chunkBytes ?? json.byteLength, true);
  view.setUint32(16, overrides.chunkType ?? 0x4e4f534a, true);
  bytes.set(json, 20);
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  return { name, size: bytes.byteLength, slice: (start, end) => blob.slice(start, end) };
}

async function expectPreflightCode(file: LobbyGlbFileLike, code: string): Promise<void> {
  await expect(preflightLobbyGlbFile(file)).rejects.toMatchObject({ code });
}

describe('lobby GLB upload preflight', () => {
  it('accepts a glTF 2.0 binary header without reading the whole file', async () => {
    const source = glbFile('My Lamp.GLB');
    let slicedEnd = 0;
    const file = {
      ...source,
      slice: (start?: number, end?: number) => {
        slicedEnd = end ?? source.size;
        return source.slice(start, end);
      },
    };

    await expect(preflightLobbyGlbFile(file)).resolves.toEqual({
      fileName: 'My Lamp.GLB',
      bytes: 24,
      declaredBytes: 24,
      jsonChunkBytes: 4,
    });
    expect(slicedEnd).toBe(20);
  });

  it('rejects the wrong extension and oversized files before reading bytes', async () => {
    await expectPreflightCode(glbFile('lamp.gltf'), 'invalid_file_type');
    let sliced = false;
    await expectPreflightCode({
      name: 'huge.glb',
      size: LOBBY_ASSET_MAX_BYTES + 1,
      slice: () => {
        sliced = true;
        return new Blob();
      },
    }, 'lobby_asset_too_large');
    expect(sliced).toBe(false);
  });

  it('rejects corrupt, incomplete and unsupported GLB headers', async () => {
    await expectPreflightCode(glbFile('bad.glb', { magic: 0 }), 'invalid_lobby_asset_glb');
    await expectPreflightCode(glbFile('old.glb', { version: 1 }), 'lobby_asset_unsupported_version');
    await expectPreflightCode(glbFile('cut.glb', { declaredBytes: 200 }), 'invalid_lobby_asset_glb');
    await expectPreflightCode(glbFile('chunk.glb', { chunkType: 0 }), 'invalid_lobby_asset_glb');
    await expectPreflightCode(glbFile('empty.glb', { chunkBytes: 0 }), 'invalid_lobby_asset_glb');
  });
});

describe('lobby upload labels and feedback', () => {
  it('normalizes friendly names and derives one from the filename', () => {
    expect(normalizeLobbyAssetLabel('  Ｆｕｎ\tLamp  ', 20)).toBe('Fun Lamp');
    expect(normalizeLobbyAssetLabel('     ', 20)).toBeNull();
    expect(lobbyAssetNameFromFilename('cloud-chair_final.glb')).toBe('cloud chair final');
  });

  it('formats file sizes and maps actionable server failures', () => {
    expect(formatLobbyAssetBytes(512)).toBe('512 B');
    expect(formatLobbyAssetBytes(1536)).toBe('1.5 KB');
    expect(formatLobbyAssetBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(lobbyAssetErrorMessage('lobby_asset_external_resource')).toContain('单个自包含 GLB');
    expect(lobbyAssetErrorMessage('lobby_asset_budget_exceeded')).toContain('过于复杂');
  });
});
