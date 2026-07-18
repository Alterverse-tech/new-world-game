# WhiteRoom Platform

WhiteRoom 的独立 Node.js 后端，负责 `.wrlevel` 关卡发布、多人大厅、玩家形象与自定义 GLB 资产。服务使用文件系统持久化数据，可直接部署在单机、容器或带持久卷的服务器上。

## 核心能力

- 关卡上传、审核、预览、批准/拒绝与公开 Registry
- 多频道大厅、家园地块、天堂/地狱空间及实时装修同步
- WebSocket 多人位置同步、组队与可驾驶物件租约
- 创作者和账号 Avatar 上传、内容哈希去重与安全校验
- 玩家自定义 GLB 资产、权限控制、配额和资源预算
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

大厅、Avatar、SSE、WebSocket 和上传接口均支持独立的限流、容量与并发环境变量；完整变量名和默认值以 `src/` 中的配置读取逻辑为准。

## API 概览

### 关卡

- `POST /api/levels`：上传 `.wrlevel` 关卡包
- `GET /api/levels/:id/status`：查询审核状态
- `/api/admin/levels/*`：管理员列表、详情、预览、批准和拒绝
- `GET /registry.json`：公开已批准关卡
- `GET|HEAD /levels/:id/*`：读取已发布关卡文件

### Avatar

- `POST /api/avatars`：创作者上传 Avatar
- `GET|POST /api/account/avatars`：账号私人 Avatar 库
- `GET /api/avatars`：公开 Avatar Registry
- `GET|HEAD /avatars/:avatarId/avatar.glb`：读取模型

### 多人大厅

- `GET /api/lobby/catalog`：物件目录与世界约束
- `GET /api/lobby/state`：频道状态
- `GET /api/lobby/events`：SSE 实时变更
- `/api/lobby/objects/*`：创建、更新、删除和交互
- `/api/lobby/plots/*`：认领、更新和释放家园地块
- `/api/lobby/assets/*`：玩家 GLB 资产管理
- `/api/lobby/multiplayer`：WebSocket 多人同步

频道支持保留前导零的 4–12 位数字，以及 `space-<数字频道>-heaven|hell`。权限、请求结构和边界限制由服务端严格校验。

## 数据与安全

默认数据包括关卡包、审核记录、`registry.json`、大厅状态、Avatar 和大厅资产。部署与备份时必须持久化整个 `WHITEROOM_DATA_DIR`，尤其不要覆盖或删除 `lobby/`、`avatars/` 和 `lobby-assets/`。

上传内容会检查 ZIP 路径、文件规模、关卡 Schema、脚本危险能力以及 GLB/glTF 结构与资源预算。自动校验不能替代人工试玩和内容审核。

## 测试

```bash
npm test
```

测试覆盖鉴权、关卡审核、持久化、多频道大厅、SSE、多人同步、Avatar、GLB 安全校验、权限和容量限制。

## 部署提醒

- 使用 Nginx 或负载均衡器终止 TLS，并正确转发 SSE 与 WebSocket。
- 审核后台和预览 API 保持同源；管理员令牌不要写入 URL、日志或浏览器存储。
- 根据上传文件上限配置反向代理请求体大小，并关闭 SSE 响应缓冲。
- 单机共享文件系统可使用当前实现；跨主机扩容应改用集中式数据库、对象存储和分布式锁。

## License

Private project.
