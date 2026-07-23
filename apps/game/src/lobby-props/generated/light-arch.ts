import * as THREE from 'three';

export const code = 'light-arch';

export function createLobbyProp(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'LightArch';
  group.userData.palette = 0;
  const frame = new THREE.MeshStandardMaterial({ color: '#e4e1da', roughness: 0.58, metalness: 0.06 });
  const glow = new THREE.MeshStandardMaterial({
    color: '#d5fffa',
    emissive: '#6ce8da',
    emissiveIntensity: 1.65,
    roughness: 0.24,
  });

  for (const x of [-1.42, 1.42]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.65, 0.38), frame);
    pillar.position.set(x, 1.325, 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.12, 0.3, 0.42), frame);
  beam.position.y = 2.58;
  beam.castShadow = true;
  group.add(beam);

  for (let index = 0; index < 9; index += 1) {
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), glow.clone());
    node.name = `LightArchNode-${index}`;
    node.position.set(-1.2 + index * 0.3, 2.55, -0.235);
    group.add(node);
  }
  const light = new THREE.PointLight('#78f4e2', 2.4, 6, 2);
  light.name = 'LightArchLight';
  light.position.set(0, 2.15, 0);
  group.add(light);
  return group;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  for (let index = 0; index < 9; index += 1) {
    const node = object.getObjectByName(`LightArchNode-${index}`) as THREE.Mesh | undefined;
    if (!node) continue;
    const material = node.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 0.7 + Math.max(0, Math.sin(elapsed * 2.6 - index * 0.52)) * 3.2;
  }
  const light = object.getObjectByName('LightArchLight') as THREE.PointLight | undefined;
  if (light) light.intensity = 2 + Math.sin(elapsed * 1.7) * 0.45;
}

export function interactLobbyProp(object: THREE.Object3D): void {
  applyPalette(object, Number(object.userData.palette) + 1);
}

function applyPalette(object: THREE.Object3D, value: number): void {
  const palettes = [
    ['#6ce8da', '#78f4e2'],
    ['#e9b267', '#ffc77d'],
    ['#b69bf2', '#c8b0ff'],
  ] as const;
  const next = ((value % palettes.length) + palettes.length) % palettes.length;
  object.userData.palette = next;
  const palette = palettes.at(next)!;
  for (let index = 0; index < 9; index += 1) {
    const node = object.getObjectByName(`LightArchNode-${index}`) as THREE.Mesh | undefined;
    if (node) (node.material as THREE.MeshStandardMaterial).emissive.set(palette[0]);
  }
  const light = object.getObjectByName('LightArchLight') as THREE.PointLight | undefined;
  light?.color.set(palette[1]);
}

export function applyLobbyPropInteraction(
  object: THREE.Object3D,
  interaction: { sequence: number },
): void {
  applyPalette(object, interaction.sequence);
  object.userData.interactionState = `palette:${object.userData.palette}`;
}
