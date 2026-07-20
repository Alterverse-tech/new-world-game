# 《眠海》平台（WhiteRoom）

> 在人类共享的现实之下，存在一片由全体人类的睡梦沉积而成的意识海洋——眠海。
> 本平台对应的世界事件是：人类第一次获得了清醒地、结伴地潜入眠海，并在其中留下不随醒来而消散的造物的能力。
>
> **核心体验一句话：在眠海中，想象即施工，同行即共梦。**

《眠海》是这套多人共创平台的世界观正名（引擎代号 WhiteRoom，环境变量与文件格式沿用 `WHITEROOM_` / `.wrlevel` 前缀）。这是一个独立 Node.js 后端，负责梦域（关卡）发布、明海（多人大厅）、潜航者形象与自定义 GLB 梦物，并以文件系统持久化，可直接部署在单机、容器或带持久卷的服务器上。

## 世界观 ↔ 产品机制对照

平台的每一项产品机制都在世界观内获得自洽解释（机制先于诗意）：

| 世界观 | 产品机制 | 实现 |
| --- | --- | --- |
| 梦域 | 关卡 / 世界 | `.wrlevel` 包发布 + 多频道大厅 |
| 梦锚（锚在域存） | 内容持久化 | 文件系统存储，创作者离线后内容存续 |
| 潜流 · 愿念 · 凝结 | 生成式 AI 流水线 | prop-creation 任务队列 + Codex worker |
| 沉重律（浮不起来） | 内容安全审核 | 内容校验（413/415/422）与关卡审核拒绝响应携带 `lore` 字段 |
| 图腾 · 凝痕 | 账号身份 · 创作签名 | `/api/dreamsea/totem`，潜意识自凝、他人视角失焦 |
| 念脉 · 回响 · 念种 | 内容哈希溯源 · remix 授权 | `/api/dreamsea/lineage/:hash`、`/api/dreamsea/seeds` |
| 共笔权 | 地块协作权限 | `/api/lobby/plots/:id/coauthors` |
| 浮力法则 · 迷失域 | 热度与自然归档 | 久无人访的梦域沉出海图（registry） |
| 梦境考古 | 归档内容探索 | `/api/dreamsea/abyss` + 打捞（深潜者阶位） |
| 阶位 | 用户成长体系 | 初醒者 → 拾梦人 → 造梦师 → 深潜者 |
| 投影 | 系统管理物件 | realm-system 地标（天堂巨龙 / 地狱钢琴） |
| 标准梦时 | 多人实时同步 | WebSocket / SSE，全海时间钉死于岸上时间 |
| 梦灾 | 限时全服事件 | `/api/admin/dreamsea/calamities` |

三条海律为平台底线：**出口律**（万梦必有出口 = 强制可退出）、**图腾律**（身份不可夺 = 账号与签名体系）、**沉重律**（过于沉重之物浮不起来 = 内容审核）。

## 核心能力

- 梦域（关卡）上传、审核、预览、批准/拒绝与公开海图（Registry）
- 浮力法则：久无人访问的梦域自动沉入迷失域（移出海图不删除），深潜者可考古打捞
- 多频道明海大厅、家园地块、天堂/地狱空间及实时装修同步
- 共笔权：地块主人（梦主）可授予至多 4 位访客域内共同创作权
- WebSocket 多人位置同步、组队与可驾驶物件租约（标准梦时）
- 图腾与凝痕：每位潜航者由潜意识确定性凝成图腾，派生创作签名
- 念脉 / 回响 / 念种：内容哈希溯源谱系、相似内容自动显影原作、remix 授权凭证
- 阶位成长：活动计数驱动初醒者 → 拾梦人 → 造梦师 → 深潜者，深层功能按阶位解锁
- 创作者和账号 Avatar 上传、内容哈希去重与安全校验
- 潜航者自定义 GLB 梦物、权限控制、配额和资源预算
- 潜流（AI）造物流水线：愿念（prompt）→ worker 凝结 → 审核 → 发布
- 原子文件写入、限流、SSE、Cookie 身份与重启恢复

## 环境要求

- Node.js 20+
- npm
- 可写的持久化数据目录

## 快速启动

```bash
npm install

WHITEROOM_PORTAL_TOKEN='creator-secret-at-least-16-bytes' \
WHITEROOM_ADMIN_TOKEN='admin-secret-at-least-16-bytes' \
WHITEROOM_DATA_DIR='/var/lib/whiteroom-platform' \
HOST='127.0.0.1' \
PORT='8787' \
npm start
```

`WHITEROOM_PORTAL_TOKEN` 和 `WHITEROOM_ADMIN_TOKEN` 必须存在、互不相同，且至少 16 字节。生产环境请通过密钥管理、容器 Secret 或 systemd `EnvironmentFile` 注入，不要提交到仓库。

服务启动后可访问：

```text
GET /healthz
```

## 主要配置

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` | 监听地址 | `127.0.0.1` |
| `PORT` | 服务端口 | `8787` |
| `WHITEROOM_DATA_DIR` | 持久化数据目录 | 必填 |
| `WHITEROOM_PORTAL_TOKEN` | 创作者上传令牌 | 必填 |
| `WHITEROOM_ADMIN_TOKEN` | 管理员审核令牌 | 必填 |
| `WHITEROOM_CORS_ORIGIN` | 允许的跨域来源 | `*` |
| `WHITEROOM_DREAMSEA_SECRET` | 图腾/凝痕派生密钥 | 由大厅密钥派生 |
| `WHITEROOM_DREAMSEA_SINK_AFTER_MS` | 浮力法则下沉时限 | 30 天 |
| `WHITEROOM_DREAMSEA_SINK_PATROL_MS` | 沉没巡查间隔 | 10 分钟 |

大厅、Avatar、SSE、WebSocket 和上传接口均支持独立的限流、容量与并发环境变量；完整变量名和默认值以 `src/` 中的配置读取逻辑为准。

## API 概览

### 眠海世界观

除 `worldview` 与 `lineage` 为公开只读外，眠海身份端点都要求先访问一次 `GET /api/lobby/identity` 获取身份 Cookie（「接入潜航协议」），并纳入大厅限流。

- `GET /api/dreamsea/worldview`：层带、三条海律、潜航协议、阶位表、术语表、标准梦时与进行中的梦灾
- `GET /api/dreamsea/totem`：本人图腾（初次调用即「初次下潜」自动凝成；确定性、不可转让）
- `GET /api/dreamsea/totems/:ownerId`：他人图腾——永远失焦，仅露出凝痕（签名）
- `GET /api/dreamsea/journey`：本人旅程计数、当前阶位与下一阶位进度
- `GET /api/dreamsea/lineage/:hash`：一件造物的念脉（原凝者凝痕、回响列表、念种数）
- `POST /api/dreamsea/seeds`：原凝者（须造梦师阶位）向他人授出念种（remix 授权）
- `POST /api/dreamsea/dive`：显式下潜打点，为梦域续浮力（沉没梦域返回 409）
- `GET /api/dreamsea/abyss`：迷失域中的沉没梦域列表（须深潜者阶位）
- `POST /api/dreamsea/abyss/:levelId/salvage`：打捞沉没梦域，重新浮上海图（须深潜者阶位）
- `POST /api/admin/dreamsea/calamities`：管理员宣告梦灾（限时事件）
- `POST /api/admin/dreamsea/sink-patrol`：手动触发一次沉没巡查

阶位门槛（默认）：拾梦人 = 任意活动 ≥ 3；造梦师 = 凝结成形 ≥ 1；深潜者 = 凝结成形 ≥ 3 且 活动 ≥ 10。活动包括下潜、凝结梦物、互动、投锚（认领地块）、许愿等。

### 梦域（关卡）

- `POST /api/levels`：上传 `.wrlevel` 梦域包
- `GET /api/levels/:id/status`：查询审核状态（被拒绝时响应携带沉重律 `lore`）
- `/api/admin/levels/*`：管理员列表、详情、预览、批准和拒绝
- `GET /registry.json`：公开海图（仅漂浮中的已批准梦域；沉没者见迷失域 API）
- `GET|HEAD /levels/:id/*`：读取已发布梦域文件（加载梦域主文档 `level.json` 视为一次到访、续浮力；已沉没梦域不因静态访问上浮，须经打捞）

### Avatar（梦身）

- `POST /api/avatars`：创作者上传 Avatar
- `GET|POST /api/account/avatars`：账号私人 Avatar 库
- `GET /api/avatars`：公开 Avatar Registry
- `GET|HEAD /avatars/:avatarId/avatar.glb`：读取模型

### 明海大厅（多人）

- `GET /api/lobby/catalog`：梦物目录与世界约束
- `GET /api/lobby/state`：频道状态（地块含 `coAuthors` 共笔名单）
- `GET /api/lobby/events`：SSE 实时变更
- `/api/lobby/objects/*`：凝结、调整、移除和互动梦物
- `/api/lobby/plots/*`：认领、更新和释放家园地块
- `POST /api/lobby/plots/:plotId/coauthors`：梦主授予共笔权（body：`{"coAuthorId": "owner-…"}`）
- `DELETE /api/lobby/plots/:plotId/coauthors/:ownerId`：梦主撤回共笔，或受共笔者自行退出
- `/api/lobby/assets/*`：潜航者 GLB 梦物管理（上传即入念脉；相同字节的重凝自动记为回响）
- `/api/lobby/multiplayer`：WebSocket 多人同步

频道支持保留前导零的 4–12 位数字，以及 `space-<数字频道>-heaven|hell`。权限、请求结构和边界限制由服务端严格校验。

### 潜流（AI 造物）

- `GET /api/account/prop-creations/config`：功能开关与限额
- `POST /api/account/prop-creations`：提交愿念（prompt ≤ 600 字）
- `/api/worker/prop-creations/*`：worker 认领、进度、完成与发布回报
- `/api/admin/prop-creations/*`：管理员审核（沉重律裁定）

## 数据与安全

默认数据包括梦域包、审核记录、`registry.json`（海图）、大厅状态、Avatar、大厅梦物与 `dreamsea/`（图腾、旅程、念脉、浮力、梦灾）。部署与备份时必须持久化整个 `WHITEROOM_DATA_DIR`，尤其不要覆盖或删除 `lobby/`、`avatars/`、`lobby-assets/` 和 `dreamsea/`。

上传内容会检查 ZIP 路径、文件规模、关卡 Schema、脚本危险能力以及 GLB/glTF 结构与资源预算。自动校验不能替代人工试玩和内容审核——沉重律的最终裁量权在管理员。

图腾由服务端密钥对 ownerId 确定性派生并持久化：请妥善保管 `WHITEROOM_DREAMSEA_SECRET`（或其上游 `WHITEROOM_LOBBY_OWNER_SECRET` / `WHITEROOM_ADMIN_TOKEN`），密钥轮换不会改变已凝成的图腾（记录以首次凝成为准）。

## 测试

```bash
npm test
```

测试覆盖鉴权、梦域审核、持久化、多频道大厅、SSE、多人同步、Avatar、GLB 安全校验、权限和容量限制，以及眠海层：图腾确定性与失焦视图、阶位进阶与深度门槛、念脉/回响/念种、浮力法则下沉与打捞、共笔权授予/撤回、梦灾声明与消散、沉重律 lore。

## 部署提醒

- 使用 Nginx 或负载均衡器终止 TLS，并正确转发 SSE 与 WebSocket。
- 审核后台和预览 API 保持同源；管理员令牌不要写入 URL、日志或浏览器存储。
- 根据上传文件上限配置反向代理请求体大小，并关闭 SSE 响应缓冲。
- 单机共享文件系统可使用当前实现；跨主机扩容应改用集中式数据库、对象存储和分布式锁。

## License

Private project.
