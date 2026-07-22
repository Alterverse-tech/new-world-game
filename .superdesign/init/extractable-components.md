# Extractable components

## StudioTopbar
- Source: `public/admin/index.html`
- Category: layout
- Description: WhiteRoom Studio brand lockup, connection state and session action.
- Extractable props: connectionState (string, default: "已连接"), showLogout (boolean, default: true)
- Hardcoded: brand mark, WhiteRoom Studio label, topbar structure.

## AssetPipelineSidebar
- Source: `.superdesign/context/current-regeneration.html`
- Category: layout
- Description: Model and action job navigation with readiness, progress and filenames.
- Extractable props: activeItem (string, default: "player-base"), failedCount (number, default: 0)
- Hardcoded: status colors, item hierarchy, progress bars.

## ModelPreviewStage
- Source: `.superdesign/context/current-regeneration.html`
- Category: layout
- Description: Full-height Three.js preview with orbit controls and bottom status overlay.
- Extractable props: showGrid (boolean, default: true), isLoading (boolean, default: false)
- Hardcoded: canvas, light rig, stage toolbar and status overlay.

## PipelineStepRail
- Source: new pipeline visualization
- Category: layout
- Description: Ordered generation phases from reference image to game integration.
- Extractable props: activeStep (string, default: "model"), failedCount (number, default: 0)
- Hardcoded: phase names and compact status iconography.

## StatusPill
- Source: `public/admin/index.html`
- Category: basic
- Description: pending/running/ready/failed semantic state marker.
- Extractable props: none
- Hardcoded: labels, colors and compact rounded shape.
