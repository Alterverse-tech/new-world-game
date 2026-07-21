---
name: whiteroom-level-kit
description: 为 WhiteRoom（白房间）Three.js 游戏创建、修改、试玩、校验、打包并发布 UGC 关卡。只要用户提到 WhiteRoom、白房间、.wrlevel、白房间关卡、给白色房间游戏做关卡、用一句话生成关卡、上传或投稿关卡，就必须使用本 skill；覆盖 reach_zone、collect、puzzle、survive、eliminate、escape 与 custom 玩法。
---

# WhiteRoom Level Kit

把一句关卡点子变成可试玩、可审核的 `.wrlevel` 包，并在用户确认后上传 WhiteRoom 平台。始终保留软重置和返回 Hub 的逃生路径。

## 必守流程

1. 读取 `references/win-conditions.md` 与 `references/sdk-api.md`，把点子归入唯一一种 `winCondition.type`。从用户原话提炼不超过 30 个中文字符的 `objective`；只有类型或目标实质不明确时才追问。
2. 从脚手架开始，禁止徒手新建清单：

   ```bash
   node <skill-dir>/scripts/create-level.mjs --dir <目标目录> --name "<关卡名>" --author "<署名>" --type <类型> --objective "<目标>"
   ```

3. 编辑生成的 `main.js`、`level.json` 和 `solution.md`。遵守 `references/level-json.md`；只使用 `sdk`，不得导入 Three.js 或访问浏览器/网络全局。
4. 需要可辨识的角色、敌人、载具、Boss 或关键道具，且用户希望具象模型时，调用 `shark-game-assets` 生成 1–3 个 GLB，放入 `assets/`；始终保留 primitive fallback。纯几何关卡直接使用 `sdk.THREE`。
5. 每个高难段后放检查点；出生点 2 米内不放 hazard；保证脚下有碰撞体；任何状态都能长按 R 重置。
6. 启动真实 Shell 试玩：

   ```bash
   node <skill-dir>/scripts/dev.mjs --level <关卡目录>
   ```

   使用浏览器完成一次从出生到引擎判定通关的全流程；检查 `render_game_to_text()` 与控制台错误。不要只看静态代码就声称可完成。根据实测更新 `solution.md`。
7. 校验并打包；有错误必须修复后重跑：

   ```bash
   node <skill-dir>/scripts/validate.mjs --dir <关卡目录>
   node <skill-dir>/scripts/pack.mjs --dir <关卡目录> --out <输出目录>
   ```

8. 上传是唯一远程写操作。即使用户最初说“做完上传”，也要在真正执行上传前展示关卡名、最终 ID 和校验结果，并获得明确确认。确认后运行：

   ```bash
   WHITEROOM_PORTAL_URL="${WHITEROOM_PORTAL_URL:-https://whiteroom.174-129-74-70.sslip.io}" \
   WHITEROOM_PORTAL_TOKEN="$WHITEROOM_PORTAL_TOKEN" \
   node <skill-dir>/scripts/publish.mjs publish --dir <关卡目录> --confirmed
   ```

9. 返回 `levelId`、`status` 与审核链接。`pending` 表示已上传但尚未进入公共随机池，不得描述成已经上线。

## 选择通关类型

- 抵达终点或跑酷：`reach_zone`
- 捡齐物品：`collect`
- 完成若干开关/谜题：`puzzle`
- 撑过倒计时：`survive`
- 清除全部目标：`eliminate`
- 完成旗标后抵达出口：`escape`
- 以上都无法准确表达，且代码必须自行判定：`custom`

查看每种类型的权威判定与必填字段：`references/win-conditions.md`。查看几何关卡配方：`references/patterns/geometry.md`。

## 发布与故障处理

先读取 `references/publishing.md`。不得把发布令牌写进关卡、日志、截图或提交包。缺少 `WHITEROOM_PORTAL_TOKEN` 时停止上传并请用户配置创作者令牌；仍可完成生成、试玩、校验和打包。

`401` 更换令牌；`413` 减小资源；`422` 按服务端错误修复并重新校验；网络错误或 `409` 使用完全相同的包重试，不要重新生成内容。
