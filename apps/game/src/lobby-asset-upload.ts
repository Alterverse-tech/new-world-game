export const LOBBY_ASSET_MAX_BYTES = 15 * 1024 * 1024;

const GLB_HEADER_BYTES = 20;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;

export interface LobbyGlbFileLike {
  readonly name: string;
  readonly size: number;
  slice(start?: number, end?: number): Blob;
}

export interface LobbyGlbPreflightResult {
  readonly fileName: string;
  readonly bytes: number;
  readonly declaredBytes: number;
  readonly jsonChunkBytes: number;
}

export class LobbyAssetPreflightError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LobbyAssetPreflightError';
  }
}

export function normalizeLobbyAssetLabel(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || !Number.isSafeInteger(maximum) || maximum < 1) return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const printable = [...normalized].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint !== 0x7f;
  });
  if (printable.length === 0 || printable.length > maximum) return null;
  return printable.join('');
}

export function lobbyAssetNameFromFilename(fileName: string): string {
  const stem = fileName.replace(/\.glb$/iu, '').replace(/[_-]+/gu, ' ');
  return normalizeLobbyAssetLabel(stem, 40) ?? '我的 3D 物件';
}

export function formatLobbyAssetBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 100 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Performs a deliberately light, allocation-bounded GLB check before upload.
 * The platform remains authoritative for scene, extension and texture budgets.
 */
export async function preflightLobbyGlbFile(file: LobbyGlbFileLike): Promise<LobbyGlbPreflightResult> {
  if (!/\.glb$/iu.test(file.name)) {
    throw new LobbyAssetPreflightError('invalid_file_type', '请选择扩展名为 .glb 的模型文件');
  }
  if (!Number.isSafeInteger(file.size) || file.size < GLB_HEADER_BYTES) {
    throw new LobbyAssetPreflightError('invalid_lobby_asset_glb', '这个文件不是完整的 GLB 模型');
  }
  if (file.size > LOBBY_ASSET_MAX_BYTES) {
    throw new LobbyAssetPreflightError('lobby_asset_too_large', '模型不能超过 15 MB');
  }

  const header = await file.slice(0, GLB_HEADER_BYTES).arrayBuffer();
  if (header.byteLength < GLB_HEADER_BYTES) {
    throw new LobbyAssetPreflightError('invalid_lobby_asset_glb', '无法读取 GLB 文件头');
  }
  const view = new DataView(header);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new LobbyAssetPreflightError('invalid_lobby_asset_glb', '文件内容不是 glTF Binary（GLB）');
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new LobbyAssetPreflightError('lobby_asset_unsupported_version', '仅支持 glTF 2.0 GLB 模型');
  }
  const declaredBytes = view.getUint32(8, true);
  if (declaredBytes !== file.size) {
    throw new LobbyAssetPreflightError('invalid_lobby_asset_glb', 'GLB 文件长度不完整或已损坏');
  }
  const jsonChunkBytes = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== GLB_JSON_CHUNK
    || jsonChunkBytes < 2
    || GLB_HEADER_BYTES + jsonChunkBytes > declaredBytes
  ) {
    throw new LobbyAssetPreflightError('invalid_lobby_asset_glb', 'GLB 缺少有效的场景描述');
  }
  return Object.freeze({
    fileName: file.name,
    bytes: file.size,
    declaredBytes,
    jsonChunkBytes,
  });
}

export function lobbyAssetErrorMessage(code: string | null): string {
  switch (code) {
    case 'invalid_file_type':
    case 'invalid_upload':
      return '请选择一个完整的 .glb 文件后再试';
    case 'lobby_asset_too_large':
      return '模型超过 15 MB，请压缩后再上传';
    case 'invalid_lobby_asset_glb':
    case 'lobby_asset_unsupported_version':
      return '模型不是有效的 glTF 2.0 GLB 文件';
    case 'lobby_asset_external_resource':
      return '模型引用了外部贴图或文件，请导出为单个自包含 GLB';
    case 'lobby_asset_forbidden_scene_feature':
      return '模型含相机、灯光或音频，请移除后重新导出';
    case 'lobby_asset_unsupported_extension':
      return '模型使用了平台暂不支持的压缩或扩展';
    case 'lobby_asset_budget_exceeded':
      return '模型过于复杂，请减少面数或贴图尺寸后再试';
    case 'lobby_asset_capacity_reached':
      return '你的模型仓库已满，请稍后整理后再上传';
    case 'lobby_asset_storage_capacity_reached':
      return '平台模型存储暂时已满，请稍后再试';
    case 'lobby_asset_upload_rate_limited':
      return '上传得有点快，请稍等片刻再试';
    default:
      return '上传没有完成，请检查网络后重试';
  }
}
