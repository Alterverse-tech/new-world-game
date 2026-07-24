import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  avatarAnimationCompatibility,
  isWhiteRoomStandardAvatarRig,
  resolveUploadedAvatarAnimationClips,
  type SharedAvatarAnimationClips,
} from './avatar-animation';
import { avatarPresetById, isBuiltInAvatarId } from './avatar-presets';
import {
  isLobbyChannelProtocolName,
  LEGACY_LOBBY_CHANNEL,
  lobbyChannelProtocolName,
  normalizeLobbyChannel,
} from './lobby-channel';
import type { Collider } from './types';
import { LOBBY_WORLD_LIMIT } from './lobby-neighborhood';
import type { LobbyVehicleCapability } from './lobby-props/types';
import {
  PlayerTelemetryController,
  detectPlayerRegion,
  normalizePlayerTelemetry,
  renderPlayerStats,
  type PlayerActivity,
  type PlayerTelemetry,
} from './player-telemetry';

const CLIENT_ID_KEY = 'wr.lobby.client.v1';
const DEFAULT_IDLE_URL = '/generated-assets/whiteroom-default-avatar-idle.glb';
const DEFAULT_WALK_URL = '/generated-assets/whiteroom-default-avatar-walk.glb';
const POSE_INTERVAL = 0.1;
const PROFILE_DEBOUNCE_MS = 180;
const PROFILE_MIN_INTERVAL_MS = 500;
const MAX_PEERS = 96;
export const VEHICLE_LEASE_FEATURE = 'vehicle-lease-v1';
export const VEHICLE_AUTOLAND_FEATURE = 'vehicle-autoland-v1';
const VEHICLE_OBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const VEHICLE_LEASE_ID_PATTERN = /^lease-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AVATAR_POSE_SIGNATURE_BONES = ['Pelvis', 'L_Thigh', 'R_Thigh', 'L_Upperarm', 'R_Upperarm'] as const;
export const THIRD_PERSON_AVATAR_CENTER_HEIGHT = 0.875;
export const THIRD_PERSON_CAMERA_DISTANCE = 2.45;
export const THIRD_PERSON_MIN_CAMERA_DISTANCE = 1.75;
export const THIRD_PERSON_MAX_CAMERA_DISTANCE = 5.5;
const THIRD_PERSON_BASE_PITCH = THREE.MathUtils.degToRad(-24);
const THIRD_PERSON_MIN_PITCH = THREE.MathUtils.degToRad(-58);
const THIRD_PERSON_MAX_PITCH = THREE.MathUtils.degToRad(-10);
const THIRD_PERSON_ZOOM_DAMPING = 12;
const THIRD_PERSON_WHEEL_METERS_PER_PIXEL = 0.0025;
type NetworkPoseBounds = Readonly<Record<'x' | 'y' | 'z', readonly [number, number]>>;
const LEVEL_NETWORK_BOUNDS: NetworkPoseBounds = Object.freeze({ x: [-40, 40], y: [-2, 12], z: [-40, 40] });

export type LobbyViewMode = 'first' | 'third';

export interface AvatarProfile {
  name: string;
  avatarId: string;
}

export interface LobbyPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  seq?: number;
  timestamp?: number;
}

export type LobbyVehicleKind = 'car' | 'aircraft';

export interface LobbyVehicleSnapshot {
  objectId: string;
  catalogId: string;
  kind: LobbyVehicleKind;
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
  timestamp: number;
  recovering?: true;
}

export interface LobbyVehicleStateCommand {
  objectId: string;
  leaseId: string;
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
}

export type LobbyVehicleReleaseReason =
  | 'exit'
  | 'disconnect'
  | 'timeout'
  | 'party'
  | 'return_lobby'
  | 'server_shutdown';

export type LobbyVehicleRecoveryReason = 'timeout' | 'state_loss' | 'disconnect' | 'party' | 'return_lobby';

export function vehicleErrorRequiresRecovery(code: string): boolean {
  return code === 'vehicle_lease_rejected' || code === 'vehicle_state_rejected';
}

export type LobbyVehicleEvent =
  | { type: 'snapshot'; vehicles: LobbyVehicleSnapshot[] }
  | { type: 'entered'; leaseId: string; vehicle: LobbyVehicleSnapshot }
  | { type: 'claimed'; vehicle: LobbyVehicleSnapshot }
  | { type: 'state'; vehicle: LobbyVehicleSnapshot }
  | {
    type: 'recovery';
    reason: LobbyVehicleRecoveryReason;
    driverId: string;
    vehicle: LobbyVehicleSnapshot;
    local?: true;
  }
  | {
    type: 'released';
    reason: LobbyVehicleReleaseReason;
    driverId: string;
    vehicle: LobbyVehicleSnapshot;
  }
  | { type: 'error'; code: string };

export interface LobbyVehicleStateMessage extends LobbyVehicleStateCommand {
  type: 'vehicle_state';
}

export interface LobbyVehicleExitMessage {
  type: 'vehicle_exit';
  objectId: string;
  leaseId: string;
  seq: number;
}

export interface LobbyVehicleRecoverMessage {
  type: 'vehicle_recover';
  objectId: string;
  leaseId: string;
}

export function serializeMultiplayerPose(pose: LobbyPose, levelMode: boolean): LobbyPose {
  const coordinate = (value: number, axis: keyof NetworkPoseBounds): number => {
    const finiteValue = Number.isFinite(value) ? value : 0;
    const serialized = levelMode
      ? THREE.MathUtils.clamp(finiteValue, LEVEL_NETWORK_BOUNDS[axis][0], LEVEL_NETWORK_BOUNDS[axis][1])
      : finiteValue;
    return Number(serialized.toFixed(3));
  };
  return {
    x: coordinate(pose.x, 'x'),
    y: coordinate(pose.y, 'y'),
    z: coordinate(pose.z, 'z'),
    yaw: serializeLobbyYaw(pose.yaw),
    moving: pose.moving,
  };
}

export interface LobbyPlayerSnapshot extends AvatarProfile, LobbyPose {
  id: string;
  telemetry?: PlayerTelemetry;
}

export interface LobbyPartyInvite {
  partyId: string;
  leader: { id: string; name: string; avatarId: string };
  levelId: string;
  levelVersion: string;
  startsAt: string;
  maxMembers: number;
}

export interface LobbyPartyState {
  partyId: string;
  leaderId: string;
  levelId: string;
  levelVersion: string;
  startsAt: string;
  members: Array<{ id: string; name: string; avatarId: string }>;
  maxMembers: number;
}

export interface LobbyPartyLaunch {
  partyId: string;
  levelId: string;
  levelVersion: string;
}

export interface LobbyMultiplayerTextState {
  connected: boolean;
  online: number;
  view: LobbyViewMode;
  self: {
    id: string;
    name: string;
    avatarId: string | null;
    x: number;
    y: number;
    z: number;
    yaw: number;
    moving: boolean;
    avatarAnimationMode: 'standing' | 'running';
    avatarAnimationClip: string | null;
    avatarAnimationSource: 'clip' | 'procedural';
    avatarAnimationTime: number;
    avatarAnimationPoseSignature: string | null;
    visible: boolean;
    vehicle: { objectId: string; kind: LobbyVehicleKind; seq: number } | null;
  };
  remote: Array<{
    id: string;
    name: string;
    avatarId: string | null;
    x: number;
    y: number;
    z: number;
    yaw: number;
    moving: boolean;
    avatarAnimationMode: 'standing' | 'running';
    avatarAnimationClip: string | null;
    avatarAnimationSource: 'clip' | 'procedural';
    avatarAnimationTime: number;
    avatarAnimationPoseSignature: string | null;
    visible: boolean;
    vehicle: { objectId: string; kind: LobbyVehicleKind; seq: number } | null;
  }>;
  vehicles: Array<{
    objectId: string;
    catalogId: string;
    kind: LobbyVehicleKind;
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
    recovering: boolean;
  }>;
  resources: {
    customRemoteSlots: number;
    cachedAssets: number;
    referencedAssets: number;
    activeLoads: number;
    pendingProfileSync: boolean;
    vehicleLeaseSupported: boolean;
    vehicleAutolandSupported: boolean;
  };
  party: {
    lobbyChannel: string;
    channel: string;
    activePartyId: string | null;
    invite: LobbyPartyInvite | null;
    forming: LobbyPartyState | null;
  };
}

type MultiplayerMessage =
  | {
    type: 'welcome';
    selfId: string | null;
    channel: string;
    players: LobbyPlayerSnapshot[];
    online: number | null;
    features?: string[];
    vehicles?: LobbyVehicleSnapshot[];
  }
  | { type: 'join'; player: LobbyPlayerSnapshot; online: number | null }
  | { type: 'pose'; player: LobbyPlayerSnapshot }
  | { type: 'profile'; id: string; name: string; avatarId: string }
  | { type: 'telemetry'; id: string; telemetry: PlayerTelemetry }
  | { type: 'telemetry_pong'; nonce: number }
  | { type: 'error'; code: string; retryAfterMs: number | null }
  | { type: 'leave'; id: string; online: number | null }
  | { type: 'party_invite'; invite: LobbyPartyInvite }
  | { type: 'party_state'; party: LobbyPartyState }
  | { type: 'party_launch'; launch: LobbyPartyLaunch }
  | { type: 'party_cancelled'; partyId: string; reason: string }
  | {
    type: 'channel_snapshot';
    channel: string;
    players: LobbyPlayerSnapshot[];
    online: number | null;
    features?: string[];
    vehicles?: LobbyVehicleSnapshot[];
  }
  | { type: 'vehicle_entered'; leaseId: string; vehicle: LobbyVehicleSnapshot }
  | { type: 'vehicle_snapshot'; vehicles: LobbyVehicleSnapshot[] }
  | { type: 'vehicle_claimed'; vehicle: LobbyVehicleSnapshot }
  | { type: 'vehicle_state'; vehicle: LobbyVehicleSnapshot }
  | {
    type: 'vehicle_recovery';
    reason: LobbyVehicleRecoveryReason;
    driverId: string;
    vehicle: LobbyVehicleSnapshot;
  }
  | {
    type: 'vehicle_released';
    reason: LobbyVehicleReleaseReason;
    driverId: string;
    vehicle: LobbyVehicleSnapshot;
  };

interface AvatarActor {
  id: string;
  profile: AvatarProfile;
  group: THREE.Group;
  visual: THREE.Object3D;
  label: THREE.Sprite;
  current: THREE.Vector3;
  target: THREE.Vector3;
  currentYaw: number;
  targetYaw: number;
  moving: boolean;
  lastSeq: number;
  lastTimestamp: number;
  mixer: THREE.AnimationMixer | null;
  idleAction: THREE.AnimationAction | null;
  walkAction: THREE.AnimationAction | null;
  idlePoseTime: number | null;
  animationMoving: boolean;
  procedural: boolean;
  limbs: { leftArm: THREE.Object3D; rightArm: THREE.Object3D; leftLeg: THREE.Object3D; rightLeg: THREE.Object3D } | null;
  visualBaseY: number;
  animationTime: number;
  loadToken: number;
  customSlot: boolean;
  assetKey: string | null;
  self: boolean;
}

function actorAnimationText(actor: AvatarActor): {
  avatarAnimationMode: 'standing' | 'running';
  avatarAnimationClip: string | null;
  avatarAnimationSource: 'clip' | 'procedural';
  avatarAnimationTime: number;
  avatarAnimationPoseSignature: string | null;
} {
  const action = actor.animationMoving ? actor.walkAction : actor.idleAction;
  const poseValues: string[] = [];
  for (const name of AVATAR_POSE_SIGNATURE_BONES) {
    const bone = actor.visual.getObjectByName(name) as THREE.Bone | undefined;
    if (!bone?.isBone) continue;
    poseValues.push(`${name}:${[bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w]
      .map((value) => value.toFixed(3)).join(',')}`);
  }
  return {
    avatarAnimationMode: actor.animationMoving ? 'running' : 'standing',
    avatarAnimationClip: action?.getClip().name ?? null,
    avatarAnimationSource: action ? 'clip' : 'procedural',
    avatarAnimationTime: Number((action?.time ?? actor.animationTime).toFixed(3)),
    avatarAnimationPoseSignature: poseValues.length === AVATAR_POSE_SIGNATURE_BONES.length
      ? poseValues.join('|')
      : null,
  };
}

interface AvatarAsset {
  gltf: GLTF;
  clips: THREE.AnimationClip[];
}

interface AvatarCacheEntry {
  promise: Promise<AvatarAsset>;
  refs: number;
  lastUsed: number;
  settled: boolean;
}

export interface LobbyMultiplayerOptions {
  profile: AvatarProfile;
  view: LobbyViewMode;
  cameraDistance: number;
  reducedMotion: boolean;
  lobbyChannel?: string;
  onViewChanged?: (view: LobbyViewMode) => void;
  onPartyInvite?: (invite: LobbyPartyInvite | null) => void;
  onPartyState?: (party: LobbyPartyState | null) => void;
  onPartyLaunch?: (launch: LobbyPartyLaunch) => void;
  onPartyNotice?: (code: string) => void;
  onVehicleEvent?: (event: LobbyVehicleEvent) => void;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validClientId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value);
}

function validVehicleObjectId(value: unknown): value is string {
  return typeof value === 'string' && VEHICLE_OBJECT_ID_PATTERN.test(value);
}

function validVehicleLeaseId(value: unknown): value is string {
  return typeof value === 'string' && VEHICLE_LEASE_ID_PATTERN.test(value);
}

function validVehicleSequence(value: unknown, allowZero = false): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= (allowZero ? 0 : 1)
    && (value as number) < Number.MAX_SAFE_INTEGER;
}

function exactKeys(record: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

const VEHICLE_SNAPSHOT_KEYS = new Set([
  'objectId', 'catalogId', 'kind', 'driverId',
  'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz', 'seq', 'timestamp',
]);
const VEHICLE_STATE_COMMAND_KEYS = new Set([
  'objectId', 'leaseId', 'seq',
  'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz',
]);
const VEHICLE_RELEASE_REASONS = new Set<LobbyVehicleReleaseReason>([
  'exit', 'disconnect', 'timeout', 'party', 'return_lobby', 'server_shutdown',
]);
const VEHICLE_RECOVERY_REASONS = new Set<LobbyVehicleRecoveryReason>([
  'timeout', 'state_loss', 'disconnect', 'party', 'return_lobby',
]);

function exactFinite(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function vehicleSnapshotFrom(value: unknown): LobbyVehicleSnapshot | null {
  const record = recordOf(value);
  if (!record) return null;
  const hasRecovering = Object.hasOwn(record, 'recovering');
  const expectedKeys = hasRecovering
    ? new Set([...VEHICLE_SNAPSHOT_KEYS, 'recovering'])
    : VEHICLE_SNAPSHOT_KEYS;
  if (!exactKeys(record, expectedKeys) || (hasRecovering && record.recovering !== true)) return null;
  if (!validVehicleObjectId(record.objectId) || !validVehicleObjectId(record.catalogId)) return null;
  if (record.kind !== 'car' && record.kind !== 'aircraft') return null;
  if (record.driverId !== null && !validClientId(record.driverId)) return null;
  if (!validVehicleSequence(record.seq, true)) return null;
  const timestamp = exactFinite(record, 'timestamp');
  if (timestamp === null || timestamp < 0) return null;
  const x = exactFinite(record, 'x');
  const y = exactFinite(record, 'y');
  const z = exactFinite(record, 'z');
  const yaw = exactFinite(record, 'yaw');
  const pitch = exactFinite(record, 'pitch');
  const roll = exactFinite(record, 'roll');
  const vx = exactFinite(record, 'vx');
  const vy = exactFinite(record, 'vy');
  const vz = exactFinite(record, 'vz');
  if ([x, y, z, yaw, pitch, roll, vx, vy, vz].some((number) => number === null)) return null;
  if (record.kind === 'car' && (
    x! < -LOBBY_WORLD_LIMIT || x! > LOBBY_WORLD_LIMIT
    || z! < -LOBBY_WORLD_LIMIT || z! > LOBBY_WORLD_LIMIT
    || y! < 0 || y! > 1.5
  )) return null;
  if (record.kind === 'aircraft' && y! < 0) return null;
  if ([yaw!, pitch!, roll!].some((angle) => angle < -Math.PI || angle > Math.PI)) return null;
  return {
    objectId: record.objectId,
    catalogId: record.catalogId,
    kind: record.kind,
    driverId: record.driverId,
    x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, roll: roll!, vx: vx!, vy: vy!, vz: vz!,
    seq: record.seq,
    timestamp,
    ...(hasRecovering ? { recovering: true as const } : {}),
  };
}

function vehicleListFrom(value: unknown): LobbyVehicleSnapshot[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .slice(0, 256)
    .map((entry) => vehicleSnapshotFrom(entry))
    .filter((entry): entry is LobbyVehicleSnapshot => Boolean(entry));
}

function exactVehicleListFrom(value: unknown): LobbyVehicleSnapshot[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const vehicles = value.map((entry) => vehicleSnapshotFrom(entry));
  if (vehicles.some((entry) => entry === null)) return null;
  const parsed = vehicles as LobbyVehicleSnapshot[];
  return new Set(parsed.map((vehicle) => vehicle.objectId)).size === parsed.length ? parsed : null;
}

function featureListFrom(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((feature): feature is string => (
    typeof feature === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(feature)
  )))].slice(0, 32);
}

export function serializeVehicleStateMessage(value: unknown): LobbyVehicleStateMessage | null {
  const record = recordOf(value);
  if (!record || !exactKeys(record, VEHICLE_STATE_COMMAND_KEYS)) return null;
  if (
    !validVehicleObjectId(record.objectId)
    || !validVehicleLeaseId(record.leaseId)
    || !validVehicleSequence(record.seq)
  ) return null;
  const numbers = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz'] as const;
  const serialized = Object.fromEntries(numbers.map((key) => [key, exactFinite(record, key)]));
  if (numbers.some((key) => serialized[key] === null)) return null;
  if (['yaw', 'pitch', 'roll'].some((key) => Math.abs(serialized[key]!) > Math.PI)) return null;
  return {
    type: 'vehicle_state',
    objectId: record.objectId,
    leaseId: record.leaseId,
    seq: record.seq,
    x: serialized.x!,
    y: serialized.y!,
    z: serialized.z!,
    yaw: serialized.yaw!,
    pitch: serialized.pitch!,
    roll: serialized.roll!,
    vx: serialized.vx!,
    vy: serialized.vy!,
    vz: serialized.vz!,
  };
}

export function serializeVehicleExitMessage(
  objectId: unknown,
  leaseId: unknown,
  seq: unknown,
): LobbyVehicleExitMessage | null {
  return validVehicleObjectId(objectId) && validVehicleLeaseId(leaseId) && validVehicleSequence(seq)
    ? { type: 'vehicle_exit', objectId, leaseId, seq }
    : null;
}

export function serializeVehicleRecoverMessage(
  objectId: unknown,
  leaseId: unknown,
): LobbyVehicleRecoverMessage | null {
  return validVehicleObjectId(objectId) && validVehicleLeaseId(leaseId)
    ? { type: 'vehicle_recover', objectId, leaseId }
    : null;
}

function validPartyId(value: unknown): value is string {
  return typeof value === 'string' && /^party-[0-9a-f-]{36}$/i.test(value);
}

function validLevelId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(value);
}

function validLevelVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value);
}

function validIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function normalizeAvatarId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const id = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{8,63}$/.test(id) ? id : '';
}

export function sanitizeNickname(value: unknown, fallback = '访客'): string {
  if (typeof value !== 'string') return fallback;
  const clean = [...value]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return clean || fallback;
}

export function avatarModelUrl(avatarId: string): string {
  const normalized = normalizeAvatarId(avatarId);
  const preset = avatarPresetById(normalized);
  return preset?.modelUrl ?? `/avatars/${encodeURIComponent(normalized)}/avatar.glb`;
}

export function buildLobbyWebSocketUrl(
  baseUri: string,
  clientId: string,
  profile: AvatarProfile,
  partyId: string | null = null,
  lobbyChannel = LEGACY_LOBBY_CHANNEL,
): string {
  const url = new URL('/api/lobby/multiplayer', baseUri);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = '';
  url.searchParams.set('clientId', clientId);
  url.searchParams.set('avatarId', normalizeAvatarId(profile.avatarId));
  url.searchParams.set('name', sanitizeNickname(profile.name));
  url.searchParams.set('channel', normalizeLobbyChannel(lobbyChannel) ?? LEGACY_LOBBY_CHANNEL);
  if (partyId) url.searchParams.set('partyId', partyId);
  return url.toString();
}

function normalizeAngle(value: number): number {
  const full = Math.PI * 2;
  return ((value + Math.PI) % full + full) % full - Math.PI;
}

export function interpolateYaw(from: number, to: number, alpha: number): number {
  return normalizeAngle(from + normalizeAngle(to - from) * THREE.MathUtils.clamp(alpha, 0, 1));
}

export function serializeLobbyYaw(value: number): number {
  const rounded = Number(normalizeAngle(finite(value)).toFixed(4));
  return THREE.MathUtils.clamp(rounded, -Math.PI, Math.PI);
}

export function thirdPersonCameraTarget(playerPosition: THREE.Vector3): THREE.Vector3 {
  return playerPosition.clone().add(new THREE.Vector3(0, THIRD_PERSON_AVATAR_CENTER_HEIGHT, 0));
}

export function thirdPersonOrbitPitch(viewPitch: number): number {
  return THREE.MathUtils.clamp(
    finite(viewPitch) + THIRD_PERSON_BASE_PITCH,
    THIRD_PERSON_MIN_PITCH,
    THIRD_PERSON_MAX_PITCH,
  );
}

export function normalizeThirdPersonCameraDistance(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, THIRD_PERSON_MIN_CAMERA_DISTANCE, THIRD_PERSON_MAX_CAMERA_DISTANCE)
    : THIRD_PERSON_CAMERA_DISTANCE;
}

/**
 * Keeps the player's saved zoom preference intact while giving unusually large
 * vehicles a camera arm that clears their silhouette. The horizontal bounding
 * circle is yaw-independent; the small clearance factor also compensates for
 * the orbit arm losing horizontal reach when it pitches upward.
 */
export function resolveLobbyVehicleThirdPersonCameraDistance(
  capability: Pick<LobbyVehicleCapability, 'collisionHalfExtents'>,
  requestedDistance: number,
): number {
  const requested = normalizeThirdPersonCameraDistance(requestedDistance);
  const [halfWidth, , halfDepth] = capability.collisionHalfExtents;
  const horizontalRadius = Math.hypot(Math.abs(halfWidth), Math.abs(halfDepth));
  const safeDistance = normalizeThirdPersonCameraDistance(horizontalRadius * 1.1);

  // Ordinary cars and aircraft retain the full existing zoom range. Only a
  // footprint whose safe camera arm exceeds the default receives a size floor.
  if (safeDistance <= THIRD_PERSON_CAMERA_DISTANCE) return requested;
  return Math.max(requested, safeDistance);
}

export function thirdPersonCameraDistanceFromWheel(
  currentDistance: number,
  deltaY: number,
  deltaMode = 0,
  viewportHeight = 800,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return normalizeThirdPersonCameraDistance(currentDistance);
  const modeScale = deltaMode === 1
    ? 40
    : deltaMode === 2
      ? Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 800)
      : 1;
  const pixelDelta = THREE.MathUtils.clamp(deltaY * modeScale, -120, 120);
  const next = normalizeThirdPersonCameraDistance(currentDistance) + pixelDelta * THIRD_PERSON_WHEEL_METERS_PER_PIXEL;
  return normalizeThirdPersonCameraDistance(next);
}

export function shouldAcceptLobbyPose(
  incoming: Pick<LobbyPose, 'seq' | 'timestamp'>,
  previous: Pick<LobbyPose, 'seq' | 'timestamp'>,
): boolean {
  if (incoming.seq !== undefined && previous.seq !== undefined) return incoming.seq > previous.seq;
  if (incoming.timestamp !== undefined && previous.timestamp !== undefined) return incoming.timestamp > previous.timestamp;
  return true;
}

function playerFrom(value: unknown, fallbackId?: string): LobbyPlayerSnapshot | null {
  const record = recordOf(value);
  if (!record) return null;
  const idValue = record.id ?? record.clientId ?? record.playerId ?? fallbackId;
  if (!validClientId(idValue)) return null;
  const position = recordOf(record.pose) ?? recordOf(record.position) ?? record;
  const seq = finite(position.seq ?? record.seq, Number.NaN);
  const timestamp = finite(position.timestamp ?? record.timestamp, Number.NaN);
  const telemetry = Object.hasOwn(record, 'telemetry')
    ? normalizePlayerTelemetry(record.telemetry)
    : undefined;
  return {
    id: idValue,
    name: sanitizeNickname(record.name),
    avatarId: normalizeAvatarId(record.avatarId),
    x: finite(position.x),
    y: finite(position.y),
    z: finite(position.z, 4),
    yaw: normalizeAngle(finite(position.yaw ?? record.yaw)),
    moving: (position.moving ?? record.moving) === true,
    ...(Number.isFinite(seq) ? { seq } : {}),
    ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    ...(telemetry ? { telemetry } : {}),
  };
}

function onlineFrom(record: Record<string, unknown>): number | null {
  const value = finite(record.online ?? record.onlineCount, Number.NaN);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(Math.floor(value), 0, 100_000) : null;
}

export function parseLobbyMultiplayerMessage(value: unknown): MultiplayerMessage | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const record = recordOf(parsed);
  if (!record || typeof record.type !== 'string') return null;
  if (record.type === 'telemetry') {
    if (!exactKeys(record, new Set(['type', 'id', 'fps', 'rttMs', 'state', 'region', 'updatedAt']))) return null;
    if (
      !validClientId(record.id)
      || typeof record.fps !== 'number'
      || !Number.isFinite(record.fps)
      || typeof record.rttMs !== 'number'
      || !Number.isFinite(record.rttMs)
      || typeof record.state !== 'string'
      || typeof record.region !== 'string'
      || typeof record.updatedAt !== 'number'
      || !Number.isFinite(record.updatedAt)
    ) return null;
    const telemetry = normalizePlayerTelemetry(record);
    if (telemetry.state !== record.state) return null;
    return { type: 'telemetry', id: record.id, telemetry };
  }
  if (record.type === 'telemetry_pong') {
    if (
      !exactKeys(record, new Set(['type', 'nonce', 'serverTime']))
      || !Number.isSafeInteger(record.nonce)
      || (record.nonce as number) < 1
      || typeof record.serverTime !== 'number'
      || !Number.isFinite(record.serverTime)
    ) return null;
    return { type: 'telemetry_pong', nonce: record.nonce as number };
  }
  if (record.type === 'welcome') {
    const features = Object.hasOwn(record, 'features') ? featureListFrom(record.features) : undefined;
    const vehicles = Object.hasOwn(record, 'vehicles') ? vehicleListFrom(record.vehicles) : undefined;
    if (features === null || vehicles === null) return null;
    const source = Array.isArray(record.players) ? record.players : [];
    const players = source.map((player) => playerFrom(player)).filter((player): player is LobbyPlayerSnapshot => Boolean(player));
    const selfIdValue = record.selfId ?? record.clientId ?? record.id;
    const channel = typeof record.channel === 'string' && (
      isLobbyChannelProtocolName(record.channel)
      || /^level:party-[0-9a-f-]{36}$/i.test(record.channel)
    )
      ? record.channel
      : lobbyChannelProtocolName(LEGACY_LOBBY_CHANNEL);
    return {
      type: 'welcome',
      selfId: validClientId(selfIdValue) ? selfIdValue : null,
      channel,
      players,
      online: onlineFrom(record),
      ...(features ? { features } : {}),
      ...(vehicles ? { vehicles } : {}),
    };
  }
  if (record.type === 'join' || record.type === 'player') {
    const player = playerFrom(record.player ?? record);
    return player ? { type: 'join', player, online: onlineFrom(record) } : null;
  }
  if (record.type === 'pose') {
    const nested = recordOf(record.player);
    const idValue = record.id ?? record.clientId ?? record.playerId ?? nested?.id ?? nested?.clientId;
    const player = playerFrom(record.player ?? record, validClientId(idValue) ? idValue : undefined);
    return player ? { type: 'pose', player } : null;
  }
  if (record.type === 'profile') {
    const source = recordOf(record.player) ?? record;
    const idValue = source.id ?? source.clientId ?? record.id ?? record.clientId;
    if (!validClientId(idValue)) return null;
    return {
      type: 'profile',
      id: idValue,
      name: sanitizeNickname(source.name),
      avatarId: normalizeAvatarId(source.avatarId),
    };
  }
  if (record.type === 'error' && typeof record.code === 'string') {
    const retryAfterMs = finite(record.retryAfterMs, Number.NaN);
    return {
      type: 'error',
      code: record.code.slice(0, 64),
      retryAfterMs: Number.isFinite(retryAfterMs) ? THREE.MathUtils.clamp(Math.round(retryAfterMs), 1, 30_000) : null,
    };
  }
  if (record.type === 'vehicle_snapshot') {
    if (!exactKeys(record, new Set(['type', 'vehicles']))) return null;
    const vehicles = exactVehicleListFrom(record.vehicles);
    return vehicles ? { type: 'vehicle_snapshot', vehicles } : null;
  }
  if (record.type === 'vehicle_entered') {
    if (!exactKeys(record, new Set(['type', 'leaseId', 'vehicle'])) || !validVehicleLeaseId(record.leaseId)) return null;
    const vehicle = vehicleSnapshotFrom(record.vehicle);
    return vehicle && vehicle.driverId
      ? { type: 'vehicle_entered', leaseId: record.leaseId, vehicle }
      : null;
  }
  if (record.type === 'vehicle_claimed' || record.type === 'vehicle_state') {
    if (!exactKeys(record, new Set(['type', 'vehicle']))) return null;
    const vehicle = vehicleSnapshotFrom(record.vehicle);
    if (!vehicle || !vehicle.driverId) return null;
    return record.type === 'vehicle_claimed'
      ? { type: 'vehicle_claimed', vehicle }
      : { type: 'vehicle_state', vehicle };
  }
  if (record.type === 'vehicle_recovery') {
    if (!exactKeys(record, new Set(['type', 'reason', 'driverId', 'vehicle']))) return null;
    const vehicle = vehicleSnapshotFrom(record.vehicle);
    if (
      !vehicle?.recovering
      || !validClientId(record.driverId)
      || vehicle.driverId !== record.driverId
      || typeof record.reason !== 'string'
      || !VEHICLE_RECOVERY_REASONS.has(record.reason as LobbyVehicleRecoveryReason)
    ) return null;
    return {
      type: 'vehicle_recovery',
      reason: record.reason as LobbyVehicleRecoveryReason,
      driverId: record.driverId,
      vehicle,
    };
  }
  if (record.type === 'vehicle_released') {
    if (!exactKeys(record, new Set(['type', 'reason', 'driverId', 'vehicle']))) return null;
    const vehicle = vehicleSnapshotFrom(record.vehicle);
    if (
      !vehicle
      || vehicle.driverId !== null
      || vehicle.recovering
      || !validClientId(record.driverId)
      || typeof record.reason !== 'string'
      || !VEHICLE_RELEASE_REASONS.has(record.reason as LobbyVehicleReleaseReason)
    ) return null;
    return {
      type: 'vehicle_released',
      reason: record.reason as LobbyVehicleReleaseReason,
      driverId: record.driverId,
      vehicle,
    };
  }
  if (record.type === 'party_invite') {
    const leader = recordOf(record.leader);
    if (
      !validPartyId(record.partyId)
      || !leader
      || !validClientId(leader.id)
      || !validLevelId(record.levelId)
      || !validLevelVersion(record.levelVersion)
      || !validIsoTime(record.startsAt)
    ) return null;
    return {
      type: 'party_invite',
      invite: {
        partyId: record.partyId,
        leader: {
          id: leader.id,
          name: sanitizeNickname(leader.name),
          avatarId: normalizeAvatarId(leader.avatarId),
        },
        levelId: record.levelId,
        levelVersion: record.levelVersion,
        startsAt: record.startsAt,
        maxMembers: THREE.MathUtils.clamp(Math.floor(finite(record.maxMembers, 4)), 2, 4),
      },
    };
  }
  if (record.type === 'party_state') {
    if (
      !validPartyId(record.partyId)
      || !validClientId(record.leaderId)
      || !validLevelId(record.levelId)
      || !validLevelVersion(record.levelVersion)
      || !validIsoTime(record.startsAt)
      || !Array.isArray(record.members)
    ) return null;
    const members = record.members.slice(0, 4).map((value) => {
      const member = recordOf(value);
      return member && validClientId(member.id)
        ? { id: member.id, name: sanitizeNickname(member.name), avatarId: normalizeAvatarId(member.avatarId) }
        : null;
    }).filter((member): member is { id: string; name: string; avatarId: string } => Boolean(member));
    if (!members.some((member) => member.id === record.leaderId)) return null;
    return {
      type: 'party_state',
      party: {
        partyId: record.partyId,
        leaderId: record.leaderId,
        levelId: record.levelId,
        levelVersion: record.levelVersion,
        startsAt: record.startsAt,
        members,
        maxMembers: THREE.MathUtils.clamp(Math.floor(finite(record.maxMembers, 4)), 2, 4),
      },
    };
  }
  if (record.type === 'party_launch') {
    if (!validPartyId(record.partyId) || !validLevelId(record.levelId) || !validLevelVersion(record.levelVersion)) return null;
    return {
      type: 'party_launch',
      launch: { partyId: record.partyId, levelId: record.levelId, levelVersion: record.levelVersion },
    };
  }
  if (record.type === 'party_cancelled') {
    if (!validPartyId(record.partyId)) return null;
    return {
      type: 'party_cancelled',
      partyId: record.partyId,
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 40) : 'cancelled',
    };
  }
  if (record.type === 'channel_snapshot') {
    if (typeof record.channel !== 'string' || !(
      isLobbyChannelProtocolName(record.channel)
      || /^level:party-[0-9a-f-]{36}$/i.test(record.channel)
    )) return null;
    const features = Object.hasOwn(record, 'features') ? featureListFrom(record.features) : undefined;
    const vehicles = Object.hasOwn(record, 'vehicles') ? vehicleListFrom(record.vehicles) : undefined;
    if (features === null || vehicles === null) return null;
    const source = Array.isArray(record.players) ? record.players : [];
    const players = source.map((player) => playerFrom(player)).filter((player): player is LobbyPlayerSnapshot => Boolean(player));
    return {
      type: 'channel_snapshot',
      channel: record.channel,
      players,
      online: onlineFrom(record),
      ...(features ? { features } : {}),
      ...(vehicles ? { vehicles } : {}),
    };
  }
  if (record.type === 'leave') {
    const source = recordOf(record.player) ?? record;
    const idValue = source.id ?? source.clientId ?? source.playerId;
    return validClientId(idValue) ? { type: 'leave', id: idValue, online: onlineFrom(record) } : null;
  }
  return null;
}

export function resolveThirdPersonCameraPosition(
  playerPosition: THREE.Vector3,
  yaw: number,
  pitch: number,
  colliders: ReadonlyArray<Pick<Collider, 'box'>>,
  cameraDistance = THIRD_PERSON_CAMERA_DISTANCE,
): THREE.Vector3 {
  const target = thirdPersonCameraTarget(playerPosition);
  const orbitPitch = thirdPersonOrbitPitch(pitch);
  const distance = normalizeThirdPersonCameraDistance(cameraDistance);
  const horizontalDistance = Math.cos(orbitPitch) * distance;
  const desired = target.clone().add(new THREE.Vector3(
    Math.sin(yaw) * horizontalDistance,
    -Math.sin(orbitPitch) * distance,
    Math.cos(yaw) * horizontalDistance,
  ));
  const delta = desired.clone().sub(target);
  const desiredDistance = delta.length();
  if (desiredDistance <= 0.001) return desired;
  const direction = delta.normalize();
  const ray = new THREE.Ray(target, direction);
  let allowedDistance = desiredDistance;
  const hit = new THREE.Vector3();
  for (const collider of colliders) {
    if (collider.box.isEmpty()) continue;
    const box = collider.box.clone().expandByScalar(0.12);
    if (box.containsPoint(target)) continue;
    if (!ray.intersectBox(box, hit)) continue;
    const distance = hit.distanceTo(target);
    if (distance < allowedDistance) {
      const clearance = Math.min(0.18, distance * 0.5);
      allowedDistance = Math.max(0, Math.min(allowedDistance, distance - clearance));
    }
  }
  return target.addScaledVector(direction, allowedDistance);
}

export function lobbyPlayerEyePosition(playerPosition: THREE.Vector3): THREE.Vector3 {
  return playerPosition.clone().add(new THREE.Vector3(0, 1.62, 0));
}

export function lobbyNicknameLabelVisible(isSelf: boolean): boolean {
  void isSelf;
  return true;
}

function createNicknameSprite(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(20, 27, 28, 0.78)';
    context.beginPath();
    context.moveTo(42, 18);
    context.lineTo(470, 18);
    context.quadraticCurveTo(494, 18, 494, 42);
    context.lineTo(494, 86);
    context.quadraticCurveTo(494, 110, 470, 110);
    context.lineTo(42, 110);
    context.quadraticCurveTo(18, 110, 18, 86);
    context.lineTo(18, 42);
    context.quadraticCurveTo(18, 18, 42, 18);
    context.fill();
    context.fillStyle = '#f9fffd';
    context.font = '600 42px system-ui, -apple-system, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(sanitizeNickname(name), 256, 64, 420);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.position.y = 2.02;
  sprite.scale.set(1.08, 0.27, 1);
  sprite.renderOrder = 8;
  return sprite;
}

function limb(material: THREE.Material, radius: number, length: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 10), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createProceduralAvatar(): {
  root: THREE.Group;
  limbs: NonNullable<AvatarActor['limbs']>;
} {
  const root = new THREE.Group();
  root.name = 'AvatarLoadFallback';
  const shell = new THREE.MeshStandardMaterial({ color: '#d7d7d4', roughness: 0.78, metalness: 0 });
  const joint = new THREE.MeshStandardMaterial({ color: '#8e8e89', roughness: 0.82, metalness: 0 });

  const torso = limb(shell, 0.23, 0.48);
  torso.position.y = 1.12;
  torso.scale.set(1.05, 1, 0.72);
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 14), shell);
  head.position.y = 1.68;
  head.castShadow = true;
  root.add(head);

  const leftArm = limb(shell, 0.075, 0.47);
  const rightArm = limb(shell, 0.075, 0.47);
  leftArm.position.set(-0.32, 1.1, 0);
  rightArm.position.set(0.32, 1.1, 0);
  root.add(leftArm, rightArm);

  const leftLeg = limb(joint, 0.09, 0.48);
  const rightLeg = limb(joint, 0.09, 0.48);
  leftLeg.position.set(-0.13, 0.42, 0);
  rightLeg.position.set(0.13, 0.42, 0);
  root.add(leftLeg, rightLeg);

  return { root, limbs: { leftArm, rightArm, leftLeg, rightLeg } };
}

function disposeSprite(sprite: THREE.Sprite): void {
  const material = sprite.material;
  material.map?.dispose();
  material.dispose();
}

function disposeProcedural(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}

export class LobbyMultiplayer {
  private readonly loader = new GLTFLoader();
  private readonly assetCache = new Map<string, AvatarCacheEntry>();
  private sharedAvatarAnimationPromise: Promise<SharedAvatarAnimationClips> | null = null;
  private readonly avatarLoadQueue: Array<() => void> = [];
  private activeAvatarLoads = 0;
  private remoteCustomSlots = 0;
  private readonly peers = new Map<string, AvatarActor>();
  private readonly vehicles = new Map<string, LobbyVehicleSnapshot>();
  private readonly avatarsRoot = new THREE.Group();
  private readonly ui = {
    root: document.getElementById('multiplayer-hud'),
    online: document.getElementById('multiplayer-online'),
    channel: document.getElementById('multiplayer-channel'),
    view: document.getElementById('multiplayer-view'),
    viewHint: document.getElementById('multiplayer-view-hint'),
  };
  private readonly clientId = this.loadClientId();
  private profile: AvatarProfile;
  private view: LobbyViewMode;
  private readonly onViewChanged?: (view: LobbyViewMode) => void;
  private readonly onPartyInvite?: (invite: LobbyPartyInvite | null) => void;
  private readonly onPartyState?: (party: LobbyPartyState | null) => void;
  private readonly onPartyLaunch?: (launch: LobbyPartyLaunch) => void;
  private readonly onPartyNotice?: (code: string) => void;
  private readonly onVehicleEvent?: (event: LobbyVehicleEvent) => void;
  private selfActor: AvatarActor;
  private selfId: string;
  private socket: WebSocket | null = null;
  private readonly telemetry = this.createTelemetryController();
  private visibilityListening = false;
  private readonly visibilityListener = (): void => this.handleVisibilityChange();
  private disconnecting = false;
  private reconnectTimer = 0;
  private reconnectAttempt = 0;
  private connectionEpoch = 0;
  private profileRevision = 0;
  private connectionProfileRevision = 0;
  private pendingProfile: AvatarProfile | null = null;
  private profileSendTimer = 0;
  private lastProfileSentAt = Number.NEGATIVE_INFINITY;
  private active = false;
  private connected = false;
  private serverOnline: number | null = null;
  private lastPoseSentAt = Number.NEGATIVE_INFINITY;
  private lastSelfPose: LobbyPose = { x: 0, y: 0.02, z: 4.2, yaw: 0, moving: false };
  private cameraObstructed = false;
  private creativeCameraActive = false;
  private targetCameraDistance: number;
  private currentCameraDistance: number;
  private reducedMotion: boolean;
  private levelMode = false;
  private lobbyChannel: string;
  private channel: string;
  private activePartyId: string | null = null;
  private partyInvite: LobbyPartyInvite | null = null;
  private partyState: LobbyPartyState | null = null;
  private vehicleLeaseSupported = false;
  private vehicleAutolandSupported = false;
  private localVehicleLease: { objectId: string; leaseId: string } | null = null;
  private localVehicleSafetyHold = false;

  public constructor(options: LobbyMultiplayerOptions) {
    this.profile = {
      name: sanitizeNickname(options.profile.name),
      avatarId: normalizeAvatarId(options.profile.avatarId),
    };
    this.view = options.view;
    this.targetCameraDistance = normalizeThirdPersonCameraDistance(options.cameraDistance);
    this.currentCameraDistance = this.targetCameraDistance;
    this.reducedMotion = options.reducedMotion;
    this.lobbyChannel = normalizeLobbyChannel(options.lobbyChannel) ?? LEGACY_LOBBY_CHANNEL;
    this.channel = lobbyChannelProtocolName(this.lobbyChannel);
    this.onViewChanged = options.onViewChanged;
    this.onPartyInvite = options.onPartyInvite;
    this.onPartyState = options.onPartyState;
    this.onPartyLaunch = options.onPartyLaunch;
    this.onPartyNotice = options.onPartyNotice;
    this.onVehicleEvent = options.onVehicleEvent;
    this.selfId = this.clientId;
    this.avatarsRoot.name = 'LobbyPlayers';
    this.selfActor = this.createActor(this.clientId, this.profile, this.lastSelfPose, true);
    this.avatarsRoot.add(this.selfActor.group);
    this.selfActor.group.visible = false;
    window.addEventListener('beforeunload', () => this.disconnect(false), { once: true });
    this.refreshHud();
  }

  public attachHub(root: THREE.Object3D | null): void {
    if (!root) {
      this.avatarsRoot.removeFromParent();
      return;
    }
    if (this.avatarsRoot.parent !== root) root.add(this.avatarsRoot);
  }

  public setActive(active: boolean, root: THREE.Object3D | null): void {
    if (active && root) this.attachHub(root);
    if (this.active === active) {
      this.avatarsRoot.visible = active;
      this.refreshHud();
      return;
    }
    this.active = active;
    this.avatarsRoot.visible = active;
    if (active) this.connect();
    else this.disconnect(false);
    this.refreshHud();
  }

  public setProfile(profile: AvatarProfile): void {
    const next = { name: sanitizeNickname(profile.name), avatarId: normalizeAvatarId(profile.avatarId) };
    const avatarChanged = next.avatarId !== this.profile.avatarId;
    const nameChanged = next.name !== this.profile.name;
    if (!avatarChanged && !nameChanged) return;
    this.profile = next;
    this.profileRevision += 1;
    if (nameChanged) this.replaceActorLabel(this.selfActor, next.name);
    this.selfActor.profile = { ...next };
    if (avatarChanged) void this.loadActorAvatar(this.selfActor);
    this.pendingProfile = { ...next };
    this.scheduleProfileSync();
  }

  public setView(view: LobbyViewMode): void {
    if (view === this.view) return;
    this.view = view;
    this.selfActor.group.visible = this.active
      && !this.levelMode
      && view === 'third'
      && !this.cameraObstructed
      && !this.selfOccupiesVehicle();
    this.onViewChanged?.(view);
    this.refreshHud();
  }

  public toggleView(): LobbyViewMode {
    this.setView(this.view === 'first' ? 'third' : 'first');
    return this.view;
  }

  public getView(): LobbyViewMode {
    return this.view;
  }

  public setLobbyChannel(channel: string): void {
    const normalized = normalizeLobbyChannel(channel);
    if (!normalized) throw new TypeError('Lobby channel must be a public lobby or reviewed persistent space');
    if (normalized === this.lobbyChannel) return;
    this.activePartyId = null;
    this.partyInvite = null;
    this.partyState = null;
    this.onPartyInvite?.(null);
    this.onPartyState?.(null);
    this.lobbyChannel = normalized;
    this.channel = lobbyChannelProtocolName(normalized);
    if (this.active) this.disconnect(false);
    this.refreshHud();
  }

  public createParty(levelId: string, levelVersion: string): boolean {
    if (!validLevelId(levelId) || !validLevelVersion(levelVersion) || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'party_create', levelId, levelVersion }));
    return true;
  }

  public respondToParty(invite: LobbyPartyInvite, accept: boolean, levelVersion: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || !validPartyId(invite.partyId) || !validLevelVersion(levelVersion)) return false;
    this.socket.send(JSON.stringify({ type: 'party_respond', partyId: invite.partyId, accept, levelVersion }));
    if (!accept || levelVersion !== invite.levelVersion) {
      this.partyInvite = null;
      this.onPartyInvite?.(null);
    }
    return true;
  }

  public cancelParty(): void {
    if (this.partyState && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'party_cancel', partyId: this.partyState.partyId }));
    }
  }

  public returnToLobbyChannel(): void {
    if (this.activePartyId && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'return_lobby' }));
    }
    this.activePartyId = null;
    this.channel = lobbyChannelProtocolName(this.lobbyChannel);
    this.partyState = null;
    this.partyInvite = null;
    this.telemetry.setLocalActivity('online');
    this.onPartyState?.(null);
    this.onPartyInvite?.(null);
  }

  public hasActivePartyLevel(): boolean {
    return Boolean(this.activePartyId);
  }

  public requestVehicleEnter(objectId: string): boolean {
    if (!this.canSendVehicleMessage() || !validVehicleObjectId(objectId)) return false;
    this.socket!.send(JSON.stringify({ type: 'vehicle_enter', objectId }));
    return true;
  }

  public sendVehicleState(state: LobbyVehicleStateCommand): boolean {
    if (!this.canSendVehicleMessage()) return false;
    const message = serializeVehicleStateMessage(state);
    if (!message) return false;
    this.socket!.send(JSON.stringify(message));
    return true;
  }

  public releaseVehicle(objectId: string, leaseId: string, seq: number): boolean {
    if (!this.canSendVehicleMessage()) return false;
    const message = serializeVehicleExitMessage(objectId, leaseId, seq);
    if (!message) return false;
    this.socket!.send(JSON.stringify(message));
    return true;
  }

  public requestVehicleRecovery(objectId: string, leaseId: string): boolean {
    if (!this.canSendVehicleMessage()) return false;
    const message = serializeVehicleRecoverMessage(objectId, leaseId);
    if (!message) return false;
    this.socket!.send(JSON.stringify(message));
    this.telemetry.setLocalActivity(this.channelTelemetryActivity());
    return true;
  }

  public setLocalVehicleSafetyHold(active: boolean): void {
    if (this.localVehicleSafetyHold === active) return;
    this.localVehicleSafetyHold = active;
    if (active) {
      this.selfActor.moving = false;
      this.selfActor.group.visible = false;
    }
    this.refreshHud();
  }

  public adjustCameraDistance(deltaY: number, deltaMode = 0, viewportHeight = window.innerHeight): number {
    this.targetCameraDistance = thirdPersonCameraDistanceFromWheel(
      this.targetCameraDistance,
      deltaY,
      deltaMode,
      viewportHeight,
    );
    if (this.reducedMotion) this.currentCameraDistance = this.targetCameraDistance;
    return this.targetCameraDistance;
  }

  public setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    if (reducedMotion) this.currentCameraDistance = this.targetCameraDistance;
  }

  public getCameraZoomState(): {
    requestedDistance: number;
    currentDistance: number;
    minDistance: number;
    maxDistance: number;
  } {
    return {
      requestedDistance: this.targetCameraDistance,
      currentDistance: this.currentCameraDistance,
      minDistance: THIRD_PERSON_MIN_CAMERA_DISTANCE,
      maxDistance: THIRD_PERSON_MAX_CAMERA_DISTANCE,
    };
  }

  public setCreativeCameraActive(active: boolean): void {
    if (active === this.creativeCameraActive) return;
    this.creativeCameraActive = active;
    this.refreshHud();
  }

  public setLevelMode(active: boolean): void {
    this.levelMode = active;
    if (active) this.selfActor.group.visible = false;
    if (this.active) this.telemetry.setLocalActivity(this.currentTelemetryActivity());
  }

  public update(dt: number, elapsed: number, pose: LobbyPose): void {
    const wasMoving = this.lastSelfPose.moving;
    this.lastSelfPose = { ...pose };
    if (this.currentCameraDistance !== this.targetCameraDistance) {
      const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-THIRD_PERSON_ZOOM_DAMPING * Math.max(0, finite(dt)));
      this.currentCameraDistance = THREE.MathUtils.lerp(this.currentCameraDistance, this.targetCameraDistance, alpha);
      if (Math.abs(this.currentCameraDistance - this.targetCameraDistance) < 0.001) {
        this.currentCameraDistance = this.targetCameraDistance;
      }
    }
    if (!this.active) return;
    if (this.connected) this.telemetry.recordFrame(performance.now());

    const selfPosition = new THREE.Vector3(pose.x, pose.y, pose.z);
    const selfDriving = this.selfOccupiesVehicle();
    if (!selfDriving && pose.moving !== wasMoving) {
      this.telemetry.setLocalActivity(this.currentTelemetryActivity());
    }
    this.selfActor.current.copy(selfPosition);
    this.selfActor.target.copy(selfPosition);
    this.selfActor.currentYaw = pose.yaw;
    this.selfActor.targetYaw = pose.yaw;
    this.selfActor.moving = pose.moving && !selfDriving;
    this.selfActor.group.position.copy(selfPosition);
    this.selfActor.group.rotation.y = pose.yaw;
    this.selfActor.group.visible = !selfDriving && !this.levelMode && this.view === 'third' && !this.cameraObstructed;
    this.updateActorAnimation(this.selfActor, dt);

    for (const actor of this.peers.values()) {
      const driving = Boolean(this.vehicleForDriver(actor.id));
      const distance = actor.current.distanceTo(actor.target);
      const alpha = distance > 12 ? 1 : 1 - Math.exp(-12 * dt);
      actor.current.lerp(actor.target, alpha);
      actor.currentYaw = interpolateYaw(actor.currentYaw, actor.targetYaw, alpha);
      actor.group.position.copy(actor.current);
      actor.group.rotation.y = actor.currentYaw;
      if (driving) actor.moving = false;
      actor.group.visible = !driving && actor.current.distanceTo(selfPosition) > 0.6;
      this.updateActorAnimation(actor, dt);
    }

    if (
      this.socket?.readyState === 1
      && !selfDriving
      && elapsed - this.lastPoseSentAt >= POSE_INTERVAL - 0.001
    ) {
      this.lastPoseSentAt = elapsed;
      this.socket.send(JSON.stringify({
        type: 'pose',
        ...serializeMultiplayerPose(selfDriving ? { ...pose, moving: false } : pose, this.levelMode),
      }));
    }
    this.refreshHud();
  }

  public applyThirdPersonCamera(
    camera: THREE.PerspectiveCamera,
    playerPosition: THREE.Vector3,
    pitch: number,
    yaw: number,
    colliders: ReadonlyArray<Collider>,
  ): boolean {
    if (!this.active || this.view !== 'third') return false;
    const target = thirdPersonCameraTarget(playerPosition);
    const nextPosition = resolveThirdPersonCameraPosition(
      playerPosition,
      yaw,
      pitch,
      colliders,
      this.currentCameraDistance,
    );
    camera.position.copy(nextPosition);
    camera.rotation.order = 'YXZ';
    if (nextPosition.distanceToSquared(target) > 0.000001) camera.lookAt(target);
    else camera.rotation.set(thirdPersonOrbitPitch(pitch), yaw, 0);
    const targetDistance = nextPosition.distanceTo(target);
    this.cameraObstructed = this.cameraObstructed ? targetDistance < 0.82 : targetDistance <= 0.72;
    this.selfActor.group.visible = !this.cameraObstructed && !this.selfOccupiesVehicle();
    return true;
  }

  public isThirdPersonCameraObstructed(): boolean {
    return this.cameraObstructed;
  }

  public getTextState(): LobbyMultiplayerTextState {
    const round = (value: number): number => Number(value.toFixed(2));
    const occupantText = (driverId: string): { objectId: string; kind: LobbyVehicleKind; seq: number } | null => {
      const vehicle = this.vehicleForDriver(driverId);
      return vehicle ? { objectId: vehicle.objectId, kind: vehicle.kind, seq: vehicle.seq } : null;
    };
    return {
      connected: this.connected,
      online: this.onlineCount(),
      view: this.active ? this.view : 'first',
      self: {
        id: this.selfId,
        name: this.profile.name,
        avatarId: this.profile.avatarId || null,
        x: round(this.lastSelfPose.x),
        y: round(this.lastSelfPose.y),
        z: round(this.lastSelfPose.z),
        yaw: round(this.lastSelfPose.yaw),
        moving: this.lastSelfPose.moving && !this.selfOccupiesVehicle(),
        ...actorAnimationText(this.selfActor),
        visible: this.active && this.selfActor.group.visible,
        vehicle: occupantText(this.selfId),
      },
      remote: [...this.peers.values()].map((actor) => ({
        id: actor.id,
        name: actor.profile.name,
        avatarId: actor.profile.avatarId || null,
        x: round(actor.current.x),
        y: round(actor.current.y),
        z: round(actor.current.z),
        yaw: round(actor.currentYaw),
        moving: actor.moving && !this.vehicleForDriver(actor.id),
        ...actorAnimationText(actor),
        visible: this.active && actor.group.visible,
        vehicle: occupantText(actor.id),
      })).sort((a, b) => a.id.localeCompare(b.id)),
      vehicles: [...this.vehicles.values()].map((vehicle) => ({
        objectId: vehicle.objectId,
        catalogId: vehicle.catalogId,
        kind: vehicle.kind,
        driverId: vehicle.driverId,
        x: round(vehicle.x),
        y: round(vehicle.y),
        z: round(vehicle.z),
        yaw: round(vehicle.yaw),
        pitch: round(vehicle.pitch),
        roll: round(vehicle.roll),
        vx: round(vehicle.vx),
        vy: round(vehicle.vy),
        vz: round(vehicle.vz),
        seq: vehicle.seq,
        recovering: vehicle.recovering === true,
      })).sort((left, right) => left.objectId.localeCompare(right.objectId)),
      resources: {
        customRemoteSlots: this.remoteCustomSlots,
        cachedAssets: this.assetCache.size,
        referencedAssets: [...this.assetCache.values()].reduce((total, entry) => total + entry.refs, 0),
        activeLoads: this.activeAvatarLoads,
        pendingProfileSync: Boolean(this.pendingProfile || this.profileSendTimer),
        vehicleLeaseSupported: this.vehicleLeaseSupported,
        vehicleAutolandSupported: this.vehicleAutolandSupported,
      },
      party: {
        lobbyChannel: this.lobbyChannel,
        channel: this.channel,
        activePartyId: this.activePartyId,
        invite: this.partyInvite ? structuredClone(this.partyInvite) : null,
        forming: this.partyState ? structuredClone(this.partyState) : null,
      },
    };
  }

  private loadClientId(): string {
    try {
      const current = sessionStorage.getItem(CLIENT_ID_KEY);
      if (validClientId(current)) return current;
      const next = `web-${crypto.randomUUID()}`;
      sessionStorage.setItem(CLIENT_ID_KEY, next);
      return next;
    } catch {
      return `web-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`.slice(0, 64);
    }
  }

  private createTelemetryController(): PlayerTelemetryController {
    return new PlayerTelemetryController({
      send: (payload) => {
        const socket = this.socket;
        if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
      },
      render: renderPlayerStats,
      now: () => performance.now(),
      region: detectPlayerRegion,
    });
  }

  private currentTelemetryActivity(): PlayerActivity {
    if (this.selfOccupiesVehicle()) return 'driving';
    if (this.lastSelfPose.moving) return 'moving';
    if (this.levelMode || this.channel.startsWith('level:')) return 'playing';
    return 'online';
  }

  private channelTelemetryActivity(): PlayerActivity {
    return this.channel.startsWith('level:') ? 'playing' : 'online';
  }

  private handleVisibilityChange(): void {
    this.telemetry.setLocalVisibility(document.hidden);
  }

  private addVisibilityListener(): void {
    if (this.visibilityListening) return;
    this.visibilityListening = true;
    document.addEventListener('visibilitychange', this.visibilityListener);
    this.handleVisibilityChange();
  }

  private removeVisibilityListener(): void {
    if (!this.visibilityListening) return;
    this.visibilityListening = false;
    document.removeEventListener('visibilitychange', this.visibilityListener);
  }

  private connect(): void {
    if (!this.active || this.socket || this.reconnectTimer || this.disconnecting) return;
    const epoch = ++this.connectionEpoch;
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildLobbyWebSocketUrl(
        document.baseURI,
        this.clientId,
        this.profile,
        this.activePartyId,
        this.lobbyChannel,
      ));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.clearProfileSync();
    this.connectionProfileRevision = this.profileRevision;
    this.socket = socket;
    this.connected = false;
    socket.addEventListener('open', () => {
      if (epoch !== this.connectionEpoch || socket !== this.socket) return;
      this.connected = true;
      this.reconnectAttempt = 0;
      this.lastPoseSentAt = Number.NEGATIVE_INFINITY;
      this.lastProfileSentAt = Number.NEGATIVE_INFINITY;
      this.telemetry.connect(this.selfId, this.channel, []);
      this.addVisibilityListener();
      if (this.profileRevision !== this.connectionProfileRevision) {
        this.pendingProfile = { ...this.profile };
        this.scheduleProfileSync();
      }
      this.refreshHud();
    });
    socket.addEventListener('message', (event) => {
      if (epoch !== this.connectionEpoch || socket !== this.socket) return;
      this.handleMessage(parseLobbyMultiplayerMessage(event.data));
    });
    socket.addEventListener('close', () => {
      if (epoch !== this.connectionEpoch || socket !== this.socket) return;
      this.socket = null;
      this.clearProfileSync();
      this.connected = false;
      this.serverOnline = null;
      this.removeVisibilityListener();
      this.telemetry.stop();
      this.clearPeers();
      this.clearVehicleSession(true);
      this.refreshHud();
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (socket.readyState < 2) socket.close();
    });
  }

  private disconnect(reconnect: boolean): void {
    this.connectionEpoch += 1;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    this.clearProfileSync();
    this.removeVisibilityListener();
    this.telemetry.stop();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      this.disconnecting = true;
      socket.addEventListener('close', () => {
        if (!this.disconnecting) return;
        this.disconnecting = false;
        if (this.active) this.connect();
      }, { once: true });
      socket.close(1000, 'leaving lobby');
    } else {
      this.disconnecting = false;
    }
    this.connected = false;
    this.serverOnline = null;
    this.clearPeers();
    this.clearVehicleSession();
    if (!this.activePartyId) {
      this.partyInvite = null;
      this.partyState = null;
      this.onPartyInvite?.(null);
      this.onPartyState?.(null);
    }
    if (reconnect) this.scheduleReconnect();
  }

  private scheduleProfileSync(delayMs = PROFILE_DEBOUNCE_MS): void {
    if (!this.pendingProfile || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.profileSendTimer) window.clearTimeout(this.profileSendTimer);
    const sinceLastSend = performance.now() - this.lastProfileSentAt;
    const intervalWait = Number.isFinite(sinceLastSend) ? Math.max(0, PROFILE_MIN_INTERVAL_MS - sinceLastSend) : 0;
    const delay = Math.max(delayMs, intervalWait);
    this.profileSendTimer = window.setTimeout(() => {
      this.profileSendTimer = 0;
      const socket = this.socket;
      const profile = this.pendingProfile;
      if (!profile || socket?.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: 'profile', name: profile.name, avatarId: profile.avatarId || null }));
        this.lastProfileSentAt = performance.now();
        if (this.pendingProfile === profile) this.pendingProfile = null;
      } catch {
        this.pendingProfile = { ...this.profile };
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      }
    }, delay);
  }

  private clearProfileSync(): void {
    if (this.profileSendTimer) window.clearTimeout(this.profileSendTimer);
    this.profileSendTimer = 0;
    this.pendingProfile = null;
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    const delay = Math.min(10_000, 750 * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, delay);
  }

  private handleMessage(message: MultiplayerMessage | null): void {
    if (!message) return;
    if (message.type === 'welcome') {
      this.selfId = message.selfId ?? this.clientId;
      this.channel = message.channel;
      this.serverOnline = message.online;
      this.telemetry.connect(this.selfId, this.channel, message.players);
      this.clearPeers();
      const selfPlayer = message.players.find((player) => player.id === this.selfId || player.id === this.clientId);
      const changedWhileConnecting = this.profileRevision !== this.connectionProfileRevision;
      if (!changedWhileConnecting && selfPlayer && (selfPlayer.name !== this.profile.name || selfPlayer.avatarId !== this.profile.avatarId)) {
        this.profile = { name: selfPlayer.name, avatarId: selfPlayer.avatarId };
        this.updateActorProfile(this.selfActor, this.profile);
      } else if (changedWhileConnecting) {
        this.pendingProfile = { ...this.profile };
        this.scheduleProfileSync();
      }
      for (const player of message.players.slice(0, MAX_PEERS)) {
        if (player.id === this.selfId || player.id === this.clientId) continue;
        this.upsertPeer(player, true);
      }
      this.vehicleLeaseSupported = message.features?.includes(VEHICLE_LEASE_FEATURE) ?? false;
      this.vehicleAutolandSupported = message.features?.includes(VEHICLE_AUTOLAND_FEATURE) ?? false;
      this.localVehicleLease = null;
      this.replaceVehicleSnapshot(message.vehicles ?? []);
    } else if (message.type === 'join') {
      this.telemetry.playerJoined(message.player);
      if (message.player.id !== this.selfId && message.player.id !== this.clientId) this.upsertPeer(message.player, true);
      this.serverOnline = message.online;
    } else if (message.type === 'pose') {
      this.telemetry.updateActivity(
        message.player.id,
        message.player.moving ? 'moving' : this.channelTelemetryActivity(),
      );
      if (message.player.id !== this.selfId && message.player.id !== this.clientId) this.upsertPeer(message.player, false);
    } else if (message.type === 'profile') {
      this.telemetry.updateProfile(message.id, message.name);
      if (message.id !== this.selfId && message.id !== this.clientId) {
        const actor = this.peers.get(message.id);
        if (actor) this.updateActorProfile(actor, { name: message.name, avatarId: message.avatarId });
      }
    } else if (message.type === 'telemetry') {
      this.telemetry.receive(message.id, message.telemetry);
    } else if (message.type === 'telemetry_pong') {
      this.telemetry.handlePong(message.nonce);
    } else if (message.type === 'error') {
      if (message.code === 'profile_rate_limited') {
        this.pendingProfile = { ...this.profile };
        this.scheduleProfileSync(message.retryAfterMs ?? PROFILE_MIN_INTERVAL_MS);
      }
      if (message.code.startsWith('party_')) this.onPartyNotice?.(message.code);
      if (message.code.startsWith('vehicle_')) this.onVehicleEvent?.({ type: 'error', code: message.code });
    } else if (message.type === 'vehicle_entered') {
      if (message.vehicle.driverId === this.selfId || message.vehicle.driverId === this.clientId) {
        this.localVehicleLease = { objectId: message.vehicle.objectId, leaseId: message.leaseId };
      }
      if (message.vehicle.driverId) this.telemetry.updateActivity(message.vehicle.driverId, 'driving');
      this.upsertVehicle(message.vehicle, true);
      this.onVehicleEvent?.({ type: 'entered', leaseId: message.leaseId, vehicle: structuredClone(message.vehicle) });
    } else if (message.type === 'vehicle_claimed') {
      if (message.vehicle.driverId) this.telemetry.updateActivity(message.vehicle.driverId, 'driving');
      this.upsertVehicle(message.vehicle, true);
      this.onVehicleEvent?.({ type: 'claimed', vehicle: structuredClone(message.vehicle) });
    } else if (message.type === 'vehicle_state') {
      if (this.upsertVehicle(message.vehicle, false)) {
        if (message.vehicle.driverId) this.telemetry.updateActivity(message.vehicle.driverId, 'driving');
        this.onVehicleEvent?.({ type: 'state', vehicle: structuredClone(message.vehicle) });
      }
    } else if (message.type === 'vehicle_recovery') {
      if (
        message.driverId === this.selfId
        || message.driverId === this.clientId
        || this.localVehicleLease?.objectId === message.vehicle.objectId
      ) this.localVehicleLease = null;
      this.telemetry.updateActivity(message.driverId, this.channelTelemetryActivity());
      this.upsertVehicle(message.vehicle, true);
      this.onVehicleEvent?.({
        type: 'recovery',
        reason: message.reason,
        driverId: message.driverId,
        vehicle: structuredClone(message.vehicle),
      });
    } else if (message.type === 'vehicle_released') {
      if (
        message.driverId === this.selfId
        || message.driverId === this.clientId
        || this.localVehicleLease?.objectId === message.vehicle.objectId
      ) this.localVehicleLease = null;
      this.telemetry.updateActivity(
        message.driverId,
        this.channelTelemetryActivity(),
      );
      this.upsertVehicle(message.vehicle, true);
      this.onVehicleEvent?.({
        type: 'released',
        reason: message.reason,
        driverId: message.driverId,
        vehicle: structuredClone(message.vehicle),
      });
    } else if (message.type === 'vehicle_snapshot') {
      this.replaceVehicleSnapshot(message.vehicles);
    } else if (message.type === 'leave') {
      this.telemetry.playerLeft(message.id);
      this.removePeer(message.id);
      this.serverOnline = message.online;
    } else if (message.type === 'party_invite') {
      this.partyInvite = message.invite;
      this.onPartyInvite?.(structuredClone(message.invite));
    } else if (message.type === 'party_state') {
      this.partyState = message.party;
      if (this.partyInvite?.partyId === message.party.partyId) {
        this.partyInvite = null;
        this.onPartyInvite?.(null);
      }
      this.onPartyState?.(structuredClone(message.party));
    } else if (message.type === 'party_launch') {
      this.activePartyId = message.launch.partyId;
      this.channel = `level:${message.launch.partyId}`;
      this.partyInvite = null;
      this.partyState = null;
      this.telemetry.setLocalActivity('playing');
      this.onPartyInvite?.(null);
      this.onPartyState?.(null);
      this.onPartyLaunch?.(message.launch);
    } else if (message.type === 'party_cancelled') {
      if (this.partyInvite?.partyId === message.partyId) this.partyInvite = null;
      if (this.partyState?.partyId === message.partyId) this.partyState = null;
      if (this.activePartyId === message.partyId) {
        this.activePartyId = null;
        this.channel = lobbyChannelProtocolName(this.lobbyChannel);
        this.telemetry.setLocalActivity('online');
      }
      this.onPartyInvite?.(this.partyInvite ? structuredClone(this.partyInvite) : null);
      this.onPartyState?.(this.partyState ? structuredClone(this.partyState) : null);
      if (message.reason !== 'declined') this.onPartyNotice?.(`party_${message.reason}`);
    } else if (message.type === 'channel_snapshot') {
      this.channel = message.channel;
      this.serverOnline = message.online;
      this.telemetry.connect(this.selfId, this.channel, message.players);
      this.clearPeers();
      for (const player of message.players.slice(0, MAX_PEERS)) {
        if (player.id === this.selfId || player.id === this.clientId) continue;
        this.upsertPeer(player, true);
      }
      this.vehicleLeaseSupported = message.features?.includes(VEHICLE_LEASE_FEATURE) ?? false;
      this.vehicleAutolandSupported = message.features?.includes(VEHICLE_AUTOLAND_FEATURE) ?? false;
      this.localVehicleLease = null;
      this.replaceVehicleSnapshot(message.vehicles ?? []);
    }
    this.refreshHud();
  }

  private upsertPeer(player: LobbyPlayerSnapshot, force: boolean): void {
    let actor = this.peers.get(player.id);
    if (!actor) {
      if (this.peers.size >= MAX_PEERS) return;
      actor = this.createActor(player.id, player, player, false);
      if (this.vehicleForDriver(player.id)) {
        actor.moving = false;
        actor.group.visible = false;
      }
      this.peers.set(player.id, actor);
      this.avatarsRoot.add(actor.group);
      return;
    }
    if (!force && !shouldAcceptLobbyPose(player, { seq: actor.lastSeq, timestamp: actor.lastTimestamp })) return;
    if (force && (player.name !== actor.profile.name || player.avatarId !== actor.profile.avatarId)) {
      this.updateActorProfile(actor, player);
    }
    actor.target.set(player.x, player.y, player.z);
    actor.targetYaw = player.yaw;
    actor.moving = player.moving && !this.vehicleForDriver(player.id);
    if (player.seq !== undefined) actor.lastSeq = player.seq;
    if (player.timestamp !== undefined) actor.lastTimestamp = player.timestamp;
  }

  private canSendVehicleMessage(): boolean {
    return this.vehicleLeaseSupported
      && !this.levelMode
      && !this.activePartyId
      && this.channel === lobbyChannelProtocolName(this.lobbyChannel)
      && this.socket?.readyState === 1;
  }

  private vehicleForDriver(driverId: string): LobbyVehicleSnapshot | null {
    for (const vehicle of this.vehicles.values()) {
      if (vehicle.driverId === driverId) return vehicle;
    }
    return null;
  }

  private selfOccupiesVehicle(): boolean {
    return this.localVehicleSafetyHold || Boolean(this.vehicleForDriver(this.selfId));
  }

  private replaceVehicleSnapshot(vehicles: LobbyVehicleSnapshot[]): void {
    this.vehicles.clear();
    for (const vehicle of vehicles) this.vehicles.set(vehicle.objectId, structuredClone(vehicle));
    this.syncVehicleOccupants();
    this.onVehicleEvent?.({
      type: 'snapshot',
      vehicles: [...this.vehicles.values()]
        .sort((left, right) => left.objectId.localeCompare(right.objectId))
        .map((vehicle) => structuredClone(vehicle)),
    });
  }

  private upsertVehicle(vehicle: LobbyVehicleSnapshot, force: boolean): boolean {
    const previous = this.vehicles.get(vehicle.objectId);
    if (!force && previous && vehicle.seq <= previous.seq) return false;
    this.vehicles.set(vehicle.objectId, structuredClone(vehicle));
    this.syncVehicleOccupants();
    return true;
  }

  private syncVehicleOccupants(): void {
    if (this.selfOccupiesVehicle()) {
      this.selfActor.moving = false;
      if (this.selfActor.animationMoving) this.setActorAnimationMode(this.selfActor, false);
      this.selfActor.group.visible = false;
    }
    for (const actor of this.peers.values()) {
      if (!this.vehicleForDriver(actor.id)) continue;
      actor.moving = false;
      if (actor.animationMoving) this.setActorAnimationMode(actor, false);
      actor.group.visible = false;
    }
  }

  private clearVehicleSession(recoverLocal = false): void {
    const hadVehicles = this.vehicles.size > 0;
    const localVehicle = recoverLocal
      ? this.vehicleForDriver(this.selfId) ?? this.vehicleForDriver(this.clientId)
      : null;
    this.vehicleLeaseSupported = false;
    this.vehicleAutolandSupported = false;
    this.localVehicleLease = null;
    this.vehicles.clear();
    const driverId = localVehicle?.driverId;
    if (driverId) {
      this.telemetry.updateActivity(driverId, this.channelTelemetryActivity());
      const recovering = { ...localVehicle, recovering: true as const };
      this.vehicles.set(recovering.objectId, recovering);
      this.syncVehicleOccupants();
      this.onVehicleEvent?.({
        type: 'recovery',
        reason: 'disconnect',
        driverId,
        vehicle: structuredClone(recovering),
        local: true,
      });
      return;
    }
    if (hadVehicles) this.onVehicleEvent?.({ type: 'snapshot', vehicles: [] });
  }

  private createActor(id: string, profile: AvatarProfile, pose: LobbyPose, isSelf: boolean): AvatarActor {
    const fallback = createProceduralAvatar();
    const group = new THREE.Group();
    group.name = `LobbyPlayer:${id}`;
    const label = createNicknameSprite(profile.name);
    label.visible = lobbyNicknameLabelVisible(isSelf);
    group.add(fallback.root, label);
    group.position.set(pose.x, pose.y, pose.z);
    group.rotation.y = pose.yaw;
    const actor: AvatarActor = {
      id,
      profile: { name: sanitizeNickname(profile.name), avatarId: normalizeAvatarId(profile.avatarId) },
      group,
      visual: fallback.root,
      label,
      current: new THREE.Vector3(pose.x, pose.y, pose.z),
      target: new THREE.Vector3(pose.x, pose.y, pose.z),
      currentYaw: pose.yaw,
      targetYaw: pose.yaw,
      moving: pose.moving,
      lastSeq: pose.seq ?? -1,
      lastTimestamp: pose.timestamp ?? -1,
      mixer: null,
      idleAction: null,
      walkAction: null,
      idlePoseTime: null,
      animationMoving: false,
      procedural: true,
      limbs: fallback.limbs,
      visualBaseY: fallback.root.position.y,
      animationTime: 0,
      loadToken: 0,
      customSlot: false,
      assetKey: null,
      self: isSelf,
    };
    void this.loadActorAvatar(actor);
    return actor;
  }

  private async loadActorAvatar(actor: AvatarActor): Promise<void> {
    const token = ++actor.loadToken;
    const requestedAvatarId = normalizeAvatarId(actor.profile.avatarId);
    const requestedCustom = Boolean(requestedAvatarId) && !isBuiltInAvatarId(requestedAvatarId);
    if (!actor.self) {
      if (!requestedCustom && actor.customSlot) {
        actor.customSlot = false;
        this.remoteCustomSlots = Math.max(0, this.remoteCustomSlots - 1);
      } else if (requestedCustom && !actor.customSlot && this.remoteCustomSlots < 16) {
        actor.customSlot = true;
        this.remoteCustomSlots += 1;
      }
    }
    const resolvedAvatarId = requestedCustom && !actor.self && !actor.customSlot ? '' : requestedAvatarId;
    const url = avatarModelUrl(resolvedAvatarId);
    try {
      const entry = this.avatarAssetEntry(url);
      const asset = await entry.promise;
      const preset = avatarPresetById(resolvedAvatarId);
      const needsSharedAnimations = !preset || preset.idleClipIndex === undefined || preset.walkClipIndex === undefined;
      const sharedAnimations = needsSharedAnimations
        ? await this.sharedAvatarAnimations()
        : { idle: null, walk: null };
      if (token !== actor.loadToken || (!actor.group.parent && !actor.self)) return;
      const model = cloneSkeleton(asset.gltf.scene);
      model.rotation.y = preset?.rotationY ?? (isWhiteRoomStandardAvatarRig(model) ? Math.PI / 2 : 0);
      const unsafeNodes: THREE.Object3D[] = [];
      model.traverse((object) => {
        const candidate = object as THREE.Object3D & { isLight?: boolean; isCamera?: boolean; isAudio?: boolean };
        if (candidate.isLight || candidate.isCamera || candidate.isAudio || /^(Audio|AudioListener|PositionalAudio)$/.test(candidate.type)) {
          unsafeNodes.push(candidate);
        }
      });
      unsafeNodes.forEach((object) => object.removeFromParent());
      model.updateWorldMatrix(true, true);
      let bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0.001) throw new Error('avatar bounds are empty');
      model.scale.setScalar(1.75 / size.y);
      model.updateWorldMatrix(true, true);
      bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= bounds.min.y;
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = true;
        }
      });

      if (actor.procedural) disposeProcedural(actor.visual);
      actor.mixer?.stopAllAction();
      actor.mixer?.uncacheRoot(actor.visual);
      actor.visual.removeFromParent();
      this.releaseActorAsset(actor);
      entry.refs += 1;
      entry.lastUsed = performance.now();
      actor.assetKey = url;
      actor.visual = model;
      actor.procedural = false;
      actor.limbs = null;
      actor.visualBaseY = model.position.y;
      actor.group.add(model);

      let idleClip: THREE.AnimationClip | null = null;
      let walkClip: THREE.AnimationClip | null = null;
      if (preset) {
        idleClip = preset.idleClipIndex !== undefined
          ? asset.clips[preset.idleClipIndex]?.clone() ?? null
          : avatarAnimationCompatibility(model, sharedAnimations.idle).compatible
            ? sharedAnimations.idle?.clone() ?? null
            : null;
        walkClip = preset.walkClipIndex !== undefined
          ? asset.clips[preset.walkClipIndex]?.clone() ?? null
          : avatarAnimationCompatibility(model, sharedAnimations.walk).compatible
            ? sharedAnimations.walk?.clone() ?? null
            : null;
        idleClip ??= walkClip?.clone() ?? null;
        if (idleClip) idleClip.name = `${preset.id || 'default'}:idle`;
        if (walkClip) walkClip.name = `${preset.id || 'default'}:walk`;
      } else {
        const resolved = resolveUploadedAvatarAnimationClips(
          model,
          asset.clips,
          sharedAnimations,
          resolvedAvatarId,
        );
        idleClip = resolved.idle;
        walkClip = resolved.walk;
      }

      if (idleClip || walkClip) {
        actor.mixer = new THREE.AnimationMixer(model);
        actor.idleAction = idleClip ? actor.mixer.clipAction(idleClip) : null;
        actor.walkAction = walkClip ? actor.mixer.clipAction(walkClip) : null;
        actor.idlePoseTime = actor.idleAction ? preset?.idlePoseTime ?? 1 / 24 : null;
      } else {
        actor.mixer = null;
        actor.idleAction = null;
        actor.walkAction = null;
        actor.idlePoseTime = null;
      }
      this.setActorAnimationMode(actor, actor.moving);
    } catch {
      // Keep the neutral procedural mesh only as a hidden load-failure safeguard.
    }
  }

  private avatarAssetEntry(url: string): AvatarCacheEntry {
    const cached = this.assetCache.get(url);
    if (cached) {
      cached.lastUsed = performance.now();
      return cached;
    }
    this.evictAvatarCache(23);
    const entry: AvatarCacheEntry = {
      promise: Promise.resolve(null as unknown as AvatarAsset),
      refs: 0,
      lastUsed: performance.now(),
      settled: false,
    };
    entry.promise = this.withAvatarLoadSlot(async (): Promise<AvatarAsset> => {
      const gltf = await this.loader.loadAsync(url);
      return { gltf, clips: [...gltf.animations] };
    });
    this.assetCache.set(url, entry);
    entry.promise.then(
      () => { entry.settled = true; },
      () => {
        entry.settled = true;
        if (entry.refs === 0 && this.assetCache.get(url) === entry) this.assetCache.delete(url);
      },
    );
    return entry;
  }

  private sharedAvatarAnimations(): Promise<SharedAvatarAnimationClips> {
    if (this.sharedAvatarAnimationPromise) return this.sharedAvatarAnimationPromise;
    this.sharedAvatarAnimationPromise = this.withAvatarLoadSlot(async () => {
      const [idleAsset, walkAsset] = await Promise.all([
        this.loader.loadAsync(DEFAULT_IDLE_URL).catch(() => null),
        this.loader.loadAsync(DEFAULT_WALK_URL).catch(() => null),
      ]);
      const result: SharedAvatarAnimationClips = {
        idle: idleAsset?.animations[0]?.clone() ?? null,
        walk: walkAsset?.animations[0]?.clone() ?? null,
      };
      if (idleAsset) this.disposeAvatarAsset({ gltf: idleAsset, clips: [] });
      if (walkAsset) this.disposeAvatarAsset({ gltf: walkAsset, clips: [] });
      return result;
    });
    return this.sharedAvatarAnimationPromise;
  }

  private async withAvatarLoadSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeAvatarLoads >= 3) {
      await new Promise<void>((resolve) => this.avatarLoadQueue.push(resolve));
    }
    this.activeAvatarLoads += 1;
    try {
      return await task();
    } finally {
      this.activeAvatarLoads = Math.max(0, this.activeAvatarLoads - 1);
      this.avatarLoadQueue.shift()?.();
    }
  }

  private releaseActorAsset(actor: AvatarActor): void {
    if (!actor.assetKey) return;
    const entry = this.assetCache.get(actor.assetKey);
    if (entry) {
      entry.refs = Math.max(0, entry.refs - 1);
      entry.lastUsed = performance.now();
    }
    actor.assetKey = null;
    this.evictAvatarCache(24);
  }

  private evictAvatarCache(maximum: number): void {
    while (this.assetCache.size > maximum) {
      const candidate = [...this.assetCache.entries()]
        .filter(([, entry]) => entry.settled && entry.refs === 0)
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!candidate) return;
      const [url, entry] = candidate;
      this.assetCache.delete(url);
      void entry.promise.then((asset) => this.disposeAvatarAsset(asset));
    }
  }

  private disposeAvatarAsset(asset: AvatarAsset): void {
    const textures = new Set<THREE.Texture>();
    asset.gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
        }
        material.dispose();
      }
    });
    textures.forEach((texture) => texture.dispose());
  }

  private updateActorProfile(actor: AvatarActor, profile: AvatarProfile): void {
    const next = { name: sanitizeNickname(profile.name), avatarId: normalizeAvatarId(profile.avatarId) };
    if (next.name !== actor.profile.name) this.replaceActorLabel(actor, next.name);
    const avatarChanged = next.avatarId !== actor.profile.avatarId;
    actor.profile = next;
    if (avatarChanged) void this.loadActorAvatar(actor);
  }

  private replaceActorLabel(actor: AvatarActor, name: string): void {
    disposeSprite(actor.label);
    actor.label.removeFromParent();
    actor.label = createNicknameSprite(name);
    actor.label.visible = lobbyNicknameLabelVisible(actor.self);
    actor.group.add(actor.label);
  }

  private setActorAnimationMode(actor: AvatarActor, moving: boolean): void {
    actor.animationTime = 0;
    if (moving) {
      if (actor.idleAction && actor.idleAction !== actor.walkAction) actor.idleAction.stop();
      if (actor.walkAction) {
        actor.walkAction.reset();
        actor.walkAction.enabled = true;
        actor.walkAction.paused = false;
        actor.walkAction.setEffectiveWeight(1);
        actor.walkAction.setEffectiveTimeScale(1);
        actor.walkAction.play();
      }
    } else {
      actor.walkAction?.stop();
      if (actor.idleAction) {
        actor.idleAction.reset();
        actor.idleAction.enabled = true;
        actor.idleAction.paused = false;
        actor.idleAction.setEffectiveWeight(1);
        actor.idleAction.setEffectiveTimeScale(1);
        actor.idleAction.play();
        actor.idleAction.time = actor.idlePoseTime ?? 1 / 24;
        actor.idleAction.paused = true;
        actor.mixer?.update(0);
      }
      actor.visual.position.y = actor.visualBaseY;
      if (actor.limbs) {
        actor.limbs.leftArm.rotation.x = 0;
        actor.limbs.rightArm.rotation.x = 0;
        actor.limbs.leftLeg.rotation.x = 0;
        actor.limbs.rightLeg.rotation.x = 0;
      }
    }
    actor.animationMoving = moving;
  }

  private updateActorAnimation(actor: AvatarActor, dt: number): void {
    if (actor.animationMoving !== actor.moving) this.setActorAnimationMode(actor, actor.moving);
    if (actor.mixer) actor.mixer.update(dt);
    if (!actor.moving) {
      actor.visual.position.y = actor.visualBaseY;
      return;
    }

    actor.animationTime += dt;
    if (!actor.walkAction) {
      const pace = 9;
      actor.visual.position.y = actor.visualBaseY + Math.abs(Math.sin(actor.animationTime * pace)) * 0.035;
      if (actor.limbs) {
        const swing = Math.sin(actor.animationTime * pace) * 0.58;
        actor.limbs.leftArm.rotation.x = swing;
        actor.limbs.rightArm.rotation.x = -swing;
        actor.limbs.leftLeg.rotation.x = -swing;
        actor.limbs.rightLeg.rotation.x = swing;
      }
    } else {
      actor.visual.position.y = actor.visualBaseY;
    }
  }

  private removePeer(id: string): void {
    const actor = this.peers.get(id);
    if (!actor) return;
    actor.loadToken += 1;
    actor.mixer?.stopAllAction();
    actor.mixer?.uncacheRoot(actor.visual);
    this.releaseActorAsset(actor);
    if (actor.customSlot) {
      actor.customSlot = false;
      this.remoteCustomSlots = Math.max(0, this.remoteCustomSlots - 1);
    }
    disposeSprite(actor.label);
    if (actor.procedural) disposeProcedural(actor.visual);
    actor.group.removeFromParent();
    this.peers.delete(id);
  }

  private clearPeers(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  private onlineCount(): number {
    return this.connected ? Math.max(1, this.serverOnline ?? this.peers.size + 1) : 1;
  }

  private refreshHud(): void {
    this.ui.root?.classList.toggle('hidden', !this.active);
    this.ui.root?.classList.toggle('connected', this.connected);
    if (this.ui.online) this.ui.online.textContent = this.connected ? `${this.onlineCount()} 人在线` : '正在连接';
    if (this.ui.channel) this.ui.channel.textContent = `频道 ${this.lobbyChannel}`;
    if (this.ui.view) {
      this.ui.view.textContent = this.creativeCameraActive
        ? '创造视角'
        : this.view === 'third'
          ? '第三人称'
          : '第一人称';
    }
    if (this.ui.viewHint) {
      this.ui.viewHint.textContent = this.creativeCameraActive
        ? '玩家留在原地'
        : this.view === 'third'
          ? '滚轮缩放 · V 切换'
          : 'V 切换视角';
    }
  }
}
