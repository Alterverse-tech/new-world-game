import * as THREE from 'three';

export const code = 'glow-cube';

export function createLobbyProp(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'GlowCube';
  group.userData.active = false;

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: '#b8fff5',
    emissive: '#43dfcc',
    emissiveIntensity: 1.35,
    roughness: 0.24,
    metalness: 0.12,
  });
  const core = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), coreMaterial);
  core.name = 'GlowCubeCore';
  core.position.y = 0.64;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const cageMaterial = new THREE.MeshBasicMaterial({ color: '#f8ffff', wireframe: true, transparent: true, opacity: 0.58 });
  const cage = new THREE.Mesh(new THREE.BoxGeometry(1.26, 1.26, 1.26, 2, 2, 2), cageMaterial);
  cage.name = 'GlowCubeCage';
  cage.position.y = 0.64;
  group.add(cage);

  const halo = new THREE.PointLight('#68f4df', 2.1, 5.5, 2);
  halo.position.y = 0.75;
  halo.name = 'GlowCubeLight';
  group.add(halo);
  return group;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const active = Boolean(object.userData.active);
  const core = object.getObjectByName('GlowCubeCore') as THREE.Mesh | undefined;
  const cage = object.getObjectByName('GlowCubeCage') as THREE.Mesh | undefined;
  const light = object.getObjectByName('GlowCubeLight') as THREE.PointLight | undefined;
  if (core) {
    const pulse = 1 + Math.sin(elapsed * (active ? 4.2 : 1.9)) * (active ? 0.055 : 0.025);
    core.scale.setScalar(pulse);
    const material = core.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = (active ? 2.6 : 1.35) + Math.sin(elapsed * 2.4) * 0.18;
  }
  if (cage) cage.rotation.y = elapsed * (active ? 0.72 : 0.24);
  if (light) light.intensity = active ? 4.4 : 2.1;
}

export function interactLobbyProp(object: THREE.Object3D): void {
  object.userData.active = !object.userData.active;
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number },
): void {
  object.userData.active = interaction.sequence % 2 === 1;
  object.userData.interactionState = object.userData.active ? 'active' : 'idle';
}
