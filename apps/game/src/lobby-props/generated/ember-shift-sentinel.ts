import * as THREE from 'three';

export const code = 'ember-shift-sentinel';

const TRANSFORM_SECONDS = 2.6;
const HALF_PI = Math.PI / 2;

type VectorTuple = [number, number, number];

interface PoseSpec {
  position: VectorTuple;
  rotation?: VectorTuple;
  scale?: VectorTuple;
}

interface PoseData {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface PoseMotion {
  robot: PoseData;
  vehicle: PoseData;
  start: number;
  end: number;
  arc: THREE.Vector3;
}

interface SentinelMaterials {
  crimson: THREE.MeshStandardMaterial;
  crimsonDark: THREE.MeshStandardMaterial;
  midnight: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  silver: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  cyan: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
}

interface InstanceSpec {
  position: VectorTuple;
  rotation?: VectorTuple;
  scale?: VectorTuple;
}

interface TransformEffects {
  group: THREE.Group;
  rings: THREE.Mesh[];
  sparks: THREE.Points;
}

function smoother01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function toPose(spec: PoseSpec): PoseData {
  const rotation = spec.rotation ?? [0, 0, 0];
  const scale = spec.scale ?? [1, 1, 1];
  return {
    position: new THREE.Vector3(...spec.position),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'XYZ')),
    scale: new THREE.Vector3(...scale),
  };
}

function addPosePart(
  controller: THREE.Object3D,
  parent: THREE.Object3D,
  name: string,
  robot: PoseSpec,
  vehicle: PoseSpec,
  range: [number, number],
  arc: VectorTuple = [0, 0, 0],
): THREE.Group {
  const part = new THREE.Group();
  part.name = name;
  part.userData.poseMotion = {
    robot: toPose(robot),
    vehicle: toPose(vehicle),
    start: range[0],
    end: range[1],
    arc: new THREE.Vector3(...arc),
  } satisfies PoseMotion;
  parent.add(part);
  (controller.userData.poseParts as THREE.Group[]).push(part);
  return part;
}

function applyPartPose(part: THREE.Group, amount: number): void {
  const motion = part.userData.poseMotion as PoseMotion;
  const local = smoother01((amount - motion.start) / Math.max(0.001, motion.end - motion.start));
  part.position.lerpVectors(motion.robot.position, motion.vehicle.position, local);
  part.position.addScaledVector(motion.arc, Math.sin(local * Math.PI));
  part.quaternion.slerpQuaternions(motion.robot.quaternion, motion.vehicle.quaternion, local);
  part.scale.lerpVectors(motion.robot.scale, motion.vehicle.scale, local);
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: VectorTuple = [0, 0, 0],
  rotation: VectorTuple = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBox(
  parent: THREE.Object3D,
  name: string,
  size: VectorTuple,
  position: VectorTuple,
  material: THREE.Material,
  rotation: VectorTuple = [0, 0, 0],
): THREE.Mesh {
  return addMesh(parent, new THREE.BoxGeometry(...size), material, name, position, rotation);
}

function addCylinder(
  parent: THREE.Object3D,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: VectorTuple,
  rotation: VectorTuple,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  return addMesh(
    parent,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    name,
    position,
    rotation,
  );
}

function addInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: InstanceSpec[],
  castShadow = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (const [index, instance] of instances.entries()) {
    dummy.position.set(...instance.position);
    dummy.rotation.set(...(instance.rotation ?? [0, 0, 0]));
    dummy.scale.set(...(instance.scale ?? [1, 1, 1]));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedBoxes(
  parent: THREE.Object3D,
  name: string,
  size: VectorTuple,
  material: THREE.Material,
  instances: InstanceSpec[],
): THREE.InstancedMesh {
  return addInstances(parent, name, new THREE.BoxGeometry(...size), material, instances);
}

function mergeStaticMeshes(parent: THREE.Group): void {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...parent.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const siblings = groups.get(child.material) ?? [];
    siblings.push(child);
    groups.set(child.material, siblings);
  }

  let groupIndex = 0;
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    let completeUvs = true;
    let castShadow = false;
    let receiveShadow = false;

    const appendGeometry = (source: THREE.BufferGeometry, matrix: THREE.Matrix4): void => {
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      geometry.applyMatrix4(matrix);
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      for (let index = 0; index < position.count; index += 1) {
        positions.push(position.getX(index), position.getY(index), position.getZ(index));
        if (normal) normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
        if (uv) uvs.push(uv.getX(index), uv.getY(index));
        else completeUvs = false;
      }
      geometry.dispose();
    };

    for (const mesh of meshes) {
      mesh.updateMatrix();
      castShadow ||= mesh.castShadow;
      receiveShadow ||= mesh.receiveShadow;
      if (mesh instanceof THREE.InstancedMesh) {
        const instanceMatrix = new THREE.Matrix4();
        const localMatrix = new THREE.Matrix4();
        for (let index = 0; index < mesh.count; index += 1) {
          mesh.getMatrixAt(index, instanceMatrix);
          localMatrix.multiplyMatrices(mesh.matrix, instanceMatrix);
          appendGeometry(mesh.geometry, localMatrix);
        }
      } else {
        appendGeometry(mesh.geometry, mesh.matrix);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length === positions.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    if (completeUvs && uvs.length * 3 === positions.length * 2) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, material);
    merged.name = `${parent.name}-Merged-${groupIndex}`;
    merged.castShadow = castShadow;
    merged.receiveShadow = receiveShadow;
    for (const mesh of meshes) {
      parent.remove(mesh);
      mesh.geometry.dispose();
    }
    parent.add(merged);
    groupIndex += 1;
  }
}

function chamferedGeometry(width: number, height: number, depth: number, chamfer: number): THREE.ExtrudeGeometry {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cut = Math.min(chamfer, halfWidth * 0.42, halfHeight * 0.42);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + cut, -halfHeight);
  shape.lineTo(halfWidth - cut, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight + cut);
  shape.lineTo(halfWidth, halfHeight - cut);
  shape.lineTo(halfWidth - cut, halfHeight);
  shape.lineTo(-halfWidth + cut, halfHeight);
  shape.lineTo(-halfWidth, halfHeight - cut);
  shape.lineTo(-halfWidth, -halfHeight + cut);
  shape.closePath();
  const bevel = Math.min(cut * 0.22, depth * 0.16);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depth - bevel * 2),
    steps: 1,
    bevelEnabled: bevel > 0.001,
    bevelSegments: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 1,
  });
  geometry.center();
  return geometry;
}

function addChamfered(
  parent: THREE.Object3D,
  name: string,
  size: VectorTuple,
  position: VectorTuple,
  material: THREE.Material,
  rotation: VectorTuple = [0, 0, 0],
  chamfer = 0.06,
): THREE.Mesh {
  return addMesh(
    parent,
    chamferedGeometry(size[0], size[1], size[2], chamfer),
    material,
    name,
    position,
    rotation,
  );
}

function createMaterials(): SentinelMaterials {
  return {
    crimson: new THREE.MeshStandardMaterial({ color: '#a91f2c', metalness: 0.72, roughness: 0.25 }),
    crimsonDark: new THREE.MeshStandardMaterial({ color: '#4a1018', metalness: 0.66, roughness: 0.34 }),
    midnight: new THREE.MeshStandardMaterial({ color: '#12283f', metalness: 0.76, roughness: 0.24 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: '#252b31', metalness: 0.88, roughness: 0.3 }),
    silver: new THREE.MeshStandardMaterial({ color: '#cbd5d9', metalness: 0.94, roughness: 0.18 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#101214', metalness: 0.08, roughness: 0.92 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#193a4d',
      emissive: '#0a5064',
      emissiveIntensity: 0.22,
      metalness: 0.46,
      roughness: 0.12,
      transparent: true,
      opacity: 0.88,
    }),
    cyan: new THREE.MeshStandardMaterial({
      color: '#7ee9f2',
      emissive: '#159eae',
      emissiveIntensity: 1.1,
      metalness: 0.28,
      roughness: 0.2,
    }),
    amber: new THREE.MeshStandardMaterial({
      color: '#ffd07a',
      emissive: '#ff8a1f',
      emissiveIntensity: 1.25,
      metalness: 0.2,
      roughness: 0.24,
    }),
  };
}

function buildHead(head: THREE.Group, materials: SentinelMaterials): void {
  addChamfered(head, 'SentinelHelmet', [0.46, 0.34, 0.39], [0, 0.02, 0], materials.midnight, [0, 0, 0], 0.07);
  addChamfered(head, 'SentinelFace', [0.27, 0.22, 0.09], [0, -0.035, 0.225], materials.silver, [0, 0, 0], 0.035);
  addBox(head, 'SentinelMouthGuard', [0.2, 0.055, 0.035], [0, -0.1, 0.28], materials.gunmetal);
  addInstancedBoxes(
    head,
    'SentinelFaceVents',
    [0.145, 0.012, 0.018],
    materials.crimsonDark,
    [-0.115, -0.075, -0.035].map((y) => ({ position: [0, y, 0.302] })),
  );
  addInstancedBoxes(
    head,
    'SentinelEyes',
    [0.115, 0.04, 0.025],
    materials.cyan,
    [-1, 1].map((side) => ({ position: [side * 0.08, 0.06, 0.3], rotation: [0, 0, side * -0.08] })),
  );
  addInstances(
    head,
    'SentinelEars',
    new THREE.CylinderGeometry(0.075, 0.075, 0.055, 10),
    materials.silver,
    [-1, 1].map((side) => ({ position: [side * 0.24, 0.02, 0], rotation: [0, 0, HALF_PI] })),
  );
  addInstancedBoxes(
    head,
    'SentinelAntennae',
    [0.035, 0.27, 0.045],
    materials.midnight,
    [-1, 1].map((side) => ({ position: [side * 0.18, 0.25, -0.015], rotation: [0, 0, side * -0.16] })),
  );
  addChamfered(head, 'SentinelCrest', [0.1, 0.25, 0.07], [0, 0.25, 0.19], materials.crimson, [0, 0, 0], 0.02);
  mergeStaticMeshes(head);
}

function buildTorso(
  controller: THREE.Object3D,
  torso: THREE.Group,
  materials: SentinelMaterials,
): void {
  addChamfered(torso, 'SentinelTorsoCore', [0.78, 0.9, 0.5], [0, 0, 0], materials.midnight, [0, 0, 0], 0.1);
  addBox(torso, 'SentinelSpine', [0.28, 0.82, 0.18], [0, -0.02, -0.32], materials.gunmetal);
  addCylinder(torso, 'SentinelChestReactorBezel', 0.15, 0.15, 0.06, [0, -0.08, 0.31], [HALF_PI, 0, 0], materials.silver, 16);
  addCylinder(torso, 'SentinelChestReactor', 0.105, 0.105, 0.07, [0, -0.08, 0.35], [HALF_PI, 0, 0], materials.cyan, 16);
  addCylinder(torso, 'SentinelChestReactorCore', 0.043, 0.043, 0.075, [0, -0.08, 0.39], [HALF_PI, 0, 0], materials.gunmetal, 12);

  addChamfered(torso, 'SentinelVehicleNosePlate', [0.64, 0.045, 0.3], [0, -0.48, 0], materials.gunmetal, [0, 0, 0], 0.035);
  addInstancedBoxes(
    torso,
    'SentinelVehicleNoseGrilles',
    [0.43, 0.026, 0.022],
    materials.silver,
    Array.from({ length: 4 }, (_, index) => ({ position: [0, -0.508, -0.09 + index * 0.06] })),
  );
  addInstancedBoxes(
    torso,
    'SentinelVehicleNoseIntakes',
    [0.13, 0.028, 0.1],
    materials.crimsonDark,
    [-1, 1].map((side) => ({ position: [side * 0.27, -0.51, 0.02] })),
  );

  for (const side of [-1, 1]) {
    const chest = addPosePart(
      controller,
      torso,
      side < 0 ? 'SentinelChestPanel-L' : 'SentinelChestPanel-R',
      { position: [side * 0.33, 0.18, 0.25] },
      { position: [side * 0.39, 0.1, 0.29], rotation: [0.18, 0, side * 0.06] },
      [0.34, 0.72],
      [side * 0.05, 0.03, 0.03],
    );
    addChamfered(chest, `SentinelCabArmor-${side}`, [0.48, 0.55, 0.18], [0, 0, 0], materials.crimson, [0, 0, 0], 0.075);
    addChamfered(chest, `SentinelWindshield-${side}`, [0.34, 0.25, 0.025], [0, 0.08, 0.11], materials.glass, [0, 0, side * -0.035], 0.035);
    addBox(chest, `SentinelWindshieldBar-${side}`, [0.025, 0.25, 0.02], [side * -0.16, 0.08, 0.13], materials.silver);
    addBox(chest, `SentinelHeadlamp-${side}`, [0.16, 0.055, 0.03], [side * 0.095, -0.2, 0.13], materials.cyan);
  }

  addInstancedBoxes(
    torso,
    'SentinelChestGrilles',
    [0.21, 0.025, 0.035],
    materials.silver,
    [-1, 1].flatMap((side) => Array.from({ length: 3 }, (_, index) => ({
      position: [side * 0.245, -0.29 + index * 0.055, 0.31] as VectorTuple,
    }))),
  );
  mergeStaticMeshes(torso);
}

function buildShoulder(shoulder: THREE.Group, side: number, materials: SentinelMaterials): void {
  addChamfered(shoulder, `SentinelShoulderArmor-${side}`, [0.45, 0.4, 0.48], [0, 0, 0], materials.crimson, [0, 0, side * -0.08], 0.08);
  addChamfered(shoulder, `SentinelShoulderInset-${side}`, [0.24, 0.2, 0.03], [side * 0.13, 0.02, 0.26], materials.midnight, [0, 0, side * -0.08], 0.035);
  addBox(shoulder, `SentinelShoulderSignal-${side}`, [0.13, 0.035, 0.035], [side * 0.13, -0.1, 0.29], materials.amber);
  addCylinder(shoulder, `SentinelShoulderJoint-${side}`, 0.13, 0.13, 0.19, [side * -0.24, -0.04, 0], [0, 0, HALF_PI], materials.silver, 12);
}

function buildArm(
  controller: THREE.Object3D,
  arm: THREE.Group,
  side: number,
  materials: SentinelMaterials,
): void {
  buildShoulder(arm, side, materials);
  addChamfered(arm, `SentinelUpperArm-${side}`, [0.28, 0.48, 0.28], [0, -0.43, 0], materials.midnight, [0, 0, side * 0.03], 0.055);
  addCylinder(arm, `SentinelElbow-${side}`, 0.115, 0.115, 0.31, [0, -0.7, 0], [0, 0, HALF_PI], materials.silver, 12);
  addInstances(
    arm,
    `SentinelArmPistons-${side}`,
    new THREE.CylinderGeometry(0.025, 0.025, 0.33, 8),
    materials.silver,
    [-0.09, 0.09].map((x) => ({ position: [x, -0.43, 0.16] })),
  );
  addChamfered(arm, `SentinelForearm-${side}`, [0.38, 0.58, 0.38], [0, -0.98, 0.025], materials.crimsonDark, [0, 0, side * -0.025], 0.07);
  addChamfered(arm, `SentinelForearmPlate-${side}`, [0.27, 0.42, 0.035], [0, -0.96, 0.22], materials.crimson, [0, 0, 0], 0.04);
  addInstancedBoxes(
    arm,
    `SentinelForearmVents-${side}`,
    [0.17, 0.018, 0.02],
    materials.gunmetal,
    Array.from({ length: 3 }, (_, index) => ({ position: [0, -0.86 - index * 0.06, 0.255] })),
  );

  const hand = addPosePart(
    controller,
    arm,
    side < 0 ? 'SentinelHand-L' : 'SentinelHand-R',
    { position: [0, -1.38, 0.05] },
    { position: [0, -1.03, 0], rotation: [HALF_PI, 0, 0], scale: [0.18, 0.18, 0.18] },
    [0.03, 0.23],
    [0, 0.08, 0.04],
  );
  addChamfered(hand, `SentinelPalm-${side}`, [0.27, 0.22, 0.23], [0, 0, 0], materials.gunmetal, [0, 0, 0], 0.04);
  addInstancedBoxes(
    hand,
    `SentinelFingers-${side}`,
    [0.047, 0.17, 0.055],
    materials.silver,
    Array.from({ length: 4 }, (_, index) => ({
      position: [-0.087 + index * 0.058, -0.16, 0.035],
      rotation: [0.08, 0, 0],
    })),
  );
  mergeStaticMeshes(hand);
  mergeStaticMeshes(arm);
}

function buildPelvis(pelvis: THREE.Group, materials: SentinelMaterials): void {
  addCylinder(pelvis, 'SentinelWaistBearing', 0.27, 0.27, 0.22, [0, 0.27, 0], [0, 0, 0], materials.silver, 12);
  addChamfered(pelvis, 'SentinelPelvisArmor', [0.78, 0.48, 0.48], [0, 0, 0], materials.midnight, [0, 0, 0], 0.09);
  addChamfered(pelvis, 'SentinelBeltPlate', [0.35, 0.22, 0.055], [0, 0.07, 0.27], materials.crimson, [0, 0, 0], 0.04);
  addBox(pelvis, 'SentinelBeltLight', [0.16, 0.045, 0.025], [0, 0.07, 0.31], materials.cyan);
  addInstances(
    pelvis,
    'SentinelHipJoints',
    new THREE.CylinderGeometry(0.14, 0.14, 0.18, 12),
    materials.gunmetal,
    [-1, 1].map((side) => ({ position: [side * 0.39, -0.05, 0], rotation: [0, 0, HALF_PI] })),
  );
  mergeStaticMeshes(pelvis);
}

function buildLeg(
  controller: THREE.Object3D,
  leg: THREE.Group,
  side: number,
  materials: SentinelMaterials,
): void {
  addChamfered(leg, `SentinelThigh-${side}`, [0.36, 0.55, 0.34], [0, -0.27, 0], materials.silver, [0, 0, side * -0.02], 0.06);
  addChamfered(leg, `SentinelThighArmor-${side}`, [0.26, 0.4, 0.035], [0, -0.25, 0.19], materials.midnight, [0, 0, 0], 0.035);
  addCylinder(leg, `SentinelKnee-${side}`, 0.13, 0.13, 0.35, [0, -0.58, 0.015], [0, 0, HALF_PI], materials.gunmetal, 12);
  addChamfered(leg, `SentinelKneeGuard-${side}`, [0.26, 0.25, 0.14], [0, -0.58, 0.2], materials.crimson, [0.12, 0, 0], 0.04);
  addChamfered(leg, `SentinelShin-${side}`, [0.43, 0.63, 0.42], [0, -0.91, 0], materials.midnight, [0, 0, side * 0.018], 0.075);
  addChamfered(leg, `SentinelShinArmor-${side}`, [0.31, 0.47, 0.045], [0, -0.9, 0.235], materials.crimson, [0, 0, 0], 0.05);
  addInstancedBoxes(
    leg,
    `SentinelShinVents-${side}`,
    [0.19, 0.022, 0.025],
    materials.silver,
    Array.from({ length: 3 }, (_, index) => ({ position: [0, -0.8 - index * 0.07, 0.275] })),
  );
  addInstances(
    leg,
    `SentinelCalfPistons-${side}`,
    new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8),
    materials.silver,
    [-0.11, 0.11].map((x) => ({ position: [x, -0.92, -0.24] })),
  );

  const foot = addPosePart(
    controller,
    leg,
    side < 0 ? 'SentinelFoot-L' : 'SentinelFoot-R',
    { position: [0, -1.18, 0.11] },
    { position: [0, -1.18, 0], rotation: [-1.22, 0, 0], scale: [1.08, 0.86, 1] },
    [0.58, 0.93],
    [0, 0.22, 0.04],
  );
  addChamfered(foot, `SentinelFootArmor-${side}`, [0.43, 0.24, 0.68], [0, 0, 0.1], materials.crimsonDark, [0, 0, 0], 0.07);
  addChamfered(foot, `SentinelToe-${side}`, [0.38, 0.13, 0.24], [0, -0.03, 0.47], materials.silver, [0.08, 0, 0], 0.035);
  addBox(foot, `SentinelSole-${side}`, [0.4, 0.055, 0.58], [0, -0.145, 0.08], materials.rubber);
  addBox(foot, `SentinelRearLamp-${side}`, [0.15, 0.055, 0.028], [0, 0.03, -0.25], materials.amber);
  mergeStaticMeshes(foot);
  mergeStaticMeshes(leg);
}

function buildWheel(wheel: THREE.Group, label: string, materials: SentinelMaterials): void {
  const spinner = new THREE.Group();
  spinner.name = `SentinelWheelSpinner-${label}`;
  wheel.add(spinner);
  addCylinder(spinner, `SentinelTire-${label}`, 0.285, 0.285, 0.17, [0, 0, 0], [0, 0, HALF_PI], materials.rubber, 18);
  addCylinder(spinner, `SentinelRim-${label}`, 0.16, 0.16, 0.185, [0, 0, 0], [0, 0, HALF_PI], materials.silver, 16);
  addCylinder(spinner, `SentinelHub-${label}`, 0.065, 0.065, 0.2, [0, 0, 0], [0, 0, HALF_PI], materials.cyan, 12);
  addInstancedBoxes(
    spinner,
    `SentinelSpokes-${label}`,
    [0.03, 0.2, 0.025],
    materials.gunmetal,
    Array.from({ length: 6 }, (_, index) => ({
      position: [0.095, 0, 0],
      rotation: [index * Math.PI / 3, 0, HALF_PI],
    })),
  );
  addInstancedBoxes(
    spinner,
    `SentinelTreads-${label}`,
    [0.19, 0.045, 0.075],
    materials.gunmetal,
    Array.from({ length: 12 }, (_, index) => {
      const angle = index * Math.PI / 6;
      return {
        position: [0, Math.cos(angle) * 0.277, Math.sin(angle) * 0.277],
        rotation: [angle, 0, 0],
      };
    }),
  );
  mergeStaticMeshes(spinner);
}

function buildRoof(roof: THREE.Group, materials: SentinelMaterials): void {
  addChamfered(roof, 'SentinelRoofShell', [1.12, 0.62, 0.18], [0, 0, 0], materials.crimsonDark, [0, 0, 0], 0.09);
  addChamfered(roof, 'SentinelRearGlass', [0.72, 0.29, 0.025], [0, 0.06, 0.105], materials.glass, [0, 0, 0], 0.045);
  addInstancedBoxes(
    roof,
    'SentinelRoofRails',
    [0.055, 0.5, 0.055],
    materials.silver,
    [-1, 1].map((side) => ({ position: [side * 0.46, 0, -0.13] })),
  );
  addBox(roof, 'SentinelRoofBeacon', [0.42, 0.045, 0.035], [0, 0.23, 0.13], materials.cyan);
  mergeStaticMeshes(roof);
}

function buildCabinGlass(cabin: THREE.Group, materials: SentinelMaterials): void {
  addChamfered(cabin, 'SentinelCabinWindshield', [0.88, 0.34, 0.045], [0, 0, 0], materials.glass, [0, 0, 0], 0.055);
  addInstancedBoxes(
    cabin,
    'SentinelCabinSilverFrames',
    [1, 1, 1],
    materials.silver,
    [
      { position: [0, 0.19, 0], scale: [0.96, 0.045, 0.055] },
      { position: [0, 0, 0], scale: [0.035, 0.34, 0.058] },
      { position: [-0.54, -0.03, 0], scale: [0.18, 0.035, 0.035] },
      { position: [0.54, -0.03, 0], scale: [0.18, 0.035, 0.035] },
    ],
  );
  addInstancedBoxes(
    cabin,
    'SentinelCabinGunmetalFrames',
    [1, 1, 1],
    materials.gunmetal,
    [
      { position: [0, -0.19, 0], scale: [0.96, 0.05, 0.055] },
      { position: [-0.46, 0, 0], rotation: [0, 0, 0.08], scale: [0.055, 0.38, 0.06] },
      { position: [0.46, 0, 0], rotation: [0, 0, -0.08], scale: [0.055, 0.38, 0.06] },
    ],
  );
  addInstances(
    cabin,
    'SentinelSideMirrors',
    chamferedGeometry(0.14, 0.1, 0.06, 0.025),
    materials.crimsonDark,
    [-1, 1].map((side) => ({ position: [side * 0.66, -0.03, 0] })),
  );
  mergeStaticMeshes(cabin);
}

function buildSideSkirt(skirt: THREE.Group, side: number, materials: SentinelMaterials): void {
  addChamfered(skirt, `SentinelSideSkirtArmor-${side}`, [0.17, 1.42, 0.22], [0, 0, 0], materials.gunmetal, [0, 0, 0], 0.045);
  addBox(skirt, `SentinelSideSkirtInset-${side}`, [0.06, 1.06, 0.025], [side * 0.085, 0, 0.125], materials.crimson);
  for (const parity of [0, 1]) {
    addInstancedBoxes(
      skirt,
      `SentinelSideSkirtLights-${side}-${parity}`,
      [0.035, 0.12, 0.03],
      parity === 0 ? materials.cyan : materials.silver,
      [parity, parity + 2].map((index) => ({ position: [side * 0.102, -0.42 + index * 0.28, 0.145] })),
    );
  }
  mergeStaticMeshes(skirt);
}

function buildBumper(bumper: THREE.Group, materials: SentinelMaterials): void {
  addChamfered(bumper, 'SentinelFrontBumper', [0.92, 0.24, 0.25], [0, 0, 0], materials.gunmetal, [0, 0, 0], 0.055);
  addInstancedBoxes(
    bumper,
    'SentinelBumperGrille',
    [0.045, 0.13, 0.035],
    materials.silver,
    Array.from({ length: 7 }, (_, index) => ({ position: [(index - 3) * 0.1, 0, 0.145] })),
  );
  addInstancedBoxes(
    bumper,
    'SentinelBumperLamps',
    [0.14, 0.055, 0.035],
    materials.amber,
    [-1, 1].map((side) => ({ position: [side * 0.32, 0.03, 0.155] })),
  );
  mergeStaticMeshes(bumper);
}

function buildExhaust(exhaust: THREE.Group, side: number, materials: SentinelMaterials): void {
  addCylinder(exhaust, `SentinelExhaust-${side}`, 0.055, 0.075, 0.65, [0, 0, 0], [0, 0, 0], materials.silver, 10);
  addCylinder(exhaust, `SentinelExhaustTip-${side}`, 0.075, 0.055, 0.13, [0, 0.37, 0], [0, 0, 0], materials.gunmetal, 10);
  addInstances(
    exhaust,
    `SentinelExhaustRings-${side}`,
    new THREE.CylinderGeometry(0.082, 0.082, 0.025, 10),
    materials.crimson,
    Array.from({ length: 3 }, (_, index) => ({ position: [0, -0.18 + index * 0.13, 0] })),
  );
  mergeStaticMeshes(exhaust);
}

function addTransformationEffects(root: THREE.Group, materials: SentinelMaterials): void {
  const effectGroup = new THREE.Group();
  effectGroup.name = 'SentinelTransformEffects';
  effectGroup.visible = false;
  root.add(effectGroup);
  const rings: THREE.Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: index === 1 ? '#ffad43' : '#45efff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = addMesh(
      effectGroup,
      new THREE.TorusGeometry(0.62 + index * 0.15, 0.018, 6, 36),
      ringMaterial,
      `SentinelTransformRing-${index}`,
      [0, 0.45 + index * 0.58, 0],
      [HALF_PI, 0, 0],
    );
    ring.visible = false;
    ring.castShadow = false;
    ring.receiveShadow = false;
    ring.raycast = () => {};
    ring.geometry.boundingBox = new THREE.Box3();
    rings.push(ring);
  }
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(10 * 3);
  const sparkColors = new Float32Array(10 * 3);
  for (let index = 0; index < 10; index += 1) {
    const color = new THREE.Color(index % 3 === 0 ? '#ffad43' : '#7af7ff');
    color.toArray(sparkColors, index * 3);
  }
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  sparkGeometry.boundingBox = new THREE.Box3();
  const sparkMaterial = new THREE.PointsMaterial({
    size: 0.075,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.name = 'SentinelTransformSparks';
  sparks.visible = false;
  sparks.frustumCulled = false;
  sparks.raycast = () => {};
  effectGroup.add(sparks);
  root.userData.transformEffects = { group: effectGroup, rings, sparks } satisfies TransformEffects;

  const underglow = addMesh(
    root,
    new THREE.RingGeometry(0.38, 0.72, 32),
    materials.cyan.clone(),
    'SentinelUnderglow',
    [0, 0.022, 0],
    [-HALF_PI, 0, 0],
  );
  underglow.castShadow = false;
  underglow.receiveShadow = false;
  (underglow.material as THREE.MeshStandardMaterial).transparent = true;
  (underglow.material as THREE.MeshStandardMaterial).opacity = 0.18;
  root.userData.underglow = underglow;
}

function setTransformAmount(root: THREE.Object3D, amount: number): void {
  for (const part of root.userData.poseParts as THREE.Group[]) applyPartPose(part, amount);
}

function updateEffects(root: THREE.Object3D, elapsed: number, amount: number, transforming: boolean): void {
  const activity = transforming ? Math.sin(Math.PI * THREE.MathUtils.clamp(amount, 0.04, 0.96)) : 0;
  const effects = root.userData.transformEffects as TransformEffects;
  effects.group.visible = transforming;
  for (const [index, ring] of effects.rings.entries()) {
    ring.visible = transforming;
    ring.rotation.z = elapsed * (index % 2 === 0 ? 1.8 : -1.45) + index;
    ring.scale.setScalar(0.82 + activity * 0.42 + Math.sin(elapsed * 4 + index) * 0.035);
    (ring.material as THREE.MeshBasicMaterial).opacity = activity * (0.48 - index * 0.08);
  }
  effects.sparks.visible = transforming;
  const sparkAttribute = effects.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
  if (transforming) {
    for (let index = 0; index < 10; index += 1) {
      const phase = elapsed * (1.7 + index * 0.035) + index * 2.399;
      const radius = 0.52 + (index % 4) * 0.13;
      sparkAttribute.setXYZ(
        index,
        Math.sin(phase) * radius,
        0.25 + ((index * 0.31 + elapsed * 0.8) % 2.55),
        Math.cos(phase) * radius,
      );
    }
    sparkAttribute.needsUpdate = true;
  }
  (effects.sparks.material as THREE.PointsMaterial).opacity = transforming ? activity * 0.9 : 0;

  const cyan = root.userData.cyanMaterial as THREE.MeshStandardMaterial;
  const amber = root.userData.amberMaterial as THREE.MeshStandardMaterial;
  cyan.emissiveIntensity = 0.95 + Math.sin(elapsed * 4.2) * 0.2 + activity * 1.8;
  amber.emissiveIntensity = 0.95 + (amount > 0.98 ? Math.max(0, Math.sin(elapsed * 3.6)) * 0.55 : 0) + activity * 0.7;
  const underglow = root.userData.underglow as THREE.Mesh | undefined;
  if (underglow) {
    const material = underglow.material as THREE.MeshStandardMaterial;
    material.opacity = 0.1 + amount * 0.18 + activity * 0.22;
    underglow.scale.setScalar(0.92 + amount * 0.58 + activity * 0.12);
  }
}

function trimSmallShadowCasters(root: THREE.Object3D): void {
  const size = new THREE.Vector3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return;
    bounds.getSize(size);
    if (Math.min(size.x, size.y, size.z) < 0.055 || size.length() < 0.28) mesh.castShadow = false;
  });
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'EmberShiftSentinelProp';
  root.userData.poseParts = [] as THREE.Group[];
  root.userData.vehicleAmount = 0;
  root.userData.targetVehicleAmount = 0;
  root.userData.lastElapsed = -1;
  root.userData.interactionState = 'robot';
  root.userData.transformCount = 0;
  root.userData.collisionVersion = 0;

  const materials = createMaterials();
  root.userData.cyanMaterial = materials.cyan;
  root.userData.amberMaterial = materials.amber;

  const rig = new THREE.Group();
  rig.name = 'SentinelArticulationRig';
  root.add(rig);

  const torso = addPosePart(
    root,
    rig,
    'SentinelTorsoPivot',
    { position: [0, 2.22, 0] },
    { position: [0, 0.72, 0.96], rotation: [-HALF_PI, 0, 0], scale: [1.12, 1.03, 1.08] },
    [0.27, 0.7],
    [0, 0.24, 0],
  );
  buildTorso(root, torso, materials);

  const head = addPosePart(
    root,
    torso,
    'SentinelHeadPivot',
    { position: [0, 0.77, 0.06], scale: [1.12, 1.12, 1.12] },
    { position: [0, 0.08, -0.06], rotation: [Math.PI, 0, 0], scale: [0.35, 0.35, 0.35] },
    [0.12, 0.48],
    [0, 0.12, -0.08],
  );
  buildHead(head, materials);

  const pelvis = addPosePart(
    root,
    rig,
    'SentinelPelvisPivot',
    { position: [0, 1.45, 0] },
    { position: [0, 0.48, -0.18], scale: [1.22, 0.7, 1.3] },
    [0.32, 0.76],
    [0, 0.16, 0],
  );
  buildPelvis(pelvis, materials);

  for (const side of [-1, 1]) {
    const arm = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelArmPivot-L' : 'SentinelArmPivot-R',
      { position: [side * 0.75, 2.5, 0], rotation: [-0.04, 0, side * 0.04] },
      { position: [side * 0.6, 0.66, 0.52], rotation: [HALF_PI, 0, side * 0.11], scale: [0.94, 0.94, 0.94] },
      [0.14, 0.5],
      [side * 0.17, 0.14, 0.08],
    );
    buildArm(root, arm, side, materials);

    const leg = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelLegPivot-L' : 'SentinelLegPivot-R',
      { position: [side * 0.31, 1.37, 0] },
      { position: [side * 0.31, 0.5, -0.18], rotation: [HALF_PI, 0, side * 0.025], scale: [0.96, 0.96, 0.96] },
      [0.42, 0.86],
      [side * 0.08, 0.55, 0],
    );
    buildLeg(root, leg, side, materials);

    const frontWheel = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelFrontWheel-L' : 'SentinelFrontWheel-R',
      { position: [side * 0.93, 2.55, -0.05] },
      { position: [side * 0.86, 0.4, 1.02] },
      [0.18, 0.68],
      [side * 0.11, 0.14, 0.04],
    );
    buildWheel(frontWheel, side < 0 ? 'FL' : 'FR', materials);

    const rearWheel = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelRearWheel-L' : 'SentinelRearWheel-R',
      { position: [side * 0.52, 0.66, -0.13] },
      { position: [side * 0.86, 0.4, -0.96] },
      [0.35, 0.84],
      [side * 0.1, 0.14, -0.02],
    );
    buildWheel(rearWheel, side < 0 ? 'RL' : 'RR', materials);

    const exhaust = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelExhaustPivot-L' : 'SentinelExhaustPivot-R',
      { position: [side * 0.55, 2.17, -0.32] },
      { position: [side * 0.67, 0.77, -0.39], scale: [0.86, 0.86, 0.86] },
      [0.34, 0.84],
      [side * 0.08, 0.12, -0.06],
    );
    buildExhaust(exhaust, side, materials);
  }

  const roof = addPosePart(
    root,
    rig,
    'SentinelRoofPivot',
    { position: [0, 2.23, -0.42] },
    { position: [0, 0.97, -0.14], rotation: [-HALF_PI, 0, 0], scale: [1.16, 1.08, 1] },
    [0.12, 0.95],
    [0, 0.47, -0.17],
  );
  buildRoof(roof, materials);

  const cabin = addPosePart(
    root,
    rig,
    'SentinelCabinGlassPivot',
    { position: [0, 2.25, -0.4], rotation: [0, Math.PI, 0], scale: [0.76, 0.76, 0.76] },
    { position: [0, 0.98, 0.25], rotation: [-0.5, 0, 0], scale: [1.05, 1.05, 1.05] },
    [0.34, 0.84],
    [0, 0.3, -0.06],
  );
  buildCabinGlass(cabin, materials);

  for (const side of [-1, 1]) {
    const skirt = addPosePart(
      root,
      rig,
      side < 0 ? 'SentinelSideSkirt-L' : 'SentinelSideSkirt-R',
      { position: [side * 0.57, 1.34, -0.3], rotation: [0, 0, side * 0.025], scale: [0.72, 0.72, 0.72] },
      { position: [side * 0.68, 0.38, -0.06], rotation: [HALF_PI, 0, 0], scale: [1, 1.08, 1] },
      [0.28, 0.82],
      [side * 0.09, 0.13, -0.03],
    );
    buildSideSkirt(skirt, side, materials);
  }

  const bumper = addPosePart(
    root,
    rig,
    'SentinelBumperPivot',
    { position: [0, 1.72, 0.25], scale: [0.76, 0.76, 0.76] },
    { position: [0, 0.43, 1.5], scale: [1.78, 0.92, 1] },
    [0.56, 0.89],
    [0, 0.13, 0.06],
  );
  buildBumper(bumper, materials);

  addTransformationEffects(root, materials);
  setTransformAmount(root, 0);
  trimSmallShadowCasters(root);
  return root;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const previousElapsed = Number(object.userData.lastElapsed);
  object.userData.lastElapsed = elapsed;
  let amount = THREE.MathUtils.clamp(Number(object.userData.vehicleAmount) || 0, 0, 1);
  const target = Number(object.userData.targetVehicleAmount) >= 0.5 ? 1 : 0;
  const delta = previousElapsed < 0 ? 0 : Math.max(0, elapsed - previousElapsed);
  if (amount !== target && delta > 0) {
    amount = target > amount
      ? Math.min(target, amount + delta / TRANSFORM_SECONDS)
      : Math.max(target, amount - delta / TRANSFORM_SECONDS);
  }

  const transforming = Math.abs(amount - target) > 0.0001;
  if (!transforming) amount = target;
  object.userData.vehicleAmount = amount;
  if (transforming) {
    object.userData.interactionState = target === 1 ? 'transforming-to-vehicle' : 'transforming-to-robot';
  } else {
    object.userData.interactionState = target === 1 ? 'vehicle' : 'robot';
    object.userData.collisionVersion = target;
  }

  setTransformAmount(object, amount);
  updateEffects(object, elapsed, amount, transforming);
}

export function interactLobbyProp(object: THREE.Object3D): void {
  const nextTarget = Number(object.userData.targetVehicleAmount) >= 0.5 ? 0 : 1;
  object.userData.targetVehicleAmount = nextTarget;
  object.userData.transformCount = Number(object.userData.transformCount || 0) + 1;
  object.userData.interactionState = nextTarget === 1 ? 'transforming-to-vehicle' : 'transforming-to-robot';
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number; ageSeconds: number },
  elapsed: number,
): void {
  const target = interaction.sequence % 2;
  const progress = THREE.MathUtils.clamp(interaction.ageSeconds / TRANSFORM_SECONDS, 0, 1);
  object.userData.targetVehicleAmount = target;
  object.userData.vehicleAmount = target === 1 ? progress : 1 - progress;
  object.userData.transformCount = interaction.sequence;
  object.userData.lastElapsed = elapsed;
  updateLobbyProp(object, elapsed);
}
