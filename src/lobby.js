import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { atomicWriteJson } from './store.js';
import { HttpError } from './errors.js';

const PUBLIC_AREA_HALF_SIZE = 15;
const PLOT_SIZE = 12;
const PLOT_HALF_SIZE = PLOT_SIZE / 2;
const PLOT_CENTER_SPACING = 12;
const PLOT_RING_MIN = 2;
const PLOT_RING_MAX = 4;
const WORLD_ROOT_LIMIT = 54;
const LEGACY_PUBLIC_HALF_SIZE = 18;
export const LOBBY_LAYOUT_EPSILON = 1e-6;

function createPlotSlots() {
  const slots = [];
  const addSlot = (ring, gridX, gridZ) => {
    const x = gridX * PLOT_CENTER_SPACING;
    const z = gridZ * PLOT_CENTER_SPACING;
    slots.push(Object.freeze({
      id: `plot-${String(slots.length + 1).padStart(3, '0')}`,
      index: slots.length + 1,
      ring,
      gridX,
      gridZ,
      center: Object.freeze({ x, z }),
      bounds: Object.freeze({
        x: Object.freeze({ min: x - PLOT_HALF_SIZE, max: x + PLOT_HALF_SIZE }),
        z: Object.freeze({ min: z - PLOT_HALF_SIZE, max: z + PLOT_HALF_SIZE }),
      }),
    }));
  };
  for (let ring = PLOT_RING_MIN; ring <= PLOT_RING_MAX; ring += 1) {
    for (let gridX = -ring; gridX <= ring; gridX += 1) addSlot(ring, gridX, -ring);
    for (let gridZ = -ring + 1; gridZ <= ring; gridZ += 1) addSlot(ring, ring, gridZ);
    for (let gridX = ring - 1; gridX >= -ring; gridX -= 1) addSlot(ring, gridX, ring);
    for (let gridZ = ring - 1; gridZ > -ring; gridZ -= 1) addSlot(ring, -ring, gridZ);
  }
  if (slots.length !== 72) throw new Error('Lobby plot layout must contain exactly 72 slots');
  return Object.freeze(slots);
}

export const LOBBY_PLOT_SLOTS = createPlotSlots();
const PLOT_SLOT_BY_ID = new Map(LOBBY_PLOT_SLOTS.map((slot) => [slot.id, slot]));

export const LOBBY_CONSTRAINTS = Object.freeze({
  layoutEpsilon: LOBBY_LAYOUT_EPSILON,
  bounds: Object.freeze({
    x: Object.freeze({ min: -WORLD_ROOT_LIMIT, max: WORLD_ROOT_LIMIT }),
    y: Object.freeze({ min: 0, max: 8 }),
    z: Object.freeze({ min: -WORLD_ROOT_LIMIT, max: WORLD_ROOT_LIMIT }),
  }),
  publicArea: Object.freeze({
    x: Object.freeze({ min: -PUBLIC_AREA_HALF_SIZE, max: PUBLIC_AREA_HALF_SIZE }),
    z: Object.freeze({ min: -PUBLIC_AREA_HALF_SIZE, max: PUBLIC_AREA_HALF_SIZE }),
  }),
  plotLayout: Object.freeze({
    size: PLOT_SIZE,
    centerSpacing: PLOT_CENTER_SPACING,
    rings: Object.freeze({ min: PLOT_RING_MIN, max: PLOT_RING_MAX }),
    slots: LOBBY_PLOT_SLOTS,
  }),
  rotationY: Object.freeze({ min: -Math.PI, max: Math.PI }),
  scale: Object.freeze({ min: 0.25, max: 3 }),
  protectedZones: Object.freeze([
    Object.freeze({
      id: 'terminal',
      center: Object.freeze({ x: 0, z: -7.42 }),
      radius: 3.5,
    }),
    Object.freeze({
      id: 'spawn',
      center: Object.freeze({ x: 0, z: 4.2 }),
      radius: 2.25,
    }),
  ]),
  maxObjects: 200,
});

const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
export const PERSISTENT_SPACE_IDS = Object.freeze(['heaven', 'hell']);
const PERSISTENT_SPACE_ID_SET = new Set(PERSISTENT_SPACE_IDS);
export const NUMERIC_LOBBY_CHANNEL_PATTERN = /^[0-9]{4,12}$/;
export const PERSISTENT_SPACE_CHANNEL_PATTERN = /^space-[0-9]{4,12}-(?:heaven|hell)$/;
export const LOBBY_CHANNEL_PATTERN = /^(?:[0-9]{4,12}|space-[0-9]{4,12}-(?:heaven|hell))$/;
export const DEFAULT_LOBBY_CHANNEL = '0000';
const OBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const LOBBY_DYNAMIC_ASSET_ID_PATTERN = /^user-glb-[a-f0-9]{32}$/;
const MAX_DYNAMIC_ASSET_INSTANCES_PER_CHANNEL = 20;
const MAX_DYNAMIC_ASSET_INSTANCES_TOTAL_PER_CHANNEL = 40;
const MAX_DYNAMIC_ASSET_UNIQUE_PER_CHANNEL = 20;
export const LOBBY_DYNAMIC_RESOURCE_LIMITS = Object.freeze({
  uniqueBytes: 60 * 1024 * 1024,
  uniqueTexturePixels: 16 * 1024 * 1024,
  renderedVertices: 500_000,
  renderedTriangles: 500_000,
});
const INTERACTION_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const FORBIDDEN_CATALOG_PATTERN = /(?:terminal|computer|system)/i;
const LOBBY_OWNER_ID_PATTERN = /^owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_NICKNAME_ALLOWED_PATTERN = /^[\p{L}\p{N}\p{M} ._-]+$/u;
const OWNER_NICKNAME_CONTENT_PATTERN = /[\p{L}\p{N}]/u;
const OWNER_NICKNAME_MAX_CHARACTERS = 24;
const OWNER_NICKNAME_MAX_BYTES = 96;
const STATE_SCHEMA_VERSION = 1;
const LOBBY_CATALOG_PATH = new URL('./lobby-catalog.json', import.meta.url);
const REALM_SYSTEM_ACTOR = 'realm-system-0001';
export const REALM_MANAGED_OBJECTS = Object.freeze({
  heaven: Object.freeze({
    id: 'realm-celestial-dragon-0001',
    catalogId: 'code-celestial-riding-dragon',
    position: Object.freeze({ x: 0, y: 0, z: -9 }),
    rotationY: Math.PI,
    scale: 1,
  }),
  hell: Object.freeze({
    id: 'realm-infernal-piano-0001',
    catalogId: 'code-infernal-concert-grand',
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationY: 0,
    scale: 1,
  }),
});
const REALM_MANAGED_CATALOG_IDS = new Set(
  Object.values(REALM_MANAGED_OBJECTS).map((object) => object.catalogId),
);
const LOBBY_VEHICLE_FIELDS = new Set([
  'kind',
  'enterRadius',
  'maxSpeed',
  'maxAcceleration',
  'maxAngularSpeed',
]);
const LOBBY_VEHICLE_LIMITS = Object.freeze({
  car: Object.freeze({
    enterRadius: Object.freeze({ min: 1, max: 6 }),
    maxSpeed: Object.freeze({ min: 1, max: 35 }),
    maxAcceleration: Object.freeze({ min: 1, max: 30 }),
    maxAngularSpeed: Object.freeze({ min: 0.1, max: 4 }),
  }),
  aircraft: Object.freeze({
    enterRadius: Object.freeze({ min: 1, max: 8 }),
    maxSpeed: Object.freeze({ min: 1, max: 80 }),
    maxAcceleration: Object.freeze({ min: 1, max: 50 }),
    maxAngularSpeed: Object.freeze({ min: 0.1, max: 3 }),
  }),
});
const LOBBY_PORTAL_FIELDS = new Set(['kind', 'destinations']);
const LOBBY_PORTAL_DESTINATION_FIELDS = new Set(['id', 'label', 'spaceId']);
const LOBBY_PORTAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const STORED_OBJECT_FIELDS = new Set([
  'id',
  'catalogId',
  'position',
  'rotationY',
  'scale',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'revision',
  'interaction',
  'plotId',
]);
const STORED_PLOT_FIELDS = new Set(['id', 'ownerId', 'ownerNickname', 'claimedAt', 'updatedAt', 'coAuthors']);
// 共笔权（《眠海》第七章）：梦主可将域内创作权授予至多 4 位访客
export const MAX_PLOT_CO_AUTHORS = 4;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value, allowed, required, fieldName) {
  if (!isPlainObject(value)) {
    throw new HttpError(422, 'invalid_lobby_payload', `${fieldName} must be an object`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.has(key));
  const missing = [...required].filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length || missing.length) {
    throw new HttpError(422, 'invalid_lobby_payload', `${fieldName} has invalid fields`, {
      ...(unexpected.length ? { unexpected } : {}),
      ...(missing.length ? { missing } : {}),
    });
  }
}

function requireFiniteNumber(value, fieldName, range, epsilon = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(422, 'invalid_lobby_transform', `${fieldName} must be a finite number`);
  }
  if (value < range.min - epsilon || value > range.max + epsilon) {
    throw new HttpError(
      422,
      'lobby_bounds_exceeded',
      `${fieldName} must be between ${range.min} and ${range.max}`,
    );
  }
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return Object.is(value, -0) ? 0 : value;
}

export function validateClientId(value) {
  if (typeof value !== 'string' || !CLIENT_ID_PATTERN.test(value)) {
    throw new HttpError(
      422,
      'invalid_client_id',
      'clientId must be 8-64 characters using letters, numbers, underscores, or hyphens',
    );
  }
  return value;
}

export function validateLobbyChannel(value) {
  if (typeof value !== 'string' || !LOBBY_CHANNEL_PATTERN.test(value)) {
    throw new HttpError(
      422,
      'invalid_lobby_channel',
      'channel must be a 4-12 digit lobby number or a reviewed persistent space',
    );
  }
  return value;
}

export function isPersistentSpaceChannel(value) {
  return typeof value === 'string' && PERSISTENT_SPACE_CHANNEL_PATTERN.test(value);
}

export function persistentSpaceIdForChannel(value) {
  if (typeof value !== 'string') return null;
  const match = /^space-[0-9]{4,12}-(heaven|hell)$/.exec(value);
  return match?.[1] === 'heaven' || match?.[1] === 'hell' ? match[1] : null;
}

export function realmManagedObjectForChannel(value) {
  const spaceId = persistentSpaceIdForChannel(value);
  return spaceId ? REALM_MANAGED_OBJECTS[spaceId] : null;
}

export function isRealmManagedObject(channel, object) {
  const managed = realmManagedObjectForChannel(channel);
  return Boolean(managed && object?.id === managed.id && object?.catalogId === managed.catalogId);
}

function createRealmManagedStoredObject(channel, revision, timestamp) {
  const managed = realmManagedObjectForChannel(channel);
  if (!managed) return null;
  return {
    id: managed.id,
    catalogId: managed.catalogId,
    position: { ...managed.position },
    rotationY: managed.rotationY,
    scale: managed.scale,
    createdBy: REALM_SYSTEM_ACTOR,
    updatedBy: REALM_SYSTEM_ACTOR,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision,
    plotId: null,
    interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
  };
}

export function validateObjectId(value) {
  if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) {
    throw new HttpError(404, 'lobby_object_not_found', 'Lobby object was not found');
  }
  return value;
}

export function validatePlotId(value) {
  if (typeof value !== 'string' || !PLOT_SLOT_BY_ID.has(value)) {
    throw new HttpError(404, 'lobby_plot_not_found', 'Lobby plot was not found');
  }
  return value;
}

export function classifyLobbyPosition(position) {
  if (
    position.x >= -PUBLIC_AREA_HALF_SIZE - LOBBY_LAYOUT_EPSILON
    && position.x <= PUBLIC_AREA_HALF_SIZE + LOBBY_LAYOUT_EPSILON
    && position.z >= -PUBLIC_AREA_HALF_SIZE - LOBBY_LAYOUT_EPSILON
    && position.z <= PUBLIC_AREA_HALF_SIZE + LOBBY_LAYOUT_EPSILON
  ) {
    return null;
  }
  for (const slot of LOBBY_PLOT_SLOTS) {
    if (
      position.x >= slot.bounds.x.min - LOBBY_LAYOUT_EPSILON
      && position.x <= slot.bounds.x.max + LOBBY_LAYOUT_EPSILON
      && position.z >= slot.bounds.z.min - LOBBY_LAYOUT_EPSILON
      && position.z <= slot.bounds.z.max + LOBBY_LAYOUT_EPSILON
    ) {
      return slot.id;
    }
  }
  throw new HttpError(
    422,
    'lobby_placement_gap',
    'position must be inside the central public lobby or a home plot',
  );
}

export function sanitizeOwnerNickname(value) {
  if (typeof value !== 'string') {
    throw new HttpError(422, 'invalid_owner_nickname', 'ownerNickname must be a string');
  }
  const nickname = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const characters = [...nickname];
  if (
    characters.length < 1
    || characters.length > OWNER_NICKNAME_MAX_CHARACTERS
    || Buffer.byteLength(nickname, 'utf8') > OWNER_NICKNAME_MAX_BYTES
    || !OWNER_NICKNAME_ALLOWED_PATTERN.test(nickname)
    || !OWNER_NICKNAME_CONTENT_PATTERN.test(nickname)
  ) {
    throw new HttpError(
      422,
      'invalid_owner_nickname',
      'ownerNickname must be 1-24 safe letters or numbers with optional spaces, dots, underscores, or hyphens',
    );
  }
  return nickname;
}

export function validateClaimLobbyPlot(value) {
  requireExactKeys(
    value,
    new Set(['nickname']),
    new Set(['nickname']),
    'request body',
  );
  return { ownerNickname: sanitizeOwnerNickname(value.nickname) };
}

export function validateUpdateLobbyPlot(value) {
  requireExactKeys(
    value,
    new Set(['nickname']),
    new Set(['nickname']),
    'request body',
  );
  return { ownerNickname: sanitizeOwnerNickname(value.nickname) };
}

export function validateGrantPlotCoAuthor(value) {
  requireExactKeys(value, new Set(['coAuthorId']), ['coAuthorId'], 'co-author grant');
  if (!LOBBY_OWNER_ID_PATTERN.test(value.coAuthorId ?? '')) {
    throw new HttpError(422, 'invalid_co_author', 'coAuthorId must be a valid owner ID');
  }
  return { coAuthorId: value.coAuthorId.toLowerCase() };
}

export function validateReleaseLobbyPlot(value) {
  requireExactKeys(value, new Set(), new Set(), 'request body');
  return {};
}

export function isForbiddenCatalogId(value) {
  return typeof value === 'string' && FORBIDDEN_CATALOG_PATTERN.test(value);
}

function validateCatalogId(value, catalogIds) {
  if (typeof value !== 'string' || !CATALOG_ID_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_catalog_id', 'catalogId is invalid');
  }
  if (isForbiddenCatalogId(value)) {
    throw new HttpError(403, 'protected_lobby_item', 'Computer and system objects cannot be moved or added');
  }
  if (!catalogIds.has(value)) {
    throw new HttpError(422, 'unknown_catalog_id', 'catalogId is not in the public lobby catalog');
  }
  return value;
}

function validatePosition(value, {
  allowLegacyPublic = false,
  channel = DEFAULT_LOBBY_CHANNEL,
} = {}) {
  const persistentSpace = isPersistentSpaceChannel(validateLobbyChannel(channel));
  requireExactKeys(value, new Set(['x', 'y', 'z']), new Set(['x', 'y', 'z']), 'position');
  const position = {
    x: requireFiniteNumber(value.x, 'position.x', LOBBY_CONSTRAINTS.bounds.x, LOBBY_LAYOUT_EPSILON),
    y: requireFiniteNumber(value.y, 'position.y', LOBBY_CONSTRAINTS.bounds.y),
    z: requireFiniteNumber(value.z, 'position.z', LOBBY_CONSTRAINTS.bounds.z, LOBBY_LAYOUT_EPSILON),
  };
  for (const zone of LOBBY_CONSTRAINTS.protectedZones) {
    if (persistentSpace && zone.id === 'terminal') continue;
    const deltaX = position.x - zone.center.x;
    const deltaZ = position.z - zone.center.z;
    if (deltaX * deltaX + deltaZ * deltaZ <= zone.radius * zone.radius) {
      throw new HttpError(
        422,
        'lobby_protected_zone',
        `position must remain outside the protected ${zone.id} zone`,
        { zoneId: zone.id },
      );
    }
  }
  if (persistentSpace) return position;
  try {
    classifyLobbyPosition(position);
  } catch (error) {
    const isLegacyPublic = allowLegacyPublic
      && Math.abs(position.x) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON
      && Math.abs(position.z) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON;
    if (!isLegacyPublic) throw error;
  }
  return position;
}

function validateRotationY(value) {
  return requireFiniteNumber(value, 'rotationY', LOBBY_CONSTRAINTS.rotationY);
}

function validateScale(value) {
  return requireFiniteNumber(value, 'scale', LOBBY_CONSTRAINTS.scale);
}

export function validateCreateLobbyObject(
  value,
  catalogIds,
  { channel = DEFAULT_LOBBY_CHANNEL } = {},
) {
  requireExactKeys(
    value,
    new Set(['clientId', 'catalogId', 'position', 'rotationY', 'scale']),
    new Set(['clientId', 'catalogId', 'position', 'rotationY', 'scale']),
    'request body',
  );
  return {
    clientId: validateClientId(value.clientId),
    catalogId: validateCatalogId(value.catalogId, catalogIds),
    position: validatePosition(value.position, { channel }),
    rotationY: validateRotationY(value.rotationY),
    scale: validateScale(value.scale),
  };
}

export function validateUpdateLobbyObject(value, { channel = DEFAULT_LOBBY_CHANNEL } = {}) {
  requireExactKeys(
    value,
    new Set(['clientId', 'position', 'rotationY', 'scale']),
    new Set(['clientId']),
    'request body',
  );
  if (!Object.hasOwn(value, 'position') && !Object.hasOwn(value, 'rotationY') && !Object.hasOwn(value, 'scale')) {
    throw new HttpError(422, 'invalid_lobby_payload', 'At least one transform field is required');
  }
  const result = { clientId: validateClientId(value.clientId) };
  if (Object.hasOwn(value, 'position')) result.position = validatePosition(value.position, { channel });
  if (Object.hasOwn(value, 'rotationY')) result.rotationY = validateRotationY(value.rotationY);
  if (Object.hasOwn(value, 'scale')) result.scale = validateScale(value.scale);
  return result;
}

export function validateDeleteLobbyObject(value) {
  requireExactKeys(value, new Set(['clientId']), new Set(['clientId']), 'request body');
  return { clientId: validateClientId(value.clientId) };
}

export function validateInteractLobbyObject(value) {
  requireExactKeys(
    value,
    new Set(['requestId', 'baseSequence']),
    new Set(['requestId', 'baseSequence']),
    'request body',
  );
  if (typeof value.requestId !== 'string' || !INTERACTION_REQUEST_ID_PATTERN.test(value.requestId)) {
    throw new HttpError(422, 'invalid_interaction_request_id', 'requestId must be a safe 8-80 character identifier');
  }
  if (!Number.isSafeInteger(value.baseSequence) || value.baseSequence < 0 || value.baseSequence >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(422, 'invalid_interaction_sequence', 'baseSequence must be a non-negative safe integer');
  }
  return { requestId: value.requestId, baseSequence: value.baseSequence };
}

function clone(value) {
  return structuredClone(value);
}

function isoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validStoredInteraction(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 4 || !['sequence', 'startedAt', 'by', 'requestId'].every((key) => Object.hasOwn(value, key))) return false;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence >= Number.MAX_SAFE_INTEGER) return false;
  if (value.sequence === 0) return value.startedAt === null && value.by === null && value.requestId === null;
  return isoTimestamp(value.startedAt)
    && CLIENT_ID_PATTERN.test(value.by ?? '')
    && INTERACTION_REQUEST_ID_PATTERN.test(value.requestId ?? '');
}

function allowsLegacyPublicObject(object) {
  return !Object.hasOwn(object, 'plotId') || object.plotId === null;
}

function storedObjectPlotId(object, channel = DEFAULT_LOBBY_CHANNEL) {
  if (isPersistentSpaceChannel(channel)) return null;
  // v11/v12 kept historical shared objects anywhere inside the former ±18
  // lobby square with plotId:null. Expanding plots from 10m to 12m makes some
  // of that old transition band overlap the new logical plots, but loading a
  // new release must not silently convert or delete those persisted objects.
  // They remain legacy-public until a client explicitly submits a new valid
  // position, at which point the normal current layout rules take over.
  if (
    allowsLegacyPublicObject(object)
    && Math.abs(object.position.x) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON
    && Math.abs(object.position.z) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON
  ) return null;
  try {
    return classifyLobbyPosition(object.position);
  } catch (error) {
    if (
      allowsLegacyPublicObject(object)
      && Math.abs(object.position.x) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON
      && Math.abs(object.position.z) <= LEGACY_PUBLIC_HALF_SIZE + LOBBY_LAYOUT_EPSILON
    ) return null;
    throw error;
  }
}

function validStoredObject(object, stateRevision, catalogIds, channel = DEFAULT_LOBBY_CHANNEL) {
  if (!isPlainObject(object) || !OBJECT_ID_PATTERN.test(object.id ?? '')) return false;
  if (!CATALOG_ID_PATTERN.test(object.catalogId ?? '') || isForbiddenCatalogId(object.catalogId)) return false;
  if (!catalogIds.has(object.catalogId) && !LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(object.catalogId)) return false;
  if (REALM_MANAGED_CATALOG_IDS.has(object.catalogId) && !isRealmManagedObject(channel, object)) return false;
  if (!CLIENT_ID_PATTERN.test(object.createdBy ?? '') || !CLIENT_ID_PATTERN.test(object.updatedBy ?? '')) return false;
  if (!Number.isSafeInteger(object.revision) || object.revision < 1 || object.revision > stateRevision) return false;
  if (!isoTimestamp(object.createdAt) || !isoTimestamp(object.updatedAt)) return false;
  if (Object.hasOwn(object, 'interaction') && !validStoredInteraction(object.interaction)) return false;
  try {
    validatePosition(object.position, {
      allowLegacyPublic: allowsLegacyPublicObject(object),
      channel,
    });
    validateRotationY(object.rotationY);
    validateScale(object.scale);
    if (
      Object.hasOwn(object, 'plotId')
      && object.plotId !== storedObjectPlotId(object, channel)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function validStoredPlotCoAuthors(plot) {
  if (!Object.hasOwn(plot, 'coAuthors')) return true;
  const coAuthors = plot.coAuthors;
  if (!Array.isArray(coAuthors) || coAuthors.length > MAX_PLOT_CO_AUTHORS) return false;
  if (new Set(coAuthors).size !== coAuthors.length) return false;
  return coAuthors.every((coAuthor) => (
    LOBBY_OWNER_ID_PATTERN.test(coAuthor ?? '') && coAuthor !== plot.ownerId
  ));
}

function validStoredPlot(plot) {
  if (!isPlainObject(plot) || !PLOT_SLOT_BY_ID.has(plot.id)) return false;
  if (!LOBBY_OWNER_ID_PATTERN.test(plot.ownerId ?? '')) return false;
  if (!isoTimestamp(plot.claimedAt) || !isoTimestamp(plot.updatedAt)) return false;
  if (Date.parse(plot.updatedAt) < Date.parse(plot.claimedAt)) return false;
  if (!validStoredPlotCoAuthors(plot)) return false;
  try {
    return sanitizeOwnerNickname(plot.ownerNickname) === plot.ownerNickname;
  } catch {
    return false;
  }
}

function normalizedStoredObject(object, channel = DEFAULT_LOBBY_CHANNEL) {
  const position = validatePosition(object.position, {
    allowLegacyPublic: allowsLegacyPublicObject(object),
    channel,
  });
  return {
    id: object.id,
    catalogId: object.catalogId,
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    rotationY: Object.is(object.rotationY, -0) ? 0 : object.rotationY,
    scale: object.scale,
    createdBy: object.createdBy,
    updatedBy: object.updatedBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    revision: object.revision,
    plotId: storedObjectPlotId({ ...object, position }, channel),
    interaction: Object.hasOwn(object, 'interaction') ? clone(object.interaction) : {
      sequence: 0,
      startedAt: null,
      by: null,
      requestId: null,
    },
  };
}

function normalizedStoredPlot(plot) {
  return {
    id: plot.id,
    ownerId: plot.ownerId,
    ownerNickname: plot.ownerNickname,
    claimedAt: plot.claimedAt,
    updatedAt: plot.updatedAt,
    coAuthors: Array.isArray(plot.coAuthors) ? [...plot.coAuthors] : [],
  };
}

export function validateLobbyVehicleMetadata(value, itemId = 'unknown') {
  if (!isPlainObject(value)) {
    throw new Error(`Lobby catalog item ${itemId} has invalid vehicle metadata`);
  }
  const keys = Object.keys(value);
  const kind = value.kind;
  const limits = LOBBY_VEHICLE_LIMITS[kind];
  if (
    !limits
    || keys.length !== LOBBY_VEHICLE_FIELDS.size
    || keys.some((key) => !LOBBY_VEHICLE_FIELDS.has(key))
  ) {
    throw new Error(`Lobby catalog item ${itemId} has invalid vehicle metadata`);
  }
  for (const field of ['enterRadius', 'maxSpeed', 'maxAcceleration', 'maxAngularSpeed']) {
    const number = value[field];
    const range = limits[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < range.min || number > range.max) {
      throw new Error(`Lobby catalog item ${itemId} has invalid vehicle metadata`);
    }
  }
  return Object.freeze({
    kind,
    enterRadius: value.enterRadius,
    maxSpeed: value.maxSpeed,
    maxAcceleration: value.maxAcceleration,
    maxAngularSpeed: value.maxAngularSpeed,
  });
}

export function validateLobbyPortalMetadata(value, itemId = 'unknown') {
  if (
    !isPlainObject(value)
    || Object.keys(value).length !== LOBBY_PORTAL_FIELDS.size
    || Object.keys(value).some((key) => !LOBBY_PORTAL_FIELDS.has(key))
    || value.kind !== 'space'
    || !Array.isArray(value.destinations)
    || value.destinations.length < 2
    || value.destinations.length > 4
  ) throw new Error(`Lobby catalog item ${itemId} has invalid portal metadata`);

  const ids = new Set();
  const spaceIds = new Set();
  const destinations = value.destinations.map((destination) => {
    if (
      !isPlainObject(destination)
      || Object.keys(destination).length !== LOBBY_PORTAL_DESTINATION_FIELDS.size
      || Object.keys(destination).some((key) => !LOBBY_PORTAL_DESTINATION_FIELDS.has(key))
      || typeof destination.id !== 'string'
      || !LOBBY_PORTAL_ID_PATTERN.test(destination.id)
      || ids.has(destination.id)
      || typeof destination.label !== 'string'
      || destination.label !== destination.label.trim()
      || [...destination.label].length < 1
      || [...destination.label].length > 20
      || !PERSISTENT_SPACE_ID_SET.has(destination.spaceId)
      || destination.id !== destination.spaceId
      || spaceIds.has(destination.spaceId)
    ) throw new Error(`Lobby catalog item ${itemId} has invalid portal metadata`);
    ids.add(destination.id);
    spaceIds.add(destination.spaceId);
    return Object.freeze({
      id: destination.id,
      label: destination.label,
      spaceId: destination.spaceId,
    });
  });
  return Object.freeze({ kind: 'space', destinations: Object.freeze(destinations) });
}

export async function loadLobbyCatalog() {
  const catalog = JSON.parse(await readFile(LOBBY_CATALOG_PATH, 'utf8'));
  if (!isPlainObject(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.items)) {
    throw new Error('Lobby catalog has an invalid root');
  }
  const ids = new Set();
  for (const item of catalog.items) {
    if (!isPlainObject(item) || !CATALOG_ID_PATTERN.test(item.id ?? '') || isForbiddenCatalogId(item.id)) {
      throw new Error('Lobby catalog contains an invalid or protected ID');
    }
    if (ids.has(item.id)) throw new Error(`Lobby catalog contains duplicate ID: ${item.id}`);
    if (typeof item.name !== 'string' || !item.name || typeof item.category !== 'string' || !item.category) {
      throw new Error(`Lobby catalog item ${item.id} is missing display metadata`);
    }
    if (!['code', 'glb'].includes(item.kind)) throw new Error(`Lobby catalog item ${item.id} has invalid kind`);
    if (item.kind === 'code' && typeof item.code !== 'string') {
      throw new Error(`Lobby catalog code item ${item.id} is missing code`);
    }
    if (item.kind === 'glb' && !/^\/generated-assets\/[a-z0-9-]+\.glb$/.test(item.assetUrl ?? '')) {
      throw new Error(`Lobby catalog GLB item ${item.id} has invalid assetUrl`);
    }
    if (typeof item.defaultScale !== 'number' || item.defaultScale < LOBBY_CONSTRAINTS.scale.min || item.defaultScale > LOBBY_CONSTRAINTS.scale.max) {
      throw new Error(`Lobby catalog item ${item.id} has invalid defaultScale`);
    }
    if (Object.hasOwn(item, 'interaction')) {
      if (
        !isPlainObject(item.interaction)
        || !['cycle', 'timeline'].includes(item.interaction.mode)
        || !Number.isSafeInteger(item.interaction.durationMs)
        || item.interaction.durationMs < 0
        || item.interaction.durationMs > 120_000
        || !Number.isSafeInteger(item.interaction.cooldownMs)
        || item.interaction.cooldownMs < 100
        || item.interaction.cooldownMs > 120_000
      ) {
        throw new Error(`Lobby catalog item ${item.id} has invalid interaction metadata`);
      }
    }
    if (Object.hasOwn(item, 'vehicle')) {
      if (item.kind !== 'code') {
        throw new Error(`Lobby catalog item ${item.id} has invalid vehicle metadata`);
      }
      validateLobbyVehicleMetadata(item.vehicle, item.id);
    }
    if (Object.hasOwn(item, 'realmSpace')) {
      const managed = REALM_MANAGED_OBJECTS[item.realmSpace];
      if (!managed || managed.catalogId !== item.id || item.kind !== 'code') {
        throw new Error(`Lobby catalog item ${item.id} has invalid realm metadata`);
      }
    }
    if (Object.hasOwn(item, 'portal')) {
      if (item.kind !== 'code' || !Object.hasOwn(item, 'interaction') || Object.hasOwn(item, 'vehicle')) {
        throw new Error(`Lobby catalog item ${item.id} has invalid portal metadata`);
      }
      validateLobbyPortalMetadata(item.portal, item.id);
    }
    ids.add(item.id);
  }
  return Object.freeze({
    schemaVersion: catalog.schemaVersion,
    items: Object.freeze(catalog.items.map((item) => Object.freeze({
      ...item,
      ...(item.vehicle ? { vehicle: validateLobbyVehicleMetadata(item.vehicle, item.id) } : {}),
      ...(item.portal ? { portal: validateLobbyPortalMetadata(item.portal, item.id) } : {}),
    }))),
    constraints: LOBBY_CONSTRAINTS,
  });
}

export class LobbyStore {
  constructor({
    dataDirectory,
    catalog,
    clock = Date.now,
    idFactory = randomUUID,
    maxLoadedChannels = 512,
    maxPersistedChannels = 10_000,
    dynamicAssetLookup = () => null,
    dynamicResourceLimits = LOBBY_DYNAMIC_RESOURCE_LIMITS,
  }) {
    if (
      ![maxLoadedChannels, maxPersistedChannels].every((value) => Number.isSafeInteger(value) && value > 0)
      || maxPersistedChannels < maxLoadedChannels
    ) {
      throw new Error('Lobby channel limits are invalid');
    }
    if (typeof dynamicAssetLookup !== 'function') throw new Error('Lobby dynamic asset lookup is invalid');
    if (
      !isPlainObject(dynamicResourceLimits)
      || Object.keys(LOBBY_DYNAMIC_RESOURCE_LIMITS).some(
        (field) => !Number.isSafeInteger(dynamicResourceLimits[field]) || dynamicResourceLimits[field] < 1,
      )
    ) {
      throw new Error('Lobby dynamic resource limits are invalid');
    }
    this.directory = path.join(path.resolve(dataDirectory), 'lobby');
    this.legacyStatePath = path.join(this.directory, 'state.json');
    this.channelsDirectory = path.join(this.directory, 'channels');
    this.catalog = catalog;
    this.catalogIds = new Set(catalog.items.map((item) => item.id));
    this.interactionCatalog = new Map(catalog.items
      .filter((item) => item.interaction)
      .map((item) => [item.id, item.interaction]));
    this.clock = clock;
    this.idFactory = idFactory;
    this.maxLoadedChannels = maxLoadedChannels;
    this.maxPersistedChannels = maxPersistedChannels;
    this.dynamicAssetLookup = dynamicAssetLookup;
    this.dynamicResourceLimits = Object.freeze(Object.fromEntries(
      Object.keys(LOBBY_DYNAMIC_RESOURCE_LIMITS).map((field) => [field, dynamicResourceLimits[field]]),
    ));
    this.channels = new Map();
    this.channelLoads = new Map();
    this.channelPromotions = new Map();
    this.channelWriteReservations = new Map();
    this.knownChannels = new Set([DEFAULT_LOBBY_CHANNEL]);
    this.channelAccessSequence = 0;
    this.channelAllocationQueue = Promise.resolve();
  }

  now() {
    return new Date(this.clock()).toISOString();
  }

  async initialize() {
    try {
      const entries = await readdir(this.channelsDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && LOBBY_CHANNEL_PATTERN.test(entry.name)) this.knownChannels.add(entry.name);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const defaultChannel = await this.loadChannel(DEFAULT_LOBBY_CHANNEL, { create: true });
    if (!defaultChannel.persisted) {
      await this.allocateChannel(defaultChannel.channel, defaultChannel.statePath, defaultChannel.state);
      defaultChannel.persisted = true;
    }
  }

  channelStatePath(channel) {
    const safeChannel = validateLobbyChannel(channel);
    if (safeChannel === DEFAULT_LOBBY_CHANNEL) return this.legacyStatePath;
    const channelDirectory = path.resolve(this.channelsDirectory, safeChannel);
    if (!channelDirectory.startsWith(`${path.resolve(this.channelsDirectory)}${path.sep}`)) {
      throw new Error('Lobby channel path escaped its data directory');
    }
    return path.join(channelDirectory, 'state.json');
  }

  touchChannel(channelState) {
    channelState.lastAccess = ++this.channelAccessSequence;
  }

  reserveChannelWrite(channel) {
    this.channelWriteReservations.set(channel, (this.channelWriteReservations.get(channel) ?? 0) + 1);
  }

  releaseChannelWrite(channel) {
    const remaining = (this.channelWriteReservations.get(channel) ?? 1) - 1;
    if (remaining > 0) this.channelWriteReservations.set(channel, remaining);
    else this.channelWriteReservations.delete(channel);
  }

  evictChannels(excludedChannel = null) {
    while (this.channels.size > this.maxLoadedChannels) {
      const candidate = [...this.channels.values()]
        .filter((entry) => (
          entry.channel !== DEFAULT_LOBBY_CHANNEL
          && entry.channel !== excludedChannel
          && entry.pendingWrites === 0
          && !this.channelWriteReservations.has(entry.channel)
        ))
        .sort((left, right) => left.lastAccess - right.lastAccess)[0];
      if (!candidate) return;
      this.channels.delete(candidate.channel);
    }
  }

  cacheChannel(channelState) {
    this.touchChannel(channelState);
    this.channels.set(channelState.channel, channelState);
    this.evictChannels(channelState.channel);
    return channelState;
  }

  async allocateChannel(channel, statePath, state) {
    const allocation = this.channelAllocationQueue.then(async () => {
      if (!this.knownChannels.has(channel)) {
        if (this.knownChannels.size >= this.maxPersistedChannels) {
          throw new HttpError(507, 'lobby_channel_capacity_reached', 'No more lobby channels can be created');
        }
        await atomicWriteJson(statePath, state, 0o640);
        this.knownChannels.add(channel);
        return;
      }
      await atomicWriteJson(statePath, state, 0o640);
    });
    this.channelAllocationQueue = allocation.catch(() => {});
    return allocation;
  }

  async loadChannel(channel, { create = false } = {}) {
    const safeChannel = validateLobbyChannel(channel);
    const loaded = this.channels.get(safeChannel);
    if (loaded) {
      this.touchChannel(loaded);
      return loaded;
    }
    let load = this.channelLoads.get(safeChannel);
    if (!load) {
      load = this.initializeChannel(safeChannel)
        .finally(() => this.channelLoads.delete(safeChannel));
      this.channelLoads.set(safeChannel, load);
    }
    const channelState = await load;
    const result = create ? await this.promoteChannel(channelState) : channelState;
    return result;
  }

  async promoteChannel(channelState) {
    const loaded = this.channels.get(channelState.channel);
    if (loaded) return loaded;
    const pending = this.channelPromotions.get(channelState.channel);
    if (pending) return pending;
    const promotion = (async () => {
      const current = this.channels.get(channelState.channel);
      if (current) return current;
      return this.cacheChannel(channelState);
    })().finally(() => this.channelPromotions.delete(channelState.channel));
    this.channelPromotions.set(channelState.channel, promotion);
    return promotion;
  }

  async initializeChannel(channel) {
    const statePath = this.channelStatePath(channel);
    const persistentSpace = isPersistentSpaceChannel(channel);
    let stored;
    try {
      stored = JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    if (stored === undefined) {
      const updatedAt = this.now();
      const realmObject = createRealmManagedStoredObject(channel, 1, updatedAt);
      const state = {
        schemaVersion: STATE_SCHEMA_VERSION,
        revision: realmObject ? 1 : 0,
        updatedAt,
        objects: realmObject ? [realmObject] : [],
        plots: [],
      };
      const channelState = {
        channel,
        statePath,
        state,
        persisted: false,
        writeQueue: Promise.resolve(),
        pendingWrites: 0,
        lastAccess: 0,
      };
      return channelState;
    }
    if (
      !isPlainObject(stored) ||
      stored.schemaVersion !== STATE_SCHEMA_VERSION ||
      !Number.isSafeInteger(stored.revision) ||
      stored.revision < 0 || stored.revision >= Number.MAX_SAFE_INTEGER ||
      !isoTimestamp(stored.updatedAt) ||
      !Array.isArray(stored.objects) ||
      (Object.hasOwn(stored, 'plots') && !Array.isArray(stored.plots))
    ) {
      throw new Error('Stored lobby state is invalid');
    }

    const seenIds = new Set();
    let wasSanitized = Object.keys(stored).some(
      (key) => !['schemaVersion', 'revision', 'updatedAt', 'objects', 'plots'].includes(key),
    );
    const objects = [];
    for (const object of stored.objects) {
      if (!validStoredObject(object, stored.revision, this.catalogIds, channel) || seenIds.has(object.id)) {
        wasSanitized = true;
        continue;
      }
      seenIds.add(object.id);
      const normalized = normalizedStoredObject(object, channel);
      if (Object.keys(object).some((key) => !STORED_OBJECT_FIELDS.has(key))) wasSanitized = true;
      objects.push(normalized);
    }
    const managed = realmManagedObjectForChannel(channel);
    const storedObjectLimit = LOBBY_CONSTRAINTS.maxObjects + (managed ? 1 : 0);
    if (objects.length > storedObjectLimit) wasSanitized = true;
    const safeObjects = objects.slice(0, storedObjectLimit);
    const hasManagedObject = Boolean(
      managed && safeObjects.some((object) => isRealmManagedObject(channel, object)),
    );
    if (managed && !hasManagedObject) wasSanitized = true;
    const plots = [];
    const seenPlotIds = new Set();
    for (const plot of stored.plots ?? []) {
      if (
        persistentSpace
        || !validStoredPlot(plot)
        || seenPlotIds.has(plot.id)
      ) {
        wasSanitized = true;
        continue;
      }
      seenPlotIds.add(plot.id);
      if (Object.keys(plot).some((key) => !STORED_PLOT_FIELDS.has(key))) wasSanitized = true;
      plots.push(normalizedStoredPlot(plot));
    }
    const sanitizedRevision = stored.revision + 1;
    const sanitizedUpdatedAt = this.now();
    const sanitizedObjects = managed && !hasManagedObject
      ? [createRealmManagedStoredObject(channel, sanitizedRevision, sanitizedUpdatedAt), ...safeObjects]
      : safeObjects;
    const state = wasSanitized ? {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: sanitizedRevision,
      updatedAt: sanitizedUpdatedAt,
      objects: sanitizedObjects,
      plots,
    } : {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      objects: safeObjects,
      plots,
    };
    if (wasSanitized) await atomicWriteJson(statePath, state, 0o640);
    this.knownChannels.add(channel);
    return this.cacheChannel({
      channel,
      statePath,
      state,
      persisted: true,
      writeQueue: Promise.resolve(),
      pendingWrites: 0,
      lastAccess: 0,
    });
  }

  async getState(channel) {
    const channelState = await this.loadChannel(channel);
    const state = clone(channelState.state);
    this.evictChannels();
    return state;
  }

  async enqueue(channel, action) {
    const safeChannel = validateLobbyChannel(channel);
    this.reserveChannelWrite(safeChannel);
    let channelState;
    try {
      channelState = await this.loadChannel(safeChannel, { create: true });
      channelState.pendingWrites += 1;
      const result = channelState.writeQueue.then(() => action(channelState));
      channelState.writeQueue = result.catch(() => {});
      return await result;
    } finally {
      if (channelState) {
        channelState.pendingWrites -= 1;
        this.touchChannel(channelState);
      }
      this.releaseChannelWrite(safeChannel);
      this.evictChannels();
    }
  }

  async commit(channelState, {
    type,
    actor,
    objects = channelState.state.objects,
    plots = channelState.state.plots,
    changedObject,
    deletedObjectId,
    changedPlot,
    deletedPlotId,
  }) {
    const revision = channelState.state.revision + 1;
    const updatedAt = this.now();
    const normalizedObject = changedObject ? {
      ...changedObject,
      updatedBy: actor,
      updatedAt,
      revision,
    } : undefined;
    const committedObjects = normalizedObject
      ? objects.map((object) => object.id === normalizedObject.id ? normalizedObject : object)
      : objects;
    const normalizedPlot = changedPlot ? {
      ...changedPlot,
      claimedAt: changedPlot.claimedAt ?? updatedAt,
      updatedAt,
    } : undefined;
    const committedPlots = normalizedPlot
      ? plots.map((plot) => plot.id === normalizedPlot.id ? normalizedPlot : plot)
      : plots;
    const nextState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      revision,
      updatedAt,
      objects: committedObjects,
      plots: committedPlots,
    };
    if (channelState.persisted) {
      await atomicWriteJson(channelState.statePath, nextState, 0o640);
    } else {
      await this.allocateChannel(channelState.channel, channelState.statePath, nextState);
      channelState.persisted = true;
    }
    channelState.state = nextState;
    return {
      type,
      channel: channelState.channel,
      revision,
      updatedAt,
      serverTime: updatedAt,
      ...(normalizedObject ? { object: clone(normalizedObject) } : {}),
      ...(deletedObjectId ? { objectId: deletedObjectId } : {}),
      ...(normalizedPlot ? { plot: clone(normalizedPlot) } : {}),
      ...(deletedPlotId ? { plotId: deletedPlotId } : {}),
    };
  }

  plotClaim(state, plotId) {
    return state.plots.find((plot) => plot.id === plotId);
  }

  // 共笔权：梦主与受共笔的访客都可在此地块内凝结、调整与移除梦物
  requirePlotAccess(state, plotId, ownerId) {
    const plot = this.plotClaim(state, plotId);
    if (!plot || (plot.ownerId !== ownerId && !(plot.coAuthors ?? []).includes(ownerId))) {
      throw new HttpError(
        403,
        'lobby_plot_permission_denied',
        'Only the home plot owner or an invited co-author may change objects in this plot',
      );
    }
    return plot;
  }

  assertDynamicResourceBudget(objects) {
    const uniqueCatalogIds = new Set();
    const usage = {
      uniqueBytes: 0,
      uniqueTexturePixels: 0,
      renderedVertices: 0,
      renderedTriangles: 0,
    };
    for (const object of objects) {
      if (!LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(object.catalogId)) continue;
      const record = this.dynamicAssetLookup(object.catalogId);
      if (!record) {
        throw new HttpError(409, 'lobby_asset_registry_unavailable', 'A channel asset is no longer available');
      }
      const resources = {
        uniqueBytes: record.bytes,
        uniqueTexturePixels: record.stats?.texturePixels,
        renderedVertices: record.stats?.renderedVertices,
        renderedTriangles: record.stats?.renderedTriangles,
      };
      if (Object.values(resources).some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`Lobby asset ${object.catalogId} has invalid resource metadata`);
      }
      usage.renderedVertices += resources.renderedVertices;
      usage.renderedTriangles += resources.renderedTriangles;
      if (!uniqueCatalogIds.has(object.catalogId)) {
        uniqueCatalogIds.add(object.catalogId);
        usage.uniqueBytes += resources.uniqueBytes;
        usage.uniqueTexturePixels += resources.uniqueTexturePixels;
      }
    }
    for (const field of Object.keys(LOBBY_DYNAMIC_RESOURCE_LIMITS)) {
      const maximum = this.dynamicResourceLimits[field];
      if (usage[field] > maximum) {
        throw new HttpError(
          409,
          'lobby_asset_channel_resource_limit',
          `Channel uploaded assets exceed the ${field} resource budget`,
          { field, maximum, actual: usage[field] },
        );
      }
    }
  }

  create(channel, input) {
    return this.enqueue(channel, async (channelState) => {
      if (REALM_MANAGED_CATALOG_IDS.has(input.catalogId)) {
        throw new HttpError(403, 'protected_realm_item', 'Realm landmarks are created and managed by the platform');
      }
      const publicObjectCount = channelState.state.objects.filter(
        (object) => !isRealmManagedObject(channelState.channel, object),
      ).length;
      if (publicObjectCount >= LOBBY_CONSTRAINTS.maxObjects) {
        throw new HttpError(409, 'lobby_full', `The lobby cannot contain more than ${LOBBY_CONSTRAINTS.maxObjects} objects`);
      }
      if (
        LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(input.catalogId)
        && channelState.state.objects.filter((object) => object.catalogId === input.catalogId).length
          >= MAX_DYNAMIC_ASSET_INSTANCES_PER_CHANNEL
      ) {
        throw new HttpError(
          409,
          'lobby_asset_instance_limit',
          `A channel cannot contain more than ${MAX_DYNAMIC_ASSET_INSTANCES_PER_CHANNEL} instances of one uploaded asset`,
        );
      }
      if (LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(input.catalogId)) {
        const dynamicCatalogIds = new Set(channelState.state.objects
          .map((object) => object.catalogId)
          .filter((catalogId) => LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(catalogId)));
        if (!dynamicCatalogIds.has(input.catalogId) && dynamicCatalogIds.size >= MAX_DYNAMIC_ASSET_UNIQUE_PER_CHANNEL) {
          throw new HttpError(
            409,
            'lobby_asset_channel_unique_limit',
            `A channel cannot contain more than ${MAX_DYNAMIC_ASSET_UNIQUE_PER_CHANNEL} unique uploaded assets`,
          );
        }
      }
      if (
        LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(input.catalogId)
        && channelState.state.objects.filter((object) => LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(object.catalogId)).length
          >= MAX_DYNAMIC_ASSET_INSTANCES_TOTAL_PER_CHANNEL
      ) {
        throw new HttpError(
          409,
          'lobby_asset_channel_limit',
          `A channel cannot contain more than ${MAX_DYNAMIC_ASSET_INSTANCES_TOTAL_PER_CHANNEL} uploaded asset instances`,
        );
      }
      if (LOBBY_DYNAMIC_ASSET_ID_PATTERN.test(input.catalogId)) {
        this.assertDynamicResourceBudget([
          ...channelState.state.objects,
          { catalogId: input.catalogId },
        ]);
      }
      let id;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        id = this.idFactory();
        if (OBJECT_ID_PATTERN.test(id) && !channelState.state.objects.some((object) => object.id === id)) break;
        id = undefined;
      }
      if (!id) throw new Error('Could not allocate a unique lobby object ID');
      const position = validatePosition(input.position, { channel: channelState.channel });
      const plotId = isPersistentSpaceChannel(channelState.channel)
        ? null
        : classifyLobbyPosition(position);
      if (plotId) this.requirePlotAccess(channelState.state, plotId, input.clientId);
      const createdAt = this.now();
      const object = {
        id,
        catalogId: input.catalogId,
        position,
        rotationY: input.rotationY,
        scale: input.scale,
        createdBy: input.clientId,
        updatedBy: input.clientId,
        createdAt,
        updatedAt: createdAt,
        revision: channelState.state.revision + 1,
        plotId,
        interaction: { sequence: 0, startedAt: null, by: null, requestId: null },
      };
      const objects = [...channelState.state.objects, object];
      return this.commit(channelState, {
        type: 'object.created',
        actor: input.clientId,
        objects,
        changedObject: object,
      });
    });
  }

  update(channel, id, input) {
    return this.enqueue(channel, async (channelState) => {
      const existing = channelState.state.objects.find((object) => object.id === id);
      if (!existing) throw new HttpError(404, 'lobby_object_not_found', 'Lobby object was not found');
      if (isRealmManagedObject(channelState.channel, existing)) {
        throw new HttpError(403, 'protected_realm_item', 'Realm landmarks cannot be moved or removed');
      }
      if (isForbiddenCatalogId(existing.catalogId)) {
        throw new HttpError(403, 'protected_lobby_item', 'Computer and system objects cannot be moved or removed');
      }
      const persistentSpace = isPersistentSpaceChannel(channelState.channel);
      if (!persistentSpace && existing.plotId) {
        this.requirePlotAccess(channelState.state, existing.plotId, input.clientId);
      }
      const position = Object.hasOwn(input, 'position')
        ? validatePosition(input.position, { channel: channelState.channel })
        : undefined;
      const targetPlotId = persistentSpace
        ? null
        : position
          ? classifyLobbyPosition(position)
          : existing.plotId;
      if (targetPlotId) this.requirePlotAccess(channelState.state, targetPlotId, input.clientId);
      const object = {
        ...existing,
        ...(position ? { position } : {}),
        ...(Object.hasOwn(input, 'rotationY') ? { rotationY: input.rotationY } : {}),
        ...(Object.hasOwn(input, 'scale') ? { scale: input.scale } : {}),
        plotId: targetPlotId,
      };
      const objects = channelState.state.objects.map((candidate) => candidate.id === id ? object : candidate);
      return this.commit(channelState, {
        type: 'object.updated',
        actor: input.clientId,
        objects,
        changedObject: object,
      });
    });
  }

  interact(channel, id, input) {
    return this.enqueue(channel, async (channelState) => {
      const existing = channelState.state.objects.find((object) => object.id === id);
      if (!existing) throw new HttpError(404, 'lobby_object_not_found', 'Lobby object was not found');
      if (isForbiddenCatalogId(existing.catalogId)) {
        throw new HttpError(403, 'protected_lobby_item', 'Computer and system objects cannot be interacted with');
      }
      const configuration = this.interactionCatalog.get(existing.catalogId);
      if (!configuration) throw new HttpError(422, 'lobby_object_not_interactive', 'This lobby object is not interactive');
      const current = existing.interaction ?? { sequence: 0, startedAt: null, by: null, requestId: null };
      if (current.requestId === input.requestId) {
        return {
          type: 'object.interacted',
          channel: channelState.channel,
          revision: channelState.state.revision,
          updatedAt: channelState.state.updatedAt,
          serverTime: this.now(),
          object: clone(existing),
          replayed: true,
        };
      }
      if (input.baseSequence !== current.sequence) {
        throw new HttpError(409, 'lobby_interaction_conflict', 'The lobby object interaction state has changed', {
          currentSequence: current.sequence,
        });
      }
      if (current.startedAt) {
        const elapsed = this.clock() - Date.parse(current.startedAt);
        if (elapsed < configuration.cooldownMs) {
          throw new HttpError(409, 'lobby_interaction_cooldown', 'This lobby object interaction is still in progress', {
            currentSequence: current.sequence,
            retryAfterMs: Math.max(1, configuration.cooldownMs - Math.max(0, elapsed)),
          });
        }
      }
      const object = {
        ...existing,
        interaction: {
          sequence: current.sequence + 1,
          startedAt: this.now(),
          by: input.clientId,
          requestId: input.requestId,
        },
      };
      const objects = channelState.state.objects.map((candidate) => candidate.id === id ? object : candidate);
      return this.commit(channelState, {
        type: 'object.interacted',
        actor: input.clientId,
        objects,
        changedObject: object,
      });
    });
  }

  delete(channel, id, input) {
    return this.enqueue(channel, async (channelState) => {
      const existing = channelState.state.objects.find((object) => object.id === id);
      if (!existing) throw new HttpError(404, 'lobby_object_not_found', 'Lobby object was not found');
      if (isRealmManagedObject(channelState.channel, existing)) {
        throw new HttpError(403, 'protected_realm_item', 'Realm landmarks cannot be moved or removed');
      }
      if (isForbiddenCatalogId(existing.catalogId)) {
        throw new HttpError(403, 'protected_lobby_item', 'Computer and system objects cannot be moved or removed');
      }
      if (existing.plotId) this.requirePlotAccess(channelState.state, existing.plotId, input.clientId);
      const objects = channelState.state.objects.filter((object) => object.id !== id);
      return this.commit(channelState, {
        type: 'object.deleted',
        actor: input.clientId,
        objects,
        deletedObjectId: id,
      });
    });
  }

  persistRealmVehiclePose(channel, id, pose) {
    return this.enqueue(channel, async (channelState) => {
      const existing = channelState.state.objects.find((object) => object.id === id);
      if (!existing || !isRealmManagedObject(channelState.channel, existing)) {
        throw new HttpError(404, 'realm_vehicle_not_found', 'Realm vehicle was not found');
      }
      const position = validatePosition({ x: pose.x, y: 0, z: pose.z }, { channel: channelState.channel });
      const rotationY = validateRotationY(pose.yaw);
      const object = { ...existing, position, rotationY, plotId: null };
      const objects = channelState.state.objects.map((candidate) => candidate.id === id ? object : candidate);
      return this.commit(channelState, {
        type: 'realm.vehicle.parked',
        actor: REALM_SYSTEM_ACTOR,
        objects,
        changedObject: object,
      });
    });
  }

  claimPlot(channel, plotId, input) {
    if (isPersistentSpaceChannel(channel)) {
      throw new HttpError(403, 'persistent_space_plots_disabled', 'Persistent spaces do not have private home plots');
    }
    const safePlotId = validatePlotId(plotId);
    return this.enqueue(channel, async (channelState) => {
      if (this.plotClaim(channelState.state, safePlotId)) {
        throw new HttpError(409, 'lobby_plot_already_claimed', 'This home plot has already been claimed');
      }
      const plot = {
        id: safePlotId,
        ownerId: input.ownerId,
        ownerNickname: input.ownerNickname,
        claimedAt: null,
        updatedAt: null,
        coAuthors: [],
      };
      return this.commit(channelState, {
        type: 'plot.claimed',
        actor: input.ownerId,
        plots: [...channelState.state.plots, plot],
        changedPlot: plot,
      });
    });
  }

  updatePlot(channel, plotId, input) {
    if (isPersistentSpaceChannel(channel)) {
      throw new HttpError(403, 'persistent_space_plots_disabled', 'Persistent spaces do not have private home plots');
    }
    const safePlotId = validatePlotId(plotId);
    return this.enqueue(channel, async (channelState) => {
      const existing = this.plotClaim(channelState.state, safePlotId);
      if (!existing) throw new HttpError(404, 'lobby_plot_claim_not_found', 'Lobby plot claim was not found');
      if (existing.ownerId !== input.ownerId) {
        throw new HttpError(403, 'lobby_plot_permission_denied', 'Only the home plot owner may update this plot');
      }
      const plot = { ...existing, ownerNickname: input.ownerNickname };
      const plots = channelState.state.plots.map((candidate) => candidate.id === safePlotId ? plot : candidate);
      return this.commit(channelState, {
        type: 'plot.updated',
        actor: input.ownerId,
        plots,
        changedPlot: plot,
      });
    });
  }

  // 共笔权授予（《眠海》第七章）：梦主在场时可将域内创作权授予访客
  grantPlotCoAuthor(channel, plotId, { ownerId, coAuthorId }) {
    if (isPersistentSpaceChannel(channel)) {
      throw new HttpError(403, 'persistent_space_plots_disabled', 'Persistent spaces do not have private home plots');
    }
    const safePlotId = validatePlotId(plotId);
    return this.enqueue(channel, async (channelState) => {
      const existing = this.plotClaim(channelState.state, safePlotId);
      if (!existing) throw new HttpError(404, 'lobby_plot_claim_not_found', 'Lobby plot claim was not found');
      if (existing.ownerId !== ownerId) {
        throw new HttpError(403, 'lobby_plot_permission_denied', 'Only the home plot owner may grant co-dreaming rights');
      }
      if (coAuthorId === existing.ownerId) {
        throw new HttpError(422, 'invalid_co_author', 'The plot owner already holds every right to this plot');
      }
      const coAuthors = existing.coAuthors ?? [];
      if (coAuthors.includes(coAuthorId)) {
        throw new HttpError(409, 'lobby_plot_co_author_exists', 'This dreamer already holds co-dreaming rights');
      }
      if (coAuthors.length >= MAX_PLOT_CO_AUTHORS) {
        throw new HttpError(
          409,
          'lobby_plot_co_author_limit',
          `A home plot cannot grant co-dreaming rights to more than ${MAX_PLOT_CO_AUTHORS} dreamers`,
        );
      }
      const plot = { ...existing, coAuthors: [...coAuthors, coAuthorId] };
      const plots = channelState.state.plots.map((candidate) => candidate.id === safePlotId ? plot : candidate);
      return this.commit(channelState, {
        type: 'plot.updated',
        actor: ownerId,
        plots,
        changedPlot: plot,
      });
    });
  }

  // 撤回共笔：梦主可随时撤回；受共笔者也可自行退出
  revokePlotCoAuthor(channel, plotId, { ownerId, coAuthorId }) {
    if (isPersistentSpaceChannel(channel)) {
      throw new HttpError(403, 'persistent_space_plots_disabled', 'Persistent spaces do not have private home plots');
    }
    const safePlotId = validatePlotId(plotId);
    if (!LOBBY_OWNER_ID_PATTERN.test(coAuthorId ?? '')) {
      throw new HttpError(422, 'invalid_co_author', 'coAuthorId must be a valid owner ID');
    }
    const safeCoAuthorId = coAuthorId.toLowerCase();
    return this.enqueue(channel, async (channelState) => {
      const existing = this.plotClaim(channelState.state, safePlotId);
      if (!existing) throw new HttpError(404, 'lobby_plot_claim_not_found', 'Lobby plot claim was not found');
      if (existing.ownerId !== ownerId && safeCoAuthorId !== ownerId) {
        throw new HttpError(403, 'lobby_plot_permission_denied', 'Only the home plot owner or the co-author may revoke co-dreaming rights');
      }
      const coAuthors = existing.coAuthors ?? [];
      if (!coAuthors.includes(safeCoAuthorId)) {
        throw new HttpError(404, 'lobby_plot_co_author_not_found', 'This dreamer does not hold co-dreaming rights');
      }
      const plot = { ...existing, coAuthors: coAuthors.filter((candidate) => candidate !== safeCoAuthorId) };
      const plots = channelState.state.plots.map((candidate) => candidate.id === safePlotId ? plot : candidate);
      return this.commit(channelState, {
        type: 'plot.updated',
        actor: ownerId,
        plots,
        changedPlot: plot,
      });
    });
  }

  releasePlot(channel, plotId, input) {
    if (isPersistentSpaceChannel(channel)) {
      throw new HttpError(403, 'persistent_space_plots_disabled', 'Persistent spaces do not have private home plots');
    }
    const safePlotId = validatePlotId(plotId);
    return this.enqueue(channel, async (channelState) => {
      const existing = this.plotClaim(channelState.state, safePlotId);
      if (!existing) throw new HttpError(404, 'lobby_plot_claim_not_found', 'Lobby plot claim was not found');
      if (existing.ownerId !== input.ownerId) {
        throw new HttpError(403, 'lobby_plot_permission_denied', 'Only the home plot owner may release this plot');
      }
      if (channelState.state.objects.some((object) => object.plotId === safePlotId)) {
        throw new HttpError(409, 'lobby_plot_not_empty', 'A home plot must be empty before it can be released');
      }
      const plots = channelState.state.plots.filter((plot) => plot.id !== safePlotId);
      return this.commit(channelState, {
        type: 'plot.released',
        actor: input.ownerId,
        plots,
        deletedPlotId: safePlotId,
      });
    });
  }
}

export class FixedWindowCounter {
  constructor(limit, windowMs, clock, { sweepEvery = 64, maxEntries = 10_000 } = {}) {
    if (
      ![limit, windowMs, sweepEvery, maxEntries].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      typeof clock !== 'function'
    ) {
      throw new Error('Fixed-window counter settings are invalid');
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
    this.sweepEvery = sweepEvery;
    this.maxEntries = maxEntries;
    this.operations = 0;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  sweep(now = this.clock()) {
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
    }
  }

  inspect(key) {
    const now = this.clock();
    this.operations += 1;
    if (this.operations % this.sweepEvery === 0) this.sweep(now);
    const current = this.entries.get(key);
    if (current && now >= current.resetAt) this.entries.delete(key);
    if (current && now < current.resetAt) return current;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.values().next().value;
      return { count: this.limit, resetAt: oldest?.resetAt ?? now + this.windowMs, overflow: true };
    }
    return { count: 0, resetAt: now + this.windowMs };
  }

  consume(key, entry) {
    if (entry.overflow) return;
    this.entries.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
  }
}

export class LobbyRateLimiter {
  constructor({ clock = Date.now, windowMs = 60_000, maxPerClient = 30, maxPerIp = 120 } = {}) {
    if (![windowMs, maxPerClient, maxPerIp].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Lobby rate limits must be positive integers');
    }
    this.clock = clock;
    this.client = new FixedWindowCounter(maxPerClient, windowMs, clock);
    this.ip = new FixedWindowCounter(maxPerIp, windowMs, clock);
  }

  check(clientId, ip) {
    const clientEntry = this.client.inspect(clientId);
    const ipEntry = this.ip.inspect(ip);
    const now = this.clock();
    if (clientEntry.count >= this.client.limit || ipEntry.count >= this.ip.limit) {
      const resetAt = Math.max(
        clientEntry.count >= this.client.limit ? clientEntry.resetAt : now,
        ipEntry.count >= this.ip.limit ? ipEntry.resetAt : now,
      );
      throw new HttpError(429, 'lobby_rate_limited', 'Too many lobby changes; please wait before trying again', {
        retryAfterMs: Math.max(1, resetAt - now),
      });
    }
    this.client.consume(clientId, clientEntry);
    this.ip.consume(ip, ipEntry);
  }
}

function normalizedIp(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return net.isIP(candidate) ? candidate : null;
}

export function requestIp(request) {
  const remote = normalizedIp(request.socket.remoteAddress) ?? 'unknown';
  if (remote === '127.0.0.1' || remote === '::1') {
    const forwardedParts = String(request.headers['x-forwarded-for'] ?? '').split(',');
    const forwarded = forwardedParts[forwardedParts.length - 1];
    return normalizedIp(request.headers['x-real-ip']) ?? normalizedIp(forwarded) ?? remote;
  }
  return remote;
}

function sseFrame(event, data, id = undefined) {
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const MAX_SSE_SYNCHRONIZATION_CHANGES = 256;

export class LobbyEventHub {
  constructor({
    heartbeatMs = 15_000,
    clock = Date.now,
    maxTotal = 500,
    maxPerIp = 8,
    backpressureTimeoutMs = 5_000,
  } = {}) {
    if (
      ![heartbeatMs, maxTotal, maxPerIp, backpressureTimeoutMs].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      heartbeatMs < 100 ||
      backpressureTimeoutMs < 100
    ) {
      throw new Error('Lobby SSE settings are invalid');
    }
    this.heartbeatMs = heartbeatMs;
    this.clock = clock;
    this.maxTotal = maxTotal;
    this.maxPerIp = maxPerIp;
    this.backpressureTimeoutMs = backpressureTimeoutMs;
    this.connections = new Map();
    this.ipConnections = new Map();
    this.heartbeat = null;
  }

  connect(request, response, channel, clientId, state, corsOrigin, { synchronize = false } = {}) {
    const safeChannel = validateLobbyChannel(channel);
    if (typeof synchronize !== 'boolean') throw new Error('Lobby SSE synchronization setting is invalid');
    const ip = requestIp(request);
    if (this.connections.size >= this.maxTotal) {
      throw new HttpError(
        429,
        'lobby_sse_connection_limit',
        'The lobby live connection limit has been reached',
        { scope: 'total', limit: this.maxTotal },
      );
    }
    if ((this.ipConnections.get(ip) ?? 0) >= this.maxPerIp) {
      throw new HttpError(
        429,
        'lobby_sse_connection_limit',
        'Too many lobby live connections from this network',
        { scope: 'ip', limit: this.maxPerIp },
      );
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': corsOrigin,
      'X-Content-Type-Options': 'nosniff',
    });
    this.connections.set(response, {
      channel: safeChannel,
      clientId,
      ip,
      backpressured: false,
      backpressureTimer: null,
      drainListener: null,
      synchronizing: synchronize,
      synchronizationChanges: [],
      synchronizationOverflow: false,
      lastRevision: state.revision,
    });
    this.ipConnections.set(ip, (this.ipConnections.get(ip) ?? 0) + 1);

    const disconnect = () => {
      this.disconnect(response, true);
    };
    request.once('aborted', disconnect);
    response.once('close', disconnect);

    this.writeFrame(response, `retry: 3000\n\n${sseFrame('snapshot', state, state.revision)}`);
    if (!this.connections.has(response)) return;
    this.broadcastPresence(safeChannel);
    this.startHeartbeat();
  }

  armBackpressure(response, connection) {
    connection.backpressured = true;
    const drainListener = () => {
      const current = this.connections.get(response);
      if (current !== connection) return;
      clearTimeout(current.backpressureTimer);
      current.backpressureTimer = null;
      current.drainListener = null;
      current.backpressured = false;
    };
    connection.drainListener = drainListener;
    response.once('drain', drainListener);
    connection.backpressureTimer = setTimeout(() => {
      const current = this.connections.get(response);
      if (current !== connection || !current.backpressured) return;
      this.disconnect(response, false);
      response.destroy();
      this.broadcastPresence(connection.channel);
    }, this.backpressureTimeoutMs);
    connection.backpressureTimer.unref?.();
  }

  writeFrame(response, frame, { disconnectIfBlocked = false } = {}) {
    const connection = this.connections.get(response);
    if (!connection || response.destroyed || response.writableEnded) {
      this.disconnect(response, false);
      return false;
    }
    if (connection.backpressured) {
      if (disconnectIfBlocked) {
        this.disconnect(response, false);
        response.destroy();
      }
      return false;
    }
    let writable;
    try {
      writable = response.write(frame);
    } catch {
      this.disconnect(response, false);
      response.destroy();
      return false;
    }
    if (!writable) this.armBackpressure(response, connection);
    return true;
  }

  disconnect(response, notifyPresence) {
    const connection = this.connections.get(response);
    if (!connection) return false;
    this.connections.delete(response);
    if (connection.drainListener) response.off('drain', connection.drainListener);
    if (connection.backpressureTimer) clearTimeout(connection.backpressureTimer);
    const ipCount = (this.ipConnections.get(connection.ip) ?? 1) - 1;
    if (ipCount > 0) this.ipConnections.set(connection.ip, ipCount);
    else this.ipConnections.delete(connection.ip);
    if (this.connections.size === 0) this.stopHeartbeat();
    if (notifyPresence) this.broadcastPresence(connection.channel);
    return true;
  }

  broadcastPresence(channel, allowCorrection = true) {
    const safeChannel = validateLobbyChannel(channel);
    const channelEntries = [...this.connections.entries()]
      .filter(([, connection]) => connection.channel === safeChannel);
    const clients = new Set(channelEntries.map(([, { clientId }]) => clientId));
    const payload = { channel: safeChannel, online: clients.size, connections: channelEntries.length };
    const previousSize = this.connections.size;
    for (const [response] of channelEntries) {
      this.writeFrame(response, sseFrame('presence', payload));
    }
    if (allowCorrection && this.connections.size !== previousSize) this.broadcastPresence(safeChannel, false);
  }

  writeChange(response, connection, change) {
    const written = this.writeFrame(
      response,
      `${sseFrame('change', change, change.revision)}${sseFrame(change.type, change, change.revision)}`,
      { disconnectIfBlocked: true },
    );
    if (written) connection.lastRevision = Math.max(connection.lastRevision, change.revision);
    return written;
  }

  finishSynchronization(response, state) {
    const connection = this.connections.get(response);
    if (!connection || !connection.synchronizing) return true;
    if (
      state?.channel !== connection.channel
      || !Number.isSafeInteger(state.revision)
      || state.revision < 0
    ) {
      throw new Error('Lobby SSE synchronization snapshot is invalid');
    }
    if (connection.synchronizationOverflow) {
      connection.synchronizationChanges = [];
      connection.synchronizationOverflow = false;
      return false;
    }

    const queued = connection.synchronizationChanges;
    connection.synchronizationChanges = [];
    if (state.revision > connection.lastRevision) {
      if (!this.writeFrame(response, sseFrame('snapshot', state, state.revision), { disconnectIfBlocked: true })) {
        return true;
      }
      connection.lastRevision = state.revision;
    }
    for (const change of queued) {
      if (change.revision <= state.revision) continue;
      if (!this.writeChange(response, connection, change)) return true;
    }
    connection.synchronizing = false;
    return true;
  }

  publish(channel, change) {
    const safeChannel = validateLobbyChannel(channel);
    if (change?.channel !== undefined && change.channel !== safeChannel) {
      throw new Error('Lobby change channel does not match its event stream');
    }
    const previousSize = this.connections.size;
    for (const [response, connection] of [...this.connections.entries()]) {
      if (connection.channel !== safeChannel) continue;
      if (connection.synchronizing) {
        if (connection.synchronizationChanges.length < MAX_SSE_SYNCHRONIZATION_CHANGES) {
          connection.synchronizationChanges.push(clone(change));
        } else {
          connection.synchronizationOverflow = true;
        }
        continue;
      }
      this.writeChange(response, connection, change);
    }
    if (this.connections.size !== previousSize) this.broadcastPresence(safeChannel);
  }

  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const payload = { timestamp: new Date(this.clock()).toISOString() };
      const previousSize = this.connections.size;
      for (const response of [...this.connections.keys()]) {
        this.writeFrame(response, sseFrame('heartbeat', payload));
      }
      if (this.connections.size !== previousSize) {
        const channels = new Set([...this.connections.values()].map((connection) => connection.channel));
        for (const channel of channels) this.broadcastPresence(channel);
      }
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  close() {
    this.stopHeartbeat();
    for (const response of [...this.connections.keys()]) {
      this.disconnect(response, false);
      response.destroy();
    }
  }
}
