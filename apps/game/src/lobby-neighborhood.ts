export const PUBLIC_LOBBY_HALF_EXTENT = 15;
export const LOBBY_PLOT_SIZE = 12;
export const LOBBY_PLOT_SPACING = 12;
export const LOBBY_WORLD_LIMIT = 54;
export const LOBBY_LAYOUT_EPSILON = 1e-6;
export const LOBBY_PLOT_COUNT = 72;

/** Compatibility aliases for callers using the shorter geometry names. */
export const PUBLIC_HALF_EXTENT = PUBLIC_LOBBY_HALF_EXTENT;
export const PLOT_SIZE = LOBBY_PLOT_SIZE;
export const PLOT_SPACING = LOBBY_PLOT_SPACING;

export type LobbyPlotRing = 2 | 3 | 4;
export type LobbyNeighborhoodArea = 'public' | 'plot' | 'invalid';

export interface LobbyPlotEntrance {
  readonly position: Readonly<{ x: number; z: number }>;
  /** WhiteRoom yaw: zero faces -Z. */
  readonly yaw: number;
}

export interface LobbyPlotDefinition {
  readonly id: string;
  /** Stable, one-based slot number. */
  readonly index: number;
  readonly ring: LobbyPlotRing;
  readonly gridX: number;
  readonly gridZ: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly entranceX: number;
  readonly entranceZ: number;
  readonly entranceYaw: number;
  readonly entrance: LobbyPlotEntrance;
}

export type LobbyLocation =
  | Readonly<{ kind: 'public'; plot: null }>
  | Readonly<{ kind: 'plot'; plot: LobbyPlotDefinition }>
  | Readonly<{ kind: 'invalid'; plot: null }>;

export type LobbyNeighborhoodClassification = LobbyLocation;

export interface LobbyPlotUiData {
  readonly id: string;
  readonly index: number;
  readonly ring: LobbyPlotRing;
  readonly ringLabel: string;
  readonly gridX: number;
  readonly gridZ: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly coordinateLabel: string;
}

type GridCoordinate = readonly [gridX: number, gridZ: number];

const PLOT_HALF_EXTENT = LOBBY_PLOT_SIZE / 2;
const RINGS: readonly LobbyPlotRing[] = Object.freeze([2, 3, 4]);

function gridCoordinatesForRing(ring: LobbyPlotRing): GridCoordinate[] {
  const coordinates: GridCoordinate[] = [];

  // Clockwise from the north-west corner. Each corner appears exactly once.
  for (let gridX = -ring; gridX <= ring; gridX += 1) coordinates.push([gridX, -ring]);
  for (let gridZ = -ring + 1; gridZ <= ring; gridZ += 1) coordinates.push([ring, gridZ]);
  for (let gridX = ring - 1; gridX >= -ring; gridX -= 1) coordinates.push([gridX, ring]);
  for (let gridZ = ring - 1; gridZ > -ring; gridZ -= 1) coordinates.push([-ring, gridZ]);

  return coordinates;
}

function plotId(index: number): string {
  return `plot-${index.toString().padStart(3, '0')}`;
}

function entranceFacingOrigin(centerX: number, centerZ: number): LobbyPlotEntrance {
  const radialExtent = Math.max(Math.abs(centerX), Math.abs(centerZ));
  const inwardScale = PLOT_HALF_EXTENT / radialExtent;
  const x = centerX * (1 - inwardScale);
  const z = centerZ * (1 - inwardScale);

  return Object.freeze({
    position: Object.freeze({ x, z }),
    // A WhiteRoom actor faces (-sin(yaw), -cos(yaw)); this points at the origin.
    yaw: Math.atan2(x, z),
  });
}

function createPlot(index: number, ring: LobbyPlotRing, coordinate: GridCoordinate): LobbyPlotDefinition {
  const [gridX, gridZ] = coordinate;
  const centerX = gridX * LOBBY_PLOT_SPACING;
  const centerZ = gridZ * LOBBY_PLOT_SPACING;
  const entrance = entranceFacingOrigin(centerX, centerZ);

  return Object.freeze({
    id: plotId(index),
    index,
    ring,
    gridX,
    gridZ,
    centerX,
    centerZ,
    minX: centerX - PLOT_HALF_EXTENT,
    maxX: centerX + PLOT_HALF_EXTENT,
    minZ: centerZ - PLOT_HALF_EXTENT,
    maxZ: centerZ + PLOT_HALF_EXTENT,
    entranceX: entrance.position.x,
    entranceZ: entrance.position.z,
    entranceYaw: entrance.yaw,
    entrance,
  });
}

/**
 * Generates the canonical 72 plots in stable ID order.
 *
 * Rings are emitted from 2 through 4. A ring begins at its north-west corner
 * and proceeds clockwise. Public and plot edges are closed with
 * LOBBY_LAYOUT_EPSILON tolerance; the public square always wins classification.
 * Plot size matches grid spacing, so neighboring home slots share an edge and
 * can be assembled into one continuous build area without roads or gaps. A
 * shared edge resolves to the first plot in canonical stable-ID order.
 */
export function generateLobbyPlotDefinitions(): readonly LobbyPlotDefinition[] {
  const plots: LobbyPlotDefinition[] = [];
  for (const ring of RINGS) {
    for (const coordinate of gridCoordinatesForRing(ring)) {
      plots.push(createPlot(plots.length + 1, ring, coordinate));
    }
  }
  if (plots.length !== LOBBY_PLOT_COUNT) throw new Error('Lobby plot layout must contain exactly 72 slots');
  return Object.freeze(plots);
}

export const LOBBY_PLOTS = generateLobbyPlotDefinitions();

const PLOT_BY_ID = new Map(LOBBY_PLOTS.map((plot) => [plot.id, plot]));

function finitePoint(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z);
}

function within(value: number, min: number, max: number): boolean {
  return value >= min - LOBBY_LAYOUT_EPSILON && value <= max + LOBBY_LAYOUT_EPSILON;
}

export function lobbyPlotById(id: string): LobbyPlotDefinition | null {
  return PLOT_BY_ID.get(id) ?? null;
}

export const getLobbyPlotById = lobbyPlotById;

export function isPointInPublicLobby(x: number, z: number): boolean {
  return finitePoint(x, z)
    && within(x, -PUBLIC_LOBBY_HALF_EXTENT, PUBLIC_LOBBY_HALF_EXTENT)
    && within(z, -PUBLIC_LOBBY_HALF_EXTENT, PUBLIC_LOBBY_HALF_EXTENT);
}

export function isPointWithinLobbyWorld(x: number, z: number): boolean {
  return finitePoint(x, z)
    && within(x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT)
    && within(z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
}

export function isPointInLobbyPlot(plot: LobbyPlotDefinition, x: number, z: number): boolean {
  return finitePoint(x, z)
    && within(x, plot.minX, plot.maxX)
    && within(z, plot.minZ, plot.maxZ);
}

export function classifyLobbyLocation(x: number, z: number): LobbyLocation {
  if (isPointInPublicLobby(x, z)) return { kind: 'public', plot: null };
  if (!isPointWithinLobbyWorld(x, z)) return { kind: 'invalid', plot: null };
  const plot = LOBBY_PLOTS.find((candidate) => isPointInLobbyPlot(candidate, x, z)) ?? null;
  return plot ? { kind: 'plot', plot } : { kind: 'invalid', plot: null };
}

export const classifyLobbyPosition = classifyLobbyLocation;

export function toLobbyPlotUiData(plot: LobbyPlotDefinition): LobbyPlotUiData {
  return Object.freeze({
    id: plot.id,
    index: plot.index,
    ring: plot.ring,
    ringLabel: `R${plot.ring}`,
    gridX: plot.gridX,
    gridZ: plot.gridZ,
    centerX: plot.centerX,
    centerZ: plot.centerZ,
    coordinateLabel: `X ${plot.centerX} · Z ${plot.centerZ}`,
  });
}

export function getLobbyPlotUiData(id: string): LobbyPlotUiData | null {
  const plot = lobbyPlotById(id);
  return plot ? toLobbyPlotUiData(plot) : null;
}

export function listLobbyPlotUiData(): readonly LobbyPlotUiData[] {
  return Object.freeze(LOBBY_PLOTS.map(toLobbyPlotUiData));
}
