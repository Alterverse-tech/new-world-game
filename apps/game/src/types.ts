import type * as THREE from 'three';
import type { CreativeCameraTextState } from './creative-camera';
import type { LobbyEditorTextState } from './lobby-editor';
import type { LobbyMultiplayerTextState } from './lobby-multiplayer';
import type { PersistentSpaceChannel } from './lobby-channel';

export type ShellState =
  | 'BOOT'
  | 'HUB'
  | 'HUB_EDIT'
  | 'SCREEN_FOCUS'
  | 'TRANSITION_IN'
  | 'LEVEL_INTRO'
  | 'LEVEL_PLAYING'
  | 'LEVEL_FAILED'
  | 'LEVEL_COMPLETE'
  | 'DOOR_CHOICE'
  | 'PAUSED';

export type WinType = 'reach_zone' | 'collect' | 'puzzle' | 'survive' | 'eliminate' | 'escape' | 'custom';

export interface LevelDefinition {
  id: string;
  name: string;
  author: string;
  type: WinType;
  typeLabel: string;
  difficulty: number;
  estimatedMinutes: number;
  description: string;
  objective: string;
  required?: number;
  flags?: string[];
  duration?: number;
  timeLimit?: number;
  killY: number;
  spawn: [number, number, number];
  yaw: number;
  palette: [string, string, string];
  glyph: string;
  source?: 'official' | 'ugc';
  basePath?: string;
  entry?: string;
  contentHash?: string;
}

export interface Settings {
  sensitivity: number;
  fov: number;
  headBob: boolean;
  volume: number;
  reducedMotion: boolean;
  nickname: string;
  avatarId: string;
  lobbyView: 'first' | 'third';
  thirdPersonCameraDistance: number;
  lang: 'zh-CN';
}

export interface HistoryEntry {
  id: string;
  completedAt: number;
  timeMs: number;
  result: 'complete';
}

export interface SaveData {
  settings: Settings;
  history: HistoryEntry[];
  stats: {
    totalCompleted: number;
    totalDives: number;
  };
  recent: string[];
}

export interface Collider {
  object: THREE.Object3D;
  box: THREE.Box3;
  moving?: boolean;
}

export interface Collectible {
  id: string;
  mesh: THREE.Object3D;
  baseY: number;
  collected: boolean;
  onCollect?: () => void;
}

export interface Interactable {
  id: string;
  object: THREE.Object3D;
  label: string;
  maxDistance: number;
  enabled: boolean;
  onUse: () => void;
}

export interface GoalZone {
  center: THREE.Vector3;
  size: THREE.Vector3;
  reached: boolean;
}

export interface GameTextState {
  coordinateSystem: string;
  mode: 'lobby' | 'persistent-space' | 'level';
  state: ShellState;
  lobbyChannel: {
    selected: string | null;
    entryRequired: boolean;
    joining: boolean;
    phase: 'required' | 'joining' | 'ready' | 'error';
  };
  persistentSpace: {
    id: 'heaven' | 'hell';
    label: string;
    stateChannel: PersistentSpaceChannel;
    originChannel: string;
    returnChannel: string;
    persistence: 'server-backed';
    returnPortalPosition: { x: number; y: number; z: number } | null;
    landmark: {
      kind: 'celestial-riding-dragon' | 'infernal-concert-grand';
      statePersistence: 'server-backed';
      pianoPlaying: boolean;
      activePianoKeys: number;
      dragonOccupied: boolean;
    };
  } | null;
  input: {
    pointerLocked: boolean;
    pausedFrom: ShellState | null;
    controlTarget: 'player' | 'vehicle';
    movementSuppressed: boolean;
  };
  player: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    yawDeg: number;
    facingYawDeg: number;
    movementInputActive: boolean;
    controlSuppressed: boolean;
    visible: boolean;
    pitchDeg: number;
    grounded: boolean;
    checkpoint: { x: number; y: number; z: number };
  };
  camera: {
    position: { x: number; y: number; z: number };
    distanceToPlayerEye: number;
    distanceToAvatarCenter: number;
    requestedDistance: number;
    zoomDistance: number;
    effectiveDistance: number;
    minDistance: number;
    maxDistance: number;
    collisionLimited: boolean;
    avatarTarget: { x: number; y: number; z: number } | null;
    avatarAnchorNdc: { x: number; y: number } | null;
    targetKind: 'player' | 'vehicle';
    vehicleAnchorNdc: { x: number; y: number } | null;
    obstructed: boolean;
  };
  vehicle: {
    active: boolean;
    pendingObjectId: string | null;
    objectId: string | null;
    catalogId: string | null;
    kind: 'car' | 'aircraft' | null;
    flightModel: 'fixed-wing' | 'rotorcraft' | null;
    phase: 'idle' | 'entering' | 'driving' | 'exiting' | null;
    safeExitMode: 'none' | 'autoland' | 'awaiting-recovery' | 'server-autoland' | 'released-autoland' | 'awaiting-release' | null;
    driverId: string | null;
    speedKph: number;
    throttle: number;
    steering: number;
    vertical: number;
    grounded: boolean | null;
    altitude: number | null;
    position: { x: number; y: number; z: number } | null;
    velocity: { x: number; y: number; z: number } | null;
    exitAllowed: boolean;
    exitReason: 'ok' | 'not_driving' | 'moving_too_fast' | 'airborne' | 'no_safe_space' | null;
    persistence: 'runtime-only' | 'server-backed-parked-pose';
  };
  diagnostics: {
    renderer: {
      calls: number;
      triangles: number;
      points: number;
      lines: number;
      geometries: number;
      textures: number;
      pixelRatio: number;
    };
    physics: {
      engine: 'custom-fixed-step';
      timestep: number;
      activeVehicleBodies: number;
      colliders: number;
      sensors: number;
      ccdBodies: number;
    };
  };
  avatarWardrobe: {
    open: boolean;
    context: 'hub' | 'hub_edit' | 'paused_hub' | null;
    selectedAvatarId: string;
    appliedAvatarId: string;
    applying: boolean;
    presetIds: string[];
    accountAvatarIds: string[];
    previews: {
      active: boolean;
      sharedCanvas: boolean;
      renderer: 'idle' | 'ready' | 'unavailable' | 'lost';
      activeLoads: number;
      residentModels: number;
      reducedMotion: boolean;
      items: Array<{
        id: string;
        state: 'idle' | 'loading' | 'loaded' | 'unavailable';
        fallback: boolean;
        rotating: boolean;
      }>;
    };
    upload: {
      enabled: boolean;
      phase: 'idle' | 'selected' | 'uploading' | 'success' | 'error';
      selectedFile: string | null;
      errorCode: string | null;
      uploadedAvatarId: string | null;
    };
  };
  hub?: {
    terminalDistance: number;
    terminalInRange: boolean;
    terminalPosition: { x: number; y: number; z: number };
    terminalFaces: string;
    entrance: {
      kind: 'music-vending-machine';
      phase: 'idle' | 'coin' | 'playing';
      musicPlaying: boolean;
      audioActive: boolean;
      elapsedSeconds: number;
      beat: number | null;
      bar: number | null;
      activeSlots: number[];
      display: string;
      reducedMotion: boolean;
    };
    selectedLevel: string;
    registry: { loaded: boolean; totalLevels: number; communityLevels: number; error: string | null };
  };
  lobbyEditor: LobbyEditorTextState;
  creativeCamera: CreativeCameraTextState;
  multiplayer: LobbyMultiplayerTextState;
  level?: {
    id: string;
    name: string;
    type: WinType;
    source: 'official' | 'ugc';
    objective: string;
    progress: string;
    elapsedSeconds: number;
    remainingSeconds: number | null;
    deaths: number;
    collectibles: Array<{ id: string; x: number; y: number; z: number; collected: boolean }>;
    puzzleExpectedIndex: number | null;
    activeFlags: string[];
    colliders: Array<{ x: number; y: number; z: number; sizeX: number; sizeY: number; sizeZ: number }>;
    interactables: Array<{ label: string; x: number; y: number; z: number; enabled: boolean }>;
    goal: { x: number; y: number; z: number } | null;
    gate: { x: number; y: number; z: number; available: boolean } | null;
    ugc?: {
      flags: string[];
      targets: { down: number; total: number };
      pressurePlates: Array<{ id: string; flag: string | null; pressed: boolean; x: number; y: number; z: number }>;
      runtimeLoaded: boolean;
    };
  };
  nearbyInteraction: string | null;
  availableActions: string[];
  controls: string;
}

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
    readonly __THREE_GAME_DIAGNOSTICS__: {
      renderer: GameTextState['diagnostics']['renderer'];
      physics: GameTextState['diagnostics']['physics'];
    };
  }
}
