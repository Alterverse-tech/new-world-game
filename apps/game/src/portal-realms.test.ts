import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findLevel, LEVELS } from './levels';
import {
  createPersistentPortalSpace,
  isPersistentPortalSpaceId,
} from './portal-realms';
import type { PersistentSpaceId } from './lobby-channel';

const PERSISTENT_SPACE_IDS = ['heaven', 'hell'] as const satisfies readonly PersistentSpaceId[];

describe('persistent portal spaces', () => {
  it('keeps heaven and hell out of the LevelDefinition registry', () => {
    expect(LEVELS.map((level) => level.id)).toEqual([
      'skyline-relay-official',
      'memory-garden-official',
      'signal-order-official',
    ]);
    for (const id of PERSISTENT_SPACE_IDS) expect(() => findLevel(id)).toThrow(`Unknown level: ${id}`);
    expect(LEVELS.some((level) => /heaven|hell|celestial|infernal/.test(level.id))).toBe(false);
  });

  it.each(PERSISTENT_SPACE_IDS)('builds %s as a persistent shared scene without a gameplay goal', (id) => {
    const space = createPersistentPortalSpace(id);
    space.root.updateWorldMatrix(true, true);

    expect(space.root.name).toBe(`persistent-space:${id}`);
    expect(space.root.userData).toMatchObject({
      persistentSpaceId: id,
    });
    expect(space.spawn).toHaveLength(3);
    expect(space.returnPortal).toHaveLength(3);
    expect(space.root.userData.spawn).toEqual([...space.spawn]);
    expect(space.colliders.length).toBeGreaterThanOrEqual(1);
    expect(space.placementSurfaces.length).toBeGreaterThanOrEqual(1);
    expect(space.colliders.every((object) => object.parent === space.root)).toBe(true);
    expect(space.colliders.every((object) => !new THREE.Box3().setFromObject(object).isEmpty())).toBe(true);
    expect(space.background).toBeInstanceOf(THREE.Color);
    expect(space.fog).toBeInstanceOf(THREE.Fog);
    expect(space.exposure).toBeGreaterThan(0.5);
    expect(space.update).toBeTypeOf('function');
    expect(Object.hasOwn(space, 'goal')).toBe(false);
  });

  it('surrounds heaven with a dense cloud ocean and leaves the realm free of level state', () => {
    const heaven = createPersistentPortalSpace('heaven');
    expect(heaven.diagnostics).toMatchObject({ realm: 'heaven', cloudInstances: 356, shadowLights: 1, pianoKeys: 0 });
    expect(heaven.infernalPiano).toBeNull();
    expect(heaven.root.getObjectByName('celestial-cloud-flight-deck')).toBeTruthy();
    expect(heaven.root.getObjectByName('celestial-outer-cloud-bank')).toBeInstanceOf(THREE.InstancedMesh);
    heaven.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshPhysicalMaterial) {
          expect(material.transmission, `${child.name} must avoid a full-scene transmission prepass`).toBe(0);
        }
      }
    });
    heaven.update(12, 1 / 60);
    expect(heaven.root.getObjectByName('celestial-inner-cloud-bank')?.rotation.y).toBeCloseTo(0.0384, 5);
  });

  it('builds hell as black water, one reef, a shadowed 88-key concert grand, and live flames', () => {
    const hell = createPersistentPortalSpace('hell');
    expect(hell.diagnostics.realm).toBe('hell');
    expect(hell.diagnostics.pianoKeys).toBe(88);
    expect(hell.diagnostics.shadowLights).toBe(1);
    expect(hell.infernalPiano?.root.getObjectByName('infernal-black-water')).toBeTruthy();
    expect(hell.infernalPiano?.root.getObjectByName('infernal-piano-rock')).toBeTruthy();
    expect(hell.infernalPiano?.root.getObjectByName('infernal-bespoke-concert-grand')).toBeTruthy();
    hell.root.userData.pianoPlaying = true;
    hell.root.userData.pianoActiveNotes = [60, 64, 67];
    hell.update(4, 1 / 60);
    expect(hell.infernalPiano?.keys.filter((key) => key.userData.pressed === true)).toHaveLength(3);
  });

  it('creates isolated scene graphs for persistent collaborators', () => {
    const first = createPersistentPortalSpace('heaven');
    const second = createPersistentPortalSpace('heaven');
    const hell = createPersistentPortalSpace('hell');

    expect(first.root).not.toBe(second.root);
    expect(first.colliders[0]).not.toBe(second.colliders[0]);
    expect(first.root.userData.persistentSpaceId).toBe('heaven');
    expect(hell.root.userData.persistentSpaceId).toBe('hell');
    expect(first.background.getHex()).not.toBe(hell.background.getHex());
  });

  it('rejects arbitrary and retired level IDs as persistent destinations', () => {
    expect(isPersistentPortalSpaceId('heaven')).toBe(true);
    expect(isPersistentPortalSpaceId('hell')).toBe(true);
    expect(isPersistentPortalSpaceId('celestial-sanctum-official')).toBe(false);
    expect(isPersistentPortalSpaceId('infernal-abyss-official')).toBe(false);
    expect(isPersistentPortalSpaceId('community-signal-demo')).toBe(false);
    expect(isPersistentPortalSpaceId('https://evil.example')).toBe(false);
    expect(() => createPersistentPortalSpace('limbo' as never)).toThrow(TypeError);
  });
});
