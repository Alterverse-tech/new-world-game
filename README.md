# WhiteRoom 轻门户后端

一个面向 WhiteRoom `.wrlevel` 关卡包的独立 Node.js 服务。它不依赖现有游戏前端，使用文件系统持久化不可变关卡包、审核记录和原子生成的 `registry.json`。

同一服务还提供按频道隔离的公开协作大厅 API。普通大厅频道是保留前导零的 4–12 位纯数字；它的两个持久空间频道只允许规范形式 `space-<普通大厅频道>-heaven` 与 `space-<普通大厅频道>-hell`。数字大厅包含中央公共区和 72 个可连续拼接的玩家家园地块：公共区普通装饰物由频道成员共同编辑；每名签名匿名身份可以认领多块地，地块内物件只有领主可以添加或修改。天堂/地狱空间没有家园地块，整个合法边界都是共享公共空间，所有对象的 `plotId` 恒为 `null`；空间拒绝全部 plot claim/update/release 请求，只保留出生/返回门保护圈，不应用数字大厅的终端保护圈。保留频道 `0000` 直接沿用旧版 `lobby/state.json`，确保新旧版本切换或回滚时不会遗漏编辑；包括持久空间在内的其他频道都原子保存到 `lobby/channels/<channel>/state.json`。游戏电脑、终端和系统物件不属于可编辑状态，相关 `catalogId` 会被拒绝。旧数据中的禁用 ID 或保留区物件会在启动时移除。

大厅还提供同源 WebSocket 多人位置同步，以及由创作者令牌或已登录邮箱账号上传的自定义 GLB 玩家形象。形象以 SHA-256 内容哈希去重并保存到 `avatars/`，不会覆盖已经发布的模型；同一个物理模型可以归入多个账号的私人形象库。服务启动时重新校验记录、模型哈希、GLB 安全预算、账号归属索引并重建公开 registry。

## 运行

要求 Node.js 20 或更高版本。

```bash
npm install
WHITEROOM_PORTAL_TOKEN='creator-secret' \
WHITEROOM_ADMIN_TOKEN='different-admin-secret' \
WHITEROOM_DATA_DIR='/var/lib/whiteroom-platform' \
HOST='127.0.0.1' PORT='8787' npm start
```

两个令牌必须存在、互不相同且各至少 16 字节；生产环境应使用高熵随机值，并由密钥管理或 systemd `EnvironmentFile` 注入，不要写进仓库。`WHITEROOM_CORS_ORIGIN` 默认为 `*`，需要限制来源时可设为游戏站点的 Origin。

大厅默认对每个 `clientId` 限制为每分钟 30 次写入、每个来源 IP 每分钟 120 次写入。可以分别通过 `WHITEROOM_LOBBY_RATE_CLIENT`、`WHITEROOM_LOBBY_RATE_IP` 和 `WHITEROOM_LOBBY_RATE_WINDOW_MS` 调整。SSE 心跳默认 15 秒，可通过 `WHITEROOM_LOBBY_HEARTBEAT_MS` 调整；SSE 同时最多 500 条连接、每个来源 IP 最多 8 条连接，分别由 `WHITEROOM_LOBBY_SSE_MAX_TOTAL` 和 `WHITEROOM_LOBBY_SSE_MAX_PER_IP` 调整。服务仅在反向代理来自本机回环地址时读取代理 IP 头，并优先使用由 Nginx 覆写的 `X-Real-IP`。

空频道只读访问不会创建文件或永久占用内存；首次成功写入才创建频道状态。数字大厅及其派生天堂/地狱空间分别计入频道容量。内存中默认最多保留 512 个频道的 LRU 状态，持久频道默认最多 10,000 个，分别可用 `WHITEROOM_LOBBY_CHANNEL_MAX_LOADED` 与 `WHITEROOM_LOBBY_CHANNEL_MAX_PERSISTED` 调整。

Avatar 默认最多保存 1000 个模型、合计最多 512 MiB，每个邮箱账号最多归属 10 个；分别通过 `WHITEROOM_AVATAR_MAX_COUNT`、`WHITEROOM_AVATAR_MAX_TOTAL_BYTES` 与 `WHITEROOM_AVATAR_MAX_PER_OWNER` 调整。相同哈希的重复上传不重复占用全局数量或磁盘配额，但会安全加入当前账号的私人形象库。创作者 Bearer 上传按来源 IP 和创作者凭证限速，账号上传按来源 IP 和账号限速；默认每分钟 10 次，可通过 `WHITEROOM_AVATAR_UPLOAD_RATE_MAX` 和 `WHITEROOM_AVATAR_UPLOAD_RATE_WINDOW_MS` 调整。账号 GLB 最多同时验证 2 个，可通过 `WHITEROOM_AVATAR_UPLOAD_MAX_CONCURRENT` 调整。

大厅玩家 GLB 资产默认每个签名 owner 最多 20 条/128 MiB，全局最多 5000 条/512 MiB；分别由 `WHITEROOM_LOBBY_ASSET_MAX_PER_OWNER`、`WHITEROOM_LOBBY_ASSET_MAX_BYTES_PER_OWNER`、`WHITEROOM_LOBBY_ASSET_MAX_RECORDS`、`WHITEROOM_LOBBY_ASSET_MAX_TOTAL_BYTES` 控制。相同 owner 的相同内容幂等返回原记录；不同 owner 会获得独立的 128-bit 随机 ID 和权限记录，但物理 GLB blob 按 SHA-256 去重。上传默认每个 owner/IP 每小时 5 次、全服务每小时 20 次，并最多同时验证 2 个文件；可用 `WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_MAX`、`WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_GLOBAL`、`WHITEROOM_LOBBY_ASSET_UPLOAD_RATE_WINDOW_MS`、`WHITEROOM_LOBBY_ASSET_UPLOAD_MAX_CONCURRENT` 调整。失败和幂等上传也计入频率。

多人大厅默认总计最多 200 条 WebSocket、每个来源 IP 最多 6 条，通过 `WHITEROOM_MULTIPLAYER_MAX_TOTAL` 和 `WHITEROOM_MULTIPLAYER_MAX_PER_IP` 调整。心跳默认 20 秒，可通过 `WHITEROOM_MULTIPLAYER_PING_INTERVAL_MS` 调整。可驾驶物件租约默认 4 秒、服务端自动降落步进默认 50ms，分别通过 `WHITEROOM_MULTIPLAYER_VEHICLE_LEASE_MS` 与 `WHITEROOM_MULTIPLAYER_VEHICLE_RECOVERY_TICK_MS` 调整；飞机恢复在正常高度保留速度/加速度下降，极高的任意有限高度会自适应加速，并在 25 秒恢复上限内接地释放。每条连接最多接收 1 KiB 的消息、每秒 30 条消息和 15 个有效 pose。profile 使用容量 6、每 400ms 恢复 1 次的令牌桶；超额更新会收到带 `retryAfterMs` 的 `profile_rate_limited` 并被忽略，但不会断开连接。未知 Avatar ID 会安全回退为 `null`。

审核预览凭证默认 5 分钟过期，可通过 `WHITEROOM_PREVIEW_TTL_SECONDS` 调整为 1–900 秒。生产环境必须从 HTTPS 访问审核后台，因为预览凭证只写入带 `Secure`、`HttpOnly`、`SameSite=Strict` 的路径限定 Cookie。

## API

- `GET /healthz`：健康检查。
- `POST /api/levels`：`Authorization: Bearer <upload-token>`，multipart 中恰好一个 `.wrlevel` 文件。成功保存为 `pending`。
- `GET /api/levels/:id/status`：查询 `pending | approved | rejected` 和审核时间/拒绝原因。
- `GET /api/admin/levels?status=pending&limit=50&offset=0`：管理员 Bearer token；列出待审关卡。`status` 可为 `pending | approved | rejected | all`，默认 `pending`，单页最多 100 条。
- `GET /api/admin/levels/:id`：管理员 token；返回完整 `manifest`、大小/哈希信息和经过 1 MB 上限检查的 `solutionMd`。
- `POST /api/admin/levels/:id/preview-token`：管理员 token；仅为 `pending` 关卡签发短时效预览凭证。响应包含 `{ previewUrl, previewBaseUrl, expiresAt }`，凭证本身保存到 HttpOnly Cookie。
- `GET|HEAD /api/admin/preview/:id/*`：受预览 Cookie 保护的待审包文件读取路由，使用 `private, no-store`，不提供跨域访问。Cookie 与关卡 ID、包哈希和到期时间绑定；关卡批准、拒绝、内容变化或凭证过期后立即失效。
- `POST /api/admin/levels/:id/approve`：使用独立管理员 Bearer token 批准 pending 关卡。
- `POST /api/admin/levels/:id/reject`：管理员 token，JSON 请求体 `{ "reason": "..." }`。
- `GET /registry.json`：只包含 `approved` 关卡；条目含前端所需的 `status`、`description`、`objective`、`winCondition`、封面、路径和内容哈希。
- `GET|HEAD /levels/:id/*`：只直出 `approved` 关卡；内容使用不可变缓存头。

### 玩家形象 Avatar

- `POST /api/avatars?name=<显示名>&author=<作者>`：复用创作者 `Authorization: Bearer <upload-token>`；multipart 中必须恰好有一个文件名以 `.glb` 结尾的文件。单文件上限 8 MiB。
- `GET /api/account/avatars`：仅接受当前站点已登录邮箱账号的签名 `HttpOnly` 会话 Cookie，返回该账号的私人形象库 `{ schemaVersion, avatars }`。响应为 `private, no-store`、`Vary: Cookie`，不会返回 owner ID。
- `POST /api/account/avatars`：仅接受当前站点已登录邮箱账号和同源请求；multipart 必须恰好包含文件字段 `file` 以及文本字段 `name`、`author`。新模型返回 `201`，全局相同 SHA-256 的模型加入当前账号后返回 `200` 且 `deduplicated: true`。账号上传使用严格 GLB 校验，但允许合法的 skin、骨骼与动画。
- `GET /api/avatars`：公开 registry，结构为 `{ schemaVersion, generatedAt, avatars }`。
- `GET /api/avatars/:avatarId`：公开单个 Avatar 元数据。
- `GET|HEAD /avatars/:avatarId/avatar.glb`：公开不可变模型；返回 `model/gltf-binary`、一年 immutable 缓存、以内容哈希作为 `ETag`。

上传成功时新模型返回 `201`，相同 SHA-256 的幂等上传返回 `200`。响应固定为：

```json
{
  "avatarId": "neon-runner-0123456789abcdef",
  "name": "Neon Runner",
  "author": "creator",
  "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "avatarUrl": "/avatars/neon-runner-0123456789abcdef/avatar.glb",
  "launchUrl": "/?avatar=neon-runner-0123456789abcdef",
  "deduplicated": false
}
```

`avatarId` 由安全化名称和哈希前缀组成，不接受客户端指定，因此相同内容不会生成多个可变地址。公开 registry/元数据还包含 `bytes`、`uploadedAt` 和经过服务端验证的 `stats`（节点、mesh、primitive、顶点、三角形、贴图、骨骼、动画及 required extensions 等）。

Avatar GLB 必须使用 glTF 2.0、JSON 后最多一个 BIN chunk，并把所有 buffer/image 嵌入文件；`buffers[].uri` 和 `images[].uri`（包括 data URI）都被拒绝。默认安全预算为 256 nodes、64 meshes、256 primitives、1024 accessors/bufferViews、300 万 accessor elements、128 materials/textures/samplers、64 images、32 scenes/animations、每类 256 animation channels/samplers、16 skins、256 joints、50 万 vertices/triangles、150 万 indices、128 morph targets 和 200 GPU instances。PNG/JPEG/WebP 会按实际嵌入字节校验签名、容器结构与尺寸；PNG 还校验 chunk CRC 和解压后扫描线大小。每张图单边不超过 2048px，单个 Avatar 的总解码像素不超过 8,388,608。校验还拒绝 node 自环/有向环/多父节点、非根 scene node，以及明显无效的 texture、sampler、image、material、animation、skin 和 accessor 引用。Avatar 禁止携带任何 camera 或 `KHR_lights_punctual` 场景灯；需要外部 decoder 或客户端未内置支持的 required extension 也会被拒绝，例如 `KHR_draco_mesh_compression`、`EXT_meshopt_compression` 与 `KHR_texture_basisu`。数量配额满返回 `507 avatar_capacity_reached`，总字节配额满返回 `507 avatar_storage_capacity_reached`。

### 大厅多人联机

WebSocket 只接受精确路径，规范频道与玩家资料通过查询参数传入：

```text
/api/lobby/multiplayer?channel=<4-12位数字或space-数字-heaven|hell>&clientId=<8-64位ID>&avatarId=<ID或空>&name=<显示名>
```

浏览器必须发送与请求 Host、外部协议一致的 `Origin`；服务通过可信回环代理提供的 `X-Forwarded-Proto` 识别 HTTPS。连接成功后协议如下：

- 服务端 `welcome`：`{ "type":"welcome", "selfId":"...", "channel":"lobby:001234", "lobbyChannel":"001234", "features":["vehicle-lease-v1","vehicle-autoland-v1","persistent-space-v1"], "players":[player...], "vehicles":[vehicle...] }`。空间连接分别使用例如 `channel:"lobby:space-001234-heaven"` 与 `lobbyChannel:"space-001234-heaven"`。
- 服务端 `join` / `profile`：`{ "type":"join|profile", "player":player }`。
- 客户端 pose 必须精确为 `{ "type":"pose", "x":0, "y":0, "z":0, "yaw":0, "moving":false }`，不接受未知字段。
- 服务端 pose 为 `{ "type":"pose", "id":"...", "x":0, "y":0, "z":0, "yaw":0, "moving":false, "seq":1, "timestamp":0 }`；`seq` 和毫秒时间戳由服务端赋值。
- 客户端 profile 必须精确为 `{ "type":"profile", "name":"...", "avatarId":"...或null" }`；`null` 清除自定义形象。`preset-ink-chibi` 与 `preset-cloud-doll` 是随游戏发布的预置形象 ID，会直接保留并广播对应同源资源地址；其他未知但格式正确的 ID 回退为 `null`。
- 服务端 leave：`{ "type":"leave", "id":"..." }`。
- 客户端申请驾驶：`{ "type":"vehicle_enter", "objectId":"..." }`；成功时服务端发送含 `leaseId` 与权威 `vehicle` 快照的 `vehicle_entered`，并向大厅广播 `vehicle_claimed`。正在驾驶或自动恢复中的物件会返回 `vehicle_busy`。
- 驾驶客户端以最多 15 次/秒发送精确 schema 的 `vehicle_state`：除 `type/objectId/leaseId/seq` 外包含 `x/y/z/yaw/pitch/roll/vx/vy/vz`。服务端校验租约、递增序号、有限数字以及相邻状态的速度、加速度、位移和角速度后广播权威快照；异常状态返回 `vehicle_state_rejected` 并进入恢复流程。
- 正常离开使用 `{ "type":"vehicle_exit", "objectId":"...", "leaseId":"...", "seq":2 }`。飞机必须先由客户端降至 `y <= 0.15` 且总速度不超过 `1.25`，否则返回 `vehicle_exit_rejected` 并保留驾驶关系。
- 空闲载具通过大厅对象接口移动或旋转后，服务端会对齐其停放姿态；只改缩放不会把停放位置拉回旧坐标。成功编辑或删除会向同频道广播严格的 `{ "type":"vehicle_snapshot", "vehicles":[...] }` 全量运行快照。
- 飞行中的租约超时、状态丢失或连接断开会触发服务端 `vehicle_recovery`；该消息及后续 `vehicle_state` 在接地前都保留原 `driverId` 并只在恢复快照中加入 `recovering:true`。正常高度按飞机速度/加速度平滑下降，极高的任意有限高度使用每帧仍为有限数的自适应曲线，最迟在 25 秒恢复上限时接地、停稳并回正。随后才广播向后兼容的 `vehicle_released`：外层 `driverId` 是原驾驶者，`vehicle.driverId` 为 `null`，且不携带 `recovering`；正常 `vehicle_exit` 的飞机最终帧同样严格归零 `y/pitch/roll`。断线玩家仍正常从玩家列表移除。恢复起因 `state_loss` 只用于 `vehicle_recovery`，最终释放映射为旧协议可识别的 `timeout`。恢复中的快照也会出现在后来加入者的 `welcome.vehicles` 中。服务关闭时不会在空中伪造最终释放帧，而是先清理租约/恢复计时器再断开连接，让客户端执行断线安全降落；新服务进程从持久化的地面摆放状态重新建立运行时快照。

`player` 结构为 `{ id, name, avatarId, avatarUrl, pose }`，`vehicle` 结构为 `{ objectId, catalogId, kind, driverId, x, y, z, yaw, pitch, roll, vx, vy, vz, seq, timestamp }`。大厅与持久空间玩家位置没有固定坐标边界，但所有坐标必须是有限数字；进入关卡后仍使用原协议 `x/z -40..40`、`y -2..12`。飞机状态要求有限且 `y >= 0`，不设水平或正高度上限，实际移动仍受逐步运动校验约束；装修物件仍限制在 `x/z -54..54`、`y 0..8`。`yaw` 始终为 `-π..π`。玩家快照、join、pose、profile、leave 和组队邀请只会发给完全相同的 `lobby:<channel>`；同一来源大厅的天堂、地狱，以及不同来源大厅的同名空间都彼此隔离。闯关结束后回到该玩家原来的频道。已有在线连接占用的 `clientId` 不能被另一条连接接管，升级请求会返回 `409 multiplayer_client_in_use`；页面重载应先关闭旧 socket，再使用同一 ID 重连。总消息频率越界及 schema/边界错误以 WebSocket code `1008` 关闭；profile 超过令牌桶容量时只忽略该次更新并返回 `profile_rate_limited`，连接保持在线；单纯超过 15 pose/s 时多余 pose 被丢弃并发送一次 `pose_rate_limited`。服务执行 ping/pong 活性检查，并在客户端发送缓冲超过 64 KiB 时断开慢连接。

### 多人装修大厅

- `GET /api/lobby/catalog`：取得公开物件目录及服务端边界。目录源文件是 `src/lobby-catalog.json`。
- `GET /api/lobby/state?channel=<channel>`：取得该频道的完整大厅快照。
- `GET /api/lobby/events?channel=<channel>&clientId=<client-id>`：该频道的 SSE 实时流；连接后发送 `snapshot`、频道内 `presence`，持续发送频道内 `change`、对应的 `object.* | plot.claimed | plot.updated | plot.released` 事件和 `heartbeat`。超过总连接或单 IP 上限时在建立流之前返回 `429 lobby_sse_connection_limit`。
- `POST /api/lobby/objects?channel=<channel>`：向该频道添加一个目录物件。
- `PATCH /api/lobby/objects/:id?channel=<channel>`：更新该频道对象的一个或多个 transform 字段，采用 last-write-wins。
- `DELETE /api/lobby/objects/:id?channel=<channel>`：删除该频道内有权限的普通物件。
- `POST /api/lobby/objects/:id/interactions?channel=<channel>`：提交该频道的权威交互状态。
- `POST /api/lobby/plots/:plotId/claim?channel=<channel>`，请求体 `{ "nickname":"玩家昵称" }`：认领空地块。

`<channel>` 只接受 4–12 位数字，或由数字来源大厅派生的 `space-<origin>-heaven|hell`；不做大小写、空白或路径形式的宽松规范化。任意门目录元数据使用精确数据结构 `{ kind:"space", destinations:[{ id, label, spaceId }] }`，其中 `spaceId` 只能是 `heaven` 或 `hell` 且必须等于 `id`。目录不会携带 `levelId`、`stateChannel` 或可执行入口；客户端以当前数字来源大厅和 `spaceId` 派生状态频道。

### 玩家上传大厅 GLB 资产

- `GET /api/lobby/assets`：使用大厅签名 `HttpOnly` owner Cookie 返回当前玩家的私人目录 `{ "schemaVersion":1, "assets":[...] }`。无 Cookie 时只签发身份；GET 不创建任何资产记录或 registry 文件。响应为 `private, no-store`、`Vary: Cookie`，不开放跨域读取。
- `POST /api/lobby/assets`：要求已有有效 owner Cookie和同源请求。`multipart/form-data` 必须恰好包含文件字段 `file`（文件名以 `.glb` 结尾）、文本字段 `name`（1–40 字符）、`category`（1–20 字符），可选 `defaultScale`（0.25–3，默认 1）。新记录返回 `201 { asset, deduplicated:false }`，同 owner 同内容返回 `200 { asset, deduplicated:true }`。
- `GET /api/lobby/assets/:id`：同源公开解析一个仍在目录中的资产，响应 `{ asset }`。公开字段只有 `id/name/category/kind/assetUrl/defaultScale`，不会泄露 owner ID、原始文件名或内容哈希。
- `GET|HEAD /lobby-assets/:id/model.glb`：同源模型读取；返回 `model/gltf-binary`、`Cross-Origin-Resource-Policy: same-origin`、5 分钟 `must-revalidate` 缓存和 ETag，并支持 `If-None-Match`/304，便于未来下架未审核模型。

用户资产 ID 固定为 `user-glb-` 加 32 位小写随机 hex（128 bit），不能由内容、昵称或 owner 枚举推导。只有资产 owner 能用该 `catalogId` 新建大厅实例；其他玩家即使看到 ID 也会收到 `403 lobby_asset_permission_denied`。现有实例继续遵循公共区/家园编辑权限。每频道同一上传资产最多 20 个实例、全部上传资产最多 40 个实例、不同上传资产最多 20 种；超限分别返回 `lobby_asset_instance_limit`、`lobby_asset_channel_limit`、`lobby_asset_channel_unique_limit`。频道还对真实客户端成本执行聚合预算：按不同资产 URL 统计的 GLB 总字节最多 60 MiB、解码纹理最多 16,777,216 像素，按每个实例累计的 rendered vertices/triangles 各最多 500,000；超过任一预算返回 `lobby_asset_channel_resource_limit`。四项预算可分别用 `WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_BYTES`、`WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_TEXTURE_PIXELS`、`WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_VERTICES`、`WHITEROOM_LOBBY_CHANNEL_ASSET_MAX_RENDERED_TRIANGLES` 调整。系统 `src/lobby-catalog.json` 没有任何写接口，上传资产保存在独立 `lobby-assets/` 数据目录。

单个文件最多 15 MiB，必须是自包含 glTF 2.0 GLB，JSON 后最多一个 BIN chunk；buffer/image 外链和 data URI 全部拒绝。大厅 v1 禁止 camera、灯光、音频 emitter、动画、skin、morph target 和 GPU instancing，拒绝未知扩展及 Draco/meshopt/KTX2 等需要额外 decoder 的扩展。定义预算为 128 nodes、32 meshes、64 primitives、512 accessors/bufferViews、32 materials、16 textures/images/samplers、8 scenes、100,000 vertices、150,000 indices、50,000 triangles、500,000 accessor elements和 4,194,304 解码纹理像素。WebP 只允许一个 VP8/VP8L 图像帧，每个帧在解析时立即校验尺寸，不接受用后续小帧覆盖前一个超大帧。平台还从显式或缺省的默认 scene 根节点展开可达 `node.mesh`，重复 mesh 引用会重复计入渲染成本；展开后最多 128 rendered meshes/primitives、100,000 rendered vertices 和 50,000 rendered triangles。校验同时限制 JSON 深度/条目/字符串，要求整棵 JSON 的数值有限且在安全数量级内，并限制 node transform、实际 POSITION 浮点值和 index 范围；只接受 TRIANGLES mode、float VEC3 POSITION 与嵌入的 unsigned index。默认场景会逐层计算 affine world matrix，累计变换或世界坐标出现非有限值、非 affine 矩阵或超过安全矩阵范围时直接拒绝。
- `PATCH /api/lobby/plots/:plotId?channel=<channel>`，请求体 `{ "nickname":"新昵称" }`：领主更新昵称。
- `DELETE /api/lobby/plots/:plotId?channel=<channel>`，请求体 `{}`：领主释放没有物件的地块。

`clientId` 是浏览器生成并持久保存的匿名 ID，必须为 8–64 位字母、数字、下划线或连字符。添加请求严格使用以下结构，不接受未知字段：

```json
{
  "clientId": "browser-7e9129c4",
  "catalogId": "code-glow-cube",
  "position": { "x": 1.5, "y": 0, "z": -2 },
  "rotationY": 0,
  "scale": 1
}
```

更新请求必须包含 `clientId`，并至少包含 `position`、`rotationY`、`scale` 之一；删除请求体为 `{ "clientId": "browser-7e9129c4" }`。权限身份以服务端签名的 `HttpOnly` 大厅 Cookie 为准，客户端提交的 `clientId` 不会授予领地权限。世界根范围为 `x/z: -54..54`、`y: 0..8`，但物件锚点只能位于中央闭区间 `abs(x), abs(z) <= 15`，或一个 12×12 家园地块内；相邻地块同样采用 12m 中心间距，因此彼此无空隙，可以连成连续建造范围。公共区与家园之间的缓冲区及外围边界不能摆放。72 个地块按 ring 2–4、12m 中心间距，从西北角顺时针稳定编号为 `plot-001` 至 `plot-072`，完整中心和边界可从 `catalog.constraints.plotLayout.slots` 读取。布局边界使用 `1e-6` 容差；共享边界按稳定编号顺序归入最先匹配的地块。Y 轴旋转范围是 `-π..π`，缩放范围是 `0.25..3`，大厅最多保存 200 个物件。`catalog.constraints.protectedZones` 还定义两个 XZ 平面圆形保留区：终端中心 `(0, -7.42)`、半径 `3.5m`，出生点中心 `(0, 4.2)`、半径 `2.25m`；创建或拖入保留区会返回 `422 lobby_protected_zone`。

公共区普通物件允许同频道成员共同移动、旋转、缩放和删除。地块内新建以及地块物件的所有 transform 修改和删除只允许该地块领主；领主可以把自己的物件移回公共区，公共物件只有目标地块领主可以移入自己的地块。交互接口不受地块编辑权限限制，频道成员仍可共同触发。旧版缺少 `plotId` 且仍位于历史 ±18 公共范围的物件以 `plotId: null` 原位保留；旋转、缩放和删除继续共享，但下一次修改位置时必须进入新公共区或领主自己的地块。

可驾驶物件只有在空闲停放时允许通过对象接口移动、旋转、缩放或删除。载具已被驾驶、持有租约或正在安全降落时，`PATCH`/`DELETE` 返回 `409 lobby_vehicle_in_use`；对象写入持锁期间的上车请求返回 WebSocket `vehicle_busy`，避免装修与驾驶同时取得所有权。

创建响应示例：

```json
{
  "object": {
    "id": "69c935d8-b77a-4394-bad3-fd7ad45f3fd6",
    "catalogId": "code-glow-cube",
    "position": { "x": 1.5, "y": 0, "z": -2 },
    "rotationY": 0,
    "scale": 1,
    "createdBy": "owner-550e8400-e29b-41d4-a716-446655440000",
    "updatedBy": "owner-550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-07-11T08:00:00.000Z",
    "updatedAt": "2026-07-11T08:00:00.000Z",
    "revision": 1,
    "plotId": null
  },
  "revision": 1,
  "updatedAt": "2026-07-11T08:00:00.000Z"
}
```

完整状态使用 `{ channel, schemaVersion, revision, updatedAt, objects, plots }`，仍保持 `schemaVersion: 1`。数字大厅的 `plots` 只保存已认领记录，每项为 `{ id, ownerId, ownerNickname, claimedAt, updatedAt }`；持久空间的 `plots` 始终为空，空间对象可以放在完整世界边界内且 `plotId` 恒为 `null`。旧文件缺少 `plots` 时在内存中视为 `[]`，只读 GET 不会改写文件。每个数字大厅、天堂和地狱频道都独立维护 `revision`；对象同时保存 `plotId`、自身最后一次变更的 revision、创建者/更新者和时间。跨频道使用对象 ID 一律返回与不存在对象相同的 `404 lobby_object_not_found`，不会泄露其他频道状态。SSE `change` 的 `data` 为 `{ type, channel, revision, updatedAt, object?, objectId?, plot?, plotId? }`，随后还会发送同数据的具体事件。SSE 建连时会在注册实时监听后重新校正快照，并按 revision 补发握手期间的变更，避免初始快照与监听注册之间漏事件。每条 SSE 连接只允许一个受控的待排空帧；慢连接若在排空前遇到新的关键状态变更，或 5 秒仍未排空，会被断开并依靠浏览器重连取得新快照，避免无界内存缓冲。

为兼容原子发布窗口中的旧页面，HTTP、SSE 或 WebSocket 请求暂时缺少 `channel` 时会规范化到 `0000`；旧 WebSocket 客户端收到的频道字段仍是历史值 `lobby`，显式传入 `channel=0000` 的新客户端收到 `lobby:0000`，两者实际加入同一个内部房间。显式数字或持久空间频道仍执行严格校验，新游戏界面应始终传入规范频道。

重复上传完全相同的包是幂等操作。不同内容复用已有 `level.json.id` 会返回 `409`，避免覆盖未知或已经批准的内容。

浏览器审核流程是：后台先带管理员 Bearer token 调用 `preview-token`，随后在同源页面打开返回的 `previewUrl`；游戏使用 `previewBaseUrl` 读取 `level.json`、`main.js` 和相对素材。管理员 token 只需保存在前端内存中，预览文件请求不会携带它。待审包始终不会进入公共 `registry.json`，也不能通过 `/levels/:id/*` 读取。

## 服务端校验

上传端点执行以下检查后才落盘：

- 标准、未加密 ZIP；拒绝绝对路径、`..`、反斜杠、符号链接、特殊文件、大小写碰撞、重复路径和 ZIP bomb。
- 压缩包不超过 40 MB，解压安全上限 80 MB、最多 512 个条目。
- 根目录必须有 `level.json`、`main.js`、非空 `solution.md` 和 `cover.png`；也接受仅有一层目录包装的 ZIP。
- 校验 schema v1、唯一通关类型及其必填字段、出生点/门/难度/时长/内容分级等字段。
- `main.js` 不超过 2 MB、必须有默认导出且自包含；保守扫描网络、动态执行、DOM、跨窗口、浏览器存储、Worker、navigator、Audio 构造器、模块加载和内嵌 three。
- `cover.png` 必须是完整 PNG、精确 16:9、至少 960×540、不超过 512 KB；所有贴图单边不超过 2048 px。
- 单个 GLB 不超过 15 MB且校验 glTF 2 头；MP3/OGG 总量不超过 10 MB，拒绝 WAV。

静态扫描和浏览器 CSP 仍不能替代人工试玩与内容审核；管理员批准应在独立审核流程之后执行。

## 测试

```bash
npm test
```

集成测试覆盖鉴权、上传、ZIP 路径穿越、schema/禁用 API 拒绝、管理员分页列表与详情、短效预览 Cookie 的篡改/过期/状态失效、pending 隔离、批准、拒绝、静态访问、幂等上传和重启持久化；大厅测试覆盖数字/派生空间频道格式与前导零、天堂/地狱及不同来源空间隔离、空间完整共享边界与禁用地块、空间对象/revision 落盘及重启保持、72 槽固定布局、并发认领唯一、同身份多地块、连续跨块移动、昵称清理、逐块空地释放、领地与公共区权限、缓冲区/共享边界拒绝、旧状态无写迁移、旧 0000 数据映射、跨频道状态/写入/交互/SSE 隔离、LRU 与频道容量、首次并发写入、保留区、审计信息、终端锁、原子重启恢复、SSE 连接上限/背压、双层写入限流及过期计数回收。玩家 GLB 资产测试覆盖 Cookie/同源保护、私人无写 GET、公开同源解析、GLB 危险结构与严格预算、WebP 重复帧/首大末小绕过、累计 world transform、owner-only 新建、随机 ID、同 owner/跨 owner 去重、逻辑与物理配额、小时/IP/owner/global 限速、并发验证门、重启恢复、registry 暂缺时存档保留、频道单类/总量/unique 实例上限，以及频道字节/纹理像素/实例顶点与三角面的聚合预算和重启后继续计数。Avatar/多人测试额外覆盖非法/外链/超预算/decoder 扩展 GLB、camera/灯光拒绝、PNG/JPEG/WebP 签名/尺寸/总解码像素、创作者 Bearer 兼容、账号 Cookie/同源保护、私人列表隔离、跨账号内容去重归属、失败无残留、owner/IP 限速、每账号数量、并发验证、重启归属恢复、registry 重建、静态 HEAD/GET、上传频率、数量/总字节容量，以及大厅无固定位置边界/关卡旧范围、飞机无水平与正高度边界、落地退出复核、状态丢失/超时/断线自动降落、恢复期占座、后来加入者恢复快照、数字/持久空间 WebSocket welcome 与玩家/pose/Party 隔离、闯关后返回原频道、2–3 个客户端的 join/pose/profile/leave、未知形象回退、Origin、重复 client ID 冲突、消息/连接/每 IP 上限和关闭清理。

## 部署要点

- 把 `WHITEROOM_DATA_DIR` 放在持久卷并纳入备份；运行用户必须能写该目录。
- 用 systemd/容器编排保持进程运行，前置 Nginx/负载均衡器终止 TLS。
- 反向代理需将 `/api/`、`/registry.json`、`/levels/` 转给本服务，并把请求体上限设为略高于 multipart 的 40 MB（建议 `41m`）。
- 审核前端与预览 API 应保持同源；不要把管理员 token 写入 localStorage、URL、日志或构建产物。预览 Cookie 已限制到单关卡 `/api/admin/preview/:id/` 路径。
- 游戏站点 CSP 的 `connect-src` 需要包含本服务 Origin；若静态关卡跨域加载，也需确认模块脚本 CORS 策略。
- Nginx 代理 `/api/lobby/events` 时必须关闭响应缓冲；服务已经返回 `X-Accel-Buffering: no`，仍建议显式配置 `proxy_buffering off`，并把读取超时设为高于 SSE 心跳周期。
- Nginx 代理 `/api/lobby/multiplayer` 时必须使用 HTTP/1.1，并转发 `Upgrade`、`Connection`、原始 `Host`、`X-Real-IP` 和 `X-Forwarded-Proto`；WebSocket 读超时应高于 20 秒心跳周期。站点 CSP 的 `connect-src` 还需允许同源 `wss:`。
- Nginx/API 网关的 Avatar 请求体上限应略高于 8 MiB（建议 `9m`）。`avatars/` 与其他持久数据一起备份；默认 512 MiB 总配额是针对当前约 4.5 GB 可用磁盘的保护值，不要在未扩容磁盘时随意提高。
- Nginx 应为精确路径 `POST /api/lobby/assets` 设置约 `16m` 请求体上限、每 IP `2r/m` 和最多 2 个并发请求；平台内仍保留每小时 owner/IP/global 限速和并发 2 的第二道保护。`/lobby-assets/` 必须代理到平台服务并保持同源，不要在代理层改成长时间 immutable 缓存。
- 持久化发布、备份、回滚及 rsync 保护列表必须把 `lobby-assets/` 与 `lobby/`、`avatars/` 同等保护；任何版本部署都不得删除、覆盖或从 release 目录同步这三个数据目录。
- 管理接口不要直接暴露给无访问控制的浏览器后台；至少使用高熵管理员 token、TLS、审计日志和入口限速。
- 多实例共享同一 POSIX 文件系统时可用本实现的锁文件；对象存储或跨主机扩容时应换成集中式数据库/锁。
