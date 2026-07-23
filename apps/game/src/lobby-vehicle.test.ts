import { describe, expect, it } from 'vitest';
import { vehicle as helicopter } from './lobby-props/generated/precision-rescue-helicopter';
import {
  beginLobbyVehicleEnter,
  beginLobbyVehicleExit,
  createLobbyVehicleState,
  lobbyRotorcraftAutolandInput,
  lobbyRotorcraftReleaseRequiresAutoland,
  lobbyRotorcraftYawInput,
  LobbyVehicleSimulation,
  normalizeLobbyVehicleCapability,
  resolveLobbyVehicleExit,
  resolveLobbyRotorcraftLandingTarget,
  stepLobbyVehicleFixed,
  type LobbyVehicleEnvironment,
  type LobbyVehicleState,
} from './lobby-vehicle';

function drive(
  state: LobbyVehicleState,
  steps: number,
  input: Parameters<typeof stepLobbyVehicleFixed>[1],
  environment: LobbyVehicleEnvironment = {},
): LobbyVehicleState {
  let next = state;
  for (let index = 0; index < steps; index += 1) {
    next = stepLobbyVehicleFixed(next, input, helicopter, environment);
  }
  return next;
}

function airborneState(y = 1): LobbyVehicleState {
  return {
    ...createLobbyVehicleState({ x: 0, y, z: 0 }),
    phase: 'driving',
    grounded: false,
  };
}

describe('precision rescue helicopter rotorcraft simulation', () => {
  it('normalizes the reviewed rotorcraft type and clamps untrusted tuning', () => {
    const reviewed = normalizeLobbyVehicleCapability(helicopter);
    expect(reviewed).toMatchObject({
      kind: 'aircraft',
      flightModel: 'rotorcraft',
      physics: { massKg: 1_180, maxSpeed: 7.4 },
    });
    expect(reviewed?.physics).not.toHaveProperty('ceiling');
    expect(reviewed?.cameraAnchor[2]).toBeLessThan(0);

    const normalized = normalizeLobbyVehicleCapability({
      ...helicopter,
      collisionHalfExtents: [-100, 0, Number.POSITIVE_INFINITY],
      physics: {
        ...helicopter.physics,
        massKg: -10,
        maxSpeed: 99_999,
        maxVerticalSpeed: 99_999,
        ceiling: 1,
      },
    });
    expect(normalized).toMatchObject({
      kind: 'aircraft',
      flightModel: 'rotorcraft',
      collisionHalfExtents: [8, 0.15, 2],
      physics: { massKg: 100, maxSpeed: 60, maxVerticalSpeed: 20 },
    });
    expect(normalizeLobbyVehicleCapability({ kind: 'boat' })).toBeNull();
  });

  it('keeps controls inert during the deterministic entering phase', () => {
    const entering = beginLobbyVehicleEnter(createLobbyVehicleState());
    expect(entering.phase).toBe('entering');
    const beforeReady = drive(entering, 31, { throttle: 1, vertical: 1, yaw: 1 });
    expect(beforeReady.phase).toBe('entering');
    expect(beforeReady.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(beforeReady.speed).toBe(0);
    const ready = drive(beforeReady, 1, { throttle: 1, vertical: 1, yaw: 1 });
    expect(ready.phase).toBe('driving');
  });

  it('flies forward and backward along the helicopter heading', () => {
    let state = drive(airborneState(1), 60, { vertical: 1 });
    state = drive(state, 60, {});
    const forward = drive(state, 180, { throttle: 1 });
    expect(forward.velocity.z).toBeGreaterThan(4);
    expect(forward.position.z - state.position.z).toBeGreaterThan(8);

    const reverse = drive(forward, 300, { throttle: -1 });
    expect(reverse.velocity.z).toBeLessThan(-1);
    expect(reverse.position.z).toBeLessThan(forward.position.z);
  });

  it('ascends beyond the former gameplay ceiling, hovers, and descends', () => {
    const environment = { maxY: 6 };
    let state: LobbyVehicleState = {
      ...createLobbyVehicleState(),
      phase: 'driving',
    };
    state = drive(state, 240, { vertical: 1 }, environment);
    expect(state.position.y).toBeGreaterThan(10);
    expect(state.position.y).toBeGreaterThan(helicopter.physics.maxSpeed);
    expect(state.grounded).toBe(false);

    state = drive(state, 60, {}, environment);
    const hoverY = state.position.y;
    const hovering = drive(state, 120, {}, environment);
    expect(hovering.position.y).toBeCloseTo(hoverY, 10);
    expect(hovering.velocity.y).toBeCloseTo(0, 10);
    expect(hovering.position.y).toBeGreaterThan(10);

    const landed = drive(hovering, 360, { vertical: -1 }, environment);
    expect(landed.position.y).toBe(0);
    expect(landed.velocity.y).toBe(0);
    expect(landed.grounded).toBe(true);
  });

  it('changes heading and derives pitch and roll from cyclic controls', () => {
    const turned = drive(airborneState(2), 120, { throttle: 1, yaw: 1 });
    expect(Math.abs(turned.yaw)).toBeGreaterThan(1);
    expect(turned.pitch).toBeLessThan(-0.15);
    expect(turned.roll).toBeLessThan(-0.2);
    expect(Math.abs(turned.position.x)).toBeGreaterThan(0.5);
  });

  it('maps A to a visible left turn and D to a visible right turn for the +Z-facing helicopter', () => {
    const left = drive(airborneState(2), 120, {
      throttle: 1,
      yaw: lobbyRotorcraftYawInput(-1),
    });
    const right = drive(airborneState(2), 120, {
      throttle: 1,
      yaw: lobbyRotorcraftYawInput(1),
    });

    expect(lobbyRotorcraftYawInput(-1)).toBe(1);
    expect(lobbyRotorcraftYawInput(1)).toBe(-1);
    expect(left.yaw).toBeGreaterThan(0);
    expect(left.position.x).toBeGreaterThan(0);
    expect(right.yaw).toBeLessThan(0);
    expect(right.position.x).toBeLessThan(0);
  });

  it('allows a stopped ground exit and chooses a collision-free side', () => {
    const parked: LobbyVehicleState = {
      ...createLobbyVehicleState(),
      phase: 'driving',
    };
    const environment: LobbyVehicleEnvironment = {
      colliders: [{ min: { x: -1.5, y: 0, z: -0.5 }, max: { x: -0.75, y: 2, z: 0.5 } }],
    };
    const result = beginLobbyVehicleExit(parked, helicopter, environment);
    expect(result.decision).toMatchObject({ allowed: true, reason: 'ok' });
    expect(result.decision.position?.x).toBeGreaterThan(0);
    expect(result.state.phase).toBe('exiting');
    expect(drive(result.state, 24, {}, environment).phase).toBe('idle');
  });

  it('preserves a safe exit beside an aircraft landed beyond the former hub range', () => {
    const parked: LobbyVehicleState = {
      ...createLobbyVehicleState({ x: 120, y: 0, z: -90 }),
      phase: 'driving',
    };
    const result = beginLobbyVehicleExit(parked, helicopter, {
      minX: -Number.MAX_SAFE_INTEGER,
      maxX: Number.MAX_SAFE_INTEGER,
      minZ: -Number.MAX_SAFE_INTEGER,
      maxZ: Number.MAX_SAFE_INTEGER,
    });
    expect(result.decision).toMatchObject({ allowed: true, reason: 'ok' });
    expect(result.decision.position?.x).toBeGreaterThan(100);
    expect(result.decision.position?.z).toBeLessThan(-80);
  });

  it('forbids exiting while airborne or moving too quickly', () => {
    const airborne = airborneState(2);
    expect(resolveLobbyVehicleExit(airborne, helicopter)).toMatchObject({
      allowed: false,
      reason: 'airborne',
    });
    const moving: LobbyVehicleState = {
      ...createLobbyVehicleState(),
      phase: 'driving',
      speed: helicopter.physics.maxExitSpeed + 0.01,
    };
    expect(resolveLobbyVehicleExit(moving, helicopter)).toMatchObject({
      allowed: false,
      reason: 'moving_too_fast',
    });
    expect(lobbyRotorcraftReleaseRequiresAutoland(airborne, helicopter)).toBe(true);
    expect(lobbyRotorcraftReleaseRequiresAutoland(moving, helicopter)).toBe(true);
    expect(lobbyRotorcraftReleaseRequiresAutoland({
      ...createLobbyVehicleState(),
      phase: 'driving',
    }, helicopter)).toBe(false);
  });

  it('ignores former aircraft arena bounds while still avoiding occupied collision space', () => {
    const environment: LobbyVehicleEnvironment = {
      minX: -5,
      maxX: 5,
      minZ: -8,
      maxZ: 8,
      colliders: [{ min: { x: -2, y: 0, z: 3 }, max: { x: 2, y: 4, z: 5 } }],
    };
    const blocked = drive(airborneState(1), 240, { throttle: 1 }, environment);
    expect(blocked.position.z).toBeLessThan(1.09);

    const beyondFormerBoundary = drive(
      { ...airborneState(12), position: { x: 60, y: 12, z: -90 }, yaw: Math.PI / 2 },
      240,
      { throttle: 1, vertical: 1 },
      { minX: -54, maxX: 54, minZ: -54, maxZ: 54, maxY: 6 },
    );
    expect(beyondFormerBoundary.position.x).toBeGreaterThan(70);
    expect(beyondFormerBoundary.position.z).toBeCloseTo(-90, 6);
    expect(beyondFormerBoundary.position.y).toBeGreaterThan(20);
    expect(Number.isFinite(beyondFormerBoundary.position.x)).toBe(true);
    expect(Number.isFinite(beyondFormerBoundary.position.y)).toBe(true);
  });

  it('autolands deterministically, brakes horizontal motion, and levels before exit', () => {
    const initial: LobbyVehicleState = {
      ...airborneState(8),
      velocity: { x: 5.5, y: 1.4, z: -3.2 },
      speed: Math.hypot(5.5, 1.4, -3.2),
      pitch: -0.34,
      roll: 0.42,
      steering: 0.8,
      throttle: 1,
    };
    let first = initial;
    let second = structuredClone(initial);
    for (let index = 0; index < 900; index += 1) {
      first = stepLobbyVehicleFixed(first, lobbyRotorcraftAutolandInput(first), helicopter, {});
      second = stepLobbyVehicleFixed(second, lobbyRotorcraftAutolandInput(second), helicopter, {});
      if (resolveLobbyVehicleExit(first, helicopter).allowed) break;
    }
    expect(first).toEqual(second);
    expect(first.grounded).toBe(true);
    expect(Math.hypot(first.velocity.x, first.velocity.z)).toBeLessThan(0.05);
    expect(Math.abs(first.pitch)).toBeLessThan(0.01);
    expect(Math.abs(first.roll)).toBeLessThan(0.01);
    expect(resolveLobbyVehicleExit(first, helicopter)).toMatchObject({ allowed: true, reason: 'ok' });
  });

  it('plans clear of a roof before descending and never traps the occupied helicopter above it', () => {
    const environment: LobbyVehicleEnvironment = {
      colliders: [{ min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 4, z: 3 } }],
    };
    let state = airborneState(6.5);
    const target = resolveLobbyRotorcraftLandingTarget(state, helicopter, environment);
    expect(target).not.toBeNull();
    expect(Math.max(Math.abs(target!.x), Math.abs(target!.z))).toBeGreaterThan(3);
    for (let index = 0; index < 3_600; index += 1) {
      state = stepLobbyVehicleFixed(
        state,
        lobbyRotorcraftAutolandInput(state, target),
        helicopter,
        environment,
      );
      if (resolveLobbyVehicleExit(state, helicopter, environment).allowed) break;
    }
    expect(state.grounded, JSON.stringify({ target, state })).toBe(true);
    expect(resolveLobbyVehicleExit(state, helicopter, environment)).toMatchObject({ allowed: true, reason: 'ok' });
  });

  it('reports no landing target when every searched ground column and exit is obstructed', () => {
    expect(resolveLobbyRotorcraftLandingTarget(airborneState(8), helicopter, {
      colliders: [{ min: { x: -400, y: 0, z: -400 }, max: { x: 400, y: 5, z: 400 } }],
    })).toBeNull();
  });

  it('produces the same 60 Hz result for equivalent frame chunks', () => {
    const initial = airborneState(1.5);
    const first = new LobbyVehicleSimulation(helicopter, initial);
    const second = new LobbyVehicleSimulation(helicopter, initial);
    const input = { throttle: 0.8, yaw: 0.25, vertical: 0.15 };
    for (let index = 0; index < 120; index += 1) first.advance(1 / 60, input);
    for (let index = 0; index < 40; index += 1) second.advance(1 / 20, input);
    expect(second.state.position.x).toBeCloseTo(first.state.position.x, 10);
    expect(second.state.position.y).toBeCloseTo(first.state.position.y, 10);
    expect(second.state.position.z).toBeCloseTo(first.state.position.z, 10);
    expect(second.state.yaw).toBeCloseTo(first.state.yaw, 10);
    expect(second.state.pitch).toBeCloseTo(first.state.pitch, 10);
    expect(second.state.roll).toBeCloseTo(first.state.roll, 10);
    expect(second.state.speed).toBeCloseTo(first.state.speed, 10);
  });
});
