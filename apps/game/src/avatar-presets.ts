export interface AvatarPreset {
  id: string;
  name: string;
  description: string;
  modelUrl: string;
  rotationY: number;
  idleClipIndex?: number;
  walkClipIndex?: number;
  idlePoseTime?: number;
}

export const DEFAULT_AVATAR_ID = 'preset-ink-chibi';

export const AVATAR_PRESETS: readonly AvatarPreset[] = Object.freeze([
  Object.freeze({
    id: 'preset-ink-chibi',
    name: '墨羽旅人',
    description: '黑白系 Q 版角色',
    modelUrl: '/generated-assets/whiteroom-avatar-ink-chibi.glb',
    rotationY: Math.PI / 2,
    idleClipIndex: 0,
    walkClipIndex: 1,
    idlePoseTime: 1 / 24,
  }),
  Object.freeze({
    id: 'preset-cloud-doll',
    name: '云朵人偶',
    description: '柔光系 Q 版角色',
    modelUrl: '/generated-assets/whiteroom-avatar-cloud-doll.glb',
    rotationY: Math.PI / 2,
    walkClipIndex: 0,
    idlePoseTime: 1 / 24,
  }),
]);

const PRESET_BY_ID = new Map<string, AvatarPreset>(
  AVATAR_PRESETS.map((preset) => [preset.id, preset]),
);

export function avatarPresetById(avatarId: string): AvatarPreset | null {
  return PRESET_BY_ID.get(avatarId || DEFAULT_AVATAR_ID) ?? null;
}

export function isBuiltInAvatarId(avatarId: string): boolean {
  return PRESET_BY_ID.has(avatarId || DEFAULT_AVATAR_ID);
}
