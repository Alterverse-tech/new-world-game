import * as THREE from 'three';

export interface InfernalPianoPlaybackState {
  playing: boolean;
  activeNotes: readonly number[];
}

export interface InfernalPianoDiagnostics {
  meshCount: number;
  instancedMeshCount: number;
  lightCount: number;
  shadowCastingLights: number;
  geometryCount: number;
  materialCount: number;
  textureCount: number;
  approximateTriangles: number;
  drawCallEstimate: number;
  keyCount: number;
  flameInstanceCount: number;
  emberCount: number;
  colliderCount: number;
  shaderCacheKeys: readonly string[];
}

export interface InfernalPianoScene {
  root: THREE.Group;
  rockColliders: THREE.Box3[];
  placementSurfaces: THREE.Object3D[];
  interactionAnchor: THREE.Object3D;
  keys: THREE.Mesh[];
  pianoKeys: THREE.Mesh[];
  update: (
    elapsed: number,
    delta: number,
    state: InfernalPianoPlaybackState,
  ) => void;
  diagnostics: InfernalPianoDiagnostics;
}

type Vec3 = readonly [number, number, number];

interface PianoMaterials {
  lacquer: THREE.MeshPhysicalMaterial;
  lacquerSoft: THREE.MeshPhysicalMaterial;
  ebony: THREE.MeshPhysicalMaterial;
  ivory: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  goldFrame: THREE.MeshStandardMaterial;
  soundboard: THREE.MeshPhysicalMaterial;
  felt: THREE.MeshStandardMaterial;
}

interface FlameAnchor {
  readonly position: Vec3;
  readonly phase: number;
  readonly size: number;
}

interface FlameBank {
  readonly group: THREE.Group;
  readonly outer: THREE.InstancedMesh;
  readonly middle: THREE.InstancedMesh;
  readonly core: THREE.InstancedMesh;
  readonly anchors: readonly FlameAnchor[];
  readonly lights: readonly THREE.PointLight[];
}

interface TimeUniforms {
  [uniform: string]: { value: number };
  uTime: { value: number };
}

const WATER_PROGRAM_CACHE_KEY = 'infernal-black-water-pbr-v1';
const EMBER_PROGRAM_CACHE_KEY = 'infernal-piano-embers-v2';
const FIRST_PIANO_MIDI_NOTE = 21;
const PIANO_KEY_COUNT = 88;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

function shadowedMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
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

function createRockGeometry(): THREE.BufferGeometry {
  const segments = 32;
  const ringCount = 4;
  const positions: number[] = [0, 0.92, 0];
  const colors: number[] = [0.29, 0.26, 0.25];
  const indices: number[] = [];

  for (let ring = 1; ring <= ringCount; ring += 1) {
    const amount = ring / ringCount;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      const edgeNoise = 1
        + Math.sin(angle * 3 + ring * 0.83) * 0.065
        + Math.sin(angle * 7 - ring * 0.47) * 0.04;
      const radiusX = 10.3 * amount * edgeNoise;
      const radiusZ = 8.15 * amount * (1 + Math.cos(angle * 5 + ring) * 0.045);
      const centralShelf = 0.94 - amount * amount * 0.64;
      const fracture = Math.sin(angle * 4.1 + ring * 1.77) * 0.13 * amount
        + Math.cos(angle * 9.3 - ring * 0.62) * 0.08 * amount;
      const y = centralShelf + fracture - (ring === ringCount ? 0.28 : 0);
      positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
      const shade = THREE.MathUtils.clamp(0.31 - amount * 0.12 + fracture * 0.13, 0.12, 0.34);
      colors.push(shade, shade * 0.89, shade * 0.86);
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(0, 1 + next, 1 + segment);
  }

  for (let ring = 1; ring < ringCount; ring += 1) {
    const innerStart = 1 + (ring - 1) * segments;
    const outerStart = 1 + ring * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const inner = innerStart + segment;
      const innerNext = innerStart + next;
      const outer = outerStart + segment;
      const outerNext = outerStart + next;
      indices.push(inner, innerNext, outer, innerNext, outerNext, outer);
    }
  }

  const upperOuterStart = 1 + (ringCount - 1) * segments;
  const lowerOuterStart = positions.length / 3;
  for (let segment = 0; segment < segments; segment += 1) {
    const topOffset = (upperOuterStart + segment) * 3;
    const x = positions[topOffset] ?? 0;
    const y = positions[topOffset + 1] ?? 0;
    const z = positions[topOffset + 2] ?? 0;
    const angle = segment / segments * Math.PI * 2;
    positions.push(x * 0.9, y - 1.5 - 0.25 * Math.sin(angle * 3), z * 0.9);
    colors.push(0.075, 0.065, 0.064);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const upper = upperOuterStart + segment;
    const upperNext = upperOuterStart + next;
    const lower = lowerOuterStart + segment;
    const lowerNext = lowerOuterStart + next;
    indices.push(upper, lower, upperNext, upperNext, lower, lowerNext);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createWaterMaterial(uniforms: TimeUniforms): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x010205,
    emissive: 0x010204,
    emissiveIntensity: 0.14,
    metalness: 0.38,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.35,
    side: THREE.DoubleSide,
  });
  material.name = 'infernal-black-water-material';
  material.userData.timeUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    material.userData.shader = shader;
    shader.vertexShader = `uniform float uTime;\nvarying float vInfernalWave;\n${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float broadWave = sin(position.x * 0.17 + uTime * 0.31) * 0.10;
         float crossWave = cos(position.y * 0.23 - uTime * 0.24) * 0.075;
         float detailWave = sin((position.x + position.y) * 0.41 + uTime * 0.43) * 0.025;
         vInfernalWave = broadWave + crossWave + detailWave;
         transformed.z += vInfernalWave;`,
      );
    shader.fragmentShader = `varying float vInfernalWave;\n${shader.fragmentShader}`
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float waterFresnel = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 4.0);
         vec3 coldReflection = vec3(0.014, 0.026, 0.038) * (0.35 + waterFresnel * 1.8);
         totalEmissiveRadiance += coldReflection + vec3(0.006, 0.002, 0.001) * abs(vInfernalWave);`,
      );
  };
  material.customProgramCacheKey = () => WATER_PROGRAM_CACHE_KEY;
  return material;
}

function createGrandPianoShape(scale = 1): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-2.48 * scale, 2.08 * scale);
  shape.lineTo(2.42 * scale, 2.08 * scale);
  shape.bezierCurveTo(2.4 * scale, 1.12 * scale, 2.02 * scale, 0.16 * scale, 1.62 * scale, -0.86 * scale);
  shape.bezierCurveTo(1.18 * scale, -2.02 * scale, 0.68 * scale, -3.15 * scale, -0.2 * scale, -3.55 * scale);
  shape.bezierCurveTo(-0.86 * scale, -3.84 * scale, -1.72 * scale, -3.58 * scale, -2.18 * scale, -2.86 * scale);
  shape.bezierCurveTo(-2.42 * scale, -2.48 * scale, -2.46 * scale, -0.7 * scale, -2.48 * scale, 2.08 * scale);
  shape.closePath();
  return shape;
}

function createInnerPianoShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-1.96, 1.34);
  shape.lineTo(1.86, 1.34);
  shape.bezierCurveTo(1.76, 0.42, 1.38, -0.74, 0.92, -1.78);
  shape.bezierCurveTo(0.45, -2.78, -0.2, -3.02, -0.78, -2.82);
  shape.bezierCurveTo(-1.45, -2.58, -1.76, -1.66, -1.96, 1.34);
  shape.closePath();
  return shape;
}

function extrudeHorizontal(shape: THREE.Shape, depth: number, bevelSize: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depth - bevelSize * 2),
    steps: 1,
    bevelEnabled: bevelSize > 0,
    bevelSegments: 2,
    bevelSize,
    bevelThickness: bevelSize,
    curveSegments: 24,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, depth / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function createPianoMaterials(): PianoMaterials {
  return {
    lacquer: new THREE.MeshPhysicalMaterial({
      name: 'concert-black-lacquer',
      color: 0x060607,
      metalness: 0.05,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      envMapIntensity: 1.4,
    }),
    lacquerSoft: new THREE.MeshPhysicalMaterial({
      name: 'concert-black-soft-reflection',
      color: 0x0c0c0f,
      metalness: 0.03,
      roughness: 0.22,
      clearcoat: 0.82,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.15,
    }),
    ebony: new THREE.MeshPhysicalMaterial({
      name: 'ebony-key',
      color: 0x020203,
      metalness: 0.02,
      roughness: 0.16,
      clearcoat: 0.94,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.2,
    }),
    ivory: new THREE.MeshPhysicalMaterial({
      name: 'ivory-key',
      color: 0xf0eadb,
      metalness: 0,
      roughness: 0.3,
      clearcoat: 0.38,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.9,
    }),
    brass: new THREE.MeshStandardMaterial({
      name: 'aged-brass-hardware',
      color: 0xb78a34,
      metalness: 0.92,
      roughness: 0.26,
      envMapIntensity: 1.4,
    }),
    goldFrame: new THREE.MeshStandardMaterial({
      name: 'cast-iron-gold-frame',
      color: 0xc58a26,
      metalness: 0.78,
      roughness: 0.34,
      envMapIntensity: 1.2,
    }),
    soundboard: new THREE.MeshPhysicalMaterial({
      name: 'spruce-soundboard',
      color: 0x9b6431,
      metalness: 0,
      roughness: 0.58,
      clearcoat: 0.16,
      clearcoatRoughness: 0.28,
      envMapIntensity: 0.65,
    }),
    felt: new THREE.MeshStandardMaterial({
      name: 'burgundy-piano-felt',
      color: 0x3a050a,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.25,
    }),
  };
}

function addTurnedLeg(
  piano: THREE.Group,
  name: string,
  x: number,
  z: number,
  materials: PianoMaterials,
): void {
  shadowedMesh(piano, `${name}-capital`, new THREE.CylinderGeometry(0.27, 0.32, 0.38, 20), materials.lacquer, [x, 2.22, z]);
  shadowedMesh(piano, `${name}-upper`, new THREE.CylinderGeometry(0.19, 0.26, 0.34, 20), materials.lacquerSoft, [x, 1.89, z]);
  shadowedMesh(piano, `${name}-shaft`, new THREE.CylinderGeometry(0.11, 0.15, 1.28, 20), materials.lacquer, [x, 1.08, z]);
  shadowedMesh(piano, `${name}-ankle`, new THREE.SphereGeometry(0.18, 18, 12), materials.lacquerSoft, [x, 0.39, z]);
  const caster = shadowedMesh(piano, `${name}-caster`, new THREE.TorusGeometry(0.16, 0.045, 8, 20), materials.brass, [x, 0.18, z], [0, Math.PI / 2, 0]);
  caster.scale.z = 0.78;
}

function cylinderBetween(
  parent: THREE.Object3D,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 14,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addStringBank(piano: THREE.Group, materials: PianoMaterials): THREE.InstancedMesh {
  const stringCount = 44;
  const strings = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.0075, 0.0075, 1, 6),
    materials.brass,
    stringCount,
  );
  strings.name = 'infernal-piano-string-bank';
  strings.castShadow = true;
  strings.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let index = 0; index < stringCount; index += 1) {
    const amount = index / (stringCount - 1);
    const x = THREE.MathUtils.lerp(-1.78, 1.48, amount);
    const tailZ = THREE.MathUtils.lerp(-2.92, -1.38, Math.pow(amount, 1.55));
    const frontZ = 1.18;
    const length = frontZ - tailZ;
    position.set(x, 3.1, (frontZ + tailZ) / 2);
    scale.set(index < 12 ? 1.7 : 1, length, index < 12 ? 1.7 : 1);
    matrix.compose(position, quaternion, scale);
    strings.setMatrixAt(index, matrix);
  }
  strings.instanceMatrix.needsUpdate = true;
  piano.add(strings);
  return strings;
}

function addPianoKeys(piano: THREE.Group, materials: PianoMaterials): THREE.Mesh[] {
  const keys: THREE.Mesh[] = [];
  const keyboardWidth = 4.74;
  const whiteWidth = keyboardWidth / 52;
  const whiteGeometry = new THREE.BoxGeometry(whiteWidth * 0.92, 0.115, 1.24);
  const blackGeometry = new THREE.BoxGeometry(whiteWidth * 0.58, 0.18, 0.78);
  let whiteIndex = 0;

  for (let keyIndex = 0; keyIndex < PIANO_KEY_COUNT; keyIndex += 1) {
    const midi = FIRST_PIANO_MIDI_NOTE + keyIndex;
    const pitchClass = midi % 12;
    const black = BLACK_PITCH_CLASSES.has(pitchClass);
    const x = black
      ? -keyboardWidth / 2 + whiteIndex * whiteWidth
      : -keyboardWidth / 2 + (whiteIndex + 0.5) * whiteWidth;
    const key = new THREE.Mesh(black ? blackGeometry : whiteGeometry, black ? materials.ebony : materials.ivory);
    const octave = Math.floor(midi / 12) - 1;
    key.name = `infernal-piano-key-${String(keyIndex).padStart(2, '0')}-${NOTE_NAMES[pitchClass] ?? 'C'}${octave}`;
    key.position.set(x, black ? 3.245 : 3.17, black ? 2.42 : 2.64);
    key.castShadow = true;
    key.receiveShadow = true;
    key.userData.keyIndex = keyIndex;
    key.userData.midi = midi;
    key.userData.note = `${NOTE_NAMES[pitchClass] ?? 'C'}${octave}`;
    key.userData.isBlack = black;
    key.userData.baseY = key.position.y;
    piano.add(key);
    keys.push(key);
    if (!black) whiteIndex += 1;
  }
  return keys;
}

function addPedalLyre(piano: THREE.Group, materials: PianoMaterials): void {
  const lyre = new THREE.Group();
  lyre.name = 'infernal-piano-pedal-lyre';
  lyre.position.set(0, 0, 1.25);
  piano.add(lyre);
  cylinderBetween(lyre, 'pedal-lyre-left', new THREE.Vector3(-0.2, 0.38, 0), new THREE.Vector3(-0.31, 1.42, 0), 0.036, materials.brass);
  cylinderBetween(lyre, 'pedal-lyre-right', new THREE.Vector3(0.2, 0.38, 0), new THREE.Vector3(0.31, 1.42, 0), 0.036, materials.brass);
  shadowedMesh(lyre, 'pedal-lyre-crossbar', new THREE.BoxGeometry(0.58, 0.07, 0.09), materials.brass, [0, 0.42, 0]);
  for (let index = 0; index < 3; index += 1) {
    shadowedMesh(
      lyre,
      `infernal-piano-pedal-${index + 1}`,
      new THREE.BoxGeometry(0.18, 0.055, 0.5),
      materials.brass,
      [(index - 1) * 0.21, 0.34, 0.18 + Math.abs(index - 1) * 0.08],
      [-0.12, 0, 0],
    );
  }
}

function addMusicDesk(piano: THREE.Group, materials: PianoMaterials): void {
  const desk = new THREE.Group();
  desk.name = 'infernal-piano-music-desk';
  desk.position.set(0, 3.55, 0.98);
  desk.rotation.x = -0.16;
  piano.add(desk);
  shadowedMesh(desk, 'music-desk-panel', new THREE.BoxGeometry(1.72, 0.88, 0.075), materials.lacquerSoft, [0, 0.34, 0]);
  shadowedMesh(desk, 'music-desk-window', new THREE.BoxGeometry(1.22, 0.48, 0.09), materials.felt, [0, 0.35, -0.01]);
  shadowedMesh(desk, 'music-desk-ledge', new THREE.BoxGeometry(1.96, 0.1, 0.27), materials.lacquer, [0, -0.14, 0.11]);
  const trimGeometry = new THREE.BoxGeometry(0.055, 0.8, 0.11);
  shadowedMesh(desk, 'music-desk-left-trim', trimGeometry, materials.brass, [-0.79, 0.34, 0.02]);
  shadowedMesh(desk, 'music-desk-right-trim', trimGeometry, materials.brass, [0.79, 0.34, 0.02]);
}

function createPiano(): { group: THREE.Group; keys: THREE.Mesh[]; materials: PianoMaterials } {
  const materials = createPianoMaterials();
  const piano = new THREE.Group();
  piano.name = 'infernal-bespoke-concert-grand';
  // The authored source geometry is intentionally roomy so the 88 individual
  // keys and hardware remain legible. Present it at real concert-grand scale:
  // roughly 1.55 m wide, 2.9 m long and 1.4 m from reef to open lid.
  piano.position.set(0, 1.02, -0.58);
  piano.scale.set(0.31, 0.32, 0.48);
  piano.userData.manufacturer = 'bespoke-fictional-concert-grand';
  piano.userData.modelClass = 'concert-grand';
  piano.userData.presentedDimensionsMeters = { width: 1.55, length: 2.9, openLidHeight: 1.4 };

  addTurnedLeg(piano, 'infernal-piano-leg-front-left', -1.92, 1.45, materials);
  addTurnedLeg(piano, 'infernal-piano-leg-front-right', 1.87, 1.42, materials);
  addTurnedLeg(piano, 'infernal-piano-leg-tail', -0.66, -2.82, materials);

  shadowedMesh(piano, 'infernal-piano-case', extrudeHorizontal(createGrandPianoShape(), 0.62, 0.055), materials.lacquer, [0, 2.62, 0]);
  shadowedMesh(piano, 'infernal-piano-inner-rim', extrudeHorizontal(createGrandPianoShape(0.965), 0.18, 0.025), materials.lacquerSoft, [0, 3.0, -0.03]);
  shadowedMesh(piano, 'infernal-piano-soundboard', extrudeHorizontal(createInnerPianoShape(), 0.085, 0.01), materials.soundboard, [0, 3.055, -0.05]);
  shadowedMesh(piano, 'infernal-piano-gold-plate', extrudeHorizontal(createInnerPianoShape(), 0.045, 0.005), materials.goldFrame, [0, 3.09, -0.05]);

  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.62, 3.14, 0.82),
    new THREE.Vector3(-1.12, 3.14, 0.26),
    new THREE.Vector3(-0.48, 3.14, -0.36),
    new THREE.Vector3(0.14, 3.14, -1.16),
    new THREE.Vector3(0.52, 3.14, -2.28),
  ]);
  shadowedMesh(piano, 'infernal-piano-bridge', new THREE.TubeGeometry(bridgeCurve, 38, 0.055, 8, false), materials.brass, [0, 0, 0]);
  addStringBank(piano, materials);

  shadowedMesh(piano, 'infernal-piano-keybed', new THREE.BoxGeometry(5.18, 0.28, 1.55), materials.lacquer, [0, 2.96, 2.46]);
  shadowedMesh(piano, 'infernal-piano-fallboard', new THREE.BoxGeometry(4.96, 0.48, 0.16), materials.lacquerSoft, [0, 3.3, 1.91], [-0.06, 0, 0]);
  shadowedMesh(piano, 'infernal-piano-red-felt-rail', new THREE.BoxGeometry(4.77, 0.045, 0.09), materials.felt, [0, 3.25, 2.02]);

  const medallion = shadowedMesh(piano, 'infernal-piano-maker-medallion', new THREE.TorusGeometry(0.14, 0.025, 8, 24), materials.brass, [0, 3.37, 2.01]);
  medallion.scale.y = 0.72;
  const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(0.026, 8, 6), materials.brass, 5);
  crown.name = 'infernal-piano-maker-crown';
  crown.castShadow = true;
  const crownMatrix = new THREE.Matrix4();
  for (let index = 0; index < 5; index += 1) {
    crownMatrix.makeTranslation((index - 2) * 0.055, 3.54 + (index % 2) * 0.035, 2.025);
    crown.setMatrixAt(index, crownMatrix);
  }
  crown.instanceMatrix.needsUpdate = true;
  piano.add(crown);

  const keys = addPianoKeys(piano, materials);
  addPedalLyre(piano, materials);
  addMusicDesk(piano, materials);

  const lidPivot = new THREE.Group();
  lidPivot.name = 'infernal-piano-lid-pivot';
  lidPivot.position.set(-2.24, 3.2, 0);
  lidPivot.rotation.z = 0.57;
  piano.add(lidPivot);
  const lid = shadowedMesh(
    lidPivot,
    'infernal-piano-open-lid',
    extrudeHorizontal(createGrandPianoShape(1.018), 0.13, 0.025),
    materials.lacquer,
    [2.24, 0, 0],
  );
  lid.userData.openAngle = 0.57;
  cylinderBetween(
    piano,
    'infernal-piano-lid-prop',
    new THREE.Vector3(0.8, 3.14, -0.55),
    new THREE.Vector3(1.42, 4.48, -0.62),
    0.035,
    materials.brass,
  );

  return { group: piano, keys, materials };
}

function createFlameBank(piano: THREE.Group): FlameBank {
  const anchors: readonly FlameAnchor[] = [
    { position: [-2.08, 3.52, 1.5], phase: 0.2, size: 0.9 },
    { position: [-1.62, 3.61, 0.88], phase: 1.1, size: 1.16 },
    { position: [-2.04, 3.48, 0.06], phase: 2.4, size: 0.78 },
    { position: [-1.68, 3.52, -0.74], phase: 3.2, size: 1.05 },
    { position: [-1.34, 3.46, -1.62], phase: 4.7, size: 0.88 },
    { position: [-0.82, 3.48, -2.42], phase: 5.5, size: 1.2 },
    { position: [-0.12, 3.46, -3.08], phase: 0.9, size: 0.94 },
    { position: [0.52, 3.49, -2.62], phase: 2.0, size: 1.08 },
    { position: [1.02, 3.53, -1.76], phase: 3.8, size: 0.86 },
    { position: [1.46, 3.55, -0.9], phase: 4.3, size: 1.18 },
    { position: [1.86, 3.58, 0.02], phase: 5.8, size: 0.82 },
    { position: [2.05, 3.56, 0.88], phase: 1.7, size: 1.04 },
    { position: [1.58, 3.62, 1.52], phase: 2.8, size: 0.92 },
    { position: [0.72, 3.62, 1.62], phase: 4.9, size: 1.1 },
  ];
  const group = new THREE.Group();
  group.name = 'infernal-piano-fire';
  piano.add(group);

  const flameGeometry = new THREE.SphereGeometry(0.24, 9, 7);
  const flamePositions = flameGeometry.getAttribute('position');
  for (let index = 0; index < flamePositions.count; index += 1) {
    const sourceY = flamePositions.getY(index);
    const height = THREE.MathUtils.clamp((sourceY + 0.24) / 0.48, 0, 1);
    const taper = Math.max(0.06, Math.sin(Math.PI * height) ** 0.68 * (1 - height * 0.48));
    flamePositions.setXYZ(
      index,
      flamePositions.getX(index) * taper,
      sourceY + 0.24,
      flamePositions.getZ(index) * taper,
    );
  }
  flamePositions.needsUpdate = true;
  flameGeometry.computeVertexNormals();
  const outerMaterial = new THREE.MeshBasicMaterial({
    name: 'infernal-flame-outer-material',
    color: 0xe93408,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  const middleMaterial = new THREE.MeshBasicMaterial({
    name: 'infernal-flame-middle-material',
    color: 0xff6a12,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    name: 'infernal-flame-core-material',
    color: 0xffbd55,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  const outer = new THREE.InstancedMesh(flameGeometry, outerMaterial, anchors.length);
  outer.name = 'infernal-flame-outer';
  outer.frustumCulled = false;
  const middle = new THREE.InstancedMesh(flameGeometry, middleMaterial, anchors.length);
  middle.name = 'infernal-flame-middle';
  middle.frustumCulled = false;
  const core = new THREE.InstancedMesh(flameGeometry, coreMaterial, anchors.length);
  core.name = 'infernal-flame-core';
  core.frustumCulled = false;
  group.add(outer, middle, core);

  const lightLeft = new THREE.PointLight(0xff3b09, 7.2, 8.5, 2);
  lightLeft.name = 'infernal-piano-fire-light-left';
  lightLeft.position.set(-1.55, 4.35, -0.35);
  const lightRight = new THREE.PointLight(0xff8a22, 6.1, 7.5, 2);
  lightRight.name = 'infernal-piano-fire-light-right';
  lightRight.position.set(1.45, 4.15, 0.1);
  group.add(lightLeft, lightRight);

  return { group, outer, middle, core, anchors, lights: [lightLeft, lightRight] };
}

function createEmbers(piano: THREE.Group): { points: THREE.Points; uniforms: TimeUniforms; count: number } {
  const count = 96;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const rise = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const phase = (index * 2.399963229728653) % (Math.PI * 2);
    const radius = 0.45 + ((index * 37) % 100) / 100 * 2.45;
    positions[index * 3] = Math.cos(phase) * radius;
    positions[index * 3 + 1] = ((index * 53) % 100) / 100 * 4.4;
    positions[index * 3 + 2] = -0.55 + Math.sin(phase) * radius * 0.72;
    phases[index] = phase;
    rise[index] = 0.22 + ((index * 29) % 100) / 100 * 0.38;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aRise', new THREE.BufferAttribute(rise, 1));
  const uniforms: TimeUniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    name: 'infernal-piano-ember-material',
    uniforms,
    vertexShader: `
      uniform float uTime;
      attribute float aPhase;
      attribute float aRise;
      varying float vLife;
      void main() {
        vec3 ember = position;
        float travel = mod(position.y + uTime * aRise + aPhase * 0.37, 4.5);
        ember.y = travel;
        ember.x += sin(uTime * 0.8 + aPhase + travel) * 0.24;
        ember.z += cos(uTime * 0.63 + aPhase * 1.7) * 0.18;
        vLife = sin(clamp(travel / 4.5, 0.0, 1.0) * 3.14159265);
        vec4 mvPosition = modelViewMatrix * vec4(ember, 1.0);
        gl_PointSize = clamp(
          (1.5 + vLife * 3.5) * (8.0 / max(1.0, -mvPosition.z)),
          1.0,
          9.0
        );
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vLife;
      void main() {
        float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
        float alpha = smoothstep(0.5, 0.05, distanceToCenter) * vLife;
        vec3 color = mix(vec3(1.0, 0.16, 0.01), vec3(1.0, 0.82, 0.26), vLife);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  material.customProgramCacheKey = () => EMBER_PROGRAM_CACHE_KEY;
  const points = new THREE.Points(geometry, material);
  points.name = 'infernal-piano-embers';
  points.position.y = 3.45;
  points.frustumCulled = false;
  piano.add(points);
  return { points, uniforms, count };
}

function addLighting(root: THREE.Group): void {
  const hemisphere = new THREE.HemisphereLight(0x29313d, 0x030102, 0.48);
  hemisphere.name = 'infernal-piano-hemisphere-fill';
  root.add(hemisphere);

  const key = new THREE.DirectionalLight(0xb8c8e8, 2.15);
  key.name = 'infernal-piano-moon-key';
  key.position.set(-8, 13, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -13;
  key.shadow.camera.right = 13;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 38;
  key.shadow.bias = -0.00032;
  key.shadow.normalBias = 0.035;
  root.add(key);
}

function normalizeActiveNotes(notes: readonly number[]): Set<number> {
  const normalized = new Set<number>();
  for (const note of notes) {
    if (!Number.isFinite(note)) continue;
    const integer = Math.round(note);
    const keyIndex = integer >= FIRST_PIANO_MIDI_NOTE && integer < FIRST_PIANO_MIDI_NOTE + PIANO_KEY_COUNT
      ? integer - FIRST_PIANO_MIDI_NOTE
      : integer;
    if (keyIndex >= 0 && keyIndex < PIANO_KEY_COUNT) normalized.add(keyIndex);
  }
  return normalized;
}

function updateFlames(bank: FlameBank, elapsed: number, playing: boolean, activeNoteCount: number): void {
  const dummy = new THREE.Object3D();
  const performanceLift = playing ? 1.16 + Math.min(activeNoteCount, 10) * 0.012 : 0.88;
  for (let index = 0; index < bank.anchors.length; index += 1) {
    const anchor = bank.anchors[index];
    if (!anchor) continue;
    const flicker = 0.86
      + Math.sin(elapsed * 7.3 + anchor.phase) * 0.11
      + Math.sin(elapsed * 12.7 + anchor.phase * 2.3) * 0.055;
    const sway = Math.sin(elapsed * 3.8 + anchor.phase) * 0.075;
    dummy.position.set(anchor.position[0] + sway, anchor.position[1], anchor.position[2]);
    dummy.rotation.set(0, anchor.phase + elapsed * 0.18, -sway * 0.24);
    dummy.scale.set(anchor.size * 0.72, anchor.size * 2.15 * flicker * performanceLift, anchor.size * 0.62);
    dummy.updateMatrix();
    bank.outer.setMatrixAt(index, dummy.matrix);

    dummy.position.y += 0.02;
    dummy.scale.set(anchor.size * 0.48, anchor.size * 1.52 * flicker * performanceLift, anchor.size * 0.42);
    dummy.updateMatrix();
    bank.middle.setMatrixAt(index, dummy.matrix);

    dummy.position.y -= 0.04;
    dummy.scale.set(anchor.size * 0.23, anchor.size * 0.84 * flicker * performanceLift, anchor.size * 0.2);
    dummy.updateMatrix();
    bank.core.setMatrixAt(index, dummy.matrix);
  }
  bank.outer.instanceMatrix.needsUpdate = true;
  bank.middle.instanceMatrix.needsUpdate = true;
  bank.core.instanceMatrix.needsUpdate = true;
  for (let index = 0; index < bank.lights.length; index += 1) {
    const light = bank.lights[index];
    if (!light) continue;
    light.intensity = (index === 0 ? 7.2 : 6.1)
      * performanceLift
      * (0.92 + Math.sin(elapsed * 6.2 + index * 2.4) * 0.08);
  }
}

function collectDiagnostics(
  root: THREE.Group,
  keyCount: number,
  flameInstanceCount: number,
  emberCount: number,
  colliderCount: number,
): InfernalPianoDiagnostics {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const shaderCacheKeys = new Set<string>();
  let meshCount = 0;
  let instancedMeshCount = 0;
  let lightCount = 0;
  let shadowCastingLights = 0;
  let approximateTriangles = 0;
  let drawCallEstimate = 0;

  root.traverse((object) => {
    if (object instanceof THREE.Light) {
      lightCount += 1;
      if ('castShadow' in object && object.castShadow === true) shadowCastingLights += 1;
    }
    if (object instanceof THREE.Mesh) {
      meshCount += 1;
      drawCallEstimate += Array.isArray(object.material) ? object.material.length : 1;
      if (object instanceof THREE.InstancedMesh) instancedMeshCount += 1;
      geometries.add(object.geometry);
      const triangleCount = object.geometry.index
        ? object.geometry.index.count / 3
        : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
      approximateTriangles += triangleCount * (object instanceof THREE.InstancedMesh ? object.count : 1);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) materials.add(material);
    } else if (object instanceof THREE.Points || object instanceof THREE.Line) {
      drawCallEstimate += 1;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) materials.add(material);
    }
  });

  for (const material of materials) {
    const cacheKey = material.customProgramCacheKey();
    if (cacheKey && cacheKey !== material.type) shaderCacheKeys.add(cacheKey);
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }

  return {
    meshCount,
    instancedMeshCount,
    lightCount,
    shadowCastingLights,
    geometryCount: geometries.size,
    materialCount: materials.size,
    textureCount: textures.size,
    approximateTriangles: Math.round(approximateTriangles),
    drawCallEstimate,
    keyCount,
    flameInstanceCount,
    emberCount,
    colliderCount,
    shaderCacheKeys: [...shaderCacheKeys].sort(),
  };
}

export function createInfernalPianoScene(): InfernalPianoScene {
  const root = new THREE.Group();
  root.name = 'infernal-piano-scene';
  root.userData.realm = 'hell';
  root.userData.environment = 'black-water-rock';

  const waterUniforms: TimeUniforms = { uTime: { value: 0 } };
  const waterMaterial = createWaterMaterial(waterUniforms);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(180, 180, 96, 96), waterMaterial);
  water.name = 'infernal-black-water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.84;
  water.receiveShadow = true;
  root.add(water);

  const rockMaterial = new THREE.MeshStandardMaterial({
    name: 'wet-basalt-rock',
    color: 0x292326,
    vertexColors: true,
    metalness: 0.18,
    roughness: 0.82,
    envMapIntensity: 0.72,
  });
  const rock = shadowedMesh(root, 'infernal-piano-rock', createRockGeometry(), rockMaterial, [0, 0, 0]);
  const placementSurfaces: THREE.Object3D[] = [rock];
  const rockColliders = [
    new THREE.Box3(new THREE.Vector3(-6.6, -0.58, -5.45), new THREE.Vector3(6.6, 1.08, 5.45)),
    new THREE.Box3(new THREE.Vector3(-9.2, -0.86, -3.65), new THREE.Vector3(-5.7, 0.82, 3.8)),
    new THREE.Box3(new THREE.Vector3(5.7, -0.8, -3.85), new THREE.Vector3(9.15, 0.76, 3.5)),
    new THREE.Box3(new THREE.Vector3(-4.9, -0.92, -7.05), new THREE.Vector3(4.8, 0.78, -4.75)),
    new THREE.Box3(new THREE.Vector3(-4.6, -0.85, 4.65), new THREE.Vector3(4.7, 0.82, 6.8)),
  ];

  addLighting(root);
  const piano = createPiano();
  root.add(piano.group);
  const flames = createFlameBank(piano.group);
  const embers = createEmbers(piano.group);

  const interactionAnchor = new THREE.Object3D();
  interactionAnchor.name = 'infernal-piano-interaction-anchor';
  interactionAnchor.position.set(1.65, 1.35, 1.15);
  interactionAnchor.userData.interaction = 'play-original-score';
  interactionAnchor.userData.prompt = '聆听原创钢琴曲';
  interactionAnchor.userData.radius = 2.8;
  root.add(interactionAnchor);

  const keys = piano.keys;
  const update = (
    elapsed: number,
    delta: number,
    state: InfernalPianoPlaybackState,
  ): void => {
    const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    root.userData.lastFrameDelta = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.25) : 0;
    const activeNotes = normalizeActiveNotes(state.activeNotes);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!key) continue;
      const baseY = Number(key.userData.baseY);
      const pressed = state.playing && activeNotes.has(index);
      key.position.y = baseY - (pressed ? (key.userData.isBlack === true ? 0.048 : 0.062) : 0);
      key.rotation.x = pressed ? -0.026 : 0;
      key.userData.pressed = pressed;
    }
    waterUniforms.uTime.value = safeElapsed;
    water.position.y = -0.84 + Math.sin(safeElapsed * 0.22) * 0.018;
    embers.uniforms.uTime.value = safeElapsed;
    embers.points.rotation.y = Math.sin(safeElapsed * 0.08) * 0.08;
    updateFlames(flames, safeElapsed, state.playing, activeNotes.size);
  };

  update(0, 0, { playing: false, activeNotes: [] });
  const diagnostics = collectDiagnostics(
    root,
    keys.length,
    flames.anchors.length * 3,
    embers.count,
    rockColliders.length,
  );
  root.userData.diagnostics = diagnostics;

  return {
    root,
    rockColliders,
    placementSurfaces,
    interactionAnchor,
    keys,
    pianoKeys: keys,
    update,
    diagnostics,
  };
}
