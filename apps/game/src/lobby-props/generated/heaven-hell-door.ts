import * as THREE from 'three';

export const code = 'heaven-hell-door';

export const portal = {
  kind: 'space',
  destinations: [
    { id: 'heaven', label: '天堂', spaceId: 'heaven' },
    { id: 'hell', label: '地狱', spaceId: 'hell' },
  ],
} as const;

type VectorTuple = readonly [number, number, number];

const HEAVEN_X = -0.425;
const HELL_X = 0.425;
const DOOR_OPEN_ANGLE = -1.24;

function addMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: VectorTuple,
  rotation: VectorTuple = [0, 0, 0],
  shadows = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
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
  return addMesh(parent, name, new THREE.BoxGeometry(...size), material, position, rotation);
}

function addCloud(
  parent: THREE.Object3D,
  name: string,
  position: VectorTuple,
  scale: number,
  material: THREE.Material,
): THREE.Group {
  const cloud = new THREE.Group();
  cloud.name = name;
  cloud.position.set(...position);
  cloud.userData.baseX = position[0];
  cloud.userData.baseY = position[1];
  cloud.userData.phase = name.length * 0.37;
  const puffs = [
    [-0.13, 0, 0],
    [0, 0.055, 0.01],
    [0.13, -0.005, 0],
    [-0.055, 0.055, 0.015],
  ] as const;
  for (const [index, puff] of puffs.entries()) {
    addMesh(
      cloud,
      `${name}-Puff-${index}`,
      new THREE.SphereGeometry((index === 1 ? 0.13 : 0.11) * scale, 12, 8),
      material,
      puff,
      [0, 0, 0],
      false,
    );
  }
  parent.add(cloud);
  return cloud;
}

function addDestinationGlyph(
  parent: THREE.Object3D,
  destination: 'heaven' | 'hell',
  x: number,
  material: THREE.Material,
): void {
  const glyph = new THREE.Group();
  glyph.name = destination === 'heaven' ? 'HeavenGlyph' : 'HellGlyph';
  glyph.position.set(x, 3.215, 0.205);

  const stroke = (
    name: string,
    width: number,
    position: readonly [number, number],
    angle = 0,
  ): void => {
    addBox(
      glyph,
      `${glyph.name}-${name}`,
      [width, 0.027, 0.018],
      [position[0], position[1], 0],
      material,
      [0, 0, angle],
    );
  };

  if (destination === 'heaven') {
    // A compact, hand-built 天 mark avoids fonts and remains legible at prop scale.
    stroke('Top', 0.23, [0, 0.075]);
    stroke('Middle', 0.31, [0, 0.005]);
    stroke('Stem', 0.2, [0, -0.055], Math.PI / 2);
    stroke('LeftSweep', 0.2, [-0.065, -0.105], -0.82);
    stroke('RightSweep', 0.2, [0.065, -0.105], 0.82);
  } else {
    // A flame-shaped 地 insignia: the side post and enclosed realm stay readable.
    stroke('EarthTop', 0.12, [-0.09, 0.045]);
    stroke('EarthStem', 0.18, [-0.09, -0.015], Math.PI / 2);
    stroke('EarthBase', 0.15, [-0.09, -0.105]);
    stroke('RealmTop', 0.18, [0.07, 0.06], -0.12);
    stroke('RealmLeft', 0.19, [0.015, -0.03], Math.PI / 2);
    stroke('RealmRight', 0.17, [0.125, -0.02], Math.PI / 2);
    stroke('RealmBase', 0.2, [0.075, -0.105], 0.08);
  }
  parent.add(glyph);
}

function createDestinationPlaques(
  root: THREE.Object3D,
  pearl: THREE.Material,
  gold: THREE.Material,
  heavenGlow: THREE.Material,
  hellGlow: THREE.Material,
): void {
  for (const [id, x, glow] of [
    ['heaven', -0.47, heavenGlow],
    ['hell', 0.47, hellGlow],
  ] as const) {
    addMesh(
      root,
      `${id === 'heaven' ? 'Heaven' : 'Hell'}Plaque`,
      new THREE.CylinderGeometry(0.245, 0.245, 0.075, 32),
      pearl,
      [x, 3.215, 0.095],
      [Math.PI / 2, 0, 0],
    );
    addMesh(
      root,
      `${id === 'heaven' ? 'Heaven' : 'Hell'}PlaqueGlow`,
      new THREE.TorusGeometry(0.21, 0.025, 10, 32),
      glow,
      [x, 3.215, 0.178],
      [0, 0, 0],
      false,
    );
    addDestinationGlyph(root, id, x, gold);
  }

  const pointer = addMesh(
    root,
    'DestinationPointer',
    new THREE.ConeGeometry(0.085, 0.18, 5),
    gold,
    [HEAVEN_X, 3.57, 0.12],
    [0, 0, Math.PI],
  );
  pointer.userData.baseY = 3.57;
}

function createPortalInterior(
  root: THREE.Object3D,
  heavenSurfaceMaterial: THREE.MeshStandardMaterial,
  hellSurfaceMaterial: THREE.MeshStandardMaterial,
  heavenGlow: THREE.MeshStandardMaterial,
  hellGlow: THREE.MeshStandardMaterial,
  pearlGlow: THREE.MeshStandardMaterial,
  basalt: THREE.MeshStandardMaterial,
): void {
  const portalInterior = new THREE.Group();
  portalInterior.name = 'PortalInterior';
  root.add(portalInterior);

  addMesh(
    portalInterior,
    'HeavenPortalSurface',
    new THREE.PlaneGeometry(0.84, 2.49),
    heavenSurfaceMaterial,
    [HEAVEN_X, 1.54, 0.005],
    [0, 0, 0],
    false,
  );
  addMesh(
    portalInterior,
    'HellPortalSurface',
    new THREE.PlaneGeometry(0.84, 2.49),
    hellSurfaceMaterial,
    [HELL_X, 1.54, 0.006],
    [0, 0, 0],
    false,
  );

  const halo = addMesh(
    portalInterior,
    'CelestialHalo',
    new THREE.TorusGeometry(0.235, 0.028, 10, 36),
    heavenGlow,
    [HEAVEN_X, 2.38, 0.04],
    [0.22, 0, 0],
    false,
  );
  halo.userData.baseY = 2.38;

  addCloud(portalInterior, 'CelestialCloud-0', [-0.58, 0.63, 0.05], 0.9, pearlGlow);
  addCloud(portalInterior, 'CelestialCloud-1', [-0.27, 1.14, 0.045], 0.64, pearlGlow);
  addCloud(portalInterior, 'CelestialCloud-2', [-0.59, 1.74, 0.04], 0.52, pearlGlow);

  for (let index = 0; index < 11; index += 1) {
    const x = -0.77 + ((index * 47) % 67) / 100;
    const y = 0.36 + ((index * 31) % 201) / 100;
    const mote = addMesh(
      portalInterior,
      `CelestialMote-${index}`,
      new THREE.SphereGeometry(index % 3 === 0 ? 0.025 : 0.017, 8, 6),
      heavenGlow,
      [x, y, 0.052],
      [0, 0, 0],
      false,
    );
    mote.userData.baseX = x;
    mote.userData.phase = (index * 0.173) % 1;
  }

  for (let index = 0; index < 7; index += 1) {
    const x = 0.11 + ((index * 43) % 66) / 100;
    const y = 0.31 + ((index * 37) % 174) / 100;
    const ember = addMesh(
      portalInterior,
      `InfernalEmber-${index}`,
      new THREE.OctahedronGeometry(index % 2 === 0 ? 0.034 : 0.024, 0),
      hellGlow,
      [x, y, 0.055],
      [0, 0, 0],
      false,
    );
    ember.userData.baseX = x;
    ember.userData.phase = (index * 0.211) % 1;
  }

  for (let index = 0; index < 6; index += 1) {
    const x = 0.14 + index * 0.12;
    const flame = addMesh(
      portalInterior,
      `InfernalFlame-${index}`,
      new THREE.ConeGeometry(0.075 + (index % 2) * 0.018, 0.42, 5),
      hellGlow,
      [x, 0.42 + (index % 3) * 0.035, 0.045],
      [0, 0, (index % 2 === 0 ? -1 : 1) * 0.08],
      false,
    );
    flame.userData.phase = index * 0.83;
    flame.userData.baseY = flame.position.y;
  }

  for (let index = 0; index < 5; index += 1) {
    const spikeHeight = 0.3 + (index % 3) * 0.12;
    addMesh(
      portalInterior,
      `InfernalSpire-${index}`,
      new THREE.ConeGeometry(0.105, spikeHeight, 5),
      basalt,
      [0.18 + index * 0.14, 0.285 + spikeHeight * 0.5, 0.026],
      [0, 0, (index - 2) * 0.035],
      false,
    );
  }

  addBox(
    portalInterior,
    'RealmSeam',
    [0.028, 2.49, 0.028],
    [0, 1.54, 0.058],
    pearlGlow,
  );

  const selection = new THREE.Group();
  selection.name = 'DestinationSelectionFrame';
  selection.position.x = HEAVEN_X;
  const selectionMaterial = pearlGlow.clone();
  selectionMaterial.name = 'DestinationSelectionMaterial';
  addBox(selection, 'SelectionTop', [0.79, 0.035, 0.035], [0, 1.225, 0.08], selectionMaterial);
  addBox(selection, 'SelectionBottom', [0.79, 0.035, 0.035], [0, -1.225, 0.08], selectionMaterial);
  addBox(selection, 'SelectionLeft', [0.035, 2.45, 0.035], [-0.395, 0, 0.08], selectionMaterial);
  addBox(selection, 'SelectionRight', [0.035, 2.45, 0.035], [0.395, 0, 0.08], selectionMaterial);
  selection.position.y = 1.54;
  portalInterior.add(selection);

  const heavenLight = new THREE.PointLight('#91d8ff', 1.1, 3.4, 2);
  heavenLight.name = 'HeavenPortalLight';
  heavenLight.position.set(-0.38, 1.62, 0.48);
  root.add(heavenLight);
  const hellLight = new THREE.PointLight('#ff5d2d', 0.38, 3.2, 2);
  hellLight.name = 'HellPortalLight';
  hellLight.position.set(0.38, 1.28, 0.45);
  root.add(hellLight);
}

function createDoorLeaf(
  root: THREE.Object3D,
  pearl: THREE.MeshPhysicalMaterial,
  pearlInset: THREE.MeshPhysicalMaterial,
  gold: THREE.MeshStandardMaterial,
): void {
  const pivot = new THREE.Group();
  pivot.name = 'DoorLeafPivot';
  pivot.position.set(-0.86, 0.16, 0.19);
  pivot.rotation.y = DOOR_OPEN_ANGLE;
  root.add(pivot);

  addBox(pivot, 'DoorLeaf', [1.68, 2.55, 0.105], [0.84, 1.385, 0], pearl);
  addBox(pivot, 'DoorLeafInset', [1.39, 2.24, 0.026], [0.84, 1.385, 0.066], pearlInset);
  addBox(pivot, 'DoorLeafTopDetail', [1.16, 0.035, 0.025], [0.84, 2.27, 0.088], gold);
  addBox(pivot, 'DoorLeafBottomDetail', [1.16, 0.035, 0.025], [0.84, 0.5, 0.088], gold);

  for (const y of [0.75, 2.03]) {
    addMesh(
      pivot,
      `DoorHinge-${y}`,
      new THREE.CylinderGeometry(0.055, 0.055, 0.22, 16),
      gold,
      [0.005, y, -0.015],
    );
  }

  addMesh(
    pivot,
    'DoorHandleStem',
    new THREE.CylinderGeometry(0.026, 0.026, 0.13, 12),
    gold,
    [1.47, 1.42, 0.125],
    [Math.PI / 2, 0, 0],
  );
  addMesh(
    pivot,
    'DoorHandle',
    new THREE.SphereGeometry(0.09, 18, 12),
    gold,
    [1.47, 1.42, 0.205],
  );
  addMesh(
    pivot,
    'DoorHandleRose',
    new THREE.TorusGeometry(0.115, 0.018, 8, 24),
    gold,
    [1.47, 1.42, 0.08],
  );
}

function selectedIndexForSequence(sequence: number): 0 | 1 {
  const safeSequence = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0;
  return safeSequence > 0 && safeSequence % 2 === 0 ? 1 : 0;
}

function applyDestination(object: THREE.Object3D, sequence: number, ageSeconds = 0): void {
  const selectedIndex = selectedIndexForSequence(sequence);
  const destination = portal.destinations.at(selectedIndex)!;
  object.userData.portalSequence = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0;
  object.userData.destinationIndex = selectedIndex;
  object.userData.portalDestination = destination;
  object.userData.interactionState = `destination:${destination.id}`;
  object.userData.interactionAgeSeconds = Math.max(0, ageSeconds);

  const selection = object.getObjectByName('DestinationSelectionFrame');
  if (selection) selection.position.x = selectedIndex === 0 ? HEAVEN_X : HELL_X;
  const pointer = object.getObjectByName('DestinationPointer');
  if (pointer) pointer.position.x = selectedIndex === 0 ? HEAVEN_X : HELL_X;

  const heavenSurface = object.getObjectByName('HeavenPortalSurface') as THREE.Mesh | undefined;
  const hellSurface = object.getObjectByName('HellPortalSurface') as THREE.Mesh | undefined;
  const heavenMaterial = heavenSurface?.material as THREE.MeshStandardMaterial | undefined;
  const hellMaterial = hellSurface?.material as THREE.MeshStandardMaterial | undefined;
  if (heavenMaterial) heavenMaterial.opacity = selectedIndex === 0 ? 0.96 : 0.48;
  if (hellMaterial) hellMaterial.opacity = selectedIndex === 1 ? 0.96 : 0.48;

  const heavenPlaque = object.getObjectByName('HeavenPlaqueGlow') as THREE.Mesh | undefined;
  const hellPlaque = object.getObjectByName('HellPlaqueGlow') as THREE.Mesh | undefined;
  const heavenPlaqueMaterial = heavenPlaque?.material as THREE.MeshStandardMaterial | undefined;
  const hellPlaqueMaterial = hellPlaque?.material as THREE.MeshStandardMaterial | undefined;
  if (heavenPlaqueMaterial) heavenPlaqueMaterial.emissiveIntensity = selectedIndex === 0 ? 3.4 : 0.45;
  if (hellPlaqueMaterial) hellPlaqueMaterial.emissiveIntensity = selectedIndex === 1 ? 3.4 : 0.45;
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'HeavenHellDoor';

  const pearl = new THREE.MeshPhysicalMaterial({
    color: '#f3ead8',
    roughness: 0.24,
    metalness: 0.12,
    clearcoat: 0.72,
    clearcoatRoughness: 0.2,
    sheen: 0.36,
    sheenColor: new THREE.Color('#fff4dd'),
  });
  const pearlInset = new THREE.MeshPhysicalMaterial({
    color: '#dce5df',
    roughness: 0.28,
    metalness: 0.05,
    clearcoat: 0.58,
    clearcoatRoughness: 0.24,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: '#d4a94f',
    emissive: '#6b3f0c',
    emissiveIntensity: 0.28,
    roughness: 0.28,
    metalness: 0.76,
  });
  const darkBacking = new THREE.MeshStandardMaterial({
    color: '#161421',
    roughness: 0.76,
    metalness: 0.18,
  });
  const heavenSurface = new THREE.MeshStandardMaterial({
    color: '#72bdf2',
    emissive: '#238ee8',
    emissiveIntensity: 1.24,
    roughness: 0.26,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
  });
  const hellSurface = new THREE.MeshStandardMaterial({
    color: '#8e252c',
    emissive: '#e32d17',
    emissiveIntensity: 0.72,
    roughness: 0.34,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
  });
  const heavenGlow = new THREE.MeshStandardMaterial({
    color: '#f7fdff',
    emissive: '#8ce6ff',
    emissiveIntensity: 2.6,
    roughness: 0.18,
  });
  const hellGlow = new THREE.MeshStandardMaterial({
    color: '#ffb144',
    emissive: '#ff3217',
    emissiveIntensity: 1.35,
    roughness: 0.24,
  });
  const pearlGlow = new THREE.MeshStandardMaterial({
    color: '#fff8dd',
    emissive: '#ffe9a3',
    emissiveIntensity: 1.7,
    roughness: 0.18,
  });
  const basalt = new THREE.MeshStandardMaterial({
    color: '#24141b',
    emissive: '#4b0d0d',
    emissiveIntensity: 0.44,
    roughness: 0.88,
  });

  addBox(root, 'DoorPlinth', [2.45, 0.16, 0.74], [0, 0.08, 0], pearl);
  addBox(root, 'DoorThreshold', [1.82, 0.09, 0.49], [0, 0.205, 0.01], gold);
  for (const x of [-0.88, 0.88]) {
    addBox(root, `DoorFoot-${x}`, [0.48, 0.13, 0.9], [x, 0.09, 0], pearl);
    addBox(root, `DoorPost-${x}`, [0.28, 2.92, 0.35], [x, 1.68, 0], pearl);
    addBox(root, `DoorInnerTrim-${x}`, [0.055, 2.57, 0.045], [x * 0.965, 1.54, 0.19], gold);
  }
  addBox(root, 'DoorHeader', [2.04, 0.3, 0.38], [0, 3.04, 0], pearl);
  addBox(root, 'DoorHeaderTrim', [1.74, 0.055, 0.045], [0, 2.875, 0.19], gold);
  addBox(root, 'PortalBacking', [1.7, 2.52, 0.12], [0, 1.54, -0.065], darkBacking);

  for (const x of [-0.88, 0.88]) {
    addMesh(
      root,
      `DoorCornerPearl-${x}`,
      new THREE.SphereGeometry(0.185, 18, 12),
      pearl,
      [x, 3.05, 0],
    );
  }

  createPortalInterior(root, heavenSurface, hellSurface, heavenGlow, hellGlow, pearlGlow, basalt);
  createDestinationPlaques(root, pearl, gold, heavenGlow, hellGlow);
  createDoorLeaf(root, pearl, pearlInset, gold);

  root.userData.portalSequence = 0;
  applyDestination(root, 0);
  return root;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const selectedIndex = Number(object.userData.destinationIndex) === 1 ? 1 : 0;
  const selectedWave = 0.5 + Math.sin(elapsed * 2.2) * 0.5;

  const leaf = object.getObjectByName('DoorLeafPivot');
  if (leaf) leaf.rotation.y = DOOR_OPEN_ANGLE + Math.sin(elapsed * 0.58) * 0.018;

  const pointer = object.getObjectByName('DestinationPointer');
  if (pointer) {
    pointer.position.y = Number(pointer.userData.baseY) + Math.sin(elapsed * 2.8) * 0.035;
    const pointerScale = 0.92 + selectedWave * 0.14;
    pointer.scale.setScalar(pointerScale);
  }

  const selection = object.getObjectByName('DestinationSelectionFrame');
  if (selection) {
    const pulse = 1 + Math.sin(elapsed * 3.4) * 0.012;
    selection.scale.set(pulse, pulse, 1);
  }

  const halo = object.getObjectByName('CelestialHalo');
  if (halo) {
    halo.rotation.z = elapsed * 0.24;
    halo.position.y = Number(halo.userData.baseY) + Math.sin(elapsed * 1.35) * 0.035;
  }

  for (let index = 0; index < 3; index += 1) {
    const cloud = object.getObjectByName(`CelestialCloud-${index}`);
    if (!cloud) continue;
    cloud.position.y = Number(cloud.userData.baseY) + Math.sin(elapsed * 0.62 + Number(cloud.userData.phase)) * 0.035;
    cloud.position.x = Number(cloud.userData.baseX) + Math.sin(elapsed * 0.41 + index) * 0.018;
  }

  for (let index = 0; index < 11; index += 1) {
    const mote = object.getObjectByName(`CelestialMote-${index}`);
    if (!mote) continue;
    const phase = Number(mote.userData.phase);
    const travel = (phase + elapsed * 0.085) % 1;
    mote.position.y = 0.31 + travel * 2.28;
    mote.position.x = Number(mote.userData.baseX) + Math.sin(elapsed * 1.2 + index * 0.73) * 0.025;
    mote.scale.setScalar(0.7 + Math.sin(elapsed * 2.1 + index) * 0.22);
  }

  for (let index = 0; index < 7; index += 1) {
    const ember = object.getObjectByName(`InfernalEmber-${index}`);
    if (!ember) continue;
    const phase = Number(ember.userData.phase);
    const travel = (phase + elapsed * 0.14) % 1;
    ember.position.y = 0.31 + travel * 2.24;
    ember.position.x = Number(ember.userData.baseX) + Math.sin(elapsed * 2.4 + index * 1.17) * 0.045;
    ember.rotation.z = elapsed * (0.55 + index * 0.06);
    ember.scale.setScalar(0.55 + (1 - travel) * 0.75);
  }

  for (let index = 0; index < 6; index += 1) {
    const flame = object.getObjectByName(`InfernalFlame-${index}`);
    if (!flame) continue;
    const phase = Number(flame.userData.phase);
    flame.position.y = Number(flame.userData.baseY) + Math.sin(elapsed * 3.8 + phase) * 0.035;
    flame.scale.set(
      0.88 + Math.sin(elapsed * 3.1 + phase) * 0.12,
      0.85 + Math.sin(elapsed * 4.3 + phase) * 0.2,
      1,
    );
  }

  const heavenSurface = object.getObjectByName('HeavenPortalSurface') as THREE.Mesh | undefined;
  const hellSurface = object.getObjectByName('HellPortalSurface') as THREE.Mesh | undefined;
  const heavenMaterial = heavenSurface?.material as THREE.MeshStandardMaterial | undefined;
  const hellMaterial = hellSurface?.material as THREE.MeshStandardMaterial | undefined;
  if (heavenMaterial) {
    heavenMaterial.emissiveIntensity = (selectedIndex === 0 ? 1.25 : 0.42) + Math.sin(elapsed * 1.7) * 0.08;
  }
  if (hellMaterial) {
    hellMaterial.emissiveIntensity = (selectedIndex === 1 ? 1.35 : 0.4) + Math.sin(elapsed * 2.15 + 1.1) * 0.1;
  }

  const heavenLight = object.getObjectByName('HeavenPortalLight') as THREE.PointLight | undefined;
  const hellLight = object.getObjectByName('HellPortalLight') as THREE.PointLight | undefined;
  if (heavenLight) heavenLight.intensity = (selectedIndex === 0 ? 1.1 : 0.3) + selectedWave * 0.16;
  if (hellLight) hellLight.intensity = (selectedIndex === 1 ? 1.05 : 0.28) + selectedWave * 0.16;
}

export function interactLobbyProp(object: THREE.Object3D): void {
  const currentSequence = Number(object.userData.portalSequence);
  const nextSequence = (Number.isFinite(currentSequence) ? Math.max(0, Math.trunc(currentSequence)) : 0) + 1;
  applyDestination(object, nextSequence);
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number; ageSeconds: number },
): void {
  applyDestination(object, interaction.sequence, interaction.ageSeconds);
}
