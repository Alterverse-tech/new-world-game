import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyLobbyPropInteraction,
  code,
  createLobbyProp,
  interactLobbyProp,
  physics,
  updateLobbyProp,
} from './lobby-props/generated/trump-tower-residences';

type BoxCollider = {
  shape: 'box';
  halfExtents: readonly [number, number, number];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
};

const FLOOR_PROMPTS = {
  Lobby: /Lobby|lobby|大堂|大厅/,
  '35F': /35\s*F|35\s*层/i,
  '52F': /52\s*F|52\s*层/i,
  PH: /PH|Penthouse|顶层|空中别墅/i,
} as const;

function rootTransform(root: THREE.Object3D): number[] {
  return [
    ...root.position.toArray(),
    ...root.quaternion.toArray(),
    ...root.scale.toArray(),
  ];
}

function findNamedNode(root: THREE.Object3D, patterns: readonly RegExp[]): THREE.Object3D | undefined {
  let match: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (match) return;
    if (patterns.some((pattern) => pattern.test(child.name))) match = child;
  });
  return match;
}

function expectFloorState(root: THREE.Object3D, floor: keyof typeof FLOOR_PROMPTS): void {
  expect(root.userData.selectedFloor).toBe(floor);
  expect(root.userData.prompt).toEqual(expect.any(String));
  expect(root.userData.prompt.length).toBeGreaterThan(0);
  expect(root.userData.prompt).toMatch(FLOOR_PROMPTS[floor]);
}

function spans(value: number, center: number, halfExtent: number, tolerance = 0): boolean {
  return value >= center - halfExtent - tolerance
    && value <= center + halfExtent + tolerance;
}

describe('Trump Tower residences lobby prop', () => {
  it('exports the registered code and builds a lobby-scale enterable tower', () => {
    expect(code).toBe('trump-tower-residences');

    const root = createLobbyProp();
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());

    expect(bounds.isEmpty(), 'tower must contain visible geometry').toBe(false);
    expect(size.toArray().every(Number.isFinite)).toBe(true);
    expect(size.x).toBeGreaterThan(0);
    expect(size.y).toBeGreaterThan(0);
    expect(size.z).toBeGreaterThan(0);
    expect(bounds.min.y, 'tower root should sit at ground level').toBeGreaterThanOrEqual(-0.05);
    expect(size.y, 'tower must fit the lobby height budget').toBeLessThanOrEqual(8);
    expect(root.userData.interactionCenterAtEyeLevel).toBe(true);

    expect(findNamedNode(root, [/entrance/i, /main[-_ ]?door/i, /entry/i]), 'a named entrance is required')
      .toBeDefined();
    expect(findNamedNode(root, [/floor[-_ ]?35/i, /35[-_ ]?f/i, /35th/i]), '35F needs a named apartment node')
      .toBeDefined();
    expect(findNamedNode(root, [/floor[-_ ]?52/i, /52[-_ ]?f/i, /52nd/i]), '52F needs a named apartment node')
      .toBeDefined();
    expect(findNamedNode(root, [/penthouse/i, /(?:^|[-_ ])ph(?:$|[-_ ])/i]), 'the penthouse needs a named node')
      .toBeDefined();
  });

  it('declares eight fixed box colliders around an open entrance and private lobby wall', () => {
    expect(physics.body).toBe('fixed');
    expect(physics.mass).toBe(0);
    expect(physics.colliders).toHaveLength(8);
    expect(physics.colliders.every((collider) => collider.shape === 'box')).toBe(true);

    const colliders = physics.colliders as readonly BoxCollider[];
    for (const collider of colliders) {
      expect(collider.halfExtents).toHaveLength(3);
      expect(collider.position).toHaveLength(3);
      expect(collider.rotation).toHaveLength(3);
      expect(collider.halfExtents.every((value) => Number.isFinite(value) && value >= 0.05)).toBe(true);
      expect(collider.position.every(Number.isFinite)).toBe(true);
      expect(collider.rotation).toEqual([0, 0, 0]);
    }

    const root = createLobbyProp();
    const entrance = findNamedNode(root, [/entrance/i, /main[-_ ]?door/i, /entry/i]);
    expect(entrance, 'doorway collision checks require a named entrance').toBeDefined();
    root.updateMatrixWorld(true);
    const entrancePosition = entrance!.getWorldPosition(new THREE.Vector3());
    const doorwaySample = new THREE.Vector3(
      entrancePosition.x,
      Math.max(0.9, Math.min(1.8, entrancePosition.y)),
      entrancePosition.z,
    );
    const frontBoxes = colliders.filter((collider) => (
      spans(doorwaySample.z, collider.position[2], collider.halfExtents[2], 0.6)
    ));
    const doorwayHeightBoxes = frontBoxes.filter((collider) => (
      spans(doorwaySample.y, collider.position[1], collider.halfExtents[1])
    ));

    expect(
      doorwayHeightBoxes.some((collider) => (
        collider.position[0] + collider.halfExtents[0] < doorwaySample.x - 0.1
      )),
      'the entrance needs a left collision jamb',
    ).toBe(true);
    expect(
      doorwayHeightBoxes.some((collider) => (
        collider.position[0] - collider.halfExtents[0] > doorwaySample.x + 0.1
      )),
      'the entrance needs a right collision jamb',
    ).toBe(true);
    expect(
      doorwayHeightBoxes.some((collider) => (
        spans(doorwaySample.x, collider.position[0], collider.halfExtents[0])
      )),
      'the entrance opening must not be blocked at player height',
    ).toBe(false);
    expect(
      colliders.some((collider) => collider.position[2] === 0.75 && collider.halfExtents[0] >= 2.7),
      'the lobby must be physically separated from the 35F private apartment',
    ).toBe(true);
  });

  it('cycles Lobby, 35F, 52F, and PH locally without changing the shared root transform', () => {
    const root = createLobbyProp();
    root.position.set(6, 1.25, -4);
    root.rotation.set(0.08, -0.45, 0.03);
    root.scale.set(1.15, 0.9, 1.05);
    const before = rootTransform(root);

    expectFloorState(root, 'Lobby');
    for (const floor of ['35F', '52F', 'PH', 'Lobby'] as const) {
      interactLobbyProp(root);
      expectFloorState(root, floor);
      expect(rootTransform(root)).toEqual(before);
    }
  });

  it('replays the authoritative interaction sequence while preserving placement', () => {
    const root = createLobbyProp();
    root.position.set(-8, 2, 7);
    root.rotation.set(-0.04, 0.72, 0.09);
    root.scale.setScalar(0.85);
    const before = rootTransform(root);

    const expectedFloors = ['35F', '52F', 'PH', 'Lobby'] as const;
    expectedFloors.forEach((floor, index) => {
      applyLobbyPropInteraction(root, { sequence: index + 1, ageSeconds: index * 0.25 }, 12 + index);
      expectFloorState(root, floor);
      expect(root.userData.interactionSequence).toBe(index + 1);
      expect(rootTransform(root)).toEqual(before);
    });
  });

  it('updates only owned descendants and never moves the shared root', () => {
    const root = createLobbyProp();
    root.position.set(2.5, 0.4, -9);
    root.rotation.set(0.11, -1.2, -0.06);
    root.scale.set(0.75, 1.1, 0.8);
    const before = rootTransform(root);

    for (const elapsed of [0, 0.25, 2.5, 120]) {
      updateLobbyProp(root, elapsed);
      expect(rootTransform(root)).toEqual(before);
    }
  });

  it('keeps floor selection and prompts isolated between instances', () => {
    const first = createLobbyProp();
    const second = createLobbyProp();
    const secondInitialPrompt = second.userData.prompt;

    expect(first.userData).not.toBe(second.userData);
    interactLobbyProp(first);
    expectFloorState(first, '35F');
    expectFloorState(second, 'Lobby');
    expect(second.userData.prompt).toBe(secondInitialPrompt);

    applyLobbyPropInteraction(second, { sequence: 3, ageSeconds: 0 }, 8);
    expectFloorState(first, '35F');
    expectFloorState(second, 'PH');

    interactLobbyProp(first);
    expectFloorState(first, '52F');
    expectFloorState(second, 'PH');
  });
});
