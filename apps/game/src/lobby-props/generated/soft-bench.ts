import * as THREE from 'three';

export const code = 'soft-bench';

export function createLobbyProp(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'SoftBench';
  group.userData.palette = 0;
  const fabric = new THREE.MeshStandardMaterial({ color: '#d7c7ad', roughness: 0.92, metalness: 0 });
  const frame = new THREE.MeshStandardMaterial({ color: '#393f3c', roughness: 0.42, metalness: 0.32 });

  const cushion = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.65, 6, 16), fabric);
  cushion.name = 'SoftBenchCushion';
  cushion.rotation.z = Math.PI / 2;
  cushion.scale.y = 0.9;
  cushion.position.y = 0.66;
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  group.add(cushion);

  const support = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.12, 0.72), frame);
  support.position.y = 0.35;
  support.castShadow = true;
  group.add(support);

  for (const x of [-1.02, 1.02]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.58), frame);
    leg.position.set(x, 0.17, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  return group;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  const cushion = object.getObjectByName('SoftBenchCushion') as THREE.Mesh | undefined;
  if (cushion) cushion.position.y = 0.66 + Math.sin(elapsed * 1.25) * 0.008;
}

export function interactLobbyProp(object: THREE.Object3D): void {
  const palettes = ['#d7c7ad', '#a9cfca', '#c8b8d8'];
  const next = (Number(object.userData.palette) + 1) % palettes.length;
  applyPalette(object, next);
}

function applyPalette(object: THREE.Object3D, next: number): void {
  const palettes = ['#d7c7ad', '#a9cfca', '#c8b8d8'];
  object.userData.palette = ((next % palettes.length) + palettes.length) % palettes.length;
  const cushion = object.getObjectByName('SoftBenchCushion') as THREE.Mesh | undefined;
  if (cushion) {
    (cushion.material as THREE.MeshStandardMaterial).color.set(
      palettes.at(Number(object.userData.palette))!,
    );
  }
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number },
): void {
  applyPalette(object, interaction.sequence);
  object.userData.interactionState = `palette:${object.userData.palette}`;
}
