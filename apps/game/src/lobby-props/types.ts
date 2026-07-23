import type * as THREE from 'three';
import type { PersistentSpaceId } from '../lobby-channel';

export type LobbyVehicleKind = 'car' | 'aircraft';
export type LobbyVehiclePhase = 'idle' | 'entering' | 'driving' | 'exiting';
export type LobbyVehicleAnchor = readonly [x: number, y: number, z: number];

export interface LobbyPortalDestination {
  id: string;
  label: string;
  spaceId: PersistentSpaceId;
}

/**
 * Reviewed, data-only portal metadata. Portal props may animate locally, but
 * only the WhiteRoom host is allowed to resolve a destination and transition
 * the player out of the lobby.
 */
export interface LobbyPortalCapability {
  kind: 'space';
  destinations: readonly LobbyPortalDestination[];
}

export type LobbyPhysicsBodyKind = 'fixed' | 'dynamic';
export type LobbyPhysicsVector3 = readonly [x: number, y: number, z: number];

interface LobbyPhysicsColliderBase {
  position: LobbyPhysicsVector3;
  rotation: LobbyPhysicsVector3;
}

export interface LobbyPhysicsBoxCollider extends LobbyPhysicsColliderBase {
  shape: 'box';
  halfExtents: LobbyPhysicsVector3;
}

export interface LobbyPhysicsCapsuleCollider extends LobbyPhysicsColliderBase {
  shape: 'capsule';
  radius: number;
  halfHeight: number;
}

export interface LobbyPhysicsBallCollider extends LobbyPhysicsColliderBase {
  shape: 'ball';
  radius: number;
}

export type LobbyPhysicsCollider =
  | LobbyPhysicsBoxCollider
  | LobbyPhysicsCapsuleCollider
  | LobbyPhysicsBallCollider;

/**
 * Reviewed, data-only rigid-body metadata. The game runtime may translate this
 * descriptor into physics-engine bodies; code props cannot create bodies or
 * mutate the physics world themselves.
 */
export interface LobbyPhysicsDescriptor {
  body: LobbyPhysicsBodyKind;
  mass: number;
  friction: number;
  restitution: number;
  colliders: readonly LobbyPhysicsCollider[];
  breakImpulse?: number;
}

interface LobbyVehicleCapabilityBase {
  kind: LobbyVehicleKind;
  seatAnchor: LobbyVehicleAnchor;
  exitAnchors: readonly LobbyVehicleAnchor[];
  cameraAnchor: LobbyVehicleAnchor;
  collisionHalfExtents: LobbyVehicleAnchor;
  enterDurationSeconds: number;
  exitDurationSeconds: number;
}

export interface LobbyCarPhysicsConfig {
  massKg: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  engineAcceleration: number;
  reverseAcceleration: number;
  brakeDeceleration: number;
  rollingResistance: number;
  aerodynamicDrag: number;
  wheelBase: number;
  maxSteerAngle: number;
  steeringResponse: number;
  collisionRestitution: number;
  maxExitSpeed: number;
}

export interface LobbyAircraftPhysicsConfig {
  massKg: number;
  maxSpeed: number;
  engineAcceleration: number;
  groundBrakeDeceleration: number;
  aerodynamicDrag: number;
  liftCoefficient: number;
  stallSpeed: number;
  gravity: number;
  pitchRate: number;
  yawRate: number;
  rollRate: number;
  bankTurnRate: number;
  maxPitch: number;
  maxRoll: number;
  controlResponse: number;
  velocityAlignment: number;
  throttleResponse: number;
  ceiling: number;
  collisionRestitution: number;
  maxExitSpeed: number;
}

export interface LobbyRotorcraftPhysicsConfig {
  massKg: number;
  maxSpeed: number;
  maxReverseSpeed: number;
  maxVerticalSpeed: number;
  engineAcceleration: number;
  verticalAcceleration: number;
  groundBrakeDeceleration: number;
  horizontalDrag: number;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  maxPitch: number;
  maxRoll: number;
  controlResponse: number;
  throttleResponse: number;
  collisionRestitution: number;
  maxExitSpeed: number;
}

export interface LobbyCarCapability extends LobbyVehicleCapabilityBase {
  kind: 'car';
  physics: LobbyCarPhysicsConfig;
}

export interface LobbyFixedWingCapability extends LobbyVehicleCapabilityBase {
  kind: 'aircraft';
  flightModel?: 'fixed-wing';
  physics: LobbyAircraftPhysicsConfig;
}

export interface LobbyRotorcraftCapability extends LobbyVehicleCapabilityBase {
  kind: 'aircraft';
  flightModel: 'rotorcraft';
  physics: LobbyRotorcraftPhysicsConfig;
}

export type LobbyAircraftCapability = LobbyFixedWingCapability | LobbyRotorcraftCapability;
export type LobbyVehicleCapability = LobbyCarCapability | LobbyAircraftCapability;

export interface LobbyVehicleVisualState {
  phase: LobbyVehiclePhase;
  speed: number;
  normalizedSpeed: number;
  throttle: number;
  steering: number;
  pitch: number;
  roll: number;
  vertical: number;
  grounded: boolean;
}

export interface LobbyPropModule {
  code: string;
  createLobbyProp: () => THREE.Object3D;
  physics?: LobbyPhysicsDescriptor;
  vehicle?: LobbyVehicleCapability;
  portal?: LobbyPortalCapability;
  updateLobbyProp?: (object: THREE.Object3D, elapsed: number) => void;
  updateLobbyVehicleVisual?: (
    object: THREE.Object3D,
    state: LobbyVehicleVisualState,
    elapsed: number,
  ) => void;
  interactLobbyProp?: (object: THREE.Object3D) => void;
  applyLobbyPropInteraction?: (
    object: THREE.Object3D,
    interaction: { sequence: number; ageSeconds: number },
    elapsed: number,
  ) => void;
}
