import * as THREE from 'three';
import type { LobbyRotorcraftCapability, LobbyVehicleVisualState } from '../types';

export const code = 'celestial-dragon';

type VectorTuple = readonly [number, number, number];

export const vehicle = {
  kind: 'aircraft',
  flightModel: 'rotorcraft',
  seatAnchor: [0, 3.02, -0.28],
  exitAnchors: [[-5.25, 0, -0.15], [5.25, 0, -0.15], [0, 0, -6.75]],
  cameraAnchor: [0, 4.1, -7.7],
  collisionHalfExtents: [4.72, 2.36, 5.85],
  enterDurationSeconds: 0.72,
  exitDurationSeconds: 0.58,
  physics: {
    massKg: 5_600,
    maxSpeed: 6.2,
    maxReverseSpeed: 1.6,
    maxVerticalSpeed: 3,
    engineAcceleration: 3.4,
    verticalAcceleration: 3.2,
    groundBrakeDeceleration: 6.5,
    horizontalDrag: 2.8,
    yawRate: 0.72,
    pitchRate: 0.55,
    rollRate: 0.8,
    maxPitch: 0.28,
    maxRoll: 0.38,
    controlResponse: 2.4,
    throttleResponse: 1.8,
    collisionRestitution: 0.03,
    maxExitSpeed: 0.9,
  },
} satisfies LobbyRotorcraftCapability;

export const diagnostics = {
  forwardAxis: '+Z',
  modelStrategy: 'authored-procedural-pbr',
  maximumTriangles: 50_000,
  maximumMaterials: 20,
  collisionShape: 'host-owned-box-envelope',
  animationClock: 'absolute-elapsed-seconds',
} as const;

interface DragonMaterials {
  scalePrimary: THREE.MeshPhysicalMaterial;
  scaleSecondary: THREE.MeshStandardMaterial;
  belly: THREE.MeshPhysicalMaterial;
  mane: THREE.MeshStandardMaterial;
  horn: THREE.MeshStandardMaterial;
  claw: THREE.MeshStandardMaterial;
  wingMembrane: THREE.MeshPhysicalMaterial;
  wingVein: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  pupil: THREE.MeshStandardMaterial;
  saddleLeather: THREE.MeshPhysicalMaterial;
  saddleTrim: THREE.MeshStandardMaterial;
  harness: THREE.MeshStandardMaterial;
  pearl: THREE.MeshPhysicalMaterial;
}

export interface CelestialDragonDiagnostics {
  meshes: number;
  shadowMeshes: number;
  geometries: number;
  materials: number;
  textures: number;
  triangles: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  anchors: {
    seat: readonly [number, number, number];
    camera: readonly [number, number, number];
    exits: readonly (readonly [number, number, number])[];
  };
}

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const SHADOW_CASTER_BUDGET = 64;

function createMaterials(): DragonMaterials {
  return {
    scalePrimary: new THREE.MeshPhysicalMaterial({
      color: '#2f77a8',
      metalness: 0.18,
      roughness: 0.3,
      clearcoat: 0.72,
      clearcoatRoughness: 0.18,
      sheen: 0.22,
      sheenColor: new THREE.Color('#90d9ff'),
    }),
    scaleSecondary: new THREE.MeshStandardMaterial({
      color: '#123c67',
      metalness: 0.28,
      roughness: 0.4,
    }),
    belly: new THREE.MeshPhysicalMaterial({
      color: '#d9c48b',
      metalness: 0.16,
      roughness: 0.38,
      clearcoat: 0.35,
      clearcoatRoughness: 0.32,
    }),
    mane: new THREE.MeshStandardMaterial({
      color: '#caefff',
      emissive: '#2f8fc2',
      emissiveIntensity: 0.18,
      metalness: 0.05,
      roughness: 0.74,
    }),
    horn: new THREE.MeshStandardMaterial({
      color: '#eee2bd',
      metalness: 0.08,
      roughness: 0.48,
    }),
    claw: new THREE.MeshStandardMaterial({
      color: '#18202d',
      metalness: 0.48,
      roughness: 0.27,
    }),
    wingMembrane: new THREE.MeshPhysicalMaterial({
      color: '#285d87',
      emissive: '#0d2d4d',
      emissiveIntensity: 0.16,
      metalness: 0.08,
      roughness: 0.38,
      clearcoat: 0.38,
      clearcoatRoughness: 0.24,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
    wingVein: new THREE.MeshStandardMaterial({
      color: '#0c2946',
      metalness: 0.24,
      roughness: 0.45,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: '#ffd86b',
      emissive: '#ffb629',
      emissiveIntensity: 2.1,
      metalness: 0.15,
      roughness: 0.18,
    }),
    pupil: new THREE.MeshStandardMaterial({
      color: '#071018',
      metalness: 0.05,
      roughness: 0.78,
    }),
    saddleLeather: new THREE.MeshPhysicalMaterial({
      color: '#491823',
      metalness: 0.08,
      roughness: 0.44,
      clearcoat: 0.24,
      clearcoatRoughness: 0.45,
    }),
    saddleTrim: new THREE.MeshStandardMaterial({
      color: '#c89a3f',
      metalness: 0.78,
      roughness: 0.22,
    }),
    harness: new THREE.MeshStandardMaterial({
      color: '#23151a',
      metalness: 0.12,
      roughness: 0.62,
    }),
    pearl: new THREE.MeshPhysicalMaterial({
      color: '#e9fbff',
      emissive: '#6ddcff',
      emissiveIntensity: 1.7,
      metalness: 0.05,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      iridescence: 0.32,
      iridescenceIOR: 1.3,
    }),
  };
}

function shadowedMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: VectorTuple = [0, 0, 0],
  rotation: VectorTuple = [0, 0, 0],
  scale: VectorTuple = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function scopeDragonShadowCasters(root: THREE.Object3D): void {
  const candidates: Array<{ mesh: THREE.Mesh; score: number }> = [];
  const worldScale = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.receiveShadow = true;
    child.geometry.computeBoundingSphere();
    child.getWorldScale(worldScale);
    const radius = child.geometry.boundingSphere?.radius ?? 0;
    const silhouetteWeight = /Body|Chest|Head|Muzzle|Jaw|NeckSegment|TailSegment|WingMembrane|WingHumerus|WingRadius|LegUpper|LegLower|SaddleSeat/.test(child.name)
      ? 1.35
      : 1;
    candidates.push({
      mesh: child,
      score: radius * Math.max(worldScale.x, worldScale.y, worldScale.z) * silhouetteWeight,
    });
  });
  candidates.sort((left, right) => right.score - left.score || left.mesh.name.localeCompare(right.mesh.name));
  const casters = new Set(candidates.slice(0, SHADOW_CASTER_BUDGET).map(({ mesh }) => mesh));
  const policy = candidates.map(({ mesh }) => ({ mesh, castShadow: casters.has(mesh) }));
  for (const entry of policy) entry.mesh.castShadow = entry.castShadow;
  root.userData.shadowPolicy = policy;
  root.userData.shadowCasterBudget = SHADOW_CASTER_BUDGET;
}

function restoreDragonShadowPolicy(root: THREE.Object3D): void {
  const policy = root.userData.shadowPolicy as Array<{ mesh: THREE.Mesh; castShadow: boolean }> | undefined;
  if (!Array.isArray(policy)) return;
  for (const entry of policy) {
    if (entry.mesh.castShadow !== entry.castShadow) entry.mesh.castShadow = entry.castShadow;
  }
}

function addEllipsoid(
  parent: THREE.Object3D,
  name: string,
  position: VectorTuple,
  scale: VectorTuple,
  material: THREE.Material,
  widthSegments = 20,
  heightSegments = 14,
): THREE.Mesh {
  return shadowedMesh(
    parent,
    new THREE.SphereGeometry(1, widthSegments, heightSegments),
    material,
    name,
    position,
    [0, 0, 0],
    scale,
  );
}

function addCylinderBetween(
  parent: THREE.Object3D,
  name: string,
  startTuple: VectorTuple,
  endTuple: VectorTuple,
  radiusStart: number,
  radiusEnd: number,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const start = new THREE.Vector3(...startTuple);
  const end = new THREE.Vector3(...endTuple);
  const direction = end.clone().sub(start);
  const mesh = shadowedMesh(
    parent,
    new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), segments, 1, false),
    material,
    name,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

function addCone(
  parent: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  position: VectorTuple,
  rotation: VectorTuple,
  material: THREE.Material,
  segments = 10,
): THREE.Mesh {
  return shadowedMesh(
    parent,
    new THREE.ConeGeometry(radius, height, segments),
    material,
    name,
    position,
    rotation,
  );
}

function createWingMembraneGeometry(side: -1 | 1): THREE.BufferGeometry {
  const points: VectorTuple[] = [
    [0, 0.05, 0.22],
    [side * 1.35, 0.54, 0.08],
    [side * 3.72, 0.12, -0.74],
    [side * 3.08, -0.22, -1.42],
    [side * 2.1, -0.3, -1.72],
    [side * 1.12, -0.28, -1.58],
    [side * 0.25, -0.2, -1.1],
  ];
  const positions = new Float32Array(points.flat());
  const indices = [0, 1, 6, 1, 5, 6, 1, 2, 5, 2, 4, 5, 2, 3, 4];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildBody(parent: THREE.Group, materials: DragonMaterials): void {
  const body = addEllipsoid(
    parent,
    'CelestialDragonBody',
    [0, 2.15, -0.05],
    [0.83, 0.72, 1.58],
    materials.scalePrimary,
    32,
    20,
  );
  body.userData.baseScale = [0.83, 0.72, 1.58];

  const chest = addEllipsoid(
    parent,
    'CelestialDragonChest',
    [0, 2.28, 0.78],
    [0.9, 0.82, 0.9],
    materials.scalePrimary,
    28,
    18,
  );
  chest.userData.baseScale = [0.9, 0.82, 0.9];

  for (let index = 0; index < 15; index += 1) {
    const t = index / 14;
    const z = -1.25 + t * 3.35;
    const y = 1.49 + Math.max(0, t - 0.38) * 0.7;
    const width = 0.66 - Math.max(0, t - 0.62) * 0.36;
    shadowedMesh(
      parent,
      new THREE.CapsuleGeometry(0.075, Math.max(0.28, width), 4, 12),
      materials.belly,
      `DragonBellyPlate-${index}`,
      [0, y, z],
      [0, 0, HALF_PI],
      [1, 1, 0.58],
    );
  }

  const scaleGeometry = new THREE.ConeGeometry(0.1, 0.24, 7);
  for (let row = 0; row < 9; row += 1) {
    const z = -1.25 + row * 0.34;
    const taper = 1 - Math.abs(z) * 0.1;
    for (const side of [-1, 1]) {
      for (let band = 0; band < 2; band += 1) {
        const x = side * (0.7 - band * 0.14) * taper;
        const y = 2.25 + band * 0.35;
        shadowedMesh(
          parent,
          scaleGeometry,
          band === 0 ? materials.scaleSecondary : materials.scalePrimary,
          `BodyScale-${row}-${side < 0 ? 'L' : 'R'}-${band}`,
          [x, y, z],
          [side * 0.2, 0, side * -0.82],
          [1, 1, 0.62],
        );
      }
    }
  }
}

function buildNeckAndHead(parent: THREE.Group, materials: DragonMaterials): void {
  const neckPoints: VectorTuple[] = [
    [0, 2.42, 1.1],
    [0, 2.55, 1.48],
    [0, 2.7, 1.82],
    [0, 2.82, 2.14],
    [0, 2.88, 2.44],
  ];
  neckPoints.forEach((point, index) => {
    const rig = new THREE.Group();
    rig.name = `DragonNeckRig-${index}`;
    rig.position.set(...point);
    rig.userData.segmentIndex = index;
    parent.add(rig);
    addEllipsoid(
      rig,
      `DragonNeckSegment-${index}`,
      [0, 0, 0],
      [0.56 - index * 0.045, 0.48 - index * 0.035, 0.48],
      materials.scalePrimary,
      20,
      14,
    );
    addEllipsoid(
      rig,
      `NeckBellyPlate-${index}`,
      [0, -0.34, 0.08],
      [0.38 - index * 0.025, 0.08, 0.3],
      materials.belly,
      14,
      8,
    );
  });

  const headRig = new THREE.Group();
  headRig.name = 'DragonHeadRig';
  headRig.position.set(0, 2.93, 2.72);
  parent.add(headRig);
  addEllipsoid(headRig, 'DragonCranium', [0, 0.04, 0], [0.58, 0.48, 0.66], materials.scalePrimary, 30, 18);
  addEllipsoid(headRig, 'DragonMuzzle', [0, -0.13, 0.62], [0.49, 0.31, 0.62], materials.scaleSecondary, 24, 14);
  addEllipsoid(headRig, 'DragonNoseBridge', [0, 0.16, 0.46], [0.34, 0.22, 0.5], materials.scalePrimary, 22, 14);

  const jaw = new THREE.Group();
  jaw.name = 'DragonLowerJaw';
  jaw.position.set(0, -0.29, 0.42);
  headRig.add(jaw);
  addEllipsoid(jaw, 'DragonJawBone', [0, 0, 0.24], [0.43, 0.13, 0.56], materials.scaleSecondary, 20, 10);
  for (const side of [-1, 1]) {
    for (let tooth = 0; tooth < 3; tooth += 1) {
      addCone(
        jaw,
        `LowerFang-${side < 0 ? 'L' : 'R'}-${tooth}`,
        0.025,
        0.13,
        [side * (0.16 + tooth * 0.08), 0.08, 0.25 + tooth * 0.14],
        [Math.PI, 0, 0],
        materials.horn,
        8,
      );
    }
  }

  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'Left' : 'Right';
    addEllipsoid(headRig, `${sideName}DragonEye`, [side * 0.43, 0.19, 0.34], [0.12, 0.1, 0.08], materials.eye, 18, 12);
    addEllipsoid(headRig, `${sideName}DragonPupil`, [side * 0.454, 0.19, 0.402], [0.032, 0.068, 0.018], materials.pupil, 12, 8);
    addEllipsoid(headRig, `${sideName}Nostril`, [side * 0.19, -0.05, 1.08], [0.045, 0.032, 0.026], materials.claw, 12, 8);
    addCone(headRig, `${sideName}CheekSpike`, 0.1, 0.42, [side * 0.53, -0.02, 0.18], [0, 0, side * -HALF_PI], materials.horn, 10);
    addCone(headRig, `${sideName}Ear`, 0.15, 0.46, [side * 0.45, 0.32, -0.18], [-0.3, 0, side * -0.72], materials.scaleSecondary, 12);

    const hornCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.31, 0.36, -0.18),
      new THREE.Vector3(side * 0.48, 0.76, -0.35),
      new THREE.Vector3(side * 0.64, 1.04, -0.58),
      new THREE.Vector3(side * 0.71, 1.13, -0.88),
    ]);
    shadowedMesh(
      headRig,
      new THREE.TubeGeometry(hornCurve, 28, 0.055, 9, false),
      materials.horn,
      `${sideName}CrownHorn`,
    );
    for (let prong = 0; prong < 3; prong += 1) {
      const x = side * (0.47 + prong * 0.075);
      const y = 0.68 + prong * 0.15;
      const z = -0.38 - prong * 0.13;
      addCone(
        headRig,
        `${sideName}AntlerProng-${prong}`,
        0.038,
        0.27 - prong * 0.025,
        [x, y, z],
        [0, 0, side * -0.55],
        materials.horn,
        8,
      );
    }

    const whiskerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.3, -0.12, 0.88),
      new THREE.Vector3(side * 0.72, -0.06, 1.2),
      new THREE.Vector3(side * 1.08, 0.02, 1.02),
      new THREE.Vector3(side * 1.38, 0.14, 0.74),
    ]);
    shadowedMesh(
      headRig,
      new THREE.TubeGeometry(whiskerCurve, 24, 0.014, 6, false),
      materials.mane,
      `${sideName}CelestialWhisker`,
    );
  }

  const pearl = addEllipsoid(headRig, 'CelestialDragonPearl', [0, -0.48, 1.05], [0.17, 0.17, 0.17], materials.pearl, 24, 16);
  pearl.castShadow = true;
  const pearlLight = new THREE.PointLight('#7edfff', 0.75, 3.2, 2);
  pearlLight.name = 'CelestialDragonPearlLight';
  pearlLight.position.set(0, -0.45, 1.03);
  pearlLight.castShadow = false;
  headRig.add(pearlLight);
}

function buildMane(parent: THREE.Group, materials: DragonMaterials): void {
  for (let index = 0; index < 20; index += 1) {
    const t = index / 19;
    const z = -1.2 + t * 3.95;
    const arch = Math.sin(t * Math.PI);
    const y = 2.76 + arch * 0.62;
    const tuft = addCone(
      parent,
      `DragonManeTuft-${index}`,
      0.13 + arch * 0.08,
      0.42 + arch * 0.22,
      [0, y, z],
      [0.18 - t * 0.32, 0, 0],
      materials.mane,
      9,
    );
    tuft.userData.maneIndex = index;
  }

  for (let index = 0; index < 10; index += 1) {
    const z = -1.42 + index * 0.3;
    addCone(
      parent,
      `DorsalScale-${index}`,
      0.12,
      0.38 - index * 0.008,
      [0, 2.86 + Math.sin(index * 0.3) * 0.15, z],
      [0.12, 0, 0],
      materials.scaleSecondary,
      8,
    );
  }
}

function buildWing(parent: THREE.Group, side: -1 | 1, materials: DragonMaterials): void {
  const sideName = side < 0 ? 'Left' : 'Right';
  const wing = new THREE.Group();
  wing.name = `${sideName}WingRig`;
  wing.position.set(side * 0.68, 2.65, 0.42);
  parent.add(wing);

  addCylinderBetween(wing, `${sideName}WingHumerus`, [0, 0, 0.12], [side * 1.35, 0.54, 0.08], 0.13, 0.1, materials.wingVein, 16);
  addCylinderBetween(wing, `${sideName}WingRadius`, [side * 1.35, 0.54, 0.08], [side * 3.72, 0.12, -0.74], 0.1, 0.045, materials.wingVein, 14);
  const fingerEnds: VectorTuple[] = [
    [side * 3.72, 0.12, -0.74],
    [side * 3.08, -0.22, -1.42],
    [side * 2.1, -0.3, -1.72],
    [side * 1.12, -0.28, -1.58],
  ];
  fingerEnds.forEach((end, index) => {
    const start: VectorTuple = index === 0
      ? [side * 1.35, 0.54, 0.08]
      : [side * (1.2 - index * 0.12), 0.4 - index * 0.08, -0.02 - index * 0.04];
    addCylinderBetween(
      wing,
      `${sideName}WingFinger-${index}`,
      start,
      end,
      0.055 - index * 0.006,
      0.025,
      materials.wingVein,
      10,
    );
  });
  shadowedMesh(
    wing,
    createWingMembraneGeometry(side),
    materials.wingMembrane,
    `${sideName}WingMembrane`,
  );

  for (let index = 0; index < 5; index += 1) {
    const t = index / 4;
    const x = side * (0.58 + t * 2.75);
    const y = 0.03 + Math.sin(t * Math.PI) * 0.25;
    const z = -0.25 - t * 0.78;
    addEllipsoid(
      wing,
      `${sideName}WingScale-${index}`,
      [x, y, z],
      [0.22 - t * 0.06, 0.055, 0.32 - t * 0.08],
      materials.scalePrimary,
      12,
      8,
    );
  }
}

function buildLeg(
  parent: THREE.Group,
  side: -1 | 1,
  front: boolean,
  materials: DragonMaterials,
): void {
  const sideName = side < 0 ? 'Left' : 'Right';
  const endName = front ? 'Front' : 'Rear';
  const rig = new THREE.Group();
  rig.name = `${endName}${sideName}LegRig`;
  rig.position.set(side * (front ? 0.66 : 0.7), front ? 1.95 : 1.8, front ? 0.82 : -0.88);
  parent.add(rig);

  addEllipsoid(rig, `${endName}${sideName}Shoulder`, [0, -0.14, 0], front ? [0.31, 0.39, 0.34] : [0.38, 0.48, 0.43], materials.scalePrimary, 18, 12);
  addCylinderBetween(
    rig,
    `${endName}${sideName}UpperLeg`,
    [0, -0.23, 0],
    [side * 0.15, -0.73, front ? 0.12 : -0.08],
    front ? 0.17 : 0.22,
    front ? 0.13 : 0.17,
    materials.scaleSecondary,
    14,
  );
  addEllipsoid(rig, `${endName}${sideName}Knee`, [side * 0.16, -0.76, front ? 0.13 : -0.08], [0.22, 0.2, 0.22], materials.scalePrimary, 16, 10);
  addCylinderBetween(
    rig,
    `${endName}${sideName}LowerLeg`,
    [side * 0.16, -0.82, front ? 0.15 : -0.06],
    [side * 0.23, -1.5, front ? 0.33 : 0.2],
    0.13,
    0.095,
    materials.scaleSecondary,
    12,
  );
  addEllipsoid(rig, `${endName}${sideName}Foot`, [side * 0.23, -1.68, front ? 0.46 : 0.33], [0.27, 0.12, 0.38], materials.scalePrimary, 16, 10);
  for (let claw = 0; claw < 3; claw += 1) {
    addCone(
      rig,
      `${endName}${sideName}Claw-${claw}`,
      0.045,
      0.3,
      [side * 0.23 + (claw - 1) * 0.11, -1.73, (front ? 0.73 : 0.6) + Math.abs(claw - 1) * -0.04],
      [HALF_PI, 0, 0],
      materials.claw,
      9,
    );
  }
}

function buildTail(parent: THREE.Group, materials: DragonMaterials): void {
  const tailRoot = new THREE.Group();
  tailRoot.name = 'DragonTailRoot';
  tailRoot.position.set(0, 2.16, -1.42);
  parent.add(tailRoot);

  let segmentParent = tailRoot;
  for (let index = 0; index < 10; index += 1) {
    const segmentRig = new THREE.Group();
    segmentRig.name = `DragonTailRig-${index}`;
    segmentRig.position.set(0, index === 0 ? 0 : -0.015, index === 0 ? 0 : -0.4);
    segmentRig.userData.segmentIndex = index;
    segmentParent.add(segmentRig);
    const taper = 1 - index * 0.075;
    shadowedMesh(
      segmentRig,
      new THREE.CapsuleGeometry(0.23 * taper, 0.32, 5, 14),
      index % 2 === 0 ? materials.scalePrimary : materials.scaleSecondary,
      `DragonTailSegment-${index}`,
      [0, 0, -0.22],
      [HALF_PI, 0, 0],
    );
    if (index < 8) {
      addCone(
        segmentRig,
        `TailDorsalFin-${index}`,
        0.08 * taper,
        0.28 * taper,
        [0, 0.25 * taper, -0.2],
        [0.1, 0, 0],
        materials.mane,
        8,
      );
    }
    segmentParent = segmentRig;
  }

  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * TAU;
    addCone(
      segmentParent,
      `TailCloudTuft-${index}`,
      0.1,
      0.42,
      [Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, -0.48],
      [HALF_PI + Math.sin(angle) * 0.35, 0, Math.cos(angle) * 0.35],
      materials.mane,
      8,
    );
  }
}

function buildSaddle(parent: THREE.Group, materials: DragonMaterials): void {
  const saddle = new THREE.Group();
  saddle.name = 'DragonSaddleRig';
  saddle.position.set(0, 2.78, -0.28);
  parent.add(saddle);

  shadowedMesh(
    saddle,
    new THREE.CapsuleGeometry(0.34, 0.7, 8, 18),
    materials.saddleLeather,
    'DragonSaddleSeat',
    [0, 0.16, 0],
    [HALF_PI, 0, 0],
    [1.2, 1, 0.76],
  );
  addCylinderBetween(saddle, 'SaddleFrontPommel', [-0.43, 0.1, 0.38], [0.43, 0.1, 0.38], 0.055, 0.055, materials.saddleTrim, 14);
  addCylinderBetween(saddle, 'SaddleRearCantle', [-0.48, 0.19, -0.38], [0.48, 0.19, -0.38], 0.065, 0.065, materials.saddleTrim, 14);
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'Left' : 'Right';
    addCylinderBetween(saddle, `${sideName}SaddleStrap`, [side * 0.38, 0.12, 0.05], [side * 0.62, -0.58, 0.08], 0.028, 0.022, materials.harness, 8);
    shadowedMesh(
      saddle,
      new THREE.TorusGeometry(0.14, 0.025, 8, 18),
      materials.saddleTrim,
      `${sideName}SaddleStirrup`,
      [side * 0.67, -0.66, 0.1],
      [0, HALF_PI, 0],
    );
  }
  shadowedMesh(
    parent,
    new THREE.TorusGeometry(0.91, 0.035, 8, 36),
    materials.harness,
    'DragonChestHarness',
    [0, 2.2, 0.35],
    [HALF_PI, 0, 0],
    [1, 1.28, 1],
  );
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'CelestialDragon';
  root.userData.forwardAxis = '+Z';
  root.userData.vehicleKind = vehicle.kind;
  root.userData.flightModel = vehicle.flightModel;
  root.userData.seatAnchor = [...vehicle.seatAnchor];
  root.userData.animationMode = 'idle-soaring';
  root.userData.vehiclePhase = 'idle';
  root.userData.vehicleSpeed = 0;
  root.userData.vehicleNormalizedSpeed = 0;
  root.userData.vehicleThrottle = 0;
  root.userData.vehicleSteering = 0;
  root.userData.vehiclePitch = 0;
  root.userData.vehicleRoll = 0;
  root.userData.vehicleVertical = 0;
  root.userData.vehicleGrounded = true;

  const visualRig = new THREE.Group();
  visualRig.name = 'CelestialDragonVisualRig';
  root.add(visualRig);

  const materials = createMaterials();
  buildBody(visualRig, materials);
  buildNeckAndHead(visualRig, materials);
  buildMane(visualRig, materials);
  buildWing(visualRig, -1, materials);
  buildWing(visualRig, 1, materials);
  buildLeg(visualRig, -1, true, materials);
  buildLeg(visualRig, 1, true, materials);
  buildLeg(visualRig, -1, false, materials);
  buildLeg(visualRig, 1, false, materials);
  buildTail(visualRig, materials);
  buildSaddle(visualRig, materials);

  applyDragonAnimation(root, 0);
  scopeDragonShadowCasters(root);
  return root;
}

function finiteInput(value: unknown, minimum: number, maximum: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? THREE.MathUtils.clamp(numberValue, minimum, maximum) : 0;
}

function applyDragonAnimation(object: THREE.Object3D, elapsed: number): void {
  restoreDragonShadowPolicy(object);
  const phase = String(object.userData.vehiclePhase || 'idle');
  const active = phase !== 'idle';
  const grounded = object.userData.vehicleGrounded !== false;
  const speed = finiteInput(object.userData.vehicleNormalizedSpeed, 0, 1);
  const throttle = finiteInput(object.userData.vehicleThrottle, -1, 1);
  const steering = finiteInput(object.userData.vehicleSteering, -1, 1);
  const pitch = finiteInput(object.userData.vehiclePitch, -1, 1);
  const vertical = finiteInput(object.userData.vehicleVertical, -1, 1);
  const airborne = active && !grounded;

  const flapFrequency = airborne ? 0.78 + speed * 0.58 + Math.abs(vertical) * 0.12 : active ? 0.42 : 0.33;
  const flapPhase = elapsed * TAU * flapFrequency;
  const flapAmplitude = airborne ? 0.24 + Math.abs(vertical) * 0.08 : active ? 0.12 : 0.16;
  const flap = Math.sin(flapPhase) * flapAmplitude;
  const feather = Math.cos(flapPhase * 2 + 0.4) * (airborne ? 0.045 : 0.018);
  const leftWing = object.getObjectByName('LeftWingRig');
  const rightWing = object.getObjectByName('RightWingRig');
  if (leftWing) {
    leftWing.rotation.z = flap + steering * 0.045;
    leftWing.rotation.x = -0.04 + pitch * 0.08 + feather;
  }
  if (rightWing) {
    rightWing.rotation.z = -flap + steering * 0.045;
    rightWing.rotation.x = -0.04 + pitch * 0.08 - feather;
  }

  const breath = 1 + Math.sin(elapsed * 1.55) * (active ? 0.018 : 0.012);
  const body = object.getObjectByName('CelestialDragonBody');
  if (body) body.scale.set(0.83 * breath, 0.72 * breath, 1.58 / breath);
  const chest = object.getObjectByName('CelestialDragonChest');
  if (chest) chest.scale.set(0.9 * breath, 0.82 * breath, 0.9 / breath);

  for (let index = 0; index < 5; index += 1) {
    const neck = object.getObjectByName(`DragonNeckRig-${index}`);
    if (!neck) continue;
    const follow = (index + 1) / 5;
    neck.rotation.y = Math.sin(elapsed * 0.72 - index * 0.34) * 0.028 * follow + steering * 0.03 * follow;
    neck.rotation.x = Math.cos(elapsed * 0.57 - index * 0.21) * 0.012 + pitch * 0.018 * follow;
  }
  const head = object.getObjectByName('DragonHeadRig');
  if (head) {
    head.rotation.y = Math.sin(elapsed * 0.54) * 0.035 + steering * 0.08;
    head.rotation.x = Math.cos(elapsed * 0.43) * 0.018 + pitch * 0.04;
  }
  const jaw = object.getObjectByName('DragonLowerJaw');
  if (jaw) jaw.rotation.x = 0.035 + Math.max(0, throttle) * 0.055 + Math.sin(elapsed * 1.55) * 0.012;

  for (let index = 0; index < 10; index += 1) {
    const tail = object.getObjectByName(`DragonTailRig-${index}`);
    if (!tail) continue;
    const follow = (index + 1) / 10;
    tail.rotation.y = Math.sin(elapsed * (0.68 + speed * 0.3) - index * 0.38) * (0.025 + follow * 0.055) - steering * 0.032 * follow;
    tail.rotation.x = Math.cos(elapsed * 0.62 - index * 0.31) * (0.008 + follow * 0.025) - vertical * 0.018 * follow;
  }

  const tuck = airborne ? 0.48 : active ? 0.12 : 0.28;
  for (const name of ['FrontLeftLegRig', 'FrontRightLegRig']) {
    const leg = object.getObjectByName(name);
    if (leg) leg.rotation.x = -tuck + Math.sin(elapsed * 1.1) * 0.018;
  }
  for (const name of ['RearLeftLegRig', 'RearRightLegRig']) {
    const leg = object.getObjectByName(name);
    if (leg) leg.rotation.x = tuck * 0.65 - Math.sin(elapsed * 1.1) * 0.014;
  }

  for (let index = 0; index < 20; index += 1) {
    const tuft = object.getObjectByName(`DragonManeTuft-${index}`);
    if (tuft) tuft.rotation.z = Math.sin(elapsed * (1.1 + speed * 1.3) - index * 0.28) * (active ? 0.075 : 0.035);
  }

  const visualRig = object.getObjectByName('CelestialDragonVisualRig');
  if (visualRig) {
    visualRig.position.y = active
      ? airborne ? Math.sin(elapsed * 1.2) * 0.018 : Math.sin(elapsed * 0.65) * 0.008
      : 0.82 * (1 - Math.exp(-elapsed * 1.8)) + Math.sin(elapsed * 0.74) * 0.16;
    visualRig.rotation.x = 0;
    visualRig.rotation.z = 0;
  }
  object.userData.animationMode = airborne ? 'mounted-flight' : active ? 'mounted-grounded' : 'idle-soaring';
  object.userData.animationSample = {
    elapsed,
    flap,
    breath,
    airborne,
  };
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  applyDragonAnimation(object, Number.isFinite(elapsed) ? elapsed : 0);
}

export function updateLobbyVehicleVisual(
  object: THREE.Object3D,
  state: LobbyVehicleVisualState,
  elapsed: number,
): void {
  object.userData.vehiclePhase = state.phase;
  object.userData.vehicleSpeed = finiteInput(state.speed, -vehicle.physics.maxReverseSpeed, vehicle.physics.maxSpeed);
  object.userData.vehicleNormalizedSpeed = finiteInput(state.normalizedSpeed, 0, 1);
  object.userData.vehicleThrottle = finiteInput(state.throttle, -1, 1);
  object.userData.vehicleSteering = finiteInput(state.steering, -1, 1);
  object.userData.vehiclePitch = finiteInput(state.pitch, -1, 1);
  object.userData.vehicleRoll = finiteInput(state.roll, -1, 1);
  object.userData.vehicleVertical = finiteInput(state.vertical, -1, 1);
  object.userData.vehicleGrounded = state.grounded === true;
  applyDragonAnimation(object, Number.isFinite(elapsed) ? elapsed : 0);
}

export function getCelestialDragonDiagnostics(object: THREE.Object3D): CelestialDragonDiagnostics {
  let meshes = 0;
  let shadowMeshes = 0;
  let triangles = 0;
  const geometries = new Set<string>();
  const materials = new Set<string>();
  const textures = new Set<string>();
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes += 1;
    if (child.castShadow && child.receiveShadow) shadowMeshes += 1;
    geometries.add(child.geometry.uuid);
    const primitiveTriangles = child.geometry.index
      ? child.geometry.index.count / 3
      : (child.geometry.getAttribute('position')?.count ?? 0) / 3;
    const instances = child instanceof THREE.InstancedMesh ? child.count : 1;
    triangles += primitiveTriangles * instances;
    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of meshMaterials) {
      materials.add(material.uuid);
    }
  });
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    meshes,
    shadowMeshes,
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
    triangles: Math.round(triangles),
    bounds: {
      min: bounds.min.toArray() as [number, number, number],
      max: bounds.max.toArray() as [number, number, number],
      size: size.toArray() as [number, number, number],
    },
    anchors: {
      seat: vehicle.seatAnchor,
      camera: vehicle.cameraAnchor,
      exits: vehicle.exitAnchors,
    },
  };
}
