import * as THREE from 'three';

export const code = 'precision-rescue-helicopter';

type VectorTuple = readonly [number, number, number];

interface HelicopterVehicleCapability {
  kind: 'aircraft';
  flightModel: 'rotorcraft';
  seatAnchor: VectorTuple;
  exitAnchors: readonly VectorTuple[];
  cameraAnchor: VectorTuple;
  collisionHalfExtents: VectorTuple;
  enterDurationSeconds: number;
  exitDurationSeconds: number;
  physics: {
    massKg: number;
    maxSpeed: number;
    maxReverseSpeed: number;
    maxVerticalSpeed: number;
    engineAcceleration: number;
    verticalAcceleration: number;
    groundBrakeDeceleration: number;
    horizontalDrag: number;
    pitchRate: number;
    yawRate: number;
    rollRate: number;
    maxPitch: number;
    maxRoll: number;
    controlResponse: number;
    throttleResponse: number;
    collisionRestitution: number;
    maxExitSpeed: number;
  };
}

interface HelicopterVehicleVisualState {
  phase: 'idle' | 'entering' | 'driving' | 'exiting';
  speed: number;
  normalizedSpeed: number;
  throttle: number;
  steering: number;
  pitch: number;
  roll: number;
  vertical: number;
  grounded: boolean;
}

export const vehicle = {
  kind: 'aircraft',
  flightModel: 'rotorcraft',
  seatAnchor: [0, 0.78, 0.5],
  exitAnchors: [[-1.05, 0, 0.08], [1.05, 0, 0.08]],
  cameraAnchor: [0, 1.28, -2.25],
  collisionHalfExtents: [0.78, 0.84, 1.92],
  enterDurationSeconds: 0.52,
  exitDurationSeconds: 0.4,
  physics: {
    massKg: 1_180,
    maxSpeed: 7.4,
    maxReverseSpeed: 2.6,
    maxVerticalSpeed: 3.6,
    engineAcceleration: 5.8,
    verticalAcceleration: 4.5,
    groundBrakeDeceleration: 8,
    horizontalDrag: 4.2,
    pitchRate: 1.2,
    yawRate: 1.45,
    rollRate: 1.6,
    maxPitch: 0.38,
    maxRoll: 0.48,
    controlResponse: 5.4,
    throttleResponse: 4.8,
    collisionRestitution: 0.04,
    maxExitSpeed: 1.2,
  },
} satisfies HelicopterVehicleCapability;

const ROTOR_SPIN_UP_SECONDS = 1.25;

const HALF_PI = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);

interface HelicopterMaterials {
  orange: THREE.MeshStandardMaterial;
  orangeDark: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  graphite: THREE.MeshStandardMaterial;
  matteBlack: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  interior: THREE.MeshStandardMaterial;
  seat: THREE.MeshStandardMaterial;
  instrument: THREE.MeshStandardMaterial;
  rescueBlue: THREE.MeshStandardMaterial;
}

function clampInput(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? THREE.MathUtils.clamp(numeric, -1, 1) : 0;
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

function addBox(
  parent: THREE.Object3D,
  name: string,
  size: VectorTuple,
  position: VectorTuple,
  material: THREE.Material,
  rotation: VectorTuple = [0, 0, 0],
): THREE.Mesh {
  return shadowedMesh(parent, new THREE.BoxGeometry(...size), material, name, position, rotation);
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
  segments = 16,
): THREE.Mesh {
  return shadowedMesh(
    parent,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    name,
    position,
    rotation,
  );
}

function addCylinderBetween(
  parent: THREE.Object3D,
  name: string,
  startTuple: VectorTuple,
  endTuple: VectorTuple,
  radius: number,
  material: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const start = new THREE.Vector3(...startTuple);
  const end = new THREE.Vector3(...endTuple);
  const direction = end.clone().sub(start);
  const mesh = shadowedMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius, direction.length(), segments),
    material,
    name,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

function taperedBladeGeometry(length: number, rootChord: number, tipChord: number, thickness: number): THREE.BufferGeometry {
  const rootHalf = rootChord * 0.5;
  const tipHalf = tipChord * 0.5;
  const halfHeight = thickness * 0.5;
  const positions = new Float32Array([
    0, -halfHeight, -rootHalf,
    0, -halfHeight, rootHalf,
    length, -halfHeight, -tipHalf,
    length, -halfHeight, tipHalf,
    0, halfHeight, -rootHalf,
    0, halfHeight, rootHalf,
    length, halfHeight, -tipHalf,
    length, halfHeight, tipHalf,
  ]);
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    0, 4, 2, 2, 4, 6,
    1, 3, 5, 3, 7, 5,
    0, 1, 4, 1, 5, 4,
    2, 6, 3, 3, 6, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeSideWindowGeometry(width: number, height: number, forwardSlant: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  shape.moveTo(-halfWidth + forwardSlant, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.quadraticCurveTo(halfWidth + 0.025, -halfHeight, halfWidth + 0.025, -halfHeight + 0.055);
  shape.lineTo(halfWidth - 0.025, halfHeight - 0.035);
  shape.quadraticCurveTo(halfWidth - 0.03, halfHeight, halfWidth - 0.085, halfHeight);
  shape.lineTo(-halfWidth, halfHeight - 0.04);
  shape.quadraticCurveTo(-halfWidth - 0.02, halfHeight - 0.05, -halfWidth + forwardSlant, -halfHeight);
  return new THREE.ShapeGeometry(shape, 8);
}

function makeTailFinGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.18, -0.12);
  shape.lineTo(0.2, -0.1);
  shape.lineTo(0.12, 0.46);
  shape.quadraticCurveTo(0.08, 0.57, -0.03, 0.53);
  shape.lineTo(-0.12, 0.16);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    curveSegments: 8,
  });
  geometry.center();
  return geometry;
}

function createMaterials(): HelicopterMaterials {
  return {
    orange: new THREE.MeshStandardMaterial({ color: '#dd5727', metalness: 0.46, roughness: 0.32 }),
    orangeDark: new THREE.MeshStandardMaterial({ color: '#83301f', metalness: 0.5, roughness: 0.38 }),
    white: new THREE.MeshStandardMaterial({ color: '#f2f1e9', metalness: 0.26, roughness: 0.32 }),
    graphite: new THREE.MeshStandardMaterial({ color: '#20282b', metalness: 0.72, roughness: 0.3 }),
    matteBlack: new THREE.MeshStandardMaterial({ color: '#0d1214', metalness: 0.16, roughness: 0.66 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8d999b', metalness: 0.86, roughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#171b1c', metalness: 0.04, roughness: 0.88 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#173c49',
      emissive: '#0a2430',
      emissiveIntensity: 0.22,
      metalness: 0.12,
      roughness: 0.08,
      transmission: 0.1,
      transparent: true,
      opacity: 0.9,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    }),
    interior: new THREE.MeshStandardMaterial({ color: '#20292c', metalness: 0.18, roughness: 0.72 }),
    seat: new THREE.MeshStandardMaterial({ color: '#37464a', metalness: 0.02, roughness: 0.9 }),
    instrument: new THREE.MeshStandardMaterial({
      color: '#152226',
      emissive: '#42d5e8',
      emissiveIntensity: 0.75,
      metalness: 0.2,
      roughness: 0.3,
    }),
    rescueBlue: new THREE.MeshStandardMaterial({ color: '#1f71a8', metalness: 0.28, roughness: 0.38 }),
  };
}

function buildLandingGear(parent: THREE.Group, materials: HelicopterMaterials): void {
  for (const side of [-1, 1]) {
    const x = side * 0.49;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0.09, -0.72),
      new THREE.Vector3(x, 0.055, -0.58),
      new THREE.Vector3(x, 0.05, 0.66),
      new THREE.Vector3(x, 0.1, 0.96),
    ]);
    shadowedMesh(
      parent,
      new THREE.TubeGeometry(curve, 28, 0.031, 8, false),
      materials.graphite,
      side < 0 ? 'LeftLandingSkid' : 'RightLandingSkid',
    );
    addCylinderBetween(
      parent,
      `${side < 0 ? 'Left' : 'Right'}ForwardSkidStrut`,
      [side * 0.39, 0.47, 0.54],
      [x, 0.075, 0.55],
      0.028,
      materials.steel,
    );
    addCylinderBetween(
      parent,
      `${side < 0 ? 'Left' : 'Right'}RearSkidStrut`,
      [side * 0.39, 0.47, -0.35],
      [x, 0.072, -0.38],
      0.028,
      materials.steel,
    );
    addBox(
      parent,
      `${side < 0 ? 'Left' : 'Right'}SkidWearPad`,
      [0.12, 0.015, 0.45],
      [x, 0.0075, 0.16],
      materials.rubber,
    );
    addBox(
      parent,
      `${side < 0 ? 'Left' : 'Right'}CabinStep`,
      [0.25, 0.025, 0.52],
      [side * 0.66, 0.29, 0.13],
      materials.graphite,
    );
  }
}

function buildCabin(parent: THREE.Group, materials: HelicopterMaterials): void {
  shadowedMesh(
    parent,
    new THREE.SphereGeometry(1, 32, 18),
    materials.orange,
    'RescueHelicopterFuselage',
    [0, 0.82, 0.35],
    [0, 0, 0],
    [0.63, 0.52, 0.94],
  );

  shadowedMesh(
    parent,
    new THREE.SphereGeometry(1.012, 24, 10, Math.PI * 0.28, Math.PI * 0.44, Math.PI * 0.19, Math.PI * 0.34),
    materials.glass,
    'PanoramicCockpitGlass',
    [0, 0.82, 0.35],
    [0, 0, 0],
    [0.63, 0.52, 0.94],
  );
  addBox(parent, 'CockpitCenterMullion', [0.026, 0.43, 0.025], [0, 1.02, 1.19], materials.graphite, [-0.16, 0, 0]);
  addBox(parent, 'CockpitLowerFrame', [0.88, 0.035, 0.035], [0, 0.78, 1.13], materials.graphite, [0.18, 0, 0]);

  const forwardWindow = makeSideWindowGeometry(0.48, 0.38, 0.09);
  const cabinWindow = makeSideWindowGeometry(0.36, 0.35, 0.02);
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'Left' : 'Right';
    shadowedMesh(
      parent,
      forwardWindow.clone(),
      materials.glass,
      `${sideName}PilotWindow`,
      [side * 0.627, 0.99, 0.57],
      [0, side * HALF_PI, 0],
    );
    shadowedMesh(
      parent,
      cabinWindow.clone(),
      materials.glass,
      `${sideName}CabinWindow`,
      [side * 0.634, 0.98, 0.05],
      [0, side * HALF_PI, 0],
    );

    addBox(parent, `${sideName}DoorTopRail`, [0.018, 0.025, 0.52], [side * 0.643, 1.21, 0.04], materials.graphite);
    addBox(parent, `${sideName}DoorBottomRail`, [0.018, 0.025, 0.56], [side * 0.643, 0.58, 0.03], materials.graphite);
    addBox(parent, `${sideName}DoorFrontRail`, [0.018, 0.64, 0.025], [side * 0.643, 0.89, 0.31], materials.graphite);
    addBox(parent, `${sideName}DoorRearRail`, [0.018, 0.58, 0.025], [side * 0.643, 0.88, -0.26], materials.graphite);
    addBox(parent, `${sideName}DoorHandle`, [0.025, 0.035, 0.16], [side * 0.665, 0.84, -0.16], materials.steel);
    addBox(parent, `${sideName}WhiteRescueCrossH`, [0.022, 0.07, 0.28], [side * 0.655, 0.68, 0.05], materials.white);
    addBox(parent, `${sideName}WhiteRescueCrossV`, [0.022, 0.28, 0.07], [side * 0.655, 0.68, 0.05], materials.white);
    addBox(parent, `${sideName}BlueRescueInset`, [0.024, 0.08, 0.08], [side * 0.67, 0.68, 0.05], materials.rescueBlue);
    addBox(parent, `${sideName}SeatHeadrest`, [0.026, 0.18, 0.13], [side * 0.648, 0.99, 0.47], materials.seat);
  }
  forwardWindow.dispose();
  cabinWindow.dispose();

  addBox(parent, 'InstrumentCoaming', [0.48, 0.12, 0.24], [0, 0.79, 0.89], materials.interior, [-0.22, 0, 0]);
  for (const x of [-0.16, -0.053, 0.053, 0.16]) {
    shadowedMesh(
      parent,
      new THREE.CircleGeometry(0.025, 12),
      materials.instrument,
      `CockpitInstrument-${x}`,
      [x, 0.88, 1.025],
      [-0.16, 0, 0],
    );
  }

  const cyclic = new THREE.Group();
  cyclic.name = 'PilotCyclicControl';
  cyclic.position.set(0.18, 0.54, 0.58);
  parent.add(cyclic);
  addCylinder(cyclic, 'CyclicShaft', 0.012, 0.014, 0.28, [0, 0.13, 0], [0, 0, 0], materials.graphite, 10);
  addCylinder(cyclic, 'CyclicGrip', 0.022, 0.022, 0.1, [0, 0.29, 0], [0, 0, HALF_PI], materials.rubber, 10);

  const collective = new THREE.Group();
  collective.name = 'PilotCollectiveControl';
  collective.position.set(-0.26, 0.58, 0.42);
  collective.rotation.z = -0.72;
  parent.add(collective);
  addCylinder(collective, 'CollectiveShaft', 0.012, 0.014, 0.3, [0, 0.15, 0], [0, 0, 0], materials.graphite, 10);
  addCylinder(collective, 'CollectiveGrip', 0.024, 0.024, 0.11, [0, 0.33, 0], [0, 0, HALF_PI], materials.rubber, 10);

  const pilot = new THREE.Group();
  pilot.name = 'CockpitPilot';
  pilot.visible = false;
  parent.add(pilot);
  shadowedMesh(
    pilot,
    new THREE.CapsuleGeometry(0.09, 0.18, 5, 12),
    materials.rescueBlue,
    'PilotTorso',
    [0, 0.82, 0.53],
    [0.12, 0, 0],
    [1.15, 1, 0.9],
  );
  shadowedMesh(
    pilot,
    new THREE.SphereGeometry(0.115, 18, 12),
    materials.graphite,
    'PilotHelmet',
    [0, 1.07, 0.59],
    [0, 0, 0],
    [0.95, 1.05, 0.92],
  );
  shadowedMesh(
    pilot,
    new THREE.SphereGeometry(0.09, 16, 8),
    materials.glass,
    'PilotVisor',
    [0, 1.06, 0.672],
    [-0.08, 0, 0],
    [0.84, 0.42, 0.24],
  );
  addCylinderBetween(pilot, 'PilotRightArm', [0.08, 0.88, 0.55], [0.17, 0.73, 0.62], 0.026, materials.rescueBlue, 8);
  addCylinderBetween(pilot, 'PilotLeftArm', [-0.08, 0.88, 0.54], [-0.21, 0.72, 0.48], 0.026, materials.rescueBlue, 8);

  shadowedMesh(
    parent,
    new THREE.CapsuleGeometry(0.22, 0.42, 6, 16),
    materials.orangeDark,
    'EngineCowling',
    [0, 1.21, -0.15],
    [HALF_PI, 0, 0],
    [1.22, 1, 1],
  );
  addBox(parent, 'EngineIntake', [0.32, 0.08, 0.28], [0, 1.4, 0.01], materials.graphite, [-0.08, 0, 0]);
  for (const x of [-0.11, -0.055, 0, 0.055, 0.11]) {
    addBox(parent, `IntakeLouver-${x}`, [0.025, 0.012, 0.25], [x, 1.447, 0.01], materials.matteBlack, [-0.08, 0, 0]);
  }

  for (const side of [-1, 1]) {
    addCylinder(
      parent,
      `${side < 0 ? 'Left' : 'Right'}TurbineExhaust`,
      0.065,
      0.075,
      0.24,
      [side * 0.38, 1.25, -0.35],
      [0, 0, HALF_PI],
      materials.steel,
      16,
    );
    addCylinder(
      parent,
      `${side < 0 ? 'Left' : 'Right'}ExhaustInterior`,
      0.049,
      0.049,
      0.244,
      [side * 0.382, 1.25, -0.35],
      [0, 0, HALF_PI],
      materials.matteBlack,
      14,
    );
  }

  const winch = new THREE.Group();
  winch.name = 'RescueWinch';
  winch.position.set(-0.71, 1.18, -0.03);
  parent.add(winch);
  addCylinder(winch, 'WinchDrum', 0.1, 0.1, 0.18, [0, 0, 0], [0, 0, HALF_PI], materials.graphite, 16);
  addCylinder(winch, 'WinchCable', 0.008, 0.008, 0.58, [0, -0.32, 0], [0, 0, 0], materials.matteBlack, 8);
  shadowedMesh(winch, new THREE.TorusGeometry(0.045, 0.01, 6, 14, Math.PI * 1.55), materials.steel, 'WinchHook', [0, -0.63, 0], [0, 0, 0]);
}

function buildTail(parent: THREE.Group, materials: HelicopterMaterials): void {
  addCylinder(
    parent,
    'TaperedTailBoom',
    0.21,
    0.07,
    1.24,
    [0, 0.93, -1.15],
    [HALF_PI, 0, 0],
    materials.orange,
    20,
  );
  addCylinder(parent, 'TailBoomWhiteBandA', 0.15, 0.135, 0.1, [0, 0.93, -0.94], [HALF_PI, 0, 0], materials.white, 20);
  addCylinder(parent, 'TailBoomWhiteBandB', 0.1, 0.09, 0.09, [0, 0.93, -1.4], [HALF_PI, 0, 0], materials.white, 18);

  shadowedMesh(parent, makeTailFinGeometry(), materials.orangeDark, 'VerticalTailFin', [0, 1.15, -1.7], [0, HALF_PI, 0]);
  addBox(parent, 'TailFinWhiteTip', [0.065, 0.16, 0.16], [0, 1.54, -1.7], materials.white, [0.08, 0, 0]);
  addBox(parent, 'HorizontalStabilizer', [0.88, 0.035, 0.2], [0, 0.94, -1.42], materials.orangeDark, [0.04, 0, 0]);
  for (const side of [-1, 1]) {
    addBox(
      parent,
      `${side < 0 ? 'Left' : 'Right'}StabilizerEndplate`,
      [0.035, 0.17, 0.18],
      [side * 0.43, 0.99, -1.42],
      materials.white,
      [0.08, 0, 0],
    );
  }

  addCylinder(parent, 'TailRotorAxle', 0.035, 0.035, 0.26, [0.13, 1.03, -1.69], [0, 0, HALF_PI], materials.steel, 12);
  const tailRotor = new THREE.Group();
  tailRotor.name = 'TailRotorSpin';
  tailRotor.position.set(0.27, 1.03, -1.69);
  parent.add(tailRotor);
  shadowedMesh(tailRotor, new THREE.SphereGeometry(0.055, 12, 8), materials.steel, 'TailRotorHub');
  for (let index = 0; index < 5; index += 1) {
    const bladeRig = new THREE.Group();
    bladeRig.name = `TailRotorBladeRig-${index}`;
    bladeRig.rotation.z = (index / 5) * Math.PI * 2;
    tailRotor.add(bladeRig);
    shadowedMesh(
      bladeRig,
      taperedBladeGeometry(0.25, 0.058, 0.035, 0.018),
      index === 0 ? materials.white : materials.graphite,
      `TailRotorBlade-${index}`,
      [0.055, 0, 0],
      [HALF_PI, 0, 0],
    );
  }
  const tailDiscMaterial = new THREE.MeshBasicMaterial({
    color: '#9bcbd4',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const tailDisc = shadowedMesh(tailRotor, new THREE.CircleGeometry(0.315, 32), tailDiscMaterial, 'TailRotorBlurDisc');
  tailDisc.castShadow = false;
  tailDisc.receiveShadow = false;
}

function buildMainRotor(parent: THREE.Group, materials: HelicopterMaterials): void {
  addCylinder(parent, 'RotorMast', 0.035, 0.045, 0.25, [0, 1.47, 0.13], [0, 0, 0], materials.steel, 16);
  addCylinder(parent, 'MastBoot', 0.105, 0.13, 0.1, [0, 1.38, 0.13], [0, 0, 0], materials.graphite, 16);

  const swashplate = new THREE.Group();
  swashplate.name = 'RotorSwashplate';
  swashplate.position.set(0, 1.48, 0.13);
  parent.add(swashplate);
  addCylinder(swashplate, 'SwashplateLower', 0.14, 0.14, 0.025, [0, 0, 0], [0, 0, 0], materials.graphite, 20);
  addCylinder(swashplate, 'SwashplateUpper', 0.11, 0.11, 0.035, [0, 0.035, 0], [0, 0, 0], materials.steel, 20);

  const rotor = new THREE.Group();
  rotor.name = 'MainRotorSpin';
  rotor.position.set(0, 1.56, 0.13);
  parent.add(rotor);
  shadowedMesh(rotor, new THREE.SphereGeometry(0.11, 16, 10), materials.graphite, 'MainRotorHub');
  addBox(rotor, 'RotorHubCrossX', [0.42, 0.055, 0.08], [0, 0, 0], materials.steel);
  addBox(rotor, 'RotorHubCrossZ', [0.08, 0.055, 0.42], [0, 0, 0], materials.steel);

  for (let index = 0; index < 4; index += 1) {
    const bladeRig = new THREE.Group();
    bladeRig.name = `MainRotorBladeRig-${index}`;
    bladeRig.rotation.y = index * HALF_PI;
    rotor.add(bladeRig);
    addCylinderBetween(
      bladeRig,
      `BladePitchLink-${index}`,
      [0.12, -0.055, 0],
      [0.2, -0.01, 0],
      0.008,
      materials.steel,
      6,
    );
    shadowedMesh(
      bladeRig,
      taperedBladeGeometry(1.48, 0.13, 0.072, 0.018),
      materials.graphite,
      `MainRotorBlade-${index}`,
      [0.2, 0, 0],
    );
    shadowedMesh(
      bladeRig,
      taperedBladeGeometry(0.13, 0.073, 0.06, 0.019),
      index % 2 === 0 ? materials.orange : materials.white,
      `MainRotorBladeTip-${index}`,
      [1.68, 0, 0],
    );
  }

  const blurMaterial = new THREE.MeshBasicMaterial({
    color: '#49656b',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const blurDisc = shadowedMesh(
    rotor,
    new THREE.CircleGeometry(1.81, 64),
    blurMaterial,
    'MainRotorBlurDisc',
    [0, -0.014, 0],
    [-HALF_PI, 0, 0],
  );
  blurDisc.castShadow = false;
  blurDisc.receiveShadow = false;
}

function buildLights(parent: THREE.Group, materials: HelicopterMaterials): void {
  const leftMaterial = new THREE.MeshStandardMaterial({
    color: '#ff273e',
    emissive: '#ff1028',
    emissiveIntensity: 2,
    roughness: 0.18,
  });
  const rightMaterial = new THREE.MeshStandardMaterial({
    color: '#34ff8a',
    emissive: '#12e46a',
    emissiveIntensity: 2,
    roughness: 0.18,
  });
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: '#ff5a27',
    emissive: '#ff3010',
    emissiveIntensity: 1,
    roughness: 0.16,
  });

  shadowedMesh(parent, new THREE.SphereGeometry(0.045, 12, 8), leftMaterial, 'LeftNavigationLens', [-0.68, 0.96, -0.22]);
  shadowedMesh(parent, new THREE.SphereGeometry(0.045, 12, 8), rightMaterial, 'RightNavigationLens', [0.68, 0.96, -0.22]);
  shadowedMesh(parent, new THREE.SphereGeometry(0.055, 12, 8), beaconMaterial, 'AntiCollisionBeacon', [0, 1.47, -0.17]);

  const leftLight = new THREE.PointLight('#ff1836', 0, 1.7, 2);
  leftLight.name = 'LeftNavigationLight';
  leftLight.position.set(-0.69, 0.96, -0.22);
  parent.add(leftLight);
  const rightLight = new THREE.PointLight('#32ff8f', 0, 1.7, 2);
  rightLight.name = 'RightNavigationLight';
  rightLight.position.set(0.69, 0.96, -0.22);
  parent.add(rightLight);
  const beacon = new THREE.PointLight('#ff4a20', 0, 2.4, 2);
  beacon.name = 'AntiCollisionLight';
  beacon.position.set(0, 1.5, -0.17);
  parent.add(beacon);

  const searchLensMaterial = materials.white.clone();
  searchLensMaterial.emissive.set('#ffe9ba');
  searchLensMaterial.emissiveIntensity = 0.25;
  shadowedMesh(parent, new THREE.CylinderGeometry(0.095, 0.075, 0.08, 16), materials.graphite, 'SearchlightHousing', [0, 0.54, 1.24], [HALF_PI, 0, 0]);
  shadowedMesh(parent, new THREE.CircleGeometry(0.068, 16), searchLensMaterial, 'SearchlightLens', [0, 0.54, 1.285], [0, 0, 0]);
  const searchlight = new THREE.PointLight('#ffe8b6', 0, 4.2, 1.7);
  searchlight.name = 'RescueSearchLight';
  searchlight.position.set(0, 0.54, 1.31);
  parent.add(searchlight);
}

function buildEffects(root: THREE.Group, airframe: THREE.Group): void {
  const effects = new THREE.Group();
  effects.name = 'HelicopterEffects';
  root.add(effects);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#c7e7ec',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = shadowedMesh(
    effects,
    new THREE.TorusGeometry(0.68, 0.009, 5, 48),
    ringMaterial,
    'RotorDownwashRing',
    [0, 0.018, 0.12],
    [HALF_PI, 0, 0],
  );
  ring.castShadow = false;
  ring.receiveShadow = false;

  const dustGeometry = new THREE.SphereGeometry(0.035, 6, 4);
  for (let index = 0; index < 10; index += 1) {
    const dustMaterial = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? '#d2c3a3' : '#b9d2d4',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const dust = shadowedMesh(effects, dustGeometry, dustMaterial, `DownwashParticle-${index}`);
    dust.position.y = 0.04;
    dust.castShadow = false;
    dust.receiveShadow = false;
    dust.visible = false;
  }

  for (const side of [-1, 1]) {
    const shimmerMaterial = new THREE.MeshBasicMaterial({
      color: '#b8edff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shimmer = shadowedMesh(
      airframe,
      new THREE.SphereGeometry(0.08, 8, 5),
      shimmerMaterial,
      side < 0 ? 'LeftExhaustShimmer' : 'RightExhaustShimmer',
      [side * 0.52, 1.25, -0.35],
      [0, 0, 0],
      [1.25, 0.75, 0.75],
    );
    shimmer.castShadow = false;
    shimmer.receiveShadow = false;
    shimmer.visible = false;
  }
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'PrecisionRescueHelicopter';
  root.userData.vehicleActive = false;
  root.userData.vehicleThrottle = 0;
  root.userData.vehiclePitch = 0;
  root.userData.vehicleRoll = 0;
  root.userData.vehicleYawInput = 0;
  root.userData.vehicleVerticalInput = 0;
  root.userData.rotorRpm = 0;
  root.userData.rotorAngle = 0;
  root.userData.lastElapsed = 0;
  root.userData.lastVehicleVisualElapsed = Number.NEGATIVE_INFINITY;
  root.userData.interactionState = 'parked';
  root.userData.vehicleKind = vehicle.kind;
  root.userData.seatAnchor = [...vehicle.seatAnchor];

  const visualRig = new THREE.Group();
  visualRig.name = 'HelicopterVisualRig';
  root.add(visualRig);

  const airframe = new THREE.Group();
  airframe.name = 'HelicopterAirframe';
  visualRig.add(airframe);

  const materials = createMaterials();
  buildLandingGear(airframe, materials);
  buildCabin(airframe, materials);
  buildTail(airframe, materials);
  buildMainRotor(airframe, materials);
  buildLights(airframe, materials);
  buildEffects(root, airframe);

  return root;
}

function updateRotorSystem(object: THREE.Object3D, elapsed: number, delta: number, active: boolean, throttle: number, vertical: number): number {
  const targetRpm = active ? 0.74 + Math.max(throttle, Math.abs(vertical) * 0.7) * 0.26 : 0;
  const currentRpm = THREE.MathUtils.clamp(Number(object.userData.rotorRpm) || 0, 0, 1);
  const responseSeconds = targetRpm > currentRpm ? ROTOR_SPIN_UP_SECONDS : 2.1;
  const blend = 1 - Math.exp(-delta / Math.max(0.01, responseSeconds));
  const rpm = THREE.MathUtils.lerp(currentRpm, targetRpm, blend);
  object.userData.rotorRpm = rpm;

  const previousAngle = Number(object.userData.rotorAngle) || 0;
  const rotorAngle = (previousAngle + delta * rpm * (1.2 + rpm * 47)) % (Math.PI * 2);
  object.userData.rotorAngle = rotorAngle;

  const mainRotor = object.getObjectByName('MainRotorSpin');
  if (mainRotor) mainRotor.rotation.y = rotorAngle;
  const tailRotor = object.getObjectByName('TailRotorSpin');
  if (tailRotor) tailRotor.rotation.z = -rotorAngle * 4.7;

  const collectivePitch = THREE.MathUtils.degToRad(1.5 + rpm * 3.2 + Math.max(0, vertical) * 3.5 + throttle * 1.6);
  for (let index = 0; index < 4; index += 1) {
    const bladeRig = object.getObjectByName(`MainRotorBladeRig-${index}`);
    if (bladeRig) bladeRig.rotation.x = collectivePitch;
  }

  const mainDisc = object.getObjectByName('MainRotorBlurDisc') as THREE.Mesh | undefined;
  if (mainDisc) {
    const material = mainDisc.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.clamp((rpm - 0.3) * 0.065, 0, 0.04);
    mainDisc.visible = material.opacity > 0.002;
  }
  const tailDisc = object.getObjectByName('TailRotorBlurDisc') as THREE.Mesh | undefined;
  if (tailDisc) {
    const material = tailDisc.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.clamp((rpm - 0.25) * 0.18, 0, 0.12);
    tailDisc.visible = material.opacity > 0.002;
  }

  const pulse = 0.85 + Math.sin(elapsed * 22) * 0.08;
  for (const name of ['LeftExhaustShimmer', 'RightExhaustShimmer']) {
    const shimmer = object.getObjectByName(name) as THREE.Mesh | undefined;
    if (!shimmer) continue;
    shimmer.visible = active && rpm > 0.2;
    shimmer.scale.set(1.1 + rpm * 0.5, pulse, pulse);
    (shimmer.material as THREE.MeshBasicMaterial).opacity = shimmer.visible ? rpm * 0.09 : 0;
  }
  return rpm;
}

function updateControlsAndAirframe(
  object: THREE.Object3D,
  pitch: number,
  roll: number,
  yaw: number,
  throttle: number,
  vertical: number,
  rpm: number,
): void {
  const visualRig = object.getObjectByName('HelicopterVisualRig');
  if (visualRig) {
    // The shared vehicle wrapper owns authoritative pitch and roll. Keeping the
    // visual rig level avoids applying the networked attitude twice.
    visualRig.rotation.x = 0;
    visualRig.rotation.z = 0;
    visualRig.position.y = rpm > 0.25 ? Math.sin(Number(object.userData.rotorAngle) * 2) * 0.003 * rpm : 0;
  }

  const swashplate = object.getObjectByName('RotorSwashplate');
  if (swashplate) {
    swashplate.rotation.x = -pitch * 0.12;
    swashplate.rotation.z = -roll * 0.12;
  }
  const cyclic = object.getObjectByName('PilotCyclicControl');
  if (cyclic) {
    cyclic.rotation.x = -pitch * 0.18;
    cyclic.rotation.z = -roll * 0.18;
  }
  const collective = object.getObjectByName('PilotCollectiveControl');
  if (collective) collective.rotation.z = -0.72 + THREE.MathUtils.clamp(throttle + Math.max(0, vertical) * 0.35, 0, 1) * 0.38;

  const tailRotor = object.getObjectByName('TailRotorSpin');
  if (tailRotor) tailRotor.position.x = 0.27 + yaw * 0.006;
}

function updateLights(object: THREE.Object3D, elapsed: number, active: boolean): void {
  const navigationPulse = active ? 0.72 + Math.sin(elapsed * 2.4) * 0.16 : 0.08;
  const beaconPulse = active && (elapsed % 1.1 < 0.13 || (elapsed + 0.19) % 1.1 < 0.1) ? 1 : 0.05;
  const left = object.getObjectByName('LeftNavigationLight') as THREE.PointLight | undefined;
  const right = object.getObjectByName('RightNavigationLight') as THREE.PointLight | undefined;
  const beacon = object.getObjectByName('AntiCollisionLight') as THREE.PointLight | undefined;
  const search = object.getObjectByName('RescueSearchLight') as THREE.PointLight | undefined;
  if (left) left.intensity = navigationPulse;
  if (right) right.intensity = navigationPulse;
  if (beacon) beacon.intensity = beaconPulse * 2.2;
  if (search) search.intensity = active ? 1.2 : 0;

  const beaconLens = object.getObjectByName('AntiCollisionBeacon') as THREE.Mesh | undefined;
  if (beaconLens) (beaconLens.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + beaconPulse * 3.4;
  const searchLens = object.getObjectByName('SearchlightLens') as THREE.Mesh | undefined;
  if (searchLens) (searchLens.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 2.3 : 0.25;
}

function updateDownwash(object: THREE.Object3D, elapsed: number, active: boolean, rpm: number, vertical: number): void {
  const strength = active ? THREE.MathUtils.clamp((rpm - 0.35) / 0.65, 0, 1) * (0.7 + Math.max(0, vertical) * 0.3) : 0;
  const ring = object.getObjectByName('RotorDownwashRing') as THREE.Mesh | undefined;
  if (ring) {
    const phase = ((elapsed * 1.8) % 1 + 1) % 1;
    ring.visible = strength > 0.03;
    ring.scale.setScalar(0.72 + phase * 0.72);
    (ring.material as THREE.MeshBasicMaterial).opacity = strength * (1 - phase) * 0.13;
  }

  for (let index = 0; index < 10; index += 1) {
    const dust = object.getObjectByName(`DownwashParticle-${index}`) as THREE.Mesh | undefined;
    if (!dust) continue;
    const phase = ((elapsed * 0.7 + index / 10) % 1 + 1) % 1;
    const angle = index * 2.399 + elapsed * (0.3 + (index % 3) * 0.06);
    const radius = 0.38 + phase * 0.85;
    dust.position.set(Math.cos(angle) * radius, 0.03 + Math.sin(phase * Math.PI) * 0.07, 0.12 + Math.sin(angle) * radius * 0.7);
    const size = 0.45 + phase * 1.25;
    dust.scale.setScalar(size);
    dust.visible = strength > 0.18 && phase < 0.88;
    (dust.material as THREE.MeshBasicMaterial).opacity = dust.visible ? strength * (1 - phase) * 0.18 : 0;
  }
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const previousElapsed = Number(object.userData.lastElapsed) || elapsed;
  const delta = THREE.MathUtils.clamp(elapsed - previousElapsed, 0, 0.1);
  object.userData.lastElapsed = elapsed;

  const lastVisualElapsed = Number(object.userData.lastVehicleVisualElapsed);
  if (object.userData.vehicleActive === true && elapsed - lastVisualElapsed > 0.25) {
    object.userData.vehicleActive = false;
    object.userData.vehicleThrottle = 0;
    object.userData.vehicleVerticalInput = 0;
  }

  const active = object.userData.vehicleActive === true;
  const throttle = THREE.MathUtils.clamp(Number(object.userData.vehicleThrottle) || 0, 0, 1);
  const pitch = clampInput(object.userData.vehiclePitch);
  const roll = clampInput(object.userData.vehicleRoll);
  const yaw = clampInput(object.userData.vehicleYawInput);
  const vertical = clampInput(object.userData.vehicleVerticalInput);

  const rpm = updateRotorSystem(object, elapsed, delta, active, throttle, vertical);
  updateControlsAndAirframe(object, pitch, roll, yaw, throttle, vertical, rpm);
  updateLights(object, elapsed, active);
  updateDownwash(object, elapsed, active, rpm, vertical);
  const pilot = object.getObjectByName('CockpitPilot');
  if (pilot) pilot.visible = active;
  object.userData.interactionState = active ? (rpm > 0.68 ? 'flight-ready' : 'rotor-spin-up') : rpm > 0.08 ? 'rotor-spin-down' : 'parked';
}

export function updateLobbyVehicleVisual(
  object: THREE.Object3D,
  state: HelicopterVehicleVisualState,
  elapsed: number,
): void {
  const active = state.phase !== 'idle';
  object.userData.vehicleActive = active;
  object.userData.vehicleThrottle = THREE.MathUtils.clamp(state.throttle, 0, 1);
  object.userData.vehiclePitch = state.pitch;
  object.userData.vehicleRoll = state.roll;
  object.userData.vehicleYawInput = state.steering;
  object.userData.vehicleVerticalInput = THREE.MathUtils.clamp(state.vertical, -1, 1);
  object.userData.vehicleSpeed = state.speed;
  object.userData.vehicleNormalizedSpeed = state.normalizedSpeed;
  object.userData.vehiclePhase = state.phase;
  object.userData.lastVehicleVisualElapsed = elapsed;
}
