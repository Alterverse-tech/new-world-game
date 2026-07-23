import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  code,
  createLobbyProp,
  diagnostics,
  getCelestialDragonDiagnostics,
  updateLobbyProp,
  updateLobbyVehicleVisual,
  vehicle,
} from './lobby-props/generated/celestial-dragon';
import type { LobbyVehicleVisualState } from './lobby-props/types';
import {
  createLobbyVehicleState,
  LobbyVehicleSimulation,
  type LobbyVehicleState,
} from './lobby-vehicle';

function vehicleState(overrides: Partial<LobbyVehicleVisualState> = {}): LobbyVehicleVisualState {
  return {
    phase: 'idle',
    speed: 0,
    normalizedSpeed: 0,
    throttle: 0,
    steering: 0,
    pitch: 0,
    roll: 0,
    vertical: 0,
    grounded: true,
    ...overrides,
  };
}

function rootTransform(root: THREE.Object3D): number[] {
  return [
    ...root.position.toArray(),
    ...root.quaternion.toArray(),
    ...root.scale.toArray(),
  ];
}

function nodeTransform(root: THREE.Object3D, name: string): number[] {
  const node = root.getObjectByName(name);
  expect(node, `expected named node ${name}`).toBeDefined();
  return [
    ...node!.position.toArray(),
    ...node!.quaternion.toArray(),
    ...node!.scale.toArray(),
  ];
}

function namedNodes(root: THREE.Object3D, pattern: RegExp): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((child) => {
    pattern.lastIndex = 0;
    if (pattern.test(child.name)) matches.push(child);
  });
  return matches;
}

function worldPosition(root: THREE.Object3D, name: string): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const node = root.getObjectByName(name);
  expect(node, `expected named node ${name}`).toBeDefined();
  return node!.getWorldPosition(new THREE.Vector3());
}

function expectRange(value: number, minimum: number, maximum: number, label: string): void {
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
  expect(value, `${label} must be >= ${minimum}`).toBeGreaterThanOrEqual(minimum);
  expect(value, `${label} must be <= ${maximum}`).toBeLessThanOrEqual(maximum);
}

function expectAnchor(anchor: readonly number[], limit: number, label: string): void {
  expect(anchor, `${label} must have x/y/z`).toHaveLength(3);
  anchor.forEach((value) => expectRange(value, -limit, limit, label));
}

describe('celestial dragon lobby rotorcraft', () => {
  it('exports a slow, weighty reviewed rotorcraft capability facing +Z', () => {
    expect(code).toBe('celestial-dragon');
    expect(vehicle).toMatchObject({ kind: 'aircraft', flightModel: 'rotorcraft' });
    expect(diagnostics).toMatchObject({
      forwardAxis: '+Z',
      modelStrategy: 'authored-procedural-pbr',
      animationClock: 'absolute-elapsed-seconds',
    });

    const [halfX, halfY, halfZ] = vehicle.collisionHalfExtents;
    expectRange(halfX, 0.25, 8, 'collision half-width');
    expectRange(halfY, 0.15, 4, 'collision half-height');
    expectRange(halfZ, 0.25, 8, 'collision half-depth');
    expectAnchor(vehicle.seatAnchor, 8, 'seat anchor');
    expectAnchor(vehicle.cameraAnchor, 12, 'camera anchor');
    expect(vehicle.exitAnchors.length).toBeGreaterThanOrEqual(2);
    expect(vehicle.exitAnchors.length).toBeLessThanOrEqual(8);
    vehicle.exitAnchors.forEach((anchor, index) => expectAnchor(anchor, 12, `exit anchor ${index}`));
    expect(Math.abs(vehicle.seatAnchor[0])).toBeLessThan(halfX);
    expect(vehicle.seatAnchor[1]).toBeGreaterThan(0);
    expect(vehicle.seatAnchor[1]).toBeLessThan(halfY * 2);
    expect(Math.abs(vehicle.seatAnchor[2])).toBeLessThan(halfZ);
    expect(vehicle.exitAnchors.every(([x, , z]) => Math.abs(x) > halfX || Math.abs(z) > halfZ)).toBe(true);
    expectRange(vehicle.enterDurationSeconds, 0, 2, 'enter duration');
    expectRange(vehicle.exitDurationSeconds, 0, 2, 'exit duration');

    const physics = vehicle.physics;
    expectRange(physics.massKg, 100, 100_000, 'mass');
    expect(physics.massKg).toBeGreaterThan(5_000);
    expectRange(physics.maxSpeed, 5, 60, 'maximum speed');
    expect(physics.maxSpeed).toBeLessThan(8);
    expectRange(physics.maxReverseSpeed, 1, 20, 'reverse speed');
    expectRange(physics.maxVerticalSpeed, 1, 20, 'vertical speed');
    expectRange(physics.engineAcceleration, 0.5, 60, 'engine acceleration');
    expectRange(physics.verticalAcceleration, 0.5, 40, 'vertical acceleration');
    expectRange(physics.groundBrakeDeceleration, 0.5, 60, 'ground brake');
    expectRange(physics.horizontalDrag, 0.01, 10, 'horizontal drag');
    expectRange(physics.pitchRate, 0.05, 3, 'pitch rate');
    expectRange(physics.yawRate, 0.05, 2, 'yaw rate');
    expectRange(physics.rollRate, 0.05, 4, 'roll rate');
    expectRange(physics.maxPitch, 0.1, 1.35, 'maximum pitch');
    expectRange(physics.maxRoll, 0.1, 1.5, 'maximum roll');
    expectRange(physics.controlResponse, 0.2, 20, 'control response');
    expectRange(physics.throttleResponse, 0.1, 10, 'throttle response');
    expectRange(physics.collisionRestitution, 0, 0.5, 'collision restitution');
    expectRange(physics.maxExitSpeed, 0.1, 8, 'maximum exit speed');
  });

  it('builds a complete dragon silhouette with detailed anatomy, tack, and +Z head direction', () => {
    const root = createLobbyProp();
    expect(root.name).toBe('CelestialDragon');
    expect(root.userData.forwardAxis).toBe('+Z');

    expect(namedNodes(root, /DragonNeckSegment-/).length).toBe(5);
    expect(namedNodes(root, /DragonTailSegment-/).length).toBe(10);
    expect(namedNodes(root, /DragonBellyPlate-|NeckBellyPlate-/).length).toBeGreaterThanOrEqual(20);
    expect(namedNodes(root, /BodyScale-|DorsalScale-|WingScale-/).length).toBeGreaterThanOrEqual(50);
    expect(namedNodes(root, /DragonManeTuft-|TailCloudTuft-/).length).toBeGreaterThanOrEqual(27);
    expect(namedNodes(root, /CrownHorn|AntlerProng/).length).toBe(8);
    expect(namedNodes(root, /DragonEye$/).length).toBe(2);
    expect(namedNodes(root, /DragonPupil$/).length).toBe(2);
    expect(namedNodes(root, /LowerFang-/).length).toBe(6);
    expect(namedNodes(root, /(?:Front|Rear)(?:Left|Right)Claw-/).length).toBe(12);
    expect(namedNodes(root, /WingHumerus/).length).toBe(2);
    expect(namedNodes(root, /WingRadius/).length).toBe(2);
    expect(namedNodes(root, /WingFinger-/).length).toBe(8);
    expect(namedNodes(root, /WingMembrane/).length).toBe(2);
    expect(root.getObjectByName('DragonLowerJaw')).toBeDefined();
    expect(root.getObjectByName('DragonSaddleSeat')).toBeDefined();
    expect(root.getObjectByName('LeftSaddleStirrup')).toBeDefined();
    expect(root.getObjectByName('RightSaddleStirrup')).toBeDefined();
    expect(root.getObjectByName('DragonChestHarness')).toBeDefined();

    const muzzle = worldPosition(root, 'DragonMuzzle');
    const body = worldPosition(root, 'CelestialDragonBody');
    const tail = worldPosition(root, 'DragonTailSegment-9');
    const leftWingTip = worldPosition(root, 'LeftWingRadius');
    const rightWingTip = worldPosition(root, 'RightWingRadius');
    expect(muzzle.z).toBeGreaterThan(body.z + 2.5);
    expect(tail.z).toBeLessThan(body.z - 4.5);
    expect(leftWingTip.x).toBeLessThan(-1);
    expect(rightWingTip.x).toBeGreaterThan(1);
  });

  it('fits the visible dragon to its host collision envelope and high-detail render budget', () => {
    const root = createLobbyProp();
    const report = getCelestialDragonDiagnostics(root);
    const [halfX, halfY, halfZ] = vehicle.collisionHalfExtents;
    const visibleHalfX = Math.max(Math.abs(report.bounds.min[0]), Math.abs(report.bounds.max[0]));
    const visibleHalfZ = Math.max(Math.abs(report.bounds.min[2]), Math.abs(report.bounds.max[2]));
    const tolerance = 0.1;

    expect(report.meshes).toBeGreaterThanOrEqual(190);
    expect(report.meshes).toBeLessThan(260);
    expect(report.shadowMeshes).toBeGreaterThanOrEqual(48);
    expect(report.shadowMeshes).toBeLessThanOrEqual(64);
    expect(report.geometries).toBeGreaterThan(50);
    expect(report.materials).toBeGreaterThanOrEqual(12);
    expect(report.materials).toBeLessThanOrEqual(diagnostics.maximumMaterials);
    expect(report.textures).toBe(0);
    expect(report.triangles).toBeGreaterThan(15_000);
    expect(report.triangles).toBeLessThanOrEqual(diagnostics.maximumTriangles);
    expect(report.bounds.min[1]).toBeGreaterThanOrEqual(-tolerance);
    expect(report.bounds.min[1]).toBeLessThan(0.2);
    expect(report.bounds.max[1]).toBeLessThanOrEqual(halfY * 2 + tolerance);
    expect(visibleHalfX).toBeLessThanOrEqual(halfX + tolerance);
    expect(visibleHalfZ).toBeLessThanOrEqual(halfZ + tolerance);
    expect(visibleHalfX / halfX).toBeGreaterThan(0.85);
    expect(report.bounds.max[1] / (halfY * 2)).toBeGreaterThan(0.8);
    expect(visibleHalfZ / halfZ).toBeGreaterThan(0.85);
    expect(report.anchors).toEqual({
      seat: vehicle.seatAnchor,
      camera: vehicle.cameraAnchor,
      exits: vehicle.exitAnchors,
    });
  });

  it('uses purposeful PBR materials and scopes shadow casting to silhouette-critical meshes', () => {
    const root = createLobbyProp();
    const materials = new Set<THREE.Material>();
    let physicalMaterials = 0;
    let shadowCasters = 0;
    let receiveOnlyMeshes = 0;
    root.traverse((child) => {
      expect(child.name.toLowerCase()).not.toMatch(/terminal|computer|system/);
      if (!(child instanceof THREE.Mesh)) return;
      expect(child.receiveShadow, `${child.name} must receive shadows`).toBe(true);
      if (child.castShadow) shadowCasters += 1;
      else receiveOnlyMeshes += 1;
      const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
      meshMaterials.forEach((material) => {
        materials.add(material);
        expect(material instanceof THREE.MeshStandardMaterial, `${child.name} must use a PBR material`).toBe(true);
        if (material instanceof THREE.MeshPhysicalMaterial) {
          physicalMaterials += 1;
          expect(material.transmission, `${child.name} must avoid a full-scene transmission prepass`).toBe(0);
        }
      });
    });
    expect(materials.size).toBeGreaterThanOrEqual(12);
    expect(physicalMaterials).toBeGreaterThan(5);
    expect(shadowCasters).toBeGreaterThanOrEqual(48);
    expect(shadowCasters).toBeLessThanOrEqual(64);
    expect(receiveOnlyMeshes).toBeGreaterThan(100);
    expect(root.userData.shadowCasterBudget).toBe(64);
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });
    updateLobbyProp(root, 0.5);
    expect(getCelestialDragonDiagnostics(root).shadowMeshes).toBe(64);
    const pearlLight = root.getObjectByName('CelestialDragonPearlLight');
    expect(pearlLight).toBeInstanceOf(THREE.PointLight);
    expect((pearlLight as THREE.PointLight).castShadow).toBe(false);
  });

  it('animates breathing, wings, neck, jaw, mane, legs, and tail while preserving the shared root', () => {
    const root = createLobbyProp();
    root.position.set(7, 3, -5);
    root.rotation.set(0.14, -0.5, 0.08);
    root.scale.setScalar(1.2);
    const before = rootTransform(root);

    updateLobbyProp(root, 0.2);
    const idleWing = nodeTransform(root, 'LeftWingRig');
    const idleTail = nodeTransform(root, 'DragonTailRig-8');
    updateLobbyProp(root, 1.35);
    expect(nodeTransform(root, 'LeftWingRig')).not.toEqual(idleWing);
    expect(nodeTransform(root, 'DragonTailRig-8')).not.toEqual(idleTail);
    expect(root.userData.animationMode).toBe('idle-soaring');

    updateLobbyVehicleVisual(root, vehicleState({
      phase: 'driving',
      speed: 5.4,
      normalizedSpeed: 0.87,
      throttle: 0.9,
      steering: 0.56,
      pitch: -0.22,
      roll: 0.31,
      vertical: 0.72,
      grounded: false,
    }), 2.1);
    expect(root.userData.animationMode).toBe('mounted-flight');
    expect(root.userData.animationSample).toMatchObject({ airborne: true });
    expect(Math.abs(root.getObjectByName('LeftWingRig')!.rotation.z)).toBeGreaterThan(0.05);
    expect(Math.abs(root.getObjectByName('DragonHeadRig')!.rotation.y)).toBeGreaterThan(0.02);
    expect(root.getObjectByName('DragonLowerJaw')!.rotation.x).toBeGreaterThan(0.06);
    expect(root.getObjectByName('FrontLeftLegRig')!.rotation.x).toBeLessThan(-0.4);
    expect(root.getObjectByName('CelestialDragonVisualRig')!.rotation.x).toBe(0);
    expect(root.getObjectByName('CelestialDragonVisualRig')!.rotation.z).toBe(0);
    expect(rootTransform(root)).toEqual(before);
  });

  it('produces the same internal pose at a 60 Hz endpoint regardless of frame chunking', () => {
    const stepped = createLobbyProp();
    const direct = createLobbyProp();
    const state = vehicleState({
      phase: 'driving',
      speed: 4.2,
      normalizedSpeed: 0.68,
      throttle: 0.74,
      steering: -0.35,
      pitch: 0.18,
      roll: -0.24,
      vertical: 0.22,
      grounded: false,
    });
    updateLobbyVehicleVisual(stepped, state, 0);
    updateLobbyVehicleVisual(direct, state, 0);
    for (let frame = 1; frame <= 180; frame += 1) updateLobbyProp(stepped, frame / 60);
    updateLobbyProp(direct, 3);

    for (const name of [
      'CelestialDragonVisualRig',
      'CelestialDragonBody',
      'LeftWingRig',
      'RightWingRig',
      'DragonNeckRig-4',
      'DragonHeadRig',
      'DragonLowerJaw',
      'DragonTailRig-9',
      'FrontLeftLegRig',
      'DragonManeTuft-12',
    ]) {
      expect(nodeTransform(stepped, name), `${name} endpoint must be deterministic`).toEqual(nodeTransform(direct, name));
    }
    expect(stepped.userData.animationSample).toEqual(direct.userData.animationSample);
  });

  it('keeps the heavy rotorcraft simulation deterministic across equivalent 60 Hz chunks', () => {
    const initial: LobbyVehicleState = {
      ...createLobbyVehicleState({ x: 0, y: 2, z: 0 }),
      phase: 'driving',
      grounded: false,
    };
    const stepped = new LobbyVehicleSimulation(vehicle, initial);
    const chunked = new LobbyVehicleSimulation(vehicle, initial);
    const input = { throttle: 0.72, yaw: 0.28, vertical: 0.18 };
    for (let frame = 0; frame < 180; frame += 1) stepped.advance(1 / 60, input);
    for (let chunk = 0; chunk < 60; chunk += 1) chunked.advance(1 / 20, input);
    expect(chunked.state.position.x).toBeCloseTo(stepped.state.position.x, 10);
    expect(chunked.state.position.y).toBeCloseTo(stepped.state.position.y, 10);
    expect(chunked.state.position.z).toBeCloseTo(stepped.state.position.z, 10);
    expect(chunked.state.yaw).toBeCloseTo(stepped.state.yaw, 10);
    expect(chunked.state.pitch).toBeCloseTo(stepped.state.pitch, 10);
    expect(chunked.state.roll).toBeCloseTo(stepped.state.roll, 10);
    expect(chunked.state.speed).toBeCloseTo(stepped.state.speed, 10);
  });
});
