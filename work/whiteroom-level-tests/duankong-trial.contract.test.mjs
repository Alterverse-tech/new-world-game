import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const levelUrl = new URL('../whiteroom-levels/duankong-trial/', import.meta.url);
const levelJsonUrl = new URL('level.json', levelUrl);
const mainUrl = new URL('main.js', levelUrl);

test('manifest declares the Duankong Trial reach-zone contract', async () => {
  const manifest = JSON.parse(await readFile(levelJsonUrl, 'utf8'));

  assert.equal(manifest.name, '断空试炼');
  assert.equal(manifest.type, 'reach_zone');
  assert.deepEqual(manifest.winCondition, { type: 'reach_zone', parTime: 300 });
  assert.equal(manifest.objective, '穿越三重跑酷试炼，抵达塔顶');
  assert.equal(manifest.difficulty, 5);
  assert.equal(manifest.estimatedMinutes, 8);
  assert.deepEqual(manifest.spawn.position, [0, 1.8, 8]);
  assert.equal(manifest.spawn.yawDeg, 0, 'spawn must face the -Z parkour route');
  assert.equal(manifest.killY, -10);
});

class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.set(x, y, z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(vector) {
    return this.set(vector.x, vector.y, vector.z);
  }

  clone() {
    return new FakeVector3(this.x, this.y, this.z);
  }
}

class FakeObject3D {
  constructor() {
    this.children = [];
    this.position = new FakeVector3();
    this.rotation = new FakeVector3();
    this.scale = new FakeVector3(1, 1, 1);
  }

  add(...children) {
    this.children.push(...children);
    return this;
  }
}

class FakeGeometry {
  constructor(...args) {
    this.args = args;
  }
}

class FakeMaterial {
  constructor(options = {}) {
    Object.assign(this, options);
  }
}

class FakeMesh extends FakeObject3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

const makeSdk = () => {
  const colliders = [];
  const goalZones = [];
  const triggerZones = [];
  const checkpoints = [];
  const teleports = [];
  const toasts = [];
  const progress = [];
  const scene = new FakeObject3D();
  const playerPosition = new FakeVector3();
  const THREE = {
    BoxGeometry: FakeGeometry,
    CylinderGeometry: FakeGeometry,
    Group: FakeObject3D,
    Mesh: FakeMesh,
    MeshStandardMaterial: FakeMaterial,
  };
  const sdk = {
    THREE,
    scene,
    physics: { addCollider: (object) => colliders.push(object) },
    player: {
      getPosition: () => playerPosition.clone(),
      setCheckpoint: (...args) => checkpoints.push(args),
      teleport: (...args) => teleports.push(args),
    },
    objective: {
      set: () => {},
      updateProgress: (text) => progress.push(text),
    },
    ui: { toast: (text, ms) => toasts.push([text, ms]), subtitle: () => {} },
    env: { setBackground: () => {}, setFog: () => {}, setAmbient: () => {}, addSun: () => {} },
    helpers: {
      triggerZone: (options) => {
        triggerZones.push(options);
        if (options.goal) goalZones.push(options);
        return options;
      },
      label: () => new FakeObject3D(),
    },
  };

  return {
    sdk,
    colliders,
    goalZones,
    triggerZones,
    checkpoints,
    teleports,
    toasts,
    progress,
    playerPosition,
  };
};

test('runtime builds the parkour route, checkpoints, and red-wheel recovery', async () => {
  const source = await readFile(mainUrl, 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);

  const { default: createLevel } = await import(`${pathToFileURL(fileURLToPath(mainUrl)).href}?contract=${Date.now()}`);
  const state = makeSdk();
  const handle = createLevel(state.sdk);

  assert.equal(typeof handle.onUpdate, 'function');
  assert.equal(typeof handle.onDispose, 'function');
  assert.equal(state.goalZones.length, 1);

  const checkpointZones = state.triggerZones.filter(
    (zone) => !zone.goal && zone.once === true && typeof zone.onEnter === 'function',
  );
  assert.equal(checkpointZones.length, 2);
  for (const zone of checkpointZones) zone.onEnter();
  assert.deepEqual(state.checkpoints, [
    [[0, 6.9, -16.9], 180],
    [[0, 9.8, -41.6], 180],
  ]);

  const recoveryZones = state.triggerZones.filter(
    (zone) => !zone.goal && zone.once === false && typeof zone.onEnter === 'function',
  );
  assert.ok(recoveryZones.length > 0);
  recoveryZones[0].onEnter();
  assert.deepEqual(state.teleports.at(-1), [[0, 9.8, -41.6], 180]);

  assert.ok(state.colliders.length >= 20);
  state.playerPosition.set(-3.8, 7.15, -23);
  handle.onUpdate(1 / 60, 0);
  assert.equal(state.teleports.length, 2);
  assert.deepEqual(state.teleports.at(-1), [[0, 9.8, -41.6], 180]);
  assert.match(state.toasts.at(-1)?.[0] ?? '', /赤轮/);
});

test('赤轮碰撞跟随渲染后的 Y 轴旋转', async () => {
  const { default: createLevel } = await import(`${pathToFileURL(fileURLToPath(mainUrl)).href}?rotation=${Date.now()}`);
  const elapsed = (Math.PI / 4) / 0.72;
  const offset = 1.5 / Math.sqrt(2);

  const visualState = makeSdk();
  const visualHandle = createLevel(visualState.sdk);
  visualState.playerPosition.set(-3.8 + offset, 7.15, -23 - offset);
  visualHandle.onUpdate(1 / 60, elapsed);
  assert.equal(visualState.teleports.length, 1);

  const mirroredState = makeSdk();
  const mirroredHandle = createLevel(mirroredState.sdk);
  mirroredState.playerPosition.set(-3.8 + offset, 7.15, -23 + offset);
  mirroredHandle.onUpdate(1 / 60, elapsed);
  assert.equal(mirroredState.teleports.length, 0);
});
