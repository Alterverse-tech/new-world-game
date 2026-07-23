import * as THREE from 'three';
import type { LobbyCarCapability, LobbyVehicleVisualState } from '../types';

export const code = 'howls-moving-castle';

export const vehicle = {
  kind: 'car',
  seatAnchor: [0, 4.48, 0.72],
  exitAnchors: [[-4.65, 0, 0], [4.65, 0, 0], [0, 0, -5.4]],
  cameraAnchor: [0, 5.15, -1.5],
  collisionHalfExtents: [3.6, 4, 4.4],
  enterDurationSeconds: 0.42,
  exitDurationSeconds: 0.32,
  physics: {
    massKg: 18_000,
    maxForwardSpeed: 6,
    maxReverseSpeed: 2.2,
    engineAcceleration: 4.2,
    reverseAcceleration: 2.8,
    brakeDeceleration: 7.5,
    rollingResistance: 0.42,
    aerodynamicDrag: 0.04,
    wheelBase: 5.6,
    maxSteerAngle: 0.28,
    steeringResponse: 3.2,
    collisionRestitution: 0.02,
    maxExitSpeed: 0.6,
  },
} satisfies LobbyCarCapability;

type CastleMaterials = {
  iron: THREE.MeshStandardMaterial;
  darkIron: THREE.MeshStandardMaterial;
  soot: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  paleStone: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  roofRed: THREE.MeshStandardMaterial;
  moss: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  flame: THREE.MeshStandardMaterial;
  smoke: THREE.MeshStandardMaterial;
};

const LEG_IDS = ['FL', 'FR', 'RL', 'RR'] as const;

function shadowed(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBeam(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  size: readonly [number, number, number],
  material: THREE.Material,
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const beam = shadowed(parent, new THREE.BoxGeometry(...size), material, name, position);
  beam.rotation.set(...rotation);
  return beam;
}

function addPipe(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  radius: number,
  length: number,
  material: THREE.Material,
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const pipe = shadowed(
    parent,
    new THREE.CylinderGeometry(radius * 0.92, radius, length, 12),
    material,
    name,
    position,
  );
  pipe.rotation.set(...rotation);
  return pipe;
}

function addPyramidRoof(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  radius: number,
  height: number,
  material: THREE.Material,
  yaw = Math.PI / 4,
): THREE.Mesh {
  const roof = shadowed(parent, new THREE.ConeGeometry(radius, height, 4), material, name, position);
  roof.rotation.y = yaw;
  return roof;
}

function addRivetLine(
  parent: THREE.Object3D,
  name: string,
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  count: number,
  material: THREE.Material,
  radius = 0.045,
): void {
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 6, 4), material, count);
  rivets.name = name;
  rivets.castShadow = true;
  rivets.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < count; index += 1) {
    const amount = count === 1 ? 0.5 : index / (count - 1);
    matrix.makeTranslation(
        THREE.MathUtils.lerp(start[0], end[0], amount),
        THREE.MathUtils.lerp(start[1], end[1], amount),
        THREE.MathUtils.lerp(start[2], end[2], amount),
    );
    rivets.setMatrixAt(index, matrix);
  }
  rivets.instanceMatrix.needsUpdate = true;
  parent.add(rivets);
}

function addRivetRing(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  radius: number,
  count: number,
  material: THREE.Material,
): void {
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), material, count);
  rivets.name = name;
  rivets.castShadow = true;
  rivets.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    matrix.makeTranslation(
      position[0] + Math.sin(angle) * radius,
      position[1],
      position[2] + Math.cos(angle) * radius,
    );
    rivets.setMatrixAt(index, matrix);
  }
  rivets.instanceMatrix.needsUpdate = true;
  parent.add(rivets);
}

function addGear(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  radius: number,
  material: THREE.Material,
  side: number,
): THREE.Group {
  const gear = new THREE.Group();
  gear.name = name;
  gear.position.set(...position);
  gear.rotation.z = Math.PI / 2;
  const hub = shadowed(
    gear,
    new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, 0.22, 12),
    material,
    `${name}Hub`,
    [0, 0, 0],
  );
  hub.rotation.z = Math.PI / 2;
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.18, 0.3), material, 12);
  teeth.name = `${name}Teeth`;
  teeth.castShadow = true;
  teeth.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    quaternion.setFromEuler(new THREE.Euler(angle, 0, 0));
    matrix.compose(
      new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius),
      quaternion,
      scale,
    );
    teeth.setMatrixAt(index, matrix);
  }
  teeth.instanceMatrix.needsUpdate = true;
  gear.add(teeth);
  gear.rotation.x = side > 0 ? 0 : Math.PI;
  parent.add(gear);
  return gear;
}

function addCrenellatedTurret(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  radius: number,
  materials: CastleMaterials,
  cannonAngle = 0,
): THREE.Group {
  const turret = new THREE.Group();
  turret.name = name;
  turret.position.set(...position);
  turret.rotation.y = cannonAngle;

  shadowed(
    turret,
    new THREE.CylinderGeometry(radius * 0.82, radius * 0.92, radius * 0.82, 14),
    materials.brick,
    `${name}BrickDrum`,
    [0, -radius * 0.58, 0],
  );
  const collar = shadowed(
    turret,
    new THREE.CylinderGeometry(radius * 1.05, radius * 1.08, radius * 0.34, 20),
    materials.paleStone,
    `${name}CrenellatedCollar`,
    [0, -radius * 0.1, 0],
  );
  collar.rotation.y = Math.PI / 20;
  shadowed(
    turret,
    new THREE.TorusGeometry(radius * 0.93, radius * 0.075, 7, 24),
    materials.copper,
    `${name}CollarBand`,
    [0, radius * 0.05, 0],
  ).rotation.x = Math.PI / 2;

  const merlonCount = radius > 0.9 ? 10 : 8;
  const merlons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(radius * 0.3, radius * 0.32, radius * 0.18),
    materials.paleStone,
    merlonCount,
  );
  merlons.name = `${name}Crenellations`;
  merlons.castShadow = true;
  merlons.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < merlonCount; index += 1) {
    const angle = index / merlonCount * Math.PI * 2;
    quaternion.setFromEuler(new THREE.Euler(0, angle, 0));
    matrix.compose(
      new THREE.Vector3(Math.sin(angle) * radius * 0.94, radius * 0.18, Math.cos(angle) * radius * 0.94),
      quaternion,
      scale,
    );
    merlons.setMatrixAt(index, matrix);
  }
  merlons.instanceMatrix.needsUpdate = true;
  turret.add(merlons);

  const dome = shadowed(
    turret,
    new THREE.SphereGeometry(radius, 24, 13, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.darkIron,
    `${name}RivetedDome`,
    [0, radius * 0.12, 0],
  );
  dome.scale.y = 0.78;
  addRivetRing(turret, `${name}DomeRivets`, [0, radius * 0.18, 0], radius * 0.83, merlonCount + 2, materials.iron);
  addRivetLine(
    turret,
    `${name}DomeSeam`,
    [0, radius * 0.22, radius * 0.95],
    [0, radius * 0.84, radius * 0.3],
    5,
    materials.iron,
    0.038,
  );

  const cannon = addPipe(
    turret,
    `${name}Cannon`,
    [radius * 0.22, radius * 0.52, radius * 0.88],
    radius * 0.12,
    radius * 0.72,
    materials.soot,
    [Math.PI / 2, 0, 0],
  );
  cannon.rotation.z = -0.12;
  const muzzle = shadowed(
    turret,
    new THREE.TorusGeometry(radius * 0.13, radius * 0.035, 7, 14),
    materials.iron,
    `${name}CannonMuzzle`,
    [radius * 0.22, radius * 0.48, radius * 1.23],
  );
  muzzle.rotation.x = Math.PI / 2;
  parent.add(turret);
  return turret;
}

function addEmbeddedHouse(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  size: readonly [number, number, number],
  yaw: number,
  wall: THREE.Material,
  roof: THREE.Material,
  materials: CastleMaterials,
): THREE.Group {
  const house = new THREE.Group();
  house.name = name;
  house.position.set(...position);
  house.rotation.y = yaw;
  addBeam(house, `${name}Walls`, [0, 0, 0], size, wall, [0.02, 0, 0.01]);
  addPyramidRoof(house, `${name}Roof`, [0, size[1] * 0.62, 0], Math.max(size[0], size[2]) * 0.72, size[1] * 0.52, roof);
  addBeam(house, `${name}TimberHorizontal`, [0, 0.04, size[2] * 0.51], [size[0] * 0.92, 0.07, 0.055], materials.timber);
  addBeam(house, `${name}TimberVertical`, [0, 0.02, size[2] * 0.52], [0.065, size[1] * 0.88, 0.055], materials.timber);
  for (const side of [-1, 1]) {
    addBeam(
      house,
      `${name}Window-${side}`,
      [side * size[0] * 0.24, 0.05, size[2] * 0.54],
      [size[0] * 0.18, size[1] * 0.26, 0.035],
      materials.glass,
    );
  }
  parent.add(house);
  return house;
}

function addFinFan(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  side: number,
  materials: CastleMaterials,
): void {
  const fan = new THREE.Group();
  fan.name = name;
  fan.position.set(...position);
  fan.rotation.y = side * Math.PI / 2;
  const angles = [-1.08, -0.54, 0, 0.54, 1.08];
  angles.forEach((angle, index) => {
    const radius = index === 2 ? 1.38 : 1.22;
    const shape = new THREE.Shape();
    shape.moveTo(0.08, 0);
    shape.lineTo(Math.cos(angle - 0.22) * radius, Math.sin(angle - 0.22) * radius);
    shape.lineTo(Math.cos(angle + 0.22) * radius, Math.sin(angle + 0.22) * radius);
    shape.closePath();
    const panel = shadowed(
      fan,
      new THREE.ShapeGeometry(shape),
      index % 2 === 0 ? materials.slate : materials.iron,
      `${name}Panel-${index}`,
      [0, 0, 0],
    );
    panel.position.z = index * 0.006;
    const rib = addBeam(
      fan,
      `${name}Rib-${index}`,
      [Math.cos(angle) * radius * 0.51, Math.sin(angle) * radius * 0.51, 0.04],
      [radius, 0.065, 0.065],
      materials.copper,
      [0, 0, angle],
    );
    rib.position.z += 0.035;
  });
  shadowed(fan, new THREE.SphereGeometry(0.22, 12, 8), materials.brass, `${name}Hub`, [0, 0, 0.08]);
  parent.add(fan);
}

function addCurvedChimney(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  height: number,
  radius: number,
  bendX: number,
  bendZ: number,
  materials: CastleMaterials,
): void {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Vector3(position[0], position[1] + height * 0.45, position[2]),
    new THREE.Vector3(position[0] + bendX * 0.35, position[1] + height * 0.78, position[2] + bendZ * 0.35),
    new THREE.Vector3(position[0] + bendX, position[1] + height, position[2] + bendZ),
  ]);
  shadowed(
    parent,
    new THREE.TubeGeometry(curve, 18, radius, 10, false),
    materials.soot,
    name,
    [0, 0, 0],
  );
  const rim = shadowed(
    parent,
    new THREE.TorusGeometry(radius * 1.16, radius * 0.26, 7, 14),
    materials.iron,
    `${name}Rim`,
    [position[0] + bendX, position[1] + height, position[2] + bendZ],
  );
  rim.rotation.set(Math.PI / 2 - bendZ * 0.35, 0, -bendX * 0.35);
  addRivetRing(parent, `${name}BaseRivets`, [position[0], position[1] + 0.04, position[2]], radius * 1.42, 6, materials.copper);
}

function addMechanicalLeg(
  parent: THREE.Object3D,
  id: typeof LEG_IDS[number],
  x: number,
  z: number,
  materials: CastleMaterials,
): void {
  const side = x < 0 ? -1 : 1;
  const fore = z > 0 ? 1 : -1;
  const hip = new THREE.Group();
  hip.name = `HowlLeg${id}Hip`;
  hip.position.set(x, 2.15, z);
  hip.userData.restX = 0;

  const hipJoint = shadowed(
    hip,
    new THREE.SphereGeometry(0.42, 16, 11),
    materials.brass,
    `HowlLeg${id}HipJoint`,
    [0, 0, 0],
  );
  hipJoint.scale.set(1.18, 0.82, 1.02);
  addRivetRing(hip, `HowlLeg${id}HipRivets`, [0, 0, 0], 0.35, 7, materials.darkIron);
  const upper = addPipe(hip, `HowlLeg${id}Upper`, [side * 0.13, -0.55, -fore * 0.03], 0.2, 1.08, materials.brass);
  upper.rotation.z = side * -0.2;
  addPipe(hip, `HowlLeg${id}UpperRearRod`, [-side * 0.16, -0.52, -fore * 0.12], 0.085, 1.0, materials.darkIron, [0.05, 0, side * 0.19]);
  addBeam(
    hip,
    `HowlLeg${id}UpperArmor`,
    [side * 0.24, -0.45, fore * 0.02],
    [0.28, 0.68, 0.46],
    materials.bronze,
    [fore * 0.05, 0, side * -0.18],
  );

  const knee = new THREE.Group();
  knee.name = `HowlLeg${id}Knee`;
  knee.position.set(side * 0.22, -1.04, -fore * 0.06);
  knee.userData.restX = 0;
  const kneeJoint = shadowed(knee, new THREE.SphereGeometry(0.34, 16, 10), materials.brass, `HowlLeg${id}KneeJoint`, [0, 0, 0]);
  kneeJoint.scale.set(1.22, 0.84, 1);
  shadowed(knee, new THREE.TorusGeometry(0.3, 0.06, 7, 14), materials.darkIron, `HowlLeg${id}KneeBand`, [0, 0, 0]).rotation.y = Math.PI / 2;
  const lower = addPipe(knee, `HowlLeg${id}Lower`, [-side * 0.08, -0.48, fore * 0.1], 0.16, 0.94, materials.brass, [fore * 0.15, 0, side * 0.13]);
  lower.scale.set(0.92, 1, 0.92);
  addPipe(knee, `HowlLeg${id}LowerPiston`, [side * 0.17, -0.45, -fore * 0.04], 0.07, 0.8, materials.soot, [fore * -0.06, 0, side * -0.1]);

  const foot = new THREE.Group();
  foot.name = `HowlLeg${id}Foot`;
  foot.position.set(-side * 0.12, -0.98, fore * 0.13);
  foot.userData.restX = 0;
  const ankle = shadowed(foot, new THREE.SphereGeometry(0.28, 14, 9), materials.brass, `HowlLeg${id}Ankle`, [0, 0.24, 0]);
  ankle.scale.set(1.15, 0.9, 1.05);
  const sole = shadowed(
    foot,
    new THREE.SphereGeometry(0.3, 14, 9),
    materials.brass,
    `HowlLeg${id}FootSole`,
    [0, 0.12, fore * 0.13],
  );
  sole.scale.set(1.08, 0.36, 0.9);
  for (let toe = -1; toe <= 1; toe += 1) {
    const claw = shadowed(
      foot,
      new THREE.ConeGeometry(0.14, 0.54, 9),
      materials.brass,
      `HowlLeg${id}Claw-${toe}`,
      [toe * 0.22, 0.11, fore * 0.49],
    );
    claw.rotation.x = fore * Math.PI / 2;
    claw.rotation.z = toe * -0.12;
  }
  const rearClaw = shadowed(
    foot,
    new THREE.ConeGeometry(0.12, 0.4, 8),
    materials.brass,
    `HowlLeg${id}RearClaw`,
    [0, 0.12, fore * -0.38],
  );
  rearClaw.rotation.x = fore * -Math.PI / 2;
  knee.add(foot);
  hip.add(knee);
  parent.add(hip);
}

function addFrontFace(root: THREE.Object3D, materials: CastleMaterials): void {
  const face = shadowed(
    root,
    new THREE.SphereGeometry(1.38, 24, 16),
    materials.bronze,
    'HowlFrontFacePlate',
    [0, 3.18, 3.02],
  );
  face.scale.set(1, 0.95, 0.66);

  for (const side of [-1, 1]) {
    const cheek = shadowed(
      root,
      new THREE.SphereGeometry(0.72, 18, 12),
      side < 0 ? materials.rust : materials.copper,
      `HowlFrontCheekPlate-${side}`,
      [side * 0.66, 3.01, 3.57],
    );
    cheek.scale.set(0.88, 0.94, 0.32);
    addRivetLine(
      root,
      `HowlFrontCheekRivets-${side}`,
      [side * 1.12, 2.72, 3.79],
      [side * 1.12, 3.36, 3.79],
      5,
      materials.darkIron,
      0.038,
    );
  }

  addBeam(root, 'HowlFrontForeheadPlate', [0, 3.79, 3.62], [1.24, 0.4, 0.16], materials.rust, [-0.04, 0, 0]);
  addRivetLine(root, 'HowlFrontForeheadRivets', [-0.52, 3.93, 3.72], [0.52, 3.93, 3.72], 6, materials.iron, 0.038);

  for (const side of [-1, 1]) {
    const brow = addBeam(
      root,
      `HowlFrontBrow-${side}`,
      [side * 0.36, 3.64, 3.84],
      [0.44, 0.14, 0.18],
      materials.bronze,
      [side * -0.1, 0, side * -0.2],
    );
    brow.scale.z = 0.85;
    const eyeSocket = shadowed(
      root,
      new THREE.TorusGeometry(0.145, 0.055, 8, 16),
      materials.soot,
      `HowlFrontEyeSocket-${side}`,
      [side * 0.33, 3.46, 4.01],
    );
    eyeSocket.rotation.x = 0;
    const eye = shadowed(
      root,
      new THREE.SphereGeometry(0.044, 12, 8),
      materials.eye,
      `HowlFrontEye-${side}`,
      [side * 0.33, 3.46, 4.048],
    );
    eye.scale.z = 0.45;
  }

  addBeam(root, 'HowlFrontNoseBridge', [0, 3.16, 3.88], [0.27, 0.88, 0.23], materials.rust, [0.02, 0, 0]);
  addBeam(root, 'HowlFrontNoseCap', [0, 2.84, 3.98], [0.46, 0.25, 0.21], materials.bronze, [0.06, 0, 0]);
  for (const side of [-1, 1]) {
    const nostril = addPipe(
      root,
      `HowlFrontNostrilCannon-${side}`,
      [side * 0.15, 2.99, 4.04],
      0.085,
      0.42,
      materials.soot,
      [Math.PI / 2, 0, 0],
    );
    nostril.rotation.z = side * 0.05;
    const nostrilRim = shadowed(
      root,
      new THREE.TorusGeometry(0.09, 0.03, 7, 12),
      materials.iron,
      `HowlFrontNostrilRim-${side}`,
      [side * 0.15, 2.99, 4.26],
    );
    nostrilRim.rotation.x = Math.PI / 2;
  }

  addBeam(root, 'HowlFrontDroopingLipLeft', [-0.37, 2.69, 3.86], [0.42, 0.62, 0.2], materials.rust, [0, -0.04, -0.16]);
  addBeam(root, 'HowlFrontDroopingLipRight', [0.37, 2.69, 3.86], [0.42, 0.62, 0.2], materials.bronze, [0, 0.04, 0.16]);
  const lowerJaw = shadowed(
    root,
    new THREE.TorusGeometry(0.62, 0.13, 8, 24, Math.PI),
    materials.darkIron,
    'HowlFrontLowerJaw',
    [0, 2.4, 3.89],
  );
  lowerJaw.rotation.z = Math.PI;
  const mouthCavity = shadowed(
    root,
    new THREE.CapsuleGeometry(0.3, 0.62, 7, 14),
    materials.soot,
    'HowlFrontMouthCavity',
    [0, 2.5, 3.92],
  );
  mouthCavity.rotation.z = Math.PI / 2;
  mouthCavity.scale.set(1, 0.82, 0.34);
  const mouth = shadowed(
    root,
    new THREE.CapsuleGeometry(0.22, 0.4, 7, 14),
    materials.mouth,
    'HowlFrontMouth',
    [0, 2.5, 4.005],
  );
  mouth.rotation.z = Math.PI / 2;
  mouth.scale.set(1, 0.76, 0.24);
  mouth.userData.baseEmissive = 0.28;

  for (const [x, height, angle] of [[-0.22, 0.42, -0.12], [0, 0.55, 0], [0.22, 0.38, 0.12]] as const) {
    const lick = shadowed(
      root,
      new THREE.ConeGeometry(0.14, height, 9),
      materials.flame,
      `HowlFrontMouthCalciferFlame-${x}`,
      [x * 0.76, 2.68 + height * 0.22, 4.07],
    );
    lick.rotation.z = angle;
  }
  for (const side of [-1, 1]) {
    shadowed(root, new THREE.SphereGeometry(0.052, 10, 7), materials.paleStone, `HowlFrontMouthCalciferEye-${side}`, [side * 0.095, 2.53, 4.09]);
    shadowed(root, new THREE.SphereGeometry(0.024, 8, 6), materials.soot, `HowlFrontMouthCalciferPupil-${side}`, [side * 0.095, 2.53, 4.13]);
  }

  for (const side of [-1, 1]) {
    const cannon = addPipe(
      root,
      `HowlFrontCannon-${side}`,
      [side * 1.14, 3.18, 3.77],
      0.145,
      0.78,
      materials.soot,
      [Math.PI / 2, 0, 0],
    );
    cannon.rotation.z = side * 0.08;
    const muzzle = shadowed(
      root,
      new THREE.TorusGeometry(0.155, 0.045, 7, 14),
      materials.iron,
      `HowlFrontCannonMuzzle-${side}`,
      [side * 1.14, 3.18, 4.17],
    );
    muzzle.rotation.x = Math.PI / 2;
  }
}

function addPatchworkBuildings(root: THREE.Object3D, materials: CastleMaterials): void {
  addCrenellatedTurret(root, 'HowlTurret-HighCrown', [0.46, 6.18, -0.96], 1.12, materials, -0.24);
  addCrenellatedTurret(root, 'HowlTurret-LeftShoulder', [-1.18, 5.33, -0.2], 1.04, materials, 0.28);
  addCrenellatedTurret(root, 'HowlTurret-RightShoulder', [1.52, 5.05, -0.22], 0.72, materials, -0.38);
  addCrenellatedTurret(root, 'HowlTurret-FrontWatch', [-0.94, 4.72, 1.18], 0.62, materials, 0.12);

  const houses: ReadonlyArray<readonly [string, readonly [number, number, number], readonly [number, number, number], number, THREE.Material, THREE.Material]> = [
    ['HowlHouse-FrontGable', [0.08, 4.67, 1.45], [0.72, 0.92, 0.62], -0.08, materials.plaster, materials.roofRed],
    ['HowlHouse-LeftCottage', [-1.77, 4.42, 0.7], [0.62, 0.72, 0.56], 0.18, materials.paleStone, materials.copper],
    ['HowlHouse-RightCottage', [1.86, 4.35, 0.75], [0.58, 0.7, 0.55], -0.2, materials.plaster, materials.roofRed],
    ['HowlHouse-HighTimber', [-0.55, 5.74, -0.34], [0.58, 0.88, 0.55], 0.18, materials.paleStone, materials.copper],
    ['HowlHouse-RearRedRoof', [-1.55, 5.66, -1.36], [0.65, 0.78, 0.58], -0.24, materials.stone, materials.roofRed],
    ['HowlHouse-RearOchreRoof', [1.48, 5.72, -1.42], [0.62, 0.82, 0.58], 0.2, materials.plaster, materials.copper],
    ['HowlHouse-LowerFront', [0.82, 4.18, 1.87], [0.55, 0.62, 0.48], -0.05, materials.paleStone, materials.roofRed],
    ['HowlHouse-RightRear', [2.05, 4.65, -1.24], [0.54, 0.72, 0.5], -0.34, materials.plaster, materials.copper],
    ['HowlHouse-LeftRear', [-2.02, 4.2, -1.34], [0.56, 0.68, 0.52], 0.28, materials.stone, materials.roofRed],
  ];
  houses.forEach(([name, position, size, yaw, wall, roof]) => {
    addEmbeddedHouse(root, name, position, size, yaw, wall, roof, materials);
  });

  addBeam(root, 'HowlHouseBridgeDeck', [-0.1, 4.2, 1.82], [2.2, 0.13, 0.48], materials.timber, [0, 0.04, 0]);
  for (const x of [-0.96, -0.48, 0, 0.48, 0.96]) {
    addPipe(root, `HowlHouseBridgeRail-${x}`, [x, 4.43, 2.03], 0.025, 0.44, materials.copper);
  }
  addBeam(root, 'HowlHouseBridgeRailTop', [0, 4.66, 2.03], [2.06, 0.055, 0.055], materials.copper);
}

function addIndustrialDetails(root: THREE.Object3D, materials: CastleMaterials): void {
  for (const side of [-1, 1]) {
    const sidePlate = shadowed(
      root,
      new THREE.SphereGeometry(1, 18, 12),
      side < 0 ? materials.rust : materials.bronze,
      `HowlSideRivetedArmor-${side}`,
      [side * 2.72, 3.38, 0.3],
    );
    sidePlate.scale.set(0.13, 0.78, 1.08);
    addRivetLine(root, `HowlSideArmorTopRivets-${side}`, [side * 2.81, 3.92, -0.3], [side * 2.81, 3.92, 0.9], 7, materials.brass, 0.042);
    addRivetLine(root, `HowlSideArmorBottomRivets-${side}`, [side * 2.81, 2.83, -0.3], [side * 2.81, 2.83, 0.9], 7, materials.darkIron, 0.042);
    addGear(root, `HowlSideGearLarge-${side}`, [side * 2.74, 3.28, -0.28], 0.72, materials.rust, side);
    addGear(root, `HowlSideGearSmall-${side}`, [side * 2.7, 2.52, -1.24], 0.45, materials.copper, side);
    addPipe(root, `HowlSidePiston-${side}`, [side * 2.5, 3.85, -1.55], 0.12, 1.55, materials.darkIron, [0.18, 0, side * 0.12]);
    const elbow = shadowed(
      root,
      new THREE.TorusGeometry(0.42, 0.11, 8, 16, Math.PI),
      materials.copper,
      `HowlSidePipeElbow-${side}`,
      [side * 2.55, 4.35, -1.92],
    );
    elbow.rotation.set(0, side * Math.PI / 2, Math.PI / 2);
    addFinFan(root, `HowlSideWingFan-${side}`, [side * 2.91, 3.54, -0.72], side, materials);
  }

  const chimneys: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
    [-1.58, 4.95, -1.72, 2.22, 0.17, -0.3, -0.18],
    [-0.52, 5.48, -1.66, 2.08, 0.16, 0.22, -0.2],
    [0.82, 5.38, -1.76, 2.14, 0.18, 0.32, -0.1],
    [1.8, 4.72, -1.52, 2.0, 0.15, 0.28, 0.12],
    [-2.08, 4.56, -0.72, 1.7, 0.13, -0.26, 0.12],
    [2.12, 4.42, -0.62, 1.52, 0.12, 0.2, 0.08],
  ];
  chimneys.forEach(([x, y, z, height, radius, bendX, bendZ], index) => {
    addCurvedChimney(root, `HowlChimney-${index}`, [x, y, z], height, radius, bendX, bendZ, materials);
  });

  for (let index = 0; index < 5; index += 1) {
    const puff = shadowed(
      root,
      new THREE.SphereGeometry(0.22 + index * 0.025, 10, 8),
      materials.smoke,
      `HowlSmokePuff-${index}`,
      [-1.88, 7.3, -1.9],
    );
    puff.userData.phase = index / 5;
    puff.userData.baseX = -1.88;
    puff.userData.baseY = 7.18;
    puff.userData.baseZ = -1.9;
  }

  addPipe(root, 'HowlRearExhaust', [1.42, 3.16, -3.36], 0.27, 1.08, materials.darkIron, [Math.PI / 2, 0, 0]);
  const rearFlame = shadowed(
    root,
    new THREE.ConeGeometry(0.28, 0.78, 12),
    materials.flame,
    'HowlRearFurnaceFlame',
    [1.42, 3.16, -3.86],
  );
  rearFlame.rotation.x = -Math.PI / 2;
}

function addHullPatchworkDetails(root: THREE.Object3D, materials: CastleMaterials): void {
  for (const side of [-1, 1]) {
    const forwardPlate = shadowed(
      root,
      new THREE.SphereGeometry(1, 18, 12),
      side < 0 ? materials.copper : materials.rust,
      `HowlSideUpperArmorForward-${side}`,
      [side * 2.73, 4.02, 1.56],
    );
    forwardPlate.scale.set(0.12, 0.52, 0.72);
    const rearPlate = shadowed(
      root,
      new THREE.SphereGeometry(1, 18, 12),
      side < 0 ? materials.iron : materials.bronze,
      `HowlSideUpperArmorRear-${side}`,
      [side * 2.68, 3.95, -1.68],
    );
    rearPlate.scale.set(0.12, 0.56, 0.74);
    addRivetLine(
      root,
      `HowlSideUpperSeamRivets-${side}`,
      [side * 2.82, 3.58, 1.18],
      [side * 2.82, 4.38, 1.88],
      7,
      materials.brass,
      0.038,
    );
    addPipe(
      root,
      `HowlSideRearServicePipe-${side}`,
      [side * 2.78, 3.58, -2.12],
      0.07,
      1.05,
      materials.copper,
      [0.16, 0, side * 0.1],
    );
  }

  const rearPlates: ReadonlyArray<readonly [string, readonly [number, number, number], readonly [number, number, number], THREE.Material]> = [
    ['HowlRearArmorPlate-Left', [-1.28, 3.52, -2.96], [1.02, 0.78, 0.13], materials.rust],
    ['HowlRearArmorPlate-Right', [1.25, 3.58, -2.93], [1.0, 0.74, 0.13], materials.iron],
    ['HowlRearArmorPlate-Lower', [0, 2.55, -3.06], [1.48, 0.43, 0.12], materials.copper],
    ['HowlRearArmorPlate-Upper', [0.04, 4.1, -2.88], [1.34, 0.4, 0.12], materials.bronze],
  ];
  rearPlates.forEach(([name, position, scale, material]) => {
    const plate = shadowed(root, new THREE.SphereGeometry(1, 20, 12), material, name, position);
    plate.scale.set(...scale);
  });

  addBeam(root, 'HowlRearHullSeamUpper', [0, 4.12, -3.0], [2.48, 0.1, 0.1], materials.darkIron, [0, 0, 0.03]);
  addBeam(root, 'HowlRearHullSeamLower', [0, 2.6, -3.18], [2.72, 0.11, 0.1], materials.darkIron, [0, 0, -0.02]);
  addRivetLine(root, 'HowlRearHullUpperRivets', [-1.08, 4.18, -3.07], [1.08, 4.18, -3.07], 10, materials.brass, 0.04);
  addRivetLine(root, 'HowlRearHullLowerRivets', [-1.2, 2.68, -3.24], [1.2, 2.68, -3.24], 11, materials.darkIron, 0.04);

  addBeam(root, 'HowlRearHatchFrame', [0, 3.34, -3.39], [1.25, 1.34, 0.12], materials.darkIron, [0.01, 0, 0]);
  addBeam(root, 'HowlRearHatchDoor', [0, 3.34, -3.49], [1.04, 1.12, 0.11], materials.bronze, [0.01, 0, 0]);
  addRivetLine(root, 'HowlRearHatchTopRivets', [-0.43, 3.82, -3.57], [0.43, 3.82, -3.57], 5, materials.brass, 0.037);
  addRivetLine(root, 'HowlRearHatchBottomRivets', [-0.43, 2.88, -3.57], [0.43, 2.88, -3.57], 5, materials.darkIron, 0.037);
  const hatchWheel = shadowed(
    root,
    new THREE.TorusGeometry(0.25, 0.055, 7, 16),
    materials.brass,
    'HowlRearHatchWheel',
    [0, 3.35, -3.58],
  );
  hatchWheel.rotation.z = Math.PI / 8;
  for (const angle of [0, Math.PI / 2]) {
    addBeam(root, `HowlRearHatchWheelSpoke-${angle}`, [0, 3.35, -3.62], [0.48, 0.055, 0.055], materials.brass, [0, 0, angle]);
  }
  shadowed(root, new THREE.SphereGeometry(0.09, 10, 7), materials.darkIron, 'HowlRearHatchWheelHub', [0, 3.35, -3.66]);

  for (let index = 0; index < 8; index += 1) {
    const x = -1.42 + index * 0.41;
    addBeam(
      root,
      `HowlRearBrickFragment-${index}`,
      [x, 4.42 + (index % 2) * 0.08, -2.66 - Math.abs(x) * 0.09],
      [0.34, 0.22, 0.24],
      index % 3 === 0 ? materials.rust : materials.brick,
      [0, (index % 3 - 1) * 0.08, (index % 2 ? 1 : -1) * 0.035],
    );
  }

  addEmbeddedHouse(
    root,
    'HowlHouse-RearHatchLoft',
    [0.62, 4.72, -2.36],
    [0.62, 0.66, 0.5],
    Math.PI - 0.12,
    materials.paleStone,
    materials.roofRed,
    materials,
  );
}

function makeMaterials(): CastleMaterials {
  return {
    iron: new THREE.MeshStandardMaterial({ color: '#4d5557', roughness: 0.52, metalness: 0.7 }),
    darkIron: new THREE.MeshStandardMaterial({ color: '#252b2d', roughness: 0.61, metalness: 0.76 }),
    soot: new THREE.MeshStandardMaterial({ color: '#111719', roughness: 0.7, metalness: 0.66 }),
    rust: new THREE.MeshStandardMaterial({ color: '#713c34', roughness: 0.68, metalness: 0.5 }),
    copper: new THREE.MeshStandardMaterial({ color: '#9d5938', roughness: 0.54, metalness: 0.68 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#68423a', roughness: 0.58, metalness: 0.68 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b08a48', roughness: 0.4, metalness: 0.82 }),
    brick: new THREE.MeshStandardMaterial({ color: '#56382f', roughness: 0.9, metalness: 0.02 }),
    stone: new THREE.MeshStandardMaterial({ color: '#706f69', roughness: 0.94, metalness: 0.02 }),
    paleStone: new THREE.MeshStandardMaterial({ color: '#9f9a89', roughness: 0.88, metalness: 0.05 }),
    plaster: new THREE.MeshStandardMaterial({ color: '#bca985', roughness: 0.9, metalness: 0 }),
    timber: new THREE.MeshStandardMaterial({ color: '#493025', roughness: 0.86, metalness: 0.03 }),
    slate: new THREE.MeshStandardMaterial({ color: '#344653', roughness: 0.72, metalness: 0.22 }),
    roofRed: new THREE.MeshStandardMaterial({ color: '#8f4634', roughness: 0.8, metalness: 0.12 }),
    moss: new THREE.MeshStandardMaterial({ color: '#455b43', roughness: 0.92, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#ffd77a', emissive: '#ff9e32', emissiveIntensity: 0.62, roughness: 0.2, metalness: 0.05,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: '#171b1b', emissive: '#5b2f12', emissiveIntensity: 0.04, roughness: 0.5, metalness: 0.58,
    }),
    mouth: new THREE.MeshStandardMaterial({
      color: '#d24e18', emissive: '#ff4c0b', emissiveIntensity: 0.72, roughness: 0.48, metalness: 0.04,
    }),
    flame: new THREE.MeshStandardMaterial({
      color: '#ff9a32', emissive: '#ff4b0a', emissiveIntensity: 1.5, roughness: 0.24, metalness: 0.03,
    }),
    smoke: new THREE.MeshStandardMaterial({
      color: '#67635f', roughness: 1, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false,
    }),
  };
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'HowlsMovingCastleVehicle';
  root.userData.forwardAxis = '+Z';
  root.userData.interactionState = 'parked';
  root.userData.vehicleSpeed = 0;
  root.userData.vehicleSteering = 0;
  root.userData.vehicleThrottle = 0;
  root.userData.lastVehicleVisualElapsed = 0;

  const materials = makeMaterials();

  const undercarriage = addBeam(root, 'HowlCastleUndercarriage', [0, 2.3, -0.08], [4.18, 0.34, 5.18], materials.darkIron);
  undercarriage.rotation.x = -0.025;
  const belly = shadowed(
    root,
    new THREE.SphereGeometry(2.15, 22, 14),
    materials.iron,
    'HowlCastleMainBelly',
    [0, 3.3, -0.08],
  );
  belly.scale.set(1.3, 0.82, 1.54);
  const lowerBelly = shadowed(
    root,
    new THREE.SphereGeometry(1.68, 18, 12),
    materials.rust,
    'HowlCastleLowerBelly',
    [-0.25, 2.72, -0.3],
  );
  lowerBelly.scale.set(1.46, 0.66, 1.65);

  const leftHull = shadowed(
    root,
    new THREE.SphereGeometry(1.34, 18, 12),
    materials.bronze,
    'HowlCastleLeftPatchworkHull',
    [-1.62, 3.52, 0.15],
  );
  leftHull.scale.set(0.98, 0.78, 1.3);
  const rightHull = shadowed(
    root,
    new THREE.SphereGeometry(1.28, 18, 12),
    materials.rust,
    'HowlCastleRightPatchworkHull',
    [1.65, 3.45, -0.5],
  );
  rightHull.scale.set(1, 0.8, 1.34);

  const bellyBand = shadowed(
    root,
    new THREE.TorusGeometry(2.46, 0.17, 9, 28),
    materials.copper,
    'HowlCastleLowerArmorBand',
    [0, 2.42, -0.16],
  );
  bellyBand.rotation.x = Math.PI / 2;
  bellyBand.scale.z = 1.18;
  addRivetRing(root, 'HowlCastleLowerBandRivets', [0, 2.51, -0.16], 2.51, 18, materials.brass);

  for (const [side, z, material] of [
    [-1, 1.04, materials.copper],
    [-1, -1.42, materials.rust],
    [1, 0.86, materials.bronze],
    [1, -1.56, materials.copper],
  ] as const) {
    const plate = shadowed(
      root,
      new THREE.SphereGeometry(1, 18, 12),
      material,
      `HowlCastleHullPatch-${side}-${z}`,
      [side * 2.79, 3.48, z],
    );
    plate.scale.set(0.12, z > 0 ? 0.62 : 0.7, z > 0 ? 0.72 : 0.82);
    addRivetLine(
      root,
      `HowlCastleHullPatchRivets-${side}-${z}`,
      [side * 2.87, 2.98, z - 0.42],
      [side * 2.87, 3.98, z + 0.42],
      6,
      materials.darkIron,
      0.04,
    );
  }

  const upperHullPlate = shadowed(
    root,
    new THREE.SphereGeometry(1, 18, 12),
    materials.bronze,
    'HowlCastleUpperFrontArmorPlate',
    [0, 4.03, 2.73],
  );
  upperHullPlate.scale.set(1.35, 0.46, 0.13);
  addRivetLine(root, 'HowlCastleUpperFrontArmorRivets', [-1.1, 4.05, 2.86], [1.1, 4.05, 2.86], 9, materials.brass, 0.038);

  for (let index = 0; index < 18; index += 1) {
    const angle = index / 18 * Math.PI * 2;
    const radiusX = 2.13 + (index % 3) * 0.06;
    const radiusZ = 2.02 + (index % 2) * 0.08;
    const brick = addBeam(
      root,
      `HowlCastleCrownBrick-${index}`,
      [Math.sin(angle) * radiusX, 4.55 + (index % 2) * 0.08, Math.cos(angle) * radiusZ - 0.12],
      [0.42, 0.25, 0.34],
      index % 4 === 0 ? materials.rust : materials.brick,
      [0, angle, (index % 3 - 1) * 0.05],
    );
    brick.scale.x = index % 3 === 0 ? 1.12 : 0.96;
  }

  addHullPatchworkDetails(root, materials);

  addMechanicalLeg(root, 'FL', -2.05, 2.18, materials);
  addMechanicalLeg(root, 'FR', 2.05, 2.18, materials);
  addMechanicalLeg(root, 'RL', -2.05, -2.15, materials);
  addMechanicalLeg(root, 'RR', 2.05, -2.15, materials);
  addFrontFace(root, materials);
  addPatchworkBuildings(root, materials);
  addIndustrialDetails(root, materials);

  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return root;
}

function animateCastle(
  object: THREE.Object3D,
  speed: number,
  steering: number,
  throttle: number,
  elapsed: number,
): void {
  const gaitStrength = THREE.MathUtils.clamp(Math.abs(speed) / 4.5, 0, 1);
  const gaitRate = 1.35 + Math.abs(speed) * 0.62;
  const direction = speed < -0.05 ? -1 : 1;

  LEG_IDS.forEach((id, index) => {
    const diagonalPhase = index === 0 || index === 3 ? 0 : Math.PI;
    const phase = elapsed * gaitRate * direction + diagonalPhase;
    const hip = object.getObjectByName(`HowlLeg${id}Hip`);
    const knee = object.getObjectByName(`HowlLeg${id}Knee`);
    const foot = object.getObjectByName(`HowlLeg${id}Foot`);
    if (hip) {
      hip.rotation.x = Math.sin(phase) * 0.34 * gaitStrength;
      hip.rotation.z = steering * (id.includes('L') ? 0.05 : -0.05);
    }
    if (knee) knee.rotation.x = (0.08 + Math.max(0, Math.sin(phase + 0.6)) * 0.42) * gaitStrength;
    if (foot) foot.rotation.x = -Math.sin(phase + 0.3) * 0.24 * gaitStrength;
  });

  for (const side of [-1, 1]) {
    const largeGear = object.getObjectByName(`HowlSideGearLarge-${side}`);
    if (largeGear) largeGear.rotation.x = side * elapsed * speed * 0.22;
    const smallGear = object.getObjectByName(`HowlSideGearSmall-${side}`);
    if (smallGear) smallGear.rotation.x = -side * elapsed * speed * 0.35;
  }

  for (let index = 0; index < 5; index += 1) {
    const puff = object.getObjectByName(`HowlSmokePuff-${index}`);
    if (!puff) continue;
    const phase = (elapsed * (0.12 + Math.abs(throttle) * 0.08) + Number(puff.userData.phase)) % 1;
    const drift = Math.sin(elapsed * 0.7 + index) * 0.13;
    puff.position.set(
      Number(puff.userData.baseX) + drift,
      Number(puff.userData.baseY) + phase * 0.45,
      Number(puff.userData.baseZ) - phase * 0.12,
    );
    const scale = 0.55 + phase * 0.58;
    puff.scale.setScalar(scale);
  }

  const eyeIntensity = 0.035 + Math.abs(throttle) * 0.06 + Math.sin(elapsed * 2.1) * 0.01;
  for (const side of [-1, 1]) {
    const eye = object.getObjectByName(`HowlFrontEye-${side}`) as THREE.Mesh | undefined;
    if (eye) (eye.material as THREE.MeshStandardMaterial).emissiveIntensity = eyeIntensity;
  }
  const mouth = object.getObjectByName('HowlFrontMouth') as THREE.Mesh | undefined;
  if (mouth) (mouth.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.72 + Math.abs(throttle) * 1.25;
  const flame = object.getObjectByName('HowlRearFurnaceFlame');
  if (flame) {
    const pulse = 0.84 + Math.sin(elapsed * 7.2) * 0.08 + Math.abs(throttle) * 0.28;
    flame.scale.set(pulse, 0.9 + Math.abs(throttle) * 0.45, pulse);
  }
}

export function updateLobbyVehicleVisual(
  object: THREE.Object3D,
  state: LobbyVehicleVisualState,
  elapsed: number,
): void {
  object.userData.lastVehicleVisualElapsed = elapsed;
  object.userData.vehicleSpeed = state.speed;
  object.userData.vehicleSteering = state.steering;
  object.userData.vehicleThrottle = state.throttle;
  object.userData.interactionState = state.phase === 'idle' ? 'parked' : state.phase;
  animateCastle(object, state.speed, state.steering, state.throttle, elapsed);
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const speed = Number(object.userData.vehicleSpeed) || 0;
  const steering = Number(object.userData.vehicleSteering) || 0;
  const throttle = Number(object.userData.vehicleThrottle) || 0;
  object.userData.lastVehicleVisualElapsed = elapsed;
  animateCastle(object, speed, steering, throttle, elapsed);
}
