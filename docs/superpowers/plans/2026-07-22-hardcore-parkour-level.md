# 《断空试炼》WhiteRoom 关卡实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一张高难但公平、包含精准跳跃与旋转节奏机关、可真实通关并可打包审核的 WhiteRoom 跑酷关卡。

**Architecture:** 使用 WhiteRoom Level Kit 脚手架建立标准 `.wrlevel` 源目录。`main.js` 只使用注入的 `sdk`，以静态碰撞平台组成三段上升路线，以 `onUpdate` 驱动纯视觉旋转杆并通过解析几何计算危险命中；两个触发区负责设置检查点，唯一 `goal: true` 区域交由 `reach_zone` 引擎判定通关。

**Tech Stack:** WhiteRoom Level SDK v1、JavaScript ES modules、Node.js 20+ 内建测试器、WhiteRoom Level Kit 校验/开发/打包脚本、真实 Chrome 浏览器。

---

## 文件结构

- Create: `work/whiteroom-levels/duankong-trial/level.json` — 权威关卡清单、出生点、难度与通关条件。
- Create: `work/whiteroom-levels/duankong-trial/main.js` — 三段几何路线、检查点、旋转机关与目标区。
- Create: `work/whiteroom-levels/duankong-trial/solution.md` — 经真实试玩核对的完整通关路径。
- Create: `work/whiteroom-levels/duankong-trial/cover.png` — 脚手架生成的合规 16:9 PNG 封面。
- Create: `work/whiteroom-level-tests/duankong-trial.contract.test.mjs` — 清单与 SDK 注册行为的本地契约测试，不进入关卡包。
- Generate: `dist/whiteroom-levels/*.wrlevel` — 通过校验后的最终审核包，不提交到 Git。

### Task 1: 从官方脚手架创建关卡并建立失败契约测试

**Files:**
- Create: `work/whiteroom-levels/duankong-trial/level.json`
- Create: `work/whiteroom-levels/duankong-trial/main.js`
- Create: `work/whiteroom-levels/duankong-trial/solution.md`
- Create: `work/whiteroom-levels/duankong-trial/cover.png`
- Create: `work/whiteroom-level-tests/duankong-trial.contract.test.mjs`

- [ ] **Step 1: 运行 WhiteRoom 官方脚手架**

```powershell
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\create-level.mjs --dir work\whiteroom-levels\duankong-trial --name "断空试炼" --author "Jimmy" --type reach_zone --objective "穿越三重跑酷试炼，抵达塔顶" --slug duankong-trial --difficulty 5 --minutes 8
```

Expected: 输出 `ok: true`，创建四个必需文件和空的 `assets/` 目录；`cover.png` 至少为 960×540、16:9。

- [ ] **Step 2: 写入契约测试**

Create `work/whiteroom-level-tests/duankong-trial.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const levelDir = path.resolve('work/whiteroom-levels/duankong-trial');

class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

class FakeObject3D {
  constructor() {
    this.position = new FakeVector3();
    this.rotation = { x: 0, y: 0, z: 0 };
    this.children = [];
    this.castShadow = false;
    this.receiveShadow = false;
  }

  add(...children) {
    this.children.push(...children);
  }
}

class FakeMesh extends FakeObject3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
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

function createSdk() {
  const captures = {
    colliders: [],
    goalZones: [],
    checkpoints: [],
    teleports: [],
    toasts: [],
    progress: [],
  };
  const scene = new FakeObject3D();
  const playerPosition = new FakeVector3(0, 1.8, 8);
  const sdk = {
    THREE: {
      BoxGeometry: FakeGeometry,
      CylinderGeometry: FakeGeometry,
      Group: FakeObject3D,
      Mesh: FakeMesh,
      MeshStandardMaterial: FakeMaterial,
    },
    scene,
    env: {
      setBackground() {},
      setFog() {},
      setAmbient() {},
      addSun() {},
    },
    physics: {
      addCollider(object) {
        captures.colliders.push(object);
      },
    },
    helpers: {
      triggerZone(options) {
        if (options.goal) captures.goalZones.push(options);
        return options;
      },
      label() {
        return new FakeObject3D();
      },
    },
    player: {
      getPosition() {
        return playerPosition;
      },
      setCheckpoint(position, yawDeg) {
        captures.checkpoints.push({ position, yawDeg });
      },
      teleport(position, yawDeg) {
        captures.teleports.push({ position, yawDeg });
      },
    },
    objective: {
      set() {},
      updateProgress(text) {
        captures.progress.push(text);
      },
    },
    ui: {
      toast(text) {
        captures.toasts.push(text);
      },
      subtitle() {},
    },
  };
  return { sdk, captures, playerPosition };
}

test('manifest declares the approved high-difficulty reach-zone contract', async () => {
  const manifest = JSON.parse(await readFile(path.join(levelDir, 'level.json'), 'utf8'));
  assert.equal(manifest.name, '断空试炼');
  assert.equal(manifest.type, 'reach_zone');
  assert.deepEqual(manifest.winCondition, { type: 'reach_zone', parTime: 300 });
  assert.equal(manifest.objective, '穿越三重跑酷试炼，抵达塔顶');
  assert.equal(manifest.difficulty, 5);
  assert.equal(manifest.estimatedMinutes, 8);
  assert.deepEqual(manifest.spawn, { position: [0, 1.8, 8], yawDeg: 180 });
  assert.equal(manifest.killY, -10);
});

test('runtime registers two checkpoints, hazards, colliders, and one engine goal', async () => {
  const source = await readFile(path.join(levelDir, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  const moduleUrl = `${pathToFileURL(path.join(levelDir, 'main.js')).href}?test=${Date.now()}`;
  const { default: createLevel } = await import(moduleUrl);
  const { sdk, captures, playerPosition } = createSdk();
  const handle = createLevel(sdk);

  assert.equal(typeof handle.onUpdate, 'function');
  assert.equal(typeof handle.onDispose, 'function');
  assert.ok(captures.colliders.length >= 20);
  assert.equal(captures.goalZones.length, 1);

  const checkpointZones = sdk.scene.children
    .filter((child) => child.checkpointZone)
    .map((child) => child.checkpointZone);
  assert.equal(checkpointZones.length, 2);
  checkpointZones.forEach((zone) => zone.onEnter());
  assert.equal(captures.checkpoints.length, 2);

  playerPosition.set(-3.8, 7.15, -23);
  handle.onUpdate(1 / 60, 0);
  assert.equal(captures.teleports.length, 1);
  assert.match(captures.toasts.at(-1), /赤轮/);
});
```

- [ ] **Step 3: 运行测试并确认它因尚未实现设计而失败**

```powershell
node --test work\whiteroom-level-tests\duankong-trial.contract.test.mjs
```

Expected: FAIL；清单测试报告 `winCondition`、`spawn` 或 `killY` 不匹配，运行时测试报告缺少检查点注册。

- [ ] **Step 4: 提交脚手架和失败测试**

```powershell
git add work\whiteroom-levels\duankong-trial\level.json work\whiteroom-levels\duankong-trial\main.js work\whiteroom-levels\duankong-trial\solution.md work\whiteroom-levels\duankong-trial\cover.png work\whiteroom-level-tests\duankong-trial.contract.test.mjs
git commit -m "test: scaffold Duankong parkour level"
```

### Task 2: 完成权威关卡清单

**Files:**
- Modify: `work/whiteroom-levels/duankong-trial/level.json`
- Test: `work/whiteroom-level-tests/duankong-trial.contract.test.mjs`

- [ ] **Step 1: 将清单替换为确认后的固定内容**

Replace `work/whiteroom-levels/duankong-trial/level.json` with:

```json
{
  "schema": "wr-level",
  "schemaVersion": 1,
  "engineApi": "1",
  "id": "duankong-trial-000000",
  "name": "断空试炼",
  "version": "1.0.0",
  "author": {
    "name": "Jimmy"
  },
  "description": "攀登悬空高塔，在精准跳跃与赤色旋转机关之间找到通往塔顶的节奏。",
  "language": "zh-CN",
  "type": "reach_zone",
  "winCondition": {
    "type": "reach_zone",
    "parTime": 300
  },
  "objective": "穿越三重跑酷试炼，抵达塔顶",
  "difficulty": 5,
  "estimatedMinutes": 8,
  "spawn": {
    "position": [0, 1.8, 8],
    "yawDeg": 180
  },
  "door": null,
  "killY": -10,
  "entry": "main.js",
  "cover": "cover.png",
  "tags": ["跑酷", "高难", "机关", "检查点", "几何"],
  "contentRating": "everyone",
  "credits": []
}
```

- [ ] **Step 2: 仅运行清单契约并确认通过**

```powershell
node --test --test-name-pattern="manifest declares" work\whiteroom-level-tests\duankong-trial.contract.test.mjs
```

Expected: PASS 1、SKIP 1。

- [ ] **Step 3: 运行完整契约并确认运行时仍然失败**

```powershell
node --test work\whiteroom-level-tests\duankong-trial.contract.test.mjs
```

Expected: manifest PASS；runtime FAIL，原因是模板尚未注册两个检查点。

- [ ] **Step 4: 提交清单**

```powershell
git add work\whiteroom-levels\duankong-trial\level.json
git commit -m "feat: define Duankong level manifest"
```

### Task 3: 实现三段路线、检查点与赤轮机关

**Files:**
- Modify: `work/whiteroom-levels/duankong-trial/main.js`
- Test: `work/whiteroom-level-tests/duankong-trial.contract.test.mjs`

- [ ] **Step 1: 将关卡入口替换为完整 SDK 实现**

Replace `work/whiteroom-levels/duankong-trial/main.js` with:

```js
export default function createLevel(sdk) {
  const { THREE } = sdk;
  const hazards = [];
  const geometryCache = new Map();
  let currentCheckpoint = [0, 1.8, 8];
  let protectedUntil = -1;

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

  const materials = {
    safe: new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.82 }),
    edge: new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.72 }),
    checkpoint: new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0e7490,
      emissiveIntensity: 1.4,
      roughness: 0.5,
    }),
    hazard: new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 1.8,
      roughness: 0.45,
    }),
    recovery: new THREE.MeshStandardMaterial({
      color: 0x164e63,
      emissive: 0x083344,
      emissiveIntensity: 0.8,
      roughness: 0.75,
    }),
    goal: new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0x92400e,
      emissiveIntensity: 1.7,
      roughness: 0.4,
    }),
  };

  function boxGeometry(size) {
    const key = size.join(':');
    if (!geometryCache.has(key)) {
      geometryCache.set(key, new THREE.BoxGeometry(size[0], size[1], size[2]));
    }
    return geometryCache.get(key);
  }

  function addBox(position, size, material = materials.safe, collider = true) {
    const mesh = new THREE.Mesh(boxGeometry(size), material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sdk.scene.add(mesh);
    if (collider) sdk.physics.addCollider(mesh);
    return mesh;
  }

  function addRoundPlatform(position, radius) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.7, 32),
      materials.safe,
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sdk.scene.add(mesh);
    sdk.physics.addCollider(mesh);
    return mesh;
  }

  function addRouteLabel(position, text, color = '#dbeafe') {
    sdk.helpers.label(position, text, { size: 0.72, color });
  }

  function addCheckpoint(center, index) {
    const platform = addBox(center, [5, 0.8, 4], materials.checkpoint);
    const respawn = [center[0], center[1] + 1.5, center[2]];
    const zone = sdk.helpers.triggerZone({
      position: [center[0], center[1] + 1.2, center[2]],
      size: [4.4, 2.4, 3.4],
      once: true,
      visible: false,
      onEnter: () => {
        currentCheckpoint = respawn;
        sdk.player.setCheckpoint(respawn, 180);
        sdk.objective.updateProgress(`检查点 ${index}/2`);
        sdk.ui.toast(`检查点 ${index}/2 已激活`, 1800);
      },
    });
    platform.checkpointZone = zone;
    return platform;
  }

  function addRecovery(center) {
    addBox(center, [5, 0.5, 5], materials.recovery);
    sdk.helpers.triggerZone({
      position: [center[0], center[1] + 1.1, center[2]],
      size: [4.8, 2.5, 4.8],
      visible: false,
      onEnter: () => {
        sdk.player.teleport(currentCheckpoint, 180);
        sdk.ui.toast('落到回收台，返回最近检查点', 1600);
      },
    });
  }

  function addSweeper({ position, length, speed, phase = 0, double = false }) {
    const group = new THREE.Group();
    group.position.set(position[0], position[1], position[2]);

    const bar = new THREE.Mesh(boxGeometry([length, 0.38, 0.48]), materials.hazard);
    bar.castShadow = true;
    group.add(bar);

    if (double) {
      const crossBar = new THREE.Mesh(boxGeometry([length, 0.38, 0.48]), materials.hazard);
      crossBar.rotation.y = Math.PI / 2;
      crossBar.castShadow = true;
      group.add(crossBar);
    }

    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 1.5, 16),
      materials.hazard,
    );
    axle.position.set(position[0], position[1] - 0.72, position[2]);
    axle.castShadow = true;
    sdk.scene.add(axle);
    sdk.scene.add(group);

    hazards.push({
      group,
      centerX: position[0],
      centerZ: position[2],
      y: position[1],
      halfLength: length / 2,
      speed,
      phase,
      offsets: double ? [0, Math.PI / 2] : [0],
    });
  }

  function playerHitsSweeper(player, hazard, elapsed) {
    if (Math.abs(player.y - hazard.y) > 1.15) return false;
    const dx = player.x - hazard.centerX;
    const dz = player.z - hazard.centerZ;
    for (const offset of hazard.offsets) {
      const angle = elapsed * hazard.speed + hazard.phase + offset;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const along = dx * cosine + dz * sine;
      const perpendicular = -dx * sine + dz * cosine;
      if (Math.abs(along) <= hazard.halfLength && Math.abs(perpendicular) <= 0.58) {
        return true;
      }
    }
    return false;
  }

  addBox([0, 0, 8], [8, 1, 8], materials.safe);
  addRouteLabel([0, 2.5, 8], '断空试炼');
  addRouteLabel([0, 1.8, 4.8], '第一段 · 裂空阶梯');

  const firstSection = [
    [[0, 0.6, 1.8], [2.6, 0.5, 2.8]],
    [[2.2, 1.3, -1.3], [2.2, 0.5, 2.2]],
    [[-0.4, 2.0, -4.2], [1.9, 0.5, 2.0]],
    [[2.4, 2.8, -7.4], [1.8, 0.5, 2.0]],
    [[-0.2, 3.6, -10.6], [1.6, 0.5, 1.9]],
    [[-2.6, 4.5, -13.8], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of firstSection) addBox(position, size);
  addRecovery([-3.8, -2.0, -5.6]);
  addRecovery([3.6, -1.0, -11.2]);
  addCheckpoint([0, 5.4, -16.9], 1);

  addRouteLabel([0, 8.2, -19.2], '第二段 · 赤轮回廊', '#fecaca');
  addRoundPlatform([-3.8, 6.0, -23.0], 3.2);
  addBox([0, 6.3, -26.2], [2.2, 0.6, 2.2], materials.edge);
  addRoundPlatform([3.2, 6.8, -29.2], 3.0);
  addBox([0, 7.1, -32.4], [2.2, 0.6, 2.2], materials.edge);
  addRoundPlatform([-3.8, 7.6, -35.5], 3.2);
  addSweeper({ position: [-3.8, 7.15, -23.0], length: 5.7, speed: 0.72 });
  addSweeper({ position: [3.2, 7.95, -29.2], length: 5.3, speed: -0.96, phase: 0.7 });
  addSweeper({ position: [-3.8, 8.75, -35.5], length: 5.8, speed: 1.12, phase: 0.35, double: true });
  addCheckpoint([0, 8.3, -41.6], 2);

  addRouteLabel([0, 11.2, -44.0], '第三段 · 断桥终冲', '#fde68a');
  const finalApproach = [
    [[3.0, 9.2, -46.1], [1.8, 0.5, 2.0]],
    [[-0.6, 10.1, -49.4], [1.7, 0.5, 1.9]],
    [[-3.8, 11.0, -52.6], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of finalApproach) addBox(position, size);
  addRoundPlatform([1.0, 11.8, -57.8], 2.8);
  addSweeper({ position: [1.0, 12.95, -57.8], length: 5.0, speed: -1.25, phase: 0.5, double: true });

  const finalChain = [
    [[3.8, 12.8, -62.5], [1.7, 0.5, 1.8]],
    [[1.0, 13.7, -65.7], [1.6, 0.5, 1.8]],
    [[-1.8, 14.6, -68.9], [1.6, 0.5, 1.8]],
    [[1.0, 15.5, -72.1], [1.6, 0.5, 1.8]],
    [[-1.5, 16.4, -75.3], [1.6, 0.5, 1.8]],
  ];
  for (const [position, size] of finalChain) addBox(position, size);

  addBox([0, 17.2, -79.5], [7, 0.9, 5], materials.goal);
  addBox([-2.6, 19.0, -81.2], [0.5, 3.6, 0.5], materials.goal);
  addBox([2.6, 19.0, -81.2], [0.5, 3.6, 0.5], materials.goal);
  addBox([0, 20.7, -81.2], [5.7, 0.5, 0.5], materials.goal);
  addRouteLabel([0, 20.0, -78.8], '塔顶终点', '#fef3c7');
  sdk.helpers.triggerZone({
    position: [0, 19.0, -79.5],
    size: [5.5, 3.0, 4.0],
    goal: true,
    once: true,
    visible: false,
  });

  return {
    onUpdate(_dt, elapsed) {
      for (const hazard of hazards) {
        hazard.group.rotation.y = elapsed * hazard.speed + hazard.phase;
      }
      if (elapsed < protectedUntil) return;
      const player = sdk.player.getPosition();
      for (const hazard of hazards) {
        if (!playerHitsSweeper(player, hazard, elapsed)) continue;
        protectedUntil = elapsed + 1.25;
        sdk.player.teleport(currentCheckpoint, 180);
        sdk.ui.toast('被赤轮击中，返回最近检查点', 1600);
        break;
      }
    },
    onDispose() {
      hazards.length = 0;
      geometryCache.clear();
    },
  };
}
```

- [ ] **Step 2: 运行完整契约测试**

```powershell
node --test work\whiteroom-level-tests\duankong-trial.contract.test.mjs
```

Expected: PASS 2。

- [ ] **Step 3: 运行 JavaScript 语法检查和 WhiteRoom 静态校验**

```powershell
node --check work\whiteroom-levels\duankong-trial\main.js
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\validate.mjs --dir work\whiteroom-levels\duankong-trial
```

Expected: 语法检查退出码 0；校验输出有效且没有错误。运行时注册扫描能看到一个 `goal: true` 区域。

- [ ] **Step 4: 提交关卡运行时**

```powershell
git add work\whiteroom-levels\duankong-trial\main.js
git commit -m "feat: build Duankong parkour course"
```

### Task 4: 写攻略并完成真实 Shell 试玩

**Files:**
- Modify: `work/whiteroom-levels/duankong-trial/solution.md`
- Modify if playtest requires numeric tuning: `work/whiteroom-levels/duankong-trial/main.js`

- [ ] **Step 1: 写入预期通关路径**

Replace `work/whiteroom-levels/duankong-trial/solution.md` with:

```markdown
# 断空试炼通关攻略

1. 从出生台朝金色塔顶方向前进，沿六块逐渐变窄的白色平台完成“裂空阶梯”。斜向跳跃时先对正下一块平台中央，再起跳修正方向。
2. 落到第一块青色平台，等待“检查点 1/2 已激活”的提示。
3. 进入“赤轮回廊”。先在每座圆台前的稳定位置观察红色横杆，等横杆刚从前进方向扫过后再通过；第三座圆台有两根交叉横杆，需要连续跨越两个空档。
4. 落到第二块青色平台，确认“检查点 2/2 已激活”。触碰赤轮会回到最近检查点，不会清空已完成进度。
5. 完成三次上升斜跳抵达最后一座双赤轮圆台，利用横杆离开前进方向后的短窗口穿过。
6. 连续跳过五块窄平台。最后一跳落到金色塔顶平台，向金色门框中央移动并进入目标区，由引擎判定通关。
7. 任意时刻都可以长按 R 软重置，或从暂停菜单返回 Hub。
```

- [ ] **Step 2: 启动真实 WhiteRoom 开发 Shell**

```powershell
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\dev.mjs --level work\whiteroom-levels\duankong-trial --port 4173
```

Expected: 进程持续运行并输出 `http://127.0.0.1:4173/?devLevel=duankong-trial-000000`。如果远程 Shell 代理被沙箱网络阻止，使用相同命令申请网络权限后重试，不改变关卡内容。

- [ ] **Step 3: 在真实 Chrome 中检查可见状态和文本状态**

Open `http://127.0.0.1:4173/?devLevel=duankong-trial-000000`，然后执行：

```js
typeof window.render_game_to_text === 'function'
  ? window.render_game_to_text()
  : 'render_game_to_text missing';
```

Expected: 页面渲染非空；能看到白色路线、红色机关、青色检查点和金色终点；文本状态包含玩家、关卡目标和场景对象，不返回 `render_game_to_text missing`。

- [ ] **Step 4: 用键盘完成一次从出生到引擎通关的全流程**

Use the Shell controls shown in the browser to move, look, and jump. Exercise both checkpoints, intentionally touch one red sweeper to verify checkpoint recovery, long-press R once to verify soft reset, then run from spawn to the gold goal until the engine displays completion.

Expected: 每个平台可达；机关命中只传送至最近检查点；检查点不会倒退；R 能重置；进入唯一目标区后显示引擎通关状态。

- [ ] **Step 5: 按固定公平性规则处理试玩中发现的不可达跳跃**

Only if a required landing is not reachable with normal Shell movement, change that landing in `main.js` by one deterministic increment: add `0.2` meter to its X/Z size or move its center `0.2` meter toward the preceding platform. Keep every main-route platform at least `1.4` meters wide and every intended horizontal gap within `2–4` meters. After each change, rerun the contract test, validator, and full browser route from the preceding checkpoint.

Expected: 所有必经跳跃可稳定完成，同时保留窄落点、连续操作与机关读秒形成的难度。

- [ ] **Step 6: 检查浏览器控制台与运行时错误**

Inspect console messages and JavaScript errors after the successful run.

Expected: 没有未处理异常、资源 404、Three.js 导入错误或关卡注册错误。

- [ ] **Step 7: 核对攻略与实测路线一致**

Read `solution.md` from top to bottom and replay its seven numbered actions. Keep the file unchanged only if every statement matches the successful run; otherwise change the specific platform count, checkpoint behavior, or timing sentence to the observed result, then replay that corrected action.

- [ ] **Step 8: 提交实测结果**

```powershell
git add work\whiteroom-levels\duankong-trial\main.js work\whiteroom-levels\duankong-trial\solution.md
git commit -m "test: verify Duankong level playthrough"
```

### Task 5: 最终校验、封面检查与打包

**Files:**
- Verify: `work/whiteroom-levels/duankong-trial/cover.png`
- Generate: `dist/whiteroom-levels/*.wrlevel`

- [ ] **Step 1: 视觉检查脚手架封面**

Open `work/whiteroom-levels/duankong-trial/cover.png` with the local image viewer.

Expected: 图片可正常解码、16:9、无透明空白或损坏。正式关卡画面已在浏览器试玩步骤中通过截图检查，包内封面保持脚手架生成的合规轻量 PNG。

- [ ] **Step 2: 运行全部本地契约与最终静态校验**

```powershell
node --test work\whiteroom-level-tests\duankong-trial.contract.test.mjs
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\validate.mjs --dir work\whiteroom-levels\duankong-trial --json
```

Expected: 契约 PASS 2；校验 JSON 中 `valid` 为 `true`、`errors` 为空。

- [ ] **Step 3: 打包为 `.wrlevel`**

```powershell
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\pack.mjs --dir work\whiteroom-levels\duankong-trial --out dist\whiteroom-levels
```

Expected: 输出 `ok: true`、内容哈希生成的最终 `levelId`、包路径、包哈希和字节数；包小于 40MB。

- [ ] **Step 4: 再次校验源目录并记录最终交付信息**

```powershell
node C:\Users\jimmy\.codex\skills\whiteroom-level-kit\scripts\validate.mjs --dir work\whiteroom-levels\duankong-trial
Get-ChildItem dist\whiteroom-levels\*.wrlevel | Select-Object FullName,Length,LastWriteTime
```

Expected: 校验仍通过；输出目录中存在一个新生成的 `.wrlevel` 包。最终报告源目录、包路径、最终 `levelId`、校验结果、契约结果与真实通关结果。不要上传；只有在展示最终 ID 与校验结果并获得用户再次明确确认后，才可运行远程发布命令。
