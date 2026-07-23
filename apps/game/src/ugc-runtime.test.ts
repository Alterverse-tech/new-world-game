import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createUGCLevelSdk,
  parseApprovedRegistry,
  registryEntryToLevel,
  reviewLevelBasePath,
  validateLevelManifest,
  type UGCLevelHost,
} from './ugc-runtime';
import type { Collectible, Interactable, WinType } from './types';

function manifest(type: WinType): Record<string, unknown> {
  const winCondition: Record<string, unknown> = { type };
  if (type === 'collect') winCondition.required = 2;
  if (type === 'puzzle' || type === 'escape') winCondition.flags = ['a', 'b'];
  if (type === 'survive') winCondition.duration = 12;
  return {
    schema: 'wr-level',
    schemaVersion: 1,
    engineApi: '1',
    id: 'community-test-level',
    name: '社区测试关',
    author: { name: 'tester' },
    description: 'runtime test',
    language: 'zh-CN',
    objective: '完成测试',
    objectiveDetail: type === 'custom' ? '按下测试按钮' : undefined,
    difficulty: 2,
    estimatedMinutes: 2,
    spawn: { position: [0, 0, 4], yawDeg: 0 },
    door: null,
    killY: -10,
    entry: 'main.js',
    contentRating: 'everyone',
    winCondition,
  };
}

describe('UGC registry and manifests', () => {
  it('keeps only approved, valid registry entries', () => {
    const entries = parseApprovedRegistry({
      levels: [
        { id: 'approved-world', name: '已批准', author: { name: 'A' }, status: 'approved', type: 'collect' },
        { id: '../invalid', name: '损坏条目', status: 'approved', type: 'custom' },
        { id: 'pending-world', name: '待审核', status: 'pending', type: 'custom' },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(registryEntryToLevel(entries[0]!).source).toBe('ugc');
    expect(entries[0]!.basePath).toBe('/levels/approved-world/');
  });

  it.each(['reach_zone', 'collect', 'puzzle', 'survive', 'eliminate', 'escape', 'custom'] as WinType[])(
    'validates %s manifests',
    (type) => {
      expect(validateLevelManifest(manifest(type), 'community-test-level').winCondition.type).toBe(type);
    },
  );

  it('rejects unsafe entry paths and mismatched ids', () => {
    const unsafe = manifest('custom');
    unsafe.entry = '../main.js';
    expect(() => validateLevelManifest(unsafe, 'community-test-level')).toThrow(/entry/);
    expect(() => validateLevelManifest(manifest('custom'), 'other-level')).toThrow(/id/);
  });

  it('builds a fixed same-origin review package path from a validated level id', () => {
    expect(reviewLevelBasePath('review-world-a1b2')).toBe('/api/admin/preview/review-world-a1b2/');
    expect(() => reviewLevelBasePath('../admin')).toThrow(/id/);
  });
});

describe('Level SDK subset', () => {
  it('keeps scene as a Group and drives pressure plates, targets and colliders', () => {
    const root = new THREE.Group();
    const player = new THREE.Vector3(2, 0, 0);
    const flags = new Map<string, boolean>();
    const interactables: Interactable[] = [];
    const collectibles: Collectible[] = [];
    let colliders = 0;
    let targets = 0;
    let down = 0;
    const host: UGCLevelHost = {
      root,
      addCollider: () => { colliders += 1; },
      addCollectible: (item) => collectibles.push(item),
      setGoalZone: () => undefined,
      addInteractable: (item) => interactables.push(item),
      setFlag: (name, value) => { flags.set(name, value); },
      getFlag: (name) => flags.get(name) ?? false,
      complete: () => undefined,
      fail: () => undefined,
      teleport: () => undefined,
      setCheckpoint: () => undefined,
      setBackground: () => undefined,
      setFog: () => undefined,
      addSun: () => new THREE.DirectionalLight(),
      setAmbient: () => undefined,
      setObjective: () => undefined,
      setProgress: () => undefined,
      toast: () => undefined,
      getPlayerPosition: () => player,
      registerTarget: () => { targets += 1; },
      downTarget: () => { down += 1; },
    };
    const created = createUGCLevelSdk(host, validateLevelManifest(manifest('puzzle'), 'community-test-level'));
    expect(created.sdk.scene).toBeInstanceOf(THREE.Group);
    created.sdk.scene.addBox({ position: [0, -0.5, 0], size: [10, 1, 10] });
    created.sdk.helpers.collectible({ position: [0, 1, 0] });
    created.sdk.helpers.pressurePlate({ position: [2, 0, 0], flag: 'a' });
    created.sdk.helpers.target({ position: [0, 1, -2] });
    created.runtime.update();
    expect(colliders).toBe(1);
    expect(collectibles).toHaveLength(1);
    expect(flags.get('a')).toBe(true);
    expect(targets).toBe(1);
    interactables.find((item) => item.id.startsWith('ugc-target'))!.onUse();
    expect(down).toBe(1);
  });
});
