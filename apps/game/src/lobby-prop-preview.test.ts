import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  lobbyPropPreviewFrame,
  lobbyPropPreviewResourcePath,
  lobbyPropPreviewRotation,
  resolveLobbyPropPreviewAssetUrl,
} from './lobby-prop-preview';

describe('lobby prop catalog previews', () => {
  it('centers and uniformly frames objects with very different dimensions', () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-2, 1, -1),
      new THREE.Vector3(4, 4, 1),
    );
    const frame = lobbyPropPreviewFrame(bounds, 1.8)!;
    expect(frame.scale).toBeCloseTo(0.3, 8);

    const center = bounds.getCenter(new THREE.Vector3());
    center.multiplyScalar(frame.scale).add(frame.offset);
    expect(center.toArray()).toEqual([0, 0, 0]);
  });

  it('rejects empty and degenerate bounds instead of poisoning the renderer', () => {
    expect(lobbyPropPreviewFrame(new THREE.Box3())).toBeNull();
    expect(lobbyPropPreviewFrame(new THREE.Box3(
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, 1, 1),
    ))).toBeNull();
  });

  it('uses a slow deterministic turntable and freezes it for reduced motion', () => {
    expect(lobbyPropPreviewRotation(10, false)).toBeCloseTo(3.2, 8);
    expect(lobbyPropPreviewRotation(20, false)).toBeCloseTo(6.4, 8);
    expect(lobbyPropPreviewRotation(10, true)).toBeCloseTo(Math.PI / 7, 8);
    expect(lobbyPropPreviewRotation(20, true)).toBeCloseTo(Math.PI / 7, 8);
  });

  it('only accepts same-origin GLB preview assets', () => {
    const base = 'https://whiteroom.example/game/';
    expect(resolveLobbyPropPreviewAssetUrl('/generated-assets/chair.glb', base, 'https://whiteroom.example'))
      .toBe('https://whiteroom.example/generated-assets/chair.glb');
    expect(resolveLobbyPropPreviewAssetUrl('props/chair.glb', base, 'https://whiteroom.example'))
      .toBe('https://whiteroom.example/game/props/chair.glb');
    expect(resolveLobbyPropPreviewAssetUrl('https://cdn.example/chair.glb', base, 'https://whiteroom.example'))
      .toBeNull();
    expect(resolveLobbyPropPreviewAssetUrl('data:model/gltf-binary;base64,AAAA', base, 'https://whiteroom.example'))
      .toBeNull();
    expect(resolveLobbyPropPreviewAssetUrl('blob:https://whiteroom.example/local-avatar', base, 'https://whiteroom.example'))
      .toBeNull();
    expect(resolveLobbyPropPreviewAssetUrl(
      'blob:https://whiteroom.example/local-avatar',
      base,
      'https://whiteroom.example',
      true,
    )).toBe('blob:https://whiteroom.example/local-avatar');
  });

  it('uses the page directory for local Blob GLBs without treating the Blob ID as a URL hierarchy', () => {
    expect(lobbyPropPreviewResourcePath(
      'blob:https://whiteroom.example/95f8c15a-22c2-4ce0-9631-5b09f44c1679',
      'https://whiteroom.example/game/',
    )).toBe('https://whiteroom.example/game/');
    expect(lobbyPropPreviewResourcePath(
      '/avatars/avatar-demo/avatar.glb',
      'https://whiteroom.example/game/',
    )).toBe('https://whiteroom.example/avatars/avatar-demo/');
  });
});
