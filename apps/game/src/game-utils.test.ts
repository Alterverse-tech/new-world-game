import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import {
  cameraRelativeMovement,
  chooseLevel,
  formatTime,
  movementFacingYaw,
  resolveAvatarAnimationMode,
  resolveHubInfiniteGround,
} from './game-utils';

describe('formatTime', () => {
  it('formats and clamps seconds', () => {
    expect(formatTime(95.9)).toBe('01:35');
    expect(formatTime(-3)).toBe('00:00');
  });
});

describe('chooseLevel', () => {
  it('avoids the recent history when another world is available', () => {
    const selected = chooseLevel(LEVELS, [LEVELS[0]!.id, LEVELS[1]!.id], () => 0);
    expect(selected.id).toBe(LEVELS[2]!.id);
  });

  it('never fails when all candidates have been seen', () => {
    const selected = chooseLevel(LEVELS, LEVELS.map((level) => level.id), () => 0.99);
    expect(LEVELS.some((level) => level.id === selected.id)).toBe(true);
  });
});

describe('camera-relative player facing', () => {
  it.each([
    ['W', 1, 0, 0],
    ['S', -1, 0, 180],
    ['A', 0, -1, 90],
    ['D', 0, 1, -90],
    ['W+A', 1, -1, 45],
    ['W+D', 1, 1, -45],
    ['S+A', -1, -1, 135],
    ['S+D', -1, 1, -135],
  ])('faces the actual %s movement direction', (_label, forward, right, expectedDegrees) => {
    const move = cameraRelativeMovement(forward, right, 0);
    expect(Math.hypot(move.x, move.z)).toBeCloseTo(1, 6);
    expect(Math.abs(THREE.MathUtils.radToDeg(movementFacingYaw(move.x, move.z, 0)))).toBeCloseTo(Math.abs(expectedDegrees), 6);
    if (expectedDegrees !== 180) {
      expect(THREE.MathUtils.radToDeg(movementFacingYaw(move.x, move.z, 0))).toBeCloseTo(expectedDegrees, 6);
    }
  });

  it('adds camera yaw and preserves the previous facing for conflicting input', () => {
    const cameraYaw = THREE.MathUtils.degToRad(70);
    const forward = cameraRelativeMovement(1, 0, cameraYaw);
    const backward = cameraRelativeMovement(-1, 0, cameraYaw);
    expect(THREE.MathUtils.radToDeg(movementFacingYaw(forward.x, forward.z, 0))).toBeCloseTo(70, 6);
    expect(Math.abs(THREE.MathUtils.radToDeg(movementFacingYaw(backward.x, backward.z, 0)))).toBeCloseTo(110, 6);

    const stopped = cameraRelativeMovement(0, 0, cameraYaw);
    expect(movementFacingYaw(stopped.x, stopped.z, 1.2)).toBeCloseTo(1.2, 6);
  });
});

describe('input-driven Avatar animation', () => {
  it.each([
    ['W', 1, 0],
    ['S', -1, 0],
    ['A', 0, -1],
    ['D', 0, 1],
    ['diagonal', 1, 1],
  ])('runs only for effective %s movement input', (_label, forward, right) => {
    expect(resolveAvatarAnimationMode(forward, right)).toBe('running');
  });

  it('stands for no input, cancelled directions, or disabled lobby input', () => {
    expect(resolveAvatarAnimationMode(0, 0)).toBe('standing');
    expect(resolveAvatarAnimationMode(1 - 1, 0)).toBe('standing');
    expect(resolveAvatarAnimationMode(0, 1 - 1)).toBe('standing');
    expect(resolveAvatarAnimationMode(1, 0, false)).toBe('standing');
    expect(resolveAvatarAnimationMode(Number.NaN, 0)).toBe('standing');
  });
});

describe('infinite hub ground', () => {
  it('lands a far-away lobby player without changing horizontal coordinates', () => {
    expect(resolveHubInfiniteGround({ x: 120, y: -0.4, z: -90 }, -3.5, false)).toEqual({
      position: { x: 120, y: 0.002, z: -90 },
      verticalVelocity: 0,
      grounded: true,
    });
  });

  it('does not add implicit ground to authored party levels', () => {
    expect(resolveHubInfiniteGround({ x: 120, y: -0.4, z: -90 }, -3.5, true)).toEqual({
      position: { x: 120, y: -0.4, z: -90 },
      verticalVelocity: -3.5,
      grounded: false,
    });
  });
});
