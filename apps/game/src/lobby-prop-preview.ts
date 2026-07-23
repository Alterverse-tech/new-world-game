import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getLobbyPropModule } from './lobby-props/registry';
import type { LobbyPropModule } from './lobby-props/types';

const PREVIEW_FPS = 20;
const REDUCED_MOTION_FPS = 4;
const MAX_PIXEL_RATIO = 1.5;
const MAX_RESIDENT_PREVIEWS = 7;
const MAX_CONCURRENT_LOADS = 2;
const PREVIEW_SPAN = 1.65;

export interface LobbyPropPreviewItem {
  id: string;
  name: string;
  kind: 'code' | 'glb';
  code?: string;
  assetUrl?: string;
}

export interface LobbyPropPreviewRegistration {
  item: LobbyPropPreviewItem;
  host: HTMLElement;
}

export interface LobbyPropPreviewGalleryOptions {
  canvasParent?: HTMLElement;
  canvasClassName?: string;
  releaseOnDeactivate?: boolean;
  allowBlobUrls?: boolean;
}

export interface LobbyPropPreviewGalleryTextState {
  active: boolean;
  sharedCanvas: boolean;
  renderer: 'idle' | 'ready' | 'unavailable' | 'lost';
  activeLoads: number;
  residentModels: number;
  reducedMotion: boolean;
  items: Array<{
    id: string;
    state: EntryLoadState | 'unavailable';
    fallback: boolean;
    rotating: boolean;
  }>;
}

export interface LobbyPropPreviewFrame {
  scale: number;
  offset: THREE.Vector3;
}

type EntryLoadState = 'idle' | 'loading' | 'loaded';

interface PreviewEntry {
  item: LobbyPropPreviewItem;
  host: HTMLElement;
  viewport: HTMLElement;
  status: HTMLElement;
  state: EntryLoadState;
  nearby: boolean;
  onScreen: boolean;
  lastVisibleAt: number;
  phase: number;
  controller: AbortController | null;
  content: THREE.Object3D | null;
  framed: THREE.Group | null;
  update: LobbyPropModule['updateLobbyProp'];
  fallbackReason: string | null;
}

interface QueuedLoad {
  entry: PreviewEntry;
  generation: number;
}

function finiteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

export function lobbyPropPreviewFrame(bounds: THREE.Box3, span = PREVIEW_SPAN): LobbyPropPreviewFrame | null {
  if (bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!finiteVector(size) || !finiteVector(center) || !Number.isFinite(longest) || longest <= 0.0001) return null;
  const safeSpan = Number.isFinite(span) && span > 0 ? span : PREVIEW_SPAN;
  const scale = safeSpan / longest;
  return { scale, offset: center.multiplyScalar(-scale) };
}

export function lobbyPropPreviewRotation(elapsedSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return Math.PI / 7;
  return Math.max(0, elapsedSeconds) * 0.32;
}

export function resolveLobbyPropPreviewAssetUrl(
  assetUrl: string | undefined,
  baseUrl: string,
  expectedOrigin: string,
  allowBlobUrl = false,
): string | null {
  if (!assetUrl) return null;
  try {
    const resolved = new URL(assetUrl, baseUrl);
    return resolved.origin === expectedOrigin && resolved.protocol !== 'data:' && (resolved.protocol !== 'blob:' || allowBlobUrl)
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

export function lobbyPropPreviewResourcePath(assetUrl: string, baseUrl: string): string {
  try {
    const resolved = new URL(assetUrl, baseUrl);
    return resolved.protocol === 'blob:'
      ? new URL('.', baseUrl).href
      : new URL('.', resolved).href;
  } catch {
    return new URL('.', baseUrl).href;
  }
}

function hashPhase(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function disposeObjectResources(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton.boneTexture) textures.add(mesh.skeleton.boneTexture);
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function createFallbackPreview(kind: LobbyPropPreviewItem['kind']): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'LobbyCatalogPreviewFallback';
  const warm = kind === 'glb';
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: warm ? '#d4bd91' : '#7bd6c5',
    emissive: warm ? '#6d552d' : '#176c60',
    emissiveIntensity: 0.18,
    metalness: warm ? 0.26 : 0.12,
    roughness: 0.58,
  });
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: warm ? '#fff0cd' : '#e4fffa',
    emissive: warm ? '#896f3f' : '#2b9e8e',
    emissiveIntensity: 0.25,
    roughness: 0.38,
  });
  const body = new THREE.Mesh(
    warm ? new THREE.IcosahedronGeometry(0.62, 1) : new THREE.BoxGeometry(1.05, 1.05, 1.05),
    bodyMaterial,
  );
  body.position.y = 0.72;
  root.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.045, 8, 32), detailMaterial);
  ring.position.y = 0.72;
  ring.rotation.x = Math.PI / 2.55;
  root.add(ring);
  return root;
}

function framedPreview(content: THREE.Object3D): THREE.Group {
  content.updateWorldMatrix(true, true);
  const frame = lobbyPropPreviewFrame(new THREE.Box3().setFromObject(content));
  if (!frame) throw new Error('Preview bounds are invalid');
  const root = new THREE.Group();
  root.name = 'LobbyCatalogPreviewFrame';
  root.scale.setScalar(frame.scale);
  root.position.copy(frame.offset);
  root.add(content);
  return root;
}

function intersecting(rect: DOMRect, root: DOMRect): boolean {
  return rect.right > root.left && rect.left < root.right && rect.bottom > root.top && rect.top < root.bottom;
}

/**
 * Renders all catalog thumbnails through one low-power WebGL renderer. Each
 * item gets its own Three.js object, but never its own WebGL context.
 */
export class LobbyPropPreviewGallery {
  private readonly catalog: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasParent: HTMLElement;
  private readonly releaseOnDeactivate: boolean;
  private readonly allowBlobUrls: boolean;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(31, 1, 0.05, 40);
  private readonly turntable = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly queue: QueuedLoad[] = [];
  private readonly motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly observer: IntersectionObserver | null;
  private renderer: THREE.WebGLRenderer | null = null;
  private rendererUnavailable = false;
  private contextLost = false;
  private active = false;
  private disposed = false;
  private reducedMotion = this.motionQuery.matches;
  private generation = 0;
  private inFlight = 0;
  private frameHandle = 0;
  private lastRenderAt = Number.NEGATIVE_INFINITY;
  private renderWidth = 0;
  private renderHeight = 0;
  private renderPixelRatio = 0;

  public constructor(catalog: HTMLElement, options: LobbyPropPreviewGalleryOptions = {}) {
    this.catalog = catalog;
    this.canvasParent = options.canvasParent ?? document.body;
    this.releaseOnDeactivate = options.releaseOnDeactivate ?? false;
    this.allowBlobUrls = options.allowBlobUrls ?? false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = options.canvasClassName ?? 'lobby-prop-preview-layer';
    this.canvas.setAttribute('aria-hidden', 'true');

    this.camera.position.set(2.35, 1.45, 3.15);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.turntable);
    this.scene.add(new THREE.HemisphereLight('#f6fffc', '#6d766f', 2.1));
    const key = new THREE.DirectionalLight('#fff5dc', 3.1);
    key.position.set(3.2, 4.5, 3.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#72dbc9', 1.5);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);

    this.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((records) => this.onIntersection(records), {
        root: catalog,
        rootMargin: '96px 0px',
        threshold: 0.01,
      })
      : null;
    this.motionQuery.addEventListener('change', this.onMotionChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  public setItems(registrations: LobbyPropPreviewRegistration[]): void {
    if (this.disposed) return;
    this.generation += 1;
    this.observer?.disconnect();
    this.queue.length = 0;
    for (const entry of this.entries.values()) this.releaseEntry(entry);
    this.entries.clear();

    for (const { item, host } of registrations) {
      const viewport = host.querySelector<HTMLElement>('[data-preview-viewport]');
      const status = host.querySelector<HTMLElement>('[data-preview-status]');
      if (!viewport || !status) continue;
      const entry: PreviewEntry = {
        item,
        host,
        viewport,
        status,
        state: 'idle',
        nearby: !this.observer,
        onScreen: false,
        lastVisibleAt: 0,
        phase: hashPhase(item.id),
        controller: null,
        content: null,
        framed: null,
        update: undefined,
        fallbackReason: null,
      };
      this.entries.set(item.id, entry);
      this.updateEntryStatus(entry);
      this.observer?.observe(host);
    }
    if (this.active) this.scheduleFrame();
  }

  public setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active && !this.canvas.isConnected) this.canvasParent.append(this.canvas);
    this.canvas.classList.toggle('is-active', active);
    if (!active) {
      if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.generation += 1;
      this.queue.length = 0;
      for (const entry of this.entries.values()) {
        if (entry.state === 'loading') {
          entry.controller?.abort();
          entry.controller = null;
          entry.state = 'idle';
          this.updateEntryStatus(entry);
        } else if (this.releaseOnDeactivate && entry.content) {
          this.releaseEntryModel(entry);
          entry.state = 'idle';
          entry.fallbackReason = null;
          this.updateEntryStatus(entry);
        }
      }
      this.canvas.remove();
      return;
    }
    this.lastRenderAt = Number.NEGATIVE_INFINITY;
    this.scheduleFrame();
  }

  public getTextState(): LobbyPropPreviewGalleryTextState {
    const renderer = this.rendererUnavailable
      ? 'unavailable'
      : this.contextLost
        ? 'lost'
        : this.renderer
          ? 'ready'
          : 'idle';
    return {
      active: this.active,
      sharedCanvas: this.canvas.isConnected,
      renderer,
      activeLoads: this.inFlight,
      residentModels: [...this.entries.values()].filter((entry) => entry.content !== null).length,
      reducedMotion: this.reducedMotion,
      items: [...this.entries.values()].map((entry) => ({
        id: entry.item.id,
        state: this.rendererUnavailable || this.contextLost ? 'unavailable' : entry.state,
        fallback: Boolean(entry.fallbackReason),
        rotating: entry.state === 'loaded' && !this.reducedMotion,
      })),
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.generation += 1;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.observer?.disconnect();
    this.queue.length = 0;
    for (const entry of this.entries.values()) this.releaseEntry(entry);
    this.entries.clear();
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.renderer) {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer = null;
    this.canvas.remove();
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    for (const entry of this.entries.values()) this.updateEntryStatus(entry);
    this.lastRenderAt = Number.NEGATIVE_INFINITY;
    this.scheduleFrame();
  };

  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) {
      this.lastRenderAt = Number.NEGATIVE_INFINITY;
      this.scheduleFrame();
    }
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    for (const entry of this.entries.values()) this.updateEntryStatus(entry);
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    for (const entry of this.entries.values()) this.updateEntryStatus(entry);
    this.lastRenderAt = Number.NEGATIVE_INFINITY;
    this.scheduleFrame();
  };

  private onIntersection(records: IntersectionObserverEntry[]): void {
    for (const record of records) {
      const id = (record.target as HTMLElement).dataset.previewId;
      const entry = id ? this.entries.get(id) : null;
      if (!entry) continue;
      entry.nearby = record.isIntersecting;
      if (entry.nearby && this.active) this.requestLoad(entry);
    }
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (!this.active || this.disposed || this.frameHandle || document.hidden) return;
    this.frameHandle = requestAnimationFrame((time) => {
      this.frameHandle = 0;
      this.renderFrame(time);
      this.scheduleFrame();
    });
  }

  private renderFrame(time: number): void {
    const catalogRect = this.catalog.getBoundingClientRect();
    if (catalogRect.width < 2 || catalogRect.height < 2) return;
    this.positionCanvas(catalogRect);

    const renderable: PreviewEntry[] = [];
    for (const entry of this.entries.values()) {
      const rect = entry.viewport.getBoundingClientRect();
      entry.onScreen = intersecting(rect, catalogRect);
      if (entry.onScreen) {
        entry.lastVisibleAt = time;
        this.requestLoad(entry);
        if (entry.framed && entry.content) renderable.push(entry);
      }
    }
    if (renderable.length === 0 || !this.ensureRenderer()) return;

    const interval = 1000 / (this.reducedMotion ? REDUCED_MOTION_FPS : PREVIEW_FPS);
    if (time - this.lastRenderAt < interval) return;
    this.lastRenderAt = time;
    const renderer = this.renderer!;
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);

    for (const entry of renderable) this.renderEntry(entry, catalogRect, time);
    renderer.setScissorTest(false);
  }

  private positionCanvas(rect: DOMRect): void {
    this.canvas.style.left = `${Math.round(rect.left)}px`;
    this.canvas.style.top = `${Math.round(rect.top)}px`;
    this.canvas.style.width = `${Math.max(1, Math.round(rect.width))}px`;
    this.canvas.style.height = `${Math.max(1, Math.round(rect.height))}px`;
    if (!this.renderer) return;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (width === this.renderWidth && height === this.renderHeight && pixelRatio === this.renderPixelRatio) return;
    this.renderWidth = width;
    this.renderHeight = height;
    this.renderPixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  private ensureRenderer(): boolean {
    if (this.renderer && !this.contextLost) return true;
    if (this.rendererUnavailable || this.contextLost) return false;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.autoClear = false;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      this.renderer = renderer;
      this.renderWidth = 0;
      this.renderHeight = 0;
      this.renderPixelRatio = 0;
      this.positionCanvas(this.catalog.getBoundingClientRect());
      return true;
    } catch {
      this.rendererUnavailable = true;
      for (const entry of this.entries.values()) this.updateEntryStatus(entry);
      return false;
    }
  }

  private renderEntry(entry: PreviewEntry, catalogRect: DOMRect, time: number): void {
    const renderer = this.renderer;
    if (!renderer || !entry.framed || !entry.content) return;
    const rect = entry.viewport.getBoundingClientRect();
    const clipLeft = Math.max(rect.left, catalogRect.left);
    const clipRight = Math.min(rect.right, catalogRect.right);
    const clipTop = Math.max(rect.top, catalogRect.top);
    const clipBottom = Math.min(rect.bottom, catalogRect.bottom);
    const clipWidth = clipRight - clipLeft;
    const clipHeight = clipBottom - clipTop;
    if (clipWidth < 2 || clipHeight < 2 || rect.width < 2 || rect.height < 2) return;

    const viewportX = rect.left - catalogRect.left;
    const viewportY = catalogRect.bottom - rect.bottom;
    const scissorX = clipLeft - catalogRect.left;
    const scissorY = catalogRect.bottom - clipBottom;
    renderer.setViewport(viewportX, viewportY, rect.width, rect.height);
    renderer.setScissor(scissorX, scissorY, clipWidth, clipHeight);
    renderer.clearDepth();

    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    const elapsed = time / 1000;
    if (entry.update && !this.reducedMotion) {
      try {
        entry.update(entry.content, elapsed);
      } catch {
        entry.update = undefined;
      }
    }
    this.turntable.rotation.y = lobbyPropPreviewRotation(elapsed, this.reducedMotion) + entry.phase;
    this.turntable.add(entry.framed);
    try {
      renderer.render(this.scene, this.camera);
    } finally {
      this.turntable.remove(entry.framed);
    }
  }

  private requestLoad(entry: PreviewEntry): void {
    if (!this.active || entry.state !== 'idle') return;
    entry.state = 'loading';
    this.updateEntryStatus(entry);
    this.queue.push({ entry, generation: this.generation });
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.inFlight < MAX_CONCURRENT_LOADS && this.queue.length > 0) {
      const queued = this.queue.shift()!;
      if (queued.generation !== this.generation || queued.entry.state !== 'loading') continue;
      this.inFlight += 1;
      void this.loadEntry(queued.entry, queued.generation).finally(() => {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.pumpQueue();
      });
    }
  }

  private async loadEntry(entry: PreviewEntry, generation: number): Promise<void> {
    let content: THREE.Object3D | null = null;
    let update: LobbyPropModule['updateLobbyProp'];
    let fallbackReason: string | null = null;
    try {
      if (entry.item.kind === 'code') {
        const module = entry.item.code ? getLobbyPropModule(entry.item.code) : null;
        if (!module) throw new Error('Code prop is unavailable');
        content = module.createLobbyProp();
        update = module.updateLobbyProp;
      } else {
        const url = resolveLobbyPropPreviewAssetUrl(
          entry.item.assetUrl,
          document.baseURI,
          window.location.origin,
          this.allowBlobUrls,
        );
        if (!url) throw new Error('GLB URL is unavailable');
        const controller = new AbortController();
        entry.controller = controller;
        const response = await fetch(url, {
          credentials: 'same-origin',
          cache: 'force-cache',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GLB HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const gltf = await this.loader.parseAsync(buffer, lobbyPropPreviewResourcePath(url, document.baseURI));
        content = gltf.scene;
      }
      const framed = framedPreview(content);
      if (generation !== this.generation || this.entries.get(entry.item.id) !== entry) {
        disposeObjectResources(content);
        return;
      }
      entry.content = content;
      entry.framed = framed;
      entry.update = update;
    } catch (error) {
      if (content) disposeObjectResources(content);
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (generation !== this.generation || this.entries.get(entry.item.id) !== entry) return;
      content = createFallbackPreview(entry.item.kind);
      entry.content = content;
      entry.framed = framedPreview(content);
      entry.update = undefined;
      fallbackReason = entry.item.kind === 'glb'
        ? '模型加载失败 · 替代预览'
        : '代码预览失败 · 替代预览';
    } finally {
      if (entry.controller) entry.controller = null;
    }
    if (generation !== this.generation || this.entries.get(entry.item.id) !== entry) {
      if (content) disposeObjectResources(content);
      return;
    }
    entry.state = 'loaded';
    entry.fallbackReason = fallbackReason;
    this.updateEntryStatus(entry);
    this.evictDormantEntries(entry);
    this.lastRenderAt = Number.NEGATIVE_INFINITY;
    this.scheduleFrame();
  }

  private evictDormantEntries(current: PreviewEntry): void {
    let resident = [...this.entries.values()].filter((entry) => entry.content).length;
    if (resident <= MAX_RESIDENT_PREVIEWS) return;
    const candidates = [...this.entries.values()]
      .filter((entry) => entry !== current && entry.content && !entry.onScreen && (!entry.nearby || !this.observer))
      .sort((a, b) => a.lastVisibleAt - b.lastVisibleAt);
    for (const entry of candidates) {
      this.releaseEntryModel(entry);
      entry.state = 'idle';
      entry.fallbackReason = null;
      this.updateEntryStatus(entry);
      resident -= 1;
      if (resident <= MAX_RESIDENT_PREVIEWS) break;
    }
  }

  private updateEntryStatus(entry: PreviewEntry): void {
    let state: string;
    let label: string;
    if (this.rendererUnavailable) {
      state = 'unavailable';
      label = '设备不支持 3D 预览';
    } else if (this.contextLost) {
      state = 'unavailable';
      label = '3D 预览已暂停';
    } else if (entry.state === 'loading') {
      state = 'loading';
      label = '正在加载 3D 预览…';
    } else if (entry.state === 'loaded' && entry.fallbackReason) {
      state = 'fallback';
      label = entry.fallbackReason;
    } else if (entry.state === 'loaded') {
      state = 'ready';
      label = this.reducedMotion ? '静态 3D · 已减少动态' : '实时 3D · 缓慢旋转';
    } else {
      state = 'idle';
      label = '滑动到此处加载 3D 预览';
    }
    entry.host.dataset.previewState = state;
    entry.status.textContent = label;
    entry.host.setAttribute('aria-label', `${entry.item.name}：${label}`);
  }

  private releaseEntryModel(entry: PreviewEntry): void {
    if (entry.content) disposeObjectResources(entry.content);
    entry.content = null;
    entry.framed = null;
    entry.update = undefined;
  }

  private releaseEntry(entry: PreviewEntry): void {
    entry.controller?.abort();
    entry.controller = null;
    this.releaseEntryModel(entry);
  }
}
