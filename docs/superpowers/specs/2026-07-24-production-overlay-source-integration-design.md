# WhiteRoom 生产 Overlay 源码化设计

## 目标

将当前 `public/game` 中通过额外 JavaScript、CSS 和压缩 bundle 字符串替换实现的生产功能，回收到 `apps/game` 的可维护 TypeScript、HTML 和 CSS 源码中。源码构建必须保留现有生产行为，并为后续统一 Level SDK、增加浏览器回归测试和受控替换 `public/game` 建立可靠基础。

本阶段只修改 `apps/game` 及其测试和文档。当前生产成品 `public/game`、部署脚本的实际发布路径和线上行为保持不变，直到后续新旧版本浏览器行为对照通过。

## 已确认的生产增量

当前源码已经包含基础邮箱账号、玩家资料和大厅多人连接，但生产成品在其上还有以下增量：

1. `account-login-otp-20260722.*`：邮箱验证码登录、60 秒重发冷却、六位验证码自动提交和 WhiteRoom 服务端会话同步。
2. `account-register-20260721.*`：邮箱、密码和验证码三步注册；验证码确认后设置密码并同步服务端会话。
3. `account-reset-bootstrap-20260721.js` 与 `account-reset-20260721.*`：在 Supabase 初始化前保留 recovery hash，发送密码重置邮件，并使用 recovery token 更新密码。
4. `player-stats-20260721.*`：显示在线玩家、状态、延时、FPS 和地区；发送 telemetry 与 ping 消息。
5. `game-experience-20260721.js`：暂停菜单的“退出游戏”行为。
6. `deploy/macos/patch-whiteroom-game.mjs`：向 HTML 注入退出按钮和 overlay，并将压缩 bundle 中自己的第三人称昵称从隐藏改为显示。

这些功能目前能工作，但它们会拦截 DOM 事件、创建重复的 Supabase 客户端、替换全局 `window.WebSocket`，并依赖压缩代码中的精确字符串，因此不适合作为未来 SDK 和游戏功能开发的基础。

## 方案选择

采用“原生回收”方案：保留生产对外行为和网络契约，将实现改为源码内部的明确模块协作。

不采用以下两种方案：

- 不把现有 overlay 原样包装成 Vite 模块，因为这仍会保留事件抢占、MutationObserver 和全局 WebSocket 替换。
- 不让构建流程继续复制独立 overlay，因为那样 `apps/game` 仍不是生产行为的唯一源码来源。

## 架构

### 账号与会话

`AccountController` 继续作为账号生命周期的唯一入口，负责启动时恢复会话、服务端 session 交换、退出登录和玩家资料读写。新增的账号流程通过依赖注入共享同一个 Supabase 客户端和同一个服务端会话同步函数，不再各自请求配置或创建客户端。

实现拆分为以下职责：

- `account-auth-service.ts`：读取并校验 `/api/auth/config`，延迟创建唯一 Supabase 客户端，执行 OTP、密码设置、recovery 请求和 `/api/auth/session` 交换。它不操作 DOM。
- `account-login-flow.ts`：管理 `email -> verify` 状态、按邮箱保存的 60 秒 `sessionStorage` 冷却、六位数字验证码校验、自动提交和可恢复错误。
- `account-registration-flow.ts`：管理 `details -> verify -> complete` 状态。密码只保存在内存中，成功、取消或失败结束时立即清除输入框和内存副本。
- `account-recovery-flow.ts`：在 Supabase 客户端初始化前接收页面 recovery hash，管理 `email -> password` 状态，发送枚举安全的恢复提示，并在成功后清除 token 和密码字段。
- `account-controller.ts`：组合上述流程，将账号主面板、设置页和玩家资料状态保持为现有单一权威状态。

`main.ts` 在调用 `AccountController.initialize()` 前读取 recovery hash 并立即从地址栏移除，然后将值传给账号控制器。因为此时尚未创建 Supabase 客户端，所以不再需要生产中的独立同步 bootstrap 脚本。

需要保持的外部行为包括：

- OTP 登录仍使用 `shouldCreateUser: true`，新邮箱可直接创建账号。
- 登录和注册重发冷却仍为每个邮箱 60 秒，并在同一标签页刷新后保留。
- 登录与注册成功后仍将 access token 只发送到 `/api/auth/session`，前端诊断信息、日志和持久化状态不得包含 token 或密码。
- 注册仍在 OTP 验证成功后设置用户选择的密码。
- 密码恢复仍显示不泄露邮箱是否存在的统一成功提示。
- 当前中文文案、焦点移动、按钮禁用、对话框取消和成功后的刷新时序保持一致。

### 玩家状态与多人连接

新增 `player-telemetry.ts`，负责 telemetry 数据的规范化、状态表、FPS 采样、RTT ping、地区推断和玩家状态面板渲染。它不创建或替换 WebSocket。

`LobbyMultiplayer` 继续唯一持有 `/api/lobby/multiplayer` 连接，并负责：

- 在现有消息解析器中接受服务端 `telemetry` 和 `telemetry_pong` 消息。
- 将 `welcome`、`channel_snapshot`、玩家加入/离开、pose、车辆和队伍事件转交给 telemetry 模块。
- 通过现有 socket 发送 `telemetry` 和 `telemetry_ping`。
- 在连接、断线、换频道、进入关卡、驾驶、移动和页面可见性变化时更新本地状态。
- 在销毁或断线时停止定时器和帧采样，避免重复连接后的资源泄漏。

这样可以保留现有服务端协议，同时避免 `window.WebSocket` 全局替换影响 UGC、SDK、测试或未来其他网络功能。

### 游戏体验补丁

`apps/game/index.html` 直接包含 `quit-game-btn`。`WhiteRoomGame` 在现有暂停菜单事件注册处绑定退出行为：释放 pointer lock，并刷新当前页面。该行为继续保留频道查询参数和当前地址，与生产 overlay 一致。

第三人称自己的昵称在 `LobbyMultiplayer` 创建和更新本地 actor 时保持可见。可见性仍跟随本地角色本身的第一/第三人称、驾驶状态和镜头遮挡规则，不改变远端角色逻辑。

完成后，源码构建不应包含或引用 `game-experience-20260721.js`，也不需要对压缩 bundle 做昵称字符串替换。

### 页面与样式

将生产 HTML 中新增的 OTP、注册、密码恢复、玩家状态和退出按钮节点合并到 `apps/game/index.html`。将对应 overlay CSS 合并到 `apps/game/src/openai-theme.css`，沿用已有 WhiteRoom 变量、响应式断点和 reduced-motion 规则。

`main.ts` 只导入源码 CSS 和 TypeScript 入口。Vite 构建生成带内容哈希的标准资源，不额外复制生产 overlay 文件。

## 数据流

账号登录数据流：

1. 用户输入邮箱。
2. 登录 flow 校验并规范化邮箱，通过共享 auth service 请求 OTP。
3. 用户输入六位验证码，flow 通过共享 Supabase 客户端验证。
4. auth service 将返回 session 的 access token 交换为 WhiteRoom HttpOnly 会话。
5. 页面刷新，`AccountController` 从 Supabase 和 `/api/auth/me` 恢复账号与玩家资料。

多人 telemetry 数据流：

1. `LobbyMultiplayer` 建立唯一 WebSocket。
2. telemetry 模块采样 FPS、测量 ping 并根据游戏状态形成有限枚举值。
3. `LobbyMultiplayer` 通过现有 socket 发送严格 schema 消息。
4. 服务端广播经过校验的 telemetry。
5. `LobbyMultiplayer` 解析消息并交给 telemetry 模块更新面板。

## 错误处理与安全边界

- 对用户展示稳定、脱敏的错误映射，不显示 Supabase 原始 token、用户 ID、请求体或内部异常。
- OTP、注册和恢复操作使用 busy 状态避免重复提交；所有成功、取消和不可恢复失败路径清除密码与验证码。
- 冷却存储只保存规范化邮箱和截止时间，不保存 OTP、密码或 session。
- recovery token 只在内存中短暂存在；读取后立即清理 URL hash，成功、取消或错误结束时清除。
- telemetry 继续使用服务端已经约束的 FPS、RTT、状态和地区范围；客户端对收到的数据再次限幅和净化。
- 玩家状态面板只使用 `textContent` 创建内容，不拼接用户提供的 HTML。
- 本阶段不改变 CSP、服务端认证协议、多人协议上限或生产静态目录。

## 测试设计

### 单元测试

- 账号 service：配置校验、唯一客户端、OTP 参数、session 交换、恢复请求以及敏感信息不进入错误文本。
- 登录 flow：邮箱规范化、验证码格式、60 秒冷却、刷新恢复、自动提交和失败后的可重试状态。
- 注册 flow：密码匹配、OTP 验证后设置密码、各退出路径清除秘密值。
- 恢复 flow：hash 解析与清理、邮箱枚举安全提示、token 缺失/过期、密码更新和清理。
- telemetry：消息规范化、玩家增删、状态变化、RTT 计算、FPS 限幅、断线状态、定时器释放和地区 fallback。
- `LobbyMultiplayer`：telemetry 消息解析、发送节流、换频道清理以及自己的第三人称昵称可见。
- `WhiteRoomGame`：退出按钮释放 pointer lock 并刷新页面。

状态机和 DOM 之间通过小型 port 接口连接，测试使用 fake port，不为了测试引入第二套浏览器 DOM 实现。

### 构建与契约检查

每个功能切片完成后运行：

```text
npm.cmd run test:game
npm.cmd run lint:game
npm.cmd run build:game
npm.cmd test
```

增加源码构建契约，确认：

- `apps/game/index.html` 具备所有生产功能所需的节点 ID。
- 构建后的 HTML 不引用六个生产 overlay JavaScript/CSS 文件。
- 账号、telemetry 和退出功能从 TypeScript 入口可达。
- `public/game` 在本阶段保持字节级未修改。

浏览器端的新旧版本完整行为对照属于后续独立阶段；本阶段只建立可测试、可构建且功能完整的候选源码。

## 实施顺序与提交边界

1. 固化生产 DOM、样式和 overlay 行为契约，不改变运行实现。
2. 回收 OTP 登录、注册和密码恢复，共享单一账号 service。
3. 回收玩家 telemetry，并接入 `LobbyMultiplayer` 的现有 socket。
4. 回收退出按钮和自己的第三人称昵称显示。
5. 执行全部平台与游戏检查，记录候选构建与当前生产成品的剩余差异。

每一步使用独立提交。任何切片失败时，只回退该切片；`public/game` 不参与这些提交，因此不会影响当前生产成品。

## 完成标准

- 当前生产新增的账号、玩家状态、退出和昵称行为都有明确的 TypeScript 所有者和自动化测试。
- `apps/game` 构建不依赖独立 overlay 或压缩 bundle 字符串替换。
- 不替换全局 `window.WebSocket`，不创建互相竞争的 Supabase 客户端。
- 游戏测试、lint、类型检查、Vite 构建以及平台测试全部通过。
- `public/game`、生产部署入口和线上行为在本阶段没有改变。
- 后续可以在这套源码上统一 SDK 契约、加强 UGC 隔离并接入浏览器回归门禁。
