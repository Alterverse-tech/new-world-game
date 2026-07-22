export default function createLevel(sdk) {
  const { THREE } = sdk;

  sdk.env.setBackground('#111827');
  sdk.env.setFog('#111827', 42, 128);
  sdk.env.setAmbient('#dbeafe', 0.95);
  sdk.env.addSun({
    color: '#ffffff',
    intensity: 2.2,
    castShadow: true,
    direction: [-6, 12, 5],
  });
  sdk.objective.set('穿越三重跑酷试炼，抵达塔顶');

  const safe = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.82 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.72 });
  const checkpoint = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0e7490,
    emissiveIntensity: 1.4,
  });
  const hazard = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0x991b1b,
    emissiveIntensity: 1.8,
  });
  const recovery = new THREE.MeshStandardMaterial({
    color: 0x164e63,
    emissive: 0x083344,
    emissiveIntensity: 0.8,
  });
  const goal = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0x92400e,
    emissiveIntensity: 1.7,
  });

  const hazards = [];
  const geometryCache = new Map();
  let currentCheckpoint = [0, 1.8, 8];
  let protectedUntil = -1;

  function getBoxGeometry(size) {
    const key = size.join(':');
    let geometry = geometryCache.get(key);
    if (!geometry) {
      geometry = new THREE.BoxGeometry(...size);
      geometryCache.set(key, geometry);
    }
    return geometry;
  }

  function addBox(position, size, material = safe, collider = true) {
    const mesh = new THREE.Mesh(getBoxGeometry(size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sdk.scene.add(mesh);
    if (collider) sdk.physics.addCollider(mesh);
    return mesh;
  }

  function addRoundPlatform(position, radius) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.7, 32),
      safe,
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sdk.scene.add(mesh);
    sdk.physics.addCollider(mesh);
    return mesh;
  }

  function addRouteLabel(position, text, color = '#dbeafe') {
    return sdk.helpers.label(position, text, { size: 0.72, color });
  }

  function addCheckpoint(center, index) {
    addBox(center, [5, 0.8, 4], checkpoint);
    const respawn = [center[0], center[1] + 1.5, center[2]];
    sdk.helpers.triggerZone({
      position: [center[0], center[1] + 1.2, center[2]],
      size: [4.4, 2.4, 3.4],
      once: true,
      visible: false,
      onEnter() {
        currentCheckpoint = respawn;
        sdk.player.setCheckpoint(respawn, 180);
        sdk.objective.updateProgress(`检查点 ${index}/2`);
        sdk.ui.toast(`检查点 ${index}/2 已激活`, 1800);
      },
    });
  }

  function addRecovery(center) {
    addBox(center, [5, 0.5, 5], recovery);
    sdk.helpers.triggerZone({
      position: [center[0], center[1] + 1.1, center[2]],
      size: [4.8, 2.5, 4.8],
      once: false,
      visible: false,
      onEnter() {
        sdk.player.teleport(currentCheckpoint, 180);
        sdk.ui.toast('落到回收台，返回最近检查点', 1600);
      },
    });
  }

  function addSweeper({ position, length, speed, phase = 0, double = false }) {
    const group = new THREE.Group();
    group.position.set(...position);
    const barGeometry = getBoxGeometry([length, 0.38, 0.48]);

    const firstBar = new THREE.Mesh(
      barGeometry,
      hazard,
    );
    firstBar.castShadow = true;
    firstBar.receiveShadow = true;
    group.add(firstBar);

    const offsets = [0];
    if (double) {
      const secondBar = new THREE.Mesh(
        barGeometry,
        hazard,
      );
      secondBar.rotation.y = Math.PI / 2;
      secondBar.castShadow = true;
      secondBar.receiveShadow = true;
      group.add(secondBar);
      offsets.push(Math.PI / 2);
    }

    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 1.5, 16),
      hazard,
    );
    axle.position.y = -0.72;
    axle.castShadow = true;
    axle.receiveShadow = true;
    group.add(axle);
    sdk.scene.add(group);

    hazards.push({
      group,
      centerX: position[0],
      centerZ: position[2],
      y: position[1],
      halfLength: length / 2,
      speed,
      phase,
      offsets,
    });
  }

  function playerHitsSweeper(player, activeHazard, elapsed) {
    if (Math.abs(player.y - activeHazard.y) > 1.15) return false;

    const dx = player.x - activeHazard.centerX;
    const dz = player.z - activeHazard.centerZ;
    for (const offset of activeHazard.offsets) {
      const angle = elapsed * activeHazard.speed + activeHazard.phase + offset;
      const along = dx * Math.cos(angle) - dz * Math.sin(angle);
      const perpendicular = dx * Math.sin(angle) + dz * Math.cos(angle);
      if (
        Math.abs(along) <= activeHazard.halfLength
        && Math.abs(perpendicular) <= 0.58
      ) {
        return true;
      }
    }
    return false;
  }

  addBox([0, 0, 8], [8, 1, 8]);
  addRouteLabel([0, 2.5, 8], '断空试炼');
  addRouteLabel([0, 1.8, 4.8], '第一段 · 裂空阶梯');

  const firstSection = [
    [[0, 0.6, 1.8], [2.6, 0.5, 2.8]],
    [[2.2, 1.3, -1.3], [2.2, 0.5, 2.2]],
    [[-0.4, 2, -4.2], [1.9, 0.5, 2]],
    [[2.4, 2.8, -7.4], [1.8, 0.5, 2]],
    [[-0.2, 3.6, -10.6], [1.6, 0.5, 1.9]],
    [[-2.6, 4.5, -13.8], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of firstSection) addBox(position, size);
  addRecovery([-3.8, -2, -5.6]);
  addRecovery([3.6, -1, -11.2]);
  addCheckpoint([0, 5.4, -16.9], 1);

  addRouteLabel([0, 8.2, -19.2], '第二段 · 赤轮回廊', '#fecaca');
  addRoundPlatform([-3.8, 6, -23], 3.2);
  addBox([0, 6.3, -26.2], [2.2, 0.6, 2.2], edge);
  addRoundPlatform([3.2, 6.8, -29.2], 3);
  addBox([0, 7.1, -32.4], [2.2, 0.6, 2.2], edge);
  addRoundPlatform([-3.8, 7.6, -35.5], 3.2);
  addSweeper({ position: [-3.8, 7.15, -23], length: 5.7, speed: 0.72 });
  addSweeper({ position: [3.2, 7.95, -29.2], length: 5.3, speed: -0.96, phase: 0.7 });
  addSweeper({
    position: [-3.8, 8.75, -35.5],
    length: 5.8,
    speed: 1.12,
    phase: 0.35,
    double: true,
  });
  addCheckpoint([0, 8.3, -41.6], 2);

  addRouteLabel([0, 11.2, -44], '第三段 · 断桥终冲', '#fde68a');
  const finalApproach = [
    [[3, 9.2, -46.1], [1.8, 0.5, 2]],
    [[-0.6, 10.1, -49.4], [1.7, 0.5, 1.9]],
    [[-3.8, 11, -52.6], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of finalApproach) addBox(position, size);
  addRoundPlatform([1, 11.8, -57.8], 2.8);
  addSweeper({
    position: [1, 12.95, -57.8],
    length: 5,
    speed: -1.25,
    phase: 0.5,
    double: true,
  });

  const finalChain = [
    [[3.8, 12.8, -62.5], [1.7, 0.5, 1.8]],
    [[1, 13.7, -65.7], [1.6, 0.5, 1.8]],
    [[-1.8, 14.6, -68.9], [1.6, 0.5, 1.8]],
    [[1, 15.5, -72.1], [1.6, 0.5, 1.8]],
    [[-1.5, 16.4, -75.3], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of finalChain) addBox(position, size);

  addBox([0, 17.2, -79.5], [7, 0.9, 5], goal);
  addBox([-2.6, 19, -81.2], [0.5, 3.6, 0.5], goal);
  addBox([2.6, 19, -81.2], [0.5, 3.6, 0.5], goal);
  addBox([0, 20.7, -81.2], [5.7, 0.5, 0.5], goal);
  addRouteLabel([0, 20, -78.8], '塔顶终点', '#fef3c7');
  sdk.helpers.triggerZone({
    position: [0, 19, -79.5],
    size: [5.5, 3, 4],
    goal: true,
    once: true,
    visible: false,
  });

  return {
    onUpdate(_dt, elapsed) {
      for (const activeHazard of hazards) {
        activeHazard.group.rotation.y = elapsed * activeHazard.speed + activeHazard.phase;
      }

      if (elapsed < protectedUntil) return;
      const player = sdk.player.getPosition();
      for (const activeHazard of hazards) {
        if (playerHitsSweeper(player, activeHazard, elapsed)) {
          protectedUntil = elapsed + 1.25;
          sdk.player.teleport(currentCheckpoint, 180);
          sdk.ui.toast('被赤轮击中，返回最近检查点', 1600);
          break;
        }
      }
    },
    onDispose() {
      hazards.length = 0;
      geometryCache.clear();
    },
  };
}
