import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  artworkCatalog,
  code,
  createLobbyProp,
  physics,
  updateLobbyProp,
} from './lobby-props/generated/metropolitan-museum-gallery';

type BoxCollider = {
  shape: 'box';
  halfExtents: readonly [number, number, number];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
};

function rootTransform(root: THREE.Object3D): number[] {
  return [
    ...root.position.toArray(),
    ...root.quaternion.toArray(),
    ...root.scale.toArray(),
  ];
}

function pointInsideBox(point: readonly [number, number, number], collider: BoxCollider): boolean {
  return point.every((value, axis) => (
    value >= collider.position[axis]! - collider.halfExtents[axis]!
    && value <= collider.position[axis]! + collider.halfExtents[axis]!
  ));
}

describe('Metropolitan Museum walk-through gallery lobby prop', () => {
  it('builds a grounded Fifth Avenue museum scale model that fits one home plot', () => {
    expect(code).toBe('metropolitan-museum-gallery');
    const root = createLobbyProp();
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());

    expect(bounds.isEmpty()).toBe(false);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(size.x).toBeLessThanOrEqual(11.8);
    expect(size.y).toBeLessThanOrEqual(6.2);
    expect(size.z).toBeLessThanOrEqual(11.8);
    expect(root.getObjectByName('FifthAvenueFacade')).toBeDefined();
    expect(root.getObjectByName('CentralPediment')).toBeDefined();
    expect(root.getObjectByName('TheMetFacadeSign')).toBeDefined();
    const entrance = root.getObjectByName('MainEntrance');
    expect(entrance).toBeDefined();
    expect(entrance!.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(4.7);
    expect(root.userData).toMatchObject({
      museum: 'The Metropolitan Museum of Art · New York',
      experience: 'walk-through-gallery',
      entranceDirection: '+Z',
      artworkCount: 10,
    });

    const unsafeNames: string[] = [];
    root.traverse((child) => {
      if (/terminal|computer|system/i.test(child.name)) unsafeNames.push(child.name);
    });
    expect(unsafeNames).toEqual([]);
  });

  it('hangs ten distinct named works as texture-free instanced mosaics', () => {
    expect(artworkCatalog).toHaveLength(10);
    expect(new Set(artworkCatalog.map((artwork) => artwork.key)).size).toBe(10);
    expect(new Set(artworkCatalog.map((artwork) => artwork.title)).size).toBe(10);

    const root = createLobbyProp();
    const artworks: THREE.Object3D[] = [];
    root.traverse((child) => {
      if (child.userData.kind === 'museum-artwork') artworks.push(child);
    });
    expect(artworks).toHaveLength(10);

    for (const metadata of artworkCatalog) {
      const artwork = root.getObjectByName(`Artwork-${metadata.key}`);
      const canvas = root.getObjectByName(`ArtworkCanvas-${metadata.key}`);
      const plaque = root.getObjectByName(`ArtworkPlaque-${metadata.key}`);
      expect(artwork?.userData).toMatchObject({
        kind: 'museum-artwork',
        title: metadata.title,
        artist: metadata.artist,
      });
      expect(canvas).toBeInstanceOf(THREE.InstancedMesh);
      expect((canvas as THREE.InstancedMesh).count).toBe(32 * 24);
      expect((canvas as THREE.InstancedMesh).instanceColor?.count).toBe(32 * 24);
      expect(((canvas as THREE.InstancedMesh).material as THREE.MeshBasicMaterial).map).toBeNull();
      expect(plaque?.userData).toMatchObject({ title: metadata.title, artist: metadata.artist });
    }
    expect(root.userData.artworkTitles).toEqual(artworkCatalog.map((artwork) => artwork.title));
  });

  it('uses eight fixed boxes while keeping the entrance, central hall, and both side galleries walkable', () => {
    expect(physics).toMatchObject({ body: 'fixed', mass: 0 });
    expect(physics.colliders).toHaveLength(8);
    expect(physics.colliders.every((collider) => collider.shape === 'box')).toBe(true);
    const colliders = physics.colliders as readonly BoxCollider[];
    for (const collider of colliders) {
      expect(collider.halfExtents.every((value) => Number.isFinite(value) && value >= 0.05)).toBe(true);
      expect(collider.position.every(Number.isFinite)).toBe(true);
      expect(collider.rotation).toEqual([0, 0, 0]);
    }

    const visitorPath = [
      [0, 1, 5.2], [0, 1, 4.84], [0, 1, 3.5], [0, 1, 0], [0, 1, -4.45],
      [-3.35, 1, 3.4], [-3.35, 1, 0], [-3.35, 1, -4.35],
      [3.35, 1, 3.4], [3.35, 1, 0], [3.35, 1, -4.35],
    ] as const;
    for (const point of visitorPath) {
      expect(
        colliders.some((collider) => pointInsideBox(point, collider)),
        `visitor path point ${point.join(',')} must remain clear`,
      ).toBe(false);
    }

    const ceiling = colliders.find((collider) => collider.position[1] > 5);
    expect(ceiling).toBeDefined();
    expect(ceiling!.position[1] - ceiling!.halfExtents[1]).toBeGreaterThan(5.2);
    const leftJamb = colliders.find((collider) => collider.position[2] > 4 && collider.position[0] < 0);
    const rightJamb = colliders.find((collider) => collider.position[2] > 4 && collider.position[0] > 0);
    expect(leftJamb!.position[0] + leftJamb!.halfExtents[0]).toBeLessThan(-2);
    expect(rightJamb!.position[0] - rightJamb!.halfExtents[0]).toBeGreaterThan(2);
  });

  it('stays within the code-prop render budget and creates no texture resources', () => {
    const root = createLobbyProp();
    let triangles = 0;
    let renderables = 0;
    let shadowCasters = 0;
    let lights = 0;
    let textures = 0;
    const materials = new Set<THREE.Material>();
    root.traverse((child) => {
      if (child instanceof THREE.Light) lights += 1;
      if (!(child instanceof THREE.Mesh)) return;
      renderables += 1;
      if (child.castShadow) shadowCasters += 1;
      const instances = child instanceof THREE.InstancedMesh ? child.count : 1;
      const geometryTriangles = child.geometry.index
        ? child.geometry.index.count / 3
        : (child.geometry.getAttribute('position')?.count ?? 0) / 3;
      triangles += geometryTriangles * instances;
      const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of meshMaterials) {
        materials.add(material);
        if ('map' in material && material.map) textures += 1;
      }
    });
    expect(triangles).toBeGreaterThan(15_000);
    expect(triangles).toBeLessThan(25_000);
    expect(renderables).toBeLessThan(180);
    expect(shadowCasters).toBeLessThanOrEqual(20);
    expect(lights).toBeLessThanOrEqual(5);
    expect(materials.size).toBeLessThanOrEqual(22);
    expect(textures).toBe(0);
  });

  it('animates only owned gallery lights and keeps instances isolated', () => {
    const first = createLobbyProp();
    const second = createLobbyProp();
    first.position.set(7, 0.5, -9);
    first.rotation.set(0.03, -0.6, -0.02);
    first.scale.set(0.9, 1.05, 0.95);
    const before = rootTransform(first);
    const firstLight = first.getObjectByName('GalleryWarmLight-0') as THREE.PointLight;
    const secondLight = second.getObjectByName('GalleryWarmLight-0') as THREE.PointLight;
    const secondIntensity = secondLight.intensity;
    const firstCanvas = first.getObjectByName('ArtworkCanvas-washington') as THREE.InstancedMesh;
    const secondCanvas = second.getObjectByName('ArtworkCanvas-washington') as THREE.InstancedMesh;

    updateLobbyProp(first, 13.5);
    expect(rootTransform(first)).toEqual(before);
    expect(firstLight.intensity).not.toBe(1.5);
    expect(secondLight.intensity).toBe(secondIntensity);
    expect(firstCanvas.geometry).not.toBe(secondCanvas.geometry);
    expect(firstCanvas.material).not.toBe(secondCanvas.material);
    expect(first.userData).not.toBe(second.userData);
  });
});
