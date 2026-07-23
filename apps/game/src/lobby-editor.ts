import * as THREE from 'three';
import { normalizeLobbyChannel, withLobbyChannel, type PersistentSpaceId } from './lobby-channel';
import { LobbyGlbTemplateCache, type LobbyGlbLease } from './lobby-glb-cache';
import {
  classifyLobbyLocation,
  LOBBY_PLOT_SIZE,
  LOBBY_PLOTS,
  LOBBY_WORLD_LIMIT,
  isPointWithinLobbyWorld,
  lobbyPlotById,
  PUBLIC_LOBBY_HALF_EXTENT,
  type LobbyPlotDefinition,
} from './lobby-neighborhood';
import { assignLobbyOwnerPastelColors, LobbyNeighborhoodScene } from './lobby-neighborhood-scene';
import {
  formatLobbyAssetBytes,
  LobbyAssetPreflightError,
  lobbyAssetErrorMessage,
  lobbyAssetNameFromFilename,
  normalizeLobbyAssetLabel,
  preflightLobbyGlbFile,
} from './lobby-asset-upload';
import { LobbyPropPreviewGallery, type LobbyPropPreviewRegistration } from './lobby-prop-preview';
import {
  cancelLobbyPropCreation,
  fetchLobbyPropCreationConfig,
  fetchLobbyPropCreations,
  lobbyPropCreationErrorMessage,
  lobbyPropCreationIsActive,
  lobbyPropCreationStatusLabel,
  lobbyPropPromptIsValid,
  MAX_LOBBY_PROP_PROMPT_CHARACTERS,
  normalizeLobbyPropPrompt,
  submitLobbyPropCreation,
  type LobbyPropCreationJob,
  type LobbyPropCreationWorkerState,
} from './lobby-prop-creation';
import { getLobbyPropModule } from './lobby-props/registry';
import {
  lobbyPortalCapabilitiesMatch,
  lobbyPortalDestinationForSequence,
  parseLobbyPortalCapability,
} from './lobby-props/portal';
import type {
  LobbyPhysicsBodyKind,
  LobbyPhysicsCollider,
  LobbyPhysicsDescriptor,
  LobbyPortalCapability,
  LobbyPortalDestination,
  LobbyVehicleCapability,
  LobbyVehicleKind,
  LobbyVehicleVisualState,
} from './lobby-props/types';
import type { Interactable } from './types';

const LOBBY_MAX_OBJECTS = 200;
const LOBBY_MAX_PERSONAL_ASSETS = 20;
const SYSTEM_TERMINAL_ID = 'system-terminal';
const LOBBY_CONNECTION_ID_KEY = 'wr.lobby.connection.v1';
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const USER_GLB_ASSET_ID_PATTERN = /^user-glb-[a-f0-9]{32}$/;
const MAX_REMOTE_ASSET_REQUESTS = 2;
const REMOTE_ASSET_FAILURE_RETRY_MS = 5_000;
const LOBBY_PROTECTED_ZONES = Object.freeze([
  Object.freeze({ x: 0, z: -7.42, radius: 3.5 }),
  Object.freeze({ x: 0, z: 4.2, radius: 2.25 }),
]);
const FRONT_PLACEMENT_DISTANCES = [4, 6, 8, 10, 12] as const;
const LOBBY_PHYSICS_MAX_COLLIDERS = 8;
const LOBBY_PHYSICS_POSITION_LIMIT = 16;
const LOBBY_PHYSICS_ROTATION_LIMIT = Math.PI;

export type LobbySyncState = 'connecting' | 'synced' | 'saving' | 'offline';
export type LobbyAssetUploadStatus = 'idle' | 'checking' | 'ready' | 'uploading' | 'success' | 'error';

export interface LobbyCatalogItem {
  id: string;
  name: string;
  category: string;
  kind: 'code' | 'glb';
  code?: string;
  assetUrl?: string;
  defaultScale: number;
  realmSpace?: PersistentSpaceId;
  interaction?: { mode: 'cycle' | 'timeline'; durationMs: number; cooldownMs: number };
  physics?: LobbyPhysicsDescriptor;
  portal?: LobbyPortalCapability;
  vehicle?: {
    kind: LobbyVehicleKind;
    enterRadius: number;
    maxSpeed: number;
    maxAcceleration: number;
    maxAngularSpeed: number;
  };
}

export interface LobbyPhysicsWorldPose {
  position: Readonly<{ x: number; y: number; z: number }>;
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
  scale: Readonly<{ x: number; y: number; z: number }>;
}

export interface LobbyPhysicsRuntimePose {
  position: Readonly<{ x: number; y: number; z: number }>;
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
}

export interface LobbyPhysicsPropHandle {
  objectId: string;
  catalogId: string;
  name: string;
  root: THREE.Group;
  physics: LobbyPhysicsDescriptor;
  worldPose: LobbyPhysicsWorldPose;
}

export interface LobbyVehicleRuntimePose {
  objectId: string;
  driverId: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  seq: number;
  visual?: LobbyVehicleVisualState;
}

export interface LobbyVehicleHandle {
  objectId: string;
  catalogId: string;
  name: string;
  root: THREE.Group;
  capability: LobbyVehicleCapability;
  pose: LobbyVehicleRuntimePose;
}

export interface LobbyPortalUse {
  objectId: string;
  catalogId: string;
  name: string;
  sequence: number;
  destination: LobbyPortalDestination;
}

export interface LobbyPropInteractionUse {
  objectId: string;
  catalogId: string;
  name: string;
  sequence: number;
  ageSeconds: number;
  durationMs: number;
}

export interface LobbyLocalPropInteractionUse extends LobbyPropInteractionUse {
  root: THREE.Group;
}

export interface LobbyObjectInteractionState {
  sequence: number;
  startedAt: string | null;
  by: string | null;
  requestId: string | null;
}

export interface LobbyObjectState {
  id: string;
  catalogId: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  locked: boolean;
  system: boolean;
  createdBy: string | null;
  plotId: string | null;
  interaction: LobbyObjectInteractionState;
  revision?: number;
}

export interface LobbyPlotClaim {
  id: string;
  ownerId: string;
  ownerNickname: string;
  claimedAt: string;
  updatedAt: string;
}

export type LobbyObjectOwnership = 'self' | 'other' | 'system' | 'unknown';
export type LobbyObjectScope = 'system' | 'public' | 'legacy-public' | 'home';
export type LobbyEditorEnvironment =
  | { kind: 'lobby'; label: string }
  | { kind: 'persistent-space'; label: string };

export type LobbyEditorAttachmentEnvironment = LobbyEditorEnvironment & {
  placementSurfaces?: readonly THREE.Object3D[];
};

export interface LobbyEditorTextState {
  enabled: boolean;
  channel: string;
  environment: LobbyEditorEnvironment;
  objects: Array<{
    id: string;
    catalogId: string;
    name: string;
    x: number;
    y: number;
    z: number;
    rotationY: number;
    scale: number;
    locked: boolean;
    system: boolean;
    plotId: string | null;
    scope: LobbyObjectScope;
    ownership: LobbyObjectOwnership;
    canEdit: boolean;
    canDelete: boolean;
    interactionSequence: number;
    interactionStartedAt: string | null;
    interactive: boolean;
    interactionState: string;
    physicsKind: LobbyPhysicsBodyKind | null;
    portal: boolean;
    portalDestination: string | null;
    drivable: boolean;
    vehicleKind: LobbyVehicleKind | null;
    occupiedBy: string | null;
    renderMeshCount: number | null;
    shadowCasterCount: number | null;
  }>;
  selected: string | null;
  online: number;
  sync: LobbySyncState;
  identityReady: boolean;
  assets: {
    status: LobbyAssetUploadStatus;
    personalAssetCount: number;
    selectedFileName: string | null;
    errorCode: string | null;
  };
  creations: {
    enabled: boolean | null;
    accountRequired: boolean;
    workerOnline: boolean;
    workerLastSeenAt: string | null;
    status: 'idle' | 'loading' | 'submitting' | 'success' | 'error';
    message: string;
    jobCount: number;
    activeJobId: string | null;
    activeJobStatus: string | null;
    activeJobStage: string | null;
    promptCharacters: number;
  };
  home: {
    enabled: boolean;
    dialogOpen: boolean;
    publicHalfExtent: number;
    plotSize: number;
    totalPlots: number;
    claimedPlots: number;
    availablePlots: number;
    myPlotId: string | null;
    myPlotIds: string[];
    myPlotCount: number;
    selectedMyPlotId: string | null;
    claims: Array<{ id: string; ownerNickname: string; mine: boolean; ownerColor: string }>;
  };
}

interface LobbyEditorElements {
  entry: HTMLButtonElement;
  panel: HTMLElement;
  catalog: HTMLElement;
  empty: HTMLElement;
  selectedName: HTMLElement;
  selectedMeta: HTMLElement;
  channel: HTMLElement;
  online: HTMLElement;
  sync: HTMLElement;
  rotateLeft: HTMLButtonElement;
  rotateRight: HTMLButtonElement;
  scaleDown: HTMLButtonElement;
  scaleUp: HTMLButtonElement;
  delete: HTMLButtonElement;
  exit: HTMLButtonElement;
  homeStatus: HTMLElement;
  homeMeta: HTMLElement;
  homeChoose: HTMLButtonElement;
  homeDialog: HTMLDialogElement;
  homeClose: HTMLButtonElement;
  homeGrid: HTMLElement;
  homeDialogStatus: HTMLElement;
  homeRelease: HTMLButtonElement;
  propCreator: HTMLDetailsElement;
  propCreatorForm: HTMLFormElement;
  propPrompt: HTMLTextAreaElement;
  propPromptCount: HTMLElement;
  propWorker: HTMLElement;
  propStatus: HTMLElement;
  propLogin: HTMLButtonElement;
  propSubmit: HTMLButtonElement;
  propRefresh: HTMLButtonElement;
  propJobList: HTMLElement;
  assetUpload: HTMLDetailsElement;
  assetForm: HTMLFormElement;
  assetDropzone: HTMLLabelElement;
  assetFile: HTMLInputElement;
  assetFileMeta: HTMLElement;
  assetName: HTMLInputElement;
  assetCategory: HTMLInputElement;
  assetStatus: HTMLElement;
  assetSubmit: HTMLButtonElement;
}

interface LobbyObjectRecord {
  state: LobbyObjectState;
  item: LobbyCatalogItem;
  root: THREE.Group;
  propRoot: THREE.Object3D;
  update?: (object: THREE.Object3D, elapsed: number) => void;
  interact?: (object: THREE.Object3D) => void;
  applyInteraction?: (
    object: THREE.Object3D,
    interaction: { sequence: number; ageSeconds: number },
    elapsed: number,
  ) => void;
  appliedInteractionSequence: number;
  collidable: boolean;
  collisionVersion: unknown;
  physics?: LobbyPhysicsDescriptor;
  portal?: LobbyPortalCapability;
  vehicle?: LobbyVehicleCapability;
  updateVehicleVisual?: (
    object: THREE.Object3D,
    state: LobbyVehicleVisualState,
    elapsed: number,
  ) => void;
  assetLease?: LobbyGlbLease;
}

interface LobbyObjectTransformSnapshot {
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  plotId: string | null;
  revision: number | undefined;
  runtimeVehicle: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    generation: number;
  } | null;
}

interface LobbyEditorOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  onExit: () => void;
  onColliderChanged: (id: string, object: THREE.Object3D | null, collidable: boolean) => void;
  onToast: (text: string, durationMs?: number) => void;
  getNickname: () => string;
  onPortalUse?: (portal: LobbyPortalUse) => void;
  onPropInteraction?: (interaction: LobbyPropInteractionUse) => void;
  onLocalPropInteraction?: (interaction: LobbyLocalPropInteractionUse) => void;
  isAccountSignedIn: () => boolean;
  onAccountRequired: () => void;
  onVehicleUse?: (vehicle: LobbyVehicleHandle) => void;
}

const FALLBACK_CATALOG: LobbyCatalogItem[] = [
  { id: 'code-glow-cube', name: '呼吸光立方', category: '氛围', kind: 'code', code: 'glow-cube', defaultScale: 1, interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 150 } },
  { id: 'code-soft-bench', name: '软垫长椅', category: '家具', kind: 'code', code: 'soft-bench', defaultScale: 1, interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 150 } },
  { id: 'code-light-arch', name: '流光拱门', category: '建筑', kind: 'code', code: 'light-arch', defaultScale: 1, interaction: { mode: 'cycle', durationMs: 0, cooldownMs: 150 } },
];

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing lobby editor element #${id}`);
  return element as T;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteFrom(value: unknown, fallback: number): number {
  if (typeof value === 'number') return finite(value, fallback);
  if (typeof value === 'string' && value.trim() !== '') return finite(Number(value), fallback);
  return fallback;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedPhysicsNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) return null;
  return Object.is(value, -0) ? 0 : value;
}

function physicsVector(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = boundedPhysicsNumber(value[0], minimum, maximum);
  const y = boundedPhysicsNumber(value[1], minimum, maximum);
  const z = boundedPhysicsNumber(value[2], minimum, maximum);
  return x === null || y === null || z === null ? null : Object.freeze([x, y, z] as const);
}

function parseLobbyPhysicsCollider(value: unknown): LobbyPhysicsCollider | null {
  if (!plainRecord(value)) return null;
  const position = physicsVector(value.position, -LOBBY_PHYSICS_POSITION_LIMIT, LOBBY_PHYSICS_POSITION_LIMIT);
  const rotation = physicsVector(value.rotation, -LOBBY_PHYSICS_ROTATION_LIMIT, LOBBY_PHYSICS_ROTATION_LIMIT);
  if (!position || !rotation) return null;
  if (value.shape === 'box') {
    if (!exactKeys(value, ['shape', 'halfExtents', 'position', 'rotation'])) return null;
    const halfExtents = physicsVector(value.halfExtents, 0.05, 12);
    return halfExtents ? Object.freeze({ shape: 'box', halfExtents, position, rotation }) : null;
  }
  if (value.shape === 'capsule') {
    if (!exactKeys(value, ['shape', 'radius', 'halfHeight', 'position', 'rotation'])) return null;
    const radius = boundedPhysicsNumber(value.radius, 0.05, 4);
    const halfHeight = boundedPhysicsNumber(value.halfHeight, 0.05, 8);
    return radius === null || halfHeight === null
      ? null
      : Object.freeze({ shape: 'capsule', radius, halfHeight, position, rotation });
  }
  if (value.shape === 'ball') {
    if (!exactKeys(value, ['shape', 'radius', 'position', 'rotation'])) return null;
    const radius = boundedPhysicsNumber(value.radius, 0.05, 8);
    return radius === null ? null : Object.freeze({ shape: 'ball', radius, position, rotation });
  }
  return null;
}

/**
 * Parses the small, reviewed code-prop physics contract. Invalid metadata is
 * rejected rather than clamped so catalog/module drift can never silently
 * create a different collision shape.
 */
export function parseLobbyPhysicsDescriptor(value: unknown): LobbyPhysicsDescriptor | null {
  if (!plainRecord(value)) return null;
  const allowedKeys = value.body === 'dynamic'
    ? (Object.hasOwn(value, 'breakImpulse')
        ? ['body', 'mass', 'friction', 'restitution', 'colliders', 'breakImpulse']
        : ['body', 'mass', 'friction', 'restitution', 'colliders'])
    : ['body', 'mass', 'friction', 'restitution', 'colliders'];
  if (!exactKeys(value, allowedKeys)) return null;
  if (value.body !== 'fixed' && value.body !== 'dynamic') return null;
  const mass = value.body === 'fixed'
    ? boundedPhysicsNumber(value.mass, 0, 0)
    : boundedPhysicsNumber(value.mass, 0.1, 5_000);
  const friction = boundedPhysicsNumber(value.friction, 0, 2);
  const restitution = boundedPhysicsNumber(value.restitution, 0, 1);
  if (mass === null || friction === null || restitution === null) return null;
  if (
    !Array.isArray(value.colliders)
    || value.colliders.length < 1
    || value.colliders.length > LOBBY_PHYSICS_MAX_COLLIDERS
  ) return null;
  const colliders = value.colliders.map(parseLobbyPhysicsCollider);
  if (colliders.some((collider) => collider === null)) return null;
  const normalizedColliders = Object.freeze(colliders as LobbyPhysicsCollider[]);
  if (value.body === 'fixed') {
    return Object.freeze({ body: 'fixed', mass, friction, restitution, colliders: normalizedColliders });
  }
  if (!Object.hasOwn(value, 'breakImpulse')) {
    return Object.freeze({ body: 'dynamic', mass, friction, restitution, colliders: normalizedColliders });
  }
  const breakImpulse = boundedPhysicsNumber(value.breakImpulse, 1, 100_000);
  return breakImpulse === null
    ? null
    : Object.freeze({ body: 'dynamic', mass, friction, restitution, colliders: normalizedColliders, breakImpulse });
}

export function lobbyPhysicsDescriptorsMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = parseLobbyPhysicsDescriptor(left);
  const normalizedRight = parseLobbyPhysicsDescriptor(right);
  return Boolean(normalizedLeft && normalizedRight && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight));
}

export function isLobbyPlacementProtected(x: number, z: number, padding = 1.25): boolean {
  return LOBBY_PROTECTED_ZONES.some((zone) => {
    const deltaX = x - zone.x;
    const deltaZ = z - zone.z;
    const radius = zone.radius + padding;
    return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
  });
}

export function isUserLobbyGlbAssetId(value: unknown): value is string {
  return typeof value === 'string' && USER_GLB_ASSET_ID_PATTERN.test(value);
}

export function lobbyPlacementInFront(position: THREE.Vector3, direction: THREE.Vector3): THREE.Vector2 {
  const forward = new THREE.Vector3(direction.x, 0, direction.z);
  if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
  forward.normalize();
  let fallback = new THREE.Vector2(
    THREE.MathUtils.clamp(position.x + forward.x * FRONT_PLACEMENT_DISTANCES[0], -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
    THREE.MathUtils.clamp(position.z + forward.z * FRONT_PLACEMENT_DISTANCES[0], -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
  );
  for (const distance of FRONT_PLACEMENT_DISTANCES) {
    const candidate = new THREE.Vector2(
      THREE.MathUtils.clamp(position.x + forward.x * distance, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
      THREE.MathUtils.clamp(position.z + forward.z * distance, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
    );
    fallback = candidate;
    if (!isLobbyPlacementProtected(candidate.x, candidate.y)) return candidate;
  }
  return fallback;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
}

function cleanLabel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;
}

export function sanitizeLobbyOwnerNickname(value: unknown, fallback = '访客'): string {
  const source = typeof value === 'string' ? value : fallback;
  const normalized = source.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const allowed = [...normalized]
    .filter((character) => /[\p{L}\p{N}\p{M} ._-]/u.test(character))
    .slice(0, 24)
    .join('')
    .trim()
    .replace(/\s+/gu, ' ');
  return /[\p{L}\p{N}]/u.test(allowed) ? allowed : fallback;
}

function normalizeAngle(value: number): number {
  const full = Math.PI * 2;
  return THREE.MathUtils.clamp(((value + Math.PI) % full + full) % full - Math.PI, -Math.PI, Math.PI);
}

function readVector(value: unknown): { x: number; y: number; z: number } {
  if (Array.isArray(value)) {
    return { x: finiteFrom(value[0], 0), y: finiteFrom(value[1], 0), z: finiteFrom(value[2], 0) };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return { x: finiteFrom(record.x, 0), y: finiteFrom(record.y, 0), z: finiteFrom(record.z, 0) };
  }
  return { x: 0, y: 0, z: 0 };
}

function normalizeLobbyInteraction(value: unknown): LobbyObjectInteractionState {
  if (!value || typeof value !== 'object') {
    return { sequence: 0, startedAt: null, by: null, requestId: null };
  }
  const record = value as Record<string, unknown>;
  const sequence = Number.isSafeInteger(record.sequence) && Number(record.sequence) >= 0
    ? Number(record.sequence)
    : 0;
  if (sequence === 0) return { sequence: 0, startedAt: null, by: null, requestId: null };
  const startedAt = typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt))
    ? record.startedAt
    : null;
  const by = typeof record.by === 'string' && CLIENT_ID_PATTERN.test(record.by) ? record.by : null;
  const requestId = typeof record.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(record.requestId)
    ? record.requestId
    : null;
  return startedAt && by && requestId
    ? { sequence, startedAt, by, requestId }
    : { sequence: 0, startedAt: null, by: null, requestId: null };
}

export function isAuthoritativeLocalLobbyInteraction(
  interaction: Pick<LobbyObjectInteractionState, 'sequence' | 'requestId'>,
  requestId: string,
  baseSequence: number,
): boolean {
  return interaction.requestId === requestId && interaction.sequence === baseSequence + 1;
}

function lobbyInteractionAgeSeconds(
  interaction: Pick<LobbyObjectInteractionState, 'startedAt'>,
  serverTimeOffsetMs: number,
): number {
  const startedAt = interaction.startedAt ? Date.parse(interaction.startedAt) : Number.NaN;
  return Number.isFinite(startedAt)
    ? Math.max(0, (Date.now() + serverTimeOffsetMs - startedAt) / 1000)
    : 0;
}

export function normalizeLobbyObject(
  value: unknown,
  environment: LobbyEditorEnvironment = { kind: 'lobby', label: '大厅' },
): LobbyObjectState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = validId(record.id) ? record.id : null;
  const catalogIdValue = record.catalogId ?? record.itemId ?? record.assetId;
  const catalogId = validId(catalogIdValue) ? catalogIdValue : null;
  if (!id || !catalogId) return null;
  const position = readVector(record.position);
  const rotationValue = record.rotationY ?? (record.rotation && typeof record.rotation === 'object'
    ? (record.rotation as Record<string, unknown>).y
    : record.rotation);
  const scaleValue = Array.isArray(record.scale)
    ? record.scale[0]
    : record.scale && typeof record.scale === 'object'
      ? (record.scale as Record<string, unknown>).x
      : record.scale;
  const revision = finiteFrom(record.revision, Number.NaN);
  const clampedPosition = {
    x: THREE.MathUtils.clamp(position.x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
    y: THREE.MathUtils.clamp(position.y, 0, 8),
    z: THREE.MathUtils.clamp(position.z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
  };
  const location = classifyLobbyLocation(clampedPosition.x, clampedPosition.z);
  const reportedPlot = typeof record.plotId === 'string' ? lobbyPlotById(record.plotId) : null;
  return {
    id,
    catalogId,
    position: clampedPosition,
    rotationY: normalizeAngle(finiteFrom(rotationValue, 0)),
    scale: THREE.MathUtils.clamp(finiteFrom(scaleValue, 1), 0.25, 3),
    locked: record.locked === true,
    system: record.system === true,
    createdBy: CLIENT_ID_PATTERN.test(typeof record.createdBy === 'string' ? record.createdBy : '')
      ? record.createdBy as string
      : null,
    // Position is the authority for normal objects. A canonical reported plot is
    // retained only for malformed/gap payloads so the client fails closed.
    plotId: environment.kind === 'persistent-space'
      ? null
      : location.kind === 'plot' ? location.plot.id : reportedPlot?.id ?? null,
    interaction: normalizeLobbyInteraction(record.interaction),
    ...(Number.isFinite(revision) ? { revision } : {}),
  };
}

export function normalizeLobbyPlotClaim(value: unknown): LobbyPlotClaim | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const plot = typeof record.id === 'string' ? lobbyPlotById(record.id) : null;
  const ownerId = typeof record.ownerId === 'string' && CLIENT_ID_PATTERN.test(record.ownerId)
    ? record.ownerId
    : null;
  if (!plot || !ownerId) return null;
  const claimedAt = typeof record.claimedAt === 'string' && Number.isFinite(Date.parse(record.claimedAt))
    ? record.claimedAt
    : '';
  const updatedAt = typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
    ? record.updatedAt
    : claimedAt;
  return {
    id: plot.id,
    ownerId,
    ownerNickname: sanitizeLobbyOwnerNickname(record.ownerNickname, '匿名玩家'),
    claimedAt,
    updatedAt,
  };
}

export function lobbyHomeClaimsForOwner(
  claims: Iterable<LobbyPlotClaim>,
  ownerId: string | null,
): LobbyPlotClaim[] {
  if (!ownerId) return [];
  return [...claims]
    .filter((claim) => claim.ownerId === ownerId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function selectedLobbyHomePlotId(
  claims: Iterable<LobbyPlotClaim>,
  ownerId: string | null,
  preferredPlotId: string | null,
): string | null {
  const owned = lobbyHomeClaimsForOwner(claims, ownerId);
  return owned.some((claim) => claim.id === preferredPlotId) ? preferredPlotId : owned[0]?.id ?? null;
}

export function canEditLobbyObjectForOwner(
  object: Pick<LobbyObjectState, 'locked' | 'system' | 'plotId'>,
  ownerId: string | null,
  claim: LobbyPlotClaim | null,
): boolean {
  if (!canEditLobbyObject(object)) return false;
  if (!object.plotId) return true;
  return Boolean(ownerId && claim && claim.id === object.plotId && claim.ownerId === ownerId);
}

export function lobbyDragPositionChanged(
  start: Readonly<{ x: number; z: number }>,
  current: Readonly<{ x: number; z: number }>,
): boolean {
  return Math.hypot(current.x - start.x, current.z - start.z) > 1e-4;
}

function lobbyObjectScope(object: LobbyObjectState): LobbyObjectScope {
  if (object.system) return 'system';
  if (object.plotId) return 'home';
  return classifyLobbyLocation(object.position.x, object.position.z).kind === 'invalid'
    ? 'legacy-public'
    : 'public';
}

export function parseLobbyCatalog(value: unknown): LobbyCatalogItem[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).items)
      ? (value as { items: unknown[] }).items
      : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).catalog)
        ? (value as { catalog: unknown[] }).catalog
        : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).assets)
          ? (value as { assets: unknown[] }).assets
        : [];
  const seen = new Set<string>();
  const result: LobbyCatalogItem[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    if (!validId(record.id) || seen.has(record.id)) continue;
    const kind = record.kind === 'glb' || (typeof record.assetUrl === 'string' && !record.code) ? 'glb' : 'code';
    const code = typeof record.code === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(record.code) ? record.code : undefined;
    const assetUrl = typeof record.assetUrl === 'string' && record.assetUrl.trim() ? record.assetUrl.trim().slice(0, 500) : undefined;
    if ((kind === 'code' && !code) || (kind === 'glb' && !assetUrl)) continue;
    const item: LobbyCatalogItem = {
      id: record.id,
      name: cleanLabel(record.name, record.id),
      category: cleanLabel(record.category, kind === 'code' ? '代码物件' : 'GLB 模型'),
      kind,
      defaultScale: THREE.MathUtils.clamp(finiteFrom(record.defaultScale, 1), 0.25, 3),
    };
    if (record.realmSpace === 'heaven' || record.realmSpace === 'hell') item.realmSpace = record.realmSpace;
    if (record.interaction && typeof record.interaction === 'object') {
      const interaction = record.interaction as Record<string, unknown>;
      if (
        (interaction.mode === 'cycle' || interaction.mode === 'timeline')
        && Number.isSafeInteger(interaction.durationMs)
        && Number(interaction.durationMs) >= 0
        && Number.isSafeInteger(interaction.cooldownMs)
        && Number(interaction.cooldownMs) >= 100
      ) {
        item.interaction = {
          mode: interaction.mode,
          durationMs: Number(interaction.durationMs),
          cooldownMs: Number(interaction.cooldownMs),
        };
      }
    }
    if (kind === 'code' && Object.hasOwn(record, 'physics')) {
      const physics = parseLobbyPhysicsDescriptor(record.physics);
      if (physics) item.physics = physics;
    }
    if (kind === 'code' && Object.hasOwn(record, 'portal')) {
      const portal = parseLobbyPortalCapability(record.portal);
      if (portal) item.portal = portal;
    }
    if (record.vehicle && typeof record.vehicle === 'object') {
      const vehicle = record.vehicle as Record<string, unknown>;
      if (
        (vehicle.kind === 'car' || vehicle.kind === 'aircraft')
        && Number.isFinite(vehicle.enterRadius)
        && Number.isFinite(vehicle.maxSpeed)
        && Number.isFinite(vehicle.maxAcceleration)
        && Number.isFinite(vehicle.maxAngularSpeed)
      ) {
        item.vehicle = {
          kind: vehicle.kind,
          enterRadius: THREE.MathUtils.clamp(Number(vehicle.enterRadius), 1.5, 6),
          maxSpeed: THREE.MathUtils.clamp(Number(vehicle.maxSpeed), 1, 40),
          maxAcceleration: THREE.MathUtils.clamp(Number(vehicle.maxAcceleration), 1, 30),
          maxAngularSpeed: THREE.MathUtils.clamp(Number(vehicle.maxAngularSpeed), 0.1, Math.PI * 2),
        };
      }
    }
    if (code) item.code = code;
    if (assetUrl) item.assetUrl = assetUrl;
    seen.add(item.id);
    result.push(item);
  }
  return result.slice(0, LOBBY_MAX_OBJECTS);
}

/**
 * Personal uploads are shown first, while the authoritative system catalog
 * wins any accidental identifier collision and always remains available.
 */
export function mergeLobbyCatalog(
  systemItems: Iterable<LobbyCatalogItem>,
  personalItems: Iterable<LobbyCatalogItem>,
): LobbyCatalogItem[] {
  const system = new Map<string, LobbyCatalogItem>();
  for (const item of systemItems) {
    if (!system.has(item.id)) system.set(item.id, item);
  }
  const personal = new Map<string, LobbyCatalogItem>();
  for (const item of personalItems) {
    if (!system.has(item.id) && !personal.has(item.id)) personal.set(item.id, item);
  }
  const personalLimit = Math.max(0, LOBBY_MAX_OBJECTS - system.size);
  return [...[...personal.values()].slice(0, personalLimit), ...system.values()].slice(0, LOBBY_MAX_OBJECTS);
}

export function canEditLobbyObject(object: Pick<LobbyObjectState, 'locked' | 'system'>): boolean {
  return !object.locked && !object.system;
}

export function lobbyObjectOwnership(
  object: Pick<LobbyObjectState, 'createdBy' | 'locked' | 'system'>,
  ownerId: string | null,
): LobbyObjectOwnership {
  if (!canEditLobbyObject(object)) return 'system';
  if (!object.createdBy || !CLIENT_ID_PATTERN.test(object.createdBy) || !ownerId || !CLIENT_ID_PATTERN.test(ownerId)) return 'unknown';
  return object.createdBy === ownerId ? 'self' : 'other';
}

export function canDeleteLobbyObject(
  object: Pick<LobbyObjectState, 'createdBy' | 'locked' | 'system'>,
  ownerId: string | null,
): boolean {
  void ownerId;
  return canEditLobbyObject(object);
}

export function isPendingLobbyObjectId(id: string): boolean {
  return id.startsWith('local-');
}

export function acceptsLobbyObjectRevision(
  incoming: number | undefined,
  current: number | undefined,
  tombstone: number | undefined,
): boolean {
  if (incoming === undefined) return current === undefined && tombstone === undefined;
  if (tombstone !== undefined && incoming <= tombstone) return false;
  if (current !== undefined && incoming < current) return false;
  return true;
}

export function acceptsLobbySnapshotRevision(incoming: number | undefined, seen: number): boolean {
  if (incoming === undefined) return seen === 0;
  return incoming >= seen;
}

export function acceptsLobbyPlotRevision(incoming: number | undefined, current: number | undefined): boolean {
  return incoming === undefined ? current === undefined : current === undefined || incoming >= current;
}

export type LobbySnapshotMissingAction = 'keep-local' | 'defer-tombstone' | 'remove';

export function lobbySnapshotMissingAction(
  id: string,
  mutationQueued: boolean,
  deletePending: boolean,
): LobbySnapshotMissingAction {
  if (isPendingLobbyObjectId(id) || deletePending) return 'keep-local';
  return mutationQueued ? 'defer-tombstone' : 'remove';
}

export function lobbyDeletedObjectId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (validId(record.objectId)) return record.objectId;
  if (validId(record.id)) return record.id;
  if (record.object && typeof record.object === 'object' && validId((record.object as Record<string, unknown>).id)) {
    return (record.object as { id: string }).id;
  }
  return null;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else mesh.material?.dispose();
  });
}

function extractPayloadObject(
  value: unknown,
  environment: LobbyEditorEnvironment,
): LobbyObjectState | null {
  if (!value || typeof value !== 'object') return normalizeLobbyObject(value, environment);
  const record = value as Record<string, unknown>;
  return normalizeLobbyObject(record.object ?? record.data ?? value, environment);
}

function payloadRevision(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : null;
  const revision = finiteFrom(record.revision ?? nested?.revision, Number.NaN);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

function extractPayloadPlot(value: unknown): LobbyPlotClaim | null {
  if (!value || typeof value !== 'object') return normalizeLobbyPlotClaim(value);
  const record = value as Record<string, unknown>;
  return normalizeLobbyPlotClaim(record.plot ?? record.data ?? value);
}

function releasedPlotId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const valueId = record.plotId ?? record.id;
  return typeof valueId === 'string' && lobbyPlotById(valueId) ? valueId : null;
}

class LobbyMutationError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'LobbyMutationError';
  }
}

class LobbyAssetRequestError extends Error {
  public constructor(public readonly code: string | null, message: string) {
    super(message);
    this.name = 'LobbyAssetRequestError';
  }
}

function apiErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown>
    : null;
  const code = nested?.code ?? record.code;
  return typeof code === 'string' && code.length <= 80 ? code : null;
}

export class LobbyEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly options: LobbyEditorOptions;
  private readonly ui: LobbyEditorElements;
  private readonly previews: LobbyPropPreviewGallery;
  private readonly glbCache = new LobbyGlbTemplateCache();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly lifecycle = new AbortController();
  private ownerId: string | null = null;
  private channel: string | null = null;
  private environment: LobbyEditorEnvironment = { kind: 'lobby', label: '大厅' };
  private placementSurfaces: THREE.Object3D[] = [];
  private readonly connectionId: string;
  private root: THREE.Group | null = null;
  private neighborhood: LobbyNeighborhoodScene | null = null;
  private systemCatalog = new Map(FALLBACK_CATALOG.map((item) => [item.id, item]));
  private readonly personalCatalog = new Map<string, LobbyCatalogItem>();
  private readonly remoteCatalog = new Map<string, LobbyCatalogItem>();
  private catalog = new Map(FALLBACK_CATALOG.map((item) => [item.id, item]));
  private readonly remoteAssetControllers = new Map<string, AbortController>();
  private readonly remoteAssetFailures = new Map<string, number>();
  private readonly remoteAssetQueued = new Set<string>();
  private readonly remoteAssetQueue: Array<{ id: string; generation: number; epoch: number }> = [];
  private remoteAssetActive = 0;
  private remoteAssetEpoch = 0;
  private readonly records = new Map<string, LobbyObjectRecord>();
  private readonly runtimeVehicles = new Map<string, LobbyVehicleRuntimePose>();
  private readonly runtimeVehicleGenerations = new Map<string, number>();
  private readonly runtimePhysicsPoses = new Map<string, LobbyPhysicsRuntimePose>();
  private readonly systemObjects = new Map<string, LobbyObjectState>();
  private readonly plots = new Map<string, LobbyPlotClaim>();
  private readonly plotRevisions = new Map<string, number>();
  private readonly tombstones = new Map<string, number>();
  private readonly pendingDeletes = new Set<string>();
  private readonly pendingInteractions = new Set<string>();
  private readonly objectMutationQueues = new Map<string, Promise<void>>();
  private selectedId: string | null = null;
  private selectionHelper: THREE.BoxHelper | null = null;
  private source: EventSource | null = null;
  private loadController: AbortController | null = null;
  private uploadController: AbortController | null = null;
  private propCreationRefreshController: AbortController | null = null;
  private propCreationMutationController: AbortController | null = null;
  private propCreationPollTimer: number | null = null;
  private readonly mutationControllers = new Set<AbortController>();
  private generation = 0;
  private pendingMutations = 0;
  private snapshotRevision = 0;
  private online = 1;
  private sync: LobbySyncState = 'connecting';
  private lastElapsed = 0;
  private serverTimeOffsetMs = 0;
  private dragging: {
    pointerId: number;
    objectId: string;
    offsetX: number;
    offsetZ: number;
    startX: number;
    startZ: number;
    moved: boolean;
    rollback: LobbyObjectTransformSnapshot;
  } | null = null;
  private nickname: string;
  private plotMutationPending = false;
  private selectedHomePlotId: string | null = null;
  private selectedAssetFile: File | null = null;
  private selectedAssetFileName: string | null = null;
  private assetPreflightReady = false;
  private assetSelectionSequence = 0;
  private assetUploadStatus: LobbyAssetUploadStatus = 'idle';
  private assetUploadMessage = '选好模型后会先做快速检查';
  private assetUploadErrorCode: string | null = null;
  private propCreationJobs: LobbyPropCreationJob[] = [];
  private propCreationWorker: LobbyPropCreationWorkerState = { online: false, lastSeenAt: null };
  private propCreationEnabled: boolean | null = null;
  private propCreationStatus: 'idle' | 'loading' | 'submitting' | 'success' | 'error' = 'idle';
  private propCreationMessage = '输入描述后即可提交创作任务';
  private propCreationBusy = false;
  private revealCatalogId: string | null = null;
  private isEnabled = false;

  public constructor(options: LobbyEditorOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.nickname = sanitizeLobbyOwnerNickname(options.getNickname());
    this.connectionId = this.loadConnectionId();
    this.ui = {
      entry: byId<HTMLButtonElement>('lobby-editor-entry'),
      panel: byId('lobby-editor-panel'),
      catalog: byId('lobby-catalog'),
      empty: byId('lobby-editor-empty'),
      selectedName: byId('lobby-selected-name'),
      selectedMeta: byId('lobby-selected-meta'),
      channel: byId('lobby-channel'),
      online: byId('lobby-online'),
      sync: byId('lobby-sync'),
      rotateLeft: byId<HTMLButtonElement>('lobby-rotate-left'),
      rotateRight: byId<HTMLButtonElement>('lobby-rotate-right'),
      scaleDown: byId<HTMLButtonElement>('lobby-scale-down'),
      scaleUp: byId<HTMLButtonElement>('lobby-scale-up'),
      delete: byId<HTMLButtonElement>('lobby-delete'),
      exit: byId<HTMLButtonElement>('lobby-editor-exit'),
      homeStatus: byId('lobby-home-status'),
      homeMeta: byId('lobby-home-meta'),
      homeChoose: byId<HTMLButtonElement>('lobby-home-choose'),
      homeDialog: byId<HTMLDialogElement>('lobby-home-dialog'),
      homeClose: byId<HTMLButtonElement>('lobby-home-close'),
      homeGrid: byId('lobby-home-grid'),
      homeDialogStatus: byId('lobby-home-dialog-status'),
      homeRelease: byId<HTMLButtonElement>('lobby-home-release'),
      propCreator: byId<HTMLDetailsElement>('lobby-prop-creator'),
      propCreatorForm: byId<HTMLFormElement>('lobby-prop-creator-form'),
      propPrompt: byId<HTMLTextAreaElement>('lobby-prop-prompt'),
      propPromptCount: byId('lobby-prop-prompt-count'),
      propWorker: byId('lobby-prop-worker'),
      propStatus: byId('lobby-prop-creator-status'),
      propLogin: byId<HTMLButtonElement>('lobby-prop-login'),
      propSubmit: byId<HTMLButtonElement>('lobby-prop-submit'),
      propRefresh: byId<HTMLButtonElement>('lobby-prop-refresh'),
      propJobList: byId('lobby-prop-job-list'),
      assetUpload: byId<HTMLDetailsElement>('lobby-asset-upload'),
      assetForm: byId<HTMLFormElement>('lobby-asset-upload-form'),
      assetDropzone: byId<HTMLLabelElement>('lobby-asset-dropzone'),
      assetFile: byId<HTMLInputElement>('lobby-asset-file'),
      assetFileMeta: byId('lobby-asset-file-meta'),
      assetName: byId<HTMLInputElement>('lobby-asset-name'),
      assetCategory: byId<HTMLInputElement>('lobby-asset-category'),
      assetStatus: byId('lobby-asset-upload-status'),
      assetSubmit: byId<HTMLButtonElement>('lobby-asset-submit'),
    };
    this.previews = new LobbyPropPreviewGallery(this.ui.catalog);
    this.bindUi();
    this.renderCatalog();
    this.updateAssetUploadUi();
    this.renderPropCreationJobs();
    this.updatePropCreationUi();
    this.updateUi();
  }

  public setNickname(value: string): void {
    const nickname = sanitizeLobbyOwnerNickname(value);
    if (nickname === this.nickname) return;
    this.nickname = nickname;
    this.updateUi();
    void this.syncOwnerNickname();
  }

  public setChannel(value: string): void {
    const channel = normalizeLobbyChannel(value);
    if (!channel) throw new TypeError('Lobby channel must be a public lobby or reviewed persistent space');
    if (this.channel === channel) {
      this.updateUi();
      return;
    }
    const attachedRoot = this.root;
    const placementSurfaces = this.placementSurfaces;
    if (attachedRoot) this.detachHub();
    this.channel = channel;
    this.updateUi();
    if (attachedRoot) this.attachHub(attachedRoot, { ...this.environment, placementSurfaces });
  }

  public attachHub(
    root: THREE.Group,
    environment: LobbyEditorAttachmentEnvironment = { kind: 'lobby', label: '大厅' },
  ): void {
    const placementSurfaces = environment.kind === 'persistent-space'
      ? [...(environment.placementSurfaces ?? [])]
      : [];
    this.detachHub();
    if (!this.channel) return;
    this.environment = { kind: environment.kind, label: environment.label };
    this.placementSurfaces = placementSurfaces;
    this.root = root;
    if (this.environment.kind === 'lobby') {
      this.neighborhood = new LobbyNeighborhoodScene();
      this.neighborhood.attach(root);
      this.refreshNeighborhoodScene();
    }
    this.generation += 1;
    if (this.environment.kind === 'lobby') {
      this.systemObjects.set(SYSTEM_TERMINAL_ID, {
        id: SYSTEM_TERMINAL_ID,
        catalogId: 'terminal',
        position: { x: 0, y: 0, z: -7.42 },
        rotationY: 0,
        scale: 1,
        locked: true,
        system: true,
        createdBy: null,
        plotId: null,
        interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
      });
    }
    this.ui.entry.classList.remove('hidden');
    this.setSync('connecting');
    void this.loadSharedLobby(this.generation);
    this.connectEvents(this.generation);
  }

  public detachHub(): void {
    this.disable(false);
    this.generation += 1;
    this.loadController?.abort();
    this.loadController = null;
    this.remoteAssetEpoch += 1;
    for (const controller of this.remoteAssetControllers.values()) controller.abort();
    this.remoteAssetControllers.clear();
    this.remoteAssetFailures.clear();
    this.remoteCatalog.clear();
    this.remoteAssetQueued.clear();
    this.remoteAssetQueue.length = 0;
    this.remoteAssetActive = 0;
    for (const controller of this.mutationControllers) controller.abort();
    this.mutationControllers.clear();
    this.pendingMutations = 0;
    this.objectMutationQueues.clear();
    this.pendingDeletes.clear();
    this.pendingInteractions.clear();
    this.plots.clear();
    this.plotRevisions.clear();
    this.plotMutationPending = false;
    this.selectedHomePlotId = null;
    this.tombstones.clear();
    this.snapshotRevision = 0;
    this.source?.close();
    this.source = null;
    this.dragging = null;
    this.clearSelection();
    for (const [id, record] of this.records) {
      this.options.onColliderChanged(id, null, record.collidable);
      record.root.removeFromParent();
      this.disposeRecord(record);
    }
    this.records.clear();
    this.runtimeVehicles.clear();
    this.runtimeVehicleGenerations.clear();
    this.runtimePhysicsPoses.clear();
    this.glbCache.clear();
    this.systemObjects.clear();
    this.neighborhood?.dispose();
    this.neighborhood = null;
    this.placementSurfaces = [];
    this.root = null;
    if (this.ui.homeDialog.open) this.ui.homeDialog.close();
    this.ui.entry.classList.add('hidden');
    this.updateUi();
  }

  public dispose(): void {
    this.detachHub();
    this.uploadController?.abort();
    this.uploadController = null;
    this.propCreationRefreshController?.abort();
    this.propCreationRefreshController = null;
    this.propCreationMutationController?.abort();
    this.propCreationMutationController = null;
    this.clearPropCreationPollTimer();
    this.previews.dispose();
    this.lifecycle.abort();
  }

  public enable(): void {
    if (!this.root) return;
    this.isEnabled = true;
    this.ui.panel.classList.add('visible');
    this.ui.panel.setAttribute('aria-hidden', 'false');
    this.ui.entry.classList.add('active');
    this.previews.setActive(true);
    this.updateUi();
    void this.refreshPropCreations(true);
  }

  public disable(notify = true): void {
    if (!this.isEnabled && !this.ui.panel.classList.contains('visible')) return;
    this.finishPointerInteraction();
    this.isEnabled = false;
    this.clearSelection();
    this.ui.panel.classList.remove('visible');
    this.ui.panel.setAttribute('aria-hidden', 'true');
    this.ui.entry.classList.remove('active');
    this.previews.setActive(false);
    this.stopPropCreationPolling();
    if (this.ui.homeDialog.open) this.ui.homeDialog.close();
    if (notify) this.options.onExit();
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  public finishPointerInteraction(): void {
    const drag = this.dragging;
    if (!drag) return;
    this.dragging = null;
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    const record = this.records.get(drag.objectId);
    if (!drag.moved || !record) return;
    if (this.isRecordEditable(record) && !this.objectMutationQueues.has(record.state.id)) {
      this.queuePatch(record, ['position'], drag.rollback);
    } else {
      this.restoreTransformSnapshot(record, drag.rollback);
    }
  }

  public update(elapsed: number): void {
    this.lastElapsed = elapsed;
    for (const record of this.records.values()) {
      try {
        record.update?.(record.propRoot, elapsed);
        const runtimeVehicle = this.runtimeVehicles.get(record.state.id);
        if (runtimeVehicle?.visual && record.updateVehicleVisual) {
          record.updateVehicleVisual(record.propRoot, runtimeVehicle.visual, elapsed);
        }
        const collisionVersion = record.propRoot.userData.collisionVersion;
        if (collisionVersion !== record.collisionVersion) {
          record.collisionVersion = collisionVersion;
          record.root.updateWorldMatrix(true, true);
          this.options.onColliderChanged(record.state.id, record.root, record.collidable);
        }
      } catch (error) {
        console.warn(`[WhiteRoom] 大厅物件 ${record.item.id} update 已禁用`, error);
        record.update = undefined;
        record.updateVehicleVisual = undefined;
      }
    }
    this.selectionHelper?.update();
  }

  public getVehicleHandle(objectId: string): LobbyVehicleHandle | null {
    const record = this.records.get(objectId);
    if (!record?.vehicle) return null;
    const runtime = this.runtimeVehicles.get(objectId);
    const pose: LobbyVehicleRuntimePose = runtime ? { ...runtime } : {
      objectId,
      driverId: null,
      x: record.state.position.x,
      y: record.state.position.y,
      z: record.state.position.z,
      yaw: record.state.rotationY,
      pitch: 0,
      roll: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      seq: 0,
    };
    return {
      objectId,
      catalogId: record.state.catalogId,
      name: record.item.name,
      root: record.root,
      capability: record.vehicle,
      pose,
    };
  }

  public applyVehicleRuntimePose(pose: LobbyVehicleRuntimePose): boolean {
    const record = this.records.get(pose.objectId);
    if (!record?.vehicle) return false;
    const aircraft = record.vehicle.kind === 'aircraft';
    const normalized: LobbyVehicleRuntimePose = {
      ...pose,
      driverId: typeof pose.driverId === 'string' ? pose.driverId : null,
      x: aircraft
        ? finite(pose.x, record.state.position.x)
        : THREE.MathUtils.clamp(finite(pose.x, record.state.position.x), -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
      y: aircraft
        ? Math.max(0, finite(pose.y, record.state.position.y))
        : THREE.MathUtils.clamp(finite(pose.y, record.state.position.y), 0, 32),
      z: aircraft
        ? finite(pose.z, record.state.position.z)
        : THREE.MathUtils.clamp(finite(pose.z, record.state.position.z), -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT),
      yaw: normalizeAngle(finite(pose.yaw, record.state.rotationY)),
      pitch: normalizeAngle(finite(pose.pitch, 0)),
      roll: normalizeAngle(finite(pose.roll, 0)),
      vx: THREE.MathUtils.clamp(finite(pose.vx, 0), -60, 60),
      vy: THREE.MathUtils.clamp(finite(pose.vy, 0), -60, 60),
      vz: THREE.MathUtils.clamp(finite(pose.vz, 0), -60, 60),
      seq: Number.isSafeInteger(pose.seq) && pose.seq >= 0 ? pose.seq : 0,
    };
    this.runtimeVehicles.set(pose.objectId, normalized);
    this.bumpRuntimeVehicleGeneration(pose.objectId);
    this.applyRuntimeVehicleTransform(record, normalized);
    this.updateUi();
    return true;
  }

  public clearVehicleRuntimePose(objectId: string): void {
    const record = this.records.get(objectId);
    this.runtimeVehicles.delete(objectId);
    this.bumpRuntimeVehicleGeneration(objectId);
    if (record) this.applyTransform(record);
    this.updateUi();
  }

  public clearVehicleRuntimePoses(): void {
    const ids = [...this.runtimeVehicles.keys()];
    this.runtimeVehicles.clear();
    for (const id of ids) {
      this.bumpRuntimeVehicleGeneration(id);
      const record = this.records.get(id);
      if (record) this.applyTransform(record);
    }
    this.updateUi();
  }

  /**
   * Returns normalized, review-approved physics props with an immutable world
   * pose snapshot. Callers may build engine bodies from this data but must not
   * infer colliders from arbitrary scene geometry.
   */
  public getPhysicsProps(): LobbyPhysicsPropHandle[] {
    const handles = [...this.records.values()]
      .map((record) => this.physicsPropHandle(record))
      .filter((handle): handle is LobbyPhysicsPropHandle => handle !== null);
    return handles.sort((left, right) => left.objectId.localeCompare(right.objectId));
  }

  /** Returns one reviewed physics prop without scanning unrelated lobby objects. */
  public getPhysicsPropHandle(objectId: string): LobbyPhysicsPropHandle | null {
    const record = this.records.get(objectId);
    return record ? this.physicsPropHandle(record) : null;
  }

  private physicsPropHandle(record: LobbyObjectRecord): LobbyPhysicsPropHandle | null {
    if (!record.physics) return null;
    record.root.updateWorldMatrix(true, true);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    record.root.matrixWorld.decompose(position, rotation, scale);
    return {
      objectId: record.state.id,
      catalogId: record.state.catalogId,
      name: record.item.name,
      root: record.root,
      physics: record.physics,
      worldPose: Object.freeze({
        position: Object.freeze({ x: position.x, y: position.y, z: position.z }),
        rotation: Object.freeze({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
        scale: Object.freeze({ x: scale.x, y: scale.y, z: scale.z }),
      }),
    };
  }

  /** Applies a physics-engine world pose to a reviewed dynamic prop only. */
  public applyPhysicsRuntimePose(objectId: string, pose: LobbyPhysicsRuntimePose): boolean {
    const record = this.records.get(objectId);
    if (!record?.physics || record.physics.body !== 'dynamic') return false;
    const candidate = pose as unknown;
    if (!plainRecord(candidate) || !exactKeys(candidate, ['position', 'rotation'])) return false;
    if (!plainRecord(candidate.position) || !exactKeys(candidate.position, ['x', 'y', 'z'])) return false;
    if (!plainRecord(candidate.rotation) || !exactKeys(candidate.rotation, ['x', 'y', 'z', 'w'])) return false;
    const x = boundedPhysicsNumber(candidate.position.x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const y = boundedPhysicsNumber(candidate.position.y, -4, 32);
    const z = boundedPhysicsNumber(candidate.position.z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const qx = boundedPhysicsNumber(candidate.rotation.x, -1, 1);
    const qy = boundedPhysicsNumber(candidate.rotation.y, -1, 1);
    const qz = boundedPhysicsNumber(candidate.rotation.z, -1, 1);
    const qw = boundedPhysicsNumber(candidate.rotation.w, -1, 1);
    if ([x, y, z, qx, qy, qz, qw].some((value) => value === null)) return false;
    const quaternion = new THREE.Quaternion(qx!, qy!, qz!, qw!);
    const length = quaternion.length();
    if (!Number.isFinite(length) || length < 0.98 || length > 1.02) return false;
    quaternion.normalize();
    const normalized = Object.freeze({
      position: Object.freeze({ x: x!, y: y!, z: z! }),
      rotation: Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    });
    this.runtimePhysicsPoses.set(objectId, normalized);
    this.applyRuntimePhysicsTransform(record, normalized);
    this.updateUi();
    return true;
  }

  public clearPhysicsRuntimePose(objectId: string): void {
    const record = this.records.get(objectId);
    this.runtimePhysicsPoses.delete(objectId);
    if (record) this.applyTransform(record);
    this.updateUi();
  }

  public clearPhysicsRuntimePoses(): void {
    const ids = [...this.runtimePhysicsPoses.keys()];
    this.runtimePhysicsPoses.clear();
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) this.applyTransform(record);
    }
    this.updateUi();
  }

  public getInteraction(camera: THREE.Camera, interactionOrigin: THREE.Vector3 = camera.position): Interactable | null {
    if (this.isEnabled || this.records.size === 0) return null;
    const cameraForward = new THREE.Vector3();
    camera.getWorldDirection(cameraForward);
    let record: LobbyObjectRecord | null = null;
    let interactionKind: 'prop' | 'vehicle' | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of this.records.values()) {
      const runtimeVehicle = this.runtimeVehicles.get(candidate.state.id);
      const vehicleAvailable = Boolean(
        candidate.vehicle
        && candidate.item.vehicle?.kind === candidate.vehicle.kind
        && !runtimeVehicle?.driverId,
      );
      const propAvailable = Boolean(
        candidate.interact
        && candidate.item.interaction
        && !this.pendingInteractions.has(candidate.state.id),
      );
      if (!vehicleAvailable && !propAvailable) continue;
      const bounds = new THREE.Box3().setFromObject(candidate.root);
      const target = bounds.getCenter(new THREE.Vector3());
      if (propAvailable && candidate.propRoot.userData.interactionCenterAtEyeLevel === true) {
        target.y = interactionOrigin.y;
      }
      const toTarget = target.sub(interactionOrigin);
      const distance = toTarget.length();
      const maxDistance = vehicleAvailable ? candidate.item.vehicle?.enterRadius ?? 3.4 : 3.4;
      if (distance <= 0.001 || distance > maxDistance) continue;
      const facing = toTarget.normalize().dot(cameraForward);
      if (facing < (vehicleAvailable ? 0.18 : 0.48)) continue;
      const score = distance - facing * 0.9;
      if (score < bestScore) {
        bestScore = score;
        record = candidate;
        interactionKind = vehicleAvailable ? 'vehicle' : 'prop';
      }
    }
    if (!record || !interactionKind) return null;
    if (interactionKind === 'vehicle') {
      const handle = this.getVehicleHandle(record.state.id);
      if (!handle || !this.options.onVehicleUse) return null;
      return {
        id: `lobby-vehicle:${record.state.id}`,
        object: record.root,
        label: record.item.realmSpace === 'heaven'
          ? `骑乘 ${record.item.name}`
          : `驾驶 ${record.item.name}`,
        maxDistance: record.item.vehicle?.enterRadius ?? 3.4,
        enabled: true,
        onUse: () => this.options.onVehicleUse?.(this.getVehicleHandle(record!.state.id) ?? handle),
      };
    }
    if (!record.interact) return null;
    const reportedPrompt = record.propRoot.userData.prompt;
    const customPrompt = typeof reportedPrompt === 'string' && reportedPrompt.trim()
      ? reportedPrompt.trim().slice(0, 48)
      : null;
    let portalDestination = record.portal
      ? lobbyPortalDestinationForSequence(record.portal, record.state.interaction.sequence + 1)
      : null;
    if (record.portal) {
      this.raycaster.set(interactionOrigin, cameraForward);
      const hit = this.raycaster.intersectObject(record.root, true)[0];
      if (hit) {
        const localHit = record.root.worldToLocal(hit.point.clone());
        const aimedIndex = localHit.x <= 0 ? 0 : 1;
        portalDestination = record.portal.destinations[aimedIndex] ?? portalDestination;
      }
    }
    return {
      id: `lobby:${record.state.id}`,
      object: record.root,
      label: portalDestination
        ? `穿越 ${record.item.name} · 当前瞄准：${portalDestination.label}`
        : customPrompt ?? `互动 ${record.item.name}`,
      maxDistance: 3.4,
      enabled: true,
      onUse: () => this.requestInteraction(record, portalDestination),
    };
  }

  public getTextState(): LobbyEditorTextState {
    const round = (value: number): number => Number(value.toFixed(2));
    const objects = new Map<string, LobbyObjectState>(this.systemObjects);
    for (const record of this.records.values()) objects.set(record.state.id, record.state);
    const myPlots = this.myPlotClaims();
    const myPlotIds = myPlots.map((claim) => claim.id);
    const selectedMyPlotId = selectedLobbyHomePlotId(this.plots.values(), this.ownerId, this.selectedHomePlotId);
    const ownerColors = assignLobbyOwnerPastelColors(
      [...this.plots.values()].map((claim) => claim.ownerId),
    );
    const activeCreation = this.propCreationJobs.find(lobbyPropCreationIsActive) ?? null;
    return {
      enabled: this.isEnabled,
      channel: this.channel ?? '',
      environment: { ...this.environment },
      objects: [...objects.values()].map((object) => {
        const item = this.catalogItemForObject(object.catalogId);
        const record = this.records.get(object.id);
        const portalDestination = record?.portal
          ? lobbyPortalDestinationForSequence(record.portal, object.interaction.sequence)
          : null;
        const palette = record?.propRoot.userData.palette;
        const reportedState = record?.propRoot.userData.interactionState;
        let renderMeshCount: number | null = null;
        let shadowCasterCount: number | null = null;
        if (record && item?.realmSpace) {
          let meshes = 0;
          let shadowCasters = 0;
          record.propRoot.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            meshes += 1;
            if (child.castShadow) shadowCasters += 1;
          });
          renderMeshCount = meshes;
          shadowCasterCount = shadowCasters;
        }
        const interactionState = typeof reportedState === 'string' && reportedState.trim()
          ? reportedState.trim().slice(0, 40)
          : record?.propRoot.userData.active === true
            ? 'active'
            : typeof palette === 'number'
              ? `palette:${palette}`
              : 'idle';
        return {
          id: object.id,
          catalogId: object.catalogId,
          name: object.system ? '固定音乐贩卖机' : item?.name ?? object.catalogId,
          x: round(object.position.x),
          y: round(object.position.y),
          z: round(object.position.z),
          rotationY: round(object.rotationY),
          scale: round(object.scale),
          locked: object.locked,
          system: object.system,
          plotId: object.plotId,
          scope: lobbyObjectScope(object),
          ownership: lobbyObjectOwnership(object, this.ownerId),
          canEdit: record ? this.isRecordEditable(record) : false,
          canDelete: record ? this.isRecordDeletable(record) : false,
          interactionSequence: object.interaction.sequence,
          interactionStartedAt: object.interaction.startedAt,
          interactive: Boolean(record?.interact),
          interactionState: object.system ? 'locked' : interactionState,
          physicsKind: record?.physics?.body ?? null,
          portal: Boolean(record?.portal),
          portalDestination: portalDestination?.label ?? null,
          drivable: Boolean(record?.vehicle && item?.vehicle?.kind === record.vehicle.kind),
          vehicleKind: record?.vehicle?.kind ?? null,
          occupiedBy: this.runtimeVehicles.get(object.id)?.driverId ?? null,
          renderMeshCount,
          shadowCasterCount,
        };
      }).sort((a, b) => Number(b.system) - Number(a.system) || a.id.localeCompare(b.id)),
      selected: this.selectedId,
      online: this.online,
      sync: this.sync,
      identityReady: Boolean(this.ownerId),
      assets: {
        status: this.assetUploadStatus,
        personalAssetCount: this.personalCatalog.size,
        selectedFileName: this.selectedAssetFileName,
        errorCode: this.assetUploadErrorCode,
      },
      creations: {
        enabled: this.propCreationEnabled,
        accountRequired: !this.options.isAccountSignedIn(),
        workerOnline: this.propCreationWorker.online,
        workerLastSeenAt: this.propCreationWorker.lastSeenAt,
        status: this.propCreationStatus,
        message: this.propCreationMessage,
        jobCount: this.propCreationJobs.length,
        activeJobId: activeCreation?.id ?? null,
        activeJobStatus: activeCreation?.status ?? null,
        activeJobStage: activeCreation?.stage.code ?? null,
        promptCharacters: [...this.ui.propPrompt.value].length,
      },
      home: {
        enabled: this.environment.kind === 'lobby',
        dialogOpen: this.ui.homeDialog.open,
        publicHalfExtent: PUBLIC_LOBBY_HALF_EXTENT,
        plotSize: LOBBY_PLOT_SIZE,
        totalPlots: LOBBY_PLOTS.length,
        claimedPlots: this.plots.size,
        availablePlots: LOBBY_PLOTS.length - this.plots.size,
        myPlotId: myPlotIds[0] ?? null,
        myPlotIds,
        myPlotCount: myPlotIds.length,
        selectedMyPlotId,
        claims: [...this.plots.values()].map((claim) => ({
          id: claim.id,
          ownerNickname: claim.ownerNickname,
          mine: claim.ownerId === this.ownerId,
          ownerColor: ownerColors.get(claim.ownerId) ?? '#d8e0da',
        })).sort((a, b) => a.id.localeCompare(b.id)),
      },
    };
  }

  private loadConnectionId(): string {
    try {
      const current = sessionStorage.getItem(LOBBY_CONNECTION_ID_KEY);
      if (current && CLIENT_ID_PATTERN.test(current)) return current;
      const next = `lobby-${crypto.randomUUID()}`;
      sessionStorage.setItem(LOBBY_CONNECTION_ID_KEY, next);
      return next;
    } catch {
      return `lobby-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`.slice(0, 64);
    }
  }

  private async loadOwnerIdentity(signal: AbortSignal): Promise<{ ownerId: string; serverTimeOffsetMs: number }> {
    const request = async (): Promise<{ ownerId: string; serverTimeOffsetMs: number }> => {
      const requestedAt = Date.now();
      const response = await fetch('/api/lobby/identity', {
        headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal,
      });
      if (!response.ok) throw new Error(`identity HTTP ${response.status}`);
      const identity = await response.json() as Record<string, unknown>;
      if (!CLIENT_ID_PATTERN.test(typeof identity.ownerId === 'string' ? identity.ownerId : '')) {
        throw new Error('identity response is invalid');
      }
      const serverTime = typeof identity.serverTime === 'string' ? Date.parse(identity.serverTime) : Number.NaN;
      const receivedAt = Date.now();
      return {
        ownerId: identity.ownerId as string,
        serverTimeOffsetMs: Number.isFinite(serverTime) ? serverTime - (requestedAt + receivedAt) / 2 : 0,
      };
    };
    if (navigator.locks?.request) {
      return navigator.locks.request('whiteroom-lobby-owner', { mode: 'exclusive', signal }, request);
    }
    return request();
  }

  private readServerTime(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const serverTimeValue = (value as Record<string, unknown>).serverTime;
    if (typeof serverTimeValue !== 'string') return;
    const serverTime = Date.parse(serverTimeValue);
    if (Number.isFinite(serverTime)) this.serverTimeOffsetMs = serverTime - Date.now();
  }

  private bindUi(): void {
    const signal = this.lifecycle.signal;
    const bindWorldAction = (button: HTMLButtonElement, action: () => void): void => {
      button.addEventListener('click', () => {
        action();
        button.blur();
      }, { signal });
    };
    this.ui.exit.addEventListener('click', () => this.disable(), { signal });
    this.ui.propPrompt.addEventListener('input', () => {
      if (this.propCreationStatus === 'error') {
        this.setPropCreationState('idle', '输入描述后即可提交创作任务');
      } else {
        this.updatePropCreationUi();
      }
    }, { signal });
    this.ui.propCreatorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitPropCreationRequest();
    }, { signal });
    this.ui.propLogin.addEventListener('click', () => {
      this.options.onAccountRequired();
      this.ui.propLogin.blur();
    }, { signal });
    this.ui.propRefresh.addEventListener('click', () => {
      this.ui.propRefresh.blur();
      void this.refreshPropCreations(true);
    }, { signal });
    this.ui.propCreator.addEventListener('toggle', () => {
      if (!this.ui.propCreator.open) return;
      this.ui.assetUpload.open = false;
      void this.refreshPropCreations(true);
    }, { signal });
    this.ui.assetUpload.addEventListener('toggle', () => {
      if (this.ui.assetUpload.open) this.ui.propCreator.open = false;
    }, { signal });
    this.ui.propJobList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel-prop-job]');
      if (!button?.dataset.cancelPropJob || button.disabled) return;
      button.blur();
      void this.cancelPropCreationRequest(button.dataset.cancelPropJob);
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (!this.isEnabled) return;
      if (document.visibilityState === 'visible') void this.refreshPropCreations(false);
      else this.schedulePropCreationPoll();
    }, { signal });
    this.ui.assetFile.addEventListener('change', () => {
      void this.selectAssetFile(this.ui.assetFile.files?.[0] ?? null);
    }, { signal });
    this.ui.assetDropzone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (this.assetUploadStatus !== 'uploading') this.ui.assetDropzone.classList.add('is-dragging');
    }, { signal });
    this.ui.assetDropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = this.assetUploadStatus === 'uploading' ? 'none' : 'copy';
    }, { signal });
    this.ui.assetDropzone.addEventListener('dragleave', (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !this.ui.assetDropzone.contains(next)) {
        this.ui.assetDropzone.classList.remove('is-dragging');
      }
    }, { signal });
    this.ui.assetDropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.ui.assetDropzone.classList.remove('is-dragging');
      if (this.assetUploadStatus === 'uploading') return;
      void this.selectAssetFile(event.dataTransfer?.files?.[0] ?? null);
    }, { signal });
    this.ui.assetForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.uploadSelectedAsset();
    }, { signal });
    for (const input of [this.ui.assetName, this.ui.assetCategory]) {
      input.addEventListener('input', () => {
        if (!this.assetPreflightReady || this.assetUploadStatus === 'uploading') return;
        if (this.assetUploadErrorCode === 'invalid_asset_name' || this.assetUploadErrorCode === 'invalid_asset_category') {
          this.setAssetUploadState('ready', '模型检查通过，可以上传', null);
        }
      }, { signal });
    }
    this.ui.homeChoose.addEventListener('click', () => this.openHomeDialog(), { signal });
    this.ui.homeClose.addEventListener('click', () => this.ui.homeDialog.close(), { signal });
    this.ui.homeRelease.addEventListener('click', () => void this.releaseSelectedHomePlot(), { signal });
    this.ui.homeDialog.addEventListener('close', () => this.updateUi(), { signal });
    this.ui.homeGrid.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-plot-id]');
      if (!button?.dataset.plotId || button.disabled) return;
      const claim = this.plots.get(button.dataset.plotId);
      if (claim?.ownerId === this.ownerId) {
        this.selectedHomePlotId = claim.id;
        this.renderHomeGrid();
        this.updateUi();
        return;
      }
      void this.claimPlot(button.dataset.plotId);
    }, { signal });
    bindWorldAction(this.ui.rotateLeft, () => this.transformSelected('rotate', -Math.PI / 12));
    bindWorldAction(this.ui.rotateRight, () => this.transformSelected('rotate', Math.PI / 12));
    bindWorldAction(this.ui.scaleDown, () => this.transformSelected('scale', -0.1));
    bindWorldAction(this.ui.scaleUp, () => this.transformSelected('scale', 0.1));
    bindWorldAction(this.ui.delete, () => this.deleteSelected());
    window.addEventListener('keydown', (event) => {
      if (!this.isEnabled || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      const record = this.selectedId ? this.records.get(this.selectedId) : null;
      if (!record) return;
      event.preventDefault();
      if (!this.isRecordDeletable(record)) {
        this.options.onToast(this.protectedObjectMessage(record), 1900);
        return;
      }
      this.deleteSelected();
    }, { capture: true, signal });

    this.ui.catalog.addEventListener('dragstart', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-catalog-id]');
      if (!card || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-whiteroom-catalog', card.dataset.catalogId ?? '');
      event.dataTransfer.setData('text/plain', card.dataset.catalogId ?? '');
    }, { signal });
    this.ui.catalog.addEventListener('click', (event) => {
      const addButton = (event.target as HTMLElement).closest<HTMLElement>('[data-add-catalog-id]');
      if (!addButton?.dataset.addCatalogId) return;
      this.createInFront(addButton.dataset.addCatalogId);
      addButton.blur();
    }, { signal });

    this.canvas.addEventListener('dragover', (event) => {
      if (!this.isEnabled) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }, { signal });
    this.canvas.addEventListener('drop', (event) => {
      if (!this.isEnabled) return;
      event.preventDefault();
      const catalogId = event.dataTransfer?.getData('application/x-whiteroom-catalog') || event.dataTransfer?.getData('text/plain');
      const point = this.groundPoint(event.clientX, event.clientY);
      if (catalogId && point) this.createObject(catalogId, point.x, point.z, point.y);
    }, { signal });
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event), { signal });
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event), { signal });
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event), { signal });
    this.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event), { signal });
    this.canvas.addEventListener('lostpointercapture', (event) => {
      if (this.dragging?.pointerId === event.pointerId) this.finishPointerInteraction();
    }, { signal });
    this.canvas.addEventListener('click', (event) => {
      if (!this.isEnabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { signal });
  }

  private setPropCreationState(
    status: 'idle' | 'loading' | 'submitting' | 'success' | 'error',
    message: string,
  ): void {
    this.propCreationStatus = status;
    this.propCreationMessage = message;
    this.updatePropCreationUi();
  }

  private clearPropCreationPollTimer(): void {
    if (this.propCreationPollTimer === null) return;
    window.clearTimeout(this.propCreationPollTimer);
    this.propCreationPollTimer = null;
  }

  private stopPropCreationPolling(): void {
    this.clearPropCreationPollTimer();
    this.propCreationRefreshController?.abort();
    this.propCreationRefreshController = null;
  }

  private schedulePropCreationPoll(): void {
    this.clearPropCreationPollTimer();
    if (!this.isEnabled) return;
    const active = this.propCreationJobs.some(lobbyPropCreationIsActive);
    const delay = document.visibilityState === 'hidden'
      ? 30_000
      : active
        ? 4_000
        : this.ui.propCreator.open
          ? 12_000
          : 25_000;
    this.propCreationPollTimer = window.setTimeout(() => {
      this.propCreationPollTimer = null;
      void this.refreshPropCreations(false);
    }, delay);
  }

  private propCreationSummaryMessage(): string {
    const active = this.propCreationJobs.find(lobbyPropCreationIsActive);
    if (active) return active.stage.message;
    const pending = this.propCreationJobs.find((job) => job.status === 'pending_review');
    if (pending) return `${pending.proposal?.name ?? '物件候选'}是启用自动发布前保留的历史候选`;
    const latest = this.propCreationJobs[0];
    if (!latest) return '输入描述后即可提交创作任务';
    if (latest.status === 'approved') {
      return latest.publication
        ? `${latest.proposal?.name ?? '物件'}已自动发布，刷新页面后可在装修目录中使用`
        : `${latest.proposal?.name ?? '物件候选'}是启用自动发布前保留的历史记录`;
    }
    if (latest.status === 'rejected') return latest.reason ?? '这是启用自动发布前保留的驳回记录';
    if (latest.status === 'failed') {
      return latest.stage.code === 'publish_failed'
        ? latest.failure?.message ?? '自动发布失败，线上仍保持上一版本'
        : latest.failure?.message ?? '上次创作没有完成，可以重新提交';
    }
    return latest.stage.message;
  }

  private async refreshPropCreations(announce: boolean): Promise<void> {
    if (!this.isEnabled) return;
    this.clearPropCreationPollTimer();
    this.propCreationRefreshController?.abort();
    const controller = new AbortController();
    this.propCreationRefreshController = controller;
    if (announce) this.setPropCreationState('loading', '正在读取创作任务…');
    try {
      const config = await fetchLobbyPropCreationConfig(controller.signal);
      if (controller.signal.aborted) return;
      this.propCreationEnabled = config.enabled;
      this.propCreationWorker = config.worker;
      if (!this.options.isAccountSignedIn()) {
        this.propCreationJobs = [];
        this.renderPropCreationJobs();
        this.setPropCreationState('idle', '登录邮箱账号后即可把需求发送到这台 Mac 的 Codex');
        return;
      }
      if (!config.enabled) {
        this.propCreationJobs = [];
        this.renderPropCreationJobs();
        this.setPropCreationState('error', '创作桥接尚未配置，暂时不能提交任务');
        return;
      }
      const result = await fetchLobbyPropCreations(controller.signal);
      if (controller.signal.aborted) return;
      this.propCreationJobs = result.jobs;
      this.propCreationWorker = result.worker;
      this.renderPropCreationJobs();
      this.setPropCreationState(announce ? 'success' : 'idle', this.propCreationSummaryMessage());
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setPropCreationState('error', lobbyPropCreationErrorMessage(error));
    } finally {
      if (this.propCreationRefreshController === controller) {
        this.propCreationRefreshController = null;
        this.schedulePropCreationPoll();
      }
    }
  }

  private async submitPropCreationRequest(): Promise<void> {
    if (this.propCreationBusy) return;
    if (!this.options.isAccountSignedIn()) {
      this.setPropCreationState('error', '请先登录邮箱账号，再提交创作需求');
      this.options.onAccountRequired();
      return;
    }
    const prompt = normalizeLobbyPropPrompt(this.ui.propPrompt.value);
    if (!lobbyPropPromptIsValid(prompt)) {
      this.setPropCreationState('error', `请用 4–${MAX_LOBBY_PROP_PROMPT_CHARACTERS} 个字符描述想创作的物件`);
      this.ui.propPrompt.focus();
      return;
    }
    if (!this.channel) {
      this.setPropCreationState('error', '请先进入一个大厅频道');
      return;
    }
    if (this.propCreationEnabled !== true) {
      this.setPropCreationState('error', '创作桥接尚未就绪，请刷新后再试');
      void this.refreshPropCreations(false);
      return;
    }
    this.propCreationMutationController?.abort();
    const controller = new AbortController();
    this.propCreationMutationController = controller;
    this.propCreationBusy = true;
    this.setPropCreationState('submitting', '正在把需求安全地加入创作队列…');
    try {
      const result = await submitLobbyPropCreation(prompt, this.channel, controller.signal);
      if (controller.signal.aborted) return;
      this.propCreationWorker = result.worker;
      this.propCreationJobs = [
        result.job,
        ...this.propCreationJobs.filter((job) => job.id !== result.job.id),
      ];
      this.ui.propPrompt.value = '';
      this.renderPropCreationJobs();
      this.setPropCreationState(
        'success',
        result.worker.online
          ? '已发送；这台 Mac 的 Codex 会自动创建一项独立任务'
          : '已排队；这台 Mac 上线后会自动开始创作',
      );
      this.options.onToast(result.worker.online ? '已发送到这台 Mac 的 Codex' : '已加入队列，等待这台 Mac 上线', 2200);
      this.ui.propPrompt.blur();
      this.ui.propSubmit.blur();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setPropCreationState('error', lobbyPropCreationErrorMessage(error));
    } finally {
      if (this.propCreationMutationController === controller) this.propCreationMutationController = null;
      this.propCreationBusy = false;
      this.updatePropCreationUi();
      this.schedulePropCreationPoll();
    }
  }

  private async cancelPropCreationRequest(jobId: string): Promise<void> {
    if (this.propCreationBusy) return;
    this.propCreationMutationController?.abort();
    const controller = new AbortController();
    this.propCreationMutationController = controller;
    this.propCreationBusy = true;
    this.setPropCreationState('loading', '正在取消排队任务…');
    try {
      const updated = await cancelLobbyPropCreation(jobId, controller.signal);
      if (controller.signal.aborted) return;
      this.propCreationJobs = this.propCreationJobs.map((job) => job.id === updated.id ? updated : job);
      this.renderPropCreationJobs();
      this.setPropCreationState('success', '任务已取消');
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setPropCreationState('error', lobbyPropCreationErrorMessage(error));
    } finally {
      if (this.propCreationMutationController === controller) this.propCreationMutationController = null;
      this.propCreationBusy = false;
      this.updatePropCreationUi();
      this.schedulePropCreationPoll();
    }
  }

  private renderPropCreationJobs(): void {
    const fragment = document.createDocumentFragment();
    if (this.propCreationJobs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lobby-prop-jobs-empty';
      empty.textContent = this.options.isAccountSignedIn()
        ? '还没有创作任务，描述一个想放进大厅的互动道具吧'
        : '登录后可查看当前账号的创作进度';
      fragment.append(empty);
      this.ui.propJobList.replaceChildren(fragment);
      return;
    }
    for (const job of this.propCreationJobs) {
      const article = document.createElement('article');
      article.className = 'lobby-prop-job';
      article.dataset.state = job.status;

      const header = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = job.proposal?.name ?? '大厅物件创作';
      const status = document.createElement('span');
      status.textContent = lobbyPropCreationStatusLabel(job);
      status.dataset.state = job.status;
      header.append(title, status);

      const prompt = document.createElement('p');
      prompt.textContent = job.prompt;
      const stage = document.createElement('small');
      stage.textContent = job.stage.message;
      article.append(header, prompt, stage);

      if (job.proposal?.summary) {
        const summary = document.createElement('p');
        summary.className = 'lobby-prop-job-result';
        summary.textContent = job.proposal.summary;
        article.append(summary);
      }
      const notice = job.reason ?? job.failure?.message;
      if (notice) {
        const note = document.createElement('p');
        note.className = 'lobby-prop-job-notice';
        note.textContent = notice;
        article.append(note);
      }

      const footer = document.createElement('footer');
      const submitted = document.createElement('time');
      submitted.dateTime = job.submittedAt;
      const date = new Date(job.submittedAt);
      submitted.textContent = Number.isFinite(date.getTime())
        ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '刚刚';
      footer.append(submitted);
      if (job.status === 'queued') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.dataset.cancelPropJob = job.id;
        cancel.textContent = '取消排队';
        cancel.disabled = this.propCreationBusy;
        footer.append(cancel);
      }
      article.append(footer);
      fragment.append(article);
    }
    this.ui.propJobList.replaceChildren(fragment);
  }

  private updatePropCreationUi(): void {
    const signedIn = this.options.isAccountSignedIn();
    const promptCharacters = [...this.ui.propPrompt.value].length;
    const promptValid = lobbyPropPromptIsValid(this.ui.propPrompt.value);
    const loading = this.propCreationStatus === 'loading';
    const disabled = this.propCreationEnabled === false;
    this.ui.propPromptCount.textContent = String(promptCharacters);
    this.ui.propPromptCount.dataset.state = promptCharacters > MAX_LOBBY_PROP_PROMPT_CHARACTERS ? 'error' : 'idle';
    this.ui.propCreatorForm.setAttribute('aria-busy', String(this.propCreationBusy || loading));
    this.ui.propStatus.dataset.state = this.propCreationStatus;
    this.ui.propStatus.textContent = this.propCreationMessage;
    this.ui.propLogin.hidden = signedIn;
    this.ui.propPrompt.disabled = this.propCreationBusy || disabled;
    this.ui.propRefresh.disabled = this.propCreationBusy || loading || !signedIn;
    this.ui.propSubmit.disabled = this.propCreationBusy
      || this.propCreationEnabled !== true
      || !signedIn
      || !this.channel
      || !promptValid;
    this.ui.propSubmit.textContent = this.propCreationBusy
      ? '正在发送…'
      : signedIn
        ? '发送到这台 Mac 的 Codex'
        : '登录后发送';

    if (this.propCreationEnabled === null) {
      this.ui.propWorker.dataset.state = 'loading';
      this.ui.propWorker.lastChild!.textContent = ' 正在检查这台 Mac';
    } else if (!this.propCreationEnabled) {
      this.ui.propWorker.dataset.state = 'disabled';
      this.ui.propWorker.lastChild!.textContent = ' 创作桥接尚未配置';
    } else if (this.propCreationWorker.online) {
      this.ui.propWorker.dataset.state = 'online';
      this.ui.propWorker.lastChild!.textContent = ' 这台 Mac 已连接';
    } else {
      this.ui.propWorker.dataset.state = 'offline';
      this.ui.propWorker.lastChild!.textContent = this.propCreationWorker.lastSeenAt
        ? ' 这台 Mac 暂时离线 · 任务仍会排队'
        : ' 等待这台 Mac 首次连接 · 任务仍会排队';
    }
  }

  private setAssetUploadState(
    status: LobbyAssetUploadStatus,
    message: string,
    errorCode: string | null,
  ): void {
    this.assetUploadStatus = status;
    this.assetUploadMessage = message;
    this.assetUploadErrorCode = errorCode;
    this.updateAssetUploadUi();
  }

  private updateAssetUploadUi(): void {
    const uploading = this.assetUploadStatus === 'uploading';
    this.ui.assetStatus.dataset.state = this.assetUploadStatus;
    this.ui.assetStatus.textContent = this.assetUploadMessage;
    this.ui.assetFileMeta.textContent = this.selectedAssetFileName
      ? `${this.selectedAssetFileName}${this.selectedAssetFile ? ` · ${formatLobbyAssetBytes(this.selectedAssetFile.size)}` : ''}`
      : '单个自包含模型 · 最大 15 MB';
    this.ui.assetDropzone.setAttribute('aria-busy', String(uploading));
    this.ui.assetFile.disabled = uploading;
    this.ui.assetName.disabled = uploading;
    this.ui.assetCategory.disabled = uploading;
    this.ui.assetSubmit.disabled = uploading
      || !this.ownerId
      || !this.assetPreflightReady
      || !this.selectedAssetFile;
    this.ui.assetSubmit.textContent = uploading ? '正在上传…' : '上传到我的物件';
  }

  private async selectAssetFile(file: File | null): Promise<void> {
    const selection = ++this.assetSelectionSequence;
    this.ui.assetFile.value = '';
    this.selectedAssetFile = null;
    this.selectedAssetFileName = file?.name ?? null;
    this.assetPreflightReady = false;
    if (!file) {
      this.setAssetUploadState('idle', '请选择一个 .glb 模型文件', 'invalid_upload');
      return;
    }
    this.setAssetUploadState('checking', '正在快速检查模型文件…', null);
    try {
      const result = await preflightLobbyGlbFile(file);
      if (selection !== this.assetSelectionSequence) return;
      this.selectedAssetFile = file;
      this.assetPreflightReady = true;
      if (!normalizeLobbyAssetLabel(this.ui.assetName.value, 40)) {
        this.ui.assetName.value = lobbyAssetNameFromFilename(file.name);
      }
      this.setAssetUploadState(
        'ready',
        `检查通过 · ${formatLobbyAssetBytes(result.bytes)} · 可以上传`,
        null,
      );
    } catch (error) {
      if (selection !== this.assetSelectionSequence) return;
      const code = error instanceof LobbyAssetPreflightError ? error.code : 'invalid_lobby_asset_glb';
      const message = error instanceof LobbyAssetPreflightError ? error.message : lobbyAssetErrorMessage(code);
      this.setAssetUploadState('error', message, code);
    }
  }

  private async uploadSelectedAsset(): Promise<void> {
    if (this.assetUploadStatus === 'uploading') return;
    const file = this.selectedAssetFile;
    if (!file || !this.assetPreflightReady) {
      this.setAssetUploadState('error', '请先选择一个检查通过的 .glb 文件', 'invalid_upload');
      return;
    }
    if (!this.ownerId) {
      this.setAssetUploadState('error', '正在确认大厅身份，请稍候再上传', 'lobby_identity_pending');
      return;
    }
    const name = normalizeLobbyAssetLabel(this.ui.assetName.value, 40);
    if (!name) {
      this.setAssetUploadState('error', '请填写 1–40 个字符的物件名称', 'invalid_asset_name');
      this.ui.assetName.focus();
      return;
    }
    const category = normalizeLobbyAssetLabel(this.ui.assetCategory.value, 20);
    if (!category) {
      this.setAssetUploadState('error', '请填写 1–20 个字符的分类', 'invalid_asset_category');
      this.ui.assetCategory.focus();
      return;
    }

    const controller = new AbortController();
    this.uploadController = controller;
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('name', name);
    form.append('category', category);
    this.setAssetUploadState('uploading', '正在安全上传并检查模型，请不要重复提交…', null);
    try {
      const response = await fetch('/api/lobby/assets', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const code = apiErrorCode(payload);
        throw new LobbyAssetRequestError(code, lobbyAssetErrorMessage(code));
      }
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
      const assets = parseLobbyCatalog({ assets: [record?.asset] });
      const asset = assets[0];
      if (!asset || asset.kind !== 'glb') {
        throw new LobbyAssetRequestError('invalid_asset_response', '平台返回的模型信息不完整');
      }
      const previousAssets = [...this.personalCatalog.values()].filter((item) => item.id !== asset.id);
      this.personalCatalog.clear();
      this.personalCatalog.set(asset.id, asset);
      for (const item of previousAssets.slice(0, LOBBY_MAX_PERSONAL_ASSETS - 1)) {
        this.personalCatalog.set(item.id, item);
      }
      this.remoteCatalog.delete(asset.id);
      this.revealCatalogId = asset.id;
      this.rebuildPlaceableCatalog();
      this.selectedAssetFile = null;
      this.selectedAssetFileName = null;
      this.assetPreflightReady = false;
      this.assetSelectionSequence += 1;
      this.ui.assetName.value = '';
      this.ui.assetCategory.value = '摆件';
      const deduplicated = record?.deduplicated === true;
      this.setAssetUploadState(
        'success',
        deduplicated ? '这个模型已在你的物件中 · 已定位到预览' : '上传成功 · 已出现在“我的上传”目录',
        null,
      );
      this.options.onToast(deduplicated ? '模型已在你的物件中' : '模型上传成功，可以直接添加', 2300);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const code = error instanceof LobbyAssetRequestError ? error.code : 'lobby_asset_upload_failed';
      this.setAssetUploadState('error', lobbyAssetErrorMessage(code), code);
    } finally {
      if (this.uploadController === controller) this.uploadController = null;
      this.updateAssetUploadUi();
    }
  }

  private rebuildPlaceableCatalog(): void {
    const merged = mergeLobbyCatalog(this.systemCatalog.values(), this.personalCatalog.values());
    this.catalog = new Map(merged.map((item) => [item.id, item]));
    for (const id of this.catalog.keys()) this.remoteCatalog.delete(id);
    this.renderCatalog();
    const existing = [...this.records.values()].map((record) => record.state);
    for (const object of existing) this.upsertObject(object);
  }

  private openHomeDialog(): void {
    if (!this.root || this.environment.kind !== 'lobby') return;
    this.selectedHomePlotId = selectedLobbyHomePlotId(
      this.plots.values(), this.ownerId, this.selectedHomePlotId,
    );
    this.renderHomeGrid();
    if (!this.ui.homeDialog.open) this.ui.homeDialog.showModal();
    this.updateUi();
  }

  private renderHomeGrid(): void {
    const fragment = document.createDocumentFragment();
    const ownerColors = assignLobbyOwnerPastelColors(
      [...this.plots.values()].map((claim) => claim.ownerId),
    );
    for (let gridZ = -4; gridZ <= 4; gridZ += 1) {
      for (let gridX = -4; gridX <= 4; gridX += 1) {
        if (Math.abs(gridX) <= 1 && Math.abs(gridZ) <= 1) {
          const publicCell = document.createElement('span');
          publicCell.className = 'lobby-home-public-cell';
          publicCell.setAttribute('role', 'gridcell');
          publicCell.setAttribute('aria-label', gridX === 0 && gridZ === 0 ? '中央公共广场' : '公共广场');
          publicCell.textContent = gridX === 0 && gridZ === 0 ? '公共' : '';
          fragment.append(publicCell);
          continue;
        }
        const plot = LOBBY_PLOTS.find((candidate) => candidate.gridX === gridX && candidate.gridZ === gridZ);
        if (!plot) {
          const gap = document.createElement('span');
          gap.className = 'lobby-home-cell gap';
          gap.setAttribute('aria-hidden', 'true');
          fragment.append(gap);
          continue;
        }
        const claim = this.plots.get(plot.id);
        const mine = Boolean(claim && claim.ownerId === this.ownerId);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lobby-home-cell';
        button.dataset.state = mine ? 'mine' : claim ? 'claimed' : 'available';
        button.dataset.plotId = plot.id;
        button.dataset.selected = String(mine && this.selectedHomePlotId === plot.id);
        button.setAttribute('role', 'gridcell');
        button.disabled = Boolean(claim && !mine) || !this.ownerId || this.plotMutationPending;
        if (claim) {
          const ownerColor = ownerColors.get(claim.ownerId);
          if (ownerColor) button.style.setProperty('--lobby-owner-color', ownerColor);
        }
        if (mine) button.setAttribute('aria-pressed', String(this.selectedHomePlotId === plot.id));
        button.textContent = mine ? '我的' : claim ? claim.ownerNickname.slice(0, 4) : String(plot.index);
        button.title = mine
          ? `${plot.id} · 我的家园${this.selectedHomePlotId === plot.id ? ' · 已选择' : ' · 点击管理'}`
          : claim
            ? `${plot.id} · ${claim.ownerNickname}的家园`
            : `${plot.id} · 可认领`;
        button.setAttribute('aria-label', button.title);
        fragment.append(button);
      }
    }
    this.ui.homeGrid.replaceChildren(fragment);
  }

  private myPlotClaim(): LobbyPlotClaim | null {
    return this.myPlotClaims()[0] ?? null;
  }

  private myPlotClaims(): LobbyPlotClaim[] {
    return lobbyHomeClaimsForOwner(this.plots.values(), this.ownerId);
  }

  private selectedMyPlotClaim(): LobbyPlotClaim | null {
    const selectedId = selectedLobbyHomePlotId(this.plots.values(), this.ownerId, this.selectedHomePlotId);
    this.selectedHomePlotId = selectedId;
    return selectedId ? this.plots.get(selectedId) ?? null : null;
  }

  private refreshNeighborhoodScene(): void {
    this.neighborhood?.updateClaims([...this.plots.values()].map((claim) => ({
      plotId: claim.id,
      ownerId: claim.ownerId,
      nickname: claim.ownerNickname,
      isMine: claim.ownerId === this.ownerId,
    })));
  }

  private acceptsPlotRevision(plotId: string, revision: number | undefined): boolean {
    return acceptsLobbyPlotRevision(revision, this.plotRevisions.get(plotId));
  }

  private markPlotRevision(plotId: string, revision: number | undefined): void {
    if (revision === undefined) return;
    this.plotRevisions.set(plotId, Math.max(this.plotRevisions.get(plotId) ?? 0, revision));
    this.snapshotRevision = Math.max(this.snapshotRevision, revision);
  }

  private applyPlotClaim(claim: LobbyPlotClaim, revision?: number): boolean {
    if (!this.acceptsPlotRevision(claim.id, revision)) return false;
    this.markPlotRevision(claim.id, revision);
    this.plots.set(claim.id, claim);
    this.refreshNeighborhoodScene();
    if (this.dragging) {
      const record = this.records.get(this.dragging.objectId);
      if (!record || !this.isRecordEditable(record)) this.finishPointerInteraction();
    }
    this.renderHomeGrid();
    this.updateUi();
    return true;
  }

  private removePlotClaim(plotId: string, revision?: number): boolean {
    if (!this.acceptsPlotRevision(plotId, revision)) return false;
    this.markPlotRevision(plotId, revision);
    this.plots.delete(plotId);
    if (this.selectedHomePlotId === plotId) {
      this.selectedHomePlotId = selectedLobbyHomePlotId(this.plots.values(), this.ownerId, null);
    }
    this.refreshNeighborhoodScene();
    if (this.dragging) {
      const record = this.records.get(this.dragging.objectId);
      if (!record || !this.isRecordEditable(record)) this.finishPointerInteraction();
    }
    this.renderHomeGrid();
    this.updateUi();
    return true;
  }

  private async claimPlot(plotId: string): Promise<void> {
    const plot = lobbyPlotById(plotId);
    if (!plot || !this.ownerId || this.plotMutationPending) return;
    if (this.plots.has(plot.id)) {
      this.options.onToast('这块领地刚刚被其他玩家认领了', 1900);
      return;
    }
    this.plotMutationPending = true;
    this.updateUi();
    this.renderHomeGrid();
    try {
      const response = await this.mutate(`/api/lobby/plots/${encodeURIComponent(plot.id)}/claim`, 'POST', {
        nickname: this.nickname,
      });
      const claim = extractPayloadPlot(response);
      if (!claim) throw new Error('认领响应缺少 plot');
      this.selectedHomePlotId = claim.id;
      this.applyPlotClaim(claim, payloadRevision(response));
      this.options.onToast(`已认领 ${plot.id} · 可以继续选择相邻地块扩建`, 2400);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof LobbyMutationError && error.status === 409
          ? '认领失败：这块领地刚刚被其他玩家占用'
          : error instanceof LobbyMutationError && error.code === 'invalid_owner_nickname'
            ? '昵称需包含文字或数字，只能使用空格、点、下划线或连字符'
            : '领地认领未完成 · 已重新同步';
        this.options.onToast(message, 2300);
        void this.loadSharedLobby(this.generation);
      }
    } finally {
      this.plotMutationPending = false;
      this.renderHomeGrid();
      this.updateUi();
    }
  }

  private async releaseSelectedHomePlot(): Promise<void> {
    const claim = this.selectedMyPlotClaim();
    if (!claim || this.plotMutationPending) return;
    this.plotMutationPending = true;
    this.updateUi();
    this.renderHomeGrid();
    try {
      const response = await this.mutate(`/api/lobby/plots/${encodeURIComponent(claim.id)}`, 'DELETE', {});
      this.removePlotClaim(claim.id, payloadRevision(response));
      this.options.onToast(`已放弃 ${claim.id}，其他家园地块不受影响`, 2200);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const occupied = error instanceof LobbyMutationError && (
          error.status === 409 || error.code === 'lobby_plot_not_empty' || error.code === 'lobby_plot_has_objects'
        );
        this.options.onToast(
          occupied ? '领地内还有物件，清空后才能放弃' : '暂时无法放弃领地 · 已重新同步',
          2300,
        );
        void this.loadSharedLobby(this.generation);
      }
    } finally {
      this.plotMutationPending = false;
      this.renderHomeGrid();
      this.updateUi();
    }
  }

  private async syncOwnerNickname(): Promise<void> {
    const claims = this.myPlotClaims().filter((claim) => claim.ownerNickname !== this.nickname);
    if (claims.length === 0 || this.plotMutationPending) return;
    this.plotMutationPending = true;
    this.updateUi();
    try {
      for (const claim of claims) {
        const response = await this.mutate(`/api/lobby/plots/${encodeURIComponent(claim.id)}`, 'PATCH', {
          nickname: this.nickname,
        });
        const updated = extractPayloadPlot(response);
        if (updated) this.applyPlotClaim(updated, payloadRevision(response));
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.options.onToast('家园昵称更新失败，请重新提交昵称', 2000);
        void this.loadSharedLobby(this.generation);
      }
    } finally {
      this.plotMutationPending = false;
      this.renderHomeGrid();
      this.updateUi();
    }
  }

  private placementAccess(x: number, z: number): {
    allowed: boolean;
    plot: LobbyPlotDefinition | null;
    message: string;
  } {
    if (this.environment.kind === 'persistent-space') {
      if (!isPointWithinLobbyWorld(x, z)) {
        return { allowed: false, plot: null, message: '请放到共享空间的平台范围内' };
      }
      const blocksPlatformSpawn = Math.hypot(x, z - 4.2) <= 2.25;
      const blocksReturnPortal = Math.hypot(x, z - 4.75) <= 2.1;
      const blocksSpawn = Math.hypot(x, z - 7.2) <= 1.75;
      if (blocksPlatformSpawn || blocksReturnPortal || blocksSpawn) {
        return { allowed: false, plot: null, message: '这里是共享空间入口，请换一个位置' };
      }
      return { allowed: true, plot: null, message: '' };
    }
    const location = classifyLobbyLocation(x, z);
    if (location.kind === 'public') {
      if (isLobbyPlacementProtected(x, z)) {
        return { allowed: false, plot: null, message: '这里是出生点或游戏入口，请换一个位置' };
      }
      return { allowed: true, plot: null, message: '' };
    }
    if (location.kind === 'plot') {
      const claim = this.plots.get(location.plot.id);
      if (claim?.ownerId === this.ownerId) return { allowed: true, plot: location.plot, message: '' };
      if (claim) return { allowed: false, plot: location.plot, message: `${claim.ownerNickname}的家园受领地保护` };
      return { allowed: false, plot: location.plot, message: '请先认领这块家园领地，再放置物件' };
    }
    return { allowed: false, plot: null, message: '请放到中央公共广场或你已认领的家园范围内' };
  }

  private protectedObjectMessage(record: LobbyObjectRecord): string {
    if (this.runtimeVehicleIsOccupied(record.state.id)) return '载具正在被驾驶或安全降落，暂时不能编辑或删除';
    if (record.state.system || record.state.locked) return '系统物件不可编辑或删除';
    if (!record.state.plotId) return '这个公共物件暂时不可编辑';
    const claim = this.plots.get(record.state.plotId);
    return claim ? `${claim.ownerNickname}的家园物件受领地保护` : '这件家园物件受领地保护';
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.isEnabled || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const record = this.pickObject(event.clientX, event.clientY);
    if (!record || !canEditLobbyObject(record.state)) {
      this.clearSelection();
      this.updateUi();
      return;
    }
    this.select(record.state.id);
    if (!this.isRecordEditable(record) || this.objectMutationQueues.has(record.state.id)) return;
    const point = this.groundPoint(event.clientX, event.clientY);
    if (!point) return;
    const idleRuntime = this.idleVehicleRuntimePose(record.state.id);
    const startX = idleRuntime?.x ?? record.state.position.x;
    const startZ = idleRuntime?.z ?? record.state.position.z;
    this.dragging = {
      pointerId: event.pointerId,
      objectId: record.state.id,
      offsetX: startX - point.x,
      offsetZ: startZ - point.z,
      startX,
      startZ,
      moved: false,
      rollback: this.captureTransformSnapshot(record),
    };
    this.canvas.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.isEnabled || !this.dragging || event.pointerId !== this.dragging.pointerId) return;
    const record = this.records.get(this.dragging.objectId);
    const point = this.groundPoint(event.clientX, event.clientY);
    if (!record || !point || !this.isRecordEditable(record)) return;
    const x = THREE.MathUtils.clamp(point.x + this.dragging.offsetX, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const z = THREE.MathUtils.clamp(point.z + this.dragging.offsetZ, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const access = this.placementAccess(x, z);
    if (!access.allowed) return;
    this.dragging.moved = lobbyDragPositionChanged(
      { x: this.dragging.startX, z: this.dragging.startZ },
      { x, z },
    );
    record.state.position.x = x;
    record.state.position.y = point.y;
    record.state.position.z = z;
    record.state.plotId = access.plot?.id ?? null;
    this.updateIdleVehicleRuntimePose(record.state.id, { x, y: point.y, z });
    this.applyTransform(record);
    this.updateUi();
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.dragging.pointerId) return;
    this.finishPointerInteraction();
  }

  private pickObject(clientX: number, clientY: number): LobbyObjectRecord | null {
    this.setRayFromClient(clientX, clientY);
    const hit = this.raycaster.intersectObjects([...this.records.values()].map((record) => record.root), true)[0];
    return hit ? this.findRecordFromObject(hit.object) : null;
  }

  private findRecordFromObject(object: THREE.Object3D): LobbyObjectRecord | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      const id = current.userData.lobbyObjectId;
      if (typeof id === 'string') return this.records.get(id) ?? null;
      current = current.parent;
    }
    return null;
  }

  private setRayFromClient(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(point, this.camera);
  }

  private groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    this.setRayFromClient(clientX, clientY);
    if (this.environment.kind === 'persistent-space') {
      return this.firstPlacementSurfaceHit(this.raycaster.intersectObjects(this.placementSurfaces, true));
    }
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    if (!point) return null;
    point.x = THREE.MathUtils.clamp(point.x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    point.z = THREE.MathUtils.clamp(point.z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    point.y = 0;
    return point;
  }

  private firstPlacementSurfaceHit(intersections: THREE.Intersection[]): THREE.Vector3 | null {
    for (const intersection of intersections) {
      if (!intersection.face) continue;
      const normal = intersection.face.normal.clone().applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld),
      );
      if (normal.y < 0.7) continue;
      const point = intersection.point.clone();
      point.x = THREE.MathUtils.clamp(point.x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
      point.y = THREE.MathUtils.clamp(point.y, 0, 8);
      point.z = THREE.MathUtils.clamp(point.z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
      return point;
    }
    return null;
  }

  private placementSurfacePoint(x: number, z: number): THREE.Vector3 | null {
    if (this.environment.kind !== 'persistent-space' || this.placementSurfaces.length === 0) return null;
    this.raycaster.set(
      new THREE.Vector3(x, 16, z),
      new THREE.Vector3(0, -1, 0),
    );
    return this.firstPlacementSurfaceHit(this.raycaster.intersectObjects(this.placementSurfaces, true));
  }

  private createInFront(catalogId: string): void {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    if (this.environment.kind === 'persistent-space') {
      const horizontal = new THREE.Vector3(forward.x, 0, forward.z);
      if (horizontal.lengthSq() < 0.001) horizontal.set(0, 0, -1);
      horizontal.normalize();
      for (const distance of FRONT_PLACEMENT_DISTANCES) {
        const x = THREE.MathUtils.clamp(
          this.camera.position.x + horizontal.x * distance,
          -LOBBY_WORLD_LIMIT,
          LOBBY_WORLD_LIMIT,
        );
        const z = THREE.MathUtils.clamp(
          this.camera.position.z + horizontal.z * distance,
          -LOBBY_WORLD_LIMIT,
          LOBBY_WORLD_LIMIT,
        );
        const surfacePoint = this.placementSurfacePoint(x, z);
        if (surfacePoint && this.placementAccess(surfacePoint.x, surfacePoint.z).allowed) {
          this.createObject(catalogId, surfacePoint.x, surfacePoint.z, surfacePoint.y);
          return;
        }
      }
      this.options.onToast('请面向共享空间的平台后再添加物件', 1900);
      return;
    }
    const point = lobbyPlacementInFront(this.camera.position, forward);
    if (this.placementAccess(point.x, point.y).allowed) {
      this.createObject(catalogId, point.x, point.y, 0);
      return;
    }
    const myPlot = this.myPlotClaim();
    const definition = myPlot ? lobbyPlotById(myPlot.id) : null;
    if (definition) {
      this.createObject(catalogId, definition.centerX, definition.centerZ, 0);
      return;
    }
    this.createObject(catalogId, 6, 0, 0);
  }

  private createObject(catalogId: string, x: number, z: number, y: number): void {
    if (!this.ownerId) {
      this.options.onToast('正在确认大厅身份，请稍候', 1600);
      return;
    }
    const item = this.catalog.get(catalogId);
    if (!item) {
      this.options.onToast('这个物件已从目录移除', 1600);
      return;
    }
    if (this.records.size >= LOBBY_MAX_OBJECTS) {
      this.options.onToast('大厅已达到 200 件物件上限', 1900);
      return;
    }
    const clampedX = THREE.MathUtils.clamp(x, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const clampedZ = THREE.MathUtils.clamp(z, -LOBBY_WORLD_LIMIT, LOBBY_WORLD_LIMIT);
    const access = this.placementAccess(clampedX, clampedZ);
    if (!access.allowed) {
      this.options.onToast(access.message, 2100);
      return;
    }
    const tempId = `local-${crypto.randomUUID()}`;
    const state: LobbyObjectState = {
      id: tempId,
      catalogId,
      position: { x: clampedX, y: THREE.MathUtils.clamp(y, 0, 8), z: clampedZ },
      rotationY: 0,
      scale: item.defaultScale,
      locked: false,
      system: false,
      createdBy: this.ownerId,
      plotId: access.plot?.id ?? null,
      interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
    };
    this.upsertObject(state);
    this.select(tempId);
    void this.createRemote(state);
  }

  private async createRemote(local: LobbyObjectState): Promise<void> {
    const generation = this.generation;
    try {
      const response = await this.mutate('/api/lobby/objects', 'POST', {
        clientId: this.ownerId ?? this.connectionId,
        catalogId: local.catalogId,
        position: local.position,
        rotationY: local.rotationY,
        scale: local.scale,
      });
      if (generation !== this.generation) return;
      const created = extractPayloadObject(response, this.environment);
      if (!created) throw new Error('创建响应缺少 object');
      this.removeObject(local.id, false);
      this.upsertObject(created);
      this.select(created.id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && generation === this.generation) {
        this.removeObject(local.id);
        this.setSync('offline');
        this.options.onToast('创建未完成 · 已恢复服务器状态', 2200);
        void this.loadSharedLobby(generation);
      }
    }
  }

  private transformSelected(kind: 'rotate' | 'scale', delta: number): void {
    const record = this.selectedId ? this.records.get(this.selectedId) : null;
    if (!record || !this.isRecordEditable(record) || this.objectMutationQueues.has(record.state.id)) return;
    const rollback = this.captureTransformSnapshot(record);
    if (kind === 'rotate') {
      const idleRuntime = this.idleVehicleRuntimePose(record.state.id);
      record.state.rotationY = normalizeAngle((idleRuntime?.yaw ?? record.state.rotationY) + delta);
      this.updateIdleVehicleRuntimePose(record.state.id, { yaw: record.state.rotationY });
    } else {
      record.state.scale = THREE.MathUtils.clamp(record.state.scale + delta, 0.25, 3);
    }
    this.applyTransform(record);
    this.updateUi();
    this.queuePatch(record, [kind === 'rotate' ? 'rotationY' : 'scale'], rollback);
  }

  private queuePatch(
    record: LobbyObjectRecord,
    fields: Array<'position' | 'rotationY' | 'scale'>,
    rollback: LobbyObjectTransformSnapshot,
  ): void {
    if (
      this.records.get(record.state.id) !== record
      || !this.isRecordEditable(record)
      || this.objectMutationQueues.has(record.state.id)
    ) {
      this.restoreTransformSnapshot(record, rollback);
      return;
    }
    const id = record.state.id;
    const generation = this.generation;
    const body: Record<string, unknown> = { clientId: this.ownerId ?? this.connectionId };
    if (fields.includes('position')) body.position = { ...record.state.position };
    if (fields.includes('rotationY')) body.rotationY = record.state.rotationY;
    if (fields.includes('scale')) body.scale = record.state.scale;
    this.queueObjectMutation(id, async () => {
      if (this.records.get(id) !== record || this.pendingDeletes.has(id)) return;
      try {
        const response = await this.mutate(`/api/lobby/objects/${encodeURIComponent(id)}`, 'PATCH', body);
        if (generation !== this.generation || this.pendingDeletes.has(id)) return;
        const updated = extractPayloadObject(response, this.environment);
        if (updated) this.upsertObject(updated);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError') && generation === this.generation) {
          if (this.records.get(id) === record) this.restoreTransformSnapshot(record, rollback);
          this.setSync('offline');
          this.options.onToast('保存失败 · 正在重新同步', 1800);
          void this.loadSharedLobby(generation);
        }
      }
    });
    this.updateUi();
  }

  private requestInteraction(
    record: LobbyObjectRecord,
    selectedPortalDestination: LobbyPortalDestination | null = null,
  ): void {
    if (!record.item.interaction || !record.interact || this.pendingInteractions.has(record.state.id)) return;
    const interaction = record.state.interaction;
    if (interaction.startedAt) {
      const ageMs = Date.now() + this.serverTimeOffsetMs - Date.parse(interaction.startedAt);
      if (ageMs < record.item.interaction.cooldownMs) {
        this.options.onToast('这个物件的动画还在进行中', 1500);
        return;
      }
    }
    const id = record.state.id;
    const requestId = `interaction-${crypto.randomUUID()}`;
    const generation = this.generation;
    this.pendingInteractions.add(id);
    this.queueObjectMutation(id, async () => {
      try {
        const response = await this.mutate(`/api/lobby/objects/${encodeURIComponent(id)}/interactions`, 'POST', {
          requestId,
          baseSequence: interaction.sequence,
        });
        if (generation !== this.generation) return;
        const updated = extractPayloadObject(response, this.environment);
        if (updated) {
          this.upsertObject(updated);
          const activeRecord = this.records.get(id);
          if (
            activeRecord === record
            && isAuthoritativeLocalLobbyInteraction(updated.interaction, requestId, interaction.sequence)
          ) {
            this.options.onLocalPropInteraction?.({
              objectId: id,
              catalogId: activeRecord.item.id,
              name: activeRecord.item.name,
              sequence: updated.interaction.sequence,
              ageSeconds: lobbyInteractionAgeSeconds(updated.interaction, this.serverTimeOffsetMs),
              durationMs: activeRecord.item.interaction?.durationMs ?? 0,
              root: activeRecord.root,
            });
            if (activeRecord.portal) {
              const destination = selectedPortalDestination
                && activeRecord.portal.destinations.some((candidate) => candidate.id === selectedPortalDestination.id)
                ? selectedPortalDestination
                : lobbyPortalDestinationForSequence(activeRecord.portal, updated.interaction.sequence);
              this.options.onPortalUse?.({
                objectId: id,
                catalogId: activeRecord.item.id,
                name: activeRecord.item.name,
                sequence: updated.interaction.sequence,
                destination,
              });
            }
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError') && generation === this.generation) {
          if (error instanceof LobbyMutationError && (
            error.code === 'lobby_interaction_conflict'
            || error.code === 'lobby_interaction_cooldown'
          )) {
            this.options.onToast('其他玩家刚刚触发了这个物件', 1700);
          } else {
            this.setSync('offline');
            this.options.onToast('互动未同步 · 正在恢复服务器状态', 1900);
          }
          void this.loadSharedLobby(generation);
        }
      } finally {
        this.pendingInteractions.delete(id);
      }
    });
  }

  private deleteSelected(): void {
    const id = this.selectedId;
    const record = id ? this.records.get(id) : null;
    if (!id || !record || !this.isRecordDeletable(record)) return;
    this.clearSelection();
    this.pendingDeletes.add(id);
    this.updateUi();
    this.queueObjectMutation(id, () => this.deleteRemote(id));
  }

  private async deleteRemote(id: string): Promise<void> {
    const generation = this.generation;
    try {
      const response = await this.mutate(`/api/lobby/objects/${encodeURIComponent(id)}`, 'DELETE', {
        clientId: this.ownerId ?? this.connectionId,
      });
      if (generation !== this.generation) return;
      const revision = payloadRevision(response);
      if (revision !== undefined) {
        this.tombstones.set(id, Math.max(this.tombstones.get(id) ?? 0, revision));
      }
      this.pendingDeletes.delete(id);
      this.removeObject(id, true, revision);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && generation === this.generation) {
        this.pendingDeletes.delete(id);
        this.tombstones.delete(id);
        if (error instanceof LobbyMutationError && error.code === 'lobby_object_not_owned') {
          this.options.onToast('服务器尚未启用频道共同删除，请稍后重试', 2100);
          this.updateUi();
        } else {
          this.setSync('offline');
          this.options.onToast('删除未同步 · 正在恢复服务器状态', 2100);
          void this.loadSharedLobby(generation);
        }
      }
    }
  }

  private queueObjectMutation(id: string, operation: () => Promise<void>): void {
    const generation = this.generation;
    const previous = this.objectMutationQueues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      await operation();
    });
    this.objectMutationQueues.set(id, next);
    const cleanup = (): void => {
      if (this.objectMutationQueues.get(id) !== next) return;
      this.objectMutationQueues.delete(id);
      const tombstone = this.tombstones.get(id);
      const record = this.records.get(id);
      if (tombstone !== undefined && record && (record.state.revision ?? 0) <= tombstone) {
        this.removeObject(id, true, tombstone);
      }
      this.updateUi();
    };
    void next.then(cleanup, cleanup);
  }

  private async mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    this.mutationControllers.add(controller);
    this.pendingMutations += 1;
    this.setSync('saving');
    try {
      const response = await fetch(withLobbyChannel(path, this.requireChannel()), {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const errorRecord = payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>).error
          : null;
        const error = errorRecord && typeof errorRecord === 'object' ? errorRecord as Record<string, unknown> : null;
        throw new LobbyMutationError(
          response.status,
          typeof error?.code === 'string' ? error.code : null,
          typeof error?.message === 'string' ? error.message : `${method} ${path} HTTP ${response.status}`,
        );
      }
      if (!this.acceptsChannelPayload(payload)) {
        throw new LobbyMutationError(409, 'lobby_channel_mismatch', 'Lobby mutation returned a different channel');
      }
      this.readServerTime(payload);
      return payload;
    } finally {
      this.mutationControllers.delete(controller);
      this.pendingMutations = Math.max(0, this.pendingMutations - 1);
      if (this.pendingMutations === 0 && this.sync !== 'offline') this.setSync('synced');
    }
  }

  private async loadSharedLobby(generation: number): Promise<void> {
    const controller = new AbortController();
    this.loadController = controller;
    try {
      const identity = await this.loadOwnerIdentity(controller.signal);
      if (generation !== this.generation || !this.root) return;
      this.ownerId = identity.ownerId;
      this.serverTimeOffsetMs = identity.serverTimeOffsetMs;
      this.refreshNeighborhoodScene();
      this.renderCatalog();
      this.updateUi();
      const fetchCatalog = async (path: string): Promise<LobbyCatalogItem[] | null> => {
        try {
          const response = await fetch(path, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) return null;
          return parseLobbyCatalog(await response.json());
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          return null;
        }
      };
      const [systemCatalog, personalCatalog] = await Promise.all([
        fetchCatalog('/api/lobby/catalog'),
        fetchCatalog('/api/lobby/assets'),
      ]);
      if (generation !== this.generation || !this.root) return;
      if (systemCatalog && systemCatalog.length > 0) {
        this.systemCatalog = new Map(systemCatalog.map((item) => [item.id, item]));
      }
      if (personalCatalog) {
        this.personalCatalog.clear();
        for (const item of personalCatalog.slice(0, LOBBY_MAX_PERSONAL_ASSETS)) {
          if (item.kind === 'glb') this.personalCatalog.set(item.id, item);
        }
      }
      this.rebuildPlaceableCatalog();
      this.updateAssetUploadUi();
      const stateResponse = await fetch(withLobbyChannel('/api/lobby/state', this.requireChannel()), {
        headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!stateResponse.ok) throw new Error(`state HTTP ${stateResponse.status}`);
      const payload = await stateResponse.json();
      if (generation !== this.generation || !this.root) return;
      if (!this.acceptsChannelPayload(payload)) throw new Error('state channel mismatch');
      this.applySnapshot(payload);
      void this.syncOwnerNickname();
      this.setSync(this.pendingMutations > 0 ? 'saving' : 'synced');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && generation === this.generation) {
        this.setSync('offline');
      }
    } finally {
      if (this.loadController === controller) this.loadController = null;
    }
  }

  private connectEvents(generation: number): void {
    try {
      const source = new EventSource(withLobbyChannel(`/api/lobby/events?clientId=${encodeURIComponent(this.connectionId)}`, this.requireChannel()), { withCredentials: true });
      this.source = source;
      source.onopen = () => {
        if (generation !== this.generation) return;
        if (this.pendingMutations === 0) this.setSync('synced');
      };
      source.onerror = () => {
        if (generation === this.generation && this.pendingMutations === 0) this.setSync('offline');
      };
      source.onmessage = (event) => this.handleEvent(event, 'message', generation);
      for (const name of [
        'snapshot', 'state',
        'object.created', 'object.updated', 'object.interacted', 'object.deleted',
        'plot.claimed', 'plot.updated', 'plot.released',
        'presence', 'online',
      ]) {
        source.addEventListener(name, (event) => this.handleEvent(event as MessageEvent<string>, name, generation));
      }
    } catch {
      this.setSync('offline');
    }
  }

  private handleEvent(event: MessageEvent<string>, hint: string, generation: number): void {
    if (generation !== this.generation) return;
    try {
      const payload = JSON.parse(event.data) as unknown;
      if (!payload || typeof payload !== 'object') return;
      if (!this.acceptsChannelPayload(payload)) return;
      const record = payload as Record<string, unknown>;
      this.readServerTime(record);
      const type = typeof record.type === 'string' ? record.type : hint;
      this.readOnline(record);
      const eventRevision = payloadRevision(record);
      const nested = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : null;
      const hasSnapshot = Array.isArray(record.objects) || Array.isArray(record.plots)
        || Array.isArray(nested?.objects) || Array.isArray(nested?.plots);
      if (hasSnapshot) {
        this.applySnapshot(record);
      } else if (this.environment.kind === 'lobby' && type === 'plot.released') {
        const plotId = releasedPlotId(record);
        if (plotId) this.removePlotClaim(plotId, eventRevision);
      } else if (this.environment.kind === 'lobby' && (type === 'plot.claimed' || type === 'plot.updated')) {
        const plot = extractPayloadPlot(record);
        if (plot) this.applyPlotClaim(plot, eventRevision);
      } else if (/deleted|remove/i.test(type)) {
        if (eventRevision !== undefined) this.snapshotRevision = Math.max(this.snapshotRevision, eventRevision);
        const revision = payloadRevision(record);
        const id = lobbyDeletedObjectId(record);
        if (id) this.removeObject(id, true, revision);
      } else {
        if (eventRevision !== undefined) this.snapshotRevision = Math.max(this.snapshotRevision, eventRevision);
        const object = extractPayloadObject(record, this.environment);
        if (object) this.upsertObject(object);
      }
      if (this.pendingMutations === 0) this.setSync('synced');
    } catch {
      // A malformed event is ignored; EventSource stays alive for the next authoritative update.
    }
  }

  private applySnapshot(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (!this.acceptsChannelPayload(value)) return;
    const record = value as Record<string, unknown>;
    this.readServerTime(record);
    const objectSource = Array.isArray(record.objects)
      ? record.objects
      : record.state && typeof record.state === 'object' && Array.isArray((record.state as Record<string, unknown>).objects)
        ? (record.state as { objects: unknown[] }).objects
        : null;
    const plotSource = Array.isArray(record.plots)
      ? record.plots
      : record.state && typeof record.state === 'object' && Array.isArray((record.state as Record<string, unknown>).plots)
        ? (record.state as { plots: unknown[] }).plots
        : null;
    const revision = payloadRevision(record);
    if (!acceptsLobbySnapshotRevision(revision, this.snapshotRevision)) return;
    if (revision !== undefined) this.snapshotRevision = Math.max(this.snapshotRevision, revision);
    this.readOnline(record);
    if (plotSource && this.environment.kind === 'lobby') {
      const nextPlots = new Map<string, LobbyPlotClaim>();
      for (const candidate of plotSource.slice(0, LOBBY_PLOTS.length)) {
        const claim = normalizeLobbyPlotClaim(candidate);
        if (claim) nextPlots.set(claim.id, claim);
      }
      this.plots.clear();
      for (const [id, claim] of nextPlots) this.plots.set(id, claim);
      this.selectedHomePlotId = selectedLobbyHomePlotId(
        this.plots.values(), this.ownerId, this.selectedHomePlotId,
      );
      if (revision !== undefined) {
        for (const plot of LOBBY_PLOTS) this.plotRevisions.set(plot.id, revision);
      }
      this.refreshNeighborhoodScene();
      this.renderHomeGrid();
    }
    if (objectSource) {
      const nextIds = new Set<string>();
      for (const candidate of objectSource.slice(0, LOBBY_MAX_OBJECTS + 4)) {
        const object = normalizeLobbyObject(candidate, this.environment);
        if (!object) continue;
        nextIds.add(object.id);
        this.upsertObject(object);
      }
      for (const id of this.records.keys()) {
        if (nextIds.has(id)) continue;
        const action = lobbySnapshotMissingAction(id, this.objectMutationQueues.has(id), this.pendingDeletes.has(id));
        if (action === 'keep-local') continue;
        if (action === 'defer-tombstone') {
          if (revision !== undefined) this.tombstones.set(id, Math.max(this.tombstones.get(id) ?? 0, revision));
          continue;
        }
        this.removeObject(id, true, revision);
      }
    }
    this.updateUi();
  }

  private readOnline(record: Record<string, unknown>): void {
    const nested = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : null;
    const value = record.online ?? record.onlineCount ?? nested?.online ?? nested?.onlineCount;
    const next = Math.floor(finiteFrom(value, this.online));
    this.online = THREE.MathUtils.clamp(next, 0, 100_000);
    this.updateUi();
  }

  private catalogItemForObject(catalogId: string): LobbyCatalogItem | undefined {
    return this.catalog.get(catalogId) ?? this.remoteCatalog.get(catalogId);
  }

  private queueRemoteAssetResolution(catalogId: string): void {
    const failedAt = this.remoteAssetFailures.get(catalogId);
    if (failedAt !== undefined && Date.now() - failedAt >= REMOTE_ASSET_FAILURE_RETRY_MS) {
      this.remoteAssetFailures.delete(catalogId);
    }
    if (
      !isUserLobbyGlbAssetId(catalogId)
      || this.catalog.has(catalogId)
      || this.remoteCatalog.has(catalogId)
      || this.remoteAssetFailures.has(catalogId)
      || this.remoteAssetQueued.has(catalogId)
      || !this.root
    ) return;
    this.remoteAssetQueued.add(catalogId);
    this.remoteAssetQueue.push({
      id: catalogId,
      generation: this.generation,
      epoch: this.remoteAssetEpoch,
    });
    this.pumpRemoteAssetQueue();
  }

  private pumpRemoteAssetQueue(): void {
    while (this.remoteAssetActive < MAX_REMOTE_ASSET_REQUESTS && this.remoteAssetQueue.length > 0) {
      const job = this.remoteAssetQueue.shift();
      if (!job) return;
      if (job.epoch !== this.remoteAssetEpoch || job.generation !== this.generation || !this.root) {
        this.remoteAssetQueued.delete(job.id);
        continue;
      }
      this.remoteAssetActive += 1;
      void this.resolveRemoteAsset(job);
    }
  }

  private async resolveRemoteAsset(job: { id: string; generation: number; epoch: number }): Promise<void> {
    const controller = new AbortController();
    this.remoteAssetControllers.set(job.id, controller);
    try {
      const response = await fetch(`/api/lobby/assets/${encodeURIComponent(job.id)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`asset metadata HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
      const item = parseLobbyCatalog({ assets: [record?.asset] })[0];
      if (!item || item.id !== job.id || item.kind !== 'glb') throw new Error('asset metadata is invalid');
      if (
        job.epoch !== this.remoteAssetEpoch
        || job.generation !== this.generation
        || !this.root
        || this.catalog.has(job.id)
      ) return;
      this.remoteCatalog.set(job.id, item);
      const affected = [...this.records.values()]
        .filter((candidate) => candidate.state.catalogId === job.id)
        .map((candidate) => candidate.state);
      for (const object of affected) this.upsertObject(object);
    } catch (error) {
      if (
        !(error instanceof DOMException && error.name === 'AbortError')
        && job.epoch === this.remoteAssetEpoch
        && job.generation === this.generation
      ) {
        this.remoteAssetFailures.set(job.id, Date.now());
      }
    } finally {
      if (job.epoch === this.remoteAssetEpoch) {
        if (this.remoteAssetControllers.get(job.id) === controller) this.remoteAssetControllers.delete(job.id);
        this.remoteAssetQueued.delete(job.id);
        this.remoteAssetActive = Math.max(0, this.remoteAssetActive - 1);
        this.pumpRemoteAssetQueue();
      }
    }
  }

  private upsertObject(object: LobbyObjectState): void {
    if (object.id === SYSTEM_TERMINAL_ID || object.catalogId === 'terminal') {
      this.systemObjects.set(SYSTEM_TERMINAL_ID, {
        id: SYSTEM_TERMINAL_ID,
        catalogId: 'terminal',
        position: { x: 0, y: 0, z: -7.42 },
        rotationY: 0,
        scale: 1,
        locked: true,
        system: true,
        createdBy: null,
        plotId: null,
        interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
      });
      return;
    }
    if (object.system || object.locked) {
      this.systemObjects.set(object.id, { ...object, locked: true, system: true });
      return;
    }
    if (this.pendingDeletes.has(object.id)) return;
    const current = this.records.get(object.id);
    const tombstone = this.tombstones.get(object.id);
    if (!acceptsLobbyObjectRevision(object.revision, current?.state.revision, tombstone)) return;
    if (
      current
      && object.revision !== undefined
      && (current.state.revision === undefined || object.revision > current.state.revision)
    ) {
      const runtimeUpdate: Partial<Pick<LobbyVehicleRuntimePose, 'x' | 'y' | 'z' | 'yaw'>> = {};
      if (
        object.position.x !== current.state.position.x
        || object.position.y !== current.state.position.y
        || object.position.z !== current.state.position.z
      ) {
        runtimeUpdate.x = object.position.x;
        runtimeUpdate.y = object.position.y;
        runtimeUpdate.z = object.position.z;
      }
      if (object.rotationY !== current.state.rotationY) runtimeUpdate.yaw = object.rotationY;
      this.updateIdleVehicleRuntimePose(object.id, runtimeUpdate, true);
    }
    if (object.revision !== undefined) {
      if (tombstone !== undefined && object.revision > tombstone) this.tombstones.delete(object.id);
    }
    const resolvedItem = this.catalogItemForObject(object.catalogId);
    if (!resolvedItem) this.queueRemoteAssetResolution(object.catalogId);
    const item = resolvedItem ?? {
      id: object.catalogId,
      name: object.catalogId,
      category: '未知物件',
      kind: 'code' as const,
      code: '__missing__',
      defaultScale: 1,
    };
    const currentInteraction = current?.item.interaction;
    const nextInteraction = item.interaction;
    const interactionMatches = (!currentInteraction && !nextInteraction) || Boolean(
      currentInteraction
      && nextInteraction
      && currentInteraction.mode === nextInteraction.mode
      && currentInteraction.durationMs === nextInteraction.durationMs
      && currentInteraction.cooldownMs === nextInteraction.cooldownMs,
    );
    const currentPhysics = current?.item.physics;
    const nextPhysics = item.physics;
    const physicsMatches = (!currentPhysics && !nextPhysics) || Boolean(
      currentPhysics && nextPhysics && lobbyPhysicsDescriptorsMatch(currentPhysics, nextPhysics),
    );
    const currentPortal = current?.item.portal;
    const nextPortal = item.portal;
    const portalMatches = (!currentPortal && !nextPortal) || Boolean(
      currentPortal && nextPortal && lobbyPortalCapabilitiesMatch(currentPortal, nextPortal),
    );
    const currentVehicle = current?.item.vehicle;
    const nextVehicle = item.vehicle;
    const vehicleMatches = (!currentVehicle && !nextVehicle) || Boolean(
      currentVehicle
      && nextVehicle
      && currentVehicle.kind === nextVehicle.kind
      && currentVehicle.enterRadius === nextVehicle.enterRadius
      && currentVehicle.maxSpeed === nextVehicle.maxSpeed
      && currentVehicle.maxAcceleration === nextVehicle.maxAcceleration
      && currentVehicle.maxAngularSpeed === nextVehicle.maxAngularSpeed,
    );
    if (
      current &&
      current.item.id === item.id &&
      current.item.kind === item.kind &&
      current.item.code === item.code &&
      current.item.assetUrl === item.assetUrl &&
      interactionMatches &&
      physicsMatches &&
      portalMatches &&
      vehicleMatches
    ) {
      current.state = object;
      current.item = item;
      this.applyTransform(current);
      this.syncRecordInteraction(current);
      this.updateUi();
      return;
    }
    if (current) this.removeObject(object.id, false);
    if (!this.root) return;
    const wrapper = new THREE.Group();
    wrapper.name = `LobbyObject:${object.id}`;
    wrapper.userData.lobbyObjectId = object.id;
    const module = item.kind === 'code' && item.code ? getLobbyPropModule(item.code) : null;
    let content: THREE.Object3D;
    let update: LobbyObjectRecord['update'];
    let interact: LobbyObjectRecord['interact'];
    let applyInteraction: LobbyObjectRecord['applyInteraction'];
    let physics: LobbyObjectRecord['physics'];
    let portal: LobbyObjectRecord['portal'];
    let vehicle: LobbyObjectRecord['vehicle'];
    let updateVehicleVisual: LobbyObjectRecord['updateVehicleVisual'];
    if (module) {
      try {
        content = module.createLobbyProp();
        update = module.updateLobbyProp;
        interact = module.interactLobbyProp;
        applyInteraction = module.applyLobbyPropInteraction;
        if (module.physics && item.physics && lobbyPhysicsDescriptorsMatch(module.physics, item.physics)) {
          physics = parseLobbyPhysicsDescriptor(module.physics) ?? undefined;
        }
        if (module.portal && item.portal && lobbyPortalCapabilitiesMatch(module.portal, item.portal)) {
          portal = parseLobbyPortalCapability(module.portal) ?? undefined;
        }
        if (module.vehicle && item.vehicle?.kind === module.vehicle.kind) {
          vehicle = module.vehicle;
          updateVehicleVisual = module.updateLobbyVehicleVisual;
        }
      } catch (error) {
        console.warn(`[WhiteRoom] 大厅物件 ${item.id} create 已降级`, error);
        content = this.createFallback(false);
      }
    } else {
      content = this.createFallback(item.kind === 'glb');
    }
    wrapper.add(content);
    this.root.add(wrapper);
    const record: LobbyObjectRecord = {
      state: object,
      item,
      root: wrapper,
      propRoot: content,
      update,
      interact,
      applyInteraction,
      appliedInteractionSequence: -1,
      collidable: item.code !== 'light-arch' && item.code !== 'infernal-concert-grand',
      collisionVersion: content.userData.collisionVersion,
      physics,
      portal,
      vehicle,
      updateVehicleVisual,
    };
    this.records.set(object.id, record);
    this.applyTransform(record);
    const runtimeVehicle = this.runtimeVehicles.get(object.id);
    if (runtimeVehicle) this.applyRuntimeVehicleTransform(record, runtimeVehicle);
    this.syncRecordInteraction(record);
    if (item.kind === 'glb' && item.assetUrl) void this.loadGlb(record, content, this.generation);
    this.updateUi();
  }

  private createFallback(forGlb: boolean): THREE.Object3D {
    const group = new THREE.Group();
    group.name = forGlb ? 'GlbFallback' : 'MissingCodeFallback';
    const material = new THREE.MeshStandardMaterial({
      color: forGlb ? '#cfd7d4' : '#e8b7a2',
      emissive: forGlb ? '#4e6f69' : '#7e382a',
      emissiveIntensity: 0.2,
      roughness: 0.68,
    });
    const mesh = new THREE.Mesh(forGlb ? new THREE.IcosahedronGeometry(0.75, 1) : new THREE.BoxGeometry(1, 1, 1), material);
    mesh.position.y = 0.75;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  private async loadGlb(record: LobbyObjectRecord, fallback: THREE.Object3D, generation: number): Promise<void> {
    let lease: LobbyGlbLease | null = null;
    try {
      const asset = new URL(record.item.assetUrl!, document.baseURI);
      if (asset.origin !== window.location.origin) throw new Error('GLB must be same-origin');
      lease = await this.glbCache.acquire(asset.href);
      if (generation !== this.generation || this.records.get(record.state.id) !== record) {
        lease.release();
        lease = null;
        return;
      }
      const model = lease.scene;
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(longest) || longest <= 0.0001) throw new Error('GLB bounds invalid');
      model.scale.setScalar(2 / longest);
      model.updateWorldMatrix(true, true);
      const normalized = new THREE.Box3().setFromObject(model);
      const center = normalized.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.y -= normalized.min.y;
      model.position.z -= center.z;
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      fallback.removeFromParent();
      disposeObject(fallback);
      record.root.add(model);
      record.propRoot = model;
      record.assetLease = lease;
      lease = null;
      this.options.onColliderChanged(record.state.id, record.root, record.collidable);
      this.selectionHelper?.update();
    } catch {
      // Keep the geometric fallback so a broken asset never breaks the lobby or level entry.
    } finally {
      lease?.release();
    }
  }

  private applyTransform(record: LobbyObjectRecord): void {
    const runtimeVehicle = this.runtimeVehicles.get(record.state.id);
    if (runtimeVehicle && record.vehicle) {
      this.applyRuntimeVehicleTransform(record, runtimeVehicle);
      return;
    }
    const runtimePhysics = this.runtimePhysicsPoses.get(record.state.id);
    if (runtimePhysics && record.physics?.body === 'dynamic') {
      this.applyRuntimePhysicsTransform(record, runtimePhysics);
      return;
    }
    const { position, rotationY, scale } = record.state;
    record.root.position.set(position.x, position.y, position.z);
    record.root.rotation.set(0, rotationY, 0);
    record.root.scale.setScalar(scale);
    record.root.updateWorldMatrix(true, true);
    this.options.onColliderChanged(record.state.id, record.root, record.collidable);
    this.selectionHelper?.update();
  }

  private applyRuntimePhysicsTransform(record: LobbyObjectRecord, pose: LobbyPhysicsRuntimePose): void {
    const worldPosition = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
    const worldRotation = new THREE.Quaternion(
      pose.rotation.x,
      pose.rotation.y,
      pose.rotation.z,
      pose.rotation.w,
    ).normalize();
    record.root.updateWorldMatrix(true, false);
    const worldScale = record.root.getWorldScale(new THREE.Vector3());
    const worldMatrix = new THREE.Matrix4().compose(worldPosition, worldRotation, worldScale);
    if (record.root.parent) {
      record.root.parent.updateWorldMatrix(true, false);
      worldMatrix.premultiply(record.root.parent.matrixWorld.clone().invert());
    }
    worldMatrix.decompose(record.root.position, record.root.quaternion, record.root.scale);
    record.root.updateWorldMatrix(true, true);
    this.options.onColliderChanged(record.state.id, record.root, record.collidable);
    this.selectionHelper?.update();
  }

  private applyRuntimeVehicleTransform(record: LobbyObjectRecord, pose: LobbyVehicleRuntimePose): void {
    record.root.position.set(pose.x, pose.y, pose.z);
    record.root.rotation.order = 'YXZ';
    record.root.rotation.set(pose.pitch, pose.yaw, pose.roll);
    record.root.scale.setScalar(record.state.scale);
    record.root.updateWorldMatrix(true, true);
    this.options.onColliderChanged(record.state.id, record.root, record.collidable);
    this.selectionHelper?.update();
  }

  private syncRecordInteraction(record: LobbyObjectRecord): void {
    const interaction = record.state.interaction;
    if (record.appliedInteractionSequence === interaction.sequence) return;
    const ageSeconds = lobbyInteractionAgeSeconds(interaction, this.serverTimeOffsetMs);
    try {
      if (record.applyInteraction) {
        record.applyInteraction(record.propRoot, { sequence: interaction.sequence, ageSeconds }, this.lastElapsed);
      } else if (record.interact && interaction.sequence === record.appliedInteractionSequence + 1) {
        record.interact(record.propRoot);
      }
      record.appliedInteractionSequence = interaction.sequence;
      if (interaction.sequence > 0 && record.item.interaction) {
        this.options.onPropInteraction?.({
          objectId: record.state.id,
          catalogId: record.item.id,
          name: record.item.name,
          sequence: interaction.sequence,
          ageSeconds,
          durationMs: record.item.interaction.durationMs,
        });
      }
    } catch (error) {
      console.warn(`[WhiteRoom] 大厅物件 ${record.item.id} 互动状态同步已停用`, error);
      record.interact = undefined;
      record.applyInteraction = undefined;
    }
  }

  private removeObject(id: string, updateUi = true, tombstoneRevision?: number): void {
    const record = this.records.get(id);
    if (tombstoneRevision !== undefined) {
      if (record?.state.revision !== undefined && record.state.revision > tombstoneRevision) return;
      this.tombstones.set(id, Math.max(this.tombstones.get(id) ?? 0, tombstoneRevision));
    }
    this.runtimeVehicles.delete(id);
    this.runtimeVehicleGenerations.delete(id);
    this.runtimePhysicsPoses.delete(id);
    if (!record) {
      this.systemObjects.delete(id);
      return;
    }
    if (this.selectedId === id) this.clearSelection();
    this.options.onColliderChanged(id, null, record.collidable);
    record.root.removeFromParent();
    this.disposeRecord(record);
    this.records.delete(id);
    if (updateUi) this.updateUi();
  }

  private disposeRecord(record: LobbyObjectRecord): void {
    if (record.assetLease) {
      record.propRoot.removeFromParent();
      record.assetLease.release();
      record.assetLease = undefined;
    }
    disposeObject(record.root);
  }

  private select(id: string): void {
    const record = this.records.get(id);
    if (!record || !canEditLobbyObject(record.state) || !this.root) return;
    this.clearSelection();
    this.selectedId = id;
    this.selectionHelper = new THREE.BoxHelper(record.root, 0x22bfae);
    this.selectionHelper.name = 'LobbySelection';
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.renderOrder = 999;
    this.root.add(this.selectionHelper);
    this.updateUi();
  }

  private clearSelection(): void {
    this.selectedId = null;
    if (this.selectionHelper) {
      this.selectionHelper.removeFromParent();
      this.selectionHelper.geometry.dispose();
      (this.selectionHelper.material as THREE.Material).dispose();
      this.selectionHelper = null;
    }
  }

  private renderCatalog(): void {
    this.ui.catalog.replaceChildren();
    const previews: LobbyPropPreviewRegistration[] = [];
    for (const item of this.catalog.values()) {
      if (item.realmSpace) continue;
      const personal = this.personalCatalog.has(item.id) && !this.systemCatalog.has(item.id);
      const card = document.createElement('article');
      card.className = 'lobby-catalog-card';
      card.draggable = Boolean(this.ownerId);
      card.dataset.catalogId = item.id;
      card.dataset.catalogSource = personal ? 'personal' : 'system';
      const preview = document.createElement('div');
      preview.className = 'lobby-catalog-preview';
      preview.dataset.previewId = item.id;
      preview.dataset.previewKind = item.kind;
      preview.setAttribute('role', 'img');
      const previewViewport = document.createElement('div');
      previewViewport.className = 'lobby-catalog-preview-viewport';
      previewViewport.dataset.previewViewport = '';
      const previewStatus = document.createElement('span');
      previewStatus.className = 'lobby-catalog-preview-status';
      previewStatus.dataset.previewStatus = '';
      preview.append(previewViewport, previewStatus);
      const copy = document.createElement('div');
      copy.className = 'lobby-catalog-copy';
      const category = document.createElement('span');
      category.textContent = item.category;
      const name = document.createElement('strong');
      name.textContent = item.name;
      const hint = document.createElement('small');
      hint.textContent = personal
        ? '我的上传 · GLB 模型'
        : item.kind === 'glb' ? '系统 GLB 模型' : '系统 · THREE.JS 代码';
      copy.append(category, name, hint);
      const add = document.createElement('button');
      add.type = 'button';
      add.dataset.addCatalogId = item.id;
      add.textContent = '＋ 添加';
      add.disabled = !this.ownerId;
      add.setAttribute('aria-label', `添加${item.name}`);
      card.append(preview, copy, add);
      this.ui.catalog.append(card);
      previews.push({ item, host: preview });
    }
    this.previews.setItems(previews);
    const revealId = this.revealCatalogId;
    this.revealCatalogId = null;
    if (revealId) {
      const card = [...this.ui.catalog.querySelectorAll<HTMLElement>('[data-catalog-id]')]
        .find((candidate) => candidate.dataset.catalogId === revealId);
      requestAnimationFrame(() => card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }

  private updateUi(): void {
    this.ui.channel.textContent = this.channel
      ? this.environment.kind === 'persistent-space'
        ? `共享空间 · ${this.environment.label}`
        : `频道 ${this.channel}`
      : '尚未进入频道';
    this.ui.online.textContent = `${this.online} 人在线`;
    const syncLabels: Record<LobbySyncState, string> = {
      connecting: '正在连接', synced: '已同步', saving: '正在保存', offline: '离线模式',
    };
    this.ui.sync.textContent = syncLabels[this.sync];
    this.ui.sync.dataset.state = this.sync;
    this.updateAssetUploadUi();
    this.updatePropCreationUi();
    const myPlots = this.myPlotClaims();
    const selectedPlot = this.selectedMyPlotClaim();
    const myPlotIds = myPlots.map((claim) => claim.id);
    const homeList = myPlotIds.length <= 4
      ? myPlotIds.join('、')
      : `${myPlotIds.slice(0, 3).join('、')} 等 ${myPlotIds.length} 块`;
    if (this.environment.kind === 'persistent-space') {
      this.ui.homeStatus.textContent = `${this.environment.label} · 当前大厅共享持久空间`;
      this.ui.homeMeta.textContent = '这里的公共物件会实时同步，并在离开或服务重启后保留';
      this.ui.homeChoose.textContent = '共享空间无需认领';
      this.ui.homeChoose.disabled = true;
      this.ui.homeRelease.disabled = true;
      this.ui.homeRelease.textContent = '共享空间无领地';
      this.ui.homeDialogStatus.textContent = '共享空间不使用大厅家园领地';
      if (this.ui.homeDialog.open) this.ui.homeDialog.close();
    } else {
      this.ui.homeStatus.textContent = myPlots.length > 0
        ? `${this.nickname} · 已认领 ${myPlots.length} 块家园`
        : '尚未认领领地';
      this.ui.homeMeta.textContent = myPlots.length > 0
        ? `${homeList} · 每块 ${LOBBY_PLOT_SIZE} × ${LOBBY_PLOT_SIZE} 米，可相邻扩建并连起来装修`
        : this.ownerId
          ? `外围还有 ${LOBBY_PLOTS.length - this.plots.size} 块家园范围可选，可连续认领多块`
          : '正在确认身份，稍后即可选择领地';
      this.ui.homeChoose.textContent = myPlots.length > 0 ? '扩建 / 管理' : '选择领地';
      this.ui.homeChoose.disabled = !this.ownerId || this.plotMutationPending;
      this.ui.homeRelease.disabled = !selectedPlot || this.plotMutationPending;
      this.ui.homeRelease.textContent = selectedPlot ? `放弃 ${selectedPlot.id}` : '先选择我的领地';
      this.ui.homeDialogStatus.textContent = this.plotMutationPending
        ? '正在保存家园变更…'
        : selectedPlot
          ? `${selectedPlot.id} 已选中；只有地块为空时才能单独放弃`
          : myPlots.length > 0
            ? `点击“可认领”继续扩建，点击“我的”选择要管理的范围 · ${LOBBY_PLOTS.length - this.plots.size} 块可用`
            : `选择一块标记为“可认领”的家园范围 · ${LOBBY_PLOTS.length - this.plots.size} 块可用`;
    }
    if (this.ui.homeDialog.open) this.renderHomeGrid();
    const record = this.selectedId ? this.records.get(this.selectedId) : null;
    this.ui.empty.classList.toggle('hidden', Boolean(record));
    this.ui.selectedName.textContent = record?.item.name ?? '尚未选择物件';
    const ownership = record ? lobbyObjectOwnership(record.state, this.ownerId) : null;
    const claim = record?.state.plotId ? this.plots.get(record.state.plotId) : null;
    const ownerLabel = ownership === 'system'
      ? '系统物件 · 不可编辑'
      : record?.state.plotId
        ? claim?.ownerId === this.ownerId
          ? '我的家园物件 · 仅你可编辑与删除'
          : `${claim?.ownerNickname ?? '其他玩家'}的家园 · 受领地保护`
        : classifyLobbyLocation(record?.state.position.x ?? 0, record?.state.position.z ?? 0).kind === 'invalid'
          ? '兼容保留的公共物件 · 频道成员可共同编辑'
          : '公共区物件 · 频道成员可共同移动与删除';
    this.ui.selectedMeta.textContent = record
      ? isPendingLobbyObjectId(record.state.id)
        ? '创建中 · 等待服务器确认'
        : `X ${record.state.position.x.toFixed(1)} · Z ${record.state.position.z.toFixed(1)} · ${Math.round(THREE.MathUtils.radToDeg(record.state.rotationY))}° · ${record.state.scale.toFixed(1)}× · ${ownerLabel}`
      : '拖动目录卡片到地面，或点击“添加”';
    for (const button of [this.ui.rotateLeft, this.ui.rotateRight, this.ui.scaleDown, this.ui.scaleUp]) {
      button.disabled = !record
        || !this.isRecordEditable(record)
        || this.objectMutationQueues.has(record.state.id);
    }
    this.ui.delete.disabled = !record || !this.isRecordDeletable(record);
    this.ui.delete.title = !record
      ? '请先选择物件'
      : this.isRecordDeletable(record)
        ? '从当前频道删除这个物件'
        : this.protectedObjectMessage(record);
  }

  private requireChannel(): string {
    if (!this.channel) throw new Error('Lobby channel has not been selected');
    return this.channel;
  }

  private acceptsChannelPayload(value: unknown): boolean {
    if (!value || typeof value !== 'object') return true;
    const record = value as Record<string, unknown>;
    const nested = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : null;
    const raw = record.channel ?? record.lobbyChannel ?? nested?.channel ?? nested?.lobbyChannel;
    if (raw === undefined || raw === null) return true;
    const channel = normalizeLobbyChannel(raw);
    return Boolean(channel && channel === this.channel);
  }

  private setSync(value: LobbySyncState): void {
    this.sync = value;
    this.updateUi();
  }

  private isRecordEditable(record: LobbyObjectRecord): boolean {
    if (record.item.realmSpace) return false;
    const claim = record.state.plotId ? this.plots.get(record.state.plotId) ?? null : null;
    return canEditLobbyObjectForOwner(record.state, this.ownerId, claim)
      && !isPendingLobbyObjectId(record.state.id)
      && !this.pendingDeletes.has(record.state.id)
      && !this.runtimeVehicleIsOccupied(record.state.id);
  }

  private runtimeVehicleIsOccupied(objectId: string): boolean {
    const runtime = this.runtimeVehicles.get(objectId);
    return Boolean(runtime && runtime.driverId !== null);
  }

  private idleVehicleRuntimePose(objectId: string): LobbyVehicleRuntimePose | null {
    const runtime = this.runtimeVehicles.get(objectId);
    return runtime?.driverId === null ? runtime : null;
  }

  private updateIdleVehicleRuntimePose(
    objectId: string,
    patch: Partial<Pick<LobbyVehicleRuntimePose, 'x' | 'y' | 'z' | 'yaw'>>,
    authoritative = false,
  ): void {
    const runtime = this.idleVehicleRuntimePose(objectId);
    if (!runtime) return;
    this.runtimeVehicles.set(objectId, { ...runtime, ...patch });
    if (authoritative && Object.keys(patch).length > 0) this.bumpRuntimeVehicleGeneration(objectId);
  }

  private bumpRuntimeVehicleGeneration(objectId: string): void {
    this.runtimeVehicleGenerations.set(
      objectId,
      (this.runtimeVehicleGenerations.get(objectId) ?? 0) + 1,
    );
  }

  private captureTransformSnapshot(record: LobbyObjectRecord): LobbyObjectTransformSnapshot {
    const runtime = this.idleVehicleRuntimePose(record.state.id);
    return {
      position: { ...record.state.position },
      rotationY: record.state.rotationY,
      scale: record.state.scale,
      plotId: record.state.plotId,
      revision: record.state.revision,
      runtimeVehicle: runtime ? {
        x: runtime.x,
        y: runtime.y,
        z: runtime.z,
        yaw: runtime.yaw,
        generation: this.runtimeVehicleGenerations.get(record.state.id) ?? 0,
      } : null,
    };
  }

  private restoreTransformSnapshot(
    record: LobbyObjectRecord,
    snapshot: LobbyObjectTransformSnapshot,
  ): void {
    if (this.records.get(record.state.id) !== record) return;
    if (record.state.revision === snapshot.revision) {
      record.state.position = { ...snapshot.position };
      record.state.rotationY = snapshot.rotationY;
      record.state.scale = snapshot.scale;
      record.state.plotId = snapshot.plotId;
    }
    const runtime = this.idleVehicleRuntimePose(record.state.id);
    if (
      runtime
      && snapshot.runtimeVehicle
      && (this.runtimeVehicleGenerations.get(record.state.id) ?? 0) === snapshot.runtimeVehicle.generation
    ) {
      this.runtimeVehicles.set(record.state.id, {
        ...runtime,
        x: snapshot.runtimeVehicle.x,
        y: snapshot.runtimeVehicle.y,
        z: snapshot.runtimeVehicle.z,
        yaw: snapshot.runtimeVehicle.yaw,
      });
    }
    this.applyTransform(record);
    this.updateUi();
  }

  private isRecordDeletable(record: LobbyObjectRecord): boolean {
    return this.isRecordEditable(record)
      && !this.objectMutationQueues.has(record.state.id)
      && canDeleteLobbyObject(record.state, this.ownerId);
  }
}
