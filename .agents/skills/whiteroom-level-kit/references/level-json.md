# level.json v1

脚手架会生成所有通用字段。修改时保持以下约束。

## 必填字段

- `schema`: 固定 `"wr-level"`
- `schemaVersion`: 固定 `1`
- `engineApi`: 固定 `"1"`
- `id`: `<kebab-slug>-<6位十六进制>`；打包器会换成内容哈希
- `name`: 非空，最多 24 字符
- `version`: semver，例如 `1.0.0`
- `author.name`: 非空署名；`author.contact` 可选
- `description`: 非空，最多 120 字符
- `language`: BCP-47，例如 `zh-CN`
- `type`: 七种权威类型之一，必须等于 `winCondition.type`
- `winCondition`: 见 `win-conditions.md`
- `objective`: 非空，最多 30 字符
- `difficulty`: 整数 1–5
- `estimatedMinutes`: 整数 1–15
- `spawn`: `{ "position":[x,y,z], "yawDeg":0 }`
- `door`: `null` 或 `{ "anchor":[x,y,z], "yawDeg":0 }`
- `killY`: 数字
- `entry`: 固定 `main.js`
- `cover`: 固定 `cover.png`
- `contentRating`: v1 固定 `everyone`

可选：`tags`（最多 5 个）、`credits`、`assetsManifest`。`custom` 额外必填非空 `objectiveDetail`。

## 必需文件与预算

包根必须有 `level.json`、`main.js`、`solution.md`、`cover.png`。封面为 PNG，16:9、至少 960×540、最多 512KB。

- `.wrlevel` ≤40MB；`main.js` ≤2MB；单个 GLB ≤15MB。
- MP3/OGG 音频合计 ≤10MB；禁止 WAV。
- PNG/JPG/WEBP/KTX2 贴图单边 ≤2048px。
- 资源仅放 `assets/`，使用相对路径；禁止符号链接和 `..`。

## 常见错误

- `E_TYPE_MISMATCH`: `type` 与 `winCondition.type` 不一致。
- `E_WIN_REQUIRED`: 该类型的 required、flags 或 duration 缺失。
- `E_FORBIDDEN_API`: main.js 使用网络、DOM、存储、worker 或动态执行 API。
- `E_BUNDLED_THREE`: 导入或打包了 Three.js；改用 `sdk.THREE`。
- `E_RUNTIME_REGISTRATION`: 清单要求的 goal、collectible、flag 或 target 没有在代码中注册。
- `E_BUDGET`: 文件或资源超过预算。
