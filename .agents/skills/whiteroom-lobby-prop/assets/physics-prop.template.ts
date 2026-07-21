import * as THREE from 'three';
import type { LobbyPhysicsDescriptor } from '../types';

export const code = 'replace-physics-prop';

export const physics = {
  body: 'fixed',
  mass: 0,
  friction: 0.9,
  restitution: 0.05,
  colliders: [{
    shape: 'box',
    halfExtents: [1, 0.5, 1],
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
  }],
} satisfies LobbyPhysicsDescriptor;

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 2),
    new THREE.MeshStandardMaterial({ color: '#74787b', roughness: 0.82 }),
  );
  mesh.position.y = 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}
