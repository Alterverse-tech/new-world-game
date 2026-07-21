# 纯几何关卡配方

使用 `sdk.THREE` 的 Box、Cylinder、Sphere 与 StandardMaterial，避免导入任何包。

## 跑酷

- 平台宽度至少 1.4m；普通跳跃水平间距控制在 2–4m。
- 每 30–60 秒预期路程放一个 checkpoint。
- goal zone 放在有碰撞地面上，避免玩家穿过却未触发。

## 收集

- required 与实际 collectible 数一致；每个 id 唯一。
- 用高度、色彩和空间标签让收集品从出生点附近可读。
- 最后一个收集品不能依赖已经不可逆关闭的路径。

## 谜题与逃脱

- 每个清单 flag 都必须有一条可达的设置路径。
- 逃脱出口在 flags 完成前可以可见，但应明确表现为锁定。
- 提供空间标签、材质变化或 toast 反馈，避免“按了但不知道”。

## 生存与清除

- 生存关必须有可读的安全空间和公平预警，不在 spawn 立即造成伤害。
- target 的可交互距离合理，最后一个 target 不得藏在碰撞体内部。

## 性能

- 重复几何优先复用 Geometry/Material；大批量对象考虑 InstancedMesh。
- 只启用一盏投射阴影的灯；其余使用环境光或无影灯。
- 避免每帧创建 Vector、Geometry、Material 或闭包。
