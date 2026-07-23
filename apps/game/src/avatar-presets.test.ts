import { describe, expect, it } from 'vitest';
import { AVATAR_PRESETS, avatarPresetById, DEFAULT_AVATAR_ID, isBuiltInAvatarId } from './avatar-presets';

describe('built-in avatar presets', () => {
  it('offers two unique same-origin GLB choices without the retired Explorer', () => {
    expect(AVATAR_PRESETS).toHaveLength(2);
    expect(AVATAR_PRESETS.map((preset) => preset.id)).toEqual(['preset-ink-chibi', 'preset-cloud-doll']);
    expect(new Set(AVATAR_PRESETS.map((preset) => preset.id)).size).toBe(2);
    expect(AVATAR_PRESETS.map((preset) => `${preset.name} ${preset.description}`).join(' ')).not.toContain('探索者');
    for (const preset of AVATAR_PRESETS) {
      expect(preset.modelUrl).toMatch(/^\/generated-assets\/[a-z0-9-]+\.glb$/);
      expect(isBuiltInAvatarId(preset.id)).toBe(true);
    }
  });

  it('migrates the legacy empty selection to a stable real GLB default', () => {
    expect(DEFAULT_AVATAR_ID).toBe('preset-ink-chibi');
    expect(avatarPresetById('')?.id).toBe(DEFAULT_AVATAR_ID);
    expect(isBuiltInAvatarId('')).toBe(true);
  });

  it('does not mistake an uploaded avatar for a built-in preset', () => {
    expect(avatarPresetById('preset-ink-chibi')?.name).toBe('墨羽旅人');
    expect(isBuiltInAvatarId('avatar-demo-12345678')).toBe(false);
    expect(avatarPresetById('avatar-demo-12345678')).toBeNull();
  });

  it('defines a frozen neutral standing sample for every built-in Avatar', () => {
    for (const preset of AVATAR_PRESETS) {
      expect(preset.idlePoseTime).toBeCloseTo(1 / 24, 8);
    }
    expect(avatarPresetById('preset-cloud-doll')?.idleClipIndex).toBeUndefined();
    expect(avatarPresetById('preset-cloud-doll')?.walkClipIndex).toBe(0);
  });
});
