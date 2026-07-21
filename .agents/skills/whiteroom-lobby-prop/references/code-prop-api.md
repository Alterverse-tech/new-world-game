# Three.js Code Prop API

文件路径：`<game-dir>/src/lobby-props/generated/<code-key>.ts`。

## 基础模块

```ts
import * as THREE from 'three';

export const code = 'example-lamp';

export function createLobbyProp(): THREE.Object3D {
  const root = new THREE.Group();
  // 只创建本物件拥有的 geometry、material、light 和子节点。
  return root;
}

export function updateLobbyProp(object: THREE.Object3D, elapsed: number): void {
  // 可选：确定性视觉动画，不修改 root 的共享变换。
}

export function interactLobbyProp(object: THREE.Object3D): void {
  // 可选：只改变本物件视觉或 userData，不访问外部状态。
}
```

## 受审核物理物件

模块只声明数据，WhiteRoom 运行时负责 Rapier 世界、固定 60 Hz、CCD、姿态同步和资源释放。不要导入 Rapier，也不要在 `updateLobbyProp` 中修改 root 变换。

```ts
import * as THREE from 'three';
import type { LobbyPhysicsDescriptor } from '../types';

export const code = 'example-ramp';
export const physics = {
  body: 'fixed',
  mass: 0,
  friction: 1.1,
  restitution: 0.04,
  colliders: [{
    shape: 'box',
    halfExtents: [2.5, 0.18, 4],
    position: [0, 1.3, 0],
    rotation: [-Math.PI / 12, 0, 0],
  }],
} satisfies LobbyPhysicsDescriptor;
```

碰撞体的 `position` / `rotation` 相对物件 root；运行时会与摆放位置、四元数和缩放组合。视觉模型与碰撞体必须对齐。固定体可用最多 8 个 primitive collider 组成斜坡或静态结构；当前动态体只允许 1 个 collider，以避免把复合刚体拆成互不相干的物体。

动态体可被载具推动，示例：

```ts
export const physics = {
  body: 'dynamic',
  mass: 42,
  friction: 0.86,
  restitution: 0.12,
  colliders: [{
    shape: 'box',
    halfExtents: [0.75, 0.75, 0.75],
    position: [0, 0.75, 0],
    rotation: [0, 0, 0],
  }],
} satisfies LobbyPhysicsDescriptor;
```

完整字段、精确键与范围见 `catalog-schema.md`。目录和模块 descriptor 不一致时，运行时必须降级为普通视觉物件而不是猜测碰撞形状。

## 可驾驶载具

载具是受审核的 `code` 模块。从 `../types` 仅导入类型，导出 `LobbyPropModule.vehicle`。平台目录中必须存在同 `kind` 的 `vehicle` 服务器包络，否则运行时不会启用驾驶。

```ts
import * as THREE from 'three';
import type { LobbyCarCapability, LobbyVehicleVisualState } from '../types';

export const code = 'example-car';
export const vehicle = {
  kind: 'car',
  seatAnchor: [0, 0.8, 0],
  exitAnchors: [[-1.4, 0, 0], [1.4, 0, 0]],
  cameraAnchor: [0, 1.2, -1.4],
  collisionHalfExtents: [0.9, 0.65, 1.9],
  enterDurationSeconds: 0.45,
  exitDurationSeconds: 0.35,
  physics: {
    massKg: 1200,
    maxForwardSpeed: 24,
    maxReverseSpeed: 7,
    engineAcceleration: 10,
    reverseAcceleration: 6,
    brakeDeceleration: 18,
    rollingResistance: 1.1,
    aerodynamicDrag: 0.025,
    wheelBase: 2.35,
    maxSteerAngle: 0.55,
    steeringResponse: 8,
    collisionRestitution: 0.08,
    maxExitSpeed: 1.25,
  },
} satisfies LobbyCarCapability;

export function updateLobbyVehicleVisual(
  object: THREE.Object3D,
  state: LobbyVehicleVisualState,
  elapsed: number,
): void {
  // 可选：用 state 驱动车轮、方向舵、螺旋桨、尾灯等子节点。
}
```

`updateLobbyVehicleVisual` 接收 `phase`、`speed`、`normalizedSpeed`、`throttle`、`steering`、`pitch`、`roll` 和 `grounded`。它只能更新 root 内部视觉，不得改动 root 的 position/rotation/scale。

### 坐标与锚点

- root 原点放在物件底部中心；+X 向右、+Y 向上、**+Z 始终是车头/机头前进方向**。
- `seatAnchor`：驾驶员相对 root 的坐位中心。
- `exitAnchors`：按优先级排列的候选下车/下机点，最多 8 个；必须留出玩家碰撞体空间。
- `cameraAnchor`：载具视角中心，通常位于座舱上方，可沿 -Z 略向后。
- `collisionHalfExtents`：以米为单位的轴对齐包围盒半尺寸 `[x, y, z]`，必须覆盖可见主体。
- `enterDurationSeconds` / `exitDurationSeconds`：进出载具过渡时长，范围 0–2 秒。

锚点分量将限制在安全范围：`seatAnchor` ±8 米，`cameraAnchor`/`exitAnchors` ±12 米，包围盒 x/z 半尺寸 0.25–8 米、y 半尺寸 0.15–4 米。

### 物理参数

单位统一为米、秒、千克和弧度。超出下列范围的值会被运行时限制，应在生成阶段就使用范围内的值。

| 类型 | 字段与范围 |
| --- | --- |
| `car` | `massKg` 100–20000；`maxForwardSpeed` 2–80；`maxReverseSpeed` 1–30；`engineAcceleration` 0.5–60；`reverseAcceleration` 0.5–40；`brakeDeceleration` 1–80；`rollingResistance` 0.01–10；`aerodynamicDrag` 0–0.25；`wheelBase` 0.5–8；`maxSteerAngle` 0.05–1.2；`steeringResponse` 0.5–30；`collisionRestitution` 0–0.5；`maxExitSpeed` 0.1–5 |
| `aircraft` | `massKg` 100–100000；`maxSpeed` 5–140；`engineAcceleration` 0.5–60；`groundBrakeDeceleration` 0.5–60；`aerodynamicDrag` 0.001–0.2；`liftCoefficient` 0.2–2.5；`stallSpeed` 3–60；`gravity` 1–30；`pitchRate` 0.05–3；`yawRate` 0.05–2；`rollRate` 0.05–4；`bankTurnRate` 0–3；`maxPitch` 0.1–1.35；`maxRoll` 0.1–1.5；`controlResponse` 0.2–20；`velocityAlignment` 0–10；`throttleResponse` 0.1–10；`ceiling` 4–120；`collisionRestitution` 0–0.5；`maxExitSpeed` 0.1–8 |

目录的 `maxSpeed` / `maxAcceleration` / `maxAngularSpeed` 是服务器安全包络，不是第二套物理。将它们设为能覆盖模块的合法极值，但不得虚高。

### 多人与安全

- 载具进入使用平台 `vehicle-lease-v1`：服务器校验频道、已摆放物件、目录能力、进入距离和占用状态，同一时刻只有一名驾驶员。
- 客户端只能在有效 `leaseId` 下上报递增 `seq` 的姿态；服务器限制速度、加速度、角速度、坐标边界和频率。
- 离开、断线、超时或切换派对时服务器会释放租约。当前停车姿态只在大厅运行时内保留，服务器重启后从摆放变换恢复，不写入家园数据。
- 模块不得自建 WebSocket、请求租约、更改 root 姿态或隐藏驾驶员；这些都由 WhiteRoom 运行时统一处理。
- 不得执行用户直接上传的 JavaScript。只能运行进入受信任 canonical source、通过静态校验、父 Worker 独立运行时 smoke、资源预算、完整测试/构建与原子发布门禁，再登记到平台允许列表的模块。

## 通用规则

- 建议尺寸 0.25–4 米，三角面不超过约 50k；尺寸更大的载具要与碰撞体和大厅边界一起实测。
- 为所有 Mesh 设置合理的 `castShadow`/`receiveShadow`。
- 将可释放的 geometry/material/texture 保持在 root 子树中。
- 动画不得移动 root 的共享 position/rotation/scale。
- 只允许运行时静态导入 `three`；只允许从 `../types` 使用 `import type`。不得使用其他运行时导入、副作用导入、再导出或动态 import。登记后必须出现在自动生成的 `approved-modules.ts` 显式清单中；未登记残留文件不会执行。
- 不得访问 `window`、`document`、网络、存储、Worker、`eval` 或 `Function`。
- 不得查找、引用或修改终端机；运行时也会把终端机排除在选择射线外。
- 普通物件交互是本地或平台序列化的视觉反馈；载具则必须使用平台租约协议。
- 物理物件只能声明受限 primitive 数据；Rapier 世界、碰撞体和动态姿态由宿主统一拥有。当前动态物件位移是驾驶会话内状态，除非平台另有权威同步，不得声称已跨玩家持久同步。
- 静态 AST 检查只用于提前拒绝明显危险能力，不是 JavaScript 沙箱。人工工作流仍应完整阅读源码；自动玩家工作流只有在受信任父 Worker 的独立 smoke、资源预算、测试、构建、最新基线重放与原子回滚门禁全部通过时才允许发布。
