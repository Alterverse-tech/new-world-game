import * as THREE from 'three';
import { createInfernalPianoScene, type InfernalPianoScene } from './infernal-piano-scene';
import type { PersistentSpaceId } from './lobby-channel';

type Vec3 = readonly [number, number, number];

export interface PersistentPortalSpaceScene {
  root: THREE.Group;
  colliders: THREE.Object3D[];
  placementSurfaces: THREE.Object3D[];
  background: THREE.Color;
  fog: THREE.Fog;
  exposure: number;
  spawn: Vec3;
  returnPortal: Vec3;
  update: (elapsed: number, delta: number) => void;
  infernalPiano: InfernalPianoScene | null;
  diagnostics: {
    realm: PersistentSpaceId;
    cloudInstances: number;
    shadowLights: number;
    pianoKeys: number;
  };
}

export function isPersistentPortalSpaceId(value: string): value is PersistentSpaceId {
  return value === 'heaven' || value === 'hell';
}

export function createPersistentPortalSpace(id: PersistentSpaceId): PersistentPortalSpaceScene {
  if (id === 'heaven') return createCelestialCloudSea();
  if (id === 'hell') return createInfernalBlackWater();
  throw new TypeError(`Unknown persistent portal space: ${String(id)}`);
}

function createRoot(id: PersistentSpaceId, spawn: Vec3, killY: number): THREE.Group {
  const root = new THREE.Group();
  root.name = `persistent-space:${id}`;
  root.userData.persistentSpaceId = id;
  root.userData.spawn = [...spawn];
  root.userData.killY = killY;
  return root;
}

function addShadowSun(
  root: THREE.Group,
  color: THREE.ColorRepresentation,
  intensity: number,
  position: Vec3,
  extent: number,
): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.name = 'realm-shadow-sun';
  sun.position.set(...position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.035;
  root.add(sun);
  return sun;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createCloudLayer(
  name: string,
  count: number,
  seed: number,
  radius: readonly [number, number],
  height: readonly [number, number],
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.InstancedMesh {
  const geometry = new THREE.SphereGeometry(1, 14, 9);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.96,
    metalness: 0,
    sheen: 0.16,
    sheenColor: new THREE.Color('#ffffff'),
    sheenRoughness: 0.82,
    transparent: true,
    opacity,
    depthWrite: opacity > 0.82,
  });
  const layer = new THREE.InstancedMesh(geometry, material, count);
  layer.name = name;
  layer.castShadow = false;
  layer.receiveShadow = true;
  layer.frustumCulled = false;
  const random = seededRandom(seed);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = THREE.MathUtils.lerp(radius[0], radius[1], Math.sqrt(random()));
    const elongated = 1.25 + random() * 2.3;
    dummy.position.set(
      Math.cos(angle) * distance,
      THREE.MathUtils.lerp(height[0], height[1], random()),
      Math.sin(angle) * distance,
    );
    dummy.rotation.set(random() * 0.18, random() * Math.PI * 2, random() * 0.12);
    dummy.scale.set(elongated, 0.55 + random() * 0.78, 1.05 + random() * 1.85);
    dummy.updateMatrix();
    layer.setMatrixAt(index, dummy.matrix);
  }
  layer.instanceMatrix.needsUpdate = true;
  layer.userData.baseRotationY = seed * 0.0001;
  return layer;
}

function createCelestialCloudSea(): PersistentPortalSpaceScene {
  const spawn: Vec3 = [0, 0.02, 8];
  const returnPortal: Vec3 = [-8.4, 1.75, 7.2];
  const root = createRoot('heaven', spawn, -18);
  const colliders: THREE.Object3D[] = [];
  const placementSurfaces: THREE.Object3D[] = [];

  root.add(new THREE.HemisphereLight('#f9fdff', '#7596ba', 2.35));
  addShadowSun(root, '#fff9df', 4.15, [-18, 32, 14], 34);
  const rim = new THREE.DirectionalLight('#9fd9ff', 1.35);
  rim.position.set(18, 12, -24);
  root.add(rim);

  const deckMaterial = new THREE.MeshPhysicalMaterial({
    color: '#f7fcff',
    emissive: '#aacce2',
    emissiveIntensity: 0.1,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(24, 25.5, 0.55, 64), deckMaterial);
  deck.name = 'celestial-cloud-flight-deck';
  deck.position.y = -0.31;
  deck.receiveShadow = true;
  root.add(deck);
  colliders.push(deck);
  placementSurfaces.push(deck);

  const innerClouds = createCloudLayer('celestial-inner-cloud-bank', 96, 7717, [13, 29], [-1.2, 5.5], '#f8fcff', 0.94);
  const outerClouds = createCloudLayer('celestial-outer-cloud-bank', 128, 9821, [28, 70], [-5, 15], '#eaf7ff', 0.82);
  const lowerClouds = createCloudLayer('celestial-lower-cloud-ocean', 132, 14159, [5, 78], [-12, -5], '#dcefff', 0.88);
  root.add(innerClouds, outerClouds, lowerClouds);

  const cloudGlow = new THREE.Mesh(
    new THREE.CircleGeometry(23.8, 64),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  cloudGlow.name = 'celestial-cloud-deck-glow';
  cloudGlow.rotation.x = -Math.PI / 2;
  cloudGlow.position.y = 0.006;
  root.add(cloudGlow);

  const skyPearls = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: '#ffffff', size: 0.18, transparent: true, opacity: 0.72 }),
  );
  const random = seededRandom(31415);
  const positions = new Float32Array(180 * 3);
  for (let index = 0; index < 180; index += 1) {
    const offset = index * 3;
    positions[offset] = (random() - 0.5) * 118;
    positions[offset + 1] = 4 + random() * 34;
    positions[offset + 2] = (random() - 0.5) * 118;
  }
  skyPearls.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  skyPearls.name = 'celestial-sunlit-mist-particles';
  root.add(skyPearls);

  const update = (elapsed: number): void => {
    const time = Number.isFinite(elapsed) ? elapsed : 0;
    innerClouds.rotation.y = time * 0.0032;
    outerClouds.rotation.y = -time * 0.0017;
    lowerClouds.rotation.y = time * 0.0009;
    cloudGlow.material.opacity = 0.2 + Math.sin(time * 0.22) * 0.035;
    skyPearls.rotation.y = time * 0.002;
  };

  return {
    root,
    colliders,
    placementSurfaces,
    background: new THREE.Color('#9acff2'),
    fog: new THREE.Fog('#c8e7f8', 38, 126),
    exposure: 1.08,
    spawn,
    returnPortal,
    update,
    infernalPiano: null,
    diagnostics: { realm: 'heaven', cloudInstances: 356, shadowLights: 1, pianoKeys: 0 },
  };
}

function invisibleColliderFromBox(name: string, box: THREE.Box3): THREE.Mesh {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  material.colorWrite = false;
  const collider = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  collider.name = name;
  collider.position.copy(center);
  return collider;
}

function createInfernalBlackWater(): PersistentPortalSpaceScene {
  const spawn: Vec3 = [0, 0.86, 5.35];
  const returnPortal: Vec3 = [7.25, 2.15, 1.3];
  const root = createRoot('hell', spawn, -6);
  const infernalPiano = createInfernalPianoScene();
  infernalPiano.root.name = 'infernal-black-water-environment';
  root.add(infernalPiano.root);

  const colliders = infernalPiano.rockColliders.map((box, index) => {
    const collider = invisibleColliderFromBox(`infernal-rock-collider-${index + 1}`, box);
    root.add(collider);
    return collider;
  });
  const pianoBody = invisibleColliderFromBox(
    'infernal-concert-grand-collider',
    new THREE.Box3(new THREE.Vector3(-0.95, 1.0, -2.65), new THREE.Vector3(0.95, 2.56, 0.92)),
  );
  root.add(pianoBody);
  colliders.push(pianoBody);

  const placementSurfaces = [...infernalPiano.placementSurfaces];
  const update = (elapsed: number, delta: number): void => {
    infernalPiano.update(elapsed, delta, {
      playing: Boolean(root.userData.pianoPlaying),
      activeNotes: Array.isArray(root.userData.pianoActiveNotes) ? root.userData.pianoActiveNotes : [],
    });
  };

  return {
    root,
    colliders,
    placementSurfaces,
    background: new THREE.Color('#000104'),
    fog: new THREE.Fog('#010104', 13, 72),
    exposure: 0.82,
    spawn,
    returnPortal,
    update,
    infernalPiano,
    diagnostics: {
      realm: 'hell',
      cloudInstances: 0,
      shadowLights: infernalPiano.diagnostics.shadowCastingLights,
      pianoKeys: infernalPiano.diagnostics.keyCount,
    },
  };
}
