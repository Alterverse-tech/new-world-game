import * as THREE from 'three';

export const code = 'replace-me';

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#d9f4ef', roughness: 0.45 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ReplaceMeVisual';
  mesh.position.y = 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return root;
}

export function updateLobbyProp(_object: THREE.Object3D, _elapsed: number): void {}

export function interactLobbyProp(object: THREE.Object3D): void {
  const mesh = object.getObjectByName('ReplaceMeVisual') as THREE.Mesh | undefined;
  if (mesh) (mesh.material as THREE.MeshStandardMaterial).color.offsetHSL(0.12, 0, 0);
}
