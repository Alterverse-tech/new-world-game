import * as THREE from 'three';
import type {
  LobbyCarCapability,
  LobbyFixedWingCapability,
  LobbyRotorcraftCapability,
  LobbyVehicleAnchor,
  LobbyVehicleCapability,
  LobbyVehiclePhase,
  LobbyVehicleVisualState,
} from './lobby-props/types';

export const LOBBY_VEHICLE_FIXED_STEP = 1 / 60;

// Box3 values produced from a mesh that ends exactly at ground level can retain
// a few floating-point ulps above y=0. Treat surface contact as contact, not as
// penetration, otherwise a grounded vehicle collides with the lobby floor on
// every fixed step and loses all velocity.
const COLLISION_CONTACT_EPSILON = 1e-4;

const DEFAULT_WORLD_BOUNDS = Object.freeze({
  minX: -54,
  maxX: 54,
  minY: 0,
  maxY: 40,
  minZ: -54,
  maxZ: 54,
});

export interface LobbyVehicleVector {
  x: number;
  y: number;
  z: number;
}

export interface LobbyVehicleAabb {
  min: LobbyVehicleVector;
  max: LobbyVehicleVector;
}

export interface LobbyVehicleEnvironment {
  groundY?: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;
  colliders?: readonly LobbyVehicleAabb[];
  playerHalfExtents?: LobbyVehicleVector;
}

export interface LobbyVehicleInput {
  throttle?: number;
  steering?: number;
  brake?: number;
  pitch?: number;
  yaw?: number;
  roll?: number;
  vertical?: number;
}

export interface LobbyRotorcraftLandingTarget {
  x: number;
  z: number;
}

export interface LobbyVehicleState {
  phase: LobbyVehiclePhase;
  phaseElapsed: number;
  position: LobbyVehicleVector;
  velocity: LobbyVehicleVector;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  steering: number;
  grounded: boolean;
  exitPosition: LobbyVehicleVector | null;
}

export type LobbyVehicleExitReason = 'ok' | 'not_driving' | 'moving_too_fast' | 'airborne' | 'no_safe_space';

export interface LobbyVehicleExitDecision {
  allowed: boolean;
  reason: LobbyVehicleExitReason;
  position: LobbyVehicleVector | null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return THREE.MathUtils.clamp(finite(value, fallback), min, max);
}

function clampUnit(value: unknown): number {
  return clampNumber(value, 0, -1, 1);
}

function normalizeAngle(value: number): number {
  const full = Math.PI * 2;
  return ((value + Math.PI) % full + full) % full - Math.PI;
}

function readAnchor(value: unknown, fallback: LobbyVehicleAnchor, limit = 20): LobbyVehicleAnchor {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [
    clampNumber(value[0], fallback[0], -limit, limit),
    clampNumber(value[1], fallback[1], -limit, limit),
    clampNumber(value[2], fallback[2], -limit, limit),
  ];
}

function physicsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeLobbyVehicleCapability(value: unknown): LobbyVehicleCapability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.kind !== 'car' && source.kind !== 'aircraft') return null;
  const physics = physicsRecord(source.physics);
  const seatAnchor = readAnchor(source.seatAnchor, [0, 0.8, 0], 8);
  const cameraAnchor = readAnchor(source.cameraAnchor, [0, 1.2, 1.4], 12);
  const exitSource = Array.isArray(source.exitAnchors) ? source.exitAnchors.slice(0, 8) : [];
  const exitAnchors = (exitSource.length ? exitSource : [[-1.4, 0, 0], [1.4, 0, 0]])
    .map((anchor) => readAnchor(anchor, [-1.4, 0, 0], 12));
  const rawHalfExtents = readAnchor(source.collisionHalfExtents, [1, 0.7, 2], 8);
  const collisionHalfExtents: LobbyVehicleAnchor = [
    THREE.MathUtils.clamp(Math.abs(rawHalfExtents[0]), 0.25, 8),
    THREE.MathUtils.clamp(Math.abs(rawHalfExtents[1]), 0.15, 4),
    THREE.MathUtils.clamp(Math.abs(rawHalfExtents[2]), 0.25, 8),
  ];
  const common = {
    seatAnchor,
    exitAnchors,
    cameraAnchor,
    collisionHalfExtents,
    enterDurationSeconds: clampNumber(source.enterDurationSeconds, 0.45, 0, 2),
    exitDurationSeconds: clampNumber(source.exitDurationSeconds, 0.35, 0, 2),
  };
  if (source.kind === 'car') {
    return {
      kind: 'car',
      ...common,
      physics: {
        massKg: clampNumber(physics.massKg, 1_200, 100, 20_000),
        maxForwardSpeed: clampNumber(physics.maxForwardSpeed, 24, 2, 80),
        maxReverseSpeed: clampNumber(physics.maxReverseSpeed, 7, 1, 30),
        engineAcceleration: clampNumber(physics.engineAcceleration, 10, 0.5, 60),
        reverseAcceleration: clampNumber(physics.reverseAcceleration, 6, 0.5, 40),
        brakeDeceleration: clampNumber(physics.brakeDeceleration, 18, 1, 80),
        rollingResistance: clampNumber(physics.rollingResistance, 1.1, 0.01, 10),
        aerodynamicDrag: clampNumber(physics.aerodynamicDrag, 0.025, 0, 0.25),
        wheelBase: clampNumber(physics.wheelBase, 2.35, 0.5, 8),
        maxSteerAngle: clampNumber(physics.maxSteerAngle, 0.55, 0.05, 1.2),
        steeringResponse: clampNumber(physics.steeringResponse, 8, 0.5, 30),
        collisionRestitution: clampNumber(physics.collisionRestitution, 0.08, 0, 0.5),
        maxExitSpeed: clampNumber(physics.maxExitSpeed, 1.25, 0.1, 5),
      },
    };
  }
  if (source.flightModel === 'rotorcraft') {
    return {
      kind: 'aircraft',
      flightModel: 'rotorcraft',
      ...common,
      physics: {
        massKg: clampNumber(physics.massKg, 1_180, 100, 100_000),
        maxSpeed: clampNumber(physics.maxSpeed, 7.4, 2, 60),
        maxReverseSpeed: clampNumber(physics.maxReverseSpeed, 2.6, 0.5, 30),
        maxVerticalSpeed: clampNumber(physics.maxVerticalSpeed, 3.6, 0.5, 20),
        engineAcceleration: clampNumber(physics.engineAcceleration, 5.8, 0.5, 40),
        verticalAcceleration: clampNumber(physics.verticalAcceleration, 4.5, 0.5, 30),
        groundBrakeDeceleration: clampNumber(physics.groundBrakeDeceleration, 8, 0.5, 60),
        horizontalDrag: clampNumber(physics.horizontalDrag, 4.2, 0.1, 20),
        yawRate: clampNumber(physics.yawRate, 1.45, 0.05, 3),
        pitchRate: clampNumber(physics.pitchRate, 1.2, 0.05, 4),
        rollRate: clampNumber(physics.rollRate, 1.6, 0.05, 5),
        maxPitch: clampNumber(physics.maxPitch, 0.38, 0.05, 0.9),
        maxRoll: clampNumber(physics.maxRoll, 0.48, 0.05, 1.1),
        controlResponse: clampNumber(physics.controlResponse, 5.4, 0.2, 20),
        throttleResponse: clampNumber(physics.throttleResponse, 4.8, 0.1, 20),
        collisionRestitution: clampNumber(physics.collisionRestitution, 0.04, 0, 0.5),
        maxExitSpeed: clampNumber(physics.maxExitSpeed, 1.2, 0.1, 5),
      },
    };
  }
  return {
    kind: 'aircraft',
    flightModel: 'fixed-wing',
    ...common,
    physics: {
      massKg: clampNumber(physics.massKg, 780, 100, 100_000),
      maxSpeed: clampNumber(physics.maxSpeed, 48, 5, 140),
      engineAcceleration: clampNumber(physics.engineAcceleration, 14, 0.5, 60),
      groundBrakeDeceleration: clampNumber(physics.groundBrakeDeceleration, 10, 0.5, 60),
      aerodynamicDrag: clampNumber(physics.aerodynamicDrag, 0.018, 0.001, 0.2),
      liftCoefficient: clampNumber(physics.liftCoefficient, 1.08, 0.2, 2.5),
      stallSpeed: clampNumber(physics.stallSpeed, 13, 3, 60),
      gravity: clampNumber(physics.gravity, 9.81, 1, 30),
      pitchRate: clampNumber(physics.pitchRate, 0.75, 0.05, 3),
      yawRate: clampNumber(physics.yawRate, 0.42, 0.05, 2),
      rollRate: clampNumber(physics.rollRate, 1.15, 0.05, 4),
      bankTurnRate: clampNumber(physics.bankTurnRate, 0.72, 0, 3),
      maxPitch: clampNumber(physics.maxPitch, 0.72, 0.1, 1.35),
      maxRoll: clampNumber(physics.maxRoll, 1.05, 0.1, 1.5),
      controlResponse: clampNumber(physics.controlResponse, 4.8, 0.2, 20),
      velocityAlignment: clampNumber(physics.velocityAlignment, 1.8, 0, 10),
      throttleResponse: clampNumber(physics.throttleResponse, 1.8, 0.1, 10),
      ceiling: clampNumber(physics.ceiling, 34, 4, 120),
      collisionRestitution: clampNumber(physics.collisionRestitution, 0.06, 0, 0.5),
      maxExitSpeed: clampNumber(physics.maxExitSpeed, 2, 0.1, 8),
    },
  };
}

export function createLobbyVehicleState(
  position: LobbyVehicleVector = { x: 0, y: 0, z: 0 },
  yaw = 0,
): LobbyVehicleState {
  return {
    phase: 'idle',
    phaseElapsed: 0,
    position: { x: finite(position.x, 0), y: finite(position.y, 0), z: finite(position.z, 0) },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: normalizeAngle(finite(yaw, 0)),
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    steering: 0,
    grounded: true,
    exitPosition: null,
  };
}

function cloneState(state: LobbyVehicleState): LobbyVehicleState {
  return {
    ...state,
    position: { ...state.position },
    velocity: { ...state.velocity },
    exitPosition: state.exitPosition ? { ...state.exitPosition } : null,
  };
}

export function beginLobbyVehicleEnter(state: LobbyVehicleState): LobbyVehicleState {
  if (state.phase !== 'idle') return cloneState(state);
  return { ...cloneState(state), phase: 'entering', phaseElapsed: 0, exitPosition: null };
}

function world(environment: LobbyVehicleEnvironment): Required<Omit<LobbyVehicleEnvironment, 'colliders' | 'playerHalfExtents'>> {
  const groundY = finite(environment.groundY, DEFAULT_WORLD_BOUNDS.minY);
  return {
    groundY,
    minX: finite(environment.minX, DEFAULT_WORLD_BOUNDS.minX),
    maxX: finite(environment.maxX, DEFAULT_WORLD_BOUNDS.maxX),
    minY: finite(environment.minY, groundY),
    maxY: finite(environment.maxY, DEFAULT_WORLD_BOUNDS.maxY),
    minZ: finite(environment.minZ, DEFAULT_WORLD_BOUNDS.minZ),
    maxZ: finite(environment.maxZ, DEFAULT_WORLD_BOUNDS.maxZ),
  };
}

function rotatedHalfExtents(capability: LobbyVehicleCapability, yaw: number): LobbyVehicleVector {
  const [x, y, z] = capability.collisionHalfExtents;
  const cosine = Math.abs(Math.cos(yaw));
  const sine = Math.abs(Math.sin(yaw));
  return { x: x * cosine + z * sine, y, z: z * cosine + x * sine };
}

function overlapsAt(
  position: LobbyVehicleVector,
  half: LobbyVehicleVector,
  colliders: readonly LobbyVehicleAabb[],
): boolean {
  const minY = position.y;
  const maxY = position.y + half.y * 2;
  return colliders.some((box) => (
    position.x - half.x < box.max.x - COLLISION_CONTACT_EPSILON
    && position.x + half.x > box.min.x + COLLISION_CONTACT_EPSILON
    && minY < box.max.y - COLLISION_CONTACT_EPSILON
    && maxY > box.min.y + COLLISION_CONTACT_EPSILON
    && position.z - half.z < box.max.z - COLLISION_CONTACT_EPSILON
    && position.z + half.z > box.min.z + COLLISION_CONTACT_EPSILON
  ));
}

function overlapVolumesAt(
  position: LobbyVehicleVector,
  half: LobbyVehicleVector,
  colliders: readonly LobbyVehicleAabb[],
): number[] {
  const vehicleMin = {
    x: position.x - half.x,
    y: position.y,
    z: position.z - half.z,
  };
  const vehicleMax = {
    x: position.x + half.x,
    y: position.y + half.y * 2,
    z: position.z + half.z,
  };
  return colliders.map((box) => {
    const overlapX = Math.max(0, Math.min(vehicleMax.x, box.max.x - COLLISION_CONTACT_EPSILON)
      - Math.max(vehicleMin.x, box.min.x + COLLISION_CONTACT_EPSILON));
    const overlapY = Math.max(0, Math.min(vehicleMax.y, box.max.y - COLLISION_CONTACT_EPSILON)
      - Math.max(vehicleMin.y, box.min.y + COLLISION_CONTACT_EPSILON));
    const overlapZ = Math.max(0, Math.min(vehicleMax.z, box.max.z - COLLISION_CONTACT_EPSILON)
      - Math.max(vehicleMin.z, box.min.z + COLLISION_CONTACT_EPSILON));
    return overlapX * overlapY * overlapZ;
  });
}

function strictlyReducesPenetration(
  previous: LobbyVehicleVector,
  candidate: LobbyVehicleVector,
  half: LobbyVehicleVector,
  colliders: readonly LobbyVehicleAabb[],
): boolean {
  const before = overlapVolumesAt(previous, half, colliders);
  const after = overlapVolumesAt(candidate, half, colliders);
  const epsilon = 1e-9;
  let beforeTotal = 0;
  let afterTotal = 0;
  for (let index = 0; index < before.length; index += 1) {
    const beforeVolume = before[index] ?? 0;
    const afterVolume = after[index] ?? 0;
    beforeTotal += beforeVolume;
    afterTotal += afterVolume;
    // Escape movement may not enter a new collider or trade one penetration
    // for a deeper one elsewhere. It must be monotonic for every collider.
    if (afterVolume > beforeVolume + epsilon) return false;
  }
  return beforeTotal > epsilon && afterTotal < beforeTotal - epsilon;
}

function clampHorizontal(
  position: LobbyVehicleVector,
  half: LobbyVehicleVector,
  environment: LobbyVehicleEnvironment,
): { position: LobbyVehicleVector; hit: boolean } {
  const bounds = world(environment);
  const x = THREE.MathUtils.clamp(position.x, bounds.minX + half.x, bounds.maxX - half.x);
  const z = THREE.MathUtils.clamp(position.z, bounds.minZ + half.z, bounds.maxZ - half.z);
  return { position: { ...position, x, z }, hit: x !== position.x || z !== position.z };
}

function moveWithCollisions(
  previous: LobbyVehicleVector,
  desired: LobbyVehicleVector,
  half: LobbyVehicleVector,
  environment: LobbyVehicleEnvironment,
  constrainHorizontal = true,
): { position: LobbyVehicleVector; hit: boolean } {
  const colliders = environment.colliders ?? [];
  const finiteDesired = {
    x: finite(desired.x, previous.x),
    y: finite(desired.y, previous.y),
    z: finite(desired.z, previous.z),
  };
  const clamped = constrainHorizontal
    ? clampHorizontal(finiteDesired, half, environment)
    : { position: finiteDesired, hit: false };
  const candidate = clamped.position;
  const startedOverlapping = overlapsAt(previous, half, colliders);
  if (!overlapsAt(candidate, half, colliders)) {
    return { position: candidate, hit: startedOverlapping ? false : clamped.hit };
  }
  if (strictlyReducesPenetration(previous, candidate, half, colliders)) {
    return { position: candidate, hit: false };
  }
  const xOnly = clampHorizontal({ ...previous, x: candidate.x }, half, environment).position;
  if (!overlapsAt(xOnly, half, colliders)) return { position: xOnly, hit: !startedOverlapping };
  if (strictlyReducesPenetration(previous, xOnly, half, colliders)) {
    return { position: xOnly, hit: false };
  }
  const zOnly = clampHorizontal({ ...previous, z: candidate.z }, half, environment).position;
  if (!overlapsAt(zOnly, half, colliders)) return { position: zOnly, hit: !startedOverlapping };
  if (strictlyReducesPenetration(previous, zOnly, half, colliders)) {
    return { position: zOnly, hit: false };
  }
  return { position: { ...previous }, hit: true };
}

function approach(current: number, target: number, response: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, response) * LOBBY_VEHICLE_FIXED_STEP);
  return THREE.MathUtils.lerp(current, target, alpha);
}

function moveToward(current: number, target: number, maxDelta: number): number {
  return current + THREE.MathUtils.clamp(target - current, -Math.max(0, maxDelta), Math.max(0, maxDelta));
}

function forwardVector(yaw: number, pitch = 0): LobbyVehicleVector {
  const cosinePitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosinePitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosinePitch,
  };
}

/** Maps screen-relative A/D turn intent to yaw for a +Z-forward rotorcraft. */
export function lobbyRotorcraftYawInput(turnRightInput: number): number {
  return -clampUnit(turnRightInput);
}

function stepCar(
  state: LobbyVehicleState,
  input: LobbyVehicleInput,
  capability: LobbyCarCapability,
  environment: LobbyVehicleEnvironment,
): LobbyVehicleState {
  const next = cloneState(state);
  const config = capability.physics;
  const controlled = state.phase === 'driving';
  const throttleInput = controlled ? clampUnit(input.throttle) : 0;
  const brakeInput = controlled ? clampNumber(input.brake, 0, 0, 1) : 1;
  next.throttle = throttleInput;
  next.steering = approach(next.steering, controlled ? clampUnit(input.steering) : 0, config.steeringResponse);

  let speed = finite(next.speed, 0);
  let acceleration = 0;
  if (throttleInput > 0) {
    if (speed < -0.15) acceleration += config.brakeDeceleration * throttleInput;
    else acceleration += config.engineAcceleration * throttleInput * (1 - Math.max(0, speed) / config.maxForwardSpeed);
  } else if (throttleInput < 0) {
    if (speed > 0.15) acceleration -= config.brakeDeceleration * -throttleInput;
    else acceleration += config.reverseAcceleration * throttleInput * (1 - Math.max(0, -speed) / config.maxReverseSpeed);
  }
  if (Math.abs(speed) > 0.0001) {
    acceleration -= Math.sign(speed) * (
      config.rollingResistance
      + config.aerodynamicDrag * speed * speed
      + brakeInput * config.brakeDeceleration
    );
  }
  const previousSpeed = speed;
  speed += acceleration * LOBBY_VEHICLE_FIXED_STEP;
  if (previousSpeed !== 0 && Math.sign(previousSpeed) !== Math.sign(speed) && Math.abs(acceleration) > config.rollingResistance) speed = 0;
  speed = THREE.MathUtils.clamp(speed, -config.maxReverseSpeed, config.maxForwardSpeed);
  if (Math.abs(speed) < 0.015 && throttleInput === 0) speed = 0;

  if (Math.abs(speed) > 0.04) {
    const steerAngle = next.steering * config.maxSteerAngle;
    const yawRate = speed / config.wheelBase * Math.tan(steerAngle);
    next.yaw = normalizeAngle(next.yaw + yawRate * LOBBY_VEHICLE_FIXED_STEP);
  }
  const forward = forwardVector(next.yaw);
  const desired = {
    x: next.position.x + forward.x * speed * LOBBY_VEHICLE_FIXED_STEP,
    y: world(environment).groundY,
    z: next.position.z + forward.z * speed * LOBBY_VEHICLE_FIXED_STEP,
  };
  const movement = moveWithCollisions(next.position, desired, rotatedHalfExtents(capability, next.yaw), environment);
  if (movement.hit) speed *= -config.collisionRestitution;
  next.position = movement.position;
  next.velocity = { x: forward.x * speed, y: 0, z: forward.z * speed };
  next.speed = speed;
  next.grounded = true;
  next.pitch = approach(next.pitch, THREE.MathUtils.clamp(-acceleration * 0.008, -0.08, 0.08), 7);
  next.roll = approach(next.roll, THREE.MathUtils.clamp(-next.steering * speed * 0.006, -0.12, 0.12), 7);
  return next;
}

function vectorLength(vector: LobbyVehicleVector): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function stepFixedWing(
  state: LobbyVehicleState,
  input: LobbyVehicleInput,
  capability: LobbyFixedWingCapability,
  environment: LobbyVehicleEnvironment,
): LobbyVehicleState {
  const next = cloneState(state);
  const config = capability.physics;
  const bounds = world(environment);
  const controlled = state.phase === 'driving';
  const throttleTarget = controlled ? clampNumber(input.throttle, 0, 0, 1) : 0;
  next.throttle = approach(next.throttle, throttleTarget, config.throttleResponse);
  next.steering = approach(next.steering, controlled ? clampUnit(input.yaw) : 0, config.controlResponse);
  const pitchInput = controlled ? clampUnit(input.pitch) : 0;
  const rollInput = controlled ? clampUnit(input.roll ?? input.steering) : 0;
  const targetRoll = rollInput * config.maxRoll;
  next.roll = moveToward(
    next.roll,
    approach(next.roll, targetRoll, config.controlResponse),
    config.rollRate * LOBBY_VEHICLE_FIXED_STEP,
  );
  const targetPitch = pitchInput * config.maxPitch;
  next.pitch = moveToward(
    next.pitch,
    approach(next.pitch, targetPitch, config.controlResponse * 0.72),
    config.pitchRate * LOBBY_VEHICLE_FIXED_STEP,
  );
  next.yaw = normalizeAngle(next.yaw + (
    next.steering * config.yawRate
    - Math.sin(next.roll) * config.bankTurnRate
  ) * LOBBY_VEHICLE_FIXED_STEP);

  const forward = forwardVector(next.yaw, next.pitch);
  next.velocity.x += forward.x * next.throttle * config.engineAcceleration * LOBBY_VEHICLE_FIXED_STEP;
  next.velocity.y += forward.y * next.throttle * config.engineAcceleration * LOBBY_VEHICLE_FIXED_STEP;
  next.velocity.z += forward.z * next.throttle * config.engineAcceleration * LOBBY_VEHICLE_FIXED_STEP;
  const airspeed = vectorLength(next.velocity);
  const liftRatio = airspeed / config.stallSpeed;
  const lift = config.gravity * config.liftCoefficient * liftRatio * liftRatio * Math.max(0.12, Math.cos(next.roll));
  next.velocity.y += (Math.min(config.gravity * 2.5, lift) - config.gravity) * LOBBY_VEHICLE_FIXED_STEP;
  const drag = Math.exp(-config.aerodynamicDrag * Math.max(1, airspeed) * LOBBY_VEHICLE_FIXED_STEP);
  next.velocity.x *= drag;
  next.velocity.y *= drag;
  next.velocity.z *= drag;
  if (controlled && config.velocityAlignment > 0 && airspeed > 0.1) {
    const alignment = 1 - Math.exp(-config.velocityAlignment * LOBBY_VEHICLE_FIXED_STEP);
    next.velocity.x = THREE.MathUtils.lerp(next.velocity.x, forward.x * airspeed, alignment);
    next.velocity.y = THREE.MathUtils.lerp(next.velocity.y, forward.y * airspeed, alignment * 0.45);
    next.velocity.z = THREE.MathUtils.lerp(next.velocity.z, forward.z * airspeed, alignment);
  }
  if (next.grounded && (clampNumber(input.brake, controlled ? 0 : 1, 0, 1) > 0 || !controlled)) {
    const horizontal = Math.hypot(next.velocity.x, next.velocity.z);
    const reduced = Math.max(0, horizontal - config.groundBrakeDeceleration * LOBBY_VEHICLE_FIXED_STEP);
    const scale = horizontal > 0.0001 ? reduced / horizontal : 0;
    next.velocity.x *= scale;
    next.velocity.z *= scale;
  }
  const velocityMagnitude = vectorLength(next.velocity);
  if (velocityMagnitude > config.maxSpeed) {
    const scale = config.maxSpeed / velocityMagnitude;
    next.velocity.x *= scale;
    next.velocity.y *= scale;
    next.velocity.z *= scale;
  }
  const desired = {
    x: next.position.x + next.velocity.x * LOBBY_VEHICLE_FIXED_STEP,
    y: next.position.y + next.velocity.y * LOBBY_VEHICLE_FIXED_STEP,
    z: next.position.z + next.velocity.z * LOBBY_VEHICLE_FIXED_STEP,
  };
  const ceiling = Math.min(bounds.maxY, config.ceiling);
  if (desired.y <= bounds.groundY) {
    desired.y = bounds.groundY;
    next.velocity.y = Math.max(0, next.velocity.y);
    next.grounded = true;
    if (Math.hypot(next.velocity.x, next.velocity.z) < config.stallSpeed * 0.35) {
      next.pitch = approach(next.pitch, 0, 4.5);
      next.roll = approach(next.roll, 0, 4.5);
    }
  } else {
    next.grounded = false;
  }
  if (desired.y >= ceiling) {
    desired.y = ceiling;
    next.velocity.y = Math.min(0, next.velocity.y);
  }
  const movement = moveWithCollisions(next.position, desired, rotatedHalfExtents(capability, next.yaw), environment, false);
  if (movement.hit) {
    next.velocity.x *= -config.collisionRestitution;
    next.velocity.y *= -config.collisionRestitution;
    next.velocity.z *= -config.collisionRestitution;
  }
  next.position = movement.position;
  next.position.y = THREE.MathUtils.clamp(next.position.y, bounds.minY, ceiling);
  next.speed = vectorLength(next.velocity);
  return next;
}

function stepRotorcraft(
  state: LobbyVehicleState,
  input: LobbyVehicleInput,
  capability: LobbyRotorcraftCapability,
  environment: LobbyVehicleEnvironment,
): LobbyVehicleState {
  const next = cloneState(state);
  const config = capability.physics;
  const bounds = world(environment);
  const controlled = state.phase === 'driving';
  const forwardInput = controlled ? clampUnit(input.throttle) : 0;
  const yawInput = controlled ? clampUnit(input.yaw ?? input.steering) : 0;
  const verticalInput = controlled ? clampUnit(input.vertical) : 0;
  const horizontalBrake = controlled ? clampNumber(input.brake, 0, 0, 1) : 1;

  next.throttle = approach(next.throttle, forwardInput, config.throttleResponse);
  next.steering = approach(next.steering, yawInput, config.controlResponse);
  next.yaw = normalizeAngle(next.yaw + next.steering * config.yawRate * LOBBY_VEHICLE_FIXED_STEP);

  const forward = forwardVector(next.yaw);
  const side = { x: Math.cos(next.yaw), z: -Math.sin(next.yaw) };
  const forwardSpeed = next.velocity.x * forward.x + next.velocity.z * forward.z;
  const lateralSpeed = next.velocity.x * side.x + next.velocity.z * side.z;
  const targetForwardSpeed = next.throttle >= 0
    ? next.throttle * config.maxSpeed
    : next.throttle * config.maxReverseSpeed;
  const controlledForwardSpeed = moveToward(
    forwardSpeed,
    targetForwardSpeed,
    (config.engineAcceleration + horizontalBrake * config.groundBrakeDeceleration) * LOBBY_VEHICLE_FIXED_STEP,
  );
  const controlledLateralSpeed = approach(
    lateralSpeed,
    0,
    config.horizontalDrag + horizontalBrake * config.groundBrakeDeceleration,
  );
  next.velocity.x = forward.x * controlledForwardSpeed + side.x * controlledLateralSpeed;
  next.velocity.z = forward.z * controlledForwardSpeed + side.z * controlledLateralSpeed;
  next.velocity.y = moveToward(
    next.velocity.y,
    verticalInput * config.maxVerticalSpeed,
    config.verticalAcceleration * LOBBY_VEHICLE_FIXED_STEP,
  );

  if (next.grounded && verticalInput <= 0) {
    const horizontal = Math.hypot(next.velocity.x, next.velocity.z);
    const reduced = Math.max(0, horizontal - config.groundBrakeDeceleration * LOBBY_VEHICLE_FIXED_STEP);
    const scale = horizontal > 0.0001 ? reduced / horizontal : 0;
    next.velocity.x *= scale;
    next.velocity.z *= scale;
    next.velocity.y = Math.max(0, next.velocity.y);
  }

  const targetPitch = -THREE.MathUtils.clamp(
    controlledForwardSpeed / Math.max(0.001, config.maxSpeed),
    -1,
    1,
  ) * config.maxPitch;
  const targetRoll = -next.steering * config.maxRoll;
  next.pitch = moveToward(
    next.pitch,
    approach(next.pitch, targetPitch, config.controlResponse),
    config.pitchRate * LOBBY_VEHICLE_FIXED_STEP,
  );
  next.roll = moveToward(
    next.roll,
    approach(next.roll, targetRoll, config.controlResponse),
    config.rollRate * LOBBY_VEHICLE_FIXED_STEP,
  );

  const desired = {
    x: next.position.x + next.velocity.x * LOBBY_VEHICLE_FIXED_STEP,
    y: next.position.y + next.velocity.y * LOBBY_VEHICLE_FIXED_STEP,
    z: next.position.z + next.velocity.z * LOBBY_VEHICLE_FIXED_STEP,
  };
  if (desired.y <= bounds.groundY) {
    desired.y = bounds.groundY;
    next.velocity.y = 0;
    next.grounded = true;
  } else {
    next.grounded = false;
  }
  const movement = moveWithCollisions(
    next.position,
    desired,
    rotatedHalfExtents(capability, next.yaw),
    environment,
    false,
  );
  if (movement.hit) {
    next.velocity.x *= -config.collisionRestitution;
    next.velocity.y *= -config.collisionRestitution;
    next.velocity.z *= -config.collisionRestitution;
  }
  next.position = movement.position;
  next.position.y = Math.max(bounds.minY, finite(next.position.y, state.position.y));
  next.grounded = next.position.y <= bounds.groundY + 1e-4;
  if (next.grounded && next.velocity.y < 0) next.velocity.y = 0;
  next.speed = vectorLength(next.velocity);
  return next;
}

/** Deterministic input used while a rotorcraft performs a safe automatic landing. */
export function lobbyRotorcraftAutolandInput(
  state: LobbyVehicleState,
  target: LobbyRotorcraftLandingTarget | null = null,
): LobbyVehicleInput {
  const altitude = Math.max(0, finite(state.position.y, 0));
  if (state.grounded || altitude <= 0.001) {
    return { throttle: 0, yaw: 0, vertical: 0, brake: 1 };
  }
  if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
    const dx = target.x - state.position.x;
    const dz = target.z - state.position.z;
    const distance = Math.hypot(dx, dz);
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    if (distance > 0.45) {
      const targetYaw = Math.atan2(dx, dz);
      const yawDelta = normalizeAngle(targetYaw - state.yaw);
      const aligned = Math.abs(yawDelta) < 0.28;
      const stoppingDistance = horizontalSpeed * horizontalSpeed / 16 + 0.3;
      const shouldBrake = !aligned || distance <= stoppingDistance;
      return {
        throttle: shouldBrake ? 0 : THREE.MathUtils.clamp(distance / 12, 0.12, 0.38),
        yaw: THREE.MathUtils.clamp(yawDelta / 0.65, -1, 1),
        vertical: 0,
        brake: shouldBrake ? 1 : 0.1,
      };
    }
    if (horizontalSpeed > 0.12 || Math.abs(state.pitch) > 0.025 || Math.abs(state.roll) > 0.025) {
      return { throttle: 0, yaw: 0, vertical: 0, brake: 1 };
    }
  }
  const descent = altitude > 4
    ? -0.75
    : altitude > 1.25
      ? -0.55
      : altitude > 0.35
        ? -0.38
        : -0.2;
  return { throttle: 0, yaw: 0, vertical: descent, brake: 1 };
}

export function stepLobbyVehicleFixed(
  state: LobbyVehicleState,
  input: LobbyVehicleInput,
  capabilityValue: LobbyVehicleCapability,
  environment: LobbyVehicleEnvironment = {},
): LobbyVehicleState {
  const capability = normalizeLobbyVehicleCapability(capabilityValue);
  if (!capability) return cloneState(state);
  const next = capability.kind === 'car'
    ? stepCar(state, input, capability, environment)
    : capability.flightModel === 'rotorcraft'
      ? stepRotorcraft(state, input, capability, environment)
      : stepFixedWing(state, input, capability, environment);
  next.phaseElapsed = Math.max(0, state.phaseElapsed) + LOBBY_VEHICLE_FIXED_STEP;
  if (state.phase === 'idle') {
    next.phaseElapsed = 0;
  } else if (state.phase === 'entering' && next.phaseElapsed + 1e-9 >= capability.enterDurationSeconds) {
    next.phase = 'driving';
    next.phaseElapsed = 0;
  } else if (state.phase === 'exiting' && next.phaseElapsed + 1e-9 >= capability.exitDurationSeconds) {
    next.phase = 'idle';
    next.phaseElapsed = 0;
  }
  return next;
}

function localAnchorToWorld(anchor: LobbyVehicleAnchor, state: LobbyVehicleState): LobbyVehicleVector {
  const cosine = Math.cos(state.yaw);
  const sine = Math.sin(state.yaw);
  return {
    x: state.position.x + anchor[0] * cosine + anchor[2] * sine,
    y: state.position.y + anchor[1],
    z: state.position.z - anchor[0] * sine + anchor[2] * cosine,
  };
}

function playerExitClear(position: LobbyVehicleVector, environment: LobbyVehicleEnvironment): boolean {
  const bounds = world(environment);
  const half = environment.playerHalfExtents ?? { x: 0.35, y: 0.85, z: 0.35 };
  const center = { x: position.x, y: position.y, z: position.z };
  if (
    center.x - half.x < bounds.minX || center.x + half.x > bounds.maxX
    || center.z - half.z < bounds.minZ || center.z + half.z > bounds.maxZ
    || center.y < bounds.minY || center.y + half.y * 2 > bounds.maxY
  ) return false;
  return !overlapsAt(center, half, environment.colliders ?? []);
}

export function resolveLobbyVehicleExit(
  state: LobbyVehicleState,
  capabilityValue: LobbyVehicleCapability,
  environment: LobbyVehicleEnvironment = {},
): LobbyVehicleExitDecision {
  const capability = normalizeLobbyVehicleCapability(capabilityValue);
  if (!capability || state.phase !== 'driving') return { allowed: false, reason: 'not_driving', position: null };
  if (Math.abs(state.speed) > capability.physics.maxExitSpeed) {
    return { allowed: false, reason: 'moving_too_fast', position: null };
  }
  if (capability.kind === 'aircraft' && (!state.grounded || state.position.y > world(environment).groundY + 0.12)) {
    return { allowed: false, reason: 'airborne', position: null };
  }
  const groundY = world(environment).groundY;
  const configured = capability.exitAnchors.map((anchor) => localAnchorToWorld(anchor, state));
  const fallbackRadius = Math.max(capability.collisionHalfExtents[0], capability.collisionHalfExtents[2]) + 0.9;
  const fallback = Array.from({ length: 8 }, (_, index) => {
    const angle = state.yaw + (index / 8) * Math.PI * 2;
    return {
      x: state.position.x + Math.cos(angle) * fallbackRadius,
      y: groundY,
      z: state.position.z + Math.sin(angle) * fallbackRadius,
    };
  });
  for (const candidate of [...configured, ...fallback]) {
    candidate.y = groundY;
    if (playerExitClear(candidate, environment)) return { allowed: true, reason: 'ok', position: candidate };
  }
  return { allowed: false, reason: 'no_safe_space', position: null };
}

/**
 * Finds an open ground column before automatic descent begins. The search is
 * deterministic and expands around the current position, so a helicopter
 * above a roof first flies clear instead of bouncing forever on the collider.
 */
export function resolveLobbyRotorcraftLandingTarget(
  state: LobbyVehicleState,
  capabilityValue: LobbyVehicleCapability,
  environment: LobbyVehicleEnvironment = {},
): LobbyRotorcraftLandingTarget | null {
  const capability = normalizeLobbyVehicleCapability(capabilityValue);
  if (!capability || capability.kind !== 'aircraft' || capability.flightModel !== 'rotorcraft') return null;
  const bounds = world(environment);
  const half = rotatedHalfExtents(capability, state.yaw);
  const planarHalf = Math.max(capability.collisionHalfExtents[0], capability.collisionHalfExtents[2]);
  const corridorTop = Math.max(bounds.groundY + half.y * 2, state.position.y + half.y * 2);
  const blocking = (environment.colliders ?? []).filter((box) => (
    box.max.y > bounds.groundY + 0.05
    && box.min.y < corridorTop - COLLISION_CONTACT_EPSILON
  ));
  const candidateClear = (x: number, z: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const corridorBlocked = blocking.some((box) => (
      x - planarHalf < box.max.x - COLLISION_CONTACT_EPSILON
      && x + planarHalf > box.min.x + COLLISION_CONTACT_EPSILON
      && z - planarHalf < box.max.z - COLLISION_CONTACT_EPSILON
      && z + planarHalf > box.min.z + COLLISION_CONTACT_EPSILON
    ));
    if (corridorBlocked) return false;
    const grounded: LobbyVehicleState = {
      ...cloneState(state),
      phase: 'driving',
      position: { x, y: bounds.groundY, z },
      velocity: { x: 0, y: 0, z: 0 },
      pitch: 0,
      roll: 0,
      speed: 0,
      throttle: 0,
      steering: 0,
      grounded: true,
      exitPosition: null,
    };
    return resolveLobbyVehicleExit(grounded, capability, environment).allowed;
  };

  if (candidateClear(state.position.x, state.position.z)) {
    return { x: state.position.x, z: state.position.z };
  }
  const spacing = Math.max(3, Math.max(half.x, half.z) * 2 + 0.8);
  let obstacleReach = 24;
  for (const box of blocking) {
    obstacleReach = Math.max(
      obstacleReach,
      Math.hypot(box.min.x - state.position.x, box.min.z - state.position.z),
      Math.hypot(box.max.x - state.position.x, box.max.z - state.position.z),
    );
  }
  const maximumRadius = Math.min(256, obstacleReach + spacing * 2);
  const rings = Math.max(1, Math.ceil(maximumRadius / spacing));
  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = ring * spacing;
    const points = Math.max(12, ring * 8);
    for (let index = 0; index < points; index += 1) {
      const angle = state.yaw + index / points * Math.PI * 2;
      const x = state.position.x + Math.sin(angle) * radius;
      const z = state.position.z + Math.cos(angle) * radius;
      if (candidateClear(x, z)) return { x, z };
    }
  }
  return null;
}

export function lobbyRotorcraftReleaseRequiresAutoland(
  state: LobbyVehicleState,
  capabilityValue: LobbyVehicleCapability,
  environment: LobbyVehicleEnvironment = {},
): boolean {
  const capability = normalizeLobbyVehicleCapability(capabilityValue);
  return Boolean(
    capability?.kind === 'aircraft'
    && capability.flightModel === 'rotorcraft'
    && !resolveLobbyVehicleExit(state, capability, environment).allowed,
  );
}

export function beginLobbyVehicleExit(
  state: LobbyVehicleState,
  capability: LobbyVehicleCapability,
  environment: LobbyVehicleEnvironment = {},
): { state: LobbyVehicleState; decision: LobbyVehicleExitDecision } {
  const decision = resolveLobbyVehicleExit(state, capability, environment);
  if (!decision.allowed || !decision.position) return { state: cloneState(state), decision };
  return {
    state: {
      ...cloneState(state),
      phase: 'exiting',
      phaseElapsed: 0,
      throttle: 0,
      steering: 0,
      exitPosition: { ...decision.position },
    },
    decision,
  };
}

export function lobbyVehicleVisualState(
  state: LobbyVehicleState,
  capability: LobbyVehicleCapability,
): LobbyVehicleVisualState {
  const maxSpeed = capability.kind === 'car' ? capability.physics.maxForwardSpeed : capability.physics.maxSpeed;
  return {
    phase: state.phase,
    speed: state.speed,
    normalizedSpeed: THREE.MathUtils.clamp(Math.abs(state.speed) / Math.max(0.001, maxSpeed), 0, 1),
    throttle: state.throttle,
    steering: state.steering,
    pitch: state.pitch,
    roll: state.roll,
    vertical: capability.kind === 'aircraft' && capability.flightModel === 'rotorcraft'
      ? THREE.MathUtils.clamp(state.velocity.y / capability.physics.maxVerticalSpeed, -1, 1)
      : 0,
    grounded: state.grounded,
  };
}

export class LobbyVehicleSimulation {
  public state: LobbyVehicleState;
  private accumulator = 0;

  public constructor(
    public readonly capability: LobbyVehicleCapability,
    initialState = createLobbyVehicleState(),
  ) {
    const normalized = normalizeLobbyVehicleCapability(capability);
    if (!normalized) throw new TypeError('Lobby vehicle capability is invalid');
    this.capability = normalized;
    this.state = cloneState(initialState);
  }

  public advance(
    seconds: number,
    input: LobbyVehicleInput,
    environment: LobbyVehicleEnvironment = {},
  ): LobbyVehicleState {
    this.accumulator += THREE.MathUtils.clamp(finite(seconds, 0), 0, 0.25);
    let steps = 0;
    while (this.accumulator + 1e-9 >= LOBBY_VEHICLE_FIXED_STEP && steps < 15) {
      this.state = stepLobbyVehicleFixed(this.state, input, this.capability, environment);
      this.accumulator -= LOBBY_VEHICLE_FIXED_STEP;
      steps += 1;
    }
    return cloneState(this.state);
  }
}
