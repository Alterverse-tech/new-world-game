# WhiteRoom 大厅物件目录

目录源文件：`<platform-dir>/src/lobby-catalog.json`。

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "code-example-lamp",
      "name": "示例灯",
      "category": "灯具",
      "kind": "code",
      "code": "example-lamp",
      "defaultScale": 1
    },
    {
      "id": "glb-example-chair",
      "name": "示例椅",
      "category": "家具",
      "kind": "glb",
      "assetUrl": "/generated-assets/glb-example-chair.glb",
      "defaultScale": 1
    },
    {
      "id": "code-example-car",
      "name": "示例跑车",
      "category": "载具",
      "kind": "code",
      "code": "example-car",
      "defaultScale": 1,
      "vehicle": {
        "kind": "car",
        "enterRadius": 3.5,
        "maxSpeed": 24,
        "maxAcceleration": 18,
        "maxAngularSpeed": 2.8
      }
    },
    {
      "id": "code-example-ramp",
      "name": "示例斜坡",
      "category": "物理组件",
      "kind": "code",
      "code": "example-ramp",
      "defaultScale": 1,
      "physics": {
        "body": "fixed",
        "mass": 0,
        "friction": 1.1,
        "restitution": 0.04,
        "colliders": [{
          "shape": "box",
          "halfExtents": [2.5, 0.18, 4],
          "position": [0, 1.3, 0],
          "rotation": [-0.2617993877991494, 0, 0]
        }]
      }
    }
  ]
}
```

约束：

- `id` 与 `code` 使用小写 kebab-case，2–64 字符。
- `id` 不得包含 `terminal`、`computer` 或 `system`。
- `name` 1–40 字符，`category` 1–20 字符。
- `defaultScale` 范围 0.25–3。
- GLB 单文件不超过 15 MB，必须是 glTF 2.0 binary，使用 `/generated-assets/[a-z0-9-]+.glb` 小写单层路径。
- Code 模块不超过 100 KB；运行时只能静态导入 `three`，另允许 `import type ... from '../types'`。
- 登记器会生成与 code catalog 完全一致的 `src/lobby-props/approved-modules.ts`；运行时只导入该显式清单。静态检查不是 JavaScript 沙箱；自动玩家任务还必须通过父 Worker 的独立 smoke、资源预算、完整测试/构建、最新 canonical source 重放和原子发布门禁。
- 大厅运行时限制 200 个物件；世界根坐标 x/z 为 -54–54、y 为 0–8，实际摆放还必须满足公共区/家园地块和保护区规则。
- 目录只是可选物件清单；实际摆放状态由平台持久化，不得把终端机写入目录或状态。

每次登记后同时测试平台目录接口和游戏构建。上线需要原子部署游戏与平台，避免目录与渲染器版本不一致。

## 载具元数据

`vehicle` 只允许用于 `kind: "code"`，必须精确包含下列 5 个字段，不得增加其他字段。代码模块必须导出 `vehicle`，且模块 `vehicle.kind` 必须与目录一致；模块导出了载具能力却未登记元数据也会校验失败。

| `kind` | `enterRadius` | `maxSpeed` | `maxAcceleration` | `maxAngularSpeed` |
| --- | ---: | ---: | ---: | ---: |
| `car` | 1–6 | 1–35 | 1–30 | 0.1–4 |
| `aircraft` | 1–8 | 1–80 | 1–50 | 0.1–3 |

所有数值必须是有限数。`enterRadius` 是服务器允许进入载具的最大距离；其余三项是 `vehicle-lease-v1` 状态上报的服务器安全包络，应覆盖模块物理但不得虚高。登记器会静态读取模块 `vehicle.physics` 并拒绝速度、加速度或角速度包络偏小的目录项。载具停放姿态当前仅在服务器运行时内保留，不写入家园物件持久化数据。

登记汽车：

```bash
node <skill-dir>/scripts/register-prop.mjs register \
  --game-dir <game-dir> --platform-dir <platform-dir> \
  --id code-example-car --name 示例跑车 --category 载具 \
  --kind code --code example-car --default-scale 1 \
  --vehicle-kind car --enter-radius 3.5 \
  --max-speed 24 --max-acceleration 18 --max-angular-speed 2.8
```

普通代码物件不传入任何 `--vehicle-*` 参数。只要传入一个载具参数，就必须完整传入 `--vehicle-kind`、`--enter-radius`、`--max-speed`、`--max-acceleration` 和 `--max-angular-speed`。

## 物理物件元数据

`physics` 只允许用于非载具 `code` 项，并且目录与模块必须逐字段一致。登记时通过 `--physics-file` 传入 JSON 描述。不得同时传 `--vehicle-*`。

- 顶层精确字段：`body`、`mass`、`friction`、`restitution`、`colliders`。
- `body`: `fixed` 或 `dynamic`。固定体 `mass` 必须为 0；动态体为 0.1–5000 kg。
- `friction`: 0–2；`restitution`: 0–1。
- `colliders`: 1–8 个。固定体可组合多个；当前动态体必须只有 1 个。
- 每个 collider 都必须包含 `shape`、`position`、`rotation`，不得有额外字段。位置分量 -16–16 米，旋转分量 -π–π。
- `box` 额外精确包含 `halfExtents`，每轴 0.05–12 米。
- `ball` 额外精确包含 `radius`，范围 0.05–8 米。
- `capsule` 额外精确包含 `radius` 0.05–4 米和 `halfHeight` 0.05–8 米；胶囊局部轴为 +Y。
- 频道级破坏同步尚未上线，登记器当前拒绝 `breakImpulse`，避免视觉物件仍在但碰撞体已消失。

只允许 primitive collider，禁止从任意渲染 mesh 自动生成碰撞体、trimesh、heightfield 或用户代码直接访问物理世界。载具使用自己的 `vehicle.physics` 能力，不登记顶层 `physics`。
