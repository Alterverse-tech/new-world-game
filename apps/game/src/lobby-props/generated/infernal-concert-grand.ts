import * as THREE from 'three';

export const code = 'infernal-concert-grand';

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'infernal-concert-grand-interaction-proxy';
  root.userData.prompt = '聆听原创钢琴曲';

  const target = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 8),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  target.name = 'infernal-concert-grand-interaction-target';
  target.position.set(1.65, 1.35, 1.15);
  target.userData.prompt = '聆听原创钢琴曲';
  root.add(target);
  return root;
}

export function interactLobbyProp(object: THREE.Object3D): void {
  object.userData.interactionState = 'playing-original-score';
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number; ageSeconds: number },
): void {
  object.userData.interactionSequence = interaction.sequence;
  object.userData.interactionAgeSeconds = interaction.ageSeconds;
  object.userData.interactionState = interaction.sequence > 0 && interaction.ageSeconds < 56
    ? 'playing-original-score'
    : 'ready';
}
