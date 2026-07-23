import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lobbyPropPlayerColliderBoxes } from './player-colliders';
import type { LobbyPhysicsDescriptor } from './types';

function expectVector(vector: THREE.Vector3, expected: readonly [number, number, number]): void {
  expect(vector.x).toBeCloseTo(expected[0], 6);
  expect(vector.y).toBeCloseTo(expected[1], 6);
  expect(vector.z).toBeCloseTo(expected[2], 6);
}

describe('lobby prop player colliders', () => {
  it('turns every reviewed fixed primitive into its own world AABB', () => {
    const root = new THREE.Group();
    const physics: LobbyPhysicsDescriptor = {
      body: 'fixed',
      mass: 0,
      friction: 1,
      restitution: 0,
      colliders: [
        { shape: 'box', halfExtents: [1, 0.5, 2], position: [2, 1, -1], rotation: [0, 0, 0] },
        { shape: 'ball', radius: 0.5, position: [-1, 2, 0], rotation: [0, 0, 0] },
        { shape: 'capsule', radius: 0.25, halfHeight: 0.75, position: [0, 1, 1], rotation: [0, 0, 0] },
      ],
    };

    const boxes = lobbyPropPlayerColliderBoxes(root, physics);

    expect(boxes).toHaveLength(3);
    expectVector(boxes[0]!.min, [1, 0.5, -3]);
    expectVector(boxes[0]!.max, [3, 1.5, 1]);
    expectVector(boxes[1]!.min, [-1.5, 1.5, -0.5]);
    expectVector(boxes[1]!.max, [-0.5, 2.5, 0.5]);
    expectVector(boxes[2]!.min, [-0.25, 0, 0.75]);
    expectVector(boxes[2]!.max, [0.25, 2, 1.25]);
  });

  it('applies the lobby object world transform after each primitive transform', () => {
    const parent = new THREE.Group();
    parent.position.set(10, 2, -4);
    parent.rotation.y = Math.PI / 2;
    parent.scale.setScalar(2);
    const root = new THREE.Group();
    parent.add(root);
    const physics: LobbyPhysicsDescriptor = {
      body: 'fixed',
      mass: 0,
      friction: 1,
      restitution: 0,
      colliders: [
        { shape: 'box', halfExtents: [1, 0.5, 0.25], position: [1, 0, 0], rotation: [0, 0, 0] },
      ],
    };

    const [box] = lobbyPropPlayerColliderBoxes(root, physics);

    expectVector(box!.min, [9.5, 1, -8]);
    expectVector(box!.max, [10.5, 3, -4]);
  });

  it('keeps whole-object bounds for dynamic and descriptor-free props', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 2));
    mesh.position.set(1, 2, -3);
    root.add(mesh);
    const dynamic: LobbyPhysicsDescriptor = {
      body: 'dynamic',
      mass: 10,
      friction: 0.8,
      restitution: 0.1,
      colliders: [
        { shape: 'ball', radius: 0.2, position: [0, 0, 0], rotation: [0, 0, 0] },
      ],
    };

    const expected = new THREE.Box3().setFromObject(root);
    const [dynamicBox] = lobbyPropPlayerColliderBoxes(root, dynamic);
    const [legacyBox] = lobbyPropPlayerColliderBoxes(root);

    expect(dynamicBox?.equals(expected)).toBe(true);
    expect(legacyBox?.equals(expected)).toBe(true);
  });
});
