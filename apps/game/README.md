# WhiteRoom · 白房间

可直接静态部署的第一人称 3D 网页游戏 MVP。技术栈为 Vite、TypeScript 与 Three.js，构建产物位于 `dist/`。

## 本地运行

```bash
npm install
npm run dev
```

质量检查与生产构建：

```bash
npm run lint
npm test
npm run build
```

## 操作

- `WASD` 移动，鼠标观察，`Shift` 冲刺，`Space` 跳跃
- `E` 向音乐自动贩卖机投币选关，或与谜题机关和归返之门交互
- `V` 在大厅切换第一/第三人称；第三人称下用鼠标滚轮或触控板上下滚动拉近/拉远；`B` 进入共同装修；`P` 随时打开形象衣柜
- 装修时自动进入创造飞行：`WASD` 水平移动，`Space` 上升，`Shift`/`C` 下降，`Ctrl` 加速，按住鼠标右键拖动观察
- `Esc` 暂停或返回，长按 `R` 1 秒重置当前关卡，`F` 切换全屏

## 游戏闭环

从白房间走近会播放音乐的自动贩卖机并按 `E` 投币，即可从三个官方世界中选一罐出发：跑酷 `reach_zone`、收集 `collect`、谜题 `puzzle`。投币时音乐和灯光同步开始，但不会阻塞单人或同行闯关操作；面板可随时重播音乐。通关后归返之门提供“返回桌面”或“继续漫游”两个明确选择。设置、最近游玩、潜入次数和通关记录保存在浏览器 `wr.save.v1` 本地存档中。

自动化可通过 `window.render_game_to_text()` 读取当前权威状态，通过 `window.advanceTime(ms)` 以 60Hz 固定步长推进模拟。

## 3D 素材流水线

正式入口是客户端以纯 Three.js 几何搭建的音乐自动贩卖机，机身、罐装世界、投币动画和灯光编排均随游戏代码发布；歌曲由 WebAudio 实时合成，不依赖外部音频文件，因此离线静态资源可用时即可完整选关和播放。

历史资产 `public/assets/terminal.glb` 仅为旧版本兼容文件，当前运行时不再请求或加载它。大厅协议与既有存档仍保留内部对象 ID `system-terminal`，只用于兼容旧客户端和服务端保护规则；用户看到的对象始终是固定音乐自动贩卖机，且不可移动、缩放或删除。

多人大厅物件仓库包含 4 个静态 GLB：`glb-lounge-chair`（云朵休闲椅）、`glb-pedestal-lamp`（环光落地灯）、`glb-luminous-plant`（微光盆栽）和 `glb-yellow-sports-car`（黄色跑车）。权威清单位于 `asset_manifest.json`，运行文件位于 `public/generated-assets/`。这些模型不含动画 clips；加载后通过 `THREE.Box3` 统一缩放、水平居中并把底部落在 y=0。每个 GLB 槽位都保留独立的纯几何 fallback，模型缺失不会阻断大厅装修。

多人大厅提供 2 个可直接选择的角色：墨羽旅人和云朵人偶；旧“探索者”不再是可选角色，旧空 Avatar ID 会自动迁移到墨羽旅人。两个预置都是同源真实 GLB，衣柜通过单个共享 WebGL 画布显示缓慢旋转的 3D 预览，不为每张卡片额外创建渲染上下文。客户端用 `THREE.Box3` 把模型统一到 1.75 米并落地；没有有效 WASD 输入时保持自然站立，只有 W/A/S/D 或斜向净输入非零时才播放走跑动画。模型加载期间只使用无角色身份的中性灰色骨架替身，不会恢复旧“探索者”。

大厅第三人称将鼠标镜头方向与角色朝向分离：W/S/A/D 及斜向输入让角色平滑面朝实际移动方向，静止时保留最后朝向，并把同一朝向同步给其他玩家。镜头以归一化 1.75 米 Avatar 的身体中心为固定焦点，默认使用约 2.45 米的高位轨道距离；滚轮/触控板可在 1.75–5.5 米间连续缩放并记住选择，“减少动态效果”开启时会立即到位，否则约 0.2 秒平滑过渡。碰撞检测沿身体中心到镜头的射线自动收近，极近时隐藏自身模型。无论缩放、镜头俯仰、墙体收镜或屏幕宽高比如何，角色身体中心都保持在画面中央。

## 大厅多人联机

首次进入前需要确认一个 4–12 位纯数字频道号（保留前导 `0`，原公共大厅为 `0000`）。只有相同频道的玩家会收到彼此的物件状态、在线人数、角色姿态与同行邀请；成功进入后 URL 会保留 `?channel=<号码>` 便于分享，但刷新后仍需主动点击进入。

普通大厅与装修大厅通过同源 `/api/lobby/multiplayer` WebSocket 交换 10Hz 玩家姿态；打开音乐贩卖机选关界面时仍留在自己的大厅频道，方便发起同行邀请。单人进入后会离开大厅频道，同行进入后则切换到队伍隔离频道，结束后返回原频道；在大厅暂停或打开形象衣柜时仍保持在线。远端玩家使用插值移动，并显示浮动昵称。第三人称镜头用大厅碰撞体做射线距离裁剪，避免穿入固定音乐贩卖机或装修物件；正式关卡始终保持第一人称。

进入共同装修后会自动切换到独立的创造飞行相机。相机限制在与大厅权威空间一致的 X/Z ±18 米、Y 0.75–8 米，可自由飞到大厅上方布置物件；它不修改玩家实体位置、玩家朝向或多人 pose。退出装修时恢复进入前的第一/第三人称玩家镜头。同一频道的所有成员对普通物件拥有相同权限，可以共同选择、拖动、旋转、缩放和删除；`createdBy/updatedBy` 只用于审计。固定音乐贩卖机仍无法被选中或修改（协议内继续使用 `system-terminal`）。

装修目录中的 Code 与 GLB 卡片都使用物件本体的实时 3D 缩略图并缓慢旋转。整个目录共用一个按可见区域裁切的低功耗 WebGL 预览器，不为每张卡创建独立上下文；关闭装修、切到后台或离开可见区域时会暂停或释放资源，GLB 加载失败则显示明确的可旋转替代模型。

大厅和装修模式中可点击 HUD 的“更换形象”或按 `P` 打开实时衣柜；点击预置角色或“我的角色”会立即本地换装并以 latest-wins 合并同步给其他玩家，不改变当前大厅/装修状态。已登录邮箱账号可直接选择不超过 8 MiB 的自包含 glTF 2.0 `.glb`，先在本地显示真实 3D 预览，再上传到私人角色库并自动换装。服务端使用账号 HttpOnly 会话授权，严格校验 GLB 结构、内嵌贴图、骨骼/动画与复杂度预算，每账号默认最多 10 个角色。自定义代码仍只有在同源 `/api/avatars/<id>` 验证成功后才会写入 `wr.save.v1`；`?avatar=<id>` 链接也继续可用。

## 静态部署

`npm run build` 后将 `dist/` 整体部署到任意静态 Web 服务。Vite 使用 `base: './'`，可部署在域名根路径或子目录。生产服务器应将未知静态资源保持为 404，并为 `index.html` 设置合理的缓存策略。

## 动态 UGC 运行时

启动时 Shell 从同源 `/registry.json` 读取 `levels`，只接纳 `status: "approved"` 且 ID 合法的条目，并与三个官方世界合并。条目至少应提供：

```json
{
  "id": "my-world-a1b2c3",
  "status": "approved",
  "name": "我的世界",
  "author": { "name": "creator" },
  "path": "/levels/my-world-a1b2c3",
  "hash": "content-hash",
  "winCondition": { "type": "reach_zone" },
  "objective": "抵达发光区域"
}
```

进入社区关时，Shell 加载 `/levels/<id>/level.json`，校验 `schema: "wr-level"`、`schemaVersion: 1`、`engineApi: "1"`、spawn、entry、内容分级及通关条件，再以 `main.js?v=<registry hash>` 动态导入。加载或运行异常会隔离该关，并安全返回白房间。

本运行时支持七种通关条件：`reach_zone`、`collect`、`puzzle`、`survive`、`eliminate`、`escape`、`custom`。内建类型由 Shell 判定；`state.complete()` / `state.win()` 仅对 `custom` 生效。

可用 Level SDK v1 子集：

- `sdk.THREE`，以及仍可作为原生 `THREE.Group` 使用的 `sdk.scene`
- `scene.addBox/addCylinder/addSphere/addText`
- `physics.addCollider`
- `helpers.triggerZone/goalZone/collectible/button/pressurePlate/target`
- `interact.register`
- `state.setFlag/getFlag/complete/win/fail`
- `player.spawn/teleport/setCheckpoint/getPosition`
- `env.setBackground/setFog/addSun/setAmbient`
- `objective.set/updateProgress`、`ui.toast/subtitle`、确定性 `random`

Level Kit 本地预览可打开 `/?devLevel=<id>`，注册表加载后音乐自动贩卖机会将该关设为唯一候选。
