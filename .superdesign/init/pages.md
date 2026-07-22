# Page dependency trees

## /admin/
Entry: `public/admin/index.html`
Dependencies:
- `public/admin/styles.css`
- `public/admin/app.js`

## /portal/
Entry: `public/portal/index.html`
Dependencies:
- `public/portal/styles.css`
- `public/portal/app.js`

## /regeneration.html (canonical Shark asset preview)
Reference entry: `.superdesign/context/current-regeneration.html`
Dependencies:
- `.superdesign/context/current-regeneration-preview.js`
- `.superdesign/context/regeneration-status.sample.json`
- Three.js
  - GLTFLoader
  - OrbitControls

Target redesign keeps the status JSON as the single UI data source and presents base GLBs plus semantic action GLBs as distinct selectable items.
