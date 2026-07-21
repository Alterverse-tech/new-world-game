export default function createLevel(sdk) {
  const { THREE } = sdk;
  sdk.env.setBackground('#dfe7ef');
  sdk.env.setFog('#dfe7ef', 24, 70);
  sdk.env.setAmbient('#ffffff', 1.2);
  sdk.env.addSun({ color: '#ffffff', intensity: 2.1, direction: [-4, 8, 2] });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(18, 1, 22),
    new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.84 }),
  );
  floor.position.set(0, -0.5, 0);
  floor.receiveShadow = true;
  sdk.scene.add(floor);
  sdk.physics.addCollider(floor);

  /*__MECHANIC__*/

  return {
    onUpdate() {},
    onDispose() {},
  };
}
