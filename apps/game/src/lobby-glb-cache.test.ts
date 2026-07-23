import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LobbyGlbTemplateCache } from './lobby-glb-cache';

describe('LobbyGlbTemplateCache', () => {
  it('merges concurrent loads and clones instances with shared read-only resources', async () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#78b9aa' });
    const template = new THREE.Group();
    template.add(new THREE.Mesh(geometry, material));
    const load = vi.fn(async () => template);
    const cache = new LobbyGlbTemplateCache(load);

    const [first, second] = await Promise.all([
      cache.acquire('https://example.test/lobby-assets/user-glb-a/model.glb'),
      cache.acquire('https://example.test/lobby-assets/user-glb-a/model.glb'),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first.scene).not.toBe(second.scene);
    const firstMesh = first.scene.children[0] as THREE.Mesh;
    const secondMesh = second.scene.children[0] as THREE.Mesh;
    expect(firstMesh.geometry).toBe(secondMesh.geometry);
    expect(firstMesh.material).toBe(secondMesh.material);
  });

  it('does not dispose shared resources when one instance is released', async () => {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const template = new THREE.Group();
    template.add(new THREE.Mesh(geometry, material));
    const cache = new LobbyGlbTemplateCache(async () => template);
    const first = await cache.acquire('https://example.test/model.glb');
    const second = await cache.acquire('https://example.test/model.glb');

    first.release();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    second.release();
    cache.clear();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });

  it('removes a failed entry so a later request can retry', async () => {
    const template = new THREE.Group();
    let calls = 0;
    const cache = new LobbyGlbTemplateCache(async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return template;
    });

    await expect(cache.acquire('https://example.test/retry.glb')).rejects.toThrow('temporary');
    await expect(cache.acquire('https://example.test/retry.glb')).resolves.toMatchObject({ scene: expect.any(THREE.Object3D) });
    expect(calls).toBe(2);
  });
});
