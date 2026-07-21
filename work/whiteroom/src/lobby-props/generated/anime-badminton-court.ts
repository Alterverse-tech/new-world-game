import * as THREE from 'three';

export const code = 'anime-badminton-court';

const palette = {
  ink: '#25335f',
  cyan: '#61e4f2',
  cyanDark: '#2399b8',
  pink: '#ff72b6',
  cream: '#fff8dc',
  white: '#ffffff',
  court: '#65d4c2',
  courtDark: '#3aa991',
  skin: '#ffd4bd',
  hair: '#5548a8',
  sole: '#f3f7ff',
};

function standardMaterial(color, roughness = 0.62, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh(parent, geometry, material, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBox(parent, name, width, height, depth, x, y, z, material) {
  const mesh = addMesh(
    parent,
    new THREE.BoxGeometry(width, height, depth),
    material,
    name,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function addCylinder(parent, name, radiusTop, radiusBottom, height, x, y, z, material, segments = 16) {
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    name,
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function addLimb(parent, name, start, end, radius, material) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = endPoint.clone().sub(startPoint);
  const length = direction.length();
  const mesh = addMesh(
    parent,
    new THREE.CylinderGeometry(radius, radius * 0.92, length, 12),
    material,
    name,
  );
  mesh.position.copy(startPoint).add(endPoint).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

function addCourt(root) {
  const baseMaterial = standardMaterial(palette.ink, 0.75);
  const courtMaterial = standardMaterial(palette.court, 0.68);
  const borderMaterial = standardMaterial(palette.courtDark, 0.72);
  const lineMaterial = standardMaterial(palette.cream, 0.52);

  addBox(root, 'CourtShadowBase', 6.2, 0.12, 10.4, 0, 0.06, 0, baseMaterial);
  addBox(root, 'CourtBorder', 5.8, 0.08, 10, 0, 0.14, 0, borderMaterial);
  addBox(root, 'CourtSurface', 5.4, 0.055, 9.6, 0, 0.205, 0, courtMaterial);

  const lineY = 0.245;
  const lineHeight = 0.028;
  const lineThickness = 0.065;
  const lines = [
    [5.4, lineHeight, lineThickness, 0, lineY, -4.8],
    [5.4, lineHeight, lineThickness, 0, lineY, 4.8],
    [lineThickness, lineHeight, 9.6, -2.7, lineY, 0],
    [lineThickness, lineHeight, 9.6, 2.7, lineY, 0],
    [lineThickness, lineHeight, 9.6, -2.28, lineY, 0],
    [lineThickness, lineHeight, 9.6, 2.28, lineY, 0],
    [5.4, lineHeight, lineThickness, 0, lineY, -1.58],
    [5.4, lineHeight, lineThickness, 0, lineY, 1.58],
    [5.4, lineHeight, lineThickness, 0, lineY, -3.95],
    [5.4, lineHeight, lineThickness, 0, lineY, 3.95],
    [lineThickness, lineHeight, 3.22, 0, lineY, -3.19],
    [lineThickness, lineHeight, 3.22, 0, lineY, 3.19],
  ];
  for (const [width, height, depth, x, y, z] of lines) {
    addBox(root, 'CourtLine', width, height, depth, x, y, z, lineMaterial);
  }

  const accentMaterial = standardMaterial(palette.pink, 0.48);
  const cornerDots = [
    [-2.48, -4.55],
    [2.48, -4.55],
    [-2.48, 4.55],
    [2.48, 4.55],
  ];
  for (const [x, z] of cornerDots) {
    const dot = addCylinder(root, 'AnimeCornerAccent', 0.12, 0.12, 0.035, x, 0.265, z, accentMaterial, 20);
    dot.scale.z = 0.55;
  }
}

function addNet(root) {
  const poleMaterial = standardMaterial(palette.pink, 0.34, 0.12);
  const netMaterial = standardMaterial(palette.white, 0.64);
  const tapeMaterial = standardMaterial(palette.cream, 0.48);

  addCylinder(root, 'NetPoleLeft', 0.07, 0.09, 1.86, -2.86, 1.12, 0, poleMaterial, 18);
  addCylinder(root, 'NetPoleRight', 0.07, 0.09, 1.86, 2.86, 1.12, 0, poleMaterial, 18);
  addCylinder(root, 'NetFootLeft', 0.18, 0.22, 0.13, -2.86, 0.29, 0, poleMaterial, 18);
  addCylinder(root, 'NetFootRight', 0.18, 0.22, 0.13, 2.86, 0.29, 0, poleMaterial, 18);

  const verticalStrings = [-2.6, -2.16, -1.72, -1.28, -0.84, -0.42, 0, 0.42, 0.84, 1.28, 1.72, 2.16, 2.6];
  for (const x of verticalStrings) {
    addBox(root, 'NetVerticalString', 0.014, 1.22, 0.018, x, 1.19, 0, netMaterial);
  }
  const horizontalStrings = [0.6, 0.84, 1.08, 1.32, 1.56, 1.8];
  for (const y of horizontalStrings) {
    addBox(root, 'NetHorizontalString', 5.2, 0.014, 0.018, 0, y, 0, netMaterial);
  }
  addBox(root, 'NetTopTape', 5.38, 0.075, 0.055, 0, 1.84, 0, tapeMaterial);
}

function addPlayer(root) {
  const player = new THREE.Group();
  player.name = 'AnimeBadmintonPlayer';
  player.position.set(-0.72, 0.26, -2.55);
  player.rotation.y = -0.18;
  root.add(player);

  const skinMaterial = standardMaterial(palette.skin, 0.66);
  const hairMaterial = standardMaterial(palette.hair, 0.48);
  const shirtMaterial = standardMaterial(palette.cyan, 0.5);
  const shortsMaterial = standardMaterial(palette.ink, 0.58);
  const shoeMaterial = standardMaterial(palette.sole, 0.52);
  const eyeMaterial = standardMaterial(palette.ink, 0.45);
  const racketMaterial = standardMaterial(palette.pink, 0.34, 0.18);
  const stringMaterial = standardMaterial(palette.cream, 0.64);

  const shadow = addCylinder(player, 'PlayerShadow', 0.5, 0.5, 0.018, 0.03, 0.018, 0.03, standardMaterial('#22304f', 0.9), 24);
  shadow.scale.z = 0.45;

  addLimb(player, 'LeftLeg', [-0.17, 0.72, 0], [-0.42, 0.13, 0.18], 0.095, skinMaterial);
  addLimb(player, 'RightLeg', [0.17, 0.72, 0], [0.45, 0.2, -0.24], 0.095, skinMaterial);
  const leftShoe = addBox(player, 'LeftShoe', 0.25, 0.13, 0.42, -0.43, 0.09, 0.26, shoeMaterial);
  leftShoe.rotation.y = -0.22;
  const rightShoe = addBox(player, 'RightShoe', 0.25, 0.13, 0.42, 0.5, 0.15, -0.33, shoeMaterial);
  rightShoe.rotation.y = 0.24;

  const shorts = addMesh(player, new THREE.CylinderGeometry(0.28, 0.34, 0.38, 6), shortsMaterial, 'PlayerShorts');
  shorts.position.set(0, 0.82, 0);
  const torso = addMesh(player, new THREE.CylinderGeometry(0.25, 0.31, 0.63, 8), shirtMaterial, 'AnimeAccent');
  torso.position.set(0, 1.28, 0);
  torso.rotation.z = -0.1;
  addBox(player, 'ShirtStripe', 0.56, 0.08, 0.025, 0.02, 1.34, -0.265, stringMaterial);

  addLimb(player, 'LeftUpperArm', [-0.23, 1.48, 0], [-0.66, 1.35, -0.16], 0.07, skinMaterial);
  addLimb(player, 'LeftForearm', [-0.66, 1.35, -0.16], [-0.9, 1.63, -0.34], 0.062, skinMaterial);
  addLimb(player, 'RightUpperArm', [0.22, 1.5, 0], [0.43, 1.95, -0.08], 0.071, skinMaterial);
  addLimb(player, 'RightForearm', [0.43, 1.95, -0.08], [0.66, 2.28, -0.18], 0.061, skinMaterial);
  addMesh(player, new THREE.SphereGeometry(0.08, 14, 10), skinMaterial, 'RacketHand').position.set(0.67, 2.3, -0.18);

  const neck = addCylinder(player, 'PlayerNeck', 0.075, 0.08, 0.16, -0.02, 1.67, 0, skinMaterial, 12);
  neck.rotation.z = -0.1;
  const head = addMesh(player, new THREE.SphereGeometry(0.24, 20, 14), skinMaterial, 'AnimeHead');
  head.position.set(-0.06, 1.93, -0.02);
  head.scale.set(0.94, 1.08, 0.92);
  const hairCap = addMesh(player, new THREE.SphereGeometry(0.248, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMaterial, 'AnimeHair');
  hairCap.position.set(-0.06, 1.99, -0.01);
  hairCap.rotation.x = -0.08;
  const hairSpikes = [
    [-0.22, 1.88, 0.05, -0.24],
    [-0.13, 1.85, 0.11, -0.08],
    [-0.02, 1.85, 0.13, 0.1],
    [0.08, 1.87, 0.08, 0.24],
  ];
  for (const [x, y, z, rotationZ] of hairSpikes) {
    const spike = addMesh(player, new THREE.ConeGeometry(0.075, 0.28, 8), hairMaterial, 'AnimeHairSpike');
    spike.position.set(x, y, z);
    spike.rotation.z = rotationZ;
  }
  const leftEye = addMesh(player, new THREE.SphereGeometry(0.026, 10, 8), eyeMaterial, 'AnimeEyeLeft');
  leftEye.position.set(-0.145, 1.96, -0.222);
  leftEye.scale.y = 1.35;
  const rightEye = addMesh(player, new THREE.SphereGeometry(0.026, 10, 8), eyeMaterial, 'AnimeEyeRight');
  rightEye.position.set(0.015, 1.96, -0.226);
  rightEye.scale.y = 1.35;
  const cheekMaterial = new THREE.MeshBasicMaterial({ color: palette.pink, transparent: true, opacity: 0.62 });
  const cheek = addMesh(player, new THREE.CircleGeometry(0.04, 12), cheekMaterial, 'AnimeCheek');
  cheek.position.set(0.09, 1.9, -0.222);

  addLimb(player, 'RacketHandle', [0.66, 2.28, -0.18], [0.91, 2.58, -0.28], 0.033, racketMaterial);
  const racket = addMesh(player, new THREE.TorusGeometry(0.31, 0.025, 8, 28), racketMaterial, 'AnimeRacket');
  racket.position.set(1.08, 2.78, -0.35);
  racket.rotation.set(-0.15, -0.5, -0.55);
  racket.scale.y = 1.25;
  const racketStrings = new THREE.Group();
  racketStrings.name = 'RacketStrings';
  racketStrings.position.copy(racket.position);
  racketStrings.rotation.copy(racket.rotation);
  racketStrings.scale.y = 1.25;
  player.add(racketStrings);
  const stringOffsets = [-0.18, -0.09, 0, 0.09, 0.18];
  for (const offset of stringOffsets) {
    addBox(racketStrings, 'RacketStringVertical', 0.012, 0.51, 0.012, offset, 0, 0, stringMaterial);
    addBox(racketStrings, 'RacketStringHorizontal', 0.51, 0.012, 0.012, 0, offset, 0, stringMaterial);
  }
}

function addShuttleAndEffects(root) {
  const shuttle = new THREE.Group();
  shuttle.name = 'AnimeShuttle';
  shuttle.position.set(0.66, 2.44, -1.05);
  shuttle.rotation.set(0.18, 0.2, -0.72);
  root.add(shuttle);

  const corkMaterial = standardMaterial(palette.cream, 0.72);
  const featherMaterial = standardMaterial(palette.white, 0.6);
  addMesh(shuttle, new THREE.SphereGeometry(0.075, 14, 10), corkMaterial, 'ShuttleCork').position.y = -0.14;
  const skirt = addMesh(shuttle, new THREE.ConeGeometry(0.18, 0.34, 10, 1, true), featherMaterial, 'ShuttleFeathers');
  skirt.position.y = 0.07;

  const sparkles = new THREE.Group();
  sparkles.name = 'AnimeImpactSparkles';
  sparkles.position.set(0.55, 2.45, -1.04);
  root.add(sparkles);
  const sparkleMaterial = new THREE.MeshBasicMaterial({ color: palette.pink, toneMapped: false });
  const rays = [
    [0.34, 0.02, 0.02, 0.15, 0.18, 0],
    [0.28, 0.02, 0.02, -0.2, 0.25, 0.65],
    [0.25, 0.02, 0.02, -0.27, -0.18, -0.65],
    [0.2, 0.02, 0.02, 0.12, -0.3, 1.2],
  ];
  for (const [width, height, depth, x, y, rotationZ] of rays) {
    const ray = addBox(sparkles, 'AnimeImpactRay', width, height, depth, x, y, 0, sparkleMaterial);
    ray.rotation.z = rotationZ;
  }
}

export function createLobbyProp() {
  const root = new THREE.Group();
  root.name = 'AnimeBadmintonCourtRoot';
  addCourt(root);
  addNet(root);
  addPlayer(root);
  addShuttleAndEffects(root);
  return root;
}

export function updateLobbyProp(object, elapsed) {
  const shuttle = object.getObjectByName('AnimeShuttle');
  if (shuttle) {
    shuttle.position.y = 2.44 + Math.sin(elapsed * 2.4) * 0.055;
    shuttle.rotation.y = elapsed * 0.75;
  }
  const sparkles = object.getObjectByName('AnimeImpactSparkles');
  if (sparkles) {
    sparkles.rotation.z = Math.sin(elapsed * 3.2) * 0.12;
    const pulse = 0.92 + Math.sin(elapsed * 4.8) * 0.08;
    sparkles.scale.setScalar(pulse);
  }
}
