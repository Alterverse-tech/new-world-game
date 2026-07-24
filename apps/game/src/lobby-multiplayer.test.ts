import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  avatarModelUrl,
  buildLobbyWebSocketUrl,
  interpolateYaw,
  LobbyMultiplayer,
  lobbyNicknameLabelVisible,
  lobbyPlayerEyePosition,
  normalizeAvatarId,
  normalizeThirdPersonCameraDistance,
  parseLobbyMultiplayerMessage,
  resolveLobbyVehicleThirdPersonCameraDistance,
  resolveThirdPersonCameraPosition,
  sanitizeNickname,
  serializeVehicleExitMessage,
  serializeVehicleRecoverMessage,
  serializeVehicleStateMessage,
  serializeMultiplayerPose,
  serializeLobbyYaw,
  shouldAcceptLobbyPose,
  THIRD_PERSON_CAMERA_DISTANCE,
  THIRD_PERSON_MAX_CAMERA_DISTANCE,
  THIRD_PERSON_MIN_CAMERA_DISTANCE,
  thirdPersonCameraDistanceFromWheel,
  thirdPersonCameraTarget,
  vehicleErrorRequiresRecovery,
  VEHICLE_AUTOLAND_FEATURE,
  VEHICLE_LEASE_FEATURE,
  type LobbyVehicleSnapshot,
} from './lobby-multiplayer';
import { PlayerTelemetryController, type PlayerActivity } from './player-telemetry';

const VEHICLE_LEASE_ID = 'lease-12345678-1234-4234-8234-123456789abc';

describe('lobby nickname labels', () => {
  it('shows both self and remote nicknames', () => {
    expect(lobbyNicknameLabelVisible(true)).toBe(true);
    expect(lobbyNicknameLabelVisible(false)).toBe(true);
  });

  it('keeps self and remote labels visible across actor creation and profile updates', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
      }),
    });
    type TestActor = {
      group: THREE.Group;
      label: THREE.Sprite;
      profile: { name: string; avatarId: string };
      self: boolean;
    };
    const multiplayer = Object.create(LobbyMultiplayer.prototype) as Record<string, unknown>;
    Object.assign(multiplayer, { loadActorAvatar: vi.fn() });
    const methods = LobbyMultiplayer.prototype as unknown as {
      createActor(
        this: Record<string, unknown>,
        id: string,
        profile: { name: string; avatarId: string },
        pose: { x: number; y: number; z: number; yaw: number; moving: boolean },
        self: boolean,
      ): TestActor;
      updateActorProfile(
        this: Record<string, unknown>,
        actor: TestActor,
        profile: { name: string; avatarId: string },
      ): void;
    };

    for (const self of [true, false]) {
      const actor = methods.createActor.call(
        multiplayer,
        self ? 'self-0001' : 'remote-0001',
        { name: self ? 'Self' : 'Remote', avatarId: '' },
        { x: 0, y: 0, z: 0, yaw: 0, moving: false },
        self,
      );
      expect(actor.label.visible).toBe(true);

      actor.group.visible = false;
      methods.updateActorProfile.call(multiplayer, actor, { name: 'Renamed', avatarId: '' });

      expect(actor.label.visible).toBe(true);
      expect(actor.group.visible).toBe(false);
    }
  });

  it('keeps self label visibility independent from first-person and camera obstruction group state', () => {
    const multiplayer = multiplayerHarness();
    multiplayer.selfActor.label.visible = lobbyNicknameLabelVisible(true);
    multiplayer.view = 'third';

    LobbyMultiplayer.prototype.setView.call(multiplayer, 'first');
    expect(multiplayer.selfActor.group.visible).toBe(false);
    expect(multiplayer.selfActor.label.visible).toBe(true);

    multiplayer.cameraObstructed = false;
    LobbyMultiplayer.prototype.setView.call(multiplayer, 'third');
    expect(multiplayer.selfActor.group.visible).toBe(true);
    expect(multiplayer.selfActor.label.visible).toBe(true);

    multiplayer.cameraObstructed = true;
    LobbyMultiplayer.prototype.setView.call(multiplayer, 'first');
    LobbyMultiplayer.prototype.setView.call(multiplayer, 'third');
    expect(multiplayer.selfActor.group.visible).toBe(false);
    expect(multiplayer.selfActor.label.visible).toBe(true);
  });

  it('keeps self and remote labels visible while driving hides their actor groups', () => {
    const multiplayer = multiplayerHarness();
    const remote = actorStub('remote-0001');
    multiplayer.peers.set(remote.id, remote);
    multiplayer.vehicles.set('self-vehicle', vehicleSnapshot({
      objectId: 'self-vehicle',
      driverId: 'self-0001',
    }));
    multiplayer.vehicles.set('remote-vehicle', vehicleSnapshot({
      objectId: 'remote-vehicle',
      driverId: remote.id,
    }));
    const syncVehicleOccupants = (LobbyMultiplayer.prototype as unknown as {
      syncVehicleOccupants(this: MultiplayerHarness): void;
    }).syncVehicleOccupants;

    syncVehicleOccupants.call(multiplayer);

    expect(multiplayer.selfActor.group.visible).toBe(false);
    expect(remote.group.visible).toBe(false);
    expect(multiplayer.selfActor.label.visible).toBe(true);
    expect(remote.label.visible).toBe(true);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function vehicleSnapshot(overrides: Partial<LobbyVehicleSnapshot> = {}): LobbyVehicleSnapshot {
  return {
    objectId: 'object-car-0001',
    catalogId: 'catalog-car-0001',
    kind: 'car',
    driverId: 'alice-0001',
    x: 2,
    y: 0.2,
    z: -3,
    yaw: 0.5,
    pitch: 0,
    roll: 0,
    vx: 1.5,
    vy: 0,
    vz: -0.25,
    seq: 7,
    timestamp: 1_750_000_000_000,
    ...overrides,
  };
}

function actorStub(id: string, moving = false) {
  const group = new THREE.Group();
  group.visible = true;
  const label = new THREE.Sprite();
  label.visible = true;
  return {
    id,
    profile: { name: id, avatarId: '' },
    group,
    label,
    visual: new THREE.Group(),
    current: new THREE.Vector3(),
    target: new THREE.Vector3(),
    currentYaw: 0,
    moving,
    animationMoving: false,
    idleAction: null,
    walkAction: null,
    animationTime: 0,
    self: id === 'self-0001',
  };
}

interface MultiplayerHarness {
  handleMessage: (message: ReturnType<typeof parseLobbyMultiplayerMessage>) => void;
  clearVehicleSession: (recoverLocal?: boolean) => void;
  requestVehicleEnter: LobbyMultiplayer['requestVehicleEnter'];
  sendVehicleState: LobbyMultiplayer['sendVehicleState'];
  releaseVehicle: LobbyMultiplayer['releaseVehicle'];
  requestVehicleRecovery: LobbyMultiplayer['requestVehicleRecovery'];
  update: LobbyMultiplayer['update'];
  getTextState: LobbyMultiplayer['getTextState'];
  socket: { readyState: number; send: ReturnType<typeof vi.fn> };
  vehicleLeaseSupported: boolean;
  vehicleAutolandSupported: boolean;
  vehicles: Map<string, LobbyVehicleSnapshot>;
  peers: Map<string, ReturnType<typeof actorStub>>;
  selfActor: ReturnType<typeof actorStub>;
  view: 'first' | 'third';
  cameraObstructed: boolean;
  localVehicleLease: { objectId: string; leaseId: string } | null;
  connected: boolean;
  connectionEpoch: number;
  reconnectTimer: number;
  disconnecting: boolean;
  telemetry: TelemetrySpy;
  disconnect: (reconnect: boolean) => void;
  handleVisibilityChange: () => void;
  createTelemetryController: () => PlayerTelemetryController;
  connect: () => void;
  visibilityListening: boolean;
  visibilityListener: EventListener;
  refreshHud: ReturnType<typeof vi.fn>;
}

interface TelemetrySpy {
  connect: ReturnType<typeof vi.fn>;
  playerJoined: ReturnType<typeof vi.fn>;
  playerLeft: ReturnType<typeof vi.fn>;
  updateProfile: ReturnType<typeof vi.fn>;
  updateActivity: ReturnType<typeof vi.fn<(id: string, activity: PlayerActivity) => void>>;
  receive: ReturnType<typeof vi.fn>;
  handlePong: ReturnType<typeof vi.fn>;
  recordFrame: ReturnType<typeof vi.fn>;
  setLocalActivity: ReturnType<typeof vi.fn<(activity: PlayerActivity) => void>>;
  setLocalVisibility: ReturnType<typeof vi.fn<(hidden: boolean) => void>>;
  stop: ReturnType<typeof vi.fn>;
}

function telemetrySpy(): TelemetrySpy {
  return {
    connect: vi.fn(),
    playerJoined: vi.fn(),
    playerLeft: vi.fn(),
    updateProfile: vi.fn(),
    updateActivity: vi.fn(),
    receive: vi.fn(),
    handlePong: vi.fn(),
    recordFrame: vi.fn(),
    setLocalActivity: vi.fn(),
    setLocalVisibility: vi.fn(),
    stop: vi.fn(),
  };
}

function multiplayerHarness(onVehicleEvent = vi.fn()): MultiplayerHarness {
  const socket = { readyState: 1, send: vi.fn() };
  const instance = Object.create(LobbyMultiplayer.prototype) as MultiplayerHarness;
  Object.assign(instance, {
    socket,
    vehicleLeaseSupported: false,
    vehicleAutolandSupported: false,
    levelMode: false,
    activePartyId: null,
    channel: 'lobby:0000',
    lobbyChannel: '0000',
    vehicles: new Map<string, LobbyVehicleSnapshot>(),
    peers: new Map<string, ReturnType<typeof actorStub>>(),
    selfId: 'self-0001',
    clientId: 'self-0001',
    selfActor: actorStub('self-0001'),
    onVehicleEvent,
    localVehicleLease: null,
    localVehicleSafetyHold: false,
    ui: {},
    active: true,
    connected: true,
    serverOnline: 1,
    view: 'third',
    cameraObstructed: false,
    profile: { name: 'Self', avatarId: '' },
    lastSelfPose: { x: 0, y: 0.02, z: 4.2, yaw: 0, moving: false },
    lastPoseSentAt: Number.NEGATIVE_INFINITY,
    targetCameraDistance: THIRD_PERSON_CAMERA_DISTANCE,
    currentCameraDistance: THIRD_PERSON_CAMERA_DISTANCE,
    reducedMotion: true,
    remoteCustomSlots: 0,
    assetCache: new Map(),
    activeAvatarLoads: 0,
    pendingProfile: null,
    profileSendTimer: 0,
    partyInvite: null,
    partyState: null,
    connectionEpoch: 0,
    reconnectTimer: 0,
    disconnecting: false,
    telemetry: telemetrySpy(),
    visibilityListening: false,
    visibilityListener: vi.fn(),
    refreshHud: vi.fn(),
  });
  return instance;
}

describe('lobby multiplayer protocol', () => {
  it('keeps the exact production player stats panel and stylesheet in source', () => {
    const sourceHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const productionHtml = readFileSync(new URL('../../../public/game/index.html', import.meta.url), 'utf8');
    const sourceCss = readFileSync(new URL('./openai-theme.css', import.meta.url), 'utf8');
    const productionCss = readFileSync(
      new URL('../../../public/game/assets/player-stats-20260721.css', import.meta.url),
      'utf8',
    );
    const normalize = (value: string): string => value.replace(/\s+/gu, ' ').trim();
    const panelPattern = /<section id="player-stats-panel"[\s\S]*?<\/section>/u;
    const productionPanel = productionHtml.match(panelPattern)?.[0];
    const sourcePanel = sourceHtml.match(panelPattern)?.[0];

    expect(productionPanel).toBeTruthy();
    expect(normalize(sourcePanel ?? '')).toBe(normalize(productionPanel ?? ''));
    expect(sourceHtml.indexOf('id="multiplayer-hud"')).toBeLessThan(sourceHtml.indexOf('id="player-stats-panel"'));
    expect(sourceHtml.indexOf('id="player-stats-panel"')).toBeLessThan(sourceHtml.indexOf('id="avatar-wardrobe-entry"'));
    expect(normalize(sourceCss)).toContain(normalize(productionCss));
  });

  it('builds a same-origin WebSocket URL with each required query exactly once', () => {
    const result = new URL(buildLobbyWebSocketUrl('https://white.example/game', 'web-client-0001', {
      name: '海 东',
      avatarId: 'avatar-demo-12345678',
    }));
    expect(result.origin).toBe('wss://white.example');
    expect(result.pathname).toBe('/api/lobby/multiplayer');
    expect([...result.searchParams.keys()]).toEqual(['clientId', 'avatarId', 'name', 'channel']);
    expect(result.searchParams.getAll('clientId')).toEqual(['web-client-0001']);
    expect(result.searchParams.getAll('avatarId')).toEqual(['avatar-demo-12345678']);
    expect(result.searchParams.getAll('name')).toEqual(['海 东']);
    expect(result.searchParams.getAll('channel')).toEqual(['0000']);

    const emptyAvatar = new URL(buildLobbyWebSocketUrl('http://localhost:5173', 'web-client-0002', {
      name: '访客',
      avatarId: '',
    }));
    expect(emptyAvatar.protocol).toBe('ws:');
    expect(emptyAvatar.searchParams.getAll('avatarId')).toEqual(['']);

    const party = new URL(buildLobbyWebSocketUrl('https://white.example', 'web-client-0003', {
      name: '同行者', avatarId: '',
    }, 'party-12345678-1234-4234-8234-123456789abc'));
    expect(party.searchParams.get('partyId')).toBe('party-12345678-1234-4234-8234-123456789abc');

    const isolatedLobby = new URL(buildLobbyWebSocketUrl('https://white.example', 'web-client-0004', {
      name: '频道玩家', avatarId: '',
    }, null, '0012'));
    expect(isolatedLobby.searchParams.get('channel')).toBe('0012');

    const persistentSpace = new URL(buildLobbyWebSocketUrl('https://white.example', 'web-client-0005', {
      name: '天堂访客', avatarId: '',
    }, null, 'space-0012-heaven'));
    expect(persistentSpace.searchParams.getAll('channel')).toEqual(['space-0012-heaven']);
  });

  it('reads welcome players with nested authoritative poses and filters unsafe records', () => {
    expect(parseLobbyMultiplayerMessage(JSON.stringify({
      type: 'welcome',
      selfId: 'alice-0001',
      channel: 'lobby:2048',
      players: [
        {
          id: 'alice-0001',
          name: 'Alice',
          avatarId: null,
          pose: { x: 2, y: 1, z: -3, yaw: 0.5, moving: true, seq: 7, timestamp: 99 },
        },
        { id: '../bad', name: 'bad', pose: {} },
      ],
    }))).toEqual({
      type: 'welcome',
      selfId: 'alice-0001',
      channel: 'lobby:2048',
      online: null,
      players: [{
        id: 'alice-0001',
        name: 'Alice',
        avatarId: '',
        x: 2,
        y: 1,
        z: -3,
        yaw: 0.5,
        moving: true,
        seq: 7,
        timestamp: 99,
      }],
    });
  });

  it('strictly parses player telemetry and ping acknowledgements', () => {
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry',
      id: 'alice-0001',
      fps: 59,
      rttMs: 42,
      state: 'moving',
      region: 'China',
      updatedAt: 123,
    })).toEqual({
      type: 'telemetry',
      id: 'alice-0001',
      telemetry: {
        fps: 59,
        rttMs: 42,
        state: 'moving',
        region: 'China',
        updatedAt: 123,
      },
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: 7,
      serverTime: 1_750_000_000_000,
    })).toEqual({ type: 'telemetry_pong', nonce: 7 });
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry',
      id: '../bad',
      fps: 59,
      rttMs: 42,
      state: 'moving',
      region: 'China',
      updatedAt: 123,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry',
      id: 'alice-0001',
      fps: 59,
      rttMs: 42,
      state: 'moving',
      region: 'China',
      updatedAt: 123,
      extra: true,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: Number.POSITIVE_INFINITY,
      serverTime: 1_750_000_000_000,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: 0,
      serverTime: 1_750_000_000_000,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: 7,
      serverTime: 1_750_000_000_000,
      extra: true,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: 7,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong',
      nonce: 7,
      serverTime: Number.NaN,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry',
      id: 'alice-0001',
      fps: '59',
      rttMs: 42,
      state: 'moving',
      region: 'China',
      updatedAt: 123,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'telemetry',
      id: 'alice-0001',
      fps: 59,
      rttMs: 42,
      state: 'hacked',
      region: 'China',
      updatedAt: 123,
    })).toBeNull();
  });

  it('preserves normalized telemetry in welcome and channel snapshots', () => {
    const player = {
      id: 'alice-0001',
      name: 'Alice',
      avatarId: null,
      pose: { x: 2, y: 1, z: -3, yaw: 0.5, moving: false },
      telemetry: {
        fps: 999,
        rttMs: 42,
        state: 'playing',
        region: 'China',
        updatedAt: 123,
      },
    };
    expect(parseLobbyMultiplayerMessage({
      type: 'welcome',
      selfId: 'alice-0001',
      channel: 'lobby:2048',
      players: [player],
    })).toMatchObject({
      type: 'welcome',
      players: [{
        id: 'alice-0001',
        telemetry: {
          fps: 240,
          rttMs: 42,
          state: 'playing',
          region: 'China',
          updatedAt: 123,
        },
      }],
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot',
      channel: 'lobby:2048',
      players: [player],
    })).toMatchObject({
      type: 'channel_snapshot',
      players: [{ id: 'alice-0001', telemetry: { fps: 240 } }],
    });
  });

  it('strictly parses party invitations, party state, launch, and channel snapshots', () => {
    const partyId = 'party-12345678-1234-4234-8234-123456789abc';
    expect(parseLobbyMultiplayerMessage({
      type: 'party_invite',
      partyId,
      leader: { id: 'alice-0001', name: 'Alice', avatarId: null },
      levelId: 'skyline-relay-official',
      levelVersion: 'builtin:1:skyline-relay-official',
      startsAt: '2026-07-13T04:00:00.000Z',
      maxMembers: 4,
    })).toMatchObject({ type: 'party_invite', invite: { partyId, levelId: 'skyline-relay-official' } });
    expect(parseLobbyMultiplayerMessage({
      type: 'party_state',
      partyId,
      leaderId: 'alice-0001',
      levelId: 'skyline-relay-official',
      levelVersion: 'builtin:1:skyline-relay-official',
      startsAt: '2026-07-13T04:00:00.000Z',
      members: [{ id: 'alice-0001', name: 'Alice', avatarId: null }],
      maxMembers: 4,
    })).toMatchObject({ type: 'party_state', party: { partyId, members: [{ id: 'alice-0001' }] } });
    expect(parseLobbyMultiplayerMessage({
      type: 'party_launch', partyId, levelId: 'skyline-relay-official', levelVersion: 'builtin:1:skyline-relay-official',
    })).toEqual({
      type: 'party_launch',
      launch: { partyId, levelId: 'skyline-relay-official', levelVersion: 'builtin:1:skyline-relay-official' },
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot', channel: `level:${partyId}`, players: [], online: 2,
    })).toEqual({ type: 'channel_snapshot', channel: `level:${partyId}`, players: [], online: 2 });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot', channel: 'lobby:space-2048-hell', players: [], online: 3,
    })).toEqual({
      type: 'channel_snapshot', channel: 'lobby:space-2048-hell', players: [], online: 3,
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot', channel: 'lobby:space-2048-limbo', players: [], online: 3,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'party_invite', partyId: '../bad', leader: {}, levelId: 'x', levelVersion: 'x', startsAt: 'bad',
    })).toBeNull();
  });

  it('accepts only newer sequenced poses and interpolates yaw across the ±π seam', () => {
    expect(shouldAcceptLobbyPose({ seq: 4 }, { seq: 3 })).toBe(true);
    expect(shouldAcceptLobbyPose({ seq: 3 }, { seq: 3 })).toBe(false);
    const halfway = interpolateYaw(THREE.MathUtils.degToRad(170), THREE.MathUtils.degToRad(-170), 0.5);
    expect(Math.abs(THREE.MathUtils.radToDeg(halfway))).toBeCloseTo(180, 5);
    expect(serializeLobbyYaw(-Math.PI + 0.000001)).toBeGreaterThanOrEqual(-Math.PI);
    expect(serializeLobbyYaw(Math.PI - 0.000001)).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(serializeLobbyYaw(-Math.PI + 0.000001))).toBeCloseTo(Math.PI, 5);
  });

  it('preserves finite unbounded hub poses while retaining party-level bounds', () => {
    const pose = { x: 24.1254, y: -1, z: -25.3337, yaw: Math.PI * 3, moving: true };
    expect(serializeMultiplayerPose(pose, false)).toEqual({
      x: 24.125, y: -1, z: -25.334, yaw: -Math.PI, moving: true,
    });
    expect(serializeMultiplayerPose({ ...pose, x: 99, y: 99, z: -99 }, false)).toMatchObject({
      x: 99, y: 99, z: -99,
    });
    expect(serializeMultiplayerPose({ ...pose, x: Number.NaN, y: Number.POSITIVE_INFINITY }, false)).toMatchObject({
      x: 0, y: 0,
    });
    expect(serializeMultiplayerPose(pose, true)).toEqual({
      x: 24.125, y: -1, z: -25.334, yaw: -Math.PI, moving: true,
    });
    expect(serializeMultiplayerPose({ ...pose, x: 99, y: 99, z: -99 }, true)).toMatchObject({
      x: 40, y: 12, z: -40,
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'pose', id: 'remote-0001', x: 120, y: 85, z: -90, yaw: 0, moving: false,
    })).toMatchObject({ type: 'pose', player: { x: 120, y: 85, z: -90 } });
  });

  it('parses recoverable profile throttling hints without treating them as player data', () => {
    expect(parseLobbyMultiplayerMessage(JSON.stringify({
      type: 'error',
      code: 'profile_rate_limited',
      retryAfterMs: 400,
    }))).toEqual({ type: 'error', code: 'profile_rate_limited', retryAfterMs: 400 });
  });

  it('normalizes profile fields and uses only same-origin avatar paths', () => {
    expect(sanitizeNickname('  Alice\n  WhiteRoom  ')).toBe('Alice WhiteRoom');
    expect(normalizeAvatarId('Avatar-Demo-12345678')).toBe('avatar-demo-12345678');
    expect(normalizeAvatarId('short')).toBe('');
    expect(normalizeAvatarId('../escape-12345678')).toBe('');
    expect(avatarModelUrl('avatar-demo-12345678')).toBe('/avatars/avatar-demo-12345678/avatar.glb');
    expect(avatarModelUrl('preset-ink-chibi')).toBe('/generated-assets/whiteroom-avatar-ink-chibi.glb');
    expect(avatarModelUrl('preset-cloud-doll')).toBe('/generated-assets/whiteroom-avatar-cloud-doll.glb');
    expect(avatarModelUrl('')).toBe('/generated-assets/whiteroom-avatar-ink-chibi.glb');
  });
});

describe('vehicle lease multiplayer protocol', () => {
  it('routes every multiplayer event through the single telemetry controller', () => {
    const multiplayer = multiplayerHarness();
    const telemetry = multiplayer.telemetry;
    const player = {
      id: 'self-0001',
      name: 'Self',
      avatarId: null,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      moving: false,
      telemetry: {
        fps: 60,
        rttMs: 30,
        state: 'online',
        region: 'China',
        updatedAt: 1,
      },
    };
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'welcome',
      selfId: 'self-0001',
      channel: 'lobby:0000',
      players: [player],
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({ type: 'join', player }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'pose', id: 'self-0001', x: 1, y: 0, z: 0, yaw: 0, moving: true,
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'pose', id: 'self-0001', x: 1, y: 0, z: 0, yaw: 0, moving: false,
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'profile', id: 'self-0001', name: 'Renamed', avatarId: null,
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'telemetry', id: 'self-0001', fps: 59, rttMs: 42,
      state: 'moving', region: 'China', updatedAt: 123,
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'telemetry_pong', nonce: 7, serverTime: 1_750_000_000_000,
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_claimed', vehicle: vehicleSnapshot({ driverId: 'self-0001' }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: vehicleSnapshot({ driverId: 'self-0001', seq: 8 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_released', reason: 'exit', driverId: 'self-0001',
      vehicle: vehicleSnapshot({ driverId: null, seq: 9 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'party_launch',
      partyId: 'party-12345678-1234-4234-8234-123456789abc',
      levelId: 'skyline-relay-official',
      levelVersion: 'builtin:1:skyline-relay-official',
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({ type: 'leave', id: 'alice-0001' }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot', channel: 'lobby:0000', players: [player],
    }));

    expect(telemetry.connect).toHaveBeenNthCalledWith(1, 'self-0001', 'lobby:0000', [expect.objectContaining({
      id: 'self-0001', telemetry: expect.objectContaining({ fps: 60 }),
    })]);
    expect(telemetry.connect).toHaveBeenNthCalledWith(2, 'self-0001', 'lobby:0000', [expect.any(Object)]);
    expect(telemetry.playerJoined).toHaveBeenCalledWith(expect.objectContaining({ id: 'self-0001' }));
    expect(telemetry.updateActivity).toHaveBeenCalledWith('self-0001', 'moving');
    expect(telemetry.updateActivity).toHaveBeenCalledWith('self-0001', 'online');
    expect(telemetry.updateProfile).toHaveBeenCalledWith('self-0001', 'Renamed');
    expect(telemetry.receive).toHaveBeenCalledWith('self-0001', expect.objectContaining({ fps: 59 }));
    expect(telemetry.handlePong).toHaveBeenCalledWith(7);
    expect(telemetry.updateActivity).toHaveBeenCalledWith('self-0001', 'driving');
    expect(telemetry.setLocalActivity).toHaveBeenCalledWith('playing');
    expect(telemetry.playerLeft).toHaveBeenCalledWith('alice-0001');
  });

  it('routes the real pong schema into RTT calculation and a telemetry send', () => {
    vi.useFakeTimers();
    const multiplayer = multiplayerHarness();
    const telemetry = multiplayer.createTelemetryController();
    Object.assign(multiplayer, { telemetry });
    try {
      telemetry.connect('self-0001', 'lobby:0000', []);
      telemetry.ping();
      vi.advanceTimersByTime(42);
      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'telemetry_pong',
        nonce: 1,
        serverTime: 1_750_000_000_000,
      }));

      const payloads = multiplayer.socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)));
      expect(payloads).toEqual([
        { type: 'telemetry_ping', nonce: 1 },
        expect.objectContaining({ type: 'telemetry', rttMs: 42 }),
      ]);
      expect(telemetry.getState().players[0]).toMatchObject({ id: 'self-0001', rttMs: 42 });
    } finally {
      telemetry.stop();
    }
  });

  it('avoids telemetry renders for repeated equivalent pose and vehicle state events', () => {
    const multiplayer = multiplayerHarness();
    const render = vi.fn();
    const telemetry = new PlayerTelemetryController({
      send: vi.fn(),
      render,
      now: () => 1_000,
      region: () => 'China',
    });
    Object.assign(multiplayer, { telemetry });
    const snapshot = (id: string, name: string) => ({
      id, name, avatarId: null, x: 0, y: 0, z: 0, yaw: 0, moving: false,
      telemetry: { fps: 60, rttMs: 40, state: 'online', region: 'China', updatedAt: 1 },
    });
    const remote = actorStub('alice-0001');
    remote.profile.name = 'Alice';
    multiplayer.peers.set(remote.id, remote);

    try {
      telemetry.connect('self-0001', 'lobby:0000', [
        snapshot('self-0001', 'Self'),
        snapshot('alice-0001', 'Alice'),
      ]);
      render.mockClear();

      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'pose', id: 'alice-0001', x: 1, y: 0, z: 0, yaw: 0, moving: false,
      }));
      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'pose', id: 'alice-0001', x: 2, y: 0, z: 0, yaw: 0, moving: false,
      }));
      expect(render).not.toHaveBeenCalled();

      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'pose', id: 'alice-0001', x: 3, y: 0, z: 0, yaw: 0, moving: true,
      }));
      expect(render).toHaveBeenCalledOnce();
      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'pose', id: 'alice-0001', x: 4, y: 0, z: 0, yaw: 0, moving: true,
      }));
      expect(render).toHaveBeenCalledOnce();

      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'vehicle_state', vehicle: vehicleSnapshot({ driverId: 'alice-0001', seq: 7 }),
      }));
      expect(render).toHaveBeenCalledTimes(2);
      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'vehicle_state', vehicle: vehicleSnapshot({ driverId: 'alice-0001', seq: 8 }),
      }));
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      telemetry.stop();
    }
  });

  it('keeps local vehicle and party activity hidden until visibility restores the latest base state', () => {
    const multiplayer = multiplayerHarness();
    let now = 1_000;
    const telemetry = new PlayerTelemetryController({
      send: (payload) => multiplayer.socket.send(payload),
      render: vi.fn(),
      now: () => now,
      region: () => 'China',
    });
    Object.assign(multiplayer, { telemetry });
    const fakeDocument = { hidden: true };
    vi.stubGlobal('document', fakeDocument);

    try {
      telemetry.connect('self-0001', 'lobby:0000', [{
        id: 'self-0001', name: 'Self', avatarId: null,
        x: 0, y: 0, z: 0, yaw: 0, moving: false,
      }]);
      multiplayer.handleVisibilityChange();
      expect(telemetry.getState().players[0]).toMatchObject({ state: 'away' });

      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'vehicle_claimed', vehicle: vehicleSnapshot({ driverId: 'self-0001' }),
      }));
      expect(telemetry.getState().players[0]).toMatchObject({ state: 'away' });
      multiplayer.handleMessage(parseLobbyMultiplayerMessage({
        type: 'party_launch',
        partyId: 'party-12345678-1234-4234-8234-123456789abc',
        levelId: 'skyline-relay-official',
        levelVersion: 'builtin:1:skyline-relay-official',
      }));
      expect(telemetry.getState().players[0]).toMatchObject({ state: 'away' });

      now = 1_750;
      fakeDocument.hidden = false;
      multiplayer.handleVisibilityChange();
      expect(telemetry.getState().players[0]).toMatchObject({ state: 'playing' });
      expect(multiplayer.socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
        expect.objectContaining({ type: 'telemetry', state: 'away' }),
        expect.objectContaining({ type: 'telemetry', state: 'playing' }),
      ]);
    } finally {
      telemetry.stop();
    }
  });

  it('maps an idle remote pose to playing in a level and online in a lobby', () => {
    const multiplayer = multiplayerHarness();
    const remote = actorStub('alice-0001');
    remote.profile.name = '访客';
    multiplayer.peers.set('alice-0001', remote);
    Object.assign(multiplayer, { channel: 'level:party-12345678-1234-4234-8234-123456789abc' });
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'pose', id: 'alice-0001', x: 1, y: 0, z: 0, yaw: 0, moving: false,
    }));
    expect(multiplayer.telemetry.updateActivity).toHaveBeenLastCalledWith('alice-0001', 'playing');

    Object.assign(multiplayer, { channel: 'lobby:0000' });
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'pose', id: 'alice-0001', x: 2, y: 0, z: 0, yaw: 0, moving: false,
    }));
    expect(multiplayer.telemetry.updateActivity).toHaveBeenLastCalledWith('alice-0001', 'online');
  });

  it('clears driving telemetry for inbound, outbound, and local vehicle recovery paths', () => {
    const multiplayer = multiplayerHarness();
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_recovery',
      reason: 'state_loss',
      driverId: 'alice-0001',
      vehicle: vehicleSnapshot({ driverId: 'alice-0001', recovering: true }),
    }));
    expect(multiplayer.telemetry.updateActivity).toHaveBeenLastCalledWith('alice-0001', 'online');

    Object.assign(multiplayer, {
      channel: 'level:party-12345678-1234-4234-8234-123456789abc',
      vehicleLeaseSupported: true,
      localVehicleLease: { objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID },
    });
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_recovery',
      reason: 'state_loss',
      driverId: 'self-0001',
      vehicle: vehicleSnapshot({ driverId: 'self-0001', seq: 8, recovering: true }),
    }));
    expect(multiplayer.telemetry.updateActivity).toHaveBeenLastCalledWith('self-0001', 'playing');

    const outbound = multiplayerHarness();
    outbound.vehicleLeaseSupported = true;
    expect(outbound.requestVehicleRecovery('object-car-0001', VEHICLE_LEASE_ID)).toBe(true);
    expect(outbound.telemetry.setLocalActivity).toHaveBeenLastCalledWith('online');

    const local = multiplayerHarness();
    local.vehicles.set('object-car-0001', vehicleSnapshot({ driverId: 'self-0001' }));
    local.clearVehicleSession(true);
    expect(local.telemetry.updateActivity).toHaveBeenLastCalledWith('self-0001', 'online');
  });

  it('samples frames, tracks visibility, and stops telemetry on disconnect', () => {
    const multiplayer = multiplayerHarness();
    const documentListeners = new Map<string, EventListener>();
    const fakeDocument = {
      hidden: true,
      addEventListener: vi.fn((type: string, listener: EventListener) => documentListeners.set(type, listener)),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (documentListeners.get(type) === listener) documentListeners.delete(type);
      }),
    };
    vi.stubGlobal('document', fakeDocument);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_234);
    multiplayer.update(0.1, 10, { x: 0, y: 0, z: 0, yaw: 0, moving: true });
    expect(multiplayer.telemetry.recordFrame).toHaveBeenCalledWith(1_234);
    expect(multiplayer.telemetry.setLocalActivity).toHaveBeenCalledWith('moving');
    multiplayer.telemetry.recordFrame.mockClear();
    multiplayer.connected = false;
    multiplayer.update(0.1, 10.1, { x: 0, y: 0, z: 0, yaw: 0, moving: true });
    expect(multiplayer.telemetry.recordFrame).not.toHaveBeenCalled();
    multiplayer.connected = true;

    multiplayer.handleVisibilityChange();
    expect(multiplayer.telemetry.setLocalVisibility).toHaveBeenLastCalledWith(true);
    fakeDocument.hidden = false;
    multiplayer.handleVisibilityChange();
    expect(multiplayer.telemetry.setLocalVisibility).toHaveBeenLastCalledWith(false);

    multiplayer.visibilityListening = true;
    multiplayer.socket.readyState = 2;
    multiplayer.disconnect(false);
    expect(multiplayer.telemetry.stop).toHaveBeenCalledOnce();
    expect(fakeDocument.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      multiplayer.visibilityListener,
    );
    now.mockRestore();
    vi.unstubAllGlobals();
  });

  it('sends telemetry only through whichever multiplayer socket is currently owned', () => {
    vi.useFakeTimers();
    try {
      const multiplayer = multiplayerHarness();
      const firstSocket = multiplayer.socket;
      const telemetry = multiplayer.createTelemetryController();
      telemetry.connect('self-0001', 'lobby:0000', []);
      vi.advanceTimersByTime(2_000);
      expect(firstSocket.send).toHaveBeenCalledOnce();
      expect(JSON.parse(String(firstSocket.send.mock.calls[0]?.[0]))).toEqual({
        type: 'telemetry_ping', nonce: 1,
      });

      const secondSocket = { readyState: 1, send: vi.fn() };
      multiplayer.socket = secondSocket;
      vi.advanceTimersByTime(2_000);
      expect(firstSocket.send).toHaveBeenCalledOnce();
      expect(secondSocket.send).toHaveBeenCalledOnce();
      expect(JSON.parse(String(secondSocket.send.mock.calls[0]?.[0]))).toEqual({
        type: 'telemetry_ping', nonce: 2,
      });
      telemetry.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores stale socket callbacks and cleans telemetry before reconnecting', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      public static readonly OPEN = 1;
      public static readonly CLOSING = 2;
      public readyState = 0;
      public readonly send = vi.fn();
      private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

      public constructor() {
        sockets.push(this);
      }

      public addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      public emit(type: string, event = {} as MessageEvent): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }

      public close(): void {
        this.readyState = 3;
        this.emit('close');
      }
    }
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('document', {
      baseURI: 'https://white.example/',
      hidden: false,
      addEventListener,
      removeEventListener,
    });
    const multiplayer = multiplayerHarness();
    Object.assign(multiplayer, {
      socket: null,
      reconnectAttempt: 0,
      profileRevision: 0,
      connectionProfileRevision: 0,
      lastProfileSentAt: Number.NEGATIVE_INFINITY,
    });

    try {
      multiplayer.connect();
      const first = sockets[0]!;
      first.readyState = FakeSocket.OPEN;
      first.emit('open');
      expect(multiplayer.telemetry.connect).toHaveBeenCalledOnce();
      expect(addEventListener).toHaveBeenCalledWith('visibilitychange', multiplayer.visibilityListener);

      multiplayer.connectionEpoch += 1;
      Object.assign(multiplayer, { socket: null, visibilityListening: false });
      first.emit('close');
      expect(multiplayer.telemetry.stop).not.toHaveBeenCalled();

      multiplayer.connect();
      const second = sockets[1]!;
      second.readyState = FakeSocket.OPEN;
      second.emit('open');
      second.emit('close');
      expect(multiplayer.telemetry.stop).toHaveBeenCalledOnce();
      expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', multiplayer.visibilityListener);
      expect(multiplayer.reconnectTimer).not.toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('owns one native multiplayer connection without replacing the global WebSocket', () => {
    const source = readFileSync(new URL('./lobby-multiplayer.ts', import.meta.url), 'utf8');
    expect(source.match(/new WebSocket\s*\(/gu)).toHaveLength(1);
    expect(source).not.toMatch(/window\.WebSocket\s*=/u);
    expect(source).not.toMatch(/class\s+\w+\s+extends\s+WebSocket/u);
  });

  it('recovers rejected ownership or motion but tolerates a single stale sequence', () => {
    expect(vehicleErrorRequiresRecovery('vehicle_lease_rejected')).toBe(true);
    expect(vehicleErrorRequiresRecovery('vehicle_state_rejected')).toBe(true);
    expect(vehicleErrorRequiresRecovery('vehicle_state_stale')).toBe(false);
    expect(vehicleErrorRequiresRecovery('vehicle_state_rate_limited')).toBe(false);
  });

  it('parses negotiated vehicle snapshots on welcome and channel changes', () => {
    const car = vehicleSnapshot();
    const aircraft = vehicleSnapshot({
      objectId: 'object-aircraft-0002',
      catalogId: 'catalog-aircraft-0002',
      kind: 'aircraft',
      driverId: null,
      y: 18,
      seq: 0,
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'welcome',
      selfId: 'alice-0001',
      channel: 'lobby:0000',
      players: [],
      features: [VEHICLE_LEASE_FEATURE, VEHICLE_AUTOLAND_FEATURE, VEHICLE_LEASE_FEATURE, '../bad'],
      vehicles: [aircraft, { ...car, extra: true }, car],
      online: 2,
    })).toEqual({
      type: 'welcome',
      selfId: 'alice-0001',
      channel: 'lobby:0000',
      players: [],
      online: 2,
      features: [VEHICLE_LEASE_FEATURE, VEHICLE_AUTOLAND_FEATURE],
      vehicles: [aircraft, car],
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot',
      channel: 'lobby:0000',
      players: [],
      features: [VEHICLE_LEASE_FEATURE],
      vehicles: [car],
    })).toMatchObject({ type: 'channel_snapshot', features: [VEHICLE_LEASE_FEATURE], vehicles: [car] });
    expect(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot', channel: 'lobby:0000', players: [], features: {}, vehicles: [],
    })).toBeNull();
  });

  it('strictly parses entered, claimed, state, recovery, and released server events', () => {
    const occupied = vehicleSnapshot();
    const released = vehicleSnapshot({ driverId: null, seq: 8 });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_entered', leaseId: VEHICLE_LEASE_ID, vehicle: occupied,
    })).toEqual({ type: 'vehicle_entered', leaseId: VEHICLE_LEASE_ID, vehicle: occupied });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_claimed', vehicle: occupied,
    })).toEqual({ type: 'vehicle_claimed', vehicle: occupied });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: occupied,
    })).toEqual({ type: 'vehicle_state', vehicle: occupied });
    const recovering = vehicleSnapshot({
      kind: 'aircraft', objectId: 'object-aircraft-0002', catalogId: 'catalog-aircraft-0002',
      x: 120, y: 85, z: -90, recovering: true,
    });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_recovery', reason: 'state_loss', driverId: 'alice-0001', vehicle: recovering,
    })).toEqual({ type: 'vehicle_recovery', reason: 'state_loss', driverId: 'alice-0001', vehicle: recovering });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_released', reason: 'exit', driverId: 'alice-0001', vehicle: released,
    })).toEqual({ type: 'vehicle_released', reason: 'exit', driverId: 'alice-0001', vehicle: released });
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_snapshot', vehicles: [released],
    })).toEqual({ type: 'vehicle_snapshot', vehicles: [released] });
  });

  it('rejects malformed, out-of-bounds, or non-exact vehicle events', () => {
    const occupied = vehicleSnapshot();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: { ...occupied, kind: 'helicopter' },
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: { ...occupied, x: Number.NaN },
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: { ...occupied, y: 2 },
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: occupied, extra: true,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_entered', leaseId: 'not-a-lease', vehicle: occupied,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_claimed', vehicle: { ...occupied, driverId: null },
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_released', reason: 'exit', driverId: 'alice-0001', vehicle: occupied,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_recovery', reason: 'state_loss', driverId: 'alice-0001', vehicle: occupied,
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_snapshot', vehicles: [{ ...occupied, extra: true }],
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_snapshot', vehicles: [occupied, occupied],
    })).toBeNull();
    expect(parseLobbyMultiplayerMessage({
      type: 'vehicle_snapshot', vehicles: [], extra: true,
    })).toBeNull();
  });

  it('serializes only the exact finite state and exit schemas', () => {
    const state = {
      objectId: 'object-car-0001',
      leaseId: VEHICLE_LEASE_ID,
      seq: 8,
      x: 2,
      y: -0,
      z: -3,
      yaw: 0.5,
      pitch: 0,
      roll: 0,
      vx: 1,
      vy: 0,
      vz: -0.25,
    };
    expect(serializeVehicleStateMessage(state)).toEqual({ type: 'vehicle_state', ...state, y: 0 });
    expect(serializeVehicleExitMessage('object-car-0001', VEHICLE_LEASE_ID, 9)).toEqual({
      type: 'vehicle_exit', objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID, seq: 9,
    });
    expect(serializeVehicleRecoverMessage('object-car-0001', VEHICLE_LEASE_ID)).toEqual({
      type: 'vehicle_recover', objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID,
    });
    expect(serializeVehicleStateMessage({ ...state, debug: true })).toBeNull();
    expect(serializeVehicleStateMessage({ ...state, seq: 0 })).toBeNull();
    expect(serializeVehicleStateMessage({ ...state, vx: Number.POSITIVE_INFINITY })).toBeNull();
    expect(serializeVehicleStateMessage({ ...state, roll: Math.PI + 0.01 })).toBeNull();
    expect(serializeVehicleStateMessage({ ...state, leaseId: 'lease-invalid' })).toBeNull();
    expect(serializeVehicleExitMessage('../bad', VEHICLE_LEASE_ID, 9)).toBeNull();
    expect(serializeVehicleRecoverMessage('object-car-0001', 'lease-invalid')).toBeNull();
  });

  it('negotiates the feature, emits exact client messages, and returns false without support', () => {
    const unsupported = multiplayerHarness();
    expect(unsupported.requestVehicleEnter('object-car-0001')).toBe(false);
    expect(unsupported.sendVehicleState({
      objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID, seq: 1,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0,
    })).toBe(false);

    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'channel_snapshot',
      channel: 'lobby:0000',
      players: [],
      features: [VEHICLE_LEASE_FEATURE],
      vehicles: [],
    }));
    expect(multiplayer.vehicleLeaseSupported).toBe(true);
    expect(events).toHaveBeenLastCalledWith({ type: 'snapshot', vehicles: [] });
    expect(multiplayer.requestVehicleEnter('object-car-0001')).toBe(true);
    expect(multiplayer.sendVehicleState({
      objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID, seq: 1,
      x: 1, y: 0, z: 2, yaw: 0.2, pitch: 0, roll: 0, vx: 2, vy: 0, vz: 1,
    })).toBe(true);
    expect(multiplayer.releaseVehicle('object-car-0001', VEHICLE_LEASE_ID, 2)).toBe(true);
    expect(multiplayer.requestVehicleRecovery('object-car-0001', VEHICLE_LEASE_ID)).toBe(true);
    expect(multiplayer.socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toEqual([
      { type: 'vehicle_enter', objectId: 'object-car-0001' },
      {
        type: 'vehicle_state', objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID, seq: 1,
        x: 1, y: 0, z: 2, yaw: 0.2, pitch: 0, roll: 0, vx: 2, vy: 0, vz: 1,
      },
      { type: 'vehicle_exit', objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID, seq: 2 },
      { type: 'vehicle_recover', objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID },
    ]);
  });

  it('ignores out-of-order states, dispatches callbacks, and hides occupied remote Avatars', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.vehicleLeaseSupported = true;
    const remote = actorStub('alice-0001', true);
    multiplayer.peers.set(remote.id, remote);
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_claimed', vehicle: vehicleSnapshot({ seq: 7 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: vehicleSnapshot({ seq: 9, x: 4 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_state', vehicle: vehicleSnapshot({ seq: 8, x: 99 }),
    }));
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['claimed', 'state']);
    expect(multiplayer.vehicles.get('object-car-0001')?.x).toBe(4);
    expect(remote.moving).toBe(false);
    expect(remote.group.visible).toBe(false);
    const text = multiplayer.getTextState();
    expect(text.remote[0]).toMatchObject({
      id: 'alice-0001', moving: false, visible: false,
      avatarAnimationMode: 'standing',
      vehicle: { objectId: 'object-car-0001', kind: 'car', seq: 9 },
    });
    expect(text.vehicles).toEqual([expect.objectContaining({ objectId: 'object-car-0001', x: 4, seq: 9 })]);
    expect(text.vehicles[0]).not.toHaveProperty('timestamp');
  });

  it('accepts authoritative self echoes without dropping the lease or revealing the driving Avatar', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.vehicleLeaseSupported = true;
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_entered',
      leaseId: VEHICLE_LEASE_ID,
      vehicle: vehicleSnapshot({ driverId: 'self-0001', seq: 0, x: 0, pitch: 0, roll: 0 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_state',
      vehicle: vehicleSnapshot({
        driverId: 'self-0001', seq: 1, x: 1.25, pitch: Math.PI, roll: -Math.PI,
      }),
    }));

    expect(multiplayer.localVehicleLease).toEqual({
      objectId: 'object-car-0001',
      leaseId: VEHICLE_LEASE_ID,
    });
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['entered', 'state']);
    expect(multiplayer.getTextState()).toMatchObject({
      self: {
        visible: false,
        vehicle: { objectId: 'object-car-0001', kind: 'car', seq: 1 },
      },
      vehicles: [{
        objectId: 'object-car-0001', driverId: 'self-0001', x: 1.25,
        pitch: Number(Math.PI.toFixed(2)), roll: Number((-Math.PI).toFixed(2)), seq: 1,
      }],
    });

    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_state',
      vehicle: vehicleSnapshot({ driverId: 'self-0001', seq: 0, x: 99 }),
    }));
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['entered', 'state']);
    expect(multiplayer.getTextState().vehicles[0]).toMatchObject({ x: 1.25, seq: 1 });
    expect(multiplayer.localVehicleLease).not.toBeNull();
  });

  it('replaces a vehicle-only snapshot without clearing peers or the local lease', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    const remote = actorStub('alice-0001', true);
    multiplayer.peers.set(remote.id, remote);
    multiplayer.localVehicleLease = { objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID };
    multiplayer.vehicles.set('object-idle-0002', vehicleSnapshot({
      objectId: 'object-idle-0002', catalogId: 'catalog-car-0002', driverId: null,
    }));

    const occupied = vehicleSnapshot({ driverId: 'self-0001', x: 12, seq: 9 });
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_snapshot', vehicles: [occupied],
    }));

    expect(multiplayer.localVehicleLease).toEqual({
      objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID,
    });
    expect(multiplayer.peers.get('alice-0001')).toBe(remote);
    expect(multiplayer.vehicles.has('object-idle-0002')).toBe(false);
    expect(multiplayer.vehicles.get('object-car-0001')).toEqual(occupied);
    expect(events).toHaveBeenLastCalledWith({ type: 'snapshot', vehicles: [occupied] });
  });

  it('suppresses ordinary poses while driving and resumes them immediately after release', () => {
    const multiplayer = multiplayerHarness();
    const pose = { x: 12, y: 4, z: -8, yaw: 0.75, moving: false };
    multiplayer.localVehicleLease = { objectId: 'object-car-0001', leaseId: VEHICLE_LEASE_ID };
    multiplayer.vehicles.set('object-car-0001', vehicleSnapshot({ driverId: 'self-0001' }));

    multiplayer.update(0.1, 10, pose);
    expect(multiplayer.socket.send).not.toHaveBeenCalled();

    multiplayer.localVehicleLease = null;
    multiplayer.vehicles.set('object-car-0001', vehicleSnapshot({ driverId: null }));
    multiplayer.update(0.1, 10.1, pose);
    expect(multiplayer.socket.send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(multiplayer.socket.send.mock.calls[0]?.[0]))).toEqual({
      type: 'pose', x: 12, y: 4, z: -8, yaw: 0.75, moving: false,
    });
  });

  it('keeps the recovering occupant hidden and forwards authoritative autoland snapshots', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.vehicleLeaseSupported = true;
    multiplayer.vehicleAutolandSupported = true;
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_entered',
      leaseId: VEHICLE_LEASE_ID,
      vehicle: vehicleSnapshot({
        objectId: 'object-aircraft-0002', catalogId: 'catalog-aircraft-0002',
        kind: 'aircraft', driverId: 'self-0001', x: 120, y: 85, z: -90, seq: 3,
      }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_recovery',
      reason: 'state_loss',
      driverId: 'self-0001',
      vehicle: vehicleSnapshot({
        objectId: 'object-aircraft-0002', catalogId: 'catalog-aircraft-0002',
        kind: 'aircraft', driverId: 'self-0001', x: 120, y: 85, z: -90, seq: 4, recovering: true,
      }),
    }));
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['entered', 'recovery']);
    expect(multiplayer.localVehicleLease).toBeNull();
    expect(multiplayer.getTextState()).toMatchObject({
      self: { visible: false, vehicle: { objectId: 'object-aircraft-0002' } },
      vehicles: [{ x: 120, y: 85, z: -90, recovering: true }],
      resources: { vehicleAutolandSupported: true },
    });
  });

  it('marks a socket-loss recovery as local so an airborne driver can keep autolanding', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.vehicleLeaseSupported = true;
    multiplayer.vehicleAutolandSupported = true;
    multiplayer.vehicles.set('object-aircraft-0002', vehicleSnapshot({
      objectId: 'object-aircraft-0002',
      catalogId: 'catalog-aircraft-0002',
      kind: 'aircraft',
      driverId: 'self-0001',
      x: 120,
      y: 85,
      z: -90,
      vy: -0.4,
      seq: 7,
    }));
    multiplayer.connected = false;

    multiplayer.clearVehicleSession(true);

    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({
      type: 'recovery',
      reason: 'disconnect',
      driverId: 'self-0001',
      local: true,
      vehicle: expect.objectContaining({
        objectId: 'object-aircraft-0002',
        driverId: 'self-0001',
        y: 85,
        recovering: true,
      }),
    }));
    expect(multiplayer.vehicleLeaseSupported).toBe(false);
    expect(multiplayer.vehicleAutolandSupported).toBe(false);
    expect(multiplayer.getTextState()).toMatchObject({
      connected: false,
      self: { visible: false, vehicle: { objectId: 'object-aircraft-0002' } },
      vehicles: [{ objectId: 'object-aircraft-0002', recovering: true }],
    });
  });

  it('records the entered lease and forwards release and vehicle errors', () => {
    const events = vi.fn();
    const multiplayer = multiplayerHarness(events);
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_entered',
      leaseId: VEHICLE_LEASE_ID,
      vehicle: vehicleSnapshot({ driverId: 'self-0001' }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({
      type: 'vehicle_released',
      reason: 'timeout',
      driverId: 'self-0001',
      vehicle: vehicleSnapshot({ driverId: null, seq: 8 }),
    }));
    multiplayer.handleMessage(parseLobbyMultiplayerMessage({ type: 'error', code: 'vehicle_occupied' }));
    expect(events.mock.calls.map(([event]) => event.type)).toEqual(['entered', 'released', 'error']);
    expect(events.mock.calls[0]?.[0]).toMatchObject({ type: 'entered', leaseId: VEHICLE_LEASE_ID });
    expect(events.mock.calls[1]?.[0]).toMatchObject({ type: 'released', reason: 'timeout', driverId: 'self-0001' });
    expect(events.mock.calls[2]?.[0]).toEqual({ type: 'error', code: 'vehicle_occupied' });
  });
});

describe('third-person camera zoom', () => {
  it('normalizes missing, invalid, and out-of-range saved distances', () => {
    expect(normalizeThirdPersonCameraDistance(undefined)).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(normalizeThirdPersonCameraDistance('4')).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(normalizeThirdPersonCameraDistance(Number.NaN)).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(normalizeThirdPersonCameraDistance(-10)).toBe(THIRD_PERSON_MIN_CAMERA_DISTANCE);
    expect(normalizeThirdPersonCameraDistance(20)).toBe(THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(normalizeThirdPersonCameraDistance(3.35)).toBe(3.35);
  });

  it('maps wheel and trackpad deltas to bounded camera distances', () => {
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, -120)).toBeCloseTo(2.15, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, 120)).toBeCloseTo(2.75, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, -3, 1)).toBeCloseTo(2.15, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, 1, 2, 900)).toBeCloseTo(2.75, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, -12.5)).toBeCloseTo(2.41875, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, -0.1)).toBeCloseTo(2.44975, 8);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, 0)).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_CAMERA_DISTANCE, Number.NaN)).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_MIN_CAMERA_DISTANCE, -10_000)).toBe(THIRD_PERSON_MIN_CAMERA_DISTANCE);
    expect(thirdPersonCameraDistanceFromWheel(THIRD_PERSON_MAX_CAMERA_DISTANCE, 10_000)).toBe(THIRD_PERSON_MAX_CAMERA_DISTANCE);
  });

  it('adds a safe camera floor only for unusually large vehicle footprints', () => {
    const compactVehicle = { collisionHalfExtents: [0.78, 0.84, 1.92] } as const;
    const movingCastle = { collisionHalfExtents: [3.6, 4, 4.4] } as const;

    expect(resolveLobbyVehicleThirdPersonCameraDistance(
      compactVehicle,
      THIRD_PERSON_CAMERA_DISTANCE,
    )).toBe(THIRD_PERSON_CAMERA_DISTANCE);
    expect(resolveLobbyVehicleThirdPersonCameraDistance(
      compactVehicle,
      THIRD_PERSON_MAX_CAMERA_DISTANCE,
    )).toBe(THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(resolveLobbyVehicleThirdPersonCameraDistance(
      movingCastle,
      THIRD_PERSON_CAMERA_DISTANCE,
    )).toBe(THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(resolveLobbyVehicleThirdPersonCameraDistance(
      movingCastle,
      THIRD_PERSON_MIN_CAMERA_DISTANCE,
    )).toBe(THIRD_PERSON_MAX_CAMERA_DISTANCE);
  });
});

describe('third-person camera collision', () => {
  it('stops in front of a wall instead of passing through it', () => {
    const player = new THREE.Vector3(0, 0, 0);
    const unobstructed = resolveThirdPersonCameraPosition(player, 0, 0, []);
    const blocked = resolveThirdPersonCameraPosition(player, 0, 0, [{
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 1.6), new THREE.Vector3(2, 3, 2)),
    }]);
    const target = thirdPersonCameraTarget(player);
    expect(unobstructed.distanceTo(target)).toBeCloseTo(THIRD_PERSON_CAMERA_DISTANCE, 5);
    expect(unobstructed.y).toBeGreaterThan(1.8);
    expect(blocked.z).toBeLessThan(1.6);
    expect(blocked.z).toBeGreaterThan(0.4);
  });

  it('keeps the tighter follow offset behind the player at different yaw angles', () => {
    const player = new THREE.Vector3(1, 0.02, -2);
    const forward = resolveThirdPersonCameraPosition(player, 0, 0, []);
    const right = resolveThirdPersonCameraPosition(player, Math.PI / 2, 0, []);
    const target = thirdPersonCameraTarget(player);
    expect(forward.x).toBeCloseTo(1, 5);
    expect(forward.z).toBeGreaterThan(0.2);
    expect(right.x).toBeGreaterThan(3.2);
    expect(right.z).toBeCloseTo(-2, 5);
    expect(forward.distanceTo(target)).toBeCloseTo(THIRD_PERSON_CAMERA_DISTANCE, 5);
    expect(right.distanceTo(target)).toBeCloseTo(THIRD_PERSON_CAMERA_DISTANCE, 5);
  });

  it('keeps the normalized Avatar center exactly framed across yaw, pitch, and aspect ratios', () => {
    const player = new THREE.Vector3(1.2, 0.02, -2.4);
    const target = thirdPersonCameraTarget(player);
    const cameraAngles: ReadonlyArray<readonly [number, number]> = [[0, 0], [Math.PI / 2, -0.35], [-2.7, 0.6]];
    for (const distance of [THIRD_PERSON_MIN_CAMERA_DISTANCE, THIRD_PERSON_CAMERA_DISTANCE, THIRD_PERSON_MAX_CAMERA_DISTANCE]) {
      for (const aspect of [16 / 9, 390 / 844, 21 / 9]) {
        for (const [yaw, pitch] of cameraAngles) {
          const camera = new THREE.PerspectiveCamera(75, aspect, 0.05, 250);
          camera.position.copy(resolveThirdPersonCameraPosition(player, yaw, pitch, [], distance));
          camera.lookAt(target);
          camera.updateMatrixWorld(true);
          const projected = target.clone().project(camera);
          expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 5);
          expect(projected.x).toBeCloseTo(0, 6);
          expect(projected.y).toBeCloseTo(0, 6);
        }
      }
    }
  });

  it('keeps a far zoom request while collision clips the actual camera arm', () => {
    const player = new THREE.Vector3(0, 0, 0);
    const target = thirdPersonCameraTarget(player);
    const blocked = resolveThirdPersonCameraPosition(player, 0, 0, [{
      box: new THREE.Box3(new THREE.Vector3(-2, 0, 2.5), new THREE.Vector3(2, 3, 2.8)),
    }], THIRD_PERSON_MAX_CAMERA_DISTANCE);
    const restored = resolveThirdPersonCameraPosition(player, 0, 0, [], THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(blocked.distanceTo(target)).toBeLessThan(THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(blocked.z).toBeLessThan(2.5);
    expect(restored.distanceTo(target)).toBeCloseTo(THIRD_PERSON_MAX_CAMERA_DISTANCE, 5);
  });

  it('keeps interaction reach anchored to the player instead of the pulled-back camera', () => {
    const player = new THREE.Vector3(0, 0.02, -4);
    const terminal = new THREE.Vector3(0, 1.65, -6.72);
    const camera = resolveThirdPersonCameraPosition(player, 0, 0, [], THIRD_PERSON_MAX_CAMERA_DISTANCE);
    expect(camera.distanceTo(terminal)).toBeGreaterThan(3.25);
    expect(lobbyPlayerEyePosition(player).distanceTo(terminal)).toBeLessThan(3.25);
  });

  it('never pushes the camera through an extremely close collider', () => {
    const player = new THREE.Vector3(0, 0, 0);
    const camera = resolveThirdPersonCameraPosition(player, 0, 0, [{
      box: new THREE.Box3(new THREE.Vector3(-1, 0, 0.2), new THREE.Vector3(1, 3, 0.3)),
    }]);
    expect(camera.z).toBeGreaterThanOrEqual(0);
    expect(camera.z).toBeLessThan(0.2);
    expect(camera.distanceTo(thirdPersonCameraTarget(player))).toBeLessThan(0.72);
  });
});
