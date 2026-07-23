import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createInfernalPianoScene } from './infernal-piano-scene';

function instanceMatrixSnapshot(mesh: THREE.InstancedMesh, index = 0): number[] {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return [...matrix.elements];
}

describe('infernal piano scene', () => {
  it('builds a black-water rock stage around an authored concert grand', () => {
    const scene = createInfernalPianoScene();
    scene.root.updateWorldMatrix(true, true);

    expect(scene.root.name).toBe('infernal-piano-scene');
    expect(scene.root.userData).toMatchObject({ realm: 'hell', environment: 'black-water-rock' });
    expect(scene.root.getObjectByName('infernal-black-water')).toBeInstanceOf(THREE.Mesh);
    expect(scene.root.getObjectByName('infernal-piano-rock')).toBeInstanceOf(THREE.Mesh);
    expect(scene.root.getObjectByName('infernal-piano-case')).toBeInstanceOf(THREE.Mesh);
    expect(scene.root.getObjectByName('infernal-piano-open-lid')).toBeInstanceOf(THREE.Mesh);
    expect(scene.root.getObjectByName('infernal-piano-gold-plate')).toBeInstanceOf(THREE.Mesh);
    expect(scene.root.getObjectByName('infernal-piano-string-bank')).toBeInstanceOf(THREE.InstancedMesh);
    expect(scene.root.getObjectByName('infernal-piano-pedal-lyre')).toBeInstanceOf(THREE.Group);
    expect(scene.root.getObjectByName('infernal-piano-music-desk')).toBeInstanceOf(THREE.Group);
    expect(scene.root.getObjectByName('infernal-flame-core')).toBeInstanceOf(THREE.InstancedMesh);
    expect(scene.root.getObjectByName('infernal-piano-embers')).toBeInstanceOf(THREE.Points);

    const piano = scene.root.getObjectByName('infernal-bespoke-concert-grand');
    expect(piano).toBeInstanceOf(THREE.Group);
    expect(piano?.scale.toArray()).toEqual([0.31, 0.32, 0.48]);
    expect(piano?.userData.presentedDimensionsMeters).toEqual({
      width: 1.55,
      length: 2.9,
      openLidHeight: 1.4,
    });

    const flameLayers = ['infernal-flame-outer', 'infernal-flame-middle', 'infernal-flame-core']
      .map((name) => scene.root.getObjectByName(name));
    expect(flameLayers.every((layer) => layer instanceof THREE.InstancedMesh)).toBe(true);
    for (const layer of flameLayers as THREE.InstancedMesh[]) {
      const material = layer.material as THREE.MeshBasicMaterial;
      expect(material.blending).toBe(THREE.NormalBlending);
      expect(material.toneMapped).toBe(true);
    }
  });

  it('provides all 88 individually animatable piano keys with the real 52/36 split', () => {
    const scene = createInfernalPianoScene();
    const whiteKeys = scene.keys.filter((key) => key.userData.isBlack !== true);
    const blackKeys = scene.keys.filter((key) => key.userData.isBlack === true);

    expect(scene.keys).toHaveLength(88);
    expect(scene.pianoKeys).toBe(scene.keys);
    expect(whiteKeys).toHaveLength(52);
    expect(blackKeys).toHaveLength(36);
    expect(scene.keys.map((key) => key.userData.midi)).toEqual(
      Array.from({ length: 88 }, (_, index) => 21 + index),
    );
    expect(new Set(scene.keys.map((key) => key.name)).size).toBe(88);
    expect(scene.keys.every((key) => key.castShadow && key.receiveShadow)).toBe(true);
    expect(new Set(whiteKeys.map((key) => key.geometry)).size).toBe(1);
    expect(new Set(blackKeys.map((key) => key.geometry)).size).toBe(1);
  });

  it('exposes non-empty collision proxies, a placement surface, and a nearby interaction anchor', () => {
    const scene = createInfernalPianoScene();
    scene.root.updateWorldMatrix(true, true);

    expect(scene.rockColliders.length).toBeGreaterThanOrEqual(4);
    expect(scene.rockColliders.every((collider) => collider instanceof THREE.Box3 && !collider.isEmpty())).toBe(true);
    expect(scene.placementSurfaces).toHaveLength(1);
    expect(scene.placementSurfaces[0]?.name).toBe('infernal-piano-rock');
    const placementRay = new THREE.Raycaster(
      new THREE.Vector3(0, 16, 1.2),
      new THREE.Vector3(0, -1, 0),
    );
    const placementHit = placementRay.intersectObjects(scene.placementSurfaces, true)[0];
    expect(placementHit).toBeDefined();
    expect(placementHit?.face?.normal.y).toBeGreaterThan(0.7);
    expect(scene.interactionAnchor.parent).toBe(scene.root);
    expect(scene.interactionAnchor.name).toBe('infernal-piano-interaction-anchor');
    expect(scene.interactionAnchor.userData).toMatchObject({
      interaction: 'play-original-score',
      prompt: '聆听原创钢琴曲',
      radius: 2.8,
    });
    expect(scene.interactionAnchor.position.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(2.2);
  });

  it('uses a stable animated water shader and keeps the lighting stack shadow-budgeted', () => {
    const scene = createInfernalPianoScene();
    const water = scene.root.getObjectByName('infernal-black-water');
    expect(water).toBeInstanceOf(THREE.Mesh);
    const material = (water as THREE.Mesh).material;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((material as THREE.Material).customProgramCacheKey()).toBe('infernal-black-water-pbr-v1');
    expect((material as THREE.MeshPhysicalMaterial).userData.timeUniforms.uTime.value).toBe(0);

    const lights: THREE.Light[] = [];
    scene.root.traverse((object) => {
      if (object instanceof THREE.Light) lights.push(object);
    });
    expect(lights).toHaveLength(4);
    expect(lights.filter((light) => 'castShadow' in light && light.castShadow === true)).toHaveLength(1);
    expect(scene.diagnostics.lightCount).toBe(4);
    expect(scene.diagnostics.shadowCastingLights).toBe(1);
  });

  it('updates keys, water, fire, and embers deterministically from elapsed playback state', () => {
    const scene = createInfernalPianoScene();
    const flames = scene.root.getObjectByName('infernal-flame-core');
    const water = scene.root.getObjectByName('infernal-black-water');
    expect(flames).toBeInstanceOf(THREE.InstancedMesh);
    expect(water).toBeInstanceOf(THREE.Mesh);
    const waterMaterial = (water as THREE.Mesh).material as THREE.Material;

    scene.update(2.75, 1 / 60, { playing: true, activeNotes: [0, 60, 108] });
    const firstKeyPositions = scene.keys.map((key) => [key.position.y, key.rotation.x, key.userData.pressed]);
    const firstFlameMatrix = instanceMatrixSnapshot(flames as THREE.InstancedMesh);
    const firstWaterY = (water as THREE.Mesh).position.y;
    expect(waterMaterial.userData.timeUniforms.uTime.value).toBe(2.75);
    expect(scene.keys[0]?.userData.pressed).toBe(true);
    expect(scene.keys[39]?.userData.pressed).toBe(true);
    expect(scene.keys[87]?.userData.pressed).toBe(true);

    scene.update(8.1, 0.2, { playing: false, activeNotes: [] });
    scene.update(2.75, 1 / 60, { playing: true, activeNotes: [0, 60, 108] });
    expect(scene.keys.map((key) => [key.position.y, key.rotation.x, key.userData.pressed])).toEqual(firstKeyPositions);
    expect(instanceMatrixSnapshot(flames as THREE.InstancedMesh)).toEqual(firstFlameMatrix);
    expect((water as THREE.Mesh).position.y).toBe(firstWaterY);
    expect(waterMaterial.userData.timeUniforms.uTime.value).toBe(2.75);
  });

  it('reports a shared-resource scene that fits the browser render budget', () => {
    const scene = createInfernalPianoScene();
    const diagnostics = scene.diagnostics;

    expect(diagnostics.keyCount).toBe(88);
    expect(diagnostics.flameInstanceCount).toBe(42);
    expect(diagnostics.emberCount).toBe(96);
    expect(diagnostics.colliderCount).toBe(scene.rockColliders.length);
    expect(diagnostics.instancedMeshCount).toBeGreaterThanOrEqual(5);
    expect(diagnostics.geometryCount).toBeLessThan(70);
    expect(diagnostics.materialCount).toBeLessThan(24);
    expect(diagnostics.textureCount).toBe(0);
    expect(diagnostics.approximateTriangles).toBeLessThan(300_000);
    expect(diagnostics.drawCallEstimate).toBeLessThan(220);
    expect(diagnostics.shaderCacheKeys).toContain('infernal-black-water-pbr-v1');
    expect(diagnostics.shaderCacheKeys).toContain('infernal-piano-embers-v2');
    expect(scene.root.userData.diagnostics).toBe(diagnostics);
  });

  it('marks the hero piano, rock, and key surfaces for cast/receive shadows', () => {
    const scene = createInfernalPianoScene();
    const requiredShadowMeshes = [
      'infernal-piano-rock',
      'infernal-piano-case',
      'infernal-piano-open-lid',
      'infernal-piano-gold-plate',
      'infernal-piano-keybed',
    ];
    for (const name of requiredShadowMeshes) {
      const object = scene.root.getObjectByName(name);
      expect(object, name).toBeInstanceOf(THREE.Mesh);
      expect((object as THREE.Mesh).castShadow, name).toBe(true);
      expect((object as THREE.Mesh).receiveShadow, name).toBe(true);
    }
  });
});
