# WhiteRoom 本地创作目录

- 游戏内容：`work/whiteroom`
- 本地登记审核目录：`work/whiteroom-platform`
- 当前大厅平台：仓库根目录

`work/whiteroom-platform` 只用于隔离审核新用户物件，避免空白游戏目录误删或覆盖当前大厅已有物件。审核通过后，再将同一目录项追加到当前大厅平台。

本地预览：

```bash
cd work/whiteroom
npm run preview
```

然后访问 `http://127.0.0.1:4173`。
