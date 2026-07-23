import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface LobbyGlbLease {
  readonly scene: THREE.Object3D;
  release(): void;
}

export type LobbyGlbTemplateLoader = (url: string, signal: AbortSignal) => Promise<THREE.Object3D>;

interface LobbyGlbCacheEntry {
  readonly url: string;
  readonly controller: AbortController;
  promise: Promise<THREE.Object3D>;
  template: THREE.Object3D | null;
  leases: number;
  evicted: boolean;
}

function abortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('Lobby GLB load was aborted', 'AbortError');
  const error = new Error('Lobby GLB load was aborted');
  error.name = 'AbortError';
  return error;
}

export function disposeLobbyGlbTemplate(object: THREE.Object3D): void {
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
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

async function loadLobbyGlbTemplate(url: string, signal: AbortSignal): Promise<THREE.Object3D> {
  const response = await fetch(url, {
    headers: { Accept: 'model/gltf-binary,application/octet-stream;q=0.9' },
    credentials: 'same-origin',
    cache: 'force-cache',
    signal,
  });
  if (!response.ok) throw new Error(`GLB HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw abortError();
  const basePath = new URL('.', url).href;
  const gltf = await new GLTFLoader().parseAsync(buffer, basePath);
  if (signal.aborted) {
    disposeLobbyGlbTemplate(gltf.scene);
    throw abortError();
  }
  return gltf.scene;
}

/**
 * One template is fetched and parsed per canonical asset URL. Instances clone
 * the object graph while sharing read-only geometry/material resources. The
 * platform rejects skins, animations and morph targets for lobby props.
 */
export class LobbyGlbTemplateCache {
  private readonly entries = new Map<string, LobbyGlbCacheEntry>();

  public constructor(private readonly loader: LobbyGlbTemplateLoader = loadLobbyGlbTemplate) {}

  public async acquire(url: string): Promise<LobbyGlbLease> {
    let entry = this.entries.get(url);
    if (!entry) entry = this.createEntry(url);
    const template = await entry.promise;
    if (entry.evicted || this.entries.get(url) !== entry) throw abortError();
    const scene = template.clone(true);
    entry.leases += 1;
    let released = false;
    return {
      scene,
      release: () => {
        if (released) return;
        released = true;
        entry!.leases = Math.max(0, entry!.leases - 1);
      },
    };
  }

  public clear(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.evicted = true;
      entry.controller.abort();
      if (entry.template) {
        disposeLobbyGlbTemplate(entry.template);
        entry.template = null;
      }
    }
  }

  public get size(): number {
    return this.entries.size;
  }

  private createEntry(url: string): LobbyGlbCacheEntry {
    const entry: LobbyGlbCacheEntry = {
      url,
      controller: new AbortController(),
      promise: Promise.resolve(new THREE.Group()),
      template: null,
      leases: 0,
      evicted: false,
    };
    this.entries.set(url, entry);
    entry.promise = this.loader(url, entry.controller.signal).then((template) => {
      if (entry.evicted || this.entries.get(url) !== entry) {
        disposeLobbyGlbTemplate(template);
        throw abortError();
      }
      entry.template = template;
      return template;
    }).catch((error: unknown) => {
      if (this.entries.get(url) === entry) this.entries.delete(url);
      throw error;
    });
    return entry;
  }
}
