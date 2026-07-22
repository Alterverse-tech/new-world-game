# Routes

| Route | Entry | Styles | Behavior | Notes |
| --- | --- | --- | --- | --- |
| `/admin/` | `public/admin/index.html` | `public/admin/styles.css` | `public/admin/app.js` | Content review and asset operations console. |
| `/portal/` | `public/portal/index.html` | `public/portal/styles.css` | `public/portal/app.js` | Player-facing WhiteRoom portal and GLB upload surface. |
| `/regeneration.html` | generated from the Shark template | inline template CSS | `src/regeneration-preview.js` bundled | Canonical model generation progress and Three.js preview page. |
| `/whiteroom-dev` | `tmp/whiteroom-game/index.html` | downloaded game assets | downloaded game bundle | Local WhiteRoom game entry exposed through ngrok. |

There is no client router. The Node server maps static URL prefixes to these independent pages.
