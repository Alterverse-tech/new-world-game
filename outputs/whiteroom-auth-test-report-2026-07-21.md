# WhiteRoom 认证测试报告

- 日期：2026-07-21
- 本地游戏：http://127.0.0.1:4174/
- 本地后端：http://127.0.0.1:8787/
- 后端分支：`dev_by_peng`（`f059a48` + 本地未提交修改）
- 测试方式：接口、静态构建检查和 Node.js 认证专项测试；未使用浏览器自动控制

## 结论

邮箱注册/登录按钮不可用的直接原因是本地后端未配置 Supabase，且本地游戏镜像缺少按需加载的 Supabase 客户端分包。两个问题均已修复。注册已改为独立的“填写账号 → 接收 6 位验证码 → 验证并设置密码”流程，登录继续使用 Supabase 邮箱密码认证。

Google 登录目前不是偶发故障，而是尚未启用：Supabase 项目公开设置为 `google: false`，现有游戏前端只实现邮箱入口，后端也只接受邮箱 provider。完整启用 Google 仍需要 Supabase/Google OAuth 客户端配置和前后端实现，当前仓库没有这些外部凭据及完整游戏前端源码。

## 测试结果

| 编号 | 场景 | 修复前/实际结果 | 修复后结果 | 状态 |
| --- | --- | --- | --- | --- |
| AUTH-01 | 本地认证配置 | `/api/auth/config` 返回 `enabled:false`，按钮显示“登录功能待启用” | 返回 `enabled:true`、`provider:email` | 通过 |
| AUTH-02 | Supabase 客户端加载 | 动态分包 `index-5fZAOLQ3.js` 缺失，启用配置后会 404 | 主包和动态分包均返回 HTTP 200 | 通过 |
| AUTH-03 | 非法邮箱注册 | Supabase 返回 `email_address_invalid`，前端只显示笼统失败 | 显示“请使用可接收确认邮件的真实邮箱” | 通过 |
| AUTH-04 | 错误邮箱/密码登录 | Supabase 返回 `invalid_credentials`，前端只显示笼统失败 | 显示“邮箱或密码不正确” | 通过 |
| AUTH-05 | 独立注册表单 | 原“注册新账号”直接复用登录表单并立即提交 | 独立同风格弹窗，包含邮箱、密码、确认密码和流程步骤 | 通过（结构与脚本验证） |
| AUTH-06 | 邮箱验证码注册 | 原流程依赖确认链接 | 使用 Supabase `signInWithOtp`、`verifyOtp` 和 `updateUser` 完成验证码注册及密码设置 | 通过（接口能力与脚本验证） |
| AUTH-07 | 后端无效令牌 | — | 返回 HTTP 401 `account_token_invalid`，不建立会话 | 通过 |
| AUTH-08 | 后端认证专项测试 | 首次沙箱运行因禁止监听临时端口而失败，非代码错误 | 沙箱外重跑 21/21 通过 | 通过 |
| AUTH-09 | Google provider | Supabase `external.google:false`；前端无 Google 按钮；后端拒绝 Google token | 尚未启用 | 阻塞 |
| AUTH-10 | OTP 重复发送限流 | Supabase 返回 `over_email_send_rate_limit` | 增加 60 秒倒计时、禁止重复发送、“已有验证码”入口和项目额度说明 | 通过（前端逻辑验证） |

## 已实施修复

1. 在本地 `.env.local` 中配置 WhiteRoom 现有 Supabase 项目的公开 URL 与 publishable key。
2. 补齐游戏登录时动态加载的 Supabase JS 分包。
3. 使用新文件名 `index-C4bZ867h-authfix.js`，避免浏览器继续使用旧的长期缓存文件。
4. 将注册提示细分为：邮箱无效、邮箱已注册、密码强度不足、邮件发送频率过高和请求频率过高。
5. 将登录提示细分为：凭据错误、邮箱未确认和请求频率过高。
6. 重启本地后端并复测认证配置、静态资源及会话接口。
7. 新增与登录弹窗一致的独立注册弹窗，并提供 3 步进度、确认密码、6 位验证码、重新发送和返回登录。
8. 注册流程完全使用 Supabase：发送 OTP、验证 OTP、设置密码；成功后再建立 WhiteRoom HttpOnly 会话。
9. OTP 请求增加跨弹窗保留的 60 秒冷却；限流时仍允许输入已经收到的验证码。

## 仍需人工或外部配置的项目

- 完整验证“收到 6 位验证码 → 验证 → 设置密码 → 成功登录”需要一个可收信的测试邮箱。本次没有向无关真实邮箱发送测试邮件。
- Supabase 邮件模板必须输出 6 位 Token；如果项目仍使用默认 Magic Link 模板，需要在 Supabase 邮件模板中切换为验证码内容。
- Supabase 同一邮箱 OTP 默认至少间隔 60 秒；项目级 OTP 额度需在 Supabase Authentication → Rate Limits 中管理。生产环境应配置自定义 SMTP，避免依赖内置邮件服务的低额度。
- Google 登录需要先在 Supabase/Google Cloud 中启用并配置 Google OAuth；之后还要在游戏前端增加入口，并让后端会话记录接受和返回 Google provider。
