import * as THREE from 'three';
import {
  isPointInLobbyPlot,
  LOBBY_PLOT_COUNT,
  LOBBY_PLOTS,
  LOBBY_PLOT_SIZE,
  LOBBY_WORLD_LIMIT,
  lobbyPlotById,
  PUBLIC_LOBBY_HALF_EXTENT,
  type LobbyPlotDefinition,
} from './lobby-neighborhood';

export type LobbyPlotVisualState = 'available' | 'occupied' | 'mine';

export interface LobbyNeighborhoodClaim {
  readonly plotId: string;
  /** Stable platform identity. Nicknames are display text and must never be used as identity. */
  readonly ownerId: string;
  readonly nickname: string;
  readonly isMine: boolean;
}

export interface LobbyNeighborhoodClaimComponent {
  readonly id: string;
  readonly ownerId: string;
  readonly nickname: string;
  readonly isMine: boolean;
  readonly plotIds: readonly string[];
  readonly labelX: number;
  readonly labelZ: number;
}

export interface LobbyNeighborhoodClaimSummary {
  readonly available: number;
  readonly occupied: number;
  readonly mine: number;
}

export interface LobbyNeighborhoodPalette {
  readonly publicSquare: THREE.ColorRepresentation;
  readonly available: THREE.ColorRepresentation;
  readonly occupied: THREE.ColorRepresentation;
  readonly mine: THREE.ColorRepresentation;
  /** Retained for theme compatibility; individual plot outlines are no longer rendered. */
  readonly plotBoundary: THREE.ColorRepresentation;
  readonly publicBoundary: THREE.ColorRepresentation;
  readonly worldBoundary: THREE.ColorRepresentation;
  readonly occupiedSign: THREE.ColorRepresentation;
  readonly mineSign: THREE.ColorRepresentation;
}

export const DEFAULT_LOBBY_NEIGHBORHOOD_PALETTE: LobbyNeighborhoodPalette = Object.freeze({
  publicSquare: '#f1eee6',
  available: '#d8e0da',
  occupied: '#8293a2',
  mine: '#e7b84e',
  plotBoundary: '#738078',
  publicBoundary: '#a68f63',
  worldBoundary: '#56616c',
  occupiedSign: '#526b7a',
  mineSign: '#b77b18',
});

interface NormalizedClaim {
  readonly plot: LobbyPlotDefinition;
  readonly ownerId: string;
  readonly nickname: string;
  readonly isMine: boolean;
}

interface HomeLabelRecord {
  readonly sprite: THREE.Sprite;
  readonly texture: THREE.CanvasTexture;
  readonly nickname: string;
  readonly isMine: boolean;
  readonly labelX: number;
  readonly labelZ: number;
}

const SURFACE_Y = 0.025;
const SURFACE_HEIGHT = 0.04;
const BOUNDARY_Y = 0.065;
const HOME_INNER_EXTENT = LOBBY_PLOT_SIZE * 1.5;
const LABEL_Y = 2.45;
const LABEL_WORLD_WIDTH = 6.4;
const LABEL_WORLD_HEIGHT = 1.6;
const LABEL_CANVAS_WIDTH = 1024;
const LABEL_CANVAS_HEIGHT = 256;
const PLOT_TINT_Y = SURFACE_Y + 0.004;

interface OwnerPastelCandidate {
  readonly hex: string;
}

function stableOwnerHash(value: string): bigint {
  const mask = 0xffff_ffff_ffff_ffffn;
  let hash = 0xcbf2_9ce4_8422_2325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x0000_0100_0000_01b3n) & mask;
  }
  hash = (hash + 0x9e37_79b9_7f4a_7c15n) & mask;
  hash = ((hash ^ (hash >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & mask;
  hash = ((hash ^ (hash >> 27n)) * 0x94d0_49bb_1331_11ebn) & mask;
  return (hash ^ (hash >> 31n)) & mask;
}

function ownerPastelCandidate(ownerId: string): OwnerPastelCandidate {
  const hash = stableOwnerHash(ownerId);
  const hue = Number(hash & 0xff_ffffn) / 0x100_0000;
  const saturation = 0.37 + (Number((hash >> 24n) & 0xffn) / 255) * 0.16;
  const lightness = 0.79 + (Number((hash >> 32n) & 0xffn) / 255) * 0.09;
  const color = new THREE.Color().setHSL(hue, saturation, lightness);
  return Object.freeze({ hex: `#${color.getHexString()}` });
}

/**
 * Maps one stable identity to a pastel without consulting the active owner set,
 * so joining, leaving, renaming and reloading can never recolor an existing home.
 */
export function lobbyOwnerPastelColor(ownerId: string): string {
  const normalized = typeof ownerId === 'string' ? ownerId.trim() : '';
  return ownerPastelCandidate(normalized || 'legacy-owner').hex;
}

/** Claim order, nickname and local `isMine` state never affect this mapping. */
export function assignLobbyOwnerPastelColors(ownerIds: Iterable<string>): ReadonlyMap<string, string> {
  const owners = [...new Set([...ownerIds]
    .map((ownerId) => typeof ownerId === 'string' ? ownerId.trim() : '')
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return new Map(owners.map((ownerId) => [ownerId, lobbyOwnerPastelColor(ownerId)]));
}

function createPlotTintGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(LOBBY_PLOT_SIZE, LOBBY_PLOT_SIZE);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function createContinuousHomeGroundGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-LOBBY_WORLD_LIMIT, -LOBBY_WORLD_LIMIT);
  shape.lineTo(LOBBY_WORLD_LIMIT, -LOBBY_WORLD_LIMIT);
  shape.lineTo(LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
  shape.lineTo(-LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
  shape.closePath();

  const plazaMargin = new THREE.Path();
  plazaMargin.moveTo(-HOME_INNER_EXTENT, -HOME_INNER_EXTENT);
  plazaMargin.lineTo(-HOME_INNER_EXTENT, HOME_INNER_EXTENT);
  plazaMargin.lineTo(HOME_INNER_EXTENT, HOME_INNER_EXTENT);
  plazaMargin.lineTo(HOME_INNER_EXTENT, -HOME_INNER_EXTENT);
  plazaMargin.closePath();
  shape.holes.push(plazaMargin);

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addRectangleSegments(
  positions: number[],
  colors: number[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  y: number,
  color: THREE.Color,
): void {
  const corners = [
    [minX, y, minZ],
    [maxX, y, minZ],
    [maxX, y, maxZ],
    [minX, y, maxZ],
  ] as const;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    if (!start || !end) continue;
    positions.push(...start, ...end);
    for (let vertex = 0; vertex < 2; vertex += 1) colors.push(color.r, color.g, color.b);
  }
}

/** Only the plaza and outer neighborhood limits remain visible. */
function createBoundaryGeometry(palette: LobbyNeighborhoodPalette): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  addRectangleSegments(
    positions,
    colors,
    -PUBLIC_LOBBY_HALF_EXTENT,
    -PUBLIC_LOBBY_HALF_EXTENT,
    PUBLIC_LOBBY_HALF_EXTENT,
    PUBLIC_LOBBY_HALF_EXTENT,
    BOUNDARY_Y + 0.006,
    new THREE.Color(palette.publicBoundary),
  );
  addRectangleSegments(
    positions,
    colors,
    -LOBBY_WORLD_LIMIT,
    -LOBBY_WORLD_LIMIT,
    LOBBY_WORLD_LIMIT,
    LOBBY_WORLD_LIMIT,
    BOUNDARY_Y + 0.012,
    new THREE.Color(palette.worldBoundary),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function normalizedNickname(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const printable = Array.from(normalized).filter((character) => character >= ' ').join('');
  const characters = Array.from(printable);
  return (characters.length > 16 ? `${characters.slice(0, 15).join('')}…` : printable) || '邻居';
}

function normalizedClaims(claims: readonly LobbyNeighborhoodClaim[]): NormalizedClaim[] {
  const byPlot = new Map<string, NormalizedClaim>();
  for (const claim of claims) {
    const plot = lobbyPlotById(claim.plotId);
    if (!plot) continue;
    const submittedOwnerId = typeof claim.ownerId === 'string' ? claim.ownerId.trim() : '';
    // Invalid legacy identity remains isolated to one plot and can never merge by nickname.
    const ownerId = submittedOwnerId || `legacy-plot:${plot.id}`;
    byPlot.set(plot.id, {
      plot,
      ownerId,
      nickname: normalizedNickname(claim.nickname),
      isMine: claim.isMine === true,
    });
  }
  return [...byPlot.values()].sort((left, right) => left.plot.index - right.plot.index);
}

function coordinateKey(gridX: number, gridZ: number): string {
  return `${gridX},${gridZ}`;
}

function labelPosition(plots: readonly LobbyPlotDefinition[]): Readonly<{ x: number; z: number }> {
  const centroidX = plots.reduce((total, plot) => total + plot.centerX, 0) / plots.length;
  const centroidZ = plots.reduce((total, plot) => total + plot.centerZ, 0) / plots.length;
  if (plots.some((plot) => isPointInLobbyPlot(plot, centroidX, centroidZ))) {
    return Object.freeze({ x: centroidX, z: centroidZ });
  }
  const medoid = [...plots].sort((left, right) => {
    const leftDistance = Math.hypot(left.centerX - centroidX, left.centerZ - centroidZ);
    const rightDistance = Math.hypot(right.centerX - centroidX, right.centerZ - centroidZ);
    return leftDistance - rightDistance || left.index - right.index;
  })[0];
  return Object.freeze({ x: medoid?.centerX ?? 0, z: medoid?.centerZ ?? 0 });
}

/**
 * Groups orthogonally adjacent plots by stable owner identity. A repeated
 * nickname never merges different players, while disconnected land owned by
 * one player keeps one label per connected component.
 */
export function groupLobbyNeighborhoodClaimComponents(
  claims: readonly LobbyNeighborhoodClaim[],
): readonly LobbyNeighborhoodClaimComponent[] {
  const claimsByOwner = new Map<string, NormalizedClaim[]>();
  for (const claim of normalizedClaims(claims)) {
    const ownerClaims = claimsByOwner.get(claim.ownerId) ?? [];
    ownerClaims.push(claim);
    claimsByOwner.set(claim.ownerId, ownerClaims);
  }

  const components: LobbyNeighborhoodClaimComponent[] = [];
  for (const [ownerId, ownerClaims] of claimsByOwner) {
    const byCoordinate = new Map(ownerClaims.map((claim) => [
      coordinateKey(claim.plot.gridX, claim.plot.gridZ),
      claim,
    ]));
    const visited = new Set<string>();
    for (const seed of ownerClaims) {
      if (visited.has(seed.plot.id)) continue;
      const queue: NormalizedClaim[] = [seed];
      const componentClaims: NormalizedClaim[] = [];
      visited.add(seed.plot.id);
      for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const current = queue[queueIndex];
        if (!current) continue;
        componentClaims.push(current);
        for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const neighbor = byCoordinate.get(coordinateKey(
            current.plot.gridX + offsetX,
            current.plot.gridZ + offsetZ,
          ));
          if (!neighbor || visited.has(neighbor.plot.id)) continue;
          visited.add(neighbor.plot.id);
          queue.push(neighbor);
        }
      }

      componentClaims.sort((left, right) => left.plot.index - right.plot.index);
      const plots = componentClaims.map((claim) => claim.plot);
      const plotIds = Object.freeze(plots.map((plot) => plot.id));
      const position = labelPosition(plots);
      components.push(Object.freeze({
        id: `${ownerId}:${plotIds.join('+')}`,
        ownerId,
        nickname: componentClaims[0]?.nickname ?? '邻居',
        isMine: componentClaims.some((claim) => claim.isMine),
        plotIds,
        labelX: position.x,
        labelZ: position.z,
      }));
    }
  }

  components.sort((left, right) => {
    const leftIndex = lobbyPlotById(left.plotIds[0] ?? '')?.index ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = lobbyPlotById(right.plotIds[0] ?? '')?.index ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.ownerId.localeCompare(right.ownerId);
  });
  return Object.freeze(components);
}

function fittedFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maximum: number,
  minimum: number,
  width: number,
): number {
  for (let size = maximum; size >= minimum; size -= 2) {
    context.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
    if (context.measureText(text).width <= width) return size;
  }
  return minimum;
}

function createNicknameTexture(
  component: LobbyNeighborhoodClaimComponent,
  palette: LobbyNeighborhoodPalette,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Lobby home labels require a 2D canvas context');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const size = fittedFontSize(context, component.nickname, 118, 62, canvas.width - 96);
  context.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  context.lineWidth = 16;
  context.strokeStyle = 'rgba(255, 255, 255, 0.94)';
  context.strokeText(component.nickname, canvas.width / 2, canvas.height / 2);
  context.fillStyle = `#${new THREE.Color(component.isMine ? palette.mineSign : palette.occupiedSign).getHexString()}`;
  context.fillText(component.nickname, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `LobbyHomeNickname:${component.plotIds[0] ?? component.ownerId}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Three.js view of the WhiteRoom neighborhood. Logical plots remain available
 * for permissions and picking, while one merged mesh renders a continuous
 * home region with no roads, gates or hard plot outlines. A single instanced
 * overlay adds owner-specific pastel regions without splitting the terrain.
 */
export class LobbyNeighborhoodScene {
  public readonly root = new THREE.Group();
  /** Hidden logical instances retained for stable instance-to-plot picking. */
  public readonly plotSurfaces: THREE.InstancedMesh;
  /** Visible owner tint instances; instance IDs always match canonical plot indices. */
  public readonly plotTints: THREE.InstancedMesh;

  private readonly palette: LobbyNeighborhoodPalette;
  private readonly publicSquareGeometry = new THREE.BoxGeometry(
    PUBLIC_LOBBY_HALF_EXTENT * 2,
    0.05,
    PUBLIC_LOBBY_HALF_EXTENT * 2,
  );
  private readonly publicSquareMaterial: THREE.MeshStandardMaterial;
  private readonly homeGroundGeometry = createContinuousHomeGroundGeometry();
  private readonly homeGroundMaterial: THREE.MeshStandardMaterial;
  private readonly plotGeometry = new THREE.BoxGeometry(LOBBY_PLOT_SIZE, SURFACE_HEIGHT, LOBBY_PLOT_SIZE);
  private readonly plotMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly plotTintGeometry = createPlotTintGeometry();
  private readonly plotTintMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private readonly boundaryGeometry: THREE.BufferGeometry;
  private readonly boundaryMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86 });
  private readonly labels = new THREE.Group();
  private readonly labelRecords = new Map<string, HomeLabelRecord>();
  private summary: LobbyNeighborhoodClaimSummary = Object.freeze({ available: LOBBY_PLOT_COUNT, occupied: 0, mine: 0 });
  private disposed = false;

  public constructor(palette: LobbyNeighborhoodPalette = DEFAULT_LOBBY_NEIGHBORHOOD_PALETTE) {
    this.palette = Object.freeze({ ...palette });
    this.root.name = 'LobbyNeighborhood';
    this.root.userData.plotIds = LOBBY_PLOTS.map((plot) => plot.id);
    this.root.userData.continuousHomeGround = true;

    this.publicSquareMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.publicSquare,
      roughness: 0.94,
      metalness: 0,
    });
    const publicSquare = new THREE.Mesh(this.publicSquareGeometry, this.publicSquareMaterial);
    publicSquare.name = 'LobbyPublicSquare';
    publicSquare.position.y = 0;
    publicSquare.receiveShadow = true;
    this.root.add(publicSquare);

    this.homeGroundMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.available,
      roughness: 0.9,
      metalness: 0.02,
    });
    const homeGround = new THREE.Mesh(this.homeGroundGeometry, this.homeGroundMaterial);
    homeGround.name = 'LobbyContinuousHomeGround';
    homeGround.position.y = SURFACE_Y;
    homeGround.receiveShadow = true;
    this.root.add(homeGround);

    this.plotTints = new THREE.InstancedMesh(
      this.plotTintGeometry,
      this.plotTintMaterial,
      LOBBY_PLOT_COUNT,
    );
    this.plotTints.name = 'LobbyHomePlotTints';
    this.plotTints.receiveShadow = true;
    this.plotTints.userData.instanceIdsMatchCanonicalPlotIndices = true;
    const tintColor = new THREE.Color(this.palette.available);
    const tintMatrix = new THREE.Matrix4();
    for (let index = 0; index < LOBBY_PLOTS.length; index += 1) {
      const plot = LOBBY_PLOTS[index];
      if (!plot) continue;
      tintMatrix.makeTranslation(plot.centerX, PLOT_TINT_Y, plot.centerZ);
      this.plotTints.setMatrixAt(index, tintMatrix);
      this.plotTints.setColorAt(index, tintColor);
    }
    this.plotTints.instanceMatrix.needsUpdate = true;
    if (this.plotTints.instanceColor) this.plotTints.instanceColor.needsUpdate = true;
    this.plotTints.computeBoundingSphere();
    this.root.add(this.plotTints);

    this.plotSurfaces = new THREE.InstancedMesh(this.plotGeometry, this.plotMaterial, LOBBY_PLOT_COUNT);
    this.plotSurfaces.name = 'LobbyPlotSurfaces';
    this.plotSurfaces.visible = false;
    this.plotSurfaces.userData.logicalOnly = true;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < LOBBY_PLOTS.length; index += 1) {
      const plot = LOBBY_PLOTS[index];
      if (!plot) continue;
      matrix.makeTranslation(plot.centerX, SURFACE_Y, plot.centerZ);
      this.plotSurfaces.setMatrixAt(index, matrix);
    }
    this.plotSurfaces.instanceMatrix.needsUpdate = true;
    this.plotSurfaces.computeBoundingSphere();
    this.root.add(this.plotSurfaces);

    this.boundaryGeometry = createBoundaryGeometry(this.palette);
    const boundaries = new THREE.LineSegments(this.boundaryGeometry, this.boundaryMaterial);
    boundaries.name = 'LobbyNeighborhoodBoundaries';
    this.root.add(boundaries);

    this.labels.name = 'LobbyHomeNicknameLabels';
    this.root.add(this.labels);
  }

  public attach(parent: THREE.Object3D): THREE.Group {
    this.assertActive();
    this.root.removeFromParent();
    parent.add(this.root);
    return this.root;
  }

  public updateClaims(claims: readonly LobbyNeighborhoodClaim[]): LobbyNeighborhoodClaimSummary {
    this.assertActive();
    const normalized = normalizedClaims(claims);
    const ownerColors = assignLobbyOwnerPastelColors(normalized.map((claim) => claim.ownerId));
    const claimByPlotId = new Map(normalized.map((claim) => [claim.plot.id, claim]));
    const tintColor = new THREE.Color();
    let occupied = 0;
    let mine = 0;
    for (let index = 0; index < LOBBY_PLOTS.length; index += 1) {
      const plot = LOBBY_PLOTS[index];
      if (!plot) continue;
      const claim = claimByPlotId.get(plot.id);
      if (claim?.isMine) mine += 1;
      else if (claim) occupied += 1;
      tintColor.set(claim ? ownerColors.get(claim.ownerId) ?? this.palette.available : this.palette.available);
      this.plotTints.setColorAt(index, tintColor);
    }
    if (this.plotTints.instanceColor) this.plotTints.instanceColor.needsUpdate = true;
    this.plotTints.userData.ownerColors = Object.fromEntries(ownerColors);

    const components = groupLobbyNeighborhoodClaimComponents(claims);
    const componentById = new Map(components.map((component) => [component.id, component]));
    for (const [componentId, record] of this.labelRecords) {
      const component = componentById.get(componentId);
      if (component
        && component.nickname === record.nickname
        && component.isMine === record.isMine
        && component.labelX === record.labelX
        && component.labelZ === record.labelZ) continue;
      this.destroyLabel(componentId, record);
    }
    for (const component of components) {
      if (this.labelRecords.has(component.id)) continue;
      this.labelRecords.set(component.id, this.createLabel(component));
    }

    this.summary = Object.freeze({
      available: LOBBY_PLOT_COUNT - occupied - mine,
      occupied,
      mine,
    });
    return this.summary;
  }

  public getClaimSummary(): LobbyNeighborhoodClaimSummary {
    return this.summary;
  }

  public plotForInstance(instanceId: number): LobbyPlotDefinition | null {
    return Number.isInteger(instanceId) && instanceId >= 0 ? LOBBY_PLOTS[instanceId] ?? null : null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.root.removeFromParent();
    for (const [componentId, record] of this.labelRecords) this.destroyLabel(componentId, record);
    this.publicSquareGeometry.dispose();
    this.publicSquareMaterial.dispose();
    this.homeGroundGeometry.dispose();
    this.homeGroundMaterial.dispose();
    this.plotGeometry.dispose();
    this.plotMaterial.dispose();
    this.plotTintGeometry.dispose();
    this.plotTintMaterial.dispose();
    this.boundaryGeometry.dispose();
    this.boundaryMaterial.dispose();
    this.root.clear();
    this.disposed = true;
  }

  private createLabel(component: LobbyNeighborhoodClaimComponent): HomeLabelRecord {
    const texture = createNicknameTexture(component, this.palette);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `LobbyHomeNickname:${component.plotIds[0] ?? component.ownerId}`;
    sprite.position.set(component.labelX, LABEL_Y, component.labelZ);
    sprite.scale.set(LABEL_WORLD_WIDTH, LABEL_WORLD_HEIGHT, 1);
    sprite.center.set(0.5, 0.5);
    sprite.userData.ownerId = component.ownerId;
    sprite.userData.plotIds = [...component.plotIds];
    sprite.userData.nickname = component.nickname;
    sprite.userData.isMine = component.isMine;
    this.labels.add(sprite);
    return {
      sprite,
      texture,
      nickname: component.nickname,
      isMine: component.isMine,
      labelX: component.labelX,
      labelZ: component.labelZ,
    };
  }

  private destroyLabel(componentId: string, record: HomeLabelRecord): void {
    record.sprite.removeFromParent();
    record.sprite.material.dispose();
    record.texture.dispose();
    this.labelRecords.delete(componentId);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('LobbyNeighborhoodScene has been disposed');
  }
}
