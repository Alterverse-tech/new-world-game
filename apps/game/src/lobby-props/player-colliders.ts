import * as THREE from 'three';
import type { LobbyPhysicsCollider, LobbyPhysicsDescriptor } from './types';

function colliderWorldMatrix(root: THREE.Object3D, collider: LobbyPhysicsCollider): THREE.Matrix4 {
  const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...collider.rotation, 'XYZ'));
  const localMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...collider.position),
    localRotation,
    new THREE.Vector3(1, 1, 1),
  );
  return root.matrixWorld.clone().multiply(localMatrix);
}

function transformedSphereExtents(matrix: THREE.Matrix4, radius: number): THREE.Vector3 {
  const elements = matrix.elements;
  return new THREE.Vector3(
    radius * Math.hypot(elements[0]!, elements[4]!, elements[8]!),
    radius * Math.hypot(elements[1]!, elements[5]!, elements[9]!),
    radius * Math.hypot(elements[2]!, elements[6]!, elements[10]!),
  );
}

function primitiveWorldBox(root: THREE.Object3D, collider: LobbyPhysicsCollider): THREE.Box3 {
  const matrix = colliderWorldMatrix(root, collider);
  if (collider.shape === 'box') {
    const halfExtents = new THREE.Vector3(...collider.halfExtents);
    return new THREE.Box3(halfExtents.clone().negate(), halfExtents).applyMatrix4(matrix);
  }

  const sphereExtents = transformedSphereExtents(matrix, collider.radius);
  if (collider.shape === 'ball') {
    const center = new THREE.Vector3().applyMatrix4(matrix);
    return new THREE.Box3(center.clone().sub(sphereExtents), center.clone().add(sphereExtents));
  }

  const start = new THREE.Vector3(0, -collider.halfHeight, 0).applyMatrix4(matrix);
  const end = new THREE.Vector3(0, collider.halfHeight, 0).applyMatrix4(matrix);
  return new THREE.Box3(
    start.clone().min(end).sub(sphereExtents),
    start.clone().max(end).add(sphereExtents),
  );
}

/**
 * Builds the host-side player collision boxes for a lobby prop. Reviewed fixed
 * physics props use only their data-only primitive descriptors. Dynamic and
 * legacy props retain the previous whole-object visual bounds behavior.
 */
export function lobbyPropPlayerColliderBoxes(
  root: THREE.Object3D,
  physics?: LobbyPhysicsDescriptor,
): THREE.Box3[] {
  root.updateWorldMatrix(true, true);
  if (physics?.body === 'fixed') {
    return physics.colliders.map((collider) => primitiveWorldBox(root, collider));
  }
  const box = new THREE.Box3().setFromObject(root);
  return box.isEmpty() ? [] : [box];
}
