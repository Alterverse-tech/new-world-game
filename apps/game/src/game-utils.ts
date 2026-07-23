import type { LevelDefinition } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const remainder = (safe % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export interface PlanarDirection {
  x: number;
  z: number;
}

export interface HubGroundResolution {
  position: { x: number; y: number; z: number };
  verticalVelocity: number;
  grounded: boolean;
}

/**
 * Keeps the shared lobby walkable beyond the finite decorative floor mesh.
 * Party levels deliberately retain their authored collision-only ground.
 */
export function resolveHubInfiniteGround(
  position: Readonly<{ x: number; y: number; z: number }>,
  verticalVelocity: number,
  levelActive: boolean,
): HubGroundResolution {
  const next = {
    position: { x: position.x, y: position.y, z: position.z },
    verticalVelocity,
    grounded: false,
  };
  if (
    levelActive
    || ![position.x, position.y, position.z, verticalVelocity].every(Number.isFinite)
    || verticalVelocity > 0
    || position.y > 0.002
  ) return next;
  next.position.y = 0.002;
  next.verticalVelocity = 0;
  next.grounded = true;
  return next;
}

export type AvatarAnimationMode = 'standing' | 'running';

export function resolveAvatarAnimationMode(
  forwardInput: number,
  rightInput: number,
  enabled = true,
): AvatarAnimationMode {
  if (!enabled || !Number.isFinite(forwardInput) || !Number.isFinite(rightInput)) return 'standing';
  return forwardInput !== 0 || rightInput !== 0 ? 'running' : 'standing';
}

function normalizeYaw(value: number): number {
  const full = Math.PI * 2;
  return ((value + Math.PI) % full + full) % full - Math.PI;
}

export function cameraRelativeMovement(
  forwardInput: number,
  rightInput: number,
  cameraYaw: number,
): PlanarDirection {
  if (![forwardInput, rightInput, cameraYaw].every(Number.isFinite)) return { x: 0, z: 0 };
  const x = -Math.sin(cameraYaw) * forwardInput + Math.cos(cameraYaw) * rightInput;
  const z = -Math.cos(cameraYaw) * forwardInput - Math.sin(cameraYaw) * rightInput;
  const length = Math.hypot(x, z);
  return length > 0.000001 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function movementFacingYaw(moveX: number, moveZ: number, fallbackYaw: number): number {
  if (![moveX, moveZ, fallbackYaw].every(Number.isFinite) || Math.hypot(moveX, moveZ) <= 0.000001) {
    return Number.isFinite(fallbackYaw) ? normalizeYaw(fallbackYaw) : 0;
  }
  return normalizeYaw(Math.atan2(-moveX, -moveZ));
}

export function chooseLevel(
  levels: readonly LevelDefinition[],
  recent: readonly string[],
  random: () => number = Math.random,
  avoidId?: string,
): LevelDefinition {
  if (levels.length === 0) throw new Error('No levels available');
  const excludeCount = Math.min(3, Math.max(0, levels.length - 1));
  const excluded = new Set(recent.slice(-excludeCount));
  if (avoidId && levels.length > 1) excluded.add(avoidId);
  let candidates = levels.filter((level) => !excluded.has(level.id));
  if (candidates.length === 0) {
    candidates = levels.filter((level) => level.id !== avoidId);
  }
  if (candidates.length === 0) candidates = [...levels];
  const index = Math.min(candidates.length - 1, Math.floor(clamp(random(), 0, 0.999999) * candidates.length));
  return candidates[index] ?? candidates[0]!;
}

export function difficultyStars(difficulty: number): string {
  const filled = '★'.repeat(clamp(Math.round(difficulty), 0, 5));
  const empty = '☆'.repeat(5 - filled.length);
  return filled + empty;
}
