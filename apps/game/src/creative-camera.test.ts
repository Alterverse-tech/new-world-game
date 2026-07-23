import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CREATIVE_CAMERA_BOUNDS,
  CREATIVE_CAMERA_FAST_SPEED,
  CREATIVE_CAMERA_SPEED,
  LobbyCreativeCamera,
  clampCreativeCameraPosition,
  creativeMovementDirection,
  shouldHandleCreativeCameraKey,
} from './creative-camera';

describe('lobby creative camera movement', () => {
  it('moves horizontally relative to yaw and normalizes diagonals', () => {
    const forward = creativeMovementDirection(new Set(['KeyW']), 0);
    expect(forward.toArray()).toEqual([0, 0, -1]);

    const turned = creativeMovementDirection(new Set(['KeyW']), Math.PI / 2);
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);

    const diagonal = creativeMovementDirection(new Set(['KeyW', 'KeyD', 'Space']), 0);
    expect(diagonal.length()).toBeCloseTo(1);
    expect(diagonal.y).toBeGreaterThan(0);
  });

  it('uses Space to rise, Shift/C to descend, and cancels opposing vertical input', () => {
    expect(creativeMovementDirection(new Set(['Space']), 0).y).toBe(1);
    expect(creativeMovementDirection(new Set(['ShiftLeft']), 0).y).toBe(-1);
    expect(creativeMovementDirection(new Set(['KeyC']), 0).y).toBe(-1);
    expect(creativeMovementDirection(new Set(['Space', 'KeyC']), 0).y).toBe(0);
  });

  it('does not capture creative movement while a form control or editable field owns focus', () => {
    expect(shouldHandleCreativeCameraKey('Space', { tagName: 'BUTTON' })).toBe(false);
    expect(shouldHandleCreativeCameraKey('KeyW', { tagName: 'INPUT' })).toBe(false);
    expect(shouldHandleCreativeCameraKey('KeyC', { tagName: 'DIV', isContentEditable: true })).toBe(false);
    expect(shouldHandleCreativeCameraKey('KeyW', { tagName: 'CANVAS' })).toBe(true);
    expect(shouldHandleCreativeCameraKey('KeyE', { tagName: 'CANVAS' })).toBe(false);
  });

  it('keeps finite horizontal coordinates unbounded while clamping height', () => {
    const position = clampCreativeCameraPosition(new THREE.Vector3(1_000_000, -4, -2_000_000));
    expect(position.toArray()).toEqual([1_000_000, CREATIVE_CAMERA_BOUNDS.minY, -2_000_000]);
    expect(CREATIVE_CAMERA_BOUNDS.horizontal).toBe('unbounded');
  });

  it('replaces non-finite coordinates with safe finite values', () => {
    const position = clampCreativeCameraPosition(new THREE.Vector3(Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY));
    expect(position.toArray()).toEqual([0, CREATIVE_CAMERA_BOUNDS.minY, 0]);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('flies independently without mutating the anchored player and supports fast mode', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.62, 4);
    const player = new THREE.Vector3(0, 0.02, 4);
    const playerBefore = player.clone();
    const creative = new LobbyCreativeCamera();

    creative.enter(camera, 0, 0, 'third');
    creative.update(1, new Set(['KeyW']));
    creative.apply(camera);
    expect(camera.position.z).toBeCloseTo(4 - CREATIVE_CAMERA_SPEED * 0.1);
    expect(player).toEqual(playerBefore);

    const normalZ = camera.position.z;
    creative.update(1, new Set(['KeyW', 'ControlLeft']));
    creative.apply(camera);
    expect(normalZ - camera.position.z).toBeCloseTo(CREATIVE_CAMERA_FAST_SPEED * 0.1);
    expect(creative.getTextState()).toMatchObject({
      active: true,
      speed: 'fast',
      playerAnchored: true,
      returnView: 'third',
      bounds: {
        horizontal: 'unbounded',
        minY: CREATIVE_CAMERA_BOUNDS.minY,
        maxY: CREATIVE_CAMERA_BOUNDS.maxY,
      },
    });
  });

  it('enters and continues creative flight from a far finite parked position', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(125_000, 1.62, -340_000);
    const creative = new LobbyCreativeCamera();

    creative.enter(camera, 0, 0, 'first');
    creative.update(1, new Set(['KeyW']));
    creative.apply(camera);

    expect(camera.position.x).toBe(125_000);
    expect(camera.position.z).toBeCloseTo(-340_000 - CREATIVE_CAMERA_SPEED * 0.1);
    expect(creative.getTextState().bounds.horizontal).toBe('unbounded');
  });

  it('only changes look angles during a deliberate right-drag gesture', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 0);
    const creative = new LobbyCreativeCamera();
    creative.enter(camera, 0, 0, 'first');
    creative.look(100, 100, 1);
    creative.apply(camera);
    expect(camera.rotation.x).toBe(0);
    expect(camera.rotation.y).toBe(0);

    creative.beginLook();
    creative.look(100, 50, 1);
    creative.apply(camera);
    expect(camera.rotation.y).toBeCloseTo(-0.2);
    expect(camera.rotation.x).toBeCloseTo(-0.1);
    creative.endLook();
    expect(creative.getTextState().looking).toBe(false);
  });
});
