# Theme sources

The project currently has two visual systems. The new asset pipeline should retain the canonical regeneration viewer's dark operational character while borrowing WhiteRoom's typography discipline and semantic status colors.

## Admin theme

Source: `public/admin/styles.css`

```css
:root {
  --paper: #f6f4ee;
  --paper-deep: #ece9df;
  --surface: #fffefa;
  --ink: #1c231f;
  --ink-soft: #65706a;
  --line: #dcded7;
  --line-strong: #c7cbc3;
  --forest: #214f3d;
  --forest-dark: #173b2d;
  --forest-pale: #e3eee8;
  --amber: #9d641d;
  --amber-pale: #fff0d9;
  --red: #9d3b32;
  --red-dark: #7d2d27;
  --red-pale: #fae8e5;
  --blue: #325f7d;
  --blue-pale: #e6f0f5;
  --shadow-small: 0 8px 24px rgb(28 35 31 / 7%);
  --shadow-large: 0 24px 70px rgb(20 29 24 / 18%);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: var(--ink);
  background: var(--paper);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  min-height: 100%;
  background: var(--paper);
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 8% 0%, rgb(255 255 255 / 82%), transparent 31rem),
    var(--paper);
  color: var(--ink);
}

body.has-overlay {
  overflow: hidden;
}

button,
input,
textarea {
  font: inherit;
}

button {
  color: inherit;
}

button:not(:disabled) {
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.58;
}

[hidden] {
  display: none !important;
}

:focus-visible {
  outline: 3px solid rgb(50 95 125 / 30%);
  outline-offset: 3px;
}

.skip-link {
  position: fixed;
  z-index: 1000;
  top: 12px;
  left: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--ink);
  color: white;
  transform: translateY(-160%);
  transition: transform 160ms ease;
}

.skip-link:focus {
  transform: translateY(0);
}

.eyebrow {
  margin: 0 0 7px;
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  line-height: 1.2;
  text-transform: uppercase;
}

.brand-mark {
  position: relative;
  width: 48px;
  height: 48px;
  margin-bottom: 30px;
}

.brand-mark span {
  position: absolute;
  display: block;
  border: 2px solid var(--ink);
}

.brand-mark span:nth-child(1) {
  inset: 0 18px 18px 0;
}

.brand-mark span:nth-child(2) {
  inset: 10px 8px 8px 10px;
  border-color: var(--forest);
}

.brand-mark span:nth-child(3) {
  inset: 20px 0 0 20px;
}

.brand-mark.small {
  width: 34px;
  height: 34px;
  margin: 0;
}

.brand-mark.small span {
  border-width: 1.5px;
}

.brand-mark.small span:nth-child(1) {
  inset: 0 13px 13px 0;
}

.brand-mark.small span:nth-child(2) {
  inset: 7px 6px 6px 7px;
}

.brand-mark.small span:nth-child(3) {
  inset: 14px 0 0 14px;
}

.login-shell {
  display: grid;
  min-height: 100vh;
  padding: 56px 24px 30px;
  place-items: center;
}

.login-card {
  width: min(100%, 448px);
  padding: 48px;
  border: 1px solid rgb(255 255 255 / 75%);
  border-radius: 3px;
  background: rgb(255 254 250 / 92%);
  box-shadow: var(--shadow-large);
}

.login-card h1 {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", "STSong", serif;
  font-size: clamp(34px, 6vw, 47px);
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.1;
}

.login-intro {
  margin: 15px 0 34px;
  color: var(--ink-soft);
  font-size: 15px;
  line-height: 1.65;
}

.field-label {
  display: block;
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 750;
}

.token-field {
  display: flex;
  min-height: 49px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: white;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.token-field:focus-within {
  border-color: var(--forest);
  box-shadow: 0 0 0 3px rgb(33 79 61 / 10%);
}

.token-field input {
  min-width: 0;
  flex: 1;
  padding: 12px 0 12px 14px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  letter-spacing: 0.03em;
}

.token-field input::placeholder,
.search-field input::placeholder,
textarea::placeholder {
  color: #9ba39e;
}

.text-button {
  min-width: 64px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  color: var(--forest);
  font-size: 13px;
  font-weight: 750;
}

.field-help {
  margin: 9px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.55;
}

.form-error {
  margin: 12px 0 0;
  color: var(--red);
  font-size: 13px;
  line-height: 1.5;
}

.primary-button,
.secondary-button,
.preview-button,
.approve-button,
.reject-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 750;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
}

.primary-button {
  border: 1px solid var(--forest);
  background: var(--forest);
  color: white;
}

.primary-button:hover:not(:disabled),
.approve-button:hover:not(:disabled) {
  background: var(--forest-dark);
}

.secondary-button {
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink);
}

.secondary-button:hover:not(:disabled) {
  border-color: #a6aca5;
  background: white;
}

.login-button {
  width: 100%;
  min-height: 50px;
  margin-top: 24px;
  padding: 0 17px;
}

.button-arrow {
  margin-left: auto;
  font-size: 18px;
}

.login-footer {
  position: fixed;
  bottom: 21px;
  margin: 0;
  color: var(--ink-soft);
  font-size: 11px;
  letter-spacing: 0.06em;
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  height: 72px;
  align-items: center;
  justify-content: space-between;
  padding: 0 max(24px, calc((100vw - 1240px) / 2));
  border-bottom: 1px solid var(--line);
  background: rgb(246 244 238 / 92%);
  backdrop-filter: blur(16px);
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-lockup .eyebrow {
  margin-bottom: 2px;
}

.brand-title {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 18px;
  line-height: 1.1;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 18px;
}

.connection-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
}

.connection-state span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3f8e68;
  box-shadow: 0 0 0 4px rgb(63 142 104 / 12%);
}

.topbar .secondary-button {
  min-height: 35px;
  padding: 0 13px;
  background: transparent;
  font-size: 12px;
}

.main-content {
  width: min(100% - 48px, 1240px);
  margin: 0 auto;
  padding: 62px 0 80px;
}

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 30px;
  margin-bottom: 38px;
}

.page-heading h1 {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: clamp(38px, 5vw, 58px);
  font-weight: 500;
  letter-spacing: -0.045em;
  line-height: 1.05;
}

.page-subtitle {
  margin: 13px 0 0;
  color: var(--ink-soft);
  font-size: 14px;
}

.refresh-button {
  flex: none;
  background: transparent;
}

.refresh-icon {
  font-size: 19px;
  line-height: 1;
}

.is-spinning .refresh-icon {
  animation: spin 650ms linear infinite;
}

.status-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 0;
  border-bottom: 1px solid var(--line-strong);
  scrollbar-width: none;
}

.status-tabs::-webkit-scrollbar {
  display: none;
}

.status-tab {
  position: relative;
  flex: none;
  min-height: 51px;
  padding: 0 20px;
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  font-size: 14px;
  font-weight: 700;
}

.status-tab::after {
  position: absolute;
  right: 12px;
  bottom: -1px;
  left: 12px;
  height: 2px;
  background: transparent;
  content: "";
}

.status-tab:hover,
.status-tab.is-active {
  color: var(--ink);
}

.status-tab.is-active::after {
  background: var(--forest);
}

.tab-count {
  display: inline-grid;
  min-width: 24px;
  height: 22px;
  margin-left: 6px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--paper-deep);
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 22px;
  place-items: center;
}

.status-tab.is-active .tab-count {
  background: var(--forest-pale);
  color: var(--forest);
}

.review-panel {
  min-height: 410px;
  margin-top: 24px;
  padding: 29px 31px 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-small);
}

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.list-toolbar h2 {
  margin: 0 0 5px;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 23px;
  font-weight: 600;
}

.list-toolbar p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
}

.search-field {
  display: flex;
  width: min(100%, 290px);
  height: 41px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fbfaf6;
  color: var(--ink-soft);
}

.search-field:focus-within {
  border-color: var(--forest);
  box-shadow: 0 0 0 3px rgb(33 79 61 / 8%);
}

.search-field span {
  font-size: 20px;
  transform: translateY(-1px);
}

.search-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
}

.level-list {
  display: grid;
  gap: 0;
}

.level-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(220px, 1.6fr) minmax(130px, 0.7fr) minmax(130px, 0.65fr) 36px;
  min-height: 101px;
  align-items: center;
  gap: 22px;
  width: 100%;
  padding: 18px 7px;
  border: 0;
  border-top: 1px solid var(--line);
  background: transparent;
  text-align: left;
}

.level-row:last-child {
  border-bottom: 1px solid var(--line);
}

.level-row:hover {
  z-index: 1;
  border-color: transparent;
  border-radius: 8px;
  background: #f7f8f3;
  box-shadow: 0 1px 0 #f7f8f3;
}

.level-row:hover + .level-row {
  border-top-color: transparent;
}

.level-primary {
  min-width: 0;
}

.row-title-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.level-name {
  overflow: hidden;
  margin: 0;
  font-size: 16px;
  font-weight: 780;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--amber-pale);
  color: var(--amber);
  font-size: 11px;
  font-weight: 800;
}

.status-pill.approved,
.status-pill.published {
  background: var(--forest-pale);
  color: var(--forest);
}

.status-pill.rejected {
  background: var(--red-pale);
  color: var(--red);
}

.level-description {
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.row-meta-label {
  margin: 0 0 5px;
  color: #8a938e;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.row-meta-value {
  overflow: hidden;
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta-subvalue {
  margin: 5px 0 0;
  color: var(--ink-soft);
  font-size: 11px;
}

.difficulty-dots {
  display: flex;
  gap: 4px;
}

.difficulty-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
}

.difficulty-dots span.filled {
  background: var(--forest);
}

.row-arrow {
  display: grid;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 50%;
  color: var(--ink-soft);
  font-size: 19px;
  place-items: center;
  transition: transform 150ms ease, background 150ms ease, color 150ms ease;
}

.level-row:hover .row-arrow {
  background: white;
  color: var(--forest);
  transform: translateX(2px);
}

.loading-state,
.error-state,
.empty-state {
  display: grid;
  min-height: 290px;
  align-content: center;
  justify-items: center;
  padding: 35px;
  text-align: center;
}

.loading-state {
  color: var(--ink-soft);
  font-size: 13px;
}

.spinner {
  width: 23px;
  height: 23px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--forest);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}

.loading-state p,
.drawer-loading p {
  margin: 13px 0 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.state-icon {
  display: grid;
  width: 45px;
  height: 45px;
  margin-bottom: 16px;
  border-radius: 50%;
  background: var(--red-pale);
  color: var(--red);
  font-size: 21px;
  font-weight: 800;
  place-items: center;
}

.empty-icon {
  background: var(--forest-pale);
  color: var(--forest);
}

.error-state h3,
.empty-state h3 {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 22px;
  font-weight: 600;
}

.error-state p,
.empty-state p {
  max-width: 420px;
  margin: 8px 0 20px;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.6;
}

.drawer-layer,
.modal-layer {
  position: fixed;
  z-index: 100;
  inset: 0;
}

.drawer-backdrop,
.modal-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgb(20 27 23 / 46%);
  animation: fade-in 160ms ease both;
}

@keyframes fade-in {
  from { opacity: 0; }
}

.detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  width: min(100%, 650px);
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  box-shadow: -20px 0 70px rgb(20 29 24 / 20%);
  animation: drawer-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes drawer-in {
  from { transform: translateX(30px); opacity: 0; }
}

.drawer-header {
  display: flex;
  flex: none;
  gap: 18px;
  padding: 26px 30px 22px;
  border-bottom: 1px solid var(--line);
}

.icon-button {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  color: var(--ink-soft);
  font-size: 25px;
  font-weight: 300;
  line-height: 1;
  place-items: center;
}

.icon-button:hover {
  border-color: var(--line-strong);
  background: var(--paper);
  color: var(--ink);
}

.drawer-heading {
  min-width: 0;
  padding-top: 2px;
}

.drawer-heading-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.mono-id {
  overflow: hidden;
  color: var(--ink-soft);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-heading h2 {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 29px;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.drawer-heading > p {
  margin: 8px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.55;
}

.drawer-loading,
.drawer-error {
  display: grid;
  min-height: 300px;
  flex: 1;
  align-content: center;
  justify-items: center;
  padding: 30px;
  color: var(--ink-soft);
  font-size: 13px;
  text-align: center;
}

.drawer-error p {
  margin: 0 0 18px;
}

.drawer-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 8px 30px 40px 86px;
}

.detail-section {
  padding: 26px 0;
  border-bottom: 1px solid var(--line);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.section-heading h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}

.section-heading p {
  margin: 5px 0 0;
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 1.5;
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 28px;
  margin: 0;
}

.fact-item {
  min-width: 0;
}

.fact-item.wide {
  grid-column: 1 / -1;
}

.fact-item dt {
  margin-bottom: 5px;
  color: #89928d;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
}

.fact-item dd {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.55;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-item {
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--paper-deep);
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 650;
}

.rejection-note {
  margin: 0;
  padding: 14px 16px;
  border-left: 3px solid var(--red);
  border-radius: 0 6px 6px 0;
  background: var(--red-pale);
  color: var(--red-dark);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.solution-text,
.manifest-details pre {
  overflow: auto;
  max-height: 320px;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #f7f6f1;
  color: #3f4944;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Microsoft YaHei", monospace;
  font-size: 12px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.manifest-details {
  margin-top: 24px;
}

.manifest-details summary {
  color: var(--forest);
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
}

.manifest-details pre {
  max-height: 400px;
  margin-top: 13px;
  white-space: pre;
}

.drawer-actions {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 30px;
  border-top: 1px solid var(--line);
  background: rgb(255 254 250 / 96%);
  box-shadow: 0 -10px 30px rgb(28 35 31 / 5%);
}

.preview-button,
.reject-button,
.approve-button {
  padding: 0 16px;
}

.preview-button {
  border: 1px solid var(--blue);
  background: var(--blue-pale);
  color: var(--blue);
}

.preview-button:hover:not(:disabled) {
  background: #dbeaf1;
}

.review-actions {
  display: flex;
  gap: 9px;
}

.reject-button {
  border: 1px solid #d8a59f;
  background: white;
  color: var(--red);
}

.reject-button:hover:not(:disabled) {
  border-color: var(--red);
  background: var(--red-pale);
}

.approve-button {
  border: 1px solid var(--forest);
  background: var(--forest);
  color: white;
}

.modal-layer {
  z-index: 200;
  display: grid;
  padding: 20px;
  place-items: center;
}

.action-dialog {
  position: relative;
  width: min(100%, 460px);
  padding: 34px;
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-large);
  animation: dialog-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes dialog-in {
  from { transform: translateY(8px) scale(0.98); opacity: 0; }
}

.dialog-icon {
  display: grid;
  width: 42px;
  height: 42px;
  margin-bottom: 20px;
  border-radius: 50%;
  background: var(--forest-pale);
  color: var(--forest);
  font-size: 19px;
  font-weight: 850;
  place-items: center;
}

.dialog-icon.reject {
  background: var(--red-pale);
  color: var(--red);
}

.action-dialog h2 {
  margin: 0;
  font-family: ui-serif, Georgia, "Songti SC", serif;
  font-size: 25px;
  font-weight: 600;
}

.action-dialog > p {
  margin: 11px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.65;
}

.reject-reason {
  margin-top: 23px;
}

.reject-reason textarea {
  width: 100%;
  resize: vertical;
  min-height: 112px;
  padding: 12px 13px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  outline: 0;
  background: white;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.6;
}

.reject-reason textarea:focus {
  border-color: var(--red);
  box-shadow: 0 0 0 3px rgb(157 59 50 / 9%);
}

.reason-meta {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  min-height: 20px;
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: 11px;
}

#reason-error {
  color: var(--red);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 28px;
}

.dialog-actions button {
  min-width: 108px;
}

.toast-region {
  position: fixed;
  z-index: 300;
  right: 24px;
  bottom: 24px;
  display: grid;
  width: min(calc(100% - 48px), 360px);
  gap: 10px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid rgb(255 255 255 / 42%);
  border-radius: 8px;
  background: #26332c;
  box-shadow: var(--shadow-large);
  color: white;
  font-size: 13px;
  line-height: 1.5;
  animation: toast-in 220ms ease both;
}

.toast.error {
  background: var(--red-dark);
}

.toast-mark {
  flex: none;
  font-weight: 850;
}

@keyframes toast-in {
  from { transform: translateY(8px); opacity: 0; }
}

@media (max-width: 760px) {
  .topbar {
    height: 65px;
    padding: 0 18px;
  }

  .connection-state {
    display: none;
  }

  .main-content {
    width: min(100% - 28px, 1240px);
    padding: 40px 0 55px;
  }

  .page-heading {
    align-items: flex-start;
    margin-bottom: 29px;
  }

  .page-subtitle {
    max-width: 280px;
    line-height: 1.55;
  }

  .refresh-button {
    min-width: 42px;
    padding: 0 11px;
    font-size: 0;
  }

  .refresh-icon {
    font-size: 19px;
  }

  .status-tab {
    padding: 0 13px;
  }

  .review-panel {
    min-height: 430px;
    padding: 21px 17px 12px;
  }

  .list-toolbar {
    display: grid;
    gap: 15px;
  }

  .search-field {
    width: 100%;
  }

  .level-row {
    grid-template-columns: minmax(0, 1fr) 30px;
    min-height: 105px;
    gap: 8px;
    padding: 16px 3px;
  }

  .level-row > .row-meta {
    display: none;
  }

  .drawer-header {
    gap: 13px;
    padding: 20px 18px 17px;
  }

  .drawer-heading h2 {
    font-size: 24px;
  }

  .drawer-body {
    padding: 4px 20px 30px;
  }

  .drawer-actions {
    display: grid;
    padding: 13px 16px max(13px, env(safe-area-inset-bottom));
  }

  .preview-button {
    width: 100%;
  }

  .review-actions {
    display: grid;
    grid-template-columns: 0.7fr 1.3fr;
  }

  .review-actions button {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .login-shell {
    align-items: start;
    padding: 28px 14px 80px;
  }

  .login-card {
    padding: 34px 25px;
  }

  .brand-mark {
    margin-bottom: 25px;
  }

  .brand-title,
  .brand-lockup .eyebrow {
    display: none;
  }

  .page-heading h1 {
    font-size: 39px;
  }

  .status-tabs {
    margin-right: -14px;
  }

  .fact-grid {
    grid-template-columns: 1fr;
  }

  .fact-item.wide {
    grid-column: auto;
  }

  .action-dialog {
    padding: 27px 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/*
 * WhiteRoom Studio — Monochrome Signal
 * Shared visual language with the player client: quiet graphite, warm white,
 * precise borders, and colour reserved for review status semantics.
 */

:root {
  --paper: #f7f7f5;
  --paper-deep: #efefec;
  --surface: #ffffff;
  --ink: #111111;
  --ink-soft: #666666;
  --line: #e3e3df;
  --line-strong: #cacac5;
  --forest: #111111;
  --forest-dark: #2a2a2a;
  --forest-pale: #ededeb;
  --amber: #8a5d19;
  --amber-pale: #f7eee0;
  --red: #9b3f37;
  --red-dark: #7f302a;
  --red-pale: #f8e9e7;
  --blue: #242424;
  --blue-pale: #efefed;
  --shadow-small: 0 1px 2px rgb(0 0 0 / 5%), 0 8px 28px rgb(0 0 0 / 5%);
  --shadow-large: 0 28px 80px rgb(0 0 0 / 16%);
  color-scheme: light;
}

html,
body {
  background: var(--paper);
}

body {
  background:
    radial-gradient(circle at 50% -18rem, rgb(255 255 255 / 94%), transparent 42rem),
    var(--paper);
  -webkit-font-smoothing: antialiased;
}

::selection {
  color: #fff;
  background: #111;
}

:focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
  box-shadow: 0 0 0 2px #fff;
}

button:disabled {
  cursor: not-allowed;
  opacity: .5;
}

.eyebrow {
  color: #858585;
  font-weight: 650;
  letter-spacing: .17em;
}

.brand-mark span {
  border-color: #111;
}

.brand-mark span:nth-child(2) {
  border-color: #8b8b8b;
}

.login-shell {
  padding-top: max(48px, env(safe-area-inset-top));
  padding-right: max(24px, env(safe-area-inset-right));
  padding-bottom: max(40px, env(safe-area-inset-bottom));
  padding-left: max(24px, env(safe-area-inset-left));
}

.login-card {
  padding: 46px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgb(255 255 255 / 94%);
  box-shadow: var(--shadow-large);
  backdrop-filter: blur(20px) saturate(.75);
}

.login-card h1,
.page-heading h1,
.list-toolbar h2,
.error-state h3,
.empty-state h3,
.drawer-heading h2,
.action-dialog h2,
.brand-title {
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

.login-card h1,
.page-heading h1 {
  font-weight: 600;
  letter-spacing: -.05em;
}

.token-field,
.search-field,
.reject-reason textarea {
  border-color: var(--line-strong);
  border-radius: 10px;
  background: #fff;
}

.token-field:focus-within,
.search-field:focus-within,
.reject-reason textarea:focus {
  border-color: #444;
  box-shadow: 0 0 0 3px rgb(17 17 17 / 10%);
}

.token-field input::placeholder,
.search-field input::placeholder,
textarea::placeholder {
  color: #969696;
}

.text-button,
.manifest-details summary {
  color: #333;
}

.primary-button,
.secondary-button,
.preview-button,
.approve-button,
.reject-button {
  min-height: 44px;
  border-radius: 10px;
  font-weight: 650;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}

.primary-button,
.approve-button {
  border-color: #111;
  background: #111;
  color: #fff;
}

.primary-button:hover:not(:disabled),
.approve-button:hover:not(:disabled) {
  border-color: #2b2b2b;
  background: #2b2b2b;
}

.secondary-button {
  border-color: var(--line-strong);
  background: #fff;
}

.secondary-button:hover:not(:disabled) {
  border-color: #8f8f8b;
  background: #f3f3f1;
}

.login-button {
  min-height: 50px;
}

.login-footer {
  bottom: max(21px, env(safe-area-inset-bottom));
}

.topbar {
  border-bottom-color: var(--line);
  background: rgb(247 247 245 / 88%);
  backdrop-filter: blur(18px) saturate(.75);
}

.connection-state span {
  background: #267a5b;
  box-shadow: 0 0 0 4px rgb(38 122 91 / 10%);
}

.topbar .secondary-button,
.refresh-button {
  background: transparent;
}

.main-content {
  padding-top: 58px;
}

.page-heading {
  margin-bottom: 34px;
}

.page-heading h1 {
  font-size: clamp(38px, 5vw, 56px);
}

.status-tabs {
  gap: 8px;
  border-bottom-color: var(--line);
}

.status-tab {
  min-height: 48px;
  border-radius: 9px 9px 0 0;
  font-weight: 600;
}

.status-tab:hover {
  background: rgb(17 17 17 / 4%);
}

.status-tab.is-active::after {
  right: 14px;
  left: 14px;
  background: #111;
}

.status-tab.is-active .tab-count {
  background: #111;
  color: #fff;
}

.review-panel {
  padding: 28px 30px 20px;
  border-radius: 16px;
  box-shadow: var(--shadow-small);
}

.list-toolbar h2 {
  font-weight: 600;
}

.search-field {
  min-height: 44px;
  background: #f7f7f5;
}

.level-row {
  border-top-color: var(--line);
  transition: background 120ms ease, border-color 120ms ease;
}

.level-row:hover {
  border-color: transparent;
  border-radius: 12px;
  background: #f3f3f1;
  box-shadow: none;
}

.level-row:hover + .level-row {
  border-top-color: transparent;
}

.level-name {
  font-weight: 650;
}

.row-meta-label,
.fact-item dt {
  color: #858585;
}

.difficulty-dots span.filled,
.spinner {
  border-top-color: #111;
}

.difficulty-dots span.filled {
  background: #111;
}

.level-row:hover .row-arrow {
  background: #fff;
  color: #111;
  transform: translateX(2px);
}

.status-pill {
  border: 1px solid rgb(138 93 25 / 14%);
}

.status-pill.approved,
.status-pill.published {
  color: #267a5b;
  border-color: rgb(38 122 91 / 14%);
  background: #e9f1ed;
}

.status-pill.rejected {
  border-color: rgb(155 63 55 / 14%);
}

.drawer-backdrop,
.modal-backdrop {
  background: rgb(10 10 10 / 44%);
  backdrop-filter: blur(4px);
}

.detail-drawer {
  background: #fff;
  box-shadow: -24px 0 80px rgb(0 0 0 / 18%);
  animation-timing-function: cubic-bezier(.2, .8, .2, 1);
}

.drawer-header,
.drawer-actions {
  border-color: var(--line);
}

.icon-button {
  width: 44px;
  height: 44px;
  border-color: var(--line);
  border-radius: 11px;
}

.icon-button:hover {
  background: #f1f1ef;
}

.drawer-heading h2,
.action-dialog h2 {
  font-weight: 600;
  letter-spacing: -.03em;
}

.tag-item {
  border: 1px solid var(--line);
  background: #f3f3f1;
}

.solution-text,
.manifest-details pre {
  border-radius: 10px;
  background: #f5f5f3;
  color: #333;
}

.drawer-actions {
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 -12px 34px rgb(0 0 0 / 5%);
  backdrop-filter: blur(16px);
}

.preview-button {
  border-color: var(--line-strong);
  background: #f1f1ef;
  color: #222;
}

.preview-button:hover:not(:disabled) {
  border-color: #8f8f8b;
  background: #e7e7e4;
}

.reject-button {
  border-color: rgb(155 63 55 / 34%);
  color: var(--red);
}

.action-dialog {
  padding: 34px;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow-large);
}

.dialog-icon {
  border-radius: 11px;
  background: #ededeb;
  color: #111;
}

.dialog-icon.reject {
  color: var(--red);
  background: var(--red-pale);
}

.toast-region {
  right: max(24px, env(safe-area-inset-right));
  bottom: max(24px, env(safe-area-inset-bottom));
}

.toast {
  border-color: rgb(255 255 255 / 12%);
  border-radius: 12px;
  background: #171717;
  box-shadow: 0 18px 60px rgb(0 0 0 / 20%);
}

@media (max-width: 760px) {
  .topbar {
    padding-right: max(18px, env(safe-area-inset-right));
    padding-left: max(18px, env(safe-area-inset-left));
  }

  .main-content {
    width: min(calc(100% - max(28px, env(safe-area-inset-left) + env(safe-area-inset-right))), 1240px);
  }

  .review-panel {
    border-radius: 14px;
  }

  .drawer-actions {
    padding-right: max(16px, env(safe-area-inset-right));
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    padding-left: max(16px, env(safe-area-inset-left));
  }
}

@media (max-width: 480px) {
  .login-shell {
    padding-top: max(28px, env(safe-area-inset-top));
    padding-right: max(14px, env(safe-area-inset-right));
    padding-bottom: max(80px, env(safe-area-inset-bottom));
    padding-left: max(14px, env(safe-area-inset-left));
  }

  .login-card {
    padding: 34px 24px;
    border-radius: 16px;
  }

  .review-panel {
    padding: 20px 16px 12px;
  }

  .action-dialog {
    padding: 28px 22px;
    border-radius: 16px;
  }
}

/* Dual review workspace: published levels and locally generated AI prop candidates. */
.resource-switch {
  display: inline-flex;
  gap: 5px;
  margin-bottom: 19px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: #ededeb;
}

.resource-button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  padding: 0 17px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 13px;
  font-weight: 650;
}

.resource-button:hover {
  color: var(--ink);
  background: rgb(255 255 255 / 55%);
}

.resource-button.is-active {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
}

.resource-button span {
  font-size: 15px;
}

.status-pill.queued,
.status-pill.cancelled {
  border-color: rgb(102 102 102 / 14%);
  background: #efefed;
  color: #666;
}

.status-pill.running,
.status-pill.publishing {
  border-color: rgb(45 84 110 / 15%);
  background: #eaf0f4;
  color: #2d546e;
}

.status-pill.failed,
.status-pill.publish_failed {
  border-color: rgb(155 63 55 / 14%);
  background: var(--red-pale);
  color: var(--red);
}

.changed-files {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.changed-files li {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f5f5f3;
  color: #333;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Microsoft YaHei", monospace;
  font-size: 11px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.changed-files li.is-empty {
  color: var(--ink-soft);
  font-family: inherit;
}

.release-boundary {
  margin-top: 20px;
  padding: 19px 20px;
  border: 1px solid #d8d8d3;
  border-radius: 11px;
  background: #f3f3f1;
}

.release-boundary .section-heading {
  margin-bottom: 9px;
}

.release-boundary > p {
  margin: 0;
  color: #555;
  font-size: 12px;
  line-height: 1.7;
}

.prop-artifact-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.codex-link {
  padding: 0 15px;
  color: var(--ink);
  text-decoration: none;
  white-space: nowrap;
}

.codex-link:hover {
  border-color: #8f8f8b;
  background: #f3f3f1;
}

@media (max-width: 760px) {
  .resource-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .resource-button {
    justify-content: center;
    padding: 0 10px;
  }

  .prop-artifact-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .prop-artifact-actions > * {
    width: 100%;
  }

  .release-boundary {
    margin-top: 14px;
  }
}

/* ---------------------------------------------------------------------------
   眠海运维面板（沉没巡查 + 梦灾）
--------------------------------------------------------------------------- */

.dreamsea-panel {
  display: grid;
  gap: 20px;
}

.dreamsea-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 24px 26px;
  box-shadow: var(--shadow-small);
}

.dreamsea-card .section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

.dreamsea-card h2 {
  margin: 0 0 4px;
  font-size: 17px;
}

.dreamsea-card .section-heading p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  max-width: 56ch;
}

.patrol-result {
  min-height: 8px;
  font-size: 14px;
}

.patrol-summary {
  margin: 6px 0 0;
  color: var(--forest);
  font-weight: 600;
}

.sunken-list {
  margin: 8px 0 0;
  padding: 0 0 0 2px;
  list-style: none;
  color: var(--blue);
  font-size: 13px;
  display: grid;
  gap: 4px;
}

.calamity-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.calamity-fields .field-label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-soft);
}

.calamity-fields input,
.calamity-fields select {
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 9px 12px;
  background: #fff;
  color: var(--ink);
}

.calamity-fields input:focus,
.calamity-fields select:focus {
  outline: 2px solid var(--forest);
  outline-offset: 1px;
}

.calamity-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.calamity-item {
  display: grid;
  gap: 2px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--amber);
  border-radius: 12px;
  background: var(--amber-pale);
  font-size: 14px;
}

.calamity-item span {
  color: var(--ink-soft);
  font-size: 12px;
}

.calamity-empty {
  color: var(--ink-soft);
  font-size: 14px;
  padding: 6px 0;
}

.report-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.report-controls input {
  width: 130px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 9px 12px;
  background: #fff;
  color: var(--ink);
}

.report-result {
  min-height: 8px;
  font-size: 14px;
}

.report-usage {
  margin: 6px 0 0;
  color: var(--ink-soft);
  font-size: 13px;
}

.advice-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.advice-list li {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--blue);
  border-radius: 10px;
  background: var(--blue-pale);
  font-size: 13px;
}
```

## Portal theme

Source: `public/portal/styles.css`

```css
/* 《眠海》潜航门户 —— 深海夜航主题，自足无外部资源 */

:root {
  --abyss: #050c18;
  --deep: #0a1526;
  --panel: #0f1e33;
  --panel-2: #132741;
  --line: rgba(120, 170, 220, 0.16);
  --line-strong: rgba(120, 170, 220, 0.32);
  --ink: #dce8f5;
  --ink-dim: #8fa8c2;
  --glow: #59c2ff;
  --glow-soft: rgba(89, 194, 255, 0.14);
  --amber: #ffc36b;
  --coral: #ff7a6b;
  --jade: #59e0b2;
  --radius: 14px;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

body {
  background:
    radial-gradient(1100px 500px at 80% -10%, rgba(64, 130, 210, 0.18), transparent 60%),
    radial-gradient(900px 600px at 10% 110%, rgba(30, 80, 140, 0.22), transparent 55%),
    linear-gradient(180deg, var(--abyss), #030710 70%);
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
  line-height: 1.65;
  letter-spacing: 0.01em;
}

.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--glow);
  color: #04121f;
  padding: 8px 14px;
  border-radius: 0 0 8px 0;
  z-index: 40;
}
.skip-link:focus { left: 0; }

/* 漂浮的微光 —— 眠海的呼吸 */
.sea-backdrop {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.drift {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.35;
  animation: drift 26s ease-in-out infinite alternate;
}
.drift-a { width: 420px; height: 420px; background: rgba(64, 140, 220, 0.25); top: -120px; left: 8%; }
.drift-b { width: 320px; height: 320px; background: rgba(90, 200, 255, 0.14); top: 40%; right: -80px; animation-delay: -8s; }
.drift-c { width: 260px; height: 260px; background: rgba(140, 110, 240, 0.12); bottom: -60px; left: 35%; animation-delay: -16s; }
@keyframes drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(40px, 30px, 0) scale(1.12); }
}
@media (prefers-reduced-motion: reduce) {
  .drift { animation: none; }
}

.topbar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px clamp(16px, 4vw, 44px);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-glyph {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(160deg, var(--panel-2), var(--panel));
  border: 1px solid var(--line-strong);
  color: var(--glow);
  font-size: 20px;
}
.brand-name { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.2em; }
.brand-sub { margin: 0; font-size: 12px; color: var(--ink-dim); }
.dream-time {
  margin: 0 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
  font-size: 13px;
}
.identity-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink-dim);
  max-width: 300px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sigil-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--jade);
  box-shadow: 0 0 8px var(--jade);
}

.calamity-banner {
  position: relative;
  z-index: 2;
  margin: 0;
  padding: 10px clamp(16px, 4vw, 44px);
  background: linear-gradient(90deg, rgba(255, 122, 107, 0.16), rgba(255, 195, 107, 0.1));
  border-bottom: 1px solid rgba(255, 150, 110, 0.35);
  color: var(--amber);
  font-size: 13px;
}

.deck-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 6px;
  padding: 10px clamp(16px, 4vw, 44px);
  background: rgba(5, 12, 24, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
}
.deck-tab {
  flex: none;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-dim);
  font: inherit;
  font-size: 14px;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.2s, background 0.2s, border-color 0.2s;
}
.deck-tab:hover { color: var(--ink); }
.deck-tab.is-active {
  color: var(--glow);
  background: var(--glow-soft);
  border-color: rgba(89, 194, 255, 0.4);
}

.main-content {
  position: relative;
  z-index: 1;
  max-width: 1080px;
  margin: 0 auto;
  padding: clamp(20px, 4vw, 40px) clamp(16px, 4vw, 44px) 80px;
}

.deck-title {
  margin: 40px 0 8px;
  font-size: 18px;
  letter-spacing: 0.08em;
  color: var(--ink);
}
.deck-title::before { content: '〰 '; color: var(--glow); }
.deck-note { margin: 0 0 16px; color: var(--ink-dim); font-size: 14px; }
.sub-title { margin: 20px 0 10px; font-size: 15px; color: var(--ink); }

.hero { padding: 26px 0 4px; }
.hero-eyebrow { margin: 0; color: var(--glow); font-size: 13px; letter-spacing: 0.28em; }
.hero h1 {
  margin: 10px 0 14px;
  font-size: clamp(24px, 4.2vw, 38px);
  line-height: 1.3;
  background: linear-gradient(120deg, #eaf4ff, #9ed2ff 70%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-lede { max-width: 640px; color: var(--ink-dim); }

.notice-card {
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  color: var(--amber);
  font-size: 13px;
  background: rgba(255, 195, 107, 0.05);
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 14px;
}
.law-card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: linear-gradient(165deg, var(--panel), rgba(15, 30, 51, 0.4));
}
.law-card h3 { margin: 0 0 8px; font-size: 16px; color: var(--glow); }
.law-card p { margin: 0; font-size: 13px; }
.law-text { color: var(--ink); margin-bottom: 8px !important; }
.law-mech { color: var(--ink-dim); }
.law-card.compact p { color: var(--ink-dim); }

.strata-list, .rank-ladder {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}
.strata-list li, .rank-ladder li {
  display: flex;
  gap: 14px;
  align-items: baseline;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(15, 30, 51, 0.45);
  font-size: 14px;
}
.strata-list strong, .rank-ladder strong { flex: none; width: 4.5em; color: var(--glow); }
.strata-list span, .rank-ladder span { color: var(--ink-dim); }
.rank-ladder { counter-reset: rank; }
.rank-ladder li::before {
  counter-increment: rank;
  content: counter(rank);
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  font-size: 12px;
  color: var(--ink-dim);
}

.etiquette-list { margin: 0; padding: 0 0 0 1.2em; color: var(--ink-dim); font-size: 14px; }

.glossary { margin-top: 36px; border: 1px solid var(--line); border-radius: var(--radius); }
.glossary summary {
  cursor: pointer;
  padding: 14px 18px;
  color: var(--ink-dim);
  font-size: 14px;
}
.glossary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.glossary-table th, .glossary-table td {
  text-align: left;
  padding: 8px 18px;
  border-top: 1px solid var(--line);
  vertical-align: top;
}
.glossary-table th { color: var(--ink-dim); font-weight: 500; }
.glossary-table td:first-child { color: var(--glow); white-space: nowrap; }
.glossary-table td { color: var(--ink-dim); }

/* 我的眠海 */
.totem-stage { display: flex; }
.totem-card {
  min-width: min(420px, 100%);
  padding: 26px 30px;
  border-radius: 18px;
  border: 1px solid var(--line-strong);
  background:
    radial-gradient(240px 130px at 30% 0%, rgba(89, 194, 255, 0.12), transparent),
    linear-gradient(160deg, var(--panel-2), var(--panel));
  box-shadow: 0 18px 50px rgba(2, 8, 18, 0.55);
}
.totem-placeholder { margin: 0; color: var(--ink-dim); }
.totem-form { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.12em; color: #eaf4ff; }
.totem-description { margin: 10px 0; color: var(--ink-dim); font-size: 14px; }
.totem-sigil { margin: 12px 0 0; font-size: 13px; color: var(--ink-dim); }
.totem-sigil code {
  color: var(--jade);
  background: rgba(89, 224, 178, 0.08);
  border: 1px solid rgba(89, 224, 178, 0.25);
  border-radius: 6px;
  padding: 2px 8px;
}
.totem-lore { margin: 14px 0 0; font-size: 12px; color: var(--ink-dim); opacity: 0.8; }

.journey-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}
.journey-panel > div {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(15, 30, 51, 0.45);
}
.rank-label { margin: 0 0 6px; font-size: 12px; color: var(--ink-dim); letter-spacing: 0.2em; }
.rank-name { margin: 0; font-size: 26px; font-weight: 700; color: var(--glow); }
.rank-name.small { font-size: 18px; }
.rank-grants { margin: 10px 0 0; padding: 0 0 0 1.1em; font-size: 13px; color: var(--ink-dim); }
.progress-line { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12px; }
.progress-label { flex: none; width: 5em; color: var(--ink-dim); }
.progress-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: rgba(120, 170, 220, 0.12);
  overflow: hidden;
}
.progress-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--glow), var(--jade));
  transition: width 0.6s ease;
}
.progress-nums { flex: none; color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.counts-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px 14px;
  font-size: 13px;
}
.counts-grid dt { color: var(--ink-dim); }
.counts-grid dd { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }

.asset-panel { border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; background: rgba(15, 30, 51, 0.35); }
.asset-list { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; font-size: 14px; }
.asset-list li { padding: 8px 0; border-top: 1px solid var(--line); }
.asset-list a { color: var(--glow); }
.form-hint { margin: 8px 0 0; font-size: 12px; color: var(--ink-dim); }

/* 表单元素 */
.inline-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}
.inline-form label, .stacked-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.inline-form label.grow { flex: 1 1 240px; }
.stacked-form { display: grid; gap: 12px; margin: 14px 0; }
input, select, textarea {
  font: inherit;
  color: var(--ink);
  background: rgba(6, 14, 26, 0.8);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 9px 12px;
  min-width: 0;
}
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 2px solid rgba(89, 194, 255, 0.55);
  outline-offset: 1px;
}
.file-label input { padding: 6px; }

.primary-button, .secondary-button {
  appearance: none;
  font: inherit;
  border-radius: 10px;
  padding: 9px 18px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s;
}
.primary-button {
  border: none;
  color: #04121f;
  font-weight: 600;
  background: linear-gradient(120deg, var(--glow), #8fd8ff);
  box-shadow: 0 6px 18px rgba(89, 194, 255, 0.25);
}
.primary-button:hover { transform: translateY(-1px); }
.secondary-button {
  border: 1px solid var(--line-strong);
  background: rgba(15, 30, 51, 0.6);
  color: var(--ink);
}
.secondary-button:hover { background: var(--panel-2); }
.primary-button.small, .secondary-button.small { padding: 5px 12px; font-size: 12px; border-radius: 8px; }

/* 海图 */
.chart-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.chart-toolbar p { margin: 0; font-size: 13px; color: var(--ink-dim); }
.level-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.level-card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: rgba(15, 30, 51, 0.5);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease, border-color 0.2s;
}
.level-card:hover { transform: translateY(-3px); border-color: var(--line-strong); }
.level-cover { aspect-ratio: 16 / 9; background: #060d18; }
.level-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.level-body { padding: 14px 16px 16px; display: grid; gap: 6px; }
.level-body h3 { margin: 0; font-size: 16px; }
.level-desc { margin: 0; font-size: 13px; color: var(--ink-dim); }
.level-meta { font-size: 12px; }
.dive-button { margin-top: 8px; justify-self: start; }
.muted { color: var(--ink-dim); font-size: 13px; }
.empty-note { color: var(--ink-dim); font-size: 14px; padding: 12px 0; }

/* 明海大厅 */
.online-chip {
  margin: 0 0 0 auto;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(89, 224, 178, 0.35);
  color: var(--jade);
  font-size: 12px;
}
.lobby-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 6px;
}
.plot-list { display: grid; gap: 10px; }
.plot-card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 14px;
  background: rgba(15, 30, 51, 0.45);
  font-size: 13px;
}
.plot-card.is-mine { border-color: rgba(89, 224, 178, 0.4); }
.plot-head { display: flex; align-items: center; gap: 10px; }
.plot-tag {
  font-size: 11px;
  color: var(--jade);
  border: 1px solid rgba(89, 224, 178, 0.35);
  border-radius: 999px;
  padding: 1px 8px;
}
.plot-card p { margin: 4px 0 0; }
.plot-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.object-list { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; }
.object-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-top: 1px solid var(--line);
}
.object-actions { margin-left: auto; }
.event-feed { margin: 8px 0 0; padding: 0; list-style: none; font-size: 12px; color: var(--ink-dim); display: grid; gap: 4px; }
.event-feed li { border-left: 2px solid var(--line-strong); padding-left: 10px; }

/* 念脉 */
.lineage-result {
  margin: 16px 0 30px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(15, 30, 51, 0.45);
  font-size: 14px;
}
.lineage-result p { margin: 4px 0; }
.echo-list { margin: 10px 0 0; padding: 0 0 0 1.2em; color: var(--ink-dim); font-size: 13px; }
.echo-list .is-honored { color: var(--jade); }
.lore-line { color: var(--ink-dim); font-size: 12px; opacity: 0.85; margin-top: 10px !important; }

/* 迷失域 */
.abyss-gate {
  padding: 16px 18px;
  border: 1px dashed rgba(255, 195, 107, 0.4);
  border-radius: var(--radius);
  color: var(--amber);
  font-size: 14px;
  background: rgba(255, 195, 107, 0.05);
}
.abyss-list { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.abyss-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background:
    linear-gradient(180deg, rgba(10, 21, 38, 0.9), rgba(5, 10, 20, 0.9));
  font-size: 14px;
}
.abyss-item strong { color: var(--ink); }
.abyss-item button { margin-left: auto; flex: none; }

/* 愿念 */
.wish-list { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.wish-item {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 16px;
  background: rgba(15, 30, 51, 0.45);
}
.wish-prompt { margin: 0; font-size: 14px; }
textarea { resize: vertical; }

.site-footer {
  position: relative;
  z-index: 1;
  padding: 26px clamp(16px, 4vw, 44px);
  border-top: 1px solid var(--line);
  color: var(--ink-dim);
  font-size: 12px;
  text-align: center;
}

/* Toast */
.toast-region {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: grid;
  gap: 8px;
  z-index: 60;
  max-width: min(90vw, 380px);
}
.toast {
  margin: 0;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: rgba(10, 21, 38, 0.95);
  color: var(--ink);
  font-size: 13px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  box-shadow: 0 10px 30px rgba(2, 8, 18, 0.5);
}
.toast.is-visible { opacity: 1; transform: translateY(0); }
.toast-success { border-color: rgba(89, 224, 178, 0.45); }
.toast-error { border-color: rgba(255, 122, 107, 0.5); color: #ffd9d3; }

@media (max-width: 640px) {
  .topbar { flex-wrap: wrap; }
  .dream-time { order: 3; width: 100%; margin: 4px 0 0; }
}
```
