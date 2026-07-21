---
name: whiteroom-lobby-prop
description: Create, validate, register, test, and prepare deployment of collaborative WhiteRoom lobby props. Use when a user asks Codex to make大厅家具、装饰、灯具、摆件、可交互 Three.js 纯代码物件、可驾驶汽车或飞机、GLB 模型，或把物件加入 WhiteRoom 多人大厅仓库与装修目录。
---

# WhiteRoom Lobby Prop

把一句物件描述转换为安全、可拖放的 WhiteRoom 大厅目录项。终端机是系统物件，永远不得修改、登记、移动或删除。

## 自动玩家任务

当任务来自玩家创作队列、包含 `jobId`、说明由本机 Codex Worker 执行，或要求结构化候选输出时，必须先读取 `references/automated-player-jobs.md`。该参考中的 code-only、修改白名单、禁止联网/上传/部署和结构化输出约束优先于下面的普通人工工作流。

## 工作流

1. 定位游戏目录与平台目录。默认分别查找 `work/whiteroom` 和 `work/whiteroom-platform`；找不到时询问路径。
2. 读取 `references/catalog-schema.md`，确认仓库路径、命名和预算。
3. 选择唯一实现路线：
   - 简单几何、发光、循环动画或轻交互：选择 `code`。
   - 需要斜坡、可推动箱体、球体或胶囊碰撞：选择受审核的 `code` 物理物件描述；复杂动态复合碰撞体暂不支持。
   - 可驾驶汽车或飞机：选择受审核的 `code` 载具能力，同时配置模块物理参数与目录服务器包络。
   - 需要清晰轮廓、家具造型或复杂表面：选择 `glb`。
4. 实现物件，运行登记脚本，再执行游戏 lint、测试和构建。
5. 在真实 WhiteRoom 大厅装修模式中拖入物件，检查落地、缩放、旋转、选择、同步和 fallback。
6. 汇报修改与本地结果。部署会影响所有玩家，生产发布前必须取得用户明确确认。

## Code 路线

读取 `references/code-prop-api.md`。从 `assets/code-prop.template.ts` 复制并创建：

`<game-dir>/src/lobby-props/generated/<code-key>.ts`

运行时只静态导入 `three`；为类型标注可使用 `import type ... from '../types'`。不得访问网络、DOM、浏览器存储、动态执行或终端机对象。将普通物件交互限制为物件内部的视觉变化。

登记：

```bash
node <skill-dir>/scripts/register-prop.mjs register \
  --game-dir <game-dir> --platform-dir <platform-dir> \
  --id <catalog-id> --name <中文名> --category <分类> \
  --kind code --code <code-key> --default-scale 1
```

### Code 载具

实现 `LobbyPropModule.vehicle` 和可选的 `updateLobbyVehicleVisual`，并严格使用 +Z 为车头/机头方向。详细锚点、物理参数、多人租约和安全边界见 `references/code-prop-api.md`；目录元数据精确字段和范围见 `references/catalog-schema.md`。

```bash
node <skill-dir>/scripts/register-prop.mjs register \
  --game-dir <game-dir> --platform-dir <platform-dir> \
  --id code-roadster --name 协作公路跑车 --category 载具 \
  --kind code --code roadster --default-scale 1 \
  --vehicle-kind car --enter-radius 3.5 \
  --max-speed 24 --max-acceleration 18 --max-angular-speed 2.8
```

不得将用户上传的 JavaScript 直接在大厅执行。载具模块必须先进入受信任源码仓库并通过静态校验；人工工作流继续人工审核，自动玩家工作流则必须通过父 Worker 的独立 smoke、资源预算、完整测试/构建和原子发布门禁，再登记到平台允许列表。

### Code 物理物件

从 `assets/physics-prop.template.ts` 复制。模块和平台目录必须导出完全相同的 `physics` 数据；只允许 `fixed` / `dynamic` 刚体和 `box` / `ball` / `capsule` primitive collider。运行时负责创建 Rapier 刚体，模块本身不得导入或访问 Rapier。

先把目录描述写成 JSON 文件，再登记：

```bash
node <skill-dir>/scripts/register-prop.mjs register \
  --game-dir <game-dir> --platform-dir <platform-dir> \
  --id code-example-ramp --name 示例斜坡 --category 物理组件 \
  --kind code --code example-ramp --default-scale 1 \
  --physics-file /absolute/path/example-ramp.physics.json
```

固定体可由最多 8 个 primitive collider 组合。当前动态体只能声明 1 个 collider；需要多块联动物理结构时，拆成多个独立目录物件。频道级破坏同步尚未上线，因此登记器当前会拒绝 `breakImpulse`。

登记成功时脚本会生成 `src/lobby-props/approved-modules.ts` 显式导入清单；大厅运行时只执行这个清单中的模块，不会 eager 执行 `generated/` 里的登记失败残留文件。静态 AST 检查会拒绝 DOM、网络、存储、动态执行、计时器、构造器逃逸和 Three.js 资源加载入口，但它不是 JavaScript 沙箱；不得仅凭登记脚本结果发布代码物件。人工工作流需要源码审核，自动玩家工作流需要 `references/automated-player-jobs.md` 定义的父级发布门禁。

## GLB 路线

使用 `$shark-game-assets` 生成 1–3 个必要模型；必须先确认 `GAME_ASSETS_API_TOKEN`。以 `asset_manifest.json` 为权威来源，并保留纯几何 fallback。GLB 必须位于：

`<game-dir>/public/generated-assets/<id>.glb`

登记：

```bash
node <skill-dir>/scripts/register-prop.mjs register \
  --game-dir <game-dir> --platform-dir <platform-dir> \
  --id <catalog-id> --name <中文名> --category <分类> \
  --kind glb --asset-url /generated-assets/<id>.glb --default-scale 1
```

## 校验与测试

```bash
node <skill-dir>/scripts/register-prop.mjs check \
  --game-dir <game-dir> --platform-dir <platform-dir>

cd <game-dir>
npm run lint
npm test
npm run build
```

必须检查最新 Playwright 截图与 `render_game_to_text()`：新物件可拖入大厅，远端状态可同步，终端机不出现在可编辑对象中。物理物件还要检查碰撞体数量、动态刚体数量、车轮接触和 CCD diagnostics；载具至少实测平地、斜坡、碰撞、翻车扶正、下车与双浏览器占用同步。GLB 加载失败时必须显示 fallback。

## 输出

返回物件 ID、路线、源文件或 GLB、目录登记结果、测试结果和是否已部署。不要声称仅登记到本地的物件已在线。
