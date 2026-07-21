import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  code,
  createLobbyProp,
  updateLobbyProp,
} from '../src/lobby-props/generated/anime-badminton-court.ts';

test('anime badminton court creates a compact complete lobby prop', () => {
  assert.equal(code, 'anime-badminton-court');
  const root = createLobbyProp();
  assert.equal(root.name, 'AnimeBadmintonCourtRoot');
  assert.ok(root.getObjectByName('AnimeBadmintonPlayer'));
  assert.ok(root.getObjectByName('AnimeRacket'));
  assert.ok(root.getObjectByName('AnimeShuttle'));
  assert.ok(root.getObjectByName('NetTopTape'));

  let meshCount = 0;
  root.traverse((child) => {
    if (child.isMesh) meshCount += 1;
  });
  assert.ok(meshCount >= 65, `expected a detailed prop, got ${meshCount} meshes`);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x < 6.5 && size.z < 10.8, `prop is too large: ${size.x} x ${size.z}`);
  assert.ok(bounds.min.y >= -0.01, `prop must sit on the floor: min y ${bounds.min.y}`);
});

test('visual animation only updates owned child nodes', () => {
  const root = createLobbyProp();
  const position = root.position.clone();
  const rotation = root.rotation.clone();
  const scale = root.scale.clone();
  const shuttle = root.getObjectByName('AnimeShuttle');
  const initialHeight = shuttle.position.y;

  updateLobbyProp(root, 0.5);

  assert.notEqual(shuttle.position.y, initialHeight);
  assert.ok(root.position.equals(position));
  assert.equal(root.rotation.x, rotation.x);
  assert.equal(root.rotation.y, rotation.y);
  assert.equal(root.rotation.z, rotation.z);
  assert.ok(root.scale.equals(scale));
});
