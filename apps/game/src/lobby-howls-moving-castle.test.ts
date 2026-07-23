import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  code,
  createLobbyProp,
  updateLobbyVehicleVisual,
  vehicle,
} from './lobby-props/generated/howls-moving-castle';
import type { LobbyVehicleVisualState } from './lobby-props/types';
import {
  createLobbyVehicleState,
  stepLobbyVehicleFixed,
  type LobbyVehicleEnvironment,
  type LobbyVehicleInput,
  type LobbyVehicleState,
} from './lobby-vehicle';

type VisualMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

function rootTransform(object: THREE.Object3D): number[] {
  return [
    ...object.position.toArray(),
    ...object.quaternion.toArray(),
    ...object.scale.toArray(),
  ];
}

function materialVisualState(material: THREE.Material): object {
  const visual = material as VisualMaterial;
  return {
    type: material.type,
    visible: material.visible,
    opacity: material.opacity,
    transparent: material.transparent,
    color: visual.color?.getHex() ?? null,
    emissive: visual.emissive?.getHex() ?? null,
    emissiveIntensity: visual.emissiveIntensity ?? null,
  };
}

function descendantVisualState(root: THREE.Object3D): string {
  const state: object[] = [];
  root.traverse((child) => {
    if (child === root) return;
    state.push({
      name: child.name,
      position: child.position.toArray(),
      quaternion: child.quaternion.toArray(),
      scale: child.scale.toArray(),
      visible: child.visible,
      material: child instanceof THREE.Mesh
        ? (Array.isArray(child.material) ? child.material : [child.material]).map(materialVisualState)
        : null,
      light: child instanceof THREE.Light
        ? { color: child.color.getHex(), intensity: child.intensity }
        : null,
    });
  });
  return JSON.stringify(state);
}

function vehicleState(overrides: Partial<LobbyVehicleVisualState> = {}): LobbyVehicleVisualState {
  return {
    phase: 'idle',
    speed: 0,
    normalizedSpeed: 0,
    throttle: 0,
    steering: 0,
    vertical: 0,
    pitch: 0,
    roll: 0,
    grounded: true,
    ...overrides,
  };
}

function driveCastle(
  state: LobbyVehicleState,
  steps: number,
  input: LobbyVehicleInput,
  environment: LobbyVehicleEnvironment,
): LobbyVehicleState {
  let next = state;
  for (let index = 0; index < steps; index += 1) {
    next = stepLobbyVehicleFixed(next, input, vehicle, environment);
  }
  return next;
}

function namedNodes(root: THREE.Object3D, pattern: RegExp): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((child) => {
    pattern.lastIndex = 0;
    if (pattern.test(child.name)) matches.push(child);
  });
  return matches;
}

function worldPosition(object: THREE.Object3D): THREE.Vector3 {
  return object.getWorldPosition(new THREE.Vector3());
}

function expectFiniteAnchor(anchor: readonly number[], limit: number, label: string): void {
  expect(anchor, `${label} must contain exactly three coordinates`).toHaveLength(3);
  for (const value of anchor) {
    expect(Number.isFinite(value), `${label} coordinates must be finite`).toBe(true);
    expect(Math.abs(value), `${label} must stay inside the host safety range`).toBeLessThanOrEqual(limit);
  }
}

function expectRange(value: number, minimum: number, maximum: number, label: string): void {
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
  expect(value, `${label} must be at least ${minimum}`).toBeGreaterThanOrEqual(minimum);
  expect(value, `${label} must be at most ${maximum}`).toBeLessThanOrEqual(maximum);
}

function expectBoundsFitCapability(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  expect(bounds.isEmpty(), 'castle must have visible geometry').toBe(false);

  const [halfX, halfY, halfZ] = vehicle.collisionHalfExtents;
  const visibleHalfX = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const visibleHalfZ = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  const tolerance = 0.08;

  expect(bounds.min.y, 'castle root must sit at ground level').toBeGreaterThanOrEqual(-tolerance);
  expect(visibleHalfX, 'visible width must fit the collision capability').toBeLessThanOrEqual(halfX + tolerance);
  expect(bounds.max.y, 'visible height must fit the collision capability').toBeLessThanOrEqual(halfY * 2 + tolerance);
  expect(visibleHalfZ, 'visible depth must fit the collision capability').toBeLessThanOrEqual(halfZ + tolerance);

  expect(visibleHalfX / halfX, 'collision width should be fitted to the model').toBeGreaterThan(0.5);
  expect(bounds.max.y / (halfY * 2), 'collision height should be fitted to the model').toBeGreaterThan(0.5);
  expect(visibleHalfZ / halfZ, 'collision depth should be fitted to the model').toBeGreaterThan(0.5);
}

function compactName(object: THREE.Object3D): string {
  return object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const LEG_SIDES = [
  { label: 'front-left', words: ['frontleft', 'leftfront'], short: 'fl', x: -1, z: 1 },
  { label: 'front-right', words: ['frontright', 'rightfront'], short: 'fr', x: 1, z: 1 },
  { label: 'rear-left', words: ['rearleft', 'leftrear', 'backleft', 'leftback'], short: 'rl', x: -1, z: -1 },
  { label: 'rear-right', words: ['rearright', 'rightrear', 'backright', 'rightback'], short: 'rr', x: 1, z: -1 },
] as const;

function findLegSegment(
  root: THREE.Object3D,
  side: (typeof LEG_SIDES)[number],
  segment: 'hip' | 'knee' | 'foot',
): THREE.Object3D | undefined {
  let match: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (match) return;
    const name = compactName(child);
    const hasSide = side.words.some((words) => name.includes(words))
      || name.includes(`${side.short}${segment}`)
      || name.includes(`${segment}${side.short}`);
    if (hasSide && name.includes(segment)) match = child;
  });
  return match;
}

describe("Howl's Moving Castle lobby vehicle", () => {
  it('exports a fitted, v33-compatible car capability with +Z as its forward axis', () => {
    expect(code).toBe('howls-moving-castle');
    expect(vehicle.kind).toBe('car');
    expect(vehicle).not.toHaveProperty('locomotion');

    const root = createLobbyProp();
    expect(root.userData.forwardAxis).toBe('+Z');
    expectBoundsFitCapability(root);

    const [halfX, halfY, halfZ] = vehicle.collisionHalfExtents;
    expectRange(halfX, 0.25, 8, 'collision half-width');
    expectRange(halfY, 0.15, 4, 'collision half-height');
    expectRange(halfZ, 0.25, 8, 'collision half-depth');
    expectFiniteAnchor(vehicle.seatAnchor, 8, 'seat anchor');
    expectFiniteAnchor(vehicle.cameraAnchor, 12, 'camera anchor');
    expect(vehicle.exitAnchors.length).toBeGreaterThan(0);
    expect(vehicle.exitAnchors.length).toBeLessThanOrEqual(8);
    vehicle.exitAnchors.forEach((anchor, index) => expectFiniteAnchor(anchor, 12, `exit anchor ${index}`));

    expect(Math.abs(vehicle.seatAnchor[0])).toBeLessThanOrEqual(halfX);
    expect(vehicle.seatAnchor[1]).toBeGreaterThanOrEqual(0);
    expect(vehicle.seatAnchor[1]).toBeLessThanOrEqual(halfY * 2);
    expect(Math.abs(vehicle.seatAnchor[2])).toBeLessThanOrEqual(halfZ);
    expectRange(vehicle.enterDurationSeconds, 0, 2, 'enter duration');
    expectRange(vehicle.exitDurationSeconds, 0, 2, 'exit duration');

    const physics = vehicle.physics;
    expectRange(physics.massKg, 100, 20_000, 'mass');
    expectRange(physics.maxForwardSpeed, 2, 80, 'forward speed');
    expectRange(physics.maxReverseSpeed, 1, 30, 'reverse speed');
    expectRange(physics.engineAcceleration, 0.5, 60, 'engine acceleration');
    expectRange(physics.reverseAcceleration, 0.5, 40, 'reverse acceleration');
    expectRange(physics.brakeDeceleration, 1, 80, 'brake deceleration');
    expectRange(physics.rollingResistance, 0.01, 10, 'rolling resistance');
    expectRange(physics.aerodynamicDrag, 0, 0.25, 'aerodynamic drag');
    expectRange(physics.wheelBase, 0.5, 8, 'wheel base');
    expectRange(physics.maxSteerAngle, 0.05, 1.2, 'steer angle');
    expectRange(physics.steeringResponse, 0.5, 30, 'steering response');
    expectRange(physics.collisionRestitution, 0, 0.5, 'collision restitution');
    expectRange(physics.maxExitSpeed, 0.1, 5, 'maximum exit speed');
  });

  it('can drive out of an initial terminal overlap without allowing deeper penetration', () => {
    const environment: LobbyVehicleEnvironment = {
      colliders: [{
        min: { x: -1.21, y: 0, z: -8.05 },
        max: { x: 1.21, y: 3.95, z: -6.79 },
      }],
    };
    const initial: LobbyVehicleState = {
      ...createLobbyVehicleState({ x: 0, y: 0, z: -2.5 }),
      phase: 'driving',
    };

    const deeper = driveCastle(initial, 180, { throttle: -1 }, environment);
    expect(deeper.position.z, 'reverse must not push the rear hull farther into the terminal').toBeCloseTo(-2.5, 8);

    const escaped = driveCastle(initial, 180, { throttle: 1 }, environment);
    expect(escaped.position.z, 'forward movement must monotonically reduce and clear the overlap').toBeGreaterThan(-1.5);
    expect(escaped.speed).toBeGreaterThan(0.5);

    const normalWall: LobbyVehicleEnvironment = {
      colliders: [{
        min: { x: -5, y: 0, z: 8 },
        max: { x: 5, y: 5, z: 9 },
      }],
    };
    const blocked = driveCastle({ ...initial, position: { x: 0, y: 0, z: 0 } }, 360, { throttle: 1 }, normalWall);
    expect(blocked.position.z, 'ordinary collision blocking must remain intact').toBeLessThanOrEqual(3.61);
  });

  it('builds the recognizable mechanical castle silhouette facing +Z', () => {
    const root = createLobbyProp();
    root.updateMatrixWorld(true);

    for (const side of LEG_SIDES) {
      const hip = findLegSegment(root, side, 'hip');
      const knee = findLegSegment(root, side, 'knee');
      const foot = findLegSegment(root, side, 'foot');
      expect(hip, `${side.label} leg needs a named Hip node`).toBeDefined();
      expect(knee, `${side.label} leg needs a named Knee node`).toBeDefined();
      expect(foot, `${side.label} leg needs a named Foot node`).toBeDefined();

      const footPosition = worldPosition(foot!);
      expect(footPosition.x * side.x, `${side.label} foot must be on the named side`).toBeGreaterThan(0.05);
      expect(footPosition.z * side.z, `${side.label} foot must agree with +Z forward`).toBeGreaterThan(0.05);
    }

    const chimneyPositions = new Set(
      namedNodes(root, /chimney|smoke[-_ ]?stack|flue/i).map((node) => {
        const position = worldPosition(node);
        return `${position.x.toFixed(2)},${position.z.toFixed(2)}`;
      }),
    );
    expect(chimneyPositions.size, 'castle needs at least three separately placed chimneys').toBeGreaterThanOrEqual(3);
    expect(namedNodes(root, /tower|turret|spire/i).length, 'castle needs a named tower').toBeGreaterThan(0);
    expect(namedNodes(root, /roof|rooftop|gable/i).length, 'castle needs a named roof').toBeGreaterThan(0);
    expect(
      namedNodes(root, /^HowlTurret-/).filter((node) => node instanceof THREE.Group).length,
      'the film silhouette needs at least four separately stacked gun turrets',
    ).toBeGreaterThanOrEqual(4);
    expect(
      namedNodes(root, /^HowlHouse-/).filter((node) => node instanceof THREE.Group).length,
      'the castle needs a dense cluster of embedded miniature houses',
    ).toBeGreaterThanOrEqual(9);
    expect(
      namedNodes(root, /HowlSideWingFan-/).filter((node) => node instanceof THREE.Group).length,
      'the castle needs a ribbed industrial fin on both sides',
    ).toBe(2);
    expect(namedNodes(root, /HowlLeg(?:FL|FR|RL|RR)Claw-/).length, 'four feet need three claws each').toBe(12);
    expect(namedNodes(root, /CalciferEye-/).length, 'Calcifer must be visible inside the furnace mouth').toBe(2);

    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const frontEyes = namedNodes(root, /eye/i).filter((node) => worldPosition(node).z > center.z);
    const distinctEyePositions = new Set(frontEyes.map((node) => worldPosition(node).x.toFixed(2)));
    expect(distinctEyePositions.size, 'front facade needs two separately placed eyes').toBeGreaterThanOrEqual(2);
    expect(
      namedNodes(root, /mouth|jaw/i).some((node) => worldPosition(node).z > center.z),
      'front facade needs a mouth or jaw',
    ).toBe(true);
  });

  it('enables both shadows on every mesh and never uses protected system names', () => {
    const root = createLobbyProp();
    let meshCount = 0;
    root.traverse((child) => {
      expect(child.name.toLowerCase()).not.toMatch(/terminal|computer|system/);
      if (!(child instanceof THREE.Mesh)) return;
      meshCount += 1;
      expect(child.castShadow, `${child.name || 'unnamed mesh'} must cast shadows`).toBe(true);
      expect(child.receiveShadow, `${child.name || 'unnamed mesh'} must receive shadows`).toBe(true);
    });
    expect(meshCount, 'castle must contain renderable meshes').toBeGreaterThan(0);
  });

  it('animates idle machinery, propulsion, and steering without moving the shared root', () => {
    const idleRoot = createLobbyProp();
    const idleRootBefore = rootTransform(idleRoot);
    updateLobbyVehicleVisual(idleRoot, vehicleState(), 0.1);
    const idleBefore = descendantVisualState(idleRoot);
    updateLobbyVehicleVisual(idleRoot, vehicleState(), 1.35);
    expect(descendantVisualState(idleRoot), 'idle time must animate internal machinery').not.toBe(idleBefore);
    expect(rootTransform(idleRoot), 'idle animation cannot mutate the shared root').toEqual(idleRootBefore);

    const stoppedRoot = createLobbyProp();
    const movingRoot = createLobbyProp();
    const stoppedRootBefore = rootTransform(stoppedRoot);
    const movingRootBefore = rootTransform(movingRoot);
    updateLobbyVehicleVisual(stoppedRoot, vehicleState({ phase: 'driving' }), 1.1);
    updateLobbyVehicleVisual(movingRoot, vehicleState({
      phase: 'driving',
      speed: 12,
      normalizedSpeed: 0.7,
      throttle: 1,
    }), 1.1);
    expect(descendantVisualState(movingRoot), 'throttle and speed must animate propulsion').not.toBe(
      descendantVisualState(stoppedRoot),
    );
    expect(rootTransform(stoppedRoot), 'stopped visual update cannot mutate the shared root').toEqual(stoppedRootBefore);
    expect(rootTransform(movingRoot), 'propulsion animation cannot mutate the shared root').toEqual(movingRootBefore);

    const straightRoot = createLobbyProp();
    const steeringRoot = createLobbyProp();
    const straightRootBefore = rootTransform(straightRoot);
    const steeringRootBefore = rootTransform(steeringRoot);
    const driving = vehicleState({ phase: 'driving', speed: 7, normalizedSpeed: 0.4, throttle: 0.55 });
    updateLobbyVehicleVisual(straightRoot, driving, 0.8);
    updateLobbyVehicleVisual(steeringRoot, { ...driving, steering: 0.75 }, 0.8);
    expect(descendantVisualState(steeringRoot), 'steering input must articulate internal nodes').not.toBe(
      descendantVisualState(straightRoot),
    );
    expect(rootTransform(straightRoot), 'straight animation cannot mutate the shared root').toEqual(straightRootBefore);
    expect(rootTransform(steeringRoot), 'steering animation cannot mutate the shared root').toEqual(steeringRootBefore);
  });
});
