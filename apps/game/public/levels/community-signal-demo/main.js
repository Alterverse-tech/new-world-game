export default function createLevel(sdk) {
  const { THREE } = sdk;
  sdk.env.setBackground('#10172b');
  sdk.env.setFog('#10172b', 24, 72);
  sdk.env.setAmbient('#7182b8', 0.7);

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(22, 1, 22),
    new THREE.MeshStandardMaterial({ color: '#242d4a', roughness: 0.72, metalness: 0.16 }),
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  sdk.scene.add(ground);
  sdk.physics.addCollider(ground);

  sdk.scene.addText({
    position: [0, 3.2, -5],
    text: '双星校准 · AMBER + CYAN',
    color: '#f5f7ff',
    size: 1.15,
  });

  const starA = sdk.scene.addSphere({
    position: [-3, 2.6, -3],
    radius: 0.7,
    color: '#ffc76f',
    emissive: '#b86d21',
    collider: false,
  });
  const starB = sdk.scene.addSphere({
    position: [3, 2.6, -3],
    radius: 0.7,
    color: '#7be9e2',
    emissive: '#278f91',
    collider: false,
  });

  sdk.scene.addCylinder({
    position: [-3, 0.7, 0],
    radiusTop: 0.32,
    radiusBottom: 0.58,
    height: 1.4,
    color: '#6d593c',
    collider: true,
  });
  sdk.scene.addCylinder({
    position: [3, 0.7, 0],
    radiusTop: 0.32,
    radiusBottom: 0.58,
    height: 1.4,
    color: '#315e68',
    collider: true,
  });

  sdk.helpers.pressurePlate({
    position: [-3, 0.07, 2.2],
    size: [2.2, 0.14, 2.2],
    color: '#e3a94e',
    label: '琥珀校准台',
    flag: 'amber',
    onPress: () => sdk.ui.toast('琥珀星已校准'),
  });
  sdk.helpers.pressurePlate({
    position: [3, 0.07, 2.2],
    size: [2.2, 0.14, 2.2],
    color: '#55d6d2',
    label: '青色校准台',
    flag: 'cyan',
    onPress: () => sdk.ui.toast('青色星已校准'),
  });

  return {
    onUpdate(dt, elapsed) {
      starA.rotation.y += dt * 0.9;
      starB.rotation.y -= dt * 0.9;
      starA.position.y = 2.6 + Math.sin(elapsed * 1.4) * 0.18;
      starB.position.y = 2.6 + Math.sin(elapsed * 1.4 + Math.PI) * 0.18;
    },
  };
}
