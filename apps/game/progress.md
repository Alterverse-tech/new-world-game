Original prompt: 用three.js实现一个高精度的直升机，玩家可以驾驶直升机；随后用户确认“部署吧”。

## 2026-07-16

- 建立 v27/v18 隔离候选；目录严格为现网 9 项加 `code-precision-rescue-helicopter`。
- 删除未授权的 Roadster、Skywing、physics-crate、physics-ramp 模块。
- 接入 server-authoritative `vehicle-lease-v1` 与 `flightModel: rotorcraft`。
- 模型验收：118 meshes、8,340 triangles、主尾旋翼/驾驶员/灯光/下洗动画，根变换不漂移。
- 游戏 169/169 单测、TypeScript、ESLint 与 production build 通过；CSS 和共享依赖块与 v26 完全一致。
- 本地 E2E 首次发现测试物件在 spawn protected zone，已改到 `(3, 0, 4.2)`。
- 本地 E2E 第二轮确认双客户端 `vehicle-lease-v1` 握手稳定；随后发现测试物件虽在进入半径内，但位于初始镜头侧方，未通过视线交互门槛。位置已改为 `(0, 0, 1.5)`，兼顾出生保护圈、4.2 m 权威进入半径与初始 -Z 视线。
- 完整驾驶链已跑到起飞、前飞、转向、同步与空中 E 禁退；同一 Chromium 进程内截图会冻结驾驶端超过 4 秒并触发正确的租约超时。已将两名玩家拆为两个独立浏览器进程，使观察端截图不阻塞驾驶端续租。
- 完整双浏览器驾驶 E2E 通过：独占租约、起飞/悬停/前飞/双向偏航、观察端同步、空中禁退、两种下降键、落地退出与测试物件清理均符合预期。
- 通用 Playwright action client 额外跑过两轮短输入；画面、`render_game_to_text`、固定系统终端状态均正常，无 console/page error。
- 装修目录近景预览、桌面驾驶与移动端布局均已目视检查；高精度直升机完整可辨，界面无溢出或异常着色。
- 远端预检通过固定 v26/v17 基线、36 文件清单、四个改动平台核心文件哈希、临时服务启动、目录与协议校验。
- 已原子切换到游戏 `20260716-whiteroom-ugc-v27-rescue-helicopter` 与平台 `20260716-whiteroom-platform-v18-rescue-helicopter`，受保护数据备份已校验。
- 首次提交后烟测的 Node 20 DNS `all` 回调和显式频道断言有误；安全闸门按设计停止 Nginx。前向修复完成后，首页、历史资源、安全头、目录与公网 WebSocket 均通过，未发生数据回滚。
- 公网测试改用真实浏览器时钟后完整通过：两人独占租约、3.72 m 起飞、前飞、左右偏航/侧倾同步、空中禁退、Shift/C 下降、落地退出、远端 Avatar 恢复，且无浏览器错误或旧协议。
- 六个独立公网测试频道均确认 `objects: []`、`plots: []`；平台与 Nginx active，平台错误日志为空。

TODO: none.

## 2026-07-16 · 空闲载具恢复装修能力

Current prompt: 修复直升机无法编辑、删除或缩放的问题，并修改生产环境。

- 根因已确认：编辑器用 `runtimeVehicles.has(objectId)` 代替真实占用状态；服务器保留 `driverId: null` 的停车姿态后，空闲直升机被永久误判为运行中。
- 生产环境已前进到游戏 v31 / 平台 v22；本次候选严格基于精确匹配线上哈希的 persistent-space + sync-controls 源码，不覆盖或回退持久天堂/地狱空间。
- 正确语义确定为：空闲停车载具可移动、旋转、缩放和删除；有人驾驶或服务器自动降落/恢复期间仍锁定。
- 服务端将为物件 PATCH/DELETE 增加载具 mutation reservation，关闭编辑与上车竞态；空闲 PATCH 协调停车姿态，DELETE 清理运行态，并向已连接客户端广播全量载具快照。
- 客户端已按 `driverId` 而非“存在运行快照”判断锁定；拖拽和旋转即时合入空闲停车姿态，纯缩放保留停车坐标，删除清理对象与运行快照。
- 新增严格 `vehicle_snapshot` 客户端协议分支，只替换载具集合，不会误清远端玩家或本地驾驶租约。
- 平台已用完整 `channel:objectId` mutation lock 闭合 PATCH/DELETE 与上车竞态；驾驶、租约、恢复/自动降落期间返回 `409 lobby_vehicle_in_use`，写锁期间上车返回 `vehicle_busy`。
- 空闲载具编辑新增失败回滚：PATCH 失败会恢复服务器确认的持久变换与真实停车运行姿态；拖动途中被其他玩家占用也会丢弃未保存移动。回滚用客户端权威 runtime generation 判定，不会因新驾驶 lease 的 `seq` 从 0 重开而覆盖新停车位置；网络失败、中途占用和跨 lease 低序号释放竞态单测均通过。
- 装修相机移除 X/Z 的旧 `±54 m` 限制，保留有限数值防护与 Y 轴合理范围；远距离落地后的玩家可在原地进入装修并从画面直接选择直升机。
- 游戏全量测试 204/204、平台全量测试 117/117、ESLint、TypeScript、生产构建与 WhiteRoom 11 项目录检查均通过。
- 最终完整发布树双浏览器 E2E 通过：5.2 秒驾驶渲染暂停不释放租约；飞行超过旧高度/水平边界；D/A 方向正确；单次 E 自动落地并随飞机落地后出舱；占用时 PATCH/DELETE 均返回 `409 lobby_vehicle_in_use`；远处释放后未经重置即由驾驶者进入装修、画面选中、缩放和旋转且停车位置不跳回；随后重置回归继续验证拖动、删除、双端严格全量快照与零浏览器错误。
- 通用 Playwright 客户端在最终发布树进入 `HUB_EDIT`，状态显示水平无界、多人和装修同步正常，无 console/page error；远处可编辑与删除后截图已目视检查。

- 最终包已封签为游戏 `20260716-whiteroom-ugc-v32-idle-vehicle-editing` / 平台 `20260716-whiteroom-platform-v23-idle-vehicle-editing`；远端临时服务预检通过持久化重启、异常恢复、历史静态资源合并和测试频道缺席门禁。
- 已原子切换生产并完成公网真实双浏览器全链路，19 项检查与 7 张截图全部通过；生产公开入口/主包哈希分别为 `a5a4360a...` / `09dd2eae...`。
- 公网测试频道 `7616071694` 已删除并在平台重启后确认为 revision 0、0 objects、0 plots 且目录不存在；`0000` 保持 revision 286、15 objects、2 plots，六个受保护数据根在清理前后无额外变化。
- Nginx 与平台服务 active，健康检查正常，部署后 error 级平台日志为 0；受保护数据备份 SHA-256 为 `0361b6cd2125c7f95aadd253da1d2b0d5ef54b87fa02bf2f976c0d1bb1549e18`。

TODO: none.

## 2026-07-16 · 天堂 / 地狱持久空间前向修复

Current prompt: 做一扇任意门，玩家穿越后进入天堂或地狱；目的地不是关卡，而是独立空间，空间状态必须持久化；部署生产。

- 已确认 v29/v20 错把天堂/地狱实现为 `LevelDefinition`，带目标、计时与完成判定。
- v30/v21 采用按来源大厅隔离的协作空间：`space-<origin>-heaven|hell`；同大厅玩家共享，其他大厅不串数据。
- 客户端进入空间时保持 `currentLevel=null` 和 HUB/HUB_EDIT 壳层，复用大厅编辑器与多人同步；返回门为不可编辑的本地系统物件。
- 天堂/地狱已移出 `levels.ts`；空间状态文本明确输出持久频道与返回频道；跌落回入口，不进入失败/结算。
- 编辑器空间模式不加载街区、终端或家园认领 UI。
- 任意门两扇门叶按准星本地选择天堂/地狱，避免共享 interaction sequence 迫使不同玩家轮流去不同空间。
- 游戏 193/193 单测、TypeScript、ESLint 与 production build 全部通过；平台 111/111 测试通过。
- 通用 Playwright action client 在完整发布树上完成两轮短输入，`render_game_to_text` 正常且无 console/page error。
- 双客户端持久空间 E2E 通过：两人进入同一天堂、物件创建和旋转实时同步、离开后重进仍保留；地狱使用独立频道且两边物件不串；最终原大厅、天堂、地狱对象集合均恢复基线。
- 已目视检查任意门、天堂和地狱关键截图；转场白幕截图时钟问题已在验收脚本中修复并复跑通过。
- 同一数据目录停止并重启平台进程后，`space-98160719-heaven` 的 revision 1 物件完整回读；随后删除至 revision 2 / 0 objects，确认是磁盘持久化而非内存假象。

- 吸收并保留现行多人载具同步控制基线后，最终版本提升为游戏 v31 / 平台 v22；游戏 194/194、平台 114/114 测试通过。
- 远端只读预检、临时服务验证、受保护数据备份与回滚演练全部完成。首次正式尝试由安全闸门在提交前停止并完整回滚；确认差异仅为平台启动合法刷新两个注册表的顶层 `generatedAt` 后，闸门仅对这两个精确字段做语义归一化，其余内容继续失败关闭。
- 已原子发布游戏 `20260716-whiteroom-ugc-v31-persistent-spaces-sync-controls` 与平台 `20260716-whiteroom-platform-v22-persistent-spaces-sync-controls`；Nginx、平台服务和内部健康检查均正常。
- 公网双玩家持久空间 E2E 通过：同一天堂实时同步、重进保留、天堂/地狱隔离、地狱重进保留和返回原大厅全部成功，浏览器错误为 0。
- 生产测试来源频道及两个空间的 3 个测试物件均已删除，三个精确测试目录已移除；平台重启后确认为 revision 0 且目录不存在。生产 `0000` 保持 revision 283、15 个物件与 2 块领地。
- 受保护数据备份 SHA-256：`d483cb02d4e7bdabc5416f274793c978293eb6197f34d1b6337ce3a2bf4f8fa5`。

TODO: none.

## 2026-07-17 · 大厅物件自动发布与历史记录

Current prompt: 之后玩家创建的大厅物件不再等待人工审核，可信父 Worker 校验通过后直接发布；审核后台继续保留全部历史记录。

- 游戏端已识别 `publicationMode: automatic`，展示自动发布中、已发布与发布失败状态；旧人工批准记录继续兼容。
- 平台自动发布状态机、发布阶段租约、断线续发、失败回滚记录与后台历史视图已完成首轮实现。
- 前向隔离演练创建“棱镜脉冲信标”，登记检查、游戏 lint/215 项测试/构建、平台 125 项测试通过；未上传或部署。
- 安全审查发现自动执行候选测试、宿主秘密边界、stale writer、canonical 原子推广等上线阻断，正在修复；生产仍保持 v34/v25。
- 平台现已全局串行领取生成/发布任务，并让发布租约在反复断线后持续进入可对账恢复状态；全量 126 项测试通过。
- 本机隔离 PoC 确认官方 Codex permission profile、清空继承环境、独立假 HOME 与非 `/tmp` 专用任务根可阻断真实 HOME、父进程环境、钥匙串和网络，同时保留任务目录内读写；旧 `workspace-write` 不再作为秘密边界。
- 游戏自动发布客户端在隔离候选中再次通过 ESLint、215 项测试和生产构建；生产环境仍未修改。
- 平台改为可信父 Worker 校验通过后直接进入 `publishing → building → deploying → verifying → published`；管理员不再需要批准自动任务，后台“AI 物件创作记录”继续保留候选包、Codex 任务、成功版本、哈希、失败与回滚历史，并兼容旧人工批准记录。
- 自动模式提交时，旧 `pending_review` 只计入历史、不再占用玩家的新创作名额；`queued/running` 仍维持每用户并发上限。发布阶段续租接口现在返回不可变 artifact SHA-256，进程重启后可与本机 schema-3 状态精确对账。
- 候选执行已切到最小权限 Codex profile、空秘密环境、假 HOME/TMP、只读 canonical source 和精确四文件 allowlist；静态注册器拒绝 DOM/网络/动态执行、构造器逃逸、Three.js Loader、计算属性与动态下标，并已用真实 12 项目录及恶意下标夹具双向验证。
- 本机 canonical 采用不可变版本目录、base CAS、原子 current pair、崩溃 journal、严格回滚身份、fsync 与保留集；候选测试文件只留审计包，不进入后续可信游戏测试。
- AWS 父发布器与人工全量部署共用 `/tmp/whiteroom-full-deploy.lock`，不预停在线服务；紧邻切链前再次核验 current 版本及完整内容哈希。明确的切链前失败记为 `failed_pre_activation`，切链后恢复旧版记为 `failed_rolled_back`，不确定断线继续对账；失败/回滚 target release 有界清理，但 transaction、history、marker 永久保留。
- 远端完整故障注入 19/19 通过：双链接部分切换、服务启动失败、断电、历史复制中断、人工第三版本竞争、原地内容篡改、压缩包预算、自动回滚与长期清理均符合预期。
- 最终验证：游戏 ESLint、215/215 测试和生产构建通过；平台 127/127 通过；Worker 非远端 58/58、远端 19/19 通过；Skill 12 项目录检查及恶意夹具拒绝通过。官方 Playwright 客户端进入频道 `0000`，大厅、多人与自动售卖机画面正常，无 console/page error。
- 玩家提示已改为“安全校验后自动合并、构建并部署”；生产环境仍保持 v34/v25，本轮没有上传、切链或启用生产开关。

TODO:

- 得到用户明确回复“确认部署自动发布版本到生产”后，组装无 symlink 的 v35/v26 初始 release、安装受限远端发布器、切换新版 LaunchAgent，并启用 `WHITEROOM_PROP_AUTO_PUBLISH=1`。

## 2026-07-18 · 钢琴 / 巨龙持久空间游戏端回归

- 全量 Vitest 通过：22 个测试文件、238/238；包含钢琴音频持久播放 offset、地狱钢琴场景、天堂/地狱持久空间、骑乘巨龙与大厅编辑器回归。
- ESLint 以 `--max-warnings=0` 通过；`tsc --noEmit` 与 Vite production build 通过。
- 本轮无源码修复；仅有 Vite 对主包超过 500 kB 的既有体积提示，不影响构建成功。

## 2026-07-18 · 地狱钢琴与天堂骑龙持久空间

Current prompt: 地狱改为漆黑水面、礁石、燃火的高精度黑色三角钢琴与自动演奏；天堂改为云海和可骑乘操控的飞龙；两个目的地继续是服务器持久化空间，完成后自动部署生产。

- 已在 v35/v26 精确生产基线上建立隔离候选 v36/v27；保留自动发布 Worker 与全部既有大厅/持久空间语义。
- 地狱场景、原创空间钢琴合成音频、授权同源替换钩子、天堂云海、可骑乘龙和服务器托管地标已接入。
- 天堂龙停车姿态与地狱钢琴播放交互均写入对应 `space-<origin>-heaven|hell` 频道；地标不可被普通玩家创建、删除或篡改。
- 生产前进至 v36/v27 后，已将 v35→v36 的 6 个游戏端源文件变更与新增 Howl's Moving Castle E2E 精确三方合并；保留持久空间、钢琴与巨龙改动。
- 合并后游戏全量 240/240、ESLint 零警告、TypeScript 和 production build 通过；主包为 `index-ByHF_KJs.js`。
- 真实浏览器发现龙自动降落后偶发停在 `awaiting-release`；已增加 6 秒服务器 `vehicle_recover` 兜底，并在所有成功发送 release 的路径重置等待起点，避免普通载具运行超过 6 秒后立即误触发 recovery。
- 已增加 6 秒边界单测，并接入不可重定义、每次返回新快照的 `window.__THREE_GAME_DIAGNOSTICS__` 只诊断 getter；本轮全量 241/241、lint、TypeScript 和 production build 全部通过，主包为 `index-vBwj6tDW.js`。
- 正在执行完整单测、真实浏览器交互、视觉/性能审核与生产 CAS 预检。

TODO:

- 完成实机浏览器测试、视觉/性能门禁、生产原子部署与公网烟测。

## 2026-07-18 · 地狱白图验收门禁

- 多轮 `hell-isolated-from-heaven.png` 经像素核对为 100% `#fff`，不是地狱场景过暗；独立频道 9362 在相同构建中确认地狱 WebGL、HUD、画布尺寸与渲染统计正常，普通截图及 CDP 截图均可见且无浏览器错误。
- 根因范围收敛到完整双页长链里的白色转场层 / 陈旧合成面截图竞态；旧验收只检查 `screen-fade.active` class，且不会拒绝已写入的纯白证据。
- 持久空间 E2E 截图现为失败关闭：目标页置前、等待转场层计算透明度降至 0.01 以下、刷新两帧合成面，并对截图做无依赖的浏览器内缩采样；近乎全白仅重绘重试一次，仍为白图则直接失败。
- 频道 9363 已穿过天堂、骑龙、返回、地狱与钢琴播放，桌面地狱截图恢复可见且浏览器错误为 0；目视复核同时发现移动端 resize 会在手动时钟下清空画布、只留下接近白色的页面底色和 HUD。截图器现会在每次 capture 前调用 `advanceTime(0)` 强制重绘，并额外拒绝高亮低色差占比过高的近白帧；旧纯白图和旧移动端空画布均会失败，新地狱有效画面不会误判。
- 最新构建在独立频道 9365 的短链地狱入场截图可见完整钢琴轮廓、黑水与礁石，浏览器错误为 0；9363 长链随后在创建测试用地狱光立方时等待 POST 超时，与本次截图修复无关，需由最终完整 E2E 复跑确认。

## 2026-07-18 · 天堂 / 地狱持久空间最终本地门禁

- 冻结频道 9370 的完整双玩家 E2E 为 `ok:true`：两个目的地保持 HUB 且无 currentLevel，服务器持久频道生效，Bob 实时看见天堂装修变换，天堂/地狱隔离与双方重进恢复均通过。
- 巨龙完成骑乘、飞行、安全停车并持久化；钢琴交互和演奏权威时间线持久化；来源大厅、天堂和地狱的 3 个临时物件均以 HTTP 200 清理，最终只保留系统托管巨龙/钢琴。
- 13 张冻结截图全部通过近白/空画布失败关闭检查并完成目视核对；桌面/移动均能看见完整骑乘巨龙和燃焰钢琴，browser console/page errors 为 0。
- canonical 像素指标已写入 `evidence/local-qa-artifacts/release-gate-frozen/pixel-metrics.json`；renderer 峰值为 225 calls、113,326 triangles、189 geometries、8 textures、DPR 1，落在记录预算与巨龙移动端例外内。
- 独立 fresh-eyes 最终评分 46/100：性能证据 8/10，但世界稀疏、地狱入场可读性、通用矩形 HUD 和移动底栏密度使其明确不达到 Premium/AAA；本次仅作功能与持久空间发布，不作 Premium 声明。
- 最终隔离重跑：游戏 242/242、ESLint 零警告、TypeScript/Vite build 通过；平台 130/130。主包为 `index-C4bZ867h.js`（1,219.17 kB，gzip 341.06 kB）。

TODO:

- 完成候选封签、生产 CAS、Worker 迁移、原子部署、公网双玩家 E2E、服务健康与测试数据 absence proof。
