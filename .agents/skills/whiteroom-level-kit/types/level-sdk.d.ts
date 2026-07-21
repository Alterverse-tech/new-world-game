import type * as Three from 'three';

export type Vec3 = [number, number, number];
export type LevelType = 'reach_zone' | 'collect' | 'puzzle' | 'survive' | 'eliminate' | 'escape' | 'custom';

export interface LevelHandle {
  onUpdate?(dt: number, elapsed: number): void;
  onDispose?(): void;
}

export interface SeededRandom {
  next(): number;
  range(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
}

export interface PlayerAPI {
  getPosition(): Three.Vector3;
  spawn(position: Vec3, yawDeg?: number): void;
  teleport(position: Vec3, yawDeg?: number): void;
  setCheckpoint(position?: Vec3, yawDeg?: number): void;
}

export interface PhysicsAPI {
  addCollider(object: Three.Object3D): void;
}

export interface StateAPI {
  setFlag(name: string, value?: boolean): void;
  getFlag(name: string): boolean;
  complete(): void;
  win(): void;
  fail(reason?: string, options?: { reset?: boolean }): void;
}

export interface HelpersAPI {
  triggerZone(options: {
    position: Vec3;
    size: Vec3;
    goal?: boolean;
    once?: boolean;
    visible?: boolean;
    onEnter?: () => void;
    onExit?: () => void;
  }): unknown;
  goalZone(options: { position: Vec3; size: Vec3; visible?: boolean }): unknown;
  collectible(options: {
    position: Vec3;
    mesh?: Three.Object3D;
    preset?: 'orb' | 'cube' | 'star';
    id?: string;
    onCollect?: () => void;
  }): unknown;
  button(options: { position: Vec3; label: string; flag?: string; once?: boolean; onPress?: () => void }): unknown;
  pressurePlate(options: { position: Vec3; size?: Vec3; flag?: string; once?: boolean; onPress?: () => void }): unknown;
  target(options: { mesh: Three.Object3D; hits?: number; onDown?: () => void }): unknown;
  label(position: Vec3, text: string, options?: { size?: number; color?: string }): Three.Sprite;
}

export interface SceneAPI extends Three.Group {
  addBox(options?: Record<string, unknown>): Three.Mesh;
  addCylinder(options?: Record<string, unknown>): Three.Mesh;
  addSphere(options?: Record<string, unknown>): Three.Mesh;
  addText(options: { text: string; position?: Vec3; color?: string; background?: string; size?: number }): Three.Sprite;
}

export interface LevelSDK {
  THREE: typeof Three;
  scene: SceneAPI;
  version: string;
  random: SeededRandom;
  player: PlayerAPI;
  physics: PhysicsAPI;
  helpers: HelpersAPI;
  interact: { register(object: Three.Object3D, options: { label: string; onUse: () => void; maxDistance?: number }): unknown };
  state: StateAPI;
  objective: { set(text: string): void; updateProgress(text: string): void };
  ui: { toast(text: string, milliseconds?: number): void; subtitle(text: string, milliseconds?: number): void };
  env: {
    setBackground(colorOrPreset: string): void;
    setFog(color: string, near: number, far: number): void;
    addSun(options?: { color?: string; intensity?: number; castShadow?: boolean; direction?: Vec3 }): Three.Light;
    setAmbient(color: string, intensity: number): void;
  };
}

export type CreateLevel = (sdk: LevelSDK) => LevelHandle | Promise<LevelHandle>;
