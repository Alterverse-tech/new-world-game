import * as THREE from 'three';
import type { Collectible, Interactable, LevelDefinition, WinType } from './types';

export const WIN_TYPES: readonly WinType[] = [
  'reach_zone',
  'collect',
  'puzzle',
  'survive',
  'eliminate',
  'escape',
  'custom',
];

type Vec3 = [number, number, number];

export interface UGCRegistryEntry {
  id: string;
  name: string;
  author: string;
  type: WinType;
  difficulty: number;
  estimatedMinutes: number;
  description: string;
  objective: string;
  basePath: string;
  hash: string;
}

export interface UGCLevelManifest {
  schema: 'wr-level';
  schemaVersion: 1;
  engineApi: '1';
  id: string;
  name: string;
  author: { name: string };
  description: string;
  language: string;
  objective: string;
  objectiveDetail?: string;
  difficulty: number;
  estimatedMinutes: number;
  spawn: { position: Vec3; yawDeg: number };
  door: { anchor: Vec3; yawDeg: number } | null;
  killY: number;
  entry: string;
  contentRating: 'everyone';
  winCondition: {
    type: WinType;
    required?: number;
    flags?: string[];
    duration?: number;
    timeLimit?: number;
    parTime?: number;
  };
}

export interface UGCLevelHandle {
  onUpdate?: (dt: number, elapsed: number) => void;
  onDispose?: () => void;
}

export interface UGCPressurePlateState {
  id: string;
  flag: string | null;
  pressed: boolean;
  position: Vec3;
}

export interface UGCRuntimeSnapshot {
  pressurePlates: UGCPressurePlateState[];
}

interface PrimitiveOptions {
  position?: Vec3;
  size?: Vec3;
  color?: string | number;
  emissive?: string | number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  collider?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

interface BoxOptions extends PrimitiveOptions {
  size?: Vec3;
}

interface CylinderOptions extends PrimitiveOptions {
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  height?: number;
  segments?: number;
}

interface SphereOptions extends PrimitiveOptions {
  radius?: number;
  segments?: number;
}

interface TextOptions {
  position?: Vec3;
  text: string;
  color?: string;
  background?: string;
  size?: number;
}

export type UGCScene = THREE.Group & {
  addBox: (options?: BoxOptions) => THREE.Mesh;
  addCylinder: (options?: CylinderOptions) => THREE.Mesh;
  addSphere: (options?: SphereOptions) => THREE.Mesh;
  addText: (options: TextOptions) => THREE.Sprite;
};

export interface UGCLevelHost {
  readonly root: THREE.Group;
  addCollider: (object: THREE.Object3D) => void;
  addCollectible: (collectible: Collectible) => void;
  setGoalZone: (position: Vec3, size: Vec3) => void;
  addInteractable: (interactable: Interactable) => void;
  setFlag: (name: string, value: boolean) => void;
  getFlag: (name: string) => boolean;
  complete: () => void;
  fail: (reason: string, reset: boolean) => void;
  teleport: (position: Vec3, yawDeg?: number, checkpoint?: boolean) => void;
  setCheckpoint: (position?: Vec3, yawDeg?: number) => void;
  setBackground: (colorOrPreset: string) => void;
  setFog: (color: string, near: number, far: number) => void;
  addSun: (options?: { color?: string; intensity?: number; castShadow?: boolean; direction?: Vec3 }) => THREE.DirectionalLight;
  setAmbient: (color: string, intensity: number) => void;
  setObjective: (text: string) => void;
  setProgress: (text: string) => void;
  toast: (text: string, ms?: number) => void;
  getPlayerPosition: () => THREE.Vector3;
  registerTarget: () => void;
  downTarget: () => void;
}

interface TriggerState {
  position: Vec3;
  size: Vec3;
  once: boolean;
  inside: boolean;
  fired: boolean;
  onEnter?: () => void;
  onExit?: () => void;
}

interface PressurePlateInternal {
  state: UGCPressurePlateState;
  size: Vec3;
  once: boolean;
  onPress?: () => void;
  material: THREE.MeshStandardMaterial;
}

export class UGCRuntime {
  private readonly host: UGCLevelHost;
  private readonly triggers: TriggerState[] = [];
  private readonly plates: PressurePlateInternal[] = [];
  private readonly textures: THREE.Texture[] = [];

  public constructor(host: UGCLevelHost) {
    this.host = host;
  }

  public addTrigger(trigger: Omit<TriggerState, 'inside' | 'fired'>): void {
    this.triggers.push({ ...trigger, inside: false, fired: false });
  }

  public addPressurePlate(plate: PressurePlateInternal): void {
    this.plates.push(plate);
  }

  public ownTexture(texture: THREE.Texture): void {
    this.textures.push(texture);
  }

  public update(): void {
    const player = this.host.getPlayerPosition();
    for (const trigger of this.triggers) {
      const inside = pointInside(player, trigger.position, trigger.size, 0.35);
      if (inside && !trigger.inside && (!trigger.once || !trigger.fired)) {
        trigger.inside = true;
        trigger.fired = true;
        trigger.onEnter?.();
      } else if (!inside && trigger.inside) {
        trigger.inside = false;
        trigger.onExit?.();
      }
    }

    for (const plate of this.plates) {
      if (plate.state.pressed && plate.once) continue;
      const inside = pointInside(player, plate.state.position, plate.size, 0.42);
      if (!inside || plate.state.pressed) continue;
      plate.state.pressed = true;
      plate.material.emissiveIntensity = 2.2;
      plate.material.color.set('#eaffed');
      if (plate.state.flag) this.host.setFlag(plate.state.flag, true);
      plate.onPress?.();
    }
  }

  public snapshot(): UGCRuntimeSnapshot {
    return {
      pressurePlates: this.plates.map((plate) => ({
        id: plate.state.id,
        flag: plate.state.flag,
        pressed: plate.state.pressed,
        position: [...plate.state.position] as Vec3,
      })),
    };
  }

  public dispose(): void {
    this.textures.forEach((texture) => texture.dispose());
    this.textures.length = 0;
    this.triggers.length = 0;
    this.plates.length = 0;
  }
}

export interface CreatedUGCSdk {
  sdk: Record<string, any>;
  runtime: UGCRuntime;
}

export function createUGCLevelSdk(host: UGCLevelHost, manifest: UGCLevelManifest): CreatedUGCSdk {
  const runtime = new UGCRuntime(host);
  const scene = augmentScene(host, runtime);
  let collectibleIndex = 0;
  let buttonIndex = 0;
  let targetIndex = 0;
  let randomState = hashString(manifest.id) || 0x6d2b79f5;

  const helpers = {
    collectible(options: {
      position: Vec3;
      mesh?: THREE.Object3D;
      preset?: 'orb' | 'cube' | 'star';
      id?: string;
      onCollect?: () => void;
    }): THREE.Object3D {
      const mesh = options.mesh ?? createCollectibleMesh(options.preset ?? 'orb');
      mesh.position.set(...options.position);
      if (!mesh.parent) scene.add(mesh);
      host.addCollectible({
        id: options.id ?? `ugc-collectible-${++collectibleIndex}`,
        mesh,
        baseY: options.position[1],
        collected: false,
        onCollect: options.onCollect,
      });
      return mesh;
    },

    triggerZone(options: {
      position: Vec3;
      size: Vec3;
      goal?: boolean;
      once?: boolean;
      visible?: boolean;
      onEnter?: () => void;
      onExit?: () => void;
    }): THREE.Object3D | null {
      if (options.goal) host.setGoalZone(options.position, options.size);
      else runtime.addTrigger({
        position: [...options.position] as Vec3,
        size: [...options.size] as Vec3,
        once: options.once ?? false,
        onEnter: options.onEnter,
        onExit: options.onExit,
      });
      if (!options.visible) return null;
      const visual = scene.addBox({
        position: options.position,
        size: options.size,
        color: options.goal ? '#fff1a8' : '#7de2d5',
        emissive: options.goal ? '#b9872f' : '#2e8e84',
        opacity: 0.22,
        transparent: true,
        collider: false,
      });
      return visual;
    },

    goalZone(options: { position: Vec3; size: Vec3; visible?: boolean }): THREE.Object3D | null {
      return helpers.triggerZone({ ...options, goal: true });
    },

    label(position: Vec3, text: string, options?: { size?: number; color?: string }): THREE.Sprite {
      return scene.addText({ position, text, size: options?.size, color: options?.color });
    },

    pressurePlate(options: {
      position: Vec3;
      size?: Vec3;
      color?: string;
      label?: string;
      flag?: string;
      once?: boolean;
      onPress?: () => void;
    }): THREE.Mesh {
      const size = options.size ?? [1.8, 0.12, 1.8];
      const mesh = scene.addBox({
        position: options.position,
        size,
        color: options.color ?? '#d1ad62',
        emissive: options.color ?? '#78531e',
        collider: false,
        roughness: 0.3,
        metalness: 0.38,
      });
      runtime.addPressurePlate({
        state: {
          id: options.label ?? `pressure-plate-${++buttonIndex}`,
          flag: options.flag ?? null,
          pressed: false,
          position: [...options.position] as Vec3,
        },
        size: [Math.max(0.6, size[0]), Math.max(1.5, size[1] + 1.4), Math.max(0.6, size[2])],
        once: options.once ?? true,
        onPress: options.onPress,
        material: mesh.material as THREE.MeshStandardMaterial,
      });
      return mesh;
    },

    button(options: {
      position: Vec3;
      label: string;
      flag?: string;
      once?: boolean;
      onPress?: () => void;
    }): Interactable {
      const mesh = scene.addBox({
        position: options.position,
        size: [0.8, 0.35, 0.8],
        color: '#d9b568',
        emissive: '#79541f',
        collider: false,
      });
      const interactable: Interactable = {
        id: `ugc-button-${++buttonIndex}`,
        object: mesh,
        label: options.label,
        maxDistance: 3.2,
        enabled: true,
        onUse: () => {
          if (!interactable.enabled) return;
          if (options.flag) host.setFlag(options.flag, true);
          options.onPress?.();
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.color.set('#eaffed');
          material.emissive.set('#5ad778');
          material.emissiveIntensity = 2;
          if (options.once ?? true) interactable.enabled = false;
        },
      };
      host.addInteractable(interactable);
      return interactable;
    },

    target(options: { mesh?: THREE.Object3D; position?: Vec3; hits?: number; label?: string; onDown?: () => void }): Interactable {
      const mesh = options.mesh ?? scene.addSphere({
        position: options.position ?? [0, 1.2, 0],
        radius: 0.55,
        color: '#ef806a',
        emissive: '#7d241c',
        collider: false,
      });
      if (!mesh.parent) scene.add(mesh);
      let hits = Math.max(1, Math.floor(options.hits ?? 1));
      host.registerTarget();
      const interactable: Interactable = {
        id: `ugc-target-${++targetIndex}`,
        object: mesh,
        label: options.label ?? `关闭目标（剩余 ${hits}）`,
        maxDistance: 3.2,
        enabled: true,
        onUse: () => {
          if (!interactable.enabled) return;
          hits -= 1;
          interactable.label = hits > 0 ? `关闭目标（剩余 ${hits}）` : '目标已关闭';
          if (hits > 0) return;
          interactable.enabled = false;
          mesh.visible = false;
          host.downTarget();
          options.onDown?.();
        },
      };
      host.addInteractable(interactable);
      return interactable;
    },
  };

  const sdk = {
    THREE,
    version: '1.0.0',
    scene,
    random: {
      next(): number {
        randomState |= 0;
        randomState = (randomState + 0x6d2b79f5) | 0;
        let value = randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      },
      range(min: number, max: number): number {
        return min + (max - min) * sdk.random.next();
      },
      pick<T>(items: readonly T[]): T | undefined {
        return items[Math.floor(sdk.random.next() * items.length)];
      },
    },
    physics: {
      addCollider: (object: THREE.Object3D) => host.addCollider(object),
    },
    helpers,
    interact: {
      register(object: THREE.Object3D, options: { label: string; onUse: () => void; maxDistance?: number }): Interactable {
        const interactable: Interactable = {
          id: `ugc-interaction-${++buttonIndex}`,
          object,
          label: options.label,
          maxDistance: options.maxDistance ?? 3.2,
          enabled: true,
          onUse: options.onUse,
        };
        host.addInteractable(interactable);
        return interactable;
      },
    },
    state: {
      setFlag: (name: string, value = true) => host.setFlag(name, value),
      getFlag: (name: string) => host.getFlag(name),
      complete: () => host.complete(),
      win: () => host.complete(),
      fail: (reason = 'custom', options?: { reset?: boolean }) => host.fail(reason, Boolean(options?.reset)),
    },
    player: {
      getPosition: () => host.getPlayerPosition().clone(),
      spawn: (position: Vec3, yawDeg?: number) => host.teleport(position, yawDeg, true),
      teleport: (position: Vec3, yawDeg?: number) => host.teleport(position, yawDeg, false),
      setCheckpoint: (position?: Vec3, yawDeg?: number) => host.setCheckpoint(position, yawDeg),
    },
    env: {
      setBackground: (colorOrPreset: string) => host.setBackground(colorOrPreset),
      setFog: (color: string, near: number, far: number) => host.setFog(color, near, far),
      addSun: (options?: { color?: string; intensity?: number; castShadow?: boolean; direction?: Vec3 }) => host.addSun(options),
      setAmbient: (color: string, intensity: number) => host.setAmbient(color, intensity),
    },
    objective: {
      set: (text: string) => host.setObjective(text),
      updateProgress: (text: string) => host.setProgress(text),
    },
    ui: {
      toast: (text: string, ms?: number) => host.toast(text, ms),
      subtitle: (text: string, ms?: number) => host.toast(text, ms),
    },
  };

  return { sdk, runtime };
}

function augmentScene(host: UGCLevelHost, runtime: UGCRuntime): UGCScene {
  const root = host.root as UGCScene;
  root.addBox = (options: BoxOptions = {}): THREE.Mesh => {
    const size = options.size ?? [1, 1, 1];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), createMaterial(options));
    configurePrimitive(mesh, options);
    root.add(mesh);
    if (options.collider ?? true) host.addCollider(mesh);
    return mesh;
  };
  root.addCylinder = (options: CylinderOptions = {}): THREE.Mesh => {
    const radius = options.radius ?? 0.5;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(options.radiusTop ?? radius, options.radiusBottom ?? radius, options.height ?? 1, options.segments ?? 20),
      createMaterial(options),
    );
    configurePrimitive(mesh, options);
    root.add(mesh);
    if (options.collider ?? true) host.addCollider(mesh);
    return mesh;
  };
  root.addSphere = (options: SphereOptions = {}): THREE.Mesh => {
    const segments = options.segments ?? 20;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(options.radius ?? 0.5, segments, Math.max(10, Math.floor(segments * 0.65))),
      createMaterial(options),
    );
    configurePrimitive(mesh, options);
    root.add(mesh);
    if (options.collider ?? false) host.addCollider(mesh);
    return mesh;
  };
  root.addText = (options: TextOptions): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable for addText');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (options.background) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.fillStyle = options.color ?? '#ffffff';
    context.font = '600 88px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(options.text).slice(0, 80), canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    runtime.ownTexture(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.set(...(options.position ?? [0, 2.5, 0]));
    const size = options.size ?? 1;
    sprite.scale.set(4 * size, size, 1);
    root.add(sprite);
    return sprite;
  };
  return root;
}

function createMaterial(options: PrimitiveOptions): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: options.color ?? '#d8d9d6',
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissive ? 0.8 : 0,
    roughness: options.roughness ?? 0.68,
    metalness: options.metalness ?? 0.08,
    transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1),
    opacity: options.opacity ?? 1,
  });
}

function configurePrimitive(mesh: THREE.Mesh, options: PrimitiveOptions): void {
  mesh.position.set(...(options.position ?? [0, 0, 0]));
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
}

function createCollectibleMesh(preset: 'orb' | 'cube' | 'star'): THREE.Object3D {
  const geometry = preset === 'cube'
    ? new THREE.BoxGeometry(0.55, 0.55, 0.55)
    : preset === 'star'
      ? new THREE.OctahedronGeometry(0.42, 0)
      : new THREE.IcosahedronGeometry(0.38, 1);
  const material = new THREE.MeshStandardMaterial({
    color: preset === 'star' ? '#ffe18a' : '#a9f4e9',
    emissive: preset === 'star' ? '#b1761f' : '#2b938a',
    emissiveIntensity: 2,
    roughness: 0.22,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function pointInside(point: THREE.Vector3, center: Vec3, size: Vec3, padding: number): boolean {
  return (
    Math.abs(point.x - center[0]) <= size[0] / 2 + padding &&
    point.y >= center[1] - size[1] / 2 - 0.25 &&
    point.y <= center[1] + size[1] / 2 + 1.8 &&
    Math.abs(point.z - center[2]) <= size[2] / 2 + padding
  );
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function parseApprovedRegistry(payload: unknown): UGCRegistryEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.levels)) throw new Error('registry.json 缺少 levels 数组');
  const result: UGCRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of payload.levels) {
    if (!isRecord(raw) || raw.status !== 'approved') continue;
    try {
      const id = readLevelId(raw.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const winType = readWinType(isRecord(raw.winCondition) ? raw.winCondition.type : raw.type, 'custom');
      result.push({
        id,
        name: readString(raw.name, id, 24),
        author: readAuthor(raw.author),
        type: winType,
        difficulty: readNumber(raw.difficulty, 1, 1, 5),
        estimatedMinutes: readNumber(raw.estimatedMinutes, 3, 1, 15),
        description: readString(raw.description, '由社区创作者构建的新世界。', 120),
        objective: readString(raw.objective, '探索并完成这个世界', 30),
        basePath: readBasePath(raw.path, id),
        hash: readHash(raw.hash),
      });
    } catch {
      // A malformed approved item is isolated without hiding the rest of the registry.
    }
  }
  return result;
}

export function registryEntryToLevel(entry: UGCRegistryEntry): LevelDefinition {
  const palette = paletteForId(entry.id);
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    type: entry.type,
    typeLabel: typeLabel(entry.type),
    difficulty: entry.difficulty,
    estimatedMinutes: entry.estimatedMinutes,
    description: entry.description,
    objective: entry.objective,
    killY: -20,
    spawn: [0, 0.02, 4],
    yaw: 0,
    palette,
    glyph: '⌁',
    source: 'ugc',
    basePath: entry.basePath,
    entry: 'main.js',
    contentHash: entry.hash,
  };
}

export function reviewLevelBasePath(id: string): string {
  return `/api/admin/preview/${encodeURIComponent(readLevelId(id))}/`;
}

export function validateLevelManifest(payload: unknown, expectedId: string): UGCLevelManifest {
  if (!isRecord(payload)) throw new Error('level.json 必须是对象');
  if (payload.schema !== 'wr-level' || payload.schemaVersion !== 1 || payload.engineApi !== '1') {
    throw new Error('不兼容的关卡 schema/engineApi');
  }
  const id = readLevelId(payload.id);
  if (id !== expectedId) throw new Error('registry id 与 level.json id 不一致');
  if (!isRecord(payload.winCondition)) throw new Error('level.json 缺少 winCondition');
  const type = readWinType(payload.winCondition.type);
  const flags = readFlags(payload.winCondition.flags);
  const required = readOptionalInteger(payload.winCondition.required);
  const duration = readOptionalPositive(payload.winCondition.duration);
  const timeLimit = readOptionalPositive(payload.winCondition.timeLimit);
  if (type === 'collect' && (!required || required < 1)) throw new Error('collect 关卡 required 必须 ≥ 1');
  if ((type === 'puzzle' || type === 'escape') && flags.length === 0) throw new Error(`${type} 关卡必须声明 flags`);
  if (type === 'survive' && (!duration || duration <= 0)) throw new Error('survive 关卡必须声明 duration');
  if (type === 'custom' && typeof payload.objectiveDetail !== 'string') throw new Error('custom 关卡必须声明 objectiveDetail');
  const spawnRaw = isRecord(payload.spawn) ? payload.spawn : null;
  if (!spawnRaw) throw new Error('level.json 缺少 spawn');
  const spawn = readVec3(spawnRaw.position, 'spawn.position');
  const entry = readSafeEntry(payload.entry);
  const door = payload.door === null || payload.door === undefined
    ? null
    : readDoor(payload.door);
  if (payload.contentRating !== 'everyone') throw new Error('v1 仅允许 everyone 内容分级');

  return {
    schema: 'wr-level',
    schemaVersion: 1,
    engineApi: '1',
    id,
    name: readString(payload.name, id, 24),
    author: { name: readAuthor(payload.author) },
    description: readString(payload.description, '社区世界', 120),
    language: readString(payload.language, 'zh-CN', 24),
    objective: readString(payload.objective, '完成这个世界', 30),
    objectiveDetail: typeof payload.objectiveDetail === 'string' ? payload.objectiveDetail.slice(0, 500) : undefined,
    difficulty: readNumber(payload.difficulty, 1, 1, 5),
    estimatedMinutes: readNumber(payload.estimatedMinutes, 3, 1, 15),
    spawn: { position: spawn, yawDeg: readNumber(spawnRaw.yawDeg, 0, -3600, 3600) },
    door,
    killY: readNumber(payload.killY, -20, -10_000, 10_000),
    entry,
    contentRating: 'everyone',
    winCondition: {
      type,
      required,
      flags: flags.length > 0 ? flags : undefined,
      duration,
      timeLimit,
      parTime: readOptionalPositive(payload.winCondition.parTime),
    },
  };
}

export function manifestToLevel(manifest: UGCLevelManifest, basePath: string, contentHash = ''): LevelDefinition {
  return {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author.name,
    type: manifest.winCondition.type,
    typeLabel: typeLabel(manifest.winCondition.type),
    difficulty: manifest.difficulty,
    estimatedMinutes: manifest.estimatedMinutes,
    description: manifest.description,
    objective: manifest.objective,
    required: manifest.winCondition.required,
    flags: manifest.winCondition.flags,
    duration: manifest.winCondition.duration,
    timeLimit: manifest.winCondition.timeLimit,
    killY: manifest.killY,
    spawn: manifest.spawn.position,
    yaw: manifest.spawn.yawDeg,
    palette: paletteForId(manifest.id),
    glyph: '⌁',
    source: 'ugc',
    basePath,
    entry: manifest.entry,
    contentHash,
  };
}

export function typeLabel(type: WinType): string {
  const labels: Record<WinType, string> = {
    reach_zone: '抵达',
    collect: '收集',
    puzzle: '谜题',
    survive: '生存',
    eliminate: '清除',
    escape: '逃脱',
    custom: '实验',
  };
  return labels[type];
}

function paletteForId(id: string): [string, string, string] {
  const hue = hashString(id) % 360;
  return [`hsl(${hue} 82% 72%)`, `hsl(${(hue + 28) % 360} 54% 40%)`, `hsl(${(hue + 55) % 360} 40% 12%)`];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function readAuthor(value: unknown): string {
  if (typeof value === 'string') return readString(value, '社区创作者', 48);
  if (isRecord(value)) return readString(value.name, '社区创作者', 48);
  return '社区创作者';
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function readOptionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function readOptionalPositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readLevelId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(value)) throw new Error('无效的关卡 id');
  return value;
}

function readWinType(value: unknown, fallback?: WinType): WinType {
  if (typeof value === 'string' && (WIN_TYPES as readonly string[]).includes(value)) return value as WinType;
  if (fallback) return fallback;
  throw new Error('不支持的 winCondition.type');
}

function readFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((flag): flag is string => typeof flag === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(flag)))].slice(0, 32);
}

function readVec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${field} 必须是三个有限数字`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function readSafeEntry(value: unknown): string {
  const entry = typeof value === 'string' ? value : 'main.js';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.js$/.test(entry) || entry.includes('..') || entry.startsWith('/')) {
    throw new Error('entry 必须是关卡目录内的相对 .js 路径');
  }
  return entry;
}

function readBasePath(value: unknown, id: string): string {
  const fallback = `/levels/${encodeURIComponent(id)}/`;
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.startsWith('/levels/') || value.includes('..') || /[?#]/.test(value)) {
    throw new Error('registry path 必须是同源 /levels/ 路径');
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function readHash(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : 'unversioned';
}

function readDoor(value: unknown): { anchor: Vec3; yawDeg: number } {
  if (!isRecord(value)) throw new Error('door 必须是对象或 null');
  return {
    anchor: readVec3(value.anchor, 'door.anchor'),
    yawDeg: readNumber(value.yawDeg, 0, -3600, 3600),
  };
}
