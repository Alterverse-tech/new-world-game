# 发布

默认门户：`https://altverse.fun`。可用 `WHITEROOM_PORTAL_URL` 覆盖。发布令牌只允许发送到 HTTPS 门户；本机开发测试可显式使用 `http://127.0.0.1`。

## 命令

```bash
node <skill-dir>/scripts/publish.mjs check --dir ./my-level
WHITEROOM_PORTAL_TOKEN="..." node <skill-dir>/scripts/publish.mjs publish --dir ./my-level --confirmed
node <skill-dir>/scripts/publish.mjs status --id <level-id>
```

`check` 只做本地校验和临时打包，不联网。`publish` 是唯一远程写操作，运行前必须获得用户明确确认，并以 `--confirmed` 记录该确认。令牌只放环境变量，不写入任何文件。

成功响应：`{ levelId, status: "pending", reviewUrl }`。`pending` 仅表示进入审核队列；管理员批准后才会出现在 `/registry.json` 和游戏随机池。

## 错误语义

- `401/403`: 令牌缺失、失效或权限不足；停止并索要创作者令牌。
- `409`: 相同内容已存在；查询返回的 levelId，不要改包重传。
- `413`: 包超过 40MB；压缩/删减资产后重新校验。
- `422`: 服务端校验失败；按 `errors` 修复后重跑本地 validate。
- `5xx` 或断网: 保留同一 `.wrlevel`，稍后原样重试以维持幂等。

不要在聊天、截图、日志、关卡包或版本库中显示完整 token。
