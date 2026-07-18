import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { AVATAR_ID_PATTERN, validateAvatarText } from './avatar.js';
import { HttpError } from './errors.js';
import {
  DEFAULT_LOBBY_CHANNEL,
  requestIp,
  validateClientId,
  validateLobbyChannel,
} from './lobby.js';

export const MULTIPLAYER_BOUNDS = Object.freeze({
  x: Object.freeze({ min: -40, max: 40 }),
  y: Object.freeze({ min: -2, max: 12 }),
  z: Object.freeze({ min: -40, max: 40 }),
  yaw: Object.freeze({ min: -Math.PI, max: Math.PI }),
});

export const LOBBY_MULTIPLAYER_BOUNDS = Object.freeze({
  x: Object.freeze({ min: -54, max: 54 }),
  y: Object.freeze({ min: 0, max: 8 }),
  z: Object.freeze({ min: -54, max: 54 }),
  yaw: MULTIPLAYER_BOUNDS.yaw,
});

export const BUILTIN_AVATAR_URLS = Object.freeze({
  'preset-ink-chibi': '/generated-assets/whiteroom-avatar-ink-chibi.glb',
  'preset-cloud-doll': '/generated-assets/whiteroom-avatar-cloud-doll.glb',
});

const MAX_MESSAGE_BYTES = 1_024;
const MAX_BUFFERED_BYTES = 64 * 1024;
const POSES_PER_SECOND = 15;
const MESSAGES_PER_SECOND = 30;
const PROFILE_BURST = 6;
const PROFILE_REFILL_MS = 400;
const PROFILE_NOTICE_INTERVAL_MS = 1_000;
const PARTY_MAX_MEMBERS = 4;
const MULTIPLAYER_FEATURES = Object.freeze([
  'vehicle-lease-v1',
  'vehicle-autoland-v1',
  'persistent-space-v1',
]);
const VEHICLE_STATES_PER_SECOND = 15;
const VEHICLE_LEASE_MS = 4_000;
const VEHICLE_STATE_SIMULATION_INTERVAL_MS = 100;
const VEHICLE_MOTION_CREDIT_MAX_MS = 300;
const VEHICLE_MIN_MOTION_CREDIT_MS = 25;
const VEHICLE_POSE_FRESHNESS_MS = 5_000;
const VEHICLE_POSITION_TOLERANCE = 0.75;
const VEHICLE_ANGLE_TOLERANCE = 0.15;
const VEHICLE_RECOVERY_TICK_MS = 50;
const VEHICLE_RECOVERY_DESCENT_SPEED = 4;
const VEHICLE_RECOVERY_MAX_LANDING_MS = 25_000;
const VEHICLE_RECOVERY_NORMAL_MARGIN_MS = 3_000;
const VEHICLE_RECOVERY_NORMAL_ALTITUDE = VEHICLE_RECOVERY_DESCENT_SPEED
  * ((VEHICLE_RECOVERY_MAX_LANDING_MS - VEHICLE_RECOVERY_NORMAL_MARGIN_MS) / 1_000);
const VEHICLE_RECOVERY_GROUND_EPSILON = 0.03;
const VEHICLE_RECOVERY_SPEED_EPSILON = 0.05;
const VEHICLE_RECOVERY_ANGLE_EPSILON = 0.02;
const VEHICLE_EXIT_GROUND_EPSILON = 0.15;
const VEHICLE_EXIT_MAX_SPEED = 1.25;
const PARTY_ID_PATTERN = /^party-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const LEVEL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const LOBBY_OBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const VEHICLE_LEASE_ID_PATTERN = /^lease-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSE_KEYS = new Set(['type', 'x', 'y', 'z', 'yaw', 'moving']);
const PROFILE_KEYS = new Set(['type', 'name', 'avatarId']);
const PARTY_CREATE_KEYS = new Set(['type', 'levelId', 'levelVersion']);
const PARTY_RESPOND_KEYS = new Set(['type', 'partyId', 'accept', 'levelVersion']);
const PARTY_CANCEL_KEYS = new Set(['type', 'partyId']);
const RETURN_LOBBY_KEYS = new Set(['type']);
const VEHICLE_ENTER_KEYS = new Set(['type', 'objectId']);
const VEHICLE_STATE_KEYS = new Set([
  'type', 'objectId', 'leaseId', 'seq',
  'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz',
]);
const VEHICLE_EXIT_KEYS = new Set(['type', 'objectId', 'leaseId', 'seq']);
const VEHICLE_RECOVER_KEYS = new Set(['type', 'objectId', 'leaseId']);
const VEHICLE_MOTION_LIMITS = Object.freeze({
  car: Object.freeze({
    x: LOBBY_MULTIPLAYER_BOUNDS.x,
    y: Object.freeze({ min: 0, max: 1.5 }),
    z: LOBBY_MULTIPLAYER_BOUNDS.z,
    maxVerticalSpeed: 1.5,
  }),
  aircraft: Object.freeze({
    maxVerticalSpeed: 20,
  }),
});

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function finitePoseNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(422, 'invalid_multiplayer_pose', `${field} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finitePoseAngle(value, field) {
  const number = finitePoseNumber(value, field);
  if (number < -Math.PI || number > Math.PI) {
    throw new HttpError(422, 'invalid_multiplayer_pose', `${field} must be between -PI and PI`);
  }
  return number;
}

function validateVehicleObjectId(value) {
  if (typeof value !== 'string' || !LOBBY_OBJECT_ID_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_multiplayer_vehicle', 'objectId is invalid');
  }
  return value;
}

function validateVehicleLeaseId(value) {
  if (typeof value !== 'string' || !VEHICLE_LEASE_ID_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_multiplayer_vehicle', 'leaseId is invalid');
  }
  return value;
}

function validateVehicleSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(422, 'invalid_multiplayer_vehicle', 'seq must be a positive safe integer');
  }
  return value;
}

function finiteVehicleNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(422, 'invalid_multiplayer_vehicle', `${field} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finiteVehicleAngle(value, field) {
  const number = finiteVehicleNumber(value, field);
  if (number < -Math.PI || number > Math.PI) {
    throw new HttpError(422, 'invalid_multiplayer_vehicle', `${field} must be between -PI and PI`);
  }
  return number;
}

function validateAvatarId(value, { allowEmpty = false } = {}) {
  if ((value === null || (allowEmpty && value === ''))) return null;
  if (typeof value !== 'string' || !AVATAR_ID_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_avatar_id', 'avatarId must be a safe uploaded avatar ID or null');
  }
  return value;
}

function validatePartyId(value) {
  if (typeof value !== 'string' || !PARTY_ID_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_party_id', 'partyId is invalid');
  }
  return value;
}

function validateLevelRef(levelId, levelVersion) {
  if (typeof levelId !== 'string' || !LEVEL_ID_PATTERN.test(levelId)) {
    throw new HttpError(422, 'invalid_party_level', 'levelId is invalid');
  }
  if (typeof levelVersion !== 'string' || !LEVEL_VERSION_PATTERN.test(levelVersion)) {
    throw new HttpError(422, 'invalid_party_level', 'levelVersion is invalid');
  }
  return { levelId, levelVersion };
}

function queryValues(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  if (url.pathname !== '/api/lobby/multiplayer') {
    throw new HttpError(404, 'not_found', 'WebSocket endpoint was not found');
  }
  const required = ['clientId', 'avatarId', 'name'];
  const allowed = [...required, 'channel', 'partyId'];
  const unexpected = [...url.searchParams.keys()].filter((key) => !allowed.includes(key));
  if (unexpected.length || required.some((key) => url.searchParams.getAll(key).length !== 1)) {
    throw new HttpError(422, 'invalid_multiplayer_query', 'Exactly one clientId, avatarId, and name query parameter is required');
  }
  const partyValues = url.searchParams.getAll('partyId');
  const channelValues = url.searchParams.getAll('channel');
  if (partyValues.length > 1 || channelValues.length > 1) {
    throw new HttpError(422, 'invalid_multiplayer_query', 'channel and partyId may appear at most once');
  }
  return {
    channel: validateLobbyChannel(channelValues[0] ?? DEFAULT_LOBBY_CHANNEL),
    legacyChannelProtocol: channelValues.length === 0,
    clientId: validateClientId(url.searchParams.get('clientId')),
    avatarId: validateAvatarId(url.searchParams.get('avatarId'), { allowEmpty: true }),
    name: validateAvatarText(url.searchParams.get('name'), 'name'),
    partyId: partyValues.length ? validatePartyId(partyValues[0]) : null,
  };
}

function expectedProtocol(request) {
  const remote = String(request.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const trustedProxy = remote === '127.0.0.1' || remote === '::1';
  if (trustedProxy) {
    const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
    if (forwarded === 'https' || forwarded === 'http') return `${forwarded}:`;
  }
  return request.socket.encrypted ? 'https:' : 'http:';
}

function requireSameOrigin(request) {
  const supplied = request.headers.origin;
  const host = request.headers.host;
  if (typeof supplied !== 'string' || typeof host !== 'string' || supplied.length > 512 || host.length > 255) {
    throw new HttpError(403, 'multiplayer_origin_rejected', 'A same-origin WebSocket request is required');
  }
  let origin;
  try {
    origin = new URL(supplied);
  } catch {
    throw new HttpError(403, 'multiplayer_origin_rejected', 'A same-origin WebSocket request is required');
  }
  if (origin.origin !== supplied || origin.host !== host || origin.protocol !== expectedProtocol(request)) {
    throw new HttpError(403, 'multiplayer_origin_rejected', 'WebSocket Origin must match the game origin');
  }
}

function parseClientMessage(data, isBinary) {
  if (isBinary || data.length > MAX_MESSAGE_BYTES) {
    throw new HttpError(422, 'invalid_multiplayer_message', 'Multiplayer messages must be UTF-8 JSON up to 1 KB');
  }
  let value;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    throw new HttpError(422, 'invalid_multiplayer_message', 'Multiplayer message must be valid JSON');
  }
  if (value?.type === 'pose') {
    if (!exactKeys(value, POSE_KEYS) || typeof value.moving !== 'boolean') {
      throw new HttpError(422, 'invalid_multiplayer_pose', 'Pose must use the exact pose schema');
    }
    return {
      type: 'pose',
      x: finitePoseNumber(value.x, 'x'),
      y: finitePoseNumber(value.y, 'y'),
      z: finitePoseNumber(value.z, 'z'),
      yaw: finitePoseAngle(value.yaw, 'yaw'),
      moving: value.moving,
    };
  }
  if (value?.type === 'profile') {
    if (!exactKeys(value, PROFILE_KEYS)) {
      throw new HttpError(422, 'invalid_multiplayer_profile', 'Profile must use the exact profile schema');
    }
    return {
      type: 'profile',
      name: validateAvatarText(value.name, 'name'),
      avatarId: validateAvatarId(value.avatarId),
    };
  }
  if (value?.type === 'party_create') {
    if (!exactKeys(value, PARTY_CREATE_KEYS)) {
      throw new HttpError(422, 'invalid_party_message', 'party_create must use the exact schema');
    }
    return { type: 'party_create', ...validateLevelRef(value.levelId, value.levelVersion) };
  }
  if (value?.type === 'party_respond') {
    if (!exactKeys(value, PARTY_RESPOND_KEYS) || typeof value.accept !== 'boolean') {
      throw new HttpError(422, 'invalid_party_message', 'party_respond must use the exact schema');
    }
    if (typeof value.levelVersion !== 'string' || !LEVEL_VERSION_PATTERN.test(value.levelVersion)) {
      throw new HttpError(422, 'invalid_party_level', 'levelVersion is invalid');
    }
    return {
      type: 'party_respond',
      partyId: validatePartyId(value.partyId),
      accept: value.accept,
      levelVersion: value.levelVersion,
    };
  }
  if (value?.type === 'party_cancel') {
    if (!exactKeys(value, PARTY_CANCEL_KEYS)) {
      throw new HttpError(422, 'invalid_party_message', 'party_cancel must use the exact schema');
    }
    return { type: 'party_cancel', partyId: validatePartyId(value.partyId) };
  }
  if (value?.type === 'return_lobby') {
    if (!exactKeys(value, RETURN_LOBBY_KEYS)) {
      throw new HttpError(422, 'invalid_party_message', 'return_lobby must use the exact schema');
    }
    return { type: 'return_lobby' };
  }
  if (value?.type === 'vehicle_enter') {
    if (!exactKeys(value, VEHICLE_ENTER_KEYS)) {
      throw new HttpError(422, 'invalid_multiplayer_vehicle', 'vehicle_enter must use the exact schema');
    }
    return { type: 'vehicle_enter', objectId: validateVehicleObjectId(value.objectId) };
  }
  if (value?.type === 'vehicle_state') {
    if (!exactKeys(value, VEHICLE_STATE_KEYS)) {
      throw new HttpError(422, 'invalid_multiplayer_vehicle', 'vehicle_state must use the exact schema');
    }
    return {
      type: 'vehicle_state',
      objectId: validateVehicleObjectId(value.objectId),
      leaseId: validateVehicleLeaseId(value.leaseId),
      seq: validateVehicleSequence(value.seq),
      x: finiteVehicleNumber(value.x, 'x'),
      y: finiteVehicleNumber(value.y, 'y'),
      z: finiteVehicleNumber(value.z, 'z'),
      yaw: finiteVehicleAngle(value.yaw, 'yaw'),
      pitch: finiteVehicleAngle(value.pitch, 'pitch'),
      roll: finiteVehicleAngle(value.roll, 'roll'),
      vx: finiteVehicleNumber(value.vx, 'vx'),
      vy: finiteVehicleNumber(value.vy, 'vy'),
      vz: finiteVehicleNumber(value.vz, 'vz'),
    };
  }
  if (value?.type === 'vehicle_exit') {
    if (!exactKeys(value, VEHICLE_EXIT_KEYS)) {
      throw new HttpError(422, 'invalid_multiplayer_vehicle', 'vehicle_exit must use the exact schema');
    }
    return {
      type: 'vehicle_exit',
      objectId: validateVehicleObjectId(value.objectId),
      leaseId: validateVehicleLeaseId(value.leaseId),
      seq: validateVehicleSequence(value.seq),
    };
  }
  if (value?.type === 'vehicle_recover') {
    if (!exactKeys(value, VEHICLE_RECOVER_KEYS)) {
      throw new HttpError(422, 'invalid_multiplayer_vehicle', 'vehicle_recover must use the exact schema');
    }
    return {
      type: 'vehicle_recover',
      objectId: validateVehicleObjectId(value.objectId),
      leaseId: validateVehicleLeaseId(value.leaseId),
    };
  }
  throw new HttpError(422, 'invalid_multiplayer_message', 'Unknown multiplayer message type');
}

function statusText(status) {
  return new Map([
    [400, 'Bad Request'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [409, 'Conflict'],
    [422, 'Unprocessable Content'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
  ]).get(status) ?? 'Bad Request';
}

function rejectUpgrade(socket, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message = error instanceof HttpError ? error.message : 'Internal server error';
  const body = Buffer.from(`${JSON.stringify({ error: { code, message } })}\n`);
  socket.end([
    `HTTP/1.1 ${status} ${statusText(status)}`,
    'Connection: close',
    'Content-Type: application/json; charset=utf-8',
    'Cache-Control: no-store',
    'X-Content-Type-Options: nosniff',
    `Content-Length: ${body.length}`,
    '',
    '',
  ].join('\r\n') + body.toString('utf8'));
}

function clonePlayer(connection) {
  return {
    id: connection.clientId,
    name: connection.name,
    avatarId: connection.avatarId,
    avatarUrl: connection.avatarUrl,
    pose: { ...connection.pose },
  };
}

function vehicleKey(channel, objectId) {
  return `${channel}:${objectId}`;
}

function cloneVehicle(state) {
  return {
    objectId: state.objectId,
    catalogId: state.catalogId,
    kind: state.kind,
    driverId: state.driverId,
    x: state.x,
    y: state.y,
    z: state.z,
    yaw: state.yaw,
    pitch: state.pitch,
    roll: state.roll,
    vx: state.vx,
    vy: state.vy,
    vz: state.vz,
    seq: state.seq,
    timestamp: state.timestamp,
    ...(state.recovering ? { recovering: true } : {}),
  };
}

function shortestAngleDelta(from, to) {
  const full = Math.PI * 2;
  let delta = (to - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return delta;
}

function vectorLength(x, y, z) {
  return Math.hypot(x, y, z);
}

function moveToward(value, target, maximumDelta) {
  if (value < target) return Math.min(value + maximumDelta, target);
  if (value > target) return Math.max(value - maximumDelta, target);
  return target;
}

function vehicleCapabilities(catalog) {
  if (!catalog || !Array.isArray(catalog.items)) throw new Error('Multiplayer vehicle catalog is invalid');
  return new Map(catalog.items
    .filter((item) => item?.vehicle)
    .map((item) => [item.id, Object.freeze({ ...item.vehicle })]));
}

export class MultiplayerHub {
  constructor({
    avatarStore,
    lobbyStore,
    lobbyCatalog,
    clock = Date.now,
    maxTotal = 200,
    maxPerIp = 6,
    pingIntervalMs = 20_000,
    partyCountdownMs = 8_000,
    partyLifetimeMs = 30 * 60_000,
    vehicleLeaseMs = VEHICLE_LEASE_MS,
    vehicleRecoveryTickMs = VEHICLE_RECOVERY_TICK_MS,
  } = {}) {
    if (
      !avatarStore
      || !lobbyStore
      || typeof lobbyStore.getState !== 'function'
      || typeof clock !== 'function'
      || ![
        maxTotal, maxPerIp, pingIntervalMs, partyCountdownMs, partyLifetimeMs,
        vehicleLeaseMs, vehicleRecoveryTickMs,
      ]
        .every((value) => Number.isSafeInteger(value) && value > 0)
    ) {
      throw new Error('MultiplayerHub settings are invalid');
    }
    this.avatarStore = avatarStore;
    this.lobbyStore = lobbyStore;
    this.vehicleCapabilities = vehicleCapabilities(lobbyCatalog);
    this.clock = clock;
    this.maxTotal = maxTotal;
    this.maxPerIp = maxPerIp;
    this.pingIntervalMs = pingIntervalMs;
    this.partyCountdownMs = partyCountdownMs;
    this.partyLifetimeMs = partyLifetimeMs;
    this.vehicleLeaseMs = vehicleLeaseMs;
    this.vehicleRecoveryTickMs = vehicleRecoveryTickMs;
    this.connections = new Map();
    this.ipConnections = new Map();
    this.pendingClientIds = new Set();
    this.pendingIpConnections = new Map();
    this.parties = new Map();
    this.vehicleStates = new Map();
    this.vehicleLeases = new Map();
    this.driverLeases = new Map();
    this.vehicleRecoveries = new Map();
    this.vehicleMutationLocks = new Set();
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      clientTracking: false,
    });
    this.pingTimer = null;
    this.server = null;
    this.closed = false;
    this.upgradeListener = (request, socket, head) => this.upgrade(request, socket, head);
  }

  attach(server) {
    if (this.server) throw new Error('MultiplayerHub is already attached');
    this.server = server;
    server.on('upgrade', this.upgradeListener);
    return this;
  }

  resolveAvatar(requestedId) {
    if (!requestedId) return { avatarId: null, avatarUrl: null };
    if (Object.hasOwn(BUILTIN_AVATAR_URLS, requestedId)) {
      return { avatarId: requestedId, avatarUrl: BUILTIN_AVATAR_URLS[requestedId] };
    }
    const avatar = this.avatarStore.get(requestedId);
    return avatar
      ? { avatarId: avatar.avatarId, avatarUrl: avatar.avatarUrl }
      : { avatarId: null, avatarUrl: null };
  }

  prepare(request) {
    requireSameOrigin(request);
    const query = queryValues(request.url ?? '/');
    const ip = requestIp(request);
    const lobbyChannel = query.channel;
    const lobbyKey = `lobby:${lobbyChannel}`;
    let channel = lobbyKey;
    if (query.partyId) {
      const party = this.parties.get(query.partyId);
      if (
        !party
        || party.state !== 'playing'
        || party.lobbyChannel !== lobbyChannel
        || !party.members.has(query.clientId)
      ) {
        throw new HttpError(403, 'party_resume_rejected', 'This player cannot resume the requested party');
      }
      channel = `level:${party.id}`;
    }
    if (this.connections.has(query.clientId) || this.pendingClientIds.has(query.clientId)) {
      throw new HttpError(409, 'multiplayer_client_in_use', 'This multiplayer client ID is already connected');
    }
    if (this.connections.size + this.pendingClientIds.size >= this.maxTotal) {
      throw new HttpError(429, 'multiplayer_connection_limit', 'The multiplayer lobby is full', {
        scope: 'total',
        limit: this.maxTotal,
      });
    }
    if ((this.ipConnections.get(ip) ?? 0) + (this.pendingIpConnections.get(ip) ?? 0) >= this.maxPerIp) {
      throw new HttpError(429, 'multiplayer_connection_limit', 'Too many multiplayer connections from this network', {
        scope: 'ip',
        limit: this.maxPerIp,
      });
    }
    this.pendingClientIds.add(query.clientId);
    this.pendingIpConnections.set(ip, (this.pendingIpConnections.get(ip) ?? 0) + 1);
    return { ...query, ...this.resolveAvatar(query.avatarId), ip, channel, lobbyChannel, lobbyKey };
  }

  releaseReservation(prepared) {
    if (!this.pendingClientIds.delete(prepared.clientId)) return;
    const remaining = (this.pendingIpConnections.get(prepared.ip) ?? 1) - 1;
    if (remaining > 0) this.pendingIpConnections.set(prepared.ip, remaining);
    else this.pendingIpConnections.delete(prepared.ip);
  }

  upgrade(request, socket, head) {
    let prepared;
    try {
      prepared = this.prepare(request);
    } catch (error) {
      rejectUpgrade(socket, error);
      return;
    }
    socket.on('error', () => {});
    try {
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.releaseReservation(prepared);
        this.accept(webSocket, prepared);
      });
    } catch (error) {
      this.releaseReservation(prepared);
      rejectUpgrade(socket, error);
    }
  }

  accept(webSocket, prepared) {
    const timestamp = this.clock();
    const connection = {
      webSocket,
      clientId: prepared.clientId,
      ip: prepared.ip,
      name: prepared.name,
      avatarId: prepared.avatarId,
      avatarUrl: prepared.avatarUrl,
      pose: { x: 0, y: 0, z: 4.2, yaw: 0, moving: false, seq: 0, timestamp },
      sequence: 0,
      poseWindowStarted: timestamp,
      poseCount: 0,
      poseRateNoticeSent: false,
      vehicleStateWindowStarted: timestamp,
      vehicleStateCount: 0,
      vehicleStateRateNoticeSent: false,
      messageWindowStarted: timestamp,
      messageCount: 0,
      profileTokens: PROFILE_BURST,
      profileRefilledAt: timestamp,
      profileRateNoticeAt: Number.NEGATIVE_INFINITY,
      alive: true,
      suppressLeave: false,
      channel: prepared.channel,
      lobbyChannel: prepared.lobbyChannel,
      lobbyKey: prepared.lobbyKey,
      legacyChannelProtocol: prepared.legacyChannelProtocol,
      partyId: prepared.partyId,
      lastPartyCreatedAt: Number.NEGATIVE_INFINITY,
      messageQueue: Promise.resolve(),
    };
    this.connections.set(connection.clientId, connection);
    this.ipConnections.set(connection.ip, (this.ipConnections.get(connection.ip) ?? 0) + 1);
    webSocket.on('pong', () => { connection.alive = true; });
    webSocket.on('message', (data, isBinary) => {
      connection.messageQueue = connection.messageQueue
        .then(() => this.message(connection, data, isBinary))
        .catch(() => {
          if (webSocket.readyState === WebSocket.OPEN) webSocket.close(1011, 'internal_error');
        });
    });
    webSocket.once('close', () => this.remove(connection, !connection.suppressLeave));
    webSocket.once('error', () => this.remove(connection, !connection.suppressLeave));

    this.send(connection, {
      type: 'welcome',
      selfId: connection.clientId,
      channel: this.wireChannel(connection),
      lobbyChannel: connection.lobbyChannel,
      features: MULTIPLAYER_FEATURES,
      players: this.channelConnections(connection.channel).map(clonePlayer),
      vehicles: connection.channel === connection.lobbyKey
        ? this.vehiclesForChannel(connection.lobbyChannel)
        : [],
    });
    this.broadcastChannel(connection.channel, { type: 'join', player: clonePlayer(connection) }, connection.clientId);
    this.startPing();
  }

  send(connection, payload) {
    const socket = connection.webSocket;
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      this.remove(connection, true);
      return false;
    }
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      socket.terminate();
      this.remove(connection, true);
      return false;
    }
  }

  channelConnections(channel) {
    return [...this.connections.values()].filter((connection) => connection.channel === channel);
  }

  vehiclesForChannel(lobbyChannel) {
    return [...this.vehicleStates.values()]
      .filter((vehicle) => vehicle.channel === lobbyChannel)
      .map(cloneVehicle)
      .sort((a, b) => a.objectId.localeCompare(b.objectId));
  }

  wireChannel(connection, channel = connection.channel) {
    return connection.legacyChannelProtocol && channel === connection.lobbyKey ? 'lobby' : channel;
  }

  broadcastChannel(channel, payload, excludedId = null) {
    const recipients = this.channelConnections(channel);
    for (const connection of recipients) {
      if (connection.clientId !== excludedId) this.send(connection, { ...payload, online: recipients.length });
    }
  }

  broadcastVehicle(channel, payload, excludedId = null) {
    for (const connection of this.channelConnections(channel)) {
      if (connection.clientId !== excludedId) this.send(connection, payload);
    }
  }

  vehicleObjectInUse(key) {
    const state = this.vehicleStates.get(key);
    return this.vehicleMutationLocks.has(key)
      || this.vehicleLeases.has(key)
      || this.vehicleRecoveries.has(key)
      || Boolean(state && (state.driverId !== null || state.recovering));
  }

  async mutateLobbyObject(channel, objectId, mutation, reconcile) {
    const key = vehicleKey(channel, objectId);
    if (this.vehicleObjectInUse(key)) {
      throw new HttpError(409, 'lobby_vehicle_in_use', 'This lobby vehicle is currently in use');
    }
    this.vehicleMutationLocks.add(key);
    try {
      const change = await mutation();
      const state = this.vehicleStates.get(key);
      if (state) {
        reconcile(state, change);
        this.broadcastVehicle(`lobby:${channel}`, {
          type: 'vehicle_snapshot',
          vehicles: this.vehiclesForChannel(channel),
        });
      }
      return change;
    } finally {
      this.vehicleMutationLocks.delete(key);
    }
  }

  updateLobbyObject(channel, objectId, input) {
    return this.mutateLobbyObject(
      channel,
      objectId,
      () => this.lobbyStore.update(channel, objectId, input),
      (state, change) => {
        const poseChanged = Object.hasOwn(input, 'position') || Object.hasOwn(input, 'rotationY');
        if (Object.hasOwn(input, 'position')) {
          state.x = change.object.position.x;
          state.y = change.object.position.y;
          state.z = change.object.position.z;
        }
        if (Object.hasOwn(input, 'rotationY')) state.yaw = change.object.rotationY;
        if (!poseChanged) return;
        state.driverId = null;
        state.recovering = false;
        state.pitch = 0;
        state.roll = 0;
        state.vx = 0;
        state.vy = 0;
        state.vz = 0;
        state.seq = Math.min(Number.MAX_SAFE_INTEGER - 1, Math.max(0, state.seq) + 1);
        state.timestamp = this.clock();
      },
    );
  }

  deleteLobbyObject(channel, objectId, input) {
    return this.mutateLobbyObject(
      channel,
      objectId,
      () => this.lobbyStore.delete(channel, objectId, input),
      (_state) => this.vehicleStates.delete(vehicleKey(channel, objectId)),
    );
  }

  sendVehicleError(connection, code) {
    this.send(connection, { type: 'error', code });
  }

  renewVehicleLeaseWhileConnected(lease, timestamp = this.clock()) {
    const connection = this.connections.get(lease.driverId);
    if (
      !connection
      || connection.channel !== connection.lobbyKey
      || connection.webSocket.readyState !== WebSocket.OPEN
      || this.driverLeases.get(lease.driverId) !== lease.key
      || this.vehicleLeases.get(lease.key) !== lease
    ) return false;
    lease.expiresAt = timestamp + this.vehicleLeaseMs;
    this.armVehicleLease(lease);
    return true;
  }

  armVehicleLease(lease) {
    if (lease.timer) clearTimeout(lease.timer);
    const remaining = Math.max(1, lease.expiresAt - this.clock());
    lease.timer = setTimeout(() => {
      if (this.vehicleLeases.get(lease.key) !== lease) return;
      const nextRemaining = lease.expiresAt - this.clock();
      if (nextRemaining > 0) {
        this.armVehicleLease(lease);
        return;
      }
      if (!this.renewVehicleLeaseWhileConnected(lease)) this.releaseVehicle(lease, 'timeout');
    }, Math.min(this.vehicleLeaseMs, remaining));
    lease.timer.unref?.();
  }

  detachVehicleLease(lease) {
    if (lease.timer) clearTimeout(lease.timer);
    this.vehicleLeases.delete(lease.key);
    if (this.driverLeases.get(lease.driverId) === lease.key) this.driverLeases.delete(lease.driverId);
  }

  finalizeVehicleRelease(subject, reason) {
    const recovery = this.vehicleRecoveries.get(subject.key);
    if (recovery) {
      if (recovery.timer) clearTimeout(recovery.timer);
      this.vehicleRecoveries.delete(subject.key);
    }
    if (this.driverLeases.get(subject.driverId) === subject.key) {
      this.driverLeases.delete(subject.driverId);
    }
    const state = this.vehicleStates.get(subject.key) ?? subject.lastState ?? null;
    if (!state) return true;
    this.vehicleStates.set(subject.key, state);
    state.driverId = null;
    state.recovering = false;
    if (state.kind === 'aircraft') {
      state.y = 0;
      state.pitch = 0;
      state.roll = 0;
    }
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    state.timestamp = this.clock();
    const compatibleReason = reason === 'state_loss' ? 'timeout' : reason;
    const parkedState = cloneVehicle(state);
    const broadcastRelease = () => {
      this.broadcastVehicle(`lobby:${subject.channel}`, {
        type: 'vehicle_released',
        reason: compatibleReason,
        driverId: subject.driverId,
        vehicle: parkedState,
      });
    };
    if (subject.catalogId === 'code-celestial-riding-dragon') {
      this.vehicleMutationLocks.add(subject.key);
      void Promise.resolve()
        .then(() => this.lobbyStore.persistRealmVehiclePose(subject.channel, subject.objectId, parkedState))
        .catch((error) => {
          console.error('[WhiteRoom] Failed to persist the celestial dragon parked pose', error);
        })
        .then(broadcastRelease)
        .finally(() => {
          this.vehicleMutationLocks.delete(subject.key);
        });
    } else {
      broadcastRelease();
    }
    return true;
  }

  vehicleNeedsRecovery(kind, state) {
    return kind === 'aircraft' && (
      Math.abs(state.y) > VEHICLE_RECOVERY_GROUND_EPSILON
      || vectorLength(state.vx, state.vy, state.vz) > VEHICLE_RECOVERY_SPEED_EPSILON
      || Math.abs(state.pitch) > VEHICLE_RECOVERY_ANGLE_EPSILON
      || Math.abs(state.roll) > VEHICLE_RECOVERY_ANGLE_EPSILON
    );
  }

  armVehicleRecovery(recovery) {
    if (recovery.timer) clearTimeout(recovery.timer);
    recovery.timer = setTimeout(() => this.stepVehicleRecovery(recovery), this.vehicleRecoveryTickMs);
    recovery.timer.unref?.();
  }

  startVehicleRecovery(lease, reason) {
    this.detachVehicleLease(lease);
    const state = this.vehicleStates.get(lease.key) ?? lease.lastState ?? null;
    if (!state) return true;
    this.vehicleStates.set(lease.key, state);
    if (!this.vehicleNeedsRecovery(lease.kind, state)) {
      return this.finalizeVehicleRelease({ ...lease, lastState: state }, reason);
    }
    state.driverId = lease.driverId;
    state.recovering = true;
    state.timestamp = this.clock();
    this.driverLeases.set(lease.driverId, lease.key);
    const recovery = {
      key: lease.key,
      channel: lease.channel,
      objectId: lease.objectId,
      catalogId: lease.catalogId,
      kind: lease.kind,
      capability: lease.capability,
      driverId: lease.driverId,
      reason,
      lastTickAt: state.timestamp,
      elapsedMs: 0,
      startY: Math.max(0, state.y),
      adaptiveDescent: state.y > VEHICLE_RECOVERY_NORMAL_ALTITUDE,
      lastState: state,
      timer: null,
    };
    this.vehicleRecoveries.set(recovery.key, recovery);
    this.broadcastVehicle(`lobby:${recovery.channel}`, {
      type: 'vehicle_recovery',
      reason,
      driverId: recovery.driverId,
      vehicle: cloneVehicle(state),
    });
    this.armVehicleRecovery(recovery);
    return true;
  }

  stepVehicleRecovery(recovery) {
    if (this.vehicleRecoveries.get(recovery.key) !== recovery) return;
    const state = this.vehicleStates.get(recovery.key) ?? recovery.lastState;
    if (!state) {
      this.vehicleRecoveries.delete(recovery.key);
      return;
    }
    this.vehicleStates.set(recovery.key, state);
    const timestamp = this.clock();
    const measuredMs = timestamp - recovery.lastTickAt;
    const stepElapsedMs = Math.max(1, measuredMs > 0 ? measuredMs : this.vehicleRecoveryTickMs);
    const physicsElapsedMs = Math.min(250, stepElapsedMs);
    const remainingRecoveryMs = VEHICLE_RECOVERY_MAX_LANDING_MS - recovery.elapsedMs;
    const recoveryElapsedMs = Math.min(remainingRecoveryMs, stepElapsedMs);
    recovery.elapsedMs += recoveryElapsedMs;
    const dt = physicsElapsedMs / 1_000;
    recovery.lastTickAt = timestamp;

    const horizontalSpeed = Math.hypot(state.vx, state.vz);
    const nextHorizontalSpeed = Math.max(0, horizontalSpeed - recovery.capability.maxAcceleration * dt);
    const horizontalScale = horizontalSpeed > 0.0001 ? nextHorizontalSpeed / horizontalSpeed : 0;
    state.vx *= horizontalScale;
    state.vz *= horizontalScale;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    if (recovery.adaptiveDescent) {
      const progress = Math.min(1, recovery.elapsedMs / VEHICLE_RECOVERY_MAX_LANDING_MS);
      const remaining = 1 - progress;
      const easedRemaining = remaining * remaining * (1 + 2 * progress);
      const previousY = state.y;
      state.y = recovery.startY * easedRemaining;
      const adaptiveDt = Math.max(0.001, recoveryElapsedMs / 1_000);
      const adaptiveVerticalSpeed = (state.y - previousY) / adaptiveDt;
      state.vy = Number.isFinite(adaptiveVerticalSpeed)
        ? adaptiveVerticalSpeed
        : -Number.MAX_VALUE;
    } else {
      const verticalBudget = Math.sqrt(Math.max(0, recovery.capability.maxSpeed ** 2 - nextHorizontalSpeed ** 2));
      const targetVerticalSpeed = state.y > VEHICLE_RECOVERY_GROUND_EPSILON
        ? -Math.min(VEHICLE_RECOVERY_DESCENT_SPEED, verticalBudget)
        : 0;
      state.vy = moveToward(
        state.vy,
        targetVerticalSpeed,
        recovery.capability.maxAcceleration * dt,
      );
      state.y += state.vy * dt;
    }
    state.pitch = moveToward(state.pitch, 0, recovery.capability.maxAngularSpeed * dt);
    state.roll = moveToward(state.roll, 0, recovery.capability.maxAngularSpeed * dt);
    if (recovery.elapsedMs >= VEHICLE_RECOVERY_MAX_LANDING_MS) {
      state.y = 0;
      state.vx = 0;
      state.vy = 0;
      state.vz = 0;
      state.pitch = 0;
      state.roll = 0;
    } else if (state.y <= VEHICLE_RECOVERY_GROUND_EPSILON) {
      state.y = 0;
      state.vy = 0;
    }
    state.driverId = recovery.driverId;
    state.recovering = true;
    state.seq = Math.min(Number.MAX_SAFE_INTEGER - 1, state.seq + 1);
    state.timestamp = timestamp;
    recovery.lastState = state;

    if (!this.vehicleNeedsRecovery(recovery.kind, state)) {
      this.finalizeVehicleRelease(recovery, recovery.reason);
      return;
    }
    this.broadcastVehicle(`lobby:${recovery.channel}`, {
      type: 'vehicle_state',
      vehicle: cloneVehicle(state),
    });
    this.armVehicleRecovery(recovery);
  }

  releaseVehicle(lease, reason) {
    if (!lease || this.vehicleLeases.get(lease.key) !== lease) return false;
    if (reason === 'server_shutdown') {
      this.detachVehicleLease(lease);
      return true;
    }
    if (reason === 'exit') {
      this.detachVehicleLease(lease);
      return this.finalizeVehicleRelease(lease, reason);
    }
    return this.startVehicleRecovery(lease, reason);
  }

  releaseConnectionVehicle(connection, reason) {
    const key = this.driverLeases.get(connection.clientId);
    if (!key) return false;
    return this.releaseVehicle(this.vehicleLeases.get(key), reason);
  }

  initialVehicleState(channel, object, capability, timestamp) {
    return {
      channel,
      objectId: object.id,
      catalogId: object.catalogId,
      kind: capability.kind,
      driverId: null,
      recovering: false,
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      yaw: object.rotationY,
      pitch: 0,
      roll: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      seq: 0,
      timestamp,
    };
  }

  vehiclePositionAllowed(kind, state) {
    if (kind === 'aircraft') {
      const celestialDragon = state.catalogId === 'code-celestial-riding-dragon';
      return state.y >= 0
        && (!celestialDragon || (
          state.y <= 38
          && Math.abs(state.x) <= 20.5
          && Math.abs(state.z) <= 20.5
        ))
        && [state.x, state.y, state.z].every((value) => typeof value === 'number' && Number.isFinite(value));
    }
    const bounds = VEHICLE_MOTION_LIMITS[kind];
    return Boolean(bounds?.x && bounds?.y && bounds?.z)
      && state.x >= bounds.x.min && state.x <= bounds.x.max
      && state.y >= bounds.y.min && state.y <= bounds.y.max
      && state.z >= bounds.z.min && state.z <= bounds.z.max;
  }

  async enterVehicle(connection, message, receivedAt) {
    if (connection.channel !== connection.lobbyKey) {
      this.sendVehicleError(connection, 'vehicle_not_in_lobby');
      return;
    }
    const currentKey = this.driverLeases.get(connection.clientId);
    if (currentKey) {
      const current = this.vehicleLeases.get(currentKey);
      if (current?.objectId === message.objectId) {
        const state = this.vehicleStates.get(current.key);
        if (state) this.send(connection, { type: 'vehicle_entered', leaseId: current.leaseId, vehicle: cloneVehicle(state) });
      } else {
        this.sendVehicleError(connection, 'vehicle_already_driving');
      }
      return;
    }

    const lobbyState = await this.lobbyStore.getState(connection.lobbyChannel);
    if (this.connections.get(connection.clientId) !== connection || connection.channel !== connection.lobbyKey) return;
    const object = lobbyState.objects.find((candidate) => candidate.id === message.objectId);
    if (!object) {
      this.sendVehicleError(connection, 'vehicle_not_found');
      return;
    }
    const capability = this.vehicleCapabilities.get(object.catalogId);
    if (!capability) {
      this.sendVehicleError(connection, 'vehicle_not_capable');
      return;
    }
    const key = vehicleKey(connection.lobbyChannel, object.id);
    if (this.vehicleMutationLocks.has(key)) {
      this.sendVehicleError(connection, 'vehicle_busy');
      return;
    }
    if (this.vehicleRecoveries.has(key) || this.vehicleStates.get(key)?.recovering) {
      this.sendVehicleError(connection, 'vehicle_busy');
      return;
    }
    const occupied = this.vehicleLeases.get(key);
    if (occupied) {
      if (receivedAt >= occupied.expiresAt) {
        if (this.renewVehicleLeaseWhileConnected(occupied, receivedAt)) {
          this.sendVehicleError(connection, 'vehicle_busy');
          return;
        }
        this.releaseVehicle(occupied, 'timeout');
        if (this.vehicleRecoveries.has(key)) {
          this.sendVehicleError(connection, 'vehicle_busy');
          return;
        }
      }
      else {
        this.sendVehicleError(connection, 'vehicle_busy');
        return;
      }
    }
    let state = this.vehicleStates.get(key);
    if (!state) {
      state = this.initialVehicleState(connection.lobbyChannel, object, capability, receivedAt);
      if (!this.vehiclePositionAllowed(capability.kind, state)) {
        this.sendVehicleError(connection, 'vehicle_not_capable');
        return;
      }
      this.vehicleStates.set(key, state);
    }
    const poseAge = Math.max(0, receivedAt - connection.pose.timestamp);
    const distance = vectorLength(
      connection.pose.x - state.x,
      connection.pose.y - state.y,
      connection.pose.z - state.z,
    );
    if (poseAge > VEHICLE_POSE_FRESHNESS_MS || distance > capability.enterRadius) {
      this.sendVehicleError(connection, 'vehicle_too_far');
      return;
    }

    state.driverId = connection.clientId;
    state.recovering = false;
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    state.seq = 0;
    state.timestamp = receivedAt;
    const lease = {
      key,
      channel: connection.lobbyChannel,
      objectId: object.id,
      catalogId: object.catalogId,
      kind: capability.kind,
      capability,
      driverId: connection.clientId,
      leaseId: `lease-${randomUUID()}`,
      lastSeq: 0,
      lastAcceptedAt: receivedAt,
      expiresAt: receivedAt + this.vehicleLeaseMs,
      lastState: state,
      motionCreditMs: VEHICLE_STATE_SIMULATION_INTERVAL_MS,
      motionCreditUpdatedAt: receivedAt,
      timer: null,
    };
    this.vehicleLeases.set(key, lease);
    this.driverLeases.set(connection.clientId, key);
    this.armVehicleLease(lease);
    const snapshot = cloneVehicle(state);
    this.send(connection, { type: 'vehicle_entered', leaseId: lease.leaseId, vehicle: snapshot });
    this.broadcastVehicle(connection.lobbyKey, { type: 'vehicle_claimed', vehicle: snapshot });
  }

  validateVehicleMotion(lease, previous, next, receivedAt) {
    if (!this.vehiclePositionAllowed(lease.kind, next)) return false;
    const limits = VEHICLE_MOTION_LIMITS[lease.kind];
    const creditUpdatedAt = Number.isFinite(lease.motionCreditUpdatedAt)
      ? lease.motionCreditUpdatedAt
      : lease.lastAcceptedAt;
    const previousCredit = Number.isFinite(lease.motionCreditMs)
      ? lease.motionCreditMs
      : VEHICLE_STATE_SIMULATION_INTERVAL_MS;
    const availableCreditMs = Math.min(
      VEHICLE_MOTION_CREDIT_MAX_MS,
      Math.max(0, previousCredit) + Math.max(0, receivedAt - creditUpdatedAt),
    );
    const sequenceSteps = Math.max(
      1,
      Math.min(
        VEHICLE_MOTION_CREDIT_MAX_MS / VEHICLE_STATE_SIMULATION_INTERVAL_MS,
        next.seq - lease.lastSeq,
      ),
    );
    const requestedCreditMs = sequenceSteps * VEHICLE_STATE_SIMULATION_INTERVAL_MS;
    const grantedCreditMs = Math.min(availableCreditMs, requestedCreditMs);
    const dt = Math.max(0.001, grantedCreditMs / 1_000);
    const speed = vectorLength(next.vx, next.vy, next.vz);
    if (speed > lease.capability.maxSpeed || Math.abs(next.vy) > limits.maxVerticalSpeed) return false;
    const displacement = vectorLength(next.x - previous.x, next.y - previous.y, next.z - previous.z);
    const velocityDelta = vectorLength(next.vx - previous.vx, next.vy - previous.vy, next.vz - previous.vz);
    const yawDelta = Math.abs(shortestAngleDelta(previous.yaw, next.yaw));
    const pitchDelta = Math.abs(shortestAngleDelta(previous.pitch, next.pitch));
    const rollDelta = Math.abs(shortestAngleDelta(previous.roll, next.roll));
    if (
      grantedCreditMs < VEHICLE_MIN_MOTION_CREDIT_MS
      && Math.max(displacement, velocityDelta, yawDelta, pitchDelta, rollDelta) > 1e-5
    ) return false;
    if (displacement > lease.capability.maxSpeed * dt + VEHICLE_POSITION_TOLERANCE) return false;
    const previousSpeed = vectorLength(previous.vx, previous.vy, previous.vz);
    const speedGain = Math.max(0, speed - previousSpeed);
    if (speedGain > lease.capability.maxAcceleration * dt + 0.05) return false;
    const maxAngleDelta = lease.capability.maxAngularSpeed * dt + VEHICLE_ANGLE_TOLERANCE;
    if (
      yawDelta > maxAngleDelta
      || pitchDelta > maxAngleDelta
      || rollDelta > maxAngleDelta
    ) return false;
    lease.motionCreditMs = Math.max(0, availableCreditMs - requestedCreditMs);
    lease.motionCreditUpdatedAt = receivedAt;
    return true;
  }

  updateVehicle(connection, message, receivedAt) {
    const key = vehicleKey(connection.lobbyChannel, message.objectId);
    const lease = this.vehicleLeases.get(key);
    if (
      connection.channel !== connection.lobbyKey
      || !lease
      || lease.driverId !== connection.clientId
      || lease.leaseId !== message.leaseId
      || this.driverLeases.get(connection.clientId) !== key
    ) {
      this.sendVehicleError(connection, 'vehicle_lease_rejected');
      return;
    }
    if (receivedAt >= lease.expiresAt) {
      if (!this.renewVehicleLeaseWhileConnected(lease, receivedAt)) {
        this.releaseVehicle(lease, 'timeout');
        this.sendVehicleError(connection, 'vehicle_lease_rejected');
        return;
      }
    }
    if (message.seq <= lease.lastSeq) {
      this.sendVehicleError(connection, 'vehicle_state_stale');
      return;
    }
    if (receivedAt - connection.vehicleStateWindowStarted >= 1_000) {
      connection.vehicleStateWindowStarted = receivedAt;
      connection.vehicleStateCount = 0;
      connection.vehicleStateRateNoticeSent = false;
    }
    if (connection.vehicleStateCount >= VEHICLE_STATES_PER_SECOND) {
      if (!connection.vehicleStateRateNoticeSent) {
        this.sendVehicleError(connection, 'vehicle_state_rate_limited');
        connection.vehicleStateRateNoticeSent = true;
      }
      return;
    }
    connection.vehicleStateCount += 1;
    const previous = this.vehicleStates.get(key);
    const next = {
      ...previous,
      driverId: connection.clientId,
      recovering: false,
      x: message.x,
      y: message.y,
      z: message.z,
      yaw: message.yaw,
      pitch: message.pitch,
      roll: message.roll,
      vx: message.vx,
      vy: message.vy,
      vz: message.vz,
      seq: message.seq,
      timestamp: receivedAt,
    };
    if (!previous || !this.validateVehicleMotion(lease, previous, next, receivedAt)) {
      this.sendVehicleError(connection, 'vehicle_state_rejected');
      this.releaseVehicle(lease, 'state_loss');
      return;
    }
    this.vehicleStates.set(key, next);
    lease.lastState = next;
    lease.lastSeq = message.seq;
    lease.lastAcceptedAt = receivedAt;
    lease.expiresAt = receivedAt + this.vehicleLeaseMs;
    this.armVehicleLease(lease);
    this.broadcastVehicle(connection.lobbyKey, { type: 'vehicle_state', vehicle: cloneVehicle(next) });
  }

  exitVehicle(connection, message) {
    const key = vehicleKey(connection.lobbyChannel, message.objectId);
    const lease = this.vehicleLeases.get(key);
    if (
      connection.channel !== connection.lobbyKey
      || !lease
      || lease.driverId !== connection.clientId
      || lease.leaseId !== message.leaseId
      || this.driverLeases.get(connection.clientId) !== key
    ) {
      this.sendVehicleError(connection, 'vehicle_lease_rejected');
      return;
    }
    if (message.seq <= lease.lastSeq) {
      this.sendVehicleError(connection, 'vehicle_state_stale');
      return;
    }
    const state = this.vehicleStates.get(key);
    const speed = state ? vectorLength(state.vx, state.vy, state.vz) : Number.POSITIVE_INFINITY;
    if (
      !state
      || speed > VEHICLE_EXIT_MAX_SPEED
      || (lease.kind === 'aircraft' && Math.abs(state.y) > VEHICLE_EXIT_GROUND_EPSILON)
    ) {
      this.sendVehicleError(connection, 'vehicle_exit_rejected');
      return;
    }
    state.seq = message.seq;
    lease.lastState = state;
    lease.lastSeq = message.seq;
    this.releaseVehicle(lease, 'exit');
  }

  recoverVehicle(connection, message) {
    const key = vehicleKey(connection.lobbyChannel, message.objectId);
    const lease = this.vehicleLeases.get(key);
    if (
      connection.channel !== connection.lobbyKey
      || !lease
      || lease.driverId !== connection.clientId
      || lease.leaseId !== message.leaseId
      || this.driverLeases.get(connection.clientId) !== key
    ) {
      this.sendVehicleError(connection, 'vehicle_lease_rejected');
      return;
    }
    this.releaseVehicle(lease, 'state_loss');
  }

  partyMemberViews(party) {
    return [...party.members].map((id) => {
      const connection = this.connections.get(id);
      return connection?.lobbyChannel === party.lobbyChannel
        ? { id, name: connection.name, avatarId: connection.avatarId }
        : { id, name: '重连中', avatarId: null };
    });
  }

  sendPartyState(party) {
    const payload = {
      type: 'party_state',
      partyId: party.id,
      leaderId: party.leaderId,
      levelId: party.levelId,
      levelVersion: party.levelVersion,
      startsAt: new Date(party.startsAt).toISOString(),
      members: this.partyMemberViews(party),
      maxMembers: PARTY_MAX_MEMBERS,
    };
    for (const id of party.members) {
      const connection = this.connections.get(id);
      if (connection?.lobbyChannel === party.lobbyChannel) this.send(connection, payload);
    }
  }

  formingPartyFor(clientId) {
    return [...this.parties.values()].find(
      (party) => party.state === 'forming' && party.members.has(clientId),
    ) ?? null;
  }

  createParty(connection, message, receivedAt) {
    if (connection.channel !== connection.lobbyKey || connection.partyId) {
      this.send(connection, { type: 'error', code: 'party_not_in_lobby' });
      return;
    }
    if (receivedAt - connection.lastPartyCreatedAt < 10_000) {
      this.send(connection, {
        type: 'error',
        code: 'party_invite_rate_limited',
        retryAfterMs: Math.max(1, 10_000 - (receivedAt - connection.lastPartyCreatedAt)),
      });
      return;
    }
    const targets = this.channelConnections(connection.lobbyKey)
      .filter((candidate) => candidate.clientId !== connection.clientId);
    if (!targets.length) {
      this.send(connection, { type: 'error', code: 'party_no_players' });
      return;
    }
    const existingParty = this.formingPartyFor(connection.clientId);
    if (existingParty && existingParty.leaderId !== connection.clientId) {
      this.send(connection, { type: 'error', code: 'party_already_joined' });
      return;
    }
    if (existingParty) this.cancelParty(existingParty, 'replaced');
    const party = {
      id: `party-${randomUUID()}`,
      state: 'forming',
      leaderId: connection.clientId,
      levelId: message.levelId,
      levelVersion: message.levelVersion,
      lobbyChannel: connection.lobbyChannel,
      lobbyKey: connection.lobbyKey,
      startsAt: receivedAt + this.partyCountdownMs,
      members: new Set([connection.clientId]),
      invited: new Set(targets.map((target) => target.clientId)),
      timer: null,
      cleanupTimer: null,
    };
    connection.lastPartyCreatedAt = receivedAt;
    this.parties.set(party.id, party);
    party.timer = setTimeout(() => this.launchParty(party.id), this.partyCountdownMs);
    party.timer.unref?.();
    this.sendPartyState(party);
    const invitation = {
      type: 'party_invite',
      partyId: party.id,
      leader: { id: connection.clientId, name: connection.name, avatarId: connection.avatarId },
      levelId: party.levelId,
      levelVersion: party.levelVersion,
      startsAt: new Date(party.startsAt).toISOString(),
      maxMembers: PARTY_MAX_MEMBERS,
    };
    for (const target of targets) this.send(target, invitation);
  }

  respondToParty(connection, message, receivedAt) {
    const party = this.parties.get(message.partyId);
    if (
      !party
      || party.state !== 'forming'
      || party.lobbyChannel !== connection.lobbyChannel
      || receivedAt >= party.startsAt
      || !party.invited.has(connection.clientId)
    ) {
      this.send(connection, { type: 'error', code: 'party_invite_expired' });
      return;
    }
    if (!message.accept) {
      party.invited.delete(connection.clientId);
      this.send(connection, { type: 'party_cancelled', partyId: party.id, reason: 'declined' });
      return;
    }
    if (message.levelVersion !== party.levelVersion) {
      this.send(connection, { type: 'error', code: 'party_version_mismatch' });
      return;
    }
    const existingParty = this.formingPartyFor(connection.clientId);
    if (existingParty && existingParty.id !== party.id) {
      this.send(connection, { type: 'error', code: 'party_already_joined' });
      return;
    }
    if (connection.channel !== connection.lobbyKey || connection.partyId || party.members.size >= PARTY_MAX_MEMBERS) {
      this.send(connection, { type: 'error', code: 'party_full' });
      return;
    }
    party.invited.delete(connection.clientId);
    party.members.add(connection.clientId);
    this.sendPartyState(party);
  }

  cancelParty(party, reason = 'cancelled') {
    if (!party || !this.parties.has(party.id)) return;
    if (party.timer) clearTimeout(party.timer);
    if (party.cleanupTimer) clearTimeout(party.cleanupTimer);
    this.parties.delete(party.id);
    const recipients = new Set([...party.members, ...party.invited]);
    for (const id of recipients) {
      const connection = this.connections.get(id);
      if (connection?.lobbyChannel === party.lobbyChannel) {
        this.send(connection, { type: 'party_cancelled', partyId: party.id, reason });
      }
    }
  }

  expirePlayingParty(partyId) {
    const party = this.parties.get(partyId);
    if (!party || party.state !== 'playing') return;
    const connections = [...party.members]
      .map((id) => this.connections.get(id))
      .filter((connection) => (
        connection?.lobbyChannel === party.lobbyChannel
        && connection.partyId === party.id
      ));
    for (const connection of connections) this.send(connection, { type: 'party_cancelled', partyId, reason: 'expired' });
    for (const connection of connections) this.returnToLobby(connection);
    if (this.parties.has(partyId)) this.cancelParty(party, 'expired');
  }

  launchParty(partyId) {
    const party = this.parties.get(partyId);
    if (!party || party.state !== 'forming') return;
    party.state = 'playing';
    if (party.timer) clearTimeout(party.timer);
    party.timer = null;
    const members = [...party.members]
      .map((id) => this.connections.get(id))
      .filter((connection) => connection?.channel === party.lobbyKey);
    if (!members.length) {
      this.cancelParty(party, 'empty');
      return;
    }
    party.members = new Set(members.map((connection) => connection.clientId));
    const levelChannel = `level:${party.id}`;
    for (const connection of members) {
      this.releaseConnectionVehicle(connection, 'party');
      connection.channel = levelChannel;
      connection.partyId = party.id;
      connection.pose = { x: 0, y: 0.02, z: 0, yaw: 0, moving: false, seq: connection.pose.seq, timestamp: this.clock() };
    }
    for (const connection of this.channelConnections(party.lobbyKey)) {
      for (const member of members) {
        this.send(connection, {
          type: 'leave',
          id: member.clientId,
          online: this.channelConnections(party.lobbyKey).length,
        });
      }
    }
    const snapshot = members.map(clonePlayer);
    for (const connection of members) {
      this.send(connection, {
        type: 'party_launch',
        partyId: party.id,
        levelId: party.levelId,
        levelVersion: party.levelVersion,
      });
      this.send(connection, {
        type: 'channel_snapshot',
        channel: this.wireChannel(connection, levelChannel),
        features: MULTIPLAYER_FEATURES,
        players: snapshot,
        vehicles: [],
        online: snapshot.length,
      });
    }
    party.cleanupTimer = setTimeout(() => this.expirePlayingParty(party.id), this.partyLifetimeMs);
    party.cleanupTimer.unref?.();
  }

  returnToLobby(connection) {
    if (connection.channel === connection.lobbyKey) return;
    this.releaseConnectionVehicle(connection, 'return_lobby');
    const oldChannel = connection.channel;
    const party = connection.partyId ? this.parties.get(connection.partyId) : null;
    this.broadcastChannel(oldChannel, { type: 'leave', id: connection.clientId }, connection.clientId);
    connection.channel = connection.lobbyKey;
    connection.partyId = null;
    connection.pose = { x: 0, y: 0.02, z: 4.2, yaw: 0, moving: false, seq: connection.pose.seq, timestamp: this.clock() };
    if (party) {
      party.members.delete(connection.clientId);
      if (!party.members.size) this.cancelParty(party, 'complete');
    }
    const lobbyPlayers = this.channelConnections(connection.lobbyKey).map(clonePlayer);
    this.send(connection, {
      type: 'channel_snapshot',
      channel: this.wireChannel(connection, connection.lobbyKey),
      lobbyChannel: connection.lobbyChannel,
      features: MULTIPLAYER_FEATURES,
      players: lobbyPlayers,
      vehicles: this.vehiclesForChannel(connection.lobbyChannel),
      online: lobbyPlayers.length,
    });
    this.broadcastChannel(connection.lobbyKey, { type: 'join', player: clonePlayer(connection) }, connection.clientId);
  }

  policyViolation(connection, error) {
    if (connection.webSocket.readyState === WebSocket.OPEN) {
      connection.webSocket.close(1008, error.code ?? 'Invalid message');
    }
  }

  async message(connection, data, isBinary) {
    if (this.connections.get(connection.clientId) !== connection) return;
    const receivedAt = this.clock();
    if (receivedAt - connection.messageWindowStarted >= 1_000) {
      connection.messageWindowStarted = receivedAt;
      connection.messageCount = 0;
    }
    connection.messageCount += 1;
    if (connection.messageCount > MESSAGES_PER_SECOND) {
      this.policyViolation(connection, { code: 'message_rate_limited' });
      return;
    }
    let message;
    try {
      message = parseClientMessage(data, isBinary);
    } catch (error) {
      this.policyViolation(connection, error);
      return;
    }
    if (message.type === 'party_create') {
      this.createParty(connection, message, receivedAt);
      return;
    }
    if (message.type === 'party_respond') {
      this.respondToParty(connection, message, receivedAt);
      return;
    }
    if (message.type === 'party_cancel') {
      const party = this.parties.get(message.partyId);
      if (
        !party
        || party.state !== 'forming'
        || party.lobbyChannel !== connection.lobbyChannel
        || !party.members.has(connection.clientId)
      ) {
        this.send(connection, { type: 'error', code: 'party_cancel_rejected' });
      } else if (party.leaderId === connection.clientId) {
        this.cancelParty(party);
      } else {
        party.members.delete(connection.clientId);
        this.send(connection, { type: 'party_cancelled', partyId: party.id, reason: 'left' });
        this.sendPartyState(party);
      }
      return;
    }
    if (message.type === 'return_lobby') {
      this.returnToLobby(connection);
      return;
    }
    if (message.type === 'vehicle_enter') {
      await this.enterVehicle(connection, message, receivedAt);
      return;
    }
    if (message.type === 'vehicle_state') {
      this.updateVehicle(connection, message, receivedAt);
      return;
    }
    if (message.type === 'vehicle_exit') {
      this.exitVehicle(connection, message);
      return;
    }
    if (message.type === 'vehicle_recover') {
      this.recoverVehicle(connection, message);
      return;
    }
    if (message.type === 'pose') {
      const outsideLevel = connection.channel !== connection.lobbyKey
        && ['x', 'y', 'z'].some((field) => (
          message[field] < MULTIPLAYER_BOUNDS[field].min
          || message[field] > MULTIPLAYER_BOUNDS[field].max
        ));
      if (outsideLevel) {
        this.policyViolation(connection, { code: 'invalid_multiplayer_pose' });
        return;
      }
      const now = receivedAt;
      if (now - connection.poseWindowStarted >= 1_000) {
        connection.poseWindowStarted = now;
        connection.poseCount = 0;
        connection.poseRateNoticeSent = false;
      }
      if (connection.poseCount >= POSES_PER_SECOND) {
        if (!connection.poseRateNoticeSent) {
          this.send(connection, { type: 'error', code: 'pose_rate_limited' });
          connection.poseRateNoticeSent = true;
        }
        return;
      }
      connection.poseCount += 1;
      connection.sequence += 1;
      connection.pose = {
        x: message.x,
        y: message.y,
        z: message.z,
        yaw: message.yaw,
        moving: message.moving,
        seq: connection.sequence,
        timestamp: now,
      };
      this.broadcastChannel(connection.channel, { type: 'pose', id: connection.clientId, ...connection.pose }, connection.clientId);
      return;
    }

    const avatar = this.resolveAvatar(message.avatarId);
    if (connection.name === message.name && connection.avatarId === avatar.avatarId) return;

    const elapsedSinceRefill = Math.max(0, receivedAt - connection.profileRefilledAt);
    const replenished = Math.floor(elapsedSinceRefill / PROFILE_REFILL_MS);
    if (replenished > 0) {
      connection.profileTokens = Math.min(PROFILE_BURST, connection.profileTokens + replenished);
      connection.profileRefilledAt += replenished * PROFILE_REFILL_MS;
    }
    if (connection.profileTokens < 1) {
      const retryAfterMs = Math.max(1, PROFILE_REFILL_MS - (receivedAt - connection.profileRefilledAt));
      if (receivedAt - connection.profileRateNoticeAt >= PROFILE_NOTICE_INTERVAL_MS) {
        connection.profileRateNoticeAt = receivedAt;
        this.send(connection, { type: 'error', code: 'profile_rate_limited', retryAfterMs });
      }
      return;
    }
    connection.profileTokens -= 1;
    connection.name = message.name;
    connection.avatarId = avatar.avatarId;
    connection.avatarUrl = avatar.avatarUrl;
    this.broadcastChannel(connection.channel, { type: 'profile', player: clonePlayer(connection) });
  }

  remove(connection, notify) {
    if (this.connections.get(connection.clientId) !== connection) return false;
    this.releaseConnectionVehicle(connection, 'disconnect');
    this.connections.delete(connection.clientId);
    const remaining = (this.ipConnections.get(connection.ip) ?? 1) - 1;
    if (remaining > 0) this.ipConnections.set(connection.ip, remaining);
    else this.ipConnections.delete(connection.ip);
    if (notify) this.broadcastChannel(connection.channel, { type: 'leave', id: connection.clientId });
    for (const party of [...this.parties.values()]) {
      if (party.state !== 'forming') continue;
      if (party.leaderId === connection.clientId) this.cancelParty(party, 'leader_left');
      else if (party.members.delete(connection.clientId)) this.sendPartyState(party);
      else party.invited.delete(connection.clientId);
    }
    if (!this.connections.size) this.stopPing();
    return true;
  }

  startPing() {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const connection of [...this.connections.values()]) {
        if (!connection.alive) {
          connection.webSocket.terminate();
          this.remove(connection, true);
          continue;
        }
        connection.alive = false;
        try {
          connection.webSocket.ping();
        } catch {
          connection.webSocket.terminate();
          this.remove(connection, true);
        }
      }
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  stopPing() {
    if (!this.pingTimer) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    for (const party of this.parties.values()) {
      if (party.timer) clearTimeout(party.timer);
      if (party.cleanupTimer) clearTimeout(party.cleanupTimer);
    }
    this.parties.clear();
    if (this.server) {
      this.server.off('upgrade', this.upgradeListener);
      this.server = null;
    }
    for (const lease of this.vehicleLeases.values()) {
      if (lease.timer) clearTimeout(lease.timer);
    }
    this.vehicleLeases.clear();
    for (const recovery of this.vehicleRecoveries.values()) {
      if (recovery.timer) clearTimeout(recovery.timer);
    }
    this.vehicleRecoveries.clear();
    this.driverLeases.clear();
    this.vehicleStates.clear();
    this.vehicleMutationLocks.clear();
    for (const connection of [...this.connections.values()]) {
      connection.suppressLeave = true;
      connection.webSocket.terminate();
      this.remove(connection, false);
    }
    this.webSocketServer.close();
  }
}
