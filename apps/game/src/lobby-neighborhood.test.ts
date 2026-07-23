import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  classifyLobbyLocation,
  generateLobbyPlotDefinitions,
  getLobbyPlotUiData,
  isPointInLobbyPlot,
  isPointInPublicLobby,
  isPointWithinLobbyWorld,
  LOBBY_LAYOUT_EPSILON,
  LOBBY_PLOT_COUNT,
  LOBBY_PLOTS,
  LOBBY_PLOT_SIZE,
  LOBBY_PLOT_SPACING,
  LOBBY_WORLD_LIMIT,
  listLobbyPlotUiData,
  lobbyPlotById,
  PUBLIC_LOBBY_HALF_EXTENT,
} from './lobby-neighborhood';
import {
  assignLobbyOwnerPastelColors,
  DEFAULT_LOBBY_NEIGHBORHOOD_PALETTE,
  groupLobbyNeighborhoodClaimComponents,
  LobbyNeighborhoodScene,
  lobbyOwnerPastelColor,
} from './lobby-neighborhood-scene';

function installCanvasDocument(): void {
  const context = {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: (text: string) => ({ width: [...text].length * 64 }),
    textAlign: 'center',
    textBaseline: 'middle',
    lineJoin: 'round',
    font: '',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
  };
  vi.stubGlobal('document', {
    createElement: (name: string) => {
      if (name !== 'canvas') throw new Error(`Unexpected test element: ${name}`);
      return { width: 0, height: 0, getContext: () => context };
    },
  });
}

function colorDistance(left: THREE.Color, right: THREE.Color): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

afterEach(() => vi.unstubAllGlobals());

describe('lobby neighborhood layout', () => {
  it('generates 72 stable one-based slots in clockwise ring order', () => {
    const generated = generateLobbyPlotDefinitions();

    expect(generated).toHaveLength(LOBBY_PLOT_COUNT);
    expect(generated.map((plot) => plot.id)).toEqual(
      Array.from({ length: 72 }, (_, index) => `plot-${(index + 1).toString().padStart(3, '0')}`),
    );
    expect(generated.map((plot) => plot.index)).toEqual(Array.from({ length: 72 }, (_, index) => index + 1));
    expect(generated.filter((plot) => plot.ring === 2)).toHaveLength(16);
    expect(generated.filter((plot) => plot.ring === 3)).toHaveLength(24);
    expect(generated.filter((plot) => plot.ring === 4)).toHaveLength(32);

    expect(generated[0]).toMatchObject({ id: 'plot-001', ring: 2, gridX: -2, gridZ: -2 });
    expect(generated[4]).toMatchObject({ id: 'plot-005', ring: 2, gridX: 2, gridZ: -2 });
    expect(generated[8]).toMatchObject({ id: 'plot-009', ring: 2, gridX: 2, gridZ: 2 });
    expect(generated[12]).toMatchObject({ id: 'plot-013', ring: 2, gridX: -2, gridZ: 2 });
    expect(generated[15]).toMatchObject({ id: 'plot-016', ring: 2, gridX: -2, gridZ: -1 });
    expect(generated[16]).toMatchObject({ id: 'plot-017', ring: 3, gridX: -3, gridZ: -3 });
    expect(generated[40]).toMatchObject({ id: 'plot-041', ring: 4, gridX: -4, gridZ: -4 });
    expect(generated[71]).toMatchObject({ id: 'plot-072', ring: 4, gridX: -4, gridZ: -3 });
    expect(generated).toEqual(LOBBY_PLOTS);
  });

  it('keeps every square on the spacing grid and inside the 54-unit world limit', () => {
    expect(LOBBY_PLOT_SIZE).toBe(LOBBY_PLOT_SPACING);
    for (const plot of LOBBY_PLOTS) {
      expect(plot.centerX).toBe(plot.gridX * LOBBY_PLOT_SPACING);
      expect(plot.centerZ).toBe(plot.gridZ * LOBBY_PLOT_SPACING);
      expect(plot.maxX - plot.minX).toBe(LOBBY_PLOT_SIZE);
      expect(plot.maxZ - plot.minZ).toBe(LOBBY_PLOT_SIZE);
      expect(Math.max(Math.abs(plot.gridX), Math.abs(plot.gridZ))).toBe(plot.ring);
      expect(plot.minX).toBeGreaterThanOrEqual(-54);
      expect(plot.maxX).toBeLessThanOrEqual(54);
      expect(plot.minZ).toBeGreaterThanOrEqual(-54);
      expect(plot.maxZ).toBeLessThanOrEqual(54);
    }

    expect(LOBBY_WORLD_LIMIT).toBe(54);
    expect(isPointWithinLobbyWorld(54, -54)).toBe(true);
    expect(isPointWithinLobbyWorld(54 + LOBBY_LAYOUT_EPSILON / 2, 0)).toBe(true);
    expect(isPointWithinLobbyWorld(54 + LOBBY_LAYOUT_EPSILON * 2, 0)).toBe(false);
  });

  it('looks up only canonical IDs and exposes compact UI coordinates', () => {
    expect(lobbyPlotById('plot-001')).toBe(LOBBY_PLOTS[0]);
    expect(lobbyPlotById('plot-072')).toBe(LOBBY_PLOTS[71]);
    expect(lobbyPlotById('plot-000')).toBeNull();
    expect(lobbyPlotById('PLOT-001')).toBeNull();

    expect(getLobbyPlotUiData('plot-041')).toEqual({
      id: 'plot-041',
      index: 41,
      ring: 4,
      ringLabel: 'R4',
      gridX: -4,
      gridZ: -4,
      centerX: -48,
      centerZ: -48,
      coordinateLabel: 'X -48 · Z -48',
    });
    expect(getLobbyPlotUiData('plot-999')).toBeNull();
    expect(listLobbyPlotUiData()).toHaveLength(72);
    expect(listLobbyPlotUiData()[71]).toMatchObject({ id: 'plot-072', ring: 4, gridX: -4, gridZ: -3 });
  });

  it('classifies the closed public square first, including its epsilon boundary', () => {
    expect(PUBLIC_LOBBY_HALF_EXTENT).toBe(15);
    expect(isPointInPublicLobby(0, 0)).toBe(true);
    expect(isPointInPublicLobby(15, -15)).toBe(true);
    expect(classifyLobbyLocation(15 + LOBBY_LAYOUT_EPSILON / 2, 0)).toEqual({ kind: 'public', plot: null });
    expect(classifyLobbyLocation(-15, 15)).toEqual({ kind: 'public', plot: null });
    expect(classifyLobbyLocation(Number.NaN, 0)).toEqual({ kind: 'invalid', plot: null });
    expect(classifyLobbyLocation(0, Number.POSITIVE_INFINITY)).toEqual({ kind: 'invalid', plot: null });
  });

  it('joins neighboring plots edge-to-edge while preserving the public-square margin', () => {
    const east = lobbyPlotById('plot-007');
    const northWest = lobbyPlotById('plot-001');
    const northNext = lobbyPlotById('plot-002');
    expect(east).not.toBeNull();
    expect(northWest).not.toBeNull();
    expect(northNext).not.toBeNull();
    if (!east || !northWest || !northNext) throw new Error('Expected canonical plots');

    expect(classifyLobbyLocation(16, 0)).toEqual({ kind: 'invalid', plot: null });
    expect(classifyLobbyLocation(18, 0)).toEqual({ kind: 'plot', plot: east });
    expect(classifyLobbyLocation(19, 0)).toEqual({ kind: 'plot', plot: east });
    expect(classifyLobbyLocation(east.minX - LOBBY_LAYOUT_EPSILON / 2, 0)).toEqual({ kind: 'plot', plot: east });
    expect(classifyLobbyLocation(east.minX - LOBBY_LAYOUT_EPSILON * 2, 0)).toEqual({ kind: 'invalid', plot: null });

    expect(northWest.maxX).toBe(-18);
    expect(northNext.minX).toBe(-18);
    expect(classifyLobbyLocation(-18, -24)).toEqual({ kind: 'plot', plot: northWest });
    expect(isPointInLobbyPlot(northWest, northWest.maxX, -24)).toBe(true);
    expect(isPointInLobbyPlot(northNext, northNext.minX, -24)).toBe(true);
    expect(classifyLobbyLocation(54, 0).kind).toBe('plot');
    expect(classifyLobbyLocation(55, 0)).toEqual({ kind: 'invalid', plot: null });
  });

  it('places every entrance on the inward boundary and aims WhiteRoom -Z forward at the origin', () => {
    for (const plot of LOBBY_PLOTS) {
      const { x, z } = plot.entrance.position;
      expect(isPointInLobbyPlot(plot, x, z)).toBe(true);
      expect({ x, z, yaw: plot.entrance.yaw }).toEqual({
        x: plot.entranceX,
        z: plot.entranceZ,
        yaw: plot.entranceYaw,
      });
      const onBoundary = [plot.minX, plot.maxX].some((edge) => Math.abs(x - edge) <= LOBBY_LAYOUT_EPSILON)
        || [plot.minZ, plot.maxZ].some((edge) => Math.abs(z - edge) <= LOBBY_LAYOUT_EPSILON);
      expect(onBoundary).toBe(true);
      expect(Math.hypot(x, z)).toBeLessThan(Math.hypot(plot.centerX, plot.centerZ));

      const targetLength = Math.hypot(x, z);
      const targetX = -x / targetLength;
      const targetZ = -z / targetLength;
      const forwardX = -Math.sin(plot.entrance.yaw);
      const forwardZ = -Math.cos(plot.entrance.yaw);
      expect(forwardX * targetX + forwardZ * targetZ).toBeCloseTo(1, 12);
    }

    expect(lobbyPlotById('plot-003')).toMatchObject({ entranceX: 0, entranceZ: -18, entranceYaw: Math.PI });
    expect(lobbyPlotById('plot-007')).toMatchObject({ entranceX: 18, entranceZ: 0, entranceYaw: Math.PI / 2 });
    expect(lobbyPlotById('plot-011')).toMatchObject({ entranceX: 0, entranceZ: 18, entranceYaw: 0 });
    expect(lobbyPlotById('plot-015')).toMatchObject({ entranceX: -18, entranceZ: 0, entranceYaw: -Math.PI / 2 });
    expect(lobbyPlotById('plot-001')).toMatchObject({ entranceX: -18, entranceZ: -18, entranceYaw: -3 * Math.PI / 4 });
  });
});

describe('lobby neighborhood owner labels', () => {
  it('renders a merged home surface without plot outlines or gate objects', () => {
    const neighborhood = new LobbyNeighborhoodScene();
    const continuousGround = neighborhood.root.getObjectByName('LobbyContinuousHomeGround');

    expect(continuousGround).toBeInstanceOf(THREE.Mesh);
    const groundGeometry = (continuousGround as THREE.Mesh).geometry;
    const positions = groundGeometry.getAttribute('position');
    const indices = groundGeometry.index?.array ?? Array.from({ length: positions.count }, (_, index) => index);
    let projectedArea = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const a = Number(indices[index]);
      const b = Number(indices[index + 1]);
      const c = Number(indices[index + 2]);
      projectedArea += Math.abs(
        (positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a))
        - (positions.getZ(b) - positions.getZ(a)) * (positions.getX(c) - positions.getX(a)),
      ) / 2;
    }
    expect(projectedArea).toBeCloseTo(108 * 108 - 36 * 36, 5);
    expect(neighborhood.plotSurfaces.visible).toBe(false);
    expect(neighborhood.plotTints.name).toBe('LobbyHomePlotTints');
    expect(neighborhood.plotTints.count).toBe(72);
    expect(neighborhood.plotTints.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect((neighborhood.plotTints.material as THREE.MeshStandardMaterial).vertexColors).toBe(false);
    expect(neighborhood.plotTints.userData.instanceIdsMatchCanonicalPlotIndices).toBe(true);
    expect(neighborhood.root.getObjectByName('LobbyClaimedPlotEntranceFrames')).toBeUndefined();
    expect(neighborhood.root.getObjectByName('LobbyClaimedPlotSigns')).toBeUndefined();
    expect(neighborhood.root.getObjectByName('LobbyHomeNicknameLabels')).toBeDefined();
    expect(neighborhood.updateClaims([])).toEqual({ available: 72, occupied: 0, mine: 0 });

    neighborhood.dispose();
  });

  it('assigns deterministic, unique light colors without using nickname or local ownership', () => {
    const owners = Array.from({ length: 72 }, (_, index) => `owner-${String(index).padStart(3, '0')}`);
    const forward = assignLobbyOwnerPastelColors(owners);
    const reversed = assignLobbyOwnerPastelColors([...owners].reverse());

    expect(forward.size).toBe(72);
    expect(new Set(forward.values()).size).toBe(72);
    expect([...forward]).toEqual([...reversed]);
    for (const owner of owners) {
      const value = forward.get(owner);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
      const hsl = { h: 0, s: 0, l: 0 };
      new THREE.Color(value).getHSL(hsl);
      expect(hsl.s).toBeGreaterThanOrEqual(0.36);
      expect(hsl.s).toBeLessThanOrEqual(0.55);
      expect(hsl.l).toBeGreaterThanOrEqual(0.78);
      expect(hsl.l).toBeLessThanOrEqual(0.89);
    }
  });

  it('keeps an owner color fixed as other owners join and leave', () => {
    const alone = assignLobbyOwnerPastelColors(['alice']).get('alice');
    const withBob = assignLobbyOwnerPastelColors(['alice', 'bob']).get('alice');
    const withMoreOwners = assignLobbyOwnerPastelColors(['carol', 'bob', 'alice']).get('alice');
    const afterBobLeaves = assignLobbyOwnerPastelColors(['carol', 'alice']).get('alice');

    expect(alone).toBe(lobbyOwnerPastelColor('alice'));
    expect(withBob).toBe(alone);
    expect(withMoreOwners).toBe(alone);
    expect(afterBobLeaves).toBe(alone);
  });

  it('renders one owner color across adjacent and disconnected plots while separating owners', () => {
    installCanvasDocument();
    const neighborhood = new LobbyNeighborhoodScene();
    const claims = [
      { plotId: 'plot-001', ownerId: 'owner-a', nickname: '甲', isMine: true },
      { plotId: 'plot-002', ownerId: 'owner-a', nickname: '改名也同色', isMine: false },
      { plotId: 'plot-003', ownerId: 'owner-b', nickname: '乙', isMine: false },
      { plotId: 'plot-005', ownerId: 'owner-a', nickname: '甲', isMine: true },
    ];
    expect(neighborhood.updateClaims(claims)).toEqual({ available: 68, occupied: 2, mine: 2 });

    const first = new THREE.Color();
    const second = new THREE.Color();
    const third = new THREE.Color();
    const disconnected = new THREE.Color();
    const available = new THREE.Color();
    neighborhood.plotTints.getColorAt(0, first);
    neighborhood.plotTints.getColorAt(1, second);
    neighborhood.plotTints.getColorAt(2, third);
    neighborhood.plotTints.getColorAt(4, disconnected);
    neighborhood.plotTints.getColorAt(3, available);
    expect(colorDistance(first, second)).toBeLessThan(1e-7);
    expect(colorDistance(first, disconnected)).toBeLessThan(1e-7);
    expect(colorDistance(first, third)).toBeGreaterThan(0.04);
    expect(colorDistance(available, new THREE.Color(DEFAULT_LOBBY_NEIGHBORHOOD_PALETTE.available))).toBeLessThan(1e-7);

    neighborhood.updateClaims([...claims].reverse().map((claim) => ({
      ...claim,
      nickname: `新-${claim.nickname}`,
      isMine: !claim.isMine,
    })));
    const afterMetadataChange = new THREE.Color();
    neighborhood.plotTints.getColorAt(0, afterMetadataChange);
    expect(colorDistance(afterMetadataChange, first)).toBeLessThan(1e-7);

    neighborhood.updateClaims(claims.filter((claim) => claim.plotId !== 'plot-002'));
    const released = new THREE.Color();
    neighborhood.plotTints.getColorAt(1, released);
    expect(colorDistance(released, new THREE.Color(DEFAULT_LOBBY_NEIGHBORHOOD_PALETTE.available))).toBeLessThan(1e-7);

    neighborhood.dispose();
    neighborhood.dispose();
  });

  it('collapses adjacent plots owned by the same identity into one nickname label', () => {
    const components = groupLobbyNeighborhoodClaimComponents([
      { plotId: 'plot-001', ownerId: 'owner-a', nickname: '小白', isMine: true },
      { plotId: 'plot-002', ownerId: 'owner-a', nickname: '小白', isMine: true },
    ]);

    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      ownerId: 'owner-a',
      nickname: '小白',
      isMine: true,
      plotIds: ['plot-001', 'plot-002'],
      labelX: -18,
      labelZ: -24,
    });
  });

  it('never merges different owners that happen to use the same nickname', () => {
    const components = groupLobbyNeighborhoodClaimComponents([
      { plotId: 'plot-001', ownerId: 'owner-a', nickname: '小白', isMine: false },
      { plotId: 'plot-002', ownerId: 'owner-b', nickname: '小白', isMine: false },
    ]);

    expect(components).toHaveLength(2);
    expect(components.map((component) => component.ownerId)).toEqual(['owner-a', 'owner-b']);
  });

  it('keeps disconnected land by one owner as separate labeled components', () => {
    const components = groupLobbyNeighborhoodClaimComponents([
      { plotId: 'plot-001', ownerId: 'owner-a', nickname: '小白', isMine: false },
      { plotId: 'plot-005', ownerId: 'owner-a', nickname: '小白', isMine: false },
    ]);

    expect(components).toHaveLength(2);
    expect(components.map((component) => component.plotIds)).toEqual([['plot-001'], ['plot-005']]);
  });

  it('keeps a label on owned land when a connected component wraps around the plaza', () => {
    const components = groupLobbyNeighborhoodClaimComponents(
      LOBBY_PLOTS.filter((plot) => plot.ring === 2).map((plot) => ({
        plotId: plot.id,
        ownerId: 'owner-ring',
        nickname: '环形邻居',
        isMine: false,
      })),
    );

    expect(components).toHaveLength(1);
    const component = components[0];
    expect(component).toBeDefined();
    if (!component) throw new Error('Expected one ring component');
    expect(component.plotIds).toHaveLength(16);
    expect(
      component.plotIds.some((plotId) => {
        const plot = lobbyPlotById(plotId);
        return Boolean(plot && isPointInLobbyPlot(plot, component.labelX, component.labelZ));
      }),
    ).toBe(true);
  });
});
