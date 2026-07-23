import * as THREE from 'three';
import type { LobbyPhysicsDescriptor } from '../types';

export const code = 'trump-tower-residences';

export const physics = {
  body: 'fixed',
  mass: 0,
  friction: 1.08,
  restitution: 0.02,
  colliders: [
    { shape: 'box', halfExtents: [3, 0.12, 2.55], position: [0, 2.6, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [3, 0.12, 2.55], position: [0, 5.2, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.12, 3.9, 2.55], position: [-2.88, 3.9, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.12, 3.9, 2.55], position: [2.88, 3.9, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [3, 3.9, 0.12], position: [0, 3.9, -2.5], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.94, 3.9, 0.12], position: [-2.04, 3.9, 2.5], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.94, 3.9, 0.12], position: [2.04, 3.9, 2.5], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [2.7, 1.13, 0.1], position: [0, 1.25, 0.75], rotation: [0, 0, 0] },
  ],
} satisfies LobbyPhysicsDescriptor;

type Vec3 = readonly [number, number, number];

function addMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
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
  size: Vec3,
  position: Vec3,
  material: THREE.Material,
  rotation: Vec3 = [0, 0, 0],
  shadows = true,
): THREE.Mesh {
  return addMesh(parent, name, new THREE.BoxGeometry(...size), material, position, rotation, shadows);
}

function addCylinder(
  parent: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  segments = 16,
): THREE.Mesh {
  return addMesh(parent, name, new THREE.CylinderGeometry(radius, radius, height, segments), material, position);
}

function addStroke(
  parent: THREE.Object3D,
  name: string,
  width: number,
  x: number,
  y: number,
  angle: number,
  material: THREE.Material,
): void {
  addBox(parent, name, [width, 0.075, 0.045], [x, y, 0], material, [0, 0, angle], false);
}

function addTrumpSign(root: THREE.Object3D, gold: THREE.Material): void {
  const sign = new THREE.Group();
  sign.name = 'TrumpTowerSign';
  sign.position.set(-1.18, 2.23, 2.64);
  const dx = 0.48;
  addStroke(sign, 'TrumpTTop', 0.36, 0, 0.18, 0, gold);
  addStroke(sign, 'TrumpTStem', 0.34, 0, 0.01, Math.PI / 2, gold);
  addStroke(sign, 'TrumpRStem', 0.42, dx, 0, Math.PI / 2, gold);
  addStroke(sign, 'TrumpRTop', 0.32, dx + 0.14, 0.19, 0, gold);
  addStroke(sign, 'TrumpRMid', 0.28, dx + 0.13, 0.02, 0, gold);
  addStroke(sign, 'TrumpRShoulder', 0.18, dx + 0.28, 0.11, Math.PI / 2, gold);
  addStroke(sign, 'TrumpRLeg', 0.3, dx + 0.18, -0.13, -0.9, gold);
  addStroke(sign, 'TrumpULeft', 0.4, dx * 2, 0.02, Math.PI / 2, gold);
  addStroke(sign, 'TrumpURight', 0.4, dx * 2 + 0.3, 0.02, Math.PI / 2, gold);
  addStroke(sign, 'TrumpUBottom', 0.3, dx * 2 + 0.15, -0.18, 0, gold);
  addStroke(sign, 'TrumpMLeft', 0.42, dx * 3 + 0.02, 0, Math.PI / 2, gold);
  addStroke(sign, 'TrumpMRight', 0.42, dx * 3 + 0.38, 0, Math.PI / 2, gold);
  addStroke(sign, 'TrumpMInnerA', 0.25, dx * 3 + 0.12, 0.1, -0.9, gold);
  addStroke(sign, 'TrumpMInnerB', 0.25, dx * 3 + 0.28, 0.1, 0.9, gold);
  addStroke(sign, 'TrumpPStem', 0.42, dx * 4 + 0.02, 0, Math.PI / 2, gold);
  addStroke(sign, 'TrumpPTop', 0.32, dx * 4 + 0.17, 0.19, 0, gold);
  addStroke(sign, 'TrumpPMid', 0.28, dx * 4 + 0.15, 0.02, 0, gold);
  addStroke(sign, 'TrumpPRight', 0.18, dx * 4 + 0.31, 0.11, Math.PI / 2, gold);
  root.add(sign);
}

function addFacade(
  root: THREE.Object3D,
  blackGlass: THREE.Material,
  gold: THREE.Material,
  stone: THREE.Material,
): void {
  addBox(root, 'TowerFloor35Slab', [5.95, 0.14, 5.05], [0, 0.07, 0], stone);
  addBox(root, 'TowerFloor52Slab', [5.95, 0.18, 5.05], [0, 2.6, 0], stone);
  addBox(root, 'TowerPenthouseSlab', [5.95, 0.18, 5.05], [0, 5.2, 0], stone);
  addBox(root, 'TowerRoof', [5.6, 0.16, 4.8], [0, 7.78, 0], blackGlass);
  addBox(root, 'TowerLeftGlassWall', [0.22, 7.65, 5.05], [-2.88, 3.88, 0], blackGlass);
  addBox(root, 'TowerRightGlassWall', [0.22, 7.65, 5.05], [2.88, 3.88, 0], blackGlass);
  addBox(root, 'TowerFrontLeftWing', [1.88, 7.65, 0.2], [-2.04, 3.88, 2.5], blackGlass);
  addBox(root, 'TowerFrontRightWing', [1.88, 7.65, 0.2], [2.04, 3.88, 2.5], blackGlass);
  addBox(root, 'TowerUpperEntryGlass', [2.18, 5.12, 0.16], [0, 5.2, 2.5], blackGlass);
  for (const x of [-2.73, -1.12, 1.12, 2.73]) {
    addBox(root, `FacadeGoldFin-${x}`, [0.055, 7.52, 0.07], [x, 3.88, 2.64], gold, [0, 0, 0], false);
  }
  for (const y of [2.58, 5.18, 7.7]) {
    addBox(root, `FacadeGoldBand-${y}`, [5.75, 0.055, 0.07], [0, y, 2.64], gold, [0, 0, 0], false);
  }
  const entrance = new THREE.Group();
  entrance.name = 'MainEntrance';
  entrance.position.set(0, 0, 2.56);
  addBox(entrance, 'EntranceLeftPost', [0.09, 2.38, 0.16], [-1.08, 1.19, 0], gold);
  addBox(entrance, 'EntranceRightPost', [0.09, 2.38, 0.16], [1.08, 1.19, 0], gold);
  addBox(entrance, 'EntranceHeader', [2.25, 0.09, 0.16], [0, 2.34, 0], gold);
  addBox(entrance, 'EntranceGlassLeft', [0.84, 2.22, 0.035], [-0.57, 1.15, 0.02], blackGlass, [0, 0.45, 0], false);
  addBox(entrance, 'EntranceGlassRight', [0.84, 2.22, 0.035], [0.57, 1.15, 0.02], blackGlass, [0, -0.45, 0], false);
  root.add(entrance);
  addTrumpSign(root, gold);
}

function addCityView(
  parent: THREE.Object3D,
  baseY: number,
  prefix: string,
  skyColor: THREE.ColorRepresentation,
  waterColor: THREE.ColorRepresentation,
  buildingColor: THREE.ColorRepresentation,
  lightColor: THREE.ColorRepresentation,
): void {
  const view = new THREE.Group();
  view.name = `${prefix}ManhattanView`;
  const sky = new THREE.MeshBasicMaterial({ color: skyColor, toneMapped: false });
  const water = new THREE.MeshStandardMaterial({ color: waterColor, roughness: 0.24, metalness: 0.18 });
  const city = new THREE.MeshStandardMaterial({ color: buildingColor, roughness: 0.58, metalness: 0.12 });
  const lights = new THREE.MeshBasicMaterial({ color: lightColor, toneMapped: false });
  addBox(view, `${prefix}Sky`, [5.5, 2.28, 0.03], [0, baseY + 1.36, -2.7], sky, [0, 0, 0], false);
  addBox(view, `${prefix}Hudson`, [5.5, 0.34, 0.05], [0, baseY + 0.28, -2.66], water, [0, 0, 0], false);
  const heights = [0.72, 1.12, 0.88, 1.48, 0.96, 1.26, 0.82, 1.06, 0.66] as const;
  for (const [index, height] of heights.entries()) {
    const x = -2.45 + index * 0.61;
    addBox(view, `${prefix}Midtown-${index}`, [0.42, height, 0.12], [x, baseY + 0.34 + height * 0.5, -2.61], city, [0, 0, 0], false);
    addBox(view, `${prefix}WindowLight-${index}`, [0.24, 0.045, 0.025], [x, baseY + 0.54 + (index % 3) * 0.18, -2.535], lights, [0, 0, 0], false);
  }
  addBox(view, `${prefix}EmpireBase`, [0.38, 1.62, 0.14], [0.45, baseY + 1.12, -2.56], city, [0, 0, 0], false);
  addBox(view, `${prefix}EmpireCrown`, [0.23, 0.3, 0.12], [0.45, baseY + 2.07, -2.56], city, [0, 0, 0], false);
  addBox(view, `${prefix}EmpireSpire`, [0.045, 0.38, 0.045], [0.45, baseY + 2.39, -2.55], lights, [0, 0, 0], false);
  parent.add(view);
}

function addSofa(
  parent: THREE.Object3D,
  name: string,
  baseY: number,
  z: number,
  fabric: THREE.Material,
  trim: THREE.Material,
): void {
  addBox(parent, `${name}Seat`, [2.05, 0.32, 0.72], [-0.65, baseY + 0.38, z], fabric);
  addBox(parent, `${name}Back`, [2.05, 0.72, 0.22], [-0.65, baseY + 0.74, z - 0.28], fabric);
  addBox(parent, `${name}LeftArm`, [0.2, 0.5, 0.72], [-1.58, baseY + 0.54, z], trim);
  addBox(parent, `${name}RightArm`, [0.2, 0.5, 0.72], [0.28, baseY + 0.54, z], trim);
  addBox(parent, `${name}CoffeeTable`, [1.15, 0.09, 0.6], [1.35, baseY + 0.38, z - 0.08], trim);
  addCylinder(parent, `${name}CoffeeStem`, 0.055, 0.32, [1.35, baseY + 0.18, z - 0.08], trim, 12);
}

function addApartment(
  root: THREE.Object3D,
  name: string,
  baseY: number,
  floorMaterial: THREE.Material,
  fabric: THREE.Material,
  trim: THREE.Material,
  skyColor: THREE.ColorRepresentation,
  waterColor: THREE.ColorRepresentation,
  cityColor: THREE.ColorRepresentation,
  lightColor: THREE.ColorRepresentation,
): void {
  const apartment = new THREE.Group();
  apartment.name = name;
  addBox(apartment, `${name}Floor`, [5.5, 0.05, 4.75], [0, baseY + 0.13, 0], floorMaterial, [0, 0, 0], false);
  addCityView(apartment, baseY, name, skyColor, waterColor, cityColor, lightColor);
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#a8cbd2', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.08,
    transmission: 0.22, depthWrite: false,
  });
  addBox(apartment, `${name}PanoramicWindow`, [5.48, 2.3, 0.035], [0, baseY + 1.37, -2.42], glass, [0, 0, 0], false);
  for (const x of [-1.84, -0.92, 0, 0.92, 1.84]) {
    addBox(apartment, `${name}WindowMullion-${x}`, [0.035, 2.35, 0.055], [x, baseY + 1.38, -2.39], trim, [0, 0, 0], false);
  }
  addSofa(apartment, `${name}Lounge`, baseY, 0.35, fabric, trim);
  addBox(apartment, `${name}DiningTop`, [1.45, 0.09, 0.78], [1.65, baseY + 0.73, 0.65], trim);
  for (const x of [1.1, 2.2]) {
    addCylinder(apartment, `${name}DiningLeg-${x}`, 0.045, 0.62, [x, baseY + 0.39, 0.65], trim, 10);
  }
  addBox(apartment, `${name}BedPlatform`, [2.15, 0.22, 1.22], [-1.42, baseY + 0.28, -1.18], trim);
  addBox(apartment, `${name}Bed`, [1.95, 0.28, 1.05], [-1.42, baseY + 0.48, -1.18], fabric);
  addBox(apartment, `${name}KitchenIsland`, [1.65, 0.76, 0.58], [1.6, baseY + 0.49, -1.3], floorMaterial);
  const chandelier = new THREE.Group();
  chandelier.name = `${name}Chandelier`;
  chandelier.userData.baseY = baseY + 2.18;
  chandelier.userData.phase = baseY;
  chandelier.position.set(0.35, baseY + 2.18, 0.1);
  addCylinder(chandelier, `${name}ChandelierStem`, 0.025, 0.38, [0, 0, 0], trim, 10);
  for (const x of [-0.28, 0, 0.28]) {
    addMesh(chandelier, `${name}ChandelierCrystal-${x}`, new THREE.OctahedronGeometry(0.1), trim, [x, -0.22 - Math.abs(x) * 0.2, 0], [0, 0, 0], false);
  }
  apartment.add(chandelier);
  root.add(apartment);
}

function addLobby(
  root: THREE.Object3D,
  marble: THREE.Material,
  gold: THREE.Material,
  wood: THREE.Material,
  indicatorOff: THREE.Material,
): void {
  const lobby = new THREE.Group();
  lobby.name = 'LobbyInterior';
  addBox(lobby, 'LobbyMarbleRunner', [2.1, 0.04, 2.2], [0, 0.15, 1.3], marble, [0, 0, 0], false);
  addBox(lobby, 'LobbyReceptionDesk', [1.55, 0.82, 0.5], [-1.55, 0.55, 1.25], wood);
  addBox(lobby, 'LobbyReceptionGoldTop', [1.62, 0.07, 0.56], [-1.55, 0.99, 1.25], gold);
  addBox(lobby, 'LobbyPrivateResidenceWall', [5.4, 2.3, 0.14], [0, 1.25, 0.75], marble);
  addBox(lobby, 'LobbyPrivateResidenceGoldBand', [5.4, 0.08, 0.08], [0, 2.36, 0.85], gold, [0, 0, 0], false);
  for (const x of [-2.25, 2.25]) {
    addBox(lobby, `LobbyWallGoldInlay-${x}`, [0.07, 2.1, 0.08], [x, 1.25, 0.85], gold, [0, 0, 0], false);
  }
  for (const x of [-2.55, 2.55]) {
    addCylinder(lobby, `LobbyGoldColumn-${x}`, 0.13, 2.35, [x, 1.27, 1.52], gold, 18);
  }
  const elevator = new THREE.Group();
  elevator.name = 'ElevatorBank';
  elevator.position.set(0, 0.1, 0.85);
  addBox(elevator, 'ElevatorSurround', [1.25, 2.25, 0.14], [0, 1.17, 0], wood);
  const doorMaterial = new THREE.MeshStandardMaterial({ color: '#b28a37', roughness: 0.22, metalness: 0.84 });
  addBox(elevator, 'ElevatorDoorLeft', [0.55, 1.9, 0.055], [-0.29, 1.08, 0.1], doorMaterial);
  addBox(elevator, 'ElevatorDoorRight', [0.55, 1.9, 0.055], [0.29, 1.08, 0.1], doorMaterial);
  const labels = ['Lobby', '35F', '52F', 'PH'] as const;
  for (const [index, label] of labels.entries()) {
    const lamp = addBox(
      elevator,
      `FloorIndicator-${label}`,
      [0.2, 0.12, 0.035],
      [-0.38 + index * 0.25, 2.12, 0.12],
      indicatorOff.clone(),
      [0, 0, 0],
      false,
    );
    lamp.userData.floorLabel = label;
  }
  lobby.add(elevator);
  root.add(lobby);
}

function floorForSequence(sequence: number): 'Lobby' | '35F' | '52F' | 'PH' {
  const safe = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0;
  if (safe === 0) return 'Lobby';
  return (['35F', '52F', 'PH', 'Lobby'] as const).at((safe - 1) % 4) ?? 'Lobby';
}

function nextFloorForSequence(sequence: number): 'Lobby' | '35F' | '52F' | 'PH' {
  const safe = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0;
  return (['35F', '52F', 'PH', 'Lobby'] as const).at(safe % 4) ?? '35F';
}

function applyFloorState(object: THREE.Object3D, sequence: number, ageSeconds: number, elapsed: number): void {
  const safe = Number.isFinite(sequence) ? Math.max(0, Math.trunc(sequence)) : 0;
  const selectedFloor = floorForSequence(safe);
  const nextFloor = nextFloorForSequence(safe);
  object.userData.interactionSequence = safe;
  object.userData.selectedFloor = selectedFloor;
  object.userData.interactionState = `floor:${selectedFloor.toLowerCase()}`;
  object.userData.prompt = `电梯 · 当前 ${selectedFloor} · 按 E 前往 ${nextFloor}`;
  object.userData.transitionStartElapsed = Math.max(0, elapsed - Math.max(0, ageSeconds));
  for (const label of ['Lobby', '35F', '52F', 'PH']) {
    const lamp = object.getObjectByName(`FloorIndicator-${label}`) as THREE.Mesh | undefined;
    const material = lamp?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) continue;
    const active = label === selectedFloor;
    material.color.set(active ? '#ffd56b' : '#48391e');
    material.emissive.set(active ? '#d99b28' : '#120d05');
    material.emissiveIntensity = active ? 2.8 : 0.15;
  }
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'TrumpTowerResidences';
  const blackGlass = new THREE.MeshPhysicalMaterial({
    color: '#101a1b', roughness: 0.12, metalness: 0.62, clearcoat: 0.82,
    clearcoatRoughness: 0.12, transparent: true, opacity: 0.9,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: '#c99b3d', emissive: '#4c2b08', emissiveIntensity: 0.3,
    roughness: 0.22, metalness: 0.86,
  });
  const marble = new THREE.MeshPhysicalMaterial({
    color: '#eee5d2', roughness: 0.24, metalness: 0.05, clearcoat: 0.38,
  });
  const walnut = new THREE.MeshStandardMaterial({ color: '#3a1e12', roughness: 0.5, metalness: 0.08 });
  const cream = new THREE.MeshStandardMaterial({ color: '#e7dbc4', roughness: 0.86, metalness: 0.02 });
  const champagne = new THREE.MeshStandardMaterial({ color: '#c7a56b', roughness: 0.38, metalness: 0.42 });
  const cognac = new THREE.MeshStandardMaterial({ color: '#8a4f2e', roughness: 0.72, metalness: 0.02 });
  const graphite = new THREE.MeshStandardMaterial({ color: '#202326', roughness: 0.42, metalness: 0.54 });
  const velvet = new THREE.MeshStandardMaterial({ color: '#272028', roughness: 0.78, metalness: 0.02 });
  const indicator = new THREE.MeshStandardMaterial({
    color: '#48391e', emissive: '#120d05', emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.55,
  });

  addFacade(root, blackGlass, gold, marble);
  addLobby(root, marble, gold, walnut, indicator);
  addApartment(root, 'Floor35Apartment', 0, marble, cream, champagne, '#a9d8e7', '#487d8a', '#536873', '#ffe19b');
  addApartment(root, 'Floor52Apartment', 2.6, marble, cognac, gold, '#e79a68', '#775058', '#403d48', '#ffc264');
  addApartment(root, 'PenthouseApartment', 5.2, graphite, velvet, gold, '#10182d', '#14293b', '#151820', '#ffd26f');

  const lobbyLight = new THREE.PointLight('#ffd99a', 2.2, 7, 2);
  lobbyLight.name = 'LobbyWarmLight';
  lobbyLight.position.set(0, 2.2, 1.2);
  root.add(lobbyLight);
  for (const [index, y] of [1.55, 4.15, 6.75].entries()) {
    const light = new THREE.PointLight(index === 2 ? '#ffd08a' : '#ffe3b1', 1.25, 5.4, 2);
    light.name = `ResidenceLight-${index}`;
    light.position.set(0, y, -0.2);
    root.add(light);
  }

  root.userData.interactionSequence = 0;
  root.userData.selectedFloor = 'Lobby';
  root.userData.transitionStartElapsed = 0;
  root.userData.interactionCenterAtEyeLevel = true;
  applyFloorState(root, 0, 1, 0);
  return root;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const start = Number(object.userData.transitionStartElapsed);
  const age = Number.isFinite(start) ? Math.max(0, elapsed - start) : 1;
  const doorOpen = age < 0.9 ? Math.sin(Math.min(1, age / 0.9) * Math.PI) : 0;
  const leftDoor = object.getObjectByName('ElevatorDoorLeft');
  const rightDoor = object.getObjectByName('ElevatorDoorRight');
  if (leftDoor) leftDoor.position.x = -0.29 - doorOpen * 0.28;
  if (rightDoor) rightDoor.position.x = 0.29 + doorOpen * 0.28;
  for (const name of ['Floor35ApartmentChandelier', 'Floor52ApartmentChandelier', 'PenthouseApartmentChandelier']) {
    const chandelier = object.getObjectByName(name);
    if (!chandelier) continue;
    const baseY = Number(chandelier.userData.baseY);
    const phase = Number(chandelier.userData.phase);
    if (Number.isFinite(baseY)) chandelier.position.y = baseY + Math.sin(elapsed * 0.8 + phase) * 0.018;
    chandelier.rotation.y = Math.sin(elapsed * 0.34 + phase) * 0.08;
  }
  for (let index = 0; index < 9; index += 1) {
    for (const prefix of ['Floor35Apartment', 'Floor52Apartment', 'PenthouseApartment']) {
      const light = object.getObjectByName(`${prefix}WindowLight-${index}`) as THREE.Mesh | undefined;
      const material = light?.material as THREE.MeshBasicMaterial | undefined;
      if (material) material.opacity = 0.72 + Math.sin(elapsed * 1.3 + index * 0.61) * 0.18;
    }
  }
}

export function interactLobbyProp(object: THREE.Object3D): void {
  const current = Number(object.userData.interactionSequence);
  const next = (Number.isFinite(current) ? Math.max(0, Math.trunc(current)) : 0) + 1;
  applyFloorState(object, next, 0, 0);
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number; ageSeconds: number },
  elapsed = 0,
): void {
  applyFloorState(object, interaction.sequence, interaction.ageSeconds, elapsed);
}
