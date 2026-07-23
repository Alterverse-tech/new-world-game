import * as THREE from 'three';

export const code = 'spacex-starship';

const IGNITION_END = 1.15;
const ASCENT_END = 4.9;
const COAST_END = 6.0;
const FLIP_END = 7.25;
const DESCENT_END = 11.35;
const LANDING_END = 12.9;
const RECOVERY_END = 14.1;
const MAX_ALTITUDE = 4.55;

function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function addShadowedMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'SpaceXStarshipProp';
  root.userData.active = false;
  root.userData.interactionState = 'idle';
  root.userData.lastElapsed = 0;
  root.userData.launchStartedAt = 0;
  root.userData.missionElapsed = 0;
  root.userData.altitude = 0;
  root.userData.launchCount = 0;

  const stainless = new THREE.MeshStandardMaterial({
    color: '#d8dddc',
    metalness: 0.9,
    roughness: 0.22,
  });
  const brushedSteel = new THREE.MeshStandardMaterial({
    color: '#9ca6a5',
    metalness: 0.82,
    roughness: 0.34,
  });
  const heatShield = new THREE.MeshStandardMaterial({
    color: '#171b1c',
    metalness: 0.16,
    roughness: 0.78,
  });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: '#13262e',
    emissive: '#3e879a',
    emissiveIntensity: 0.22,
    metalness: 0.48,
    roughness: 0.2,
  });
  const padMaterial = new THREE.MeshStandardMaterial({
    color: '#343b3d',
    metalness: 0.68,
    roughness: 0.46,
  });
  const padRingMaterial = new THREE.MeshStandardMaterial({
    color: '#4e5b5c',
    emissive: '#13292b',
    emissiveIntensity: 0.35,
    metalness: 0.68,
    roughness: 0.36,
  });
  const signalMaterial = new THREE.MeshStandardMaterial({
    color: '#ffb25e',
    emissive: '#ff6a1a',
    emissiveIntensity: 0.75,
    roughness: 0.3,
  });

  const pad = addShadowedMesh(root, new THREE.CylinderGeometry(0.82, 0.94, 0.12, 12), padMaterial, 'StarshipLaunchPad');
  pad.position.y = 0.06;
  const padRing = addShadowedMesh(root, new THREE.TorusGeometry(0.68, 0.055, 8, 32), padRingMaterial, 'StarshipPadRing');
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = 0.135;

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const indicator = addShadowedMesh(
      root,
      new THREE.SphereGeometry(0.035, 8, 6),
      signalMaterial.clone(),
      `StarshipPadIndicator-${index}`,
    );
    indicator.position.set(Math.sin(angle) * 0.7, 0.16, Math.cos(angle) * 0.7);
  }

  const flightRig = new THREE.Group();
  flightRig.name = 'StarshipFlightRig';
  root.add(flightRig);

  const engineSkirt = addShadowedMesh(
    flightRig,
    new THREE.CylinderGeometry(0.31, 0.38, 0.38, 24),
    heatShield,
    'StarshipEngineSkirt',
  );
  engineSkirt.position.y = 0.38;

  const body = addShadowedMesh(
    flightRig,
    new THREE.CylinderGeometry(0.34, 0.34, 2.34, 32),
    stainless,
    'StarshipHull',
  );
  body.position.y = 1.61;

  const heatTiles = addShadowedMesh(
    flightRig,
    new THREE.CylinderGeometry(0.347, 0.347, 1.82, 24, 1, true, Math.PI / 2, Math.PI),
    heatShield,
    'StarshipHeatShield',
  );
  heatTiles.position.y = 1.33;

  const nose = addShadowedMesh(
    flightRig,
    new THREE.CylinderGeometry(0.025, 0.34, 0.7, 32),
    stainless,
    'StarshipNose',
  );
  nose.position.y = 3.13;

  const noseTiles = addShadowedMesh(
    flightRig,
    new THREE.CylinderGeometry(0.022, 0.347, 0.705, 24, 1, true, Math.PI / 2, Math.PI),
    heatShield,
    'StarshipNoseHeatShield',
  );
  noseTiles.position.y = 3.13;

  for (const [index, x] of [-0.14, 0, 0.14].entries()) {
    const viewport = addShadowedMesh(
      flightRig,
      new THREE.SphereGeometry(0.065, 12, 8),
      windowMaterial,
      `StarshipWindow-${index}`,
    );
    viewport.scale.set(0.82, 1, 0.24);
    viewport.position.set(x, 2.76, 0.324);
  }

  for (const side of [-1, 1]) {
    const forwardFlap = addShadowedMesh(
      flightRig,
      new THREE.BoxGeometry(0.32, 0.07, 0.26),
      heatShield,
      side < 0 ? 'StarshipForwardFlapLeft' : 'StarshipForwardFlapRight',
    );
    forwardFlap.position.set(side * 0.39, 2.55, 0.02);
    forwardFlap.rotation.z = side * -0.22;

    const aftFlap = addShadowedMesh(
      flightRig,
      new THREE.BoxGeometry(0.48, 0.1, 0.38),
      heatShield,
      side < 0 ? 'StarshipAftFlapLeft' : 'StarshipAftFlapRight',
    );
    aftFlap.position.set(side * 0.44, 0.72, 0.01);
    aftFlap.rotation.z = side * -0.17;
  }

  const engineOffsets: Array<[number, number]> = [[-0.13, 0.06], [0.13, 0.06], [0, -0.12]];
  for (const [index, [x, z]] of engineOffsets.entries()) {
    const bell = addShadowedMesh(
      flightRig,
      new THREE.CylinderGeometry(0.07, 0.105, 0.18, 12),
      brushedSteel,
      `StarshipEngine-${index}`,
    );
    bell.position.set(x, 0.16, z);

    const outerFlameMaterial = new THREE.MeshBasicMaterial({
      color: '#ff6a18',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const outerFlame = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.015, 0.66, 12, 1, true),
      outerFlameMaterial,
    );
    outerFlame.name = `StarshipFlameOuter-${index}`;
    outerFlame.position.set(x, -0.18, z);
    outerFlame.visible = false;
    flightRig.add(outerFlame);

    const innerFlameMaterial = new THREE.MeshBasicMaterial({
      color: '#e8fbff',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const innerFlame = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.012, 0.42, 10, 1, true),
      innerFlameMaterial,
    );
    innerFlame.name = `StarshipFlameInner-${index}`;
    innerFlame.position.set(x, -0.08, z);
    innerFlame.visible = false;
    flightRig.add(innerFlame);
  }

  const engineLight = new THREE.PointLight('#ff8a3d', 0, 5.2, 2);
  engineLight.name = 'StarshipEngineLight';
  engineLight.position.y = 0.05;
  flightRig.add(engineLight);

  const smokeGeometry = new THREE.SphereGeometry(0.12, 8, 6);
  for (let index = 0; index < 12; index += 1) {
    const smokeMaterial = new THREE.MeshStandardMaterial({
      color: index % 2 === 0 ? '#d8d4ca' : '#aaa9a3',
      transparent: true,
      opacity: 0,
      roughness: 1,
      depthWrite: false,
    });
    const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
    smoke.name = `StarshipSmoke-${index}`;
    smoke.visible = false;
    root.add(smoke);
  }

  return root;
}

function setEngineOutput(object: THREE.Object3D, amount: number, elapsed: number): void {
  const thrust = THREE.MathUtils.clamp(amount, 0, 1);
  for (let index = 0; index < 3; index += 1) {
    const outer = object.getObjectByName(`StarshipFlameOuter-${index}`) as THREE.Mesh | undefined;
    const inner = object.getObjectByName(`StarshipFlameInner-${index}`) as THREE.Mesh | undefined;
    const flicker = 0.88 + Math.sin(elapsed * 31 + index * 2.1) * 0.1 + Math.sin(elapsed * 17.3) * 0.04;
    if (outer) {
      outer.visible = thrust > 0.01;
      outer.scale.set(0.75 + thrust * 0.3, Math.max(0.05, thrust * flicker), 0.75 + thrust * 0.3);
      (outer.material as THREE.MeshBasicMaterial).opacity = thrust * 0.72;
    }
    if (inner) {
      inner.visible = thrust > 0.04;
      inner.scale.set(0.8, Math.max(0.05, thrust * (1.02 - Math.sin(elapsed * 23 + index) * 0.08)), 0.8);
      (inner.material as THREE.MeshBasicMaterial).opacity = thrust * 0.94;
    }
  }
  const light = object.getObjectByName('StarshipEngineLight') as THREE.PointLight | undefined;
  if (light) light.intensity = thrust * (5.2 + Math.sin(elapsed * 24) * 0.45);
}

function updateSmoke(object: THREE.Object3D, amount: number, elapsed: number, altitude: number): void {
  const density = THREE.MathUtils.clamp(amount, 0, 1);
  for (let index = 0; index < 12; index += 1) {
    const smoke = object.getObjectByName(`StarshipSmoke-${index}`) as THREE.Mesh | undefined;
    if (!smoke) continue;
    const phase = ((elapsed * 0.58 + index / 12) % 1 + 1) % 1;
    const angle = index * 2.399 + elapsed * 0.22;
    const spread = 0.15 + phase * (0.65 + density * 0.32);
    const trailTop = Math.max(0.2, altitude + 0.28);
    smoke.position.set(
      Math.sin(angle) * spread,
      Math.max(0.16, trailTop - phase * (1.45 + altitude * 0.42)),
      Math.cos(angle) * spread,
    );
    const scale = 0.5 + phase * 2.2;
    smoke.scale.setScalar(scale);
    smoke.visible = density > 0.02 && phase < density * 0.92;
    (smoke.material as THREE.MeshStandardMaterial).opacity = smoke.visible ? (1 - phase) * density * 0.42 : 0;
  }
}

function updatePad(object: THREE.Object3D, phase: string, elapsed: number): void {
  const active = phase !== 'idle';
  const recovered = phase === 'recovered';
  const ring = object.getObjectByName('StarshipPadRing') as THREE.Mesh | undefined;
  if (ring) {
    const material = ring.material as THREE.MeshStandardMaterial;
    material.emissive.set(recovered ? '#42e69a' : active ? '#ff6a1a' : '#13292b');
    material.emissiveIntensity = recovered ? 2.5 : active ? 1.1 + Math.sin(elapsed * 8) * 0.45 : 0.35;
  }
  for (let index = 0; index < 6; index += 1) {
    const indicator = object.getObjectByName(`StarshipPadIndicator-${index}`) as THREE.Mesh | undefined;
    if (!indicator) continue;
    const material = indicator.material as THREE.MeshStandardMaterial;
    material.color.set(recovered ? '#74ffc0' : '#ffb25e');
    material.emissive.set(recovered ? '#24dc83' : '#ff6a1a');
    material.emissiveIntensity = recovered
      ? 2.8
      : active && Math.sin(elapsed * 10 - index * 1.1) > -0.05
        ? 2.2
        : 0.35;
  }
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  object.userData.lastElapsed = elapsed;
  const rig = object.getObjectByName('StarshipFlightRig');
  if (!rig) return;

  if (object.userData.active !== true) {
    object.userData.interactionState = 'idle';
    object.userData.missionElapsed = 0;
    object.userData.altitude = 0;
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    setEngineOutput(object, 0, elapsed);
    updateSmoke(object, 0, elapsed, 0);
    updatePad(object, 'idle', elapsed);
    return;
  }

  const missionTime = Math.max(0, elapsed - Number(object.userData.launchStartedAt || 0));
  let phase = 'ignition';
  let altitude = 0;
  let tilt = 0;
  let thrust = 0;
  let smoke = 0;

  if (missionTime < IGNITION_END) {
    const progress = smooth01(missionTime / IGNITION_END);
    thrust = progress;
    smoke = progress;
    rig.position.y = Math.sin(elapsed * 34) * progress * 0.008;
  } else if (missionTime < ASCENT_END) {
    phase = 'ascent';
    const progress = smooth01((missionTime - IGNITION_END) / (ASCENT_END - IGNITION_END));
    altitude = progress * MAX_ALTITUDE;
    tilt = Math.sin(progress * Math.PI) * 0.075;
    thrust = 1;
    smoke = 0.92 - progress * 0.35;
  } else if (missionTime < COAST_END) {
    phase = 'coast';
    const progress = smooth01((missionTime - ASCENT_END) / (COAST_END - ASCENT_END));
    altitude = MAX_ALTITUDE + Math.sin(progress * Math.PI) * 0.2;
    tilt = THREE.MathUtils.lerp(0.075, 0.28, progress);
    thrust = 0.18 * (1 - progress);
    smoke = 0.12 * (1 - progress);
  } else if (missionTime < FLIP_END) {
    phase = 'flip';
    const progress = smooth01((missionTime - COAST_END) / (FLIP_END - COAST_END));
    altitude = THREE.MathUtils.lerp(MAX_ALTITUDE, MAX_ALTITUDE - 0.32, progress);
    tilt = THREE.MathUtils.lerp(0.28, 1.16, progress);
    thrust = 0;
    smoke = 0;
  } else if (missionTime < DESCENT_END) {
    phase = 'descent';
    const progress = smooth01((missionTime - FLIP_END) / (DESCENT_END - FLIP_END));
    altitude = THREE.MathUtils.lerp(MAX_ALTITUDE - 0.32, 0.82, progress);
    tilt = THREE.MathUtils.lerp(1.16, 0.82, progress) + Math.sin(progress * Math.PI * 2) * 0.035;
    thrust = 0;
    smoke = 0;
  } else if (missionTime < LANDING_END) {
    phase = 'landing-burn';
    const progress = smooth01((missionTime - DESCENT_END) / (LANDING_END - DESCENT_END));
    altitude = THREE.MathUtils.lerp(0.82, 0, progress);
    tilt = THREE.MathUtils.lerp(0.82, 0, smooth01(Math.min(1, progress * 1.35)));
    thrust = THREE.MathUtils.lerp(0.92, 0.26, progress);
    smoke = 0.48 + progress * 0.45;
  } else if (missionTime < RECOVERY_END) {
    phase = 'recovered';
    altitude = 0;
    tilt = 0;
    thrust = 0;
    smoke = Math.max(0, 1 - (missionTime - LANDING_END) / (RECOVERY_END - LANDING_END)) * 0.22;
  } else {
    object.userData.active = false;
    object.userData.interactionState = 'idle';
    object.userData.missionElapsed = 0;
    object.userData.altitude = 0;
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    setEngineOutput(object, 0, elapsed);
    updateSmoke(object, 0, elapsed, 0);
    updatePad(object, 'idle', elapsed);
    return;
  }

  object.userData.interactionState = phase;
  object.userData.missionElapsed = missionTime;
  object.userData.altitude = altitude;
  rig.position.set(Math.sin(missionTime * 0.9) * Math.min(0.055, altitude * 0.012), altitude, 0);
  rig.rotation.set(0, 0, tilt);
  setEngineOutput(object, thrust, elapsed);
  updateSmoke(object, smoke, elapsed, altitude);
  updatePad(object, phase, elapsed);
}

export function interactLobbyProp(object: THREE.Object3D): void {
  if (object.userData.active === true) return;
  object.userData.active = true;
  object.userData.launchStartedAt = Number(object.userData.lastElapsed || 0);
  object.userData.missionElapsed = 0;
  object.userData.altitude = 0;
  object.userData.interactionState = 'ignition';
  object.userData.launchCount = Number(object.userData.launchCount || 0) + 1;
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number; ageSeconds: number },
  elapsed: number,
): void {
  const age = Math.max(0, interaction.ageSeconds);
  object.userData.launchCount = interaction.sequence;
  object.userData.active = interaction.sequence > 0 && age < RECOVERY_END;
  object.userData.launchStartedAt = elapsed - age;
  updateLobbyProp(object, elapsed);
}
