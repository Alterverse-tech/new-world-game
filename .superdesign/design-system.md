# WhiteRoom Model Foundry

## Product context

WhiteRoom Model Foundry is an operational workspace for observing the Shark game-asset pipeline. It visualizes one current generation run from intent to runtime-ready GLB without inventing state: `regeneration-plan.json` owns intent, job files and manifests own facts, `regeneration-status.json` owns derived UI state, and the viewer is read-only.

Primary users are game designers and developers producing Three.js-ready models. Their key questions are: what is running, which phase is slow or failed, whether the GLB exists locally, whether actions bind to the base rig, and which asset is safe to integrate.

## Information architecture

- Header: product identity, current run id, connection/live indicator, elapsed time, compact global actions.
- Pipeline rail: Reference, Model, Rig, Actions, Validation, Integration. Each phase shows pending/running/ready/failed and item counts.
- Left column: hierarchical asset queue. Base model is the parent; semantic actions are indented children. Every row shows role, state, percentage and local filename.
- Center: full-height Three.js stage with orbit controls, grid, lighting, loading state and action playback.
- Right inspector: selected asset metadata, current phase, route, local file readiness, manifest mapping, action binding result and diagnostic log.
- Bottom status strip: one concise run summary plus failures. Never use this surface to edit generation facts.

## Visual direction

A dense but calm dark production console. It should feel like a precise model workshop, not a generic analytics dashboard or sci-fi game HUD. Use flat surfaces, thin borders, generous alignment, compact controls and a single warm amber accent. No gradients, glassmorphism, decorative noise or oversized marketing typography.

## Color tokens

- Canvas: `#0B0D10`
- Stage: `#0E1116`
- Panel: `#12151B`
- Raised panel: `#171B22`
- Hover/selected: `#202630`
- Primary text: `#F4F4F1`
- Secondary text: `#A6ADB7`
- Quiet text: `#737C88`
- Border: `#2A303A`
- Strong border: `#3A424E`
- Amber accent: `#E5B76C`
- Amber tint: `rgba(229, 183, 108, 0.12)`
- Ready: `#74C88F`
- Running: `#E5B76C`
- Failed: `#D55D5D`
- Pending: `#788391`
- Information: `#6CB6E8`

Status color is never the only signal; always pair it with a word or icon.

## Typography

- UI: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif`
- Metadata: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`
- Page title: 18px/24px, 650 weight.
- Section title: 12px/16px, 700 weight, 0.08em uppercase tracking where appropriate.
- Body: 13px/20px.
- Metadata: 11px/16px.
- Numeric progress: tabular numerals.

## Spacing and geometry

- Base spacing unit: 4px.
- Common gaps: 8, 12, 16, 20, 24px.
- Header height: 60px.
- Pipeline rail height: 72px.
- Left queue width: 320px.
- Right inspector width: 340px.
- Panel padding: 14–16px.
- Radius: 8px for controls/cards, 6px for compact pills, never above 10px.
- Border: 1px solid border token.
- Shadows: only floating menus/dialogs, `0 18px 50px rgba(0,0,0,.35)`.

## Components

- Buttons are 32–36px high with thin borders. Primary actions use amber fill with dark text; ordinary actions remain dark outlined.
- Asset rows are compact 56–68px blocks. Selected rows use amber-tinted background and amber border. Ready rows use a green leading status marker, not a green-filled card.
- Progress bars are 4px high. Amber for running, green for ready, red for failed, gray for pending.
- Pills use short labels: `等待`, `生成中`, `可预览`, `失败`.
- Logs use monospace text, timestamp first, with severity as text and restrained color.
- Inspector uses definition-list alignment: label left, value right or below.

## Motion

- Status updates: 160ms color/width transition.
- Panel selection: 120ms background/border transition.
- Model auto-rotation remains slow and constant; user orbit interaction temporarily pauses it.
- Loading uses a restrained rotating stroke, not skeleton shimmer.
- Respect `prefers-reduced-motion`.

## Responsive behavior

- Desktop ≥1180px: queue / stage / inspector in three columns.
- Tablet 760–1179px: queue 300px + stage; inspector becomes a slide-over panel.
- Mobile <760px: stage first, queue second, inspector as bottom sheet; pipeline rail scrolls horizontally.

## Data truth and interaction constraints

- The viewer polls only `regeneration-status.json` with cache disabled.
- A model/action is clickable only when `runtimeUrl` exists and the local GLB validation gate passed.
- Server success without a local GLB displays `同步中 99%`, never ready.
- Action preview loads the base model, then binds the action clip. If binding fails, label direct action-scene fallback explicitly.
- Preserve base/action hierarchy and exact semantic action names from the plan/manifest.
- Never show a publish button in this production page; portal publishing is a separate authorized workflow.
