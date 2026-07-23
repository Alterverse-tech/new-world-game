export const MAX_AVATAR_UPLOAD_BYTES = 8 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67;
const AVATAR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{8,63}$/;

export type AvatarUploadPhase = 'idle' | 'selected' | 'uploading' | 'success' | 'error';

export interface AccountAvatarRecord {
  avatarId: string;
  name: string;
  author: string;
  hash: string;
  avatarUrl: string;
  launchUrl: string;
  bytes?: number;
  uploadedAt?: string;
  deduplicated?: boolean;
}

export class AvatarUploadError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'AvatarUploadError';
    this.code = code;
  }
}

function safeAvatarName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...normalized].length;
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  return normalized && length <= 64 && !hasControlCharacter
    ? normalized
    : null;
}

export function avatarNameFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.glb$/i, '');
  const readable = withoutExtension.replace(/[+_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...(readable || '我的 Avatar')].slice(0, 64).join('');
}

export async function validateAvatarUploadFile(file: File): Promise<void> {
  if (!/\.glb$/i.test(file.name)) {
    throw new AvatarUploadError('invalid_file_type', '请选择 .glb 格式的角色文件');
  }
  if (!file.size) throw new AvatarUploadError('invalid_avatar_glb', 'GLB 文件不能为空');
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AvatarUploadError('avatar_too_large', '角色 GLB 不能超过 8 MB');
  }
  if (file.size < 20) throw new AvatarUploadError('invalid_avatar_glb', 'GLB 文件不完整');
  const header = await file.slice(0, 12).arrayBuffer();
  const view = new DataView(header);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new AvatarUploadError('invalid_avatar_glb', '角色必须使用 glTF 2.0 GLB 格式');
  }
  if (view.getUint32(8, true) !== file.size) {
    throw new AvatarUploadError('invalid_avatar_glb', 'GLB 声明长度与文件大小不一致');
  }
}

function messageForServerError(status: number, code: string): string {
  const known: Record<string, string> = {
    account_required: '请先登录邮箱账号再上传角色',
    account_session_required: '登录状态已失效，请重新登录后上传',
    cross_origin_lobby_write: '上传来源校验失败，请刷新页面后重试',
    invalid_file_type: '请选择 .glb 格式的角色文件',
    invalid_avatar_glb: 'GLB 结构无效或文件不完整',
    invalid_avatar_image: 'GLB 中的内嵌贴图无效，请重新导出模型',
    invalid_avatar_metadata: '角色名称或作者信息无效',
    avatar_external_resource: 'GLB 必须自包含，不能引用外部贴图或模型',
    avatar_unsupported_extension: 'GLB 使用了网页端不支持的压缩或扩展',
    avatar_forbidden_scene_feature: '角色 GLB 不能包含相机、灯光或音频',
    avatar_budget_exceeded: '角色模型过于复杂，请降低面数、骨骼或贴图尺寸',
    avatar_image_dimensions_exceeded: '角色贴图尺寸过大，请缩小贴图后重新导出',
    avatar_too_large: '角色 GLB 不能超过 8 MB',
    avatar_upload_busy: '当前上传人数较多，请稍后重试',
    avatar_upload_rate_limited: '上传过于频繁，请稍后再试',
    avatar_owner_capacity_reached: '你的角色库已达到数量上限',
    avatar_capacity_reached: '平台角色库已满，请联系管理员',
    avatar_storage_capacity_reached: '平台角色存储空间不足，请联系管理员',
  };
  return known[code]
    ?? (status === 401 ? '请先登录邮箱账号再上传角色' : status === 413 ? '角色 GLB 不能超过 8 MB' : '角色上传失败，请稍后重试');
}

async function responseError(response: Response): Promise<AvatarUploadError> {
  const payload = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
  const code = typeof payload?.error?.code === 'string' ? payload.error.code : `http_${response.status}`;
  return new AvatarUploadError(code, messageForServerError(response.status, code));
}

function parseAccountAvatar(value: unknown): AccountAvatarRecord {
  if (!value || typeof value !== 'object') throw new AvatarUploadError('invalid_upload_response', '角色上传响应无效');
  const record = value as Record<string, unknown>;
  if (
    typeof record.avatarId !== 'string'
    || !AVATAR_ID_PATTERN.test(record.avatarId)
    || typeof record.name !== 'string'
    || typeof record.author !== 'string'
    || typeof record.avatarUrl !== 'string'
    || !record.avatarUrl.startsWith(`/avatars/${record.avatarId}/`)
  ) {
    throw new AvatarUploadError('invalid_upload_response', '角色上传响应无效');
  }
  return {
    avatarId: record.avatarId,
    name: record.name,
    author: record.author,
    hash: typeof record.hash === 'string' ? record.hash : '',
    avatarUrl: record.avatarUrl,
    launchUrl: typeof record.launchUrl === 'string' ? record.launchUrl : `/?avatar=${encodeURIComponent(record.avatarId)}`,
    ...(typeof record.bytes === 'number' ? { bytes: record.bytes } : {}),
    ...(typeof record.uploadedAt === 'string' ? { uploadedAt: record.uploadedAt } : {}),
    ...(typeof record.deduplicated === 'boolean' ? { deduplicated: record.deduplicated } : {}),
  };
}

export async function listAccountAvatars(fetcher: typeof fetch = fetch): Promise<AccountAvatarRecord[]> {
  const response = await fetcher('/api/account/avatars', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json().catch(() => null) as { schemaVersion?: unknown; avatars?: unknown } | null;
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.avatars)) {
    throw new AvatarUploadError('invalid_avatar_list', '角色列表响应无效');
  }
  return payload.avatars.map(parseAccountAvatar);
}

export async function uploadAccountAvatar(
  file: File,
  name: string,
  author: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AccountAvatarRecord> {
  await validateAvatarUploadFile(file);
  const safeName = safeAvatarName(name);
  const safeAuthor = safeAvatarName(author);
  if (!safeName) throw new AvatarUploadError('invalid_avatar_metadata', '角色名称需要 1–64 个安全字符');
  if (!safeAuthor) throw new AvatarUploadError('invalid_avatar_metadata', '请先填写有效的玩家昵称');
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('name', safeName);
  body.append('author', safeAuthor);
  const response = await fetcher('/api/account/avatars', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw await responseError(response);
  return parseAccountAvatar(await response.json().catch(() => null));
}
