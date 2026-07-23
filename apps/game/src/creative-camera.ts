import * as THREE from 'three';

export const CREATIVE_CAMERA_BOUNDS = Object.freeze({
  horizontal: 'unbounded' as const,
  minY: 0.75,
  maxY: 8,
});

export const CREATIVE_CAMERA_SPEED = 7.5;
export const CREATIVE_CAMERA_FAST_SPEED = 18;
export const CREATIVE_CAMERA_CONTROLS =
  'WASD horizontal, Space ascend, Shift/C descend, Ctrl accelerate, hold right mouse and drag to look';

const CREATIVE_MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'ControlRight',
]);

interface KeyboardFocusTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export function shouldHandleCreativeCameraKey(code: string, target: KeyboardFocusTarget | null): boolean {
  if (!CREATIVE_MOVEMENT_KEYS.has(code)) return false;
  const tagName = target?.tagName?.toUpperCase();
  if (tagName === 'BUTTON' || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return false;
  return target?.isContentEditable !== true;
}

export interface CreativeCameraTextState {
  active: boolean;
  position: { x: number; y: number; z: number };
  yawDeg: number;
  pitchDeg: number;
  looking: boolean;
  speed: 'normal' | 'fast';
  playerAnchored: true;
  returnView: 'first' | 'third';
  bounds: typeof CREATIVE_CAMERA_BOUNDS;
  controls: string;
}

export function creativeMovementDirection(keys: ReadonlySet<string>, yaw: number): THREE.Vector3 {
  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const rightInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const verticalInput = (keys.has('Space') ? 1 : 0)
    - (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyC') ? 1 : 0);
  const direction = new THREE.Vector3();
  if (forwardInput !== 0 || rightInput !== 0) {
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    direction.addScaledVector(forward, forwardInput).addScaledVector(right, rightInput);
  }
  direction.y = verticalInput;
  if (direction.lengthSq() > 1) direction.normalize();
  return direction;
}

export function clampCreativeCameraPosition(position: THREE.Vector3): THREE.Vector3 {
  const x = Number.isFinite(position.x) ? position.x : 0;
  const y = Number.isFinite(position.y) ? position.y : CREATIVE_CAMERA_BOUNDS.minY;
  const z = Number.isFinite(position.z) ? position.z : 0;
  position.set(
    x,
    THREE.MathUtils.clamp(y, CREATIVE_CAMERA_BOUNDS.minY, CREATIVE_CAMERA_BOUNDS.maxY),
    z,
  );
  return position;
}

export class LobbyCreativeCamera {
  private readonly position = new THREE.Vector3();
  private active = false;
  private looking = false;
  private fast = false;
  private yaw = 0;
  private pitch = 0;
  private returnView: 'first' | 'third' = 'first';

  public enter(
    camera: THREE.PerspectiveCamera,
    yaw: number,
    pitch: number,
    returnView: 'first' | 'third',
  ): void {
    this.active = true;
    this.looking = false;
    this.fast = false;
    this.returnView = returnView;
    this.position.copy(camera.position);
    clampCreativeCameraPosition(this.position);
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -Math.PI * 0.494, Math.PI * 0.494);
    this.apply(camera);
  }

  public exit(): void {
    this.active = false;
    this.looking = false;
    this.fast = false;
  }

  public beginLook(): void {
    if (this.active) this.looking = true;
  }

  public endLook(): void {
    this.looking = false;
  }

  public look(deltaX: number, deltaY: number, sensitivity: number): void {
    if (!this.active || !this.looking) return;
    const scale = 0.002 * THREE.MathUtils.clamp(sensitivity, 0.2, 3);
    this.yaw -= deltaX * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * scale, -Math.PI * 0.494, Math.PI * 0.494);
  }

  public update(dt: number, keys: ReadonlySet<string>): void {
    if (!this.active) return;
    this.fast = keys.has('ControlLeft') || keys.has('ControlRight');
    const direction = creativeMovementDirection(keys, this.yaw);
    const speed = this.fast ? CREATIVE_CAMERA_FAST_SPEED : CREATIVE_CAMERA_SPEED;
    this.position.addScaledVector(direction, speed * THREE.MathUtils.clamp(dt, 0, 0.1));
    clampCreativeCameraPosition(this.position);
  }

  public apply(camera: THREE.PerspectiveCamera): void {
    if (!this.active) return;
    camera.position.copy(this.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  public get enabled(): boolean {
    return this.active;
  }

  public get isLooking(): boolean {
    return this.looking;
  }

  public getTextState(): CreativeCameraTextState {
    const round = (value: number): number => Number(value.toFixed(2));
    return {
      active: this.active,
      position: { x: round(this.position.x), y: round(this.position.y), z: round(this.position.z) },
      yawDeg: round(THREE.MathUtils.radToDeg(this.yaw)),
      pitchDeg: round(THREE.MathUtils.radToDeg(this.pitch)),
      looking: this.looking,
      speed: this.fast ? 'fast' : 'normal',
      playerAnchored: true,
      returnView: this.returnView,
      bounds: CREATIVE_CAMERA_BOUNDS,
      controls: CREATIVE_CAMERA_CONTROLS,
    };
  }
}
