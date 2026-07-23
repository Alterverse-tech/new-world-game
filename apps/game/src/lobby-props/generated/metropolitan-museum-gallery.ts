import * as THREE from 'three';
import type { LobbyPhysicsDescriptor } from '../types';

export const code = 'metropolitan-museum-gallery';

export const physics = {
  body: 'fixed',
  mass: 0,
  friction: 1.05,
  restitution: 0.02,
  colliders: [
    { shape: 'box', halfExtents: [5.52, 0.08, 4.96], position: [0, 5.33, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.12, 2.6, 4.96], position: [-5.4, 2.76, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.12, 2.6, 4.96], position: [5.4, 2.76, 0], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [5.52, 2.6, 0.12], position: [0, 2.76, -4.84], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [1.72, 2.6, 0.12], position: [-3.8, 2.76, 4.84], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [1.72, 2.6, 0.12], position: [3.8, 2.76, 4.84], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.096, 2.2, 2], position: [-2.04, 2.36, -1.04], rotation: [0, 0, 0] },
    { shape: 'box', halfExtents: [0.096, 2.2, 2], position: [2.04, 2.36, -1.04], rotation: [0, 0, 0] },
  ],
} satisfies LobbyPhysicsDescriptor;

type Vec3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];
type ArtworkKey =
  | 'washington'
  | 'great-wave'
  | 'wheat-cypresses'
  | 'water-lilies'
  | 'madame-x'
  | 'death-of-socrates'
  | 'gulf-stream'
  | 'straw-hat-self-portrait'
  | 'irises'
  | 'musicians';

type ArtworkPlacement = {
  key: ArtworkKey;
  title: string;
  artist: string;
  size: readonly [number, number];
  position: Vec3;
  rotationY: number;
};

export const artworkCatalog = [
  { key: 'washington', title: '华盛顿横渡特拉华河', artist: 'Emanuel Leutze' },
  { key: 'great-wave', title: '神奈川冲浪里', artist: 'Katsushika Hokusai' },
  { key: 'wheat-cypresses', title: '有丝柏的麦田', artist: 'Vincent van Gogh' },
  { key: 'water-lilies', title: '睡莲池上的桥', artist: 'Claude Monet' },
  { key: 'madame-x', title: 'X夫人', artist: 'John Singer Sargent' },
  { key: 'death-of-socrates', title: '苏格拉底之死', artist: 'Jacques-Louis David' },
  { key: 'gulf-stream', title: '湾流', artist: 'Winslow Homer' },
  { key: 'straw-hat-self-portrait', title: '戴草帽的自画像', artist: 'Vincent van Gogh' },
  { key: 'irises', title: '鸢尾花', artist: 'Vincent van Gogh' },
  { key: 'musicians', title: '音乐家们', artist: 'Caravaggio' },
] as const;

const ARTWORKS: readonly ArtworkPlacement[] = [
  {
    key: 'washington', title: '华盛顿横渡特拉华河', artist: 'Emanuel Leutze',
    size: [2.6, 1.55], position: [0, 3.15, -5.84], rotationY: 0,
  },
  {
    key: 'great-wave', title: '神奈川冲浪里', artist: 'Katsushika Hokusai',
    size: [1.75, 1.2], position: [-4.58, 2.8, -5.84], rotationY: 0,
  },
  {
    key: 'death-of-socrates', title: '苏格拉底之死', artist: 'Jacques-Louis David',
    size: [2, 1.3], position: [4.45, 2.82, -5.84], rotationY: 0,
  },
  {
    key: 'wheat-cypresses', title: '有丝柏的麦田', artist: 'Vincent van Gogh',
    size: [1.7, 1.3], position: [-6.53, 2.72, -3.5], rotationY: Math.PI / 2,
  },
  {
    key: 'water-lilies', title: '睡莲池上的桥', artist: 'Claude Monet',
    size: [1.9, 1.3], position: [-6.53, 2.72, 0], rotationY: Math.PI / 2,
  },
  {
    key: 'straw-hat-self-portrait', title: '戴草帽的自画像', artist: 'Vincent van Gogh',
    size: [1.22, 1.62], position: [-6.53, 2.9, 3.55], rotationY: Math.PI / 2,
  },
  {
    key: 'madame-x', title: 'X夫人', artist: 'John Singer Sargent',
    size: [1.12, 1.9], position: [6.53, 3.02, -3.62], rotationY: -Math.PI / 2,
  },
  {
    key: 'gulf-stream', title: '湾流', artist: 'Winslow Homer',
    size: [1.85, 1.32], position: [6.53, 2.72, 0], rotationY: -Math.PI / 2,
  },
  {
    key: 'irises', title: '鸢尾花', artist: 'Vincent van Gogh',
    size: [1.25, 1.68], position: [6.53, 2.92, 3.55], rotationY: -Math.PI / 2,
  },
  {
    key: 'musicians', title: '音乐家们', artist: 'Caravaggio',
    size: [1.45, 1.35], position: [-2.72, 2.78, -1.35], rotationY: -Math.PI / 2,
  },
];

function addMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
  shadows = false,
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
  shadows = false,
): THREE.Mesh {
  return addMesh(parent, name, new THREE.BoxGeometry(...size), material, position, rotation, shadows);
}

function addCylinder(
  parent: THREE.Object3D,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  segments = 16,
): THREE.Mesh {
  return addMesh(
    parent,
    name,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    position,
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function blend(first: Rgb, second: Rgb, amount: number): Rgb {
  const safe = clamp01(amount);
  return [
    first[0] + (second[0] - first[0]) * safe,
    first[1] + (second[1] - first[1]) * safe,
    first[2] + (second[2] - first[2]) * safe,
  ];
}

function grain(u: number, v: number, salt: number): number {
  return Math.sin((u * 91.7 + v * 147.3 + salt * 17.9) * 12.9898) * 0.5 + 0.5;
}

function ellipse(u: number, v: number, centerX: number, centerY: number, radiusX: number, radiusY: number): boolean {
  const x = (u - centerX) / radiusX;
  const y = (v - centerY) / radiusY;
  return x * x + y * y <= 1;
}

function segmentDistance(
  u: number,
  v: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 0
    ? clamp01(((u - startX) * dx + (v - startY) * dy) / lengthSquared)
    : 0;
  const nearestX = startX + dx * projection;
  const nearestY = startY + dy * projection;
  return Math.hypot(u - nearestX, v - nearestY);
}

function washingtonColor(u: number, v: number): Rgb {
  let color = v < 0.54
    ? blend([221, 177, 148], [96, 123, 148], v / 0.54)
    : blend([64, 91, 112], [197, 210, 200], (v - 0.54) / 0.46);
  const ice = Math.sin(u * 31 + v * 19) * 0.018 + Math.sin(u * 9 - v * 27) * 0.012;
  if (v > 0.58 && Math.abs(v - (0.72 + ice)) < 0.018) color = [222, 230, 219];
  if (segmentDistance(u, v, 0.12, 0.8, 0.87, 0.68) < 0.035) color = [53, 40, 31];
  const figures = [0.31, 0.39, 0.47, 0.56, 0.66, 0.75];
  for (const [index, x] of figures.entries()) {
    const headY = 0.57 + (index % 2) * 0.035;
    if (ellipse(u, v, x, headY, 0.022, 0.034)) color = [220, 183, 145];
    if (segmentDistance(u, v, x, headY + 0.03, x - 0.01, 0.72) < 0.026) {
      color = index % 3 === 0 ? [124, 38, 34] : [42, 58, 67];
    }
  }
  if (ellipse(u, v, 0.54, 0.43, 0.027, 0.04)) color = [231, 193, 151];
  if (segmentDistance(u, v, 0.54, 0.46, 0.57, 0.67) < 0.038) color = [231, 220, 187];
  if (segmentDistance(u, v, 0.56, 0.49, 0.49, 0.67) < 0.018) color = [164, 37, 35];
  if (segmentDistance(u, v, 0.59, 0.58, 0.63, 0.25) < 0.012) color = [76, 54, 37];
  if (u > 0.63 && u < 0.77 && v > 0.24 && v < 0.32) {
    color = u < 0.68 ? [39, 72, 119] : (v < 0.27 ? [194, 42, 40] : [230, 224, 193]);
  }
  return blend(color, [245, 232, 205], grain(u, v, 1) * 0.08);
}

function greatWaveColor(u: number, v: number): Rgb {
  let color: Rgb = v < 0.58 ? [226, 211, 174] : [48, 103, 142];
  const seaBand = Math.sin(u * 26 + v * 13) * 0.026;
  if (v > 0.58 && Math.abs(v - (0.72 + seaBand)) < 0.018) color = [214, 223, 205];
  const dx = u - 0.31;
  const dy = v - 0.6;
  const radius = Math.hypot(dx, dy);
  if (u < 0.62 && v > 0.23 && Math.abs(radius - 0.29) < 0.075) color = [19, 63, 112];
  if (u < 0.59 && v > 0.2 && Math.abs(radius - 0.225) < 0.028) color = [225, 229, 207];
  const foamCenters = [[0.14, 0.28], [0.23, 0.23], [0.33, 0.22], [0.43, 0.27], [0.5, 0.33]] as const;
  for (const [x, y] of foamCenters) {
    if (ellipse(u, v, x, y, 0.055, 0.035)) color = [233, 231, 204];
  }
  const fujiWidth = Math.max(0, 0.13 - Math.abs(v - 0.49) * 0.55);
  if (v > 0.38 && v < 0.57 && Math.abs(u - 0.77) < fujiWidth) color = v < 0.43 ? [222, 223, 204] : [58, 92, 119];
  for (const shift of [0, 0.16]) {
    if (segmentDistance(u, v, 0.42 + shift, 0.76, 0.74 + shift * 0.5, 0.72) < 0.012) color = [45, 48, 45];
  }
  return blend(color, [238, 225, 192], grain(u, v, 2) * 0.07);
}

function wheatCypressesColor(u: number, v: number): Rgb {
  let color = v < 0.51
    ? blend([64, 140, 188], [183, 207, 205], v / 0.51)
    : blend([219, 170, 51], [151, 111, 42], (v - 0.51) / 0.49);
  const cloud = Math.sin(u * 16 + v * 21) + Math.sin(u * 31 - v * 17);
  if (v < 0.48 && cloud > 1.15) color = [226, 224, 192];
  const cypressWidth = 0.035 + Math.sin(v * 31) * 0.012 + (v - 0.15) * 0.025;
  if (v > 0.12 && v < 0.9 && Math.abs(u - (0.67 + Math.sin(v * 15) * 0.008)) < cypressWidth) {
    color = v < 0.65 ? [37, 77, 53] : [48, 91, 47];
  }
  for (const x of [0.17, 0.25, 0.35, 0.46, 0.55, 0.81, 0.9]) {
    const stalk = 0.62 + Math.sin(x * 43) * 0.08;
    if (segmentDistance(u, v, x, 0.97, x + 0.025, stalk) < 0.009) color = [232, 190, 65];
  }
  if (segmentDistance(u, v, 0, 0.72, 1, 0.61) < 0.025) color = [76, 111, 62];
  return blend(color, [242, 203, 92], grain(u, v, 3) * 0.1);
}

function waterLiliesColor(u: number, v: number): Rgb {
  let color = blend([62, 126, 126], [79, 88, 128], v);
  color = blend(color, [121, 158, 118], grain(u * 0.7, v * 1.2, 4) * 0.22);
  const bridgeY = 0.39 + (u - 0.5) * (u - 0.5) * 0.5;
  if (u > 0.08 && u < 0.92 && Math.abs(v - bridgeY) < 0.035) color = [70, 110, 61];
  if (u > 0.12 && u < 0.88 && v > bridgeY && v < bridgeY + 0.055) color = [104, 142, 72];
  const pads = [[0.14, 0.7], [0.29, 0.61], [0.43, 0.78], [0.58, 0.67], [0.71, 0.82], [0.85, 0.61]] as const;
  for (const [index, point] of pads.entries()) {
    const [x, y] = point;
    if (ellipse(u, v, x, y, 0.075, 0.026)) color = [74, 129, 78];
    if (ellipse(u, v, x + 0.015, y - 0.018, 0.015, 0.015)) color = index % 2 === 0 ? [221, 171, 183] : [235, 216, 177];
  }
  for (const x of [0.08, 0.19, 0.83, 0.94]) {
    if (segmentDistance(u, v, x, 0.08, x + 0.025, 0.56) < 0.014) color = [40, 92, 57];
  }
  return blend(color, [204, 192, 179], grain(u, v, 5) * 0.06);
}

function madameXColor(u: number, v: number): Rgb {
  let color: Rgb = blend([29, 23, 22], [48, 34, 31], u * 0.4 + v * 0.2);
  if (ellipse(u, v, 0.57, 0.2, 0.075, 0.09)) color = [226, 197, 166];
  if (segmentDistance(u, v, 0.53, 0.28, 0.47, 0.47) < 0.045) color = [218, 189, 161];
  const dressWidth = 0.08 + Math.max(0, v - 0.35) * 0.3;
  if (v > 0.31 && v < 0.95 && Math.abs(u - 0.5) < dressWidth) color = [24, 25, 28];
  if (segmentDistance(u, v, 0.45, 0.35, 0.69, 0.48) < 0.024) color = [222, 191, 160];
  if (segmentDistance(u, v, 0.68, 0.47, 0.76, 0.75) < 0.018) color = [218, 187, 157];
  if (u > 0.71 && u < 0.94 && Math.abs(v - 0.76) < 0.035) color = [113, 82, 55];
  if (segmentDistance(u, v, 0.76, 0.76, 0.76, 0.96) < 0.025) color = [86, 61, 42];
  if (ellipse(u, v, 0.54, 0.14, 0.065, 0.045)) color = [52, 37, 30];
  return blend(color, [185, 137, 101], grain(u, v, 6) * 0.045);
}

function deathOfSocratesColor(u: number, v: number): Rgb {
  let color: Rgb = v < 0.62 ? [64, 55, 52] : [123, 91, 61];
  if (u > 0.12 && u < 0.88 && v > 0.68 && v < 0.84) color = [175, 145, 104];
  const people = [[0.18, 0.48], [0.29, 0.52], [0.43, 0.44], [0.57, 0.38], [0.69, 0.49], [0.81, 0.46]] as const;
  for (const [index, point] of people.entries()) {
    const [x, y] = point;
    if (ellipse(u, v, x, y, 0.033, 0.05)) color = [221, 181, 141];
    if (segmentDistance(u, v, x, y + 0.05, x + (index % 2 ? 0.015 : -0.015), 0.73) < 0.055) {
      color = index === 3 ? [221, 214, 186] : (index % 3 === 0 ? [150, 46, 40] : [72, 91, 102]);
    }
  }
  if (segmentDistance(u, v, 0.57, 0.39, 0.61, 0.16) < 0.022) color = [222, 189, 151];
  if (segmentDistance(u, v, 0.61, 0.16, 0.61, 0.08) < 0.009) color = [220, 188, 148];
  if (ellipse(u, v, 0.48, 0.49, 0.025, 0.034)) color = [176, 168, 143];
  if (u < 0.12 && v > 0.25 && v < 0.88) color = [113, 35, 31];
  return blend(color, [236, 210, 171], grain(u, v, 7) * 0.055);
}

function gulfStreamColor(u: number, v: number): Rgb {
  let color = v < 0.43
    ? blend([66, 82, 91], [139, 123, 105], v / 0.43)
    : blend([25, 99, 111], [17, 61, 72], (v - 0.43) / 0.57);
  const wave = 0.66 + Math.sin(u * 28) * 0.035 + Math.sin(u * 57) * 0.018;
  if (Math.abs(v - wave) < 0.018) color = [211, 217, 190];
  if (u > 0.25 && u < 0.78 && v > 0.58 && v < 0.76 && v > 0.55 + u * 0.18 && v < 0.82 - u * 0.08) color = [116, 55, 34];
  if (ellipse(u, v, 0.52, 0.53, 0.035, 0.05)) color = [125, 75, 48];
  if (segmentDistance(u, v, 0.52, 0.57, 0.5, 0.71) < 0.038) color = [183, 118, 66];
  if (segmentDistance(u, v, 0.35, 0.37, 0.35, 0.72) < 0.012) color = [65, 45, 33];
  if (u > 0.35 && u < 0.57 && v > 0.36 && v < 0.47) color = [192, 180, 139];
  if (ellipse(u, v, 0.87, 0.62, 0.04, 0.025) || ellipse(u, v, 0.13, 0.72, 0.045, 0.024)) color = [35, 53, 51];
  return blend(color, [221, 205, 167], grain(u, v, 8) * 0.055);
}

function selfPortraitColor(u: number, v: number): Rgb {
  let color: Rgb = blend([54, 132, 125], [102, 152, 124], grain(u, v, 9) * 0.55);
  if (v > 0.72 && ellipse(u, v, 0.5, 0.92, 0.32, 0.28)) color = [52, 91, 105];
  if (ellipse(u, v, 0.5, 0.46, 0.2, 0.27)) color = blend([218, 161, 98], [190, 108, 62], v);
  if (ellipse(u, v, 0.5, 0.23, 0.29, 0.1)) color = [217, 172, 61];
  if (u > 0.28 && u < 0.72 && v > 0.2 && v < 0.27) color = [232, 193, 78];
  if (ellipse(u, v, 0.43, 0.43, 0.025, 0.016) || ellipse(u, v, 0.57, 0.43, 0.025, 0.016)) color = [35, 47, 45];
  if (segmentDistance(u, v, 0.5, 0.45, 0.48, 0.58) < 0.015) color = [160, 90, 51];
  if (v > 0.56 && ellipse(u, v, 0.5, 0.62, 0.16, 0.13)) color = [151, 73, 43];
  if (segmentDistance(u, v, 0.38, 0.66, 0.62, 0.66) < 0.014) color = [80, 48, 37];
  return blend(color, [239, 203, 119], grain(u, v, 10) * 0.075);
}

function irisesColor(u: number, v: number): Rgb {
  let color: Rgb = blend([80, 120, 58], [174, 119, 62], v * 0.48);
  const blooms = [[0.12, 0.31], [0.25, 0.48], [0.38, 0.26], [0.51, 0.55], [0.64, 0.33], [0.78, 0.49], [0.89, 0.24]] as const;
  for (const [index, point] of blooms.entries()) {
    const [x, y] = point;
    if (segmentDistance(u, v, x, y + 0.06, x + Math.sin(index) * 0.05, 0.96) < 0.012) color = [46, 96, 45];
    for (const shift of [-0.035, 0, 0.035]) {
      if (ellipse(u, v, x + shift, y + Math.abs(shift) * 0.7, 0.045, 0.05)) {
        color = index === 3 ? [230, 217, 176] : (index % 2 === 0 ? [63, 71, 161] : [91, 76, 177]);
      }
    }
    if (ellipse(u, v, x, y + 0.015, 0.018, 0.025)) color = [227, 171, 62];
  }
  if (v > 0.82) color = blend(color, [188, 104, 58], 0.45);
  return blend(color, [223, 174, 88], grain(u, v, 11) * 0.08);
}

function musiciansColor(u: number, v: number): Rgb {
  let color: Rgb = blend([23, 20, 18], [65, 43, 34], grain(u, v, 12) * 0.3);
  const faces = [[0.23, 0.33], [0.46, 0.27], [0.69, 0.35], [0.84, 0.29]] as const;
  for (const [index, point] of faces.entries()) {
    const [x, y] = point;
    if (ellipse(u, v, x, y, 0.065, 0.09)) color = [207, 158, 111];
    if (ellipse(u, v, x, y - 0.055, 0.075, 0.055)) color = [54, 37, 28];
    if (segmentDistance(u, v, x, y + 0.08, x + (index - 1.5) * 0.025, 0.88) < 0.09) {
      color = index % 2 === 0 ? [128, 42, 34] : [203, 181, 142];
    }
  }
  if (ellipse(u, v, 0.55, 0.66, 0.13, 0.17)) color = [154, 103, 51];
  if (ellipse(u, v, 0.55, 0.66, 0.05, 0.08)) color = [47, 32, 25];
  if (segmentDistance(u, v, 0.58, 0.55, 0.78, 0.17) < 0.022) color = [158, 106, 55];
  if (segmentDistance(u, v, 0.12, 0.66, 0.43, 0.74) < 0.016) color = [213, 191, 143];
  return blend(color, [222, 176, 118], grain(u, v, 13) * 0.045);
}

function artworkColor(key: ArtworkKey, u: number, v: number): Rgb {
  switch (key) {
    case 'washington': return washingtonColor(u, v);
    case 'great-wave': return greatWaveColor(u, v);
    case 'wheat-cypresses': return wheatCypressesColor(u, v);
    case 'water-lilies': return waterLiliesColor(u, v);
    case 'madame-x': return madameXColor(u, v);
    case 'death-of-socrates': return deathOfSocratesColor(u, v);
    case 'gulf-stream': return gulfStreamColor(u, v);
    case 'straw-hat-self-portrait': return selfPortraitColor(u, v);
    case 'irises': return irisesColor(u, v);
    case 'musicians': return musiciansColor(u, v);
  }
}

function createArtworkMosaic(key: ArtworkKey, width: number, height: number): THREE.InstancedMesh {
  const columns = 32;
  const rows = 24;
  const pixelWidth = width / columns;
  const pixelHeight = height / rows;
  const geometry = new THREE.PlaneGeometry(pixelWidth * 1.035, pixelHeight * 1.035);
  const material = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mosaic = new THREE.InstancedMesh(geometry, material, columns * rows);
  mosaic.name = `ArtworkCanvas-${key}`;
  mosaic.castShadow = false;
  mosaic.receiveShadow = false;
  const matrix = new THREE.Matrix4();
  const paint = new THREE.Color();
  let instance = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u = column / (columns - 1);
      const v = row / (rows - 1);
      const color = artworkColor(key, u, v);
      matrix.makeTranslation(
        -width * 0.5 + pixelWidth * (column + 0.5),
        height * 0.5 - pixelHeight * (row + 0.5),
        0.025,
      );
      mosaic.setMatrixAt(instance, matrix);
      paint.setRGB(color[0] / 255, color[1] / 255, color[2] / 255);
      mosaic.setColorAt(instance, paint);
      instance += 1;
    }
  }
  mosaic.instanceMatrix.needsUpdate = true;
  if (mosaic.instanceColor) mosaic.instanceColor.needsUpdate = true;
  return mosaic;
}

function createFrameGeometry(width: number, height: number): THREE.ShapeGeometry {
  const outerWidth = width + 0.34;
  const outerHeight = height + 0.34;
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-outerWidth * 0.5, -outerHeight * 0.5);
  frameShape.lineTo(outerWidth * 0.5, -outerHeight * 0.5);
  frameShape.lineTo(outerWidth * 0.5, outerHeight * 0.5);
  frameShape.lineTo(-outerWidth * 0.5, outerHeight * 0.5);
  frameShape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-width * 0.5, -height * 0.5);
  opening.lineTo(-width * 0.5, height * 0.5);
  opening.lineTo(width * 0.5, height * 0.5);
  opening.lineTo(width * 0.5, -height * 0.5);
  opening.closePath();
  frameShape.holes.push(opening);
  return new THREE.ShapeGeometry(frameShape);
}

function addArtwork(
  root: THREE.Object3D,
  placement: ArtworkPlacement,
  frameMaterial: THREE.Material,
  plaqueMaterial: THREE.Material,
  backingMaterial: THREE.Material,
): void {
  const [width, height] = placement.size;
  const galleryPiece = new THREE.Group();
  galleryPiece.name = `Artwork-${placement.key}`;
  galleryPiece.position.set(...placement.position);
  galleryPiece.rotation.y = placement.rotationY;
  galleryPiece.userData.kind = 'museum-artwork';
  galleryPiece.userData.title = placement.title;
  galleryPiece.userData.artist = placement.artist;

  addBox(
    galleryPiece,
    `ArtworkBacking-${placement.key}`,
    [width + 0.28, height + 0.28, 0.07],
    [0, 0, -0.025],
    backingMaterial,
  );
  galleryPiece.add(createArtworkMosaic(placement.key, width, height));
  addMesh(
    galleryPiece,
    `ArtworkFrame-${placement.key}`,
    createFrameGeometry(width, height),
    frameMaterial,
    [0, 0, 0.06],
  );
  const plaque = addBox(
    galleryPiece,
    `ArtworkPlaque-${placement.key}`,
    [Math.min(0.9, width * 0.6), 0.18, 0.045],
    [0, -height * 0.5 - 0.32, 0.07],
    plaqueMaterial,
    [0, 0, 0],
    false,
  );
  plaque.userData.title = placement.title;
  plaque.userData.artist = placement.artist;
  root.add(galleryPiece);
}

function addBlockLetter(
  parent: THREE.Object3D,
  letter: 'T' | 'H' | 'E' | 'M',
  originX: number,
  originY: number,
  material: THREE.Material,
  prefix: string,
): void {
  const addStroke = (name: string, width: number, height: number, x: number, y: number, angle = 0): void => {
    addBox(parent, `${prefix}-${letter}-${name}`, [width, height, 0.055], [originX + x, originY + y, 0], material, [0, 0, angle], false);
  };
  if (letter === 'T') {
    addStroke('top', 0.44, 0.07, 0, 0.2);
    addStroke('stem', 0.07, 0.45, 0, 0);
  } else if (letter === 'H') {
    addStroke('left', 0.07, 0.45, -0.17, 0);
    addStroke('right', 0.07, 0.45, 0.17, 0);
    addStroke('bar', 0.34, 0.07, 0, 0);
  } else if (letter === 'E') {
    addStroke('stem', 0.07, 0.45, -0.16, 0);
    addStroke('top', 0.35, 0.07, 0, 0.2);
    addStroke('middle', 0.3, 0.07, -0.02, 0);
    addStroke('bottom', 0.35, 0.07, 0, -0.2);
  } else {
    addStroke('left', 0.07, 0.45, -0.19, 0);
    addStroke('right', 0.07, 0.45, 0.19, 0);
    addStroke('diagonal-left', 0.28, 0.07, -0.095, 0.1, -0.82);
    addStroke('diagonal-right', 0.28, 0.07, 0.095, 0.1, 0.82);
  }
}

function addFacade(
  root: THREE.Object3D,
  stone: THREE.Material,
  darkStone: THREE.Material,
  bronze: THREE.Material,
  banner: THREE.Material,
): void {
  const facade = new THREE.Group();
  facade.name = 'FifthAvenueFacade';
  addBox(facade, 'FacadeLeftWing', [4.3, 6.5, 0.3], [-4.75, 3.45, 6.05], stone, [0, 0, 0], true);
  addBox(facade, 'FacadeRightWing', [4.3, 6.5, 0.3], [4.75, 3.45, 6.05], stone, [0, 0, 0], true);
  addBox(facade, 'FacadeEntablature', [13.8, 0.48, 0.54], [0, 5.95, 6.18], darkStone, [0, 0, 0], true);
  addBox(facade, 'FacadeCornice', [14.2, 0.2, 0.72], [0, 6.22, 6.18], stone, [0, 0, 0], true);
  addBox(facade, 'MainEntranceHeader', [5.4, 0.38, 0.42], [0, 5.15, 6.18], stone, [0, 0, 0], true);

  const entrance = new THREE.Group();
  entrance.name = 'MainEntrance';
  entrance.position.set(0, 0, 6.24);
  entrance.userData.kind = 'walkable-entrance';
  entrance.userData.clearWidth = 5.2;
  addBox(entrance, 'EntranceLeftPier', [0.34, 4.8, 0.42], [-2.72, 2.6, 0], stone, [0, 0, 0], true);
  addBox(entrance, 'EntranceRightPier', [0.34, 4.8, 0.42], [2.72, 2.6, 0], stone, [0, 0, 0], true);
  addMesh(
    entrance,
    'EntranceArch',
    new THREE.TorusGeometry(1.72, 0.2, 8, 30, Math.PI),
    stone,
    [0, 3.45, 0],
    [0, 0, 0],
    true,
  );
  root.add(entrance);

  for (const [index, x] of [-5.75, -4.55, -3.35, 3.35, 4.55, 5.75].entries()) {
    addCylinder(facade, `FacadeColumnShaft-${index}`, 0.23, 0.27, 4.45, [x, 2.65, 6.46], stone, 18);
    addCylinder(facade, `FacadeColumnBase-${index}`, 0.34, 0.36, 0.18, [x, 0.43, 6.46], darkStone, 18);
    addBox(facade, `FacadeColumnCapital-${index}`, [0.68, 0.22, 0.68], [x, 4.92, 6.46], stone);
  }

  const pedimentShape = new THREE.Shape();
  pedimentShape.moveTo(-3.55, -0.48);
  pedimentShape.lineTo(0, 0.78);
  pedimentShape.lineTo(3.55, -0.48);
  pedimentShape.closePath();
  addMesh(
    facade,
    'CentralPediment',
    new THREE.ExtrudeGeometry(pedimentShape, { depth: 0.26, bevelEnabled: false }),
    stone,
    [0, 6.78, 6.02],
    [0, 0, 0],
    true,
  );
  addBox(facade, 'PedimentBase', [7.5, 0.25, 0.58], [0, 6.36, 6.17], darkStone, [0, 0, 0], true);

  for (const [index, x] of [-4.9, 4.9].entries()) {
    addBox(facade, `MetBanner-${index}`, [1.18, 2.18, 0.08], [x, 3.2, 6.29], banner, [0, 0, 0], false);
    const monogram = new THREE.Group();
    monogram.name = `MetBannerMonogram-${index}`;
    monogram.position.set(x, 3.2, 6.35);
    addBlockLetter(monogram, 'M', 0, 0, bronze, `Banner-${index}`);
    facade.add(monogram);
  }

  const sign = new THREE.Group();
  sign.name = 'TheMetFacadeSign';
  sign.position.set(0, 5.68, 6.48);
  const letters = [
    ['T', -1.55], ['H', -1.03], ['E', -0.51], ['M', 0.32], ['E', 0.86], ['T', 1.38],
  ] as const;
  for (const [letter, x] of letters) addBlockLetter(sign, letter, x, 0, bronze, 'FacadeSign');
  facade.add(sign);
  root.add(facade);
}

function addStructure(
  root: THREE.Object3D,
  stone: THREE.Material,
  paleStone: THREE.Material,
  darkStone: THREE.Material,
  marble: THREE.Material,
  glass: THREE.Material,
): void {
  addBox(root, 'MuseumFoundation', [13.8, 0.2, 12.4], [0, 0.1, 0], marble, [0, 0, 0], true);
  addBox(root, 'MuseumLeftWall', [0.3, 6.5, 12.4], [-6.75, 3.45, 0], paleStone, [0, 0, 0], true);
  addBox(root, 'MuseumRightWall', [0.3, 6.5, 12.4], [6.75, 3.45, 0], paleStone, [0, 0, 0], true);
  addBox(root, 'MuseumBackWall', [13.8, 6.5, 0.3], [0, 3.45, -6.05], paleStone, [0, 0, 0], true);
  addBox(root, 'MuseumCeiling', [13.8, 0.18, 12.4], [0, 6.66, 0], stone, [0, 0, 0], true);
  addBox(root, 'MuseumRoofCap', [14.05, 0.16, 12.65], [0, 6.84, 0], darkStone, [0, 0, 0], true);
  addBox(root, 'LeftGalleryDivider', [0.24, 5.5, 5], [-2.55, 2.95, -1.3], paleStone, [0, 0, 0], true);
  addBox(root, 'RightGalleryDivider', [0.24, 5.5, 5], [2.55, 2.95, -1.3], paleStone, [0, 0, 0], true);

  addBox(root, 'CentralMarbleRunner', [4.55, 0.035, 11.5], [0, 0.23, 0], marble, [0, 0, 0], false);
  addBox(root, 'LeftGalleryFloor', [3.9, 0.03, 11.5], [-4.65, 0.225, 0], stone, [0, 0, 0], false);
  addBox(root, 'RightGalleryFloor', [3.9, 0.03, 11.5], [4.65, 0.225, 0], stone, [0, 0, 0], false);
  for (const x of [-2.25, 2.25]) {
    addBox(root, `FloorInlay-${x}`, [0.045, 0.02, 11.3], [x, 0.255, 0], darkStone, [0, 0, 0], false);
  }
  for (const z of [-4.5, -2.25, 0, 2.25, 4.5]) {
    addBox(root, `FloorCrossInlay-${z}`, [4.5, 0.02, 0.045], [0, 0.255, z], darkStone, [0, 0, 0], false);
  }

  for (const [index, z] of [-4.5, -1.5, 1.5, 4.5].entries()) {
    addBox(root, `SkylightWell-${index}`, [3.45, 0.1, 1.75], [0, 6.58, z], darkStone);
    addBox(root, `SkylightGlass-${index}`, [3.16, 0.045, 1.46], [0, 6.52, z], glass, [0, 0, 0], false);
  }

  for (const [index, z] of [-4.45, -1.5, 1.5, 4.45].entries()) {
    for (const x of [-2.28, 2.28]) {
      addCylinder(root, `InteriorColumn-${index}-${x}`, 0.14, 0.17, 5.5, [x, 2.95, z], stone, 14);
      addBox(root, `InteriorCapital-${index}-${x}`, [0.46, 0.18, 0.46], [x, 5.71, z], paleStone);
    }
  }
}

function addFrontSteps(root: THREE.Object3D, stone: THREE.Material, darkStone: THREE.Material): void {
  const steps = new THREE.Group();
  steps.name = 'FifthAvenueGrandSteps';
  const rows = [
    { width: 4.1, depth: 1.9, y: 0.04, z: 7.05, x: 3.85 },
    { width: 3.65, depth: 1.55, y: 0.1, z: 6.9, x: 3.65 },
    { width: 3.2, depth: 1.2, y: 0.16, z: 6.75, x: 3.45 },
    { width: 2.75, depth: 0.85, y: 0.22, z: 6.6, x: 3.25 },
  ] as const;
  for (const [index, row] of rows.entries()) {
    for (const side of [-1, 1]) {
      addBox(
        steps,
        `GrandStep-${index}-${side}`,
        [row.width, 0.08, row.depth],
        [row.x * side, row.y, row.z],
        index === 0 ? darkStone : stone,
      );
    }
  }
  addBox(steps, 'AccessibleEntranceRunner', [3.25, 0.025, 1.75], [0, 0.013, 6.95], darkStone, [0, 0, 0], false);
  for (const x of [-5.45, 5.45]) {
    addBox(steps, `StepPlinth-${x}`, [0.52, 0.64, 2.25], [x, 0.34, 6.95], stone);
  }
  root.add(steps);
}

function addGalleryFurniture(
  root: THREE.Object3D,
  walnut: THREE.Material,
  leather: THREE.Material,
  bronze: THREE.Material,
): void {
  for (const [index, z] of [-2.15, 1.55, 4.25].entries()) {
    addBox(root, `CentralBenchSeat-${index}`, [2.15, 0.25, 0.72], [0, 0.58, z], leather);
    addBox(root, `CentralBenchBase-${index}`, [1.7, 0.28, 0.5], [0, 0.34, z], walnut);
  }
  for (const [side, x] of [['Left', -4.55], ['Right', 4.55]] as const) {
    addBox(root, `${side}GalleryBenchSeat`, [1.8, 0.24, 0.62], [x, 0.56, 1.65], leather);
    addBox(root, `${side}GalleryBenchBase`, [1.38, 0.26, 0.42], [x, 0.33, 1.65], walnut);
  }
  addBox(root, 'InformationDesk', [1.8, 0.85, 0.62], [-1.25, 0.65, 4.85], walnut);
  addBox(root, 'InformationDeskTop', [1.92, 0.08, 0.72], [-1.25, 1.1, 4.85], bronze);
  const guidePlaque = addBox(root, 'CollectionGuidePlaque', [1.1, 0.64, 0.08], [1.2, 1.3, 4.92], bronze, [-0.18, 0, 0], false);
  guidePlaque.userData.prompt = '中央大厅 · 美国绘画、欧洲绘画与日本浮世绘';
}

function addGalleryLighting(root: THREE.Object3D, bronze: THREE.Material): void {
  const positions: readonly Vec3[] = [
    [0, 5.95, -3.8], [0, 5.95, 0], [0, 5.95, 3.8],
    [-4.4, 5.6, 0], [4.4, 5.6, 0],
  ];
  for (const [index, position] of positions.entries()) {
    const fixture = addCylinder(root, `GalleryLightFixture-${index}`, 0.19, 0.19, 0.11, position, bronze, 12);
    fixture.rotation.x = Math.PI / 2;
    const light = new THREE.PointLight(index < 3 ? '#fff0cf' : '#ffe4b0', index < 3 ? 1.5 : 1.15, 7.5, 2);
    light.name = `GalleryWarmLight-${index}`;
    light.position.set(position[0], position[1] - 0.16, position[2]);
    light.userData.baseIntensity = light.intensity;
    light.userData.phase = index * 0.8;
    root.add(light);
  }
}

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'MetropolitanMuseumGallery';
  const museum = new THREE.Group();
  museum.name = 'MetropolitanMuseumScaleModel';
  museum.scale.setScalar(0.8);
  root.add(museum);

  const stone = new THREE.MeshStandardMaterial({ color: '#cdbf9f', roughness: 0.78, metalness: 0.02 });
  const paleStone = new THREE.MeshStandardMaterial({ color: '#e4dccb', roughness: 0.86, metalness: 0.01 });
  const darkStone = new THREE.MeshStandardMaterial({ color: '#7d7464', roughness: 0.8, metalness: 0.03 });
  const marble = new THREE.MeshPhysicalMaterial({ color: '#d9d1c2', roughness: 0.28, metalness: 0.03, clearcoat: 0.28 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#a77d34', roughness: 0.25, metalness: 0.82 });
  const walnut = new THREE.MeshStandardMaterial({ color: '#4b2b1d', roughness: 0.62, metalness: 0.03 });
  const leather = new THREE.MeshStandardMaterial({ color: '#7a2730', roughness: 0.72, metalness: 0.02 });
  const banner = new THREE.MeshStandardMaterial({ color: '#9e1827', roughness: 0.72, metalness: 0.01 });
  const backing = new THREE.MeshStandardMaterial({ color: '#332517', roughness: 0.72, metalness: 0.05 });
  const plaque = new THREE.MeshStandardMaterial({ color: '#bba879', roughness: 0.5, metalness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#b9d3d4', roughness: 0.12, metalness: 0.06, transparent: true, opacity: 0.42,
    transmission: 0.25, depthWrite: false,
  });

  addStructure(museum, stone, paleStone, darkStone, marble, glass);
  addFacade(museum, stone, darkStone, bronze, banner);
  addFrontSteps(museum, stone, darkStone);
  addGalleryFurniture(museum, walnut, leather, bronze);
  for (const artwork of ARTWORKS) addArtwork(museum, artwork, bronze, plaque, backing);
  addGalleryLighting(museum, bronze);

  root.userData.museum = 'The Metropolitan Museum of Art · New York';
  root.userData.experience = 'walk-through-gallery';
  root.userData.entranceDirection = '+Z';
  root.userData.artworkCount = ARTWORKS.length;
  root.userData.artworkTitles = artworkCatalog.map((artwork) => artwork.title);
  root.userData.interactionState = 'gallery-open';
  return root;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  for (let index = 0; index < 5; index += 1) {
    const light = object.getObjectByName(`GalleryWarmLight-${index}`) as THREE.PointLight | undefined;
    if (!light) continue;
    const base = Number(light.userData.baseIntensity);
    const phase = Number(light.userData.phase);
    if (Number.isFinite(base) && Number.isFinite(phase)) {
      light.intensity = base * (0.97 + Math.sin(elapsed * 0.42 + phase) * 0.03);
    }
  }
}
