# 通关条件

每关只声明一种类型。内建类型由 Shell 判定；只有 `custom` 可调用 `sdk.state.complete()`。

| 类型 | 适用玩法 | `winCondition` 必填 | 引擎判定 |
|---|---|---|---|
| `reach_zone` | 跑酷、迷宫、竞速 | 无 | 玩家进入 `goal: true` 的 trigger zone |
| `collect` | 收集、探索 | `required`，整数 ≥1 | 收集计数达到 required |
| `puzzle` | 开关、顺序、密码 | `flags`，非空且不重复 | 所有 flag 为 true |
| `survive` | 躲避、防守 | `duration`，秒数 >0 | 未失败并存活指定时间 |
| `eliminate` | 打靶、清机关 | 无 | 所有注册 target 被关闭 |
| `escape` | 密室逃脱 | `flags`，非空且不重复 | flags 全满足后进入 goal zone |
| `custom` | 新机制 | 清单需 `objectiveDetail` | 关卡代码显式调用 `sdk.state.complete()` |

所有类型可加 `timeLimit`（超时整关重置）与 `parTime`（只用于评价）。

## 设计硬规则

- `objective` 是玩家看到的一句话目标，不超过 30 个中文字符。
- 出生点脚下必须有碰撞体，2 米内不得有 hazard。
- 关卡必须有非空 `solution.md`，描述从出生到通关的真实路径。
- 默认死亡后保留 collect、puzzle、eliminate 进度；超时重置整关。
- 关卡不得阻止长按 R 重置或暂停菜单返回 Hub。
- 建议 1–15 分钟；高难跑酷段之后设置 checkpoint。
