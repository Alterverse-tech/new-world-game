import { describe, expect, it, vi } from 'vitest';
import {
  avatarNameFromFileName,
  AvatarUploadError,
  listAccountAvatars,
  MAX_AVATAR_UPLOAD_BYTES,
  uploadAccountAvatar,
  validateAvatarUploadFile,
} from './avatar-upload';

function glbFile(name = 'my-avatar.glb', overrides: Partial<{
  magic: number;
  version: number;
  declaredBytes: number;
  size: number;
}> = {}): File {
  const size = overrides.size ?? 20;
  const bytes = new Uint8Array(size);
  if (size >= 12) {
    const view = new DataView(bytes.buffer);
    view.setUint32(0, overrides.magic ?? 0x46546c67, true);
    view.setUint32(4, overrides.version ?? 2, true);
    view.setUint32(8, overrides.declaredBytes ?? size, true);
  }
  return new File([bytes], name, { type: 'model/gltf-binary' });
}

const avatarRecord = {
  avatarId: 'avatar-12345678',
  name: '我的角色',
  author: '测试玩家',
  hash: 'abc123',
  avatarUrl: '/avatars/avatar-12345678/avatar.glb',
  launchUrl: '/?avatar=avatar-12345678',
  deduplicated: false,
};

describe('player Avatar GLB preflight', () => {
  it('accepts a matching glTF 2.0 binary header and derives a friendly name', async () => {
    await expect(validateAvatarUploadFile(glbFile('anime+chibi_figure.GLB'))).resolves.toBeUndefined();
    expect(avatarNameFromFileName('anime+chibi_figure.GLB')).toBe('anime chibi figure');
  });

  it('rejects extension, size, magic, version, and declared-length failures', async () => {
    const cases: Array<[File, string]> = [
      [glbFile('avatar.gltf'), 'invalid_file_type'],
      [glbFile('empty.glb', { size: 0 }), 'invalid_avatar_glb'],
      [glbFile('huge.glb', { size: MAX_AVATAR_UPLOAD_BYTES + 1 }), 'avatar_too_large'],
      [glbFile('magic.glb', { magic: 0 }), 'invalid_avatar_glb'],
      [glbFile('version.glb', { version: 1 }), 'invalid_avatar_glb'],
      [glbFile('length.glb', { declaredBytes: 40 }), 'invalid_avatar_glb'],
    ];
    for (const [file, code] of cases) {
      await expect(validateAvatarUploadFile(file)).rejects.toMatchObject({ code });
    }
  });
});

describe('account Avatar library client', () => {
  it('lists private account Avatars with no-store same-origin credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, avatars: [avatarRecord] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    await expect(listAccountAvatars(fetcher)).resolves.toEqual([avatarRecord]);
    expect(fetcher).toHaveBeenCalledWith('/api/account/avatars', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
    }));
  });

  it('uploads exactly one file plus safe name/author and returns the reusable Avatar ID', async () => {
    const sentBodies: FormData[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBodies.push(init?.body as FormData);
      return new Response(JSON.stringify(avatarRecord), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await expect(uploadAccountAvatar(glbFile(), '  我的角色  ', '  测试玩家 ', undefined, fetcher))
      .resolves.toMatchObject({ avatarId: 'avatar-12345678', avatarUrl: avatarRecord.avatarUrl });
    expect(fetcher).toHaveBeenCalledWith('/api/account/avatars', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    }));
    expect(sentBodies[0]?.get('file')).toBeInstanceOf(File);
    expect(sentBodies[0]?.get('name')).toBe('我的角色');
    expect(sentBodies[0]?.get('author')).toBe('测试玩家');
  });

  it('turns signed-out server responses into a useful login error', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'account_session_required' },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    await expect(listAccountAvatars(fetcher)).rejects.toEqual(expect.objectContaining<Partial<AvatarUploadError>>({
      code: 'account_session_required',
      message: '登录状态已失效，请重新登录后上传',
    }));
  });
});
