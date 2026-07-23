# Recovered WhiteRoom Game Source Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `Altverse-WhiteRoom-source-v39-v30-20260723.zip` 中经过生产溯源验证的 `whiteroom/` 前端源码导入 `new-world-game/apps/game/`，并让最新 `main` 可以独立安装、测试、lint 和构建该源码。

**Architecture:** 保留 `public/game/` 作为当前生产静态成品，恢复的源码先作为独立应用进入 `apps/game/`。根项目通过显式脚本和 CI 同时验证平台与游戏；在完成行为等价验证前，不用新构建覆盖 `public/game/`。

**Tech Stack:** Node.js 20+、TypeScript 5.8.3、Vite 7.3.6、Vitest 3.2.7、Three.js 0.179.1、现有 Node.js 平台测试。

---

## 已确认输入

- Archive: `C:\Users\jimmy\Downloads\Altverse-WhiteRoom-source-v39-v30-20260723.zip`
- Archive SHA-256: `09B43C53B9D076D09650D9DABEDD684EBD5DD6B3956800C0F7B1FA3344E6A717`
- Source runtime: `runtime-20260721-v39-v30-metropolitan-museum`
- Game release: `20260721-whiteroom-ugc-v39-metropolitan-museum-gallery`
- Game source tree SHA-256: `249c45d236fbdd6dc360bbcfed17fbe7e5983b70e21b1ea733ed434df27ec0dc`
- Integration base: `main@113b2109b92bb643f464ba84d86dd2fdee60bf8f`

## 已知基线 gap

1. `main` 只跟踪 `public/game/` 成品，没有生成它的 TypeScript/Vite 工程。
2. Windows 对目录 `fsync` 返回 `EPERM`，使平台测试在本地大量失败。
3. 根 `npm test` 无范围限制，会错误发现 `work/whiteroom/**/*.test.mjs`；GitHub Actions 的最新 main 因这些实验目录测试失败。
4. 恢复源码是 2026-07-21 v39；`main` 在之后通过 overlays 加入 OTP 登录和体验补丁，因此本分支只恢复并验证源码，不立即替换生产成品。
5. 恢复源码使用 Three.js 0.179.1；在建立行为等价前不升级到平台根依赖的 0.185.1。
6. 将根测试范围限定到 `test/*.test.js` 后发现 3 个与本次导入无关的既有契约不一致：缺失 `public/foundry/` 静态页、Lobby 动画预算已放宽但拒绝用例未更新、Portal 用例仍硬编码旧 bundle 名。本分支让测试忠实描述现状：Foundry API 可用但页面返回 404、动画上传受 32 条预算约束、Portal 动态验证实际哈希 bundle；不跳过测试，也不伪造页面。

## Task 1: 固化恢复源码契约

**Files:**
- Create: `test/game-source-integration.test.js`
- Create: `docs/source-recovery/v39-v30.md`

- [ ] 写测试，要求 `apps/game` 具有 Vite、TypeScript、入口、UGC runtime、核心游戏类和测试。
- [ ] 断言 `white-room-game.ts` 的生产错误标记也存在于当前 bundle，证明源码血缘。
- [ ] 运行测试并确认因 `apps/game` 不存在而失败。

## Task 2: 导入归档中的游戏源码

**Files:**
- Create: `apps/game/**` from archive `whiteroom/**`

- [ ] 在内存中验证归档 `SHA256SUMS`。
- [ ] 仅提取 `whiteroom/`，拒绝绝对路径、`..` 和目标目录越界。
- [ ] 不提取 `node_modules`、`dist`、密钥、环境文件或生产数据。
- [ ] 重新运行源码契约测试并确认通过。

## Task 3: 接入根项目命令并修复测试边界

**Files:**
- Modify: `package.json`
- Modify: `src/prop-creation.js`
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`

- [ ] 将平台测试范围限定为根 `test/`。
- [ ] 增加 `test:game`、`lint:game`、`build:game` 和 `check:game`。
- [ ] Windows 只忽略目录同步的 `EPERM`；Linux/macOS 只忽略 `EINVAL`、`ENOTSUP`、`EOPNOTSUPP`。
- [ ] CI 分别执行平台依赖安装、游戏依赖安装、平台测试和游戏完整检查。
- [ ] README 说明源码位置、当前生产成品边界和本地命令。

## Task 4: 验证恢复源码

**Commands:**

```text
npm.cmd ci
npm.cmd ci --prefix apps/game
npm.cmd test
npm.cmd run test:game
npm.cmd run lint:game
npm.cmd run build:game
```

- [ ] 平台测试不再因 Windows 目录 `fsync` 或跨工程测试误发现而失败；单独记录剩余既有平台断言。
- [ ] 游戏 Vitest 全部通过。
- [ ] ESLint 通过且零 warning。
- [ ] TypeScript 检查和 Vite build 通过。
- [ ] `apps/game/dist/` 不进入 Git。

## Task 5: 提交和推送

- [ ] 检查 `git diff --check`、`git status` 和变更范围。
- [ ] 显式暂存 `apps/game/`、契约测试、文档和接入文件。
- [ ] 提交信息：`feat: restore WhiteRoom game frontend source`
- [ ] 推送：`git push -u origin codex/game-source-integration`

## 完成标准

- 新 clone 可以从 `apps/game` 复现游戏构建。
- 当前 `public/game` 不被覆盖或删除。
- 平台和游戏测试使用各自明确的 runner，不再互相误发现测试。
- ZIP 来源、生产 release 和 SHA-256 被仓库文档保留。
- 分支已推送到 GitHub，未携带凭据、依赖目录和构建产物。
