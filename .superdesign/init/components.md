# Shared UI primitives

The repository uses framework-free HTML/CSS/JavaScript. Reusable primitives are expressed as CSS classes and semantic HTML rather than imported components.

## Admin primitives and page shell

- Source: `public/admin/index.html`
- Includes buttons, tabs, search fields, status pills, cards, drawers, dialogs, form rows, progress and empty/error states.

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#f7f7f5" />
    <title>眠海 · 审势台</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23f6f4ee'/%3E%3Cpath d='M4 20c3-4 6-4 9 0s6 4 9 0 4-3 6-1' stroke='%23214f3d' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3Ccircle cx='23' cy='9' r='2.6' fill='%239d641d'/%3E%3C/svg%3E" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#review-list">跳到内容列表</a>

    <section class="login-shell" id="login-view" aria-labelledby="login-title">
      <div class="login-card">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <p class="eyebrow">《眠海》平台 · WhiteRoom Studio</p>
        <h1 id="login-title">审势台</h1>
        <p class="login-intro">输入管理员令牌，行使沉重律裁定：审核梦域（关卡）与潜流凝结的 AI 梦物，并主持梦灾与沉没巡查。</p>

        <form id="login-form" novalidate>
          <label class="field-label" for="token-input">管理员令牌</label>
          <div class="token-field">
            <input
              id="token-input"
              name="token"
              type="password"
              autocomplete="off"
              spellcheck="false"
              required
              aria-describedby="token-help login-error"
              placeholder="粘贴令牌"
            />
            <button class="text-button" id="toggle-token" type="button" aria-pressed="false">显示</button>
          </div>
          <p class="field-help" id="token-help">令牌只保留在当前页面内存中，刷新或关闭页面后自动清除。</p>
          <p class="form-error" id="login-error" role="alert" hidden></p>
          <button class="primary-button login-button" id="login-button" type="submit">
            <span>进入审核台</span>
            <span class="button-arrow" aria-hidden="true">→</span>
          </button>
        </form>
      </div>
      <p class="login-footer">仅限眠海内容管理员使用 · 眠海不审判，它只是浮不起某些东西</p>
    </section>

    <div class="app-shell" id="app-view" hidden>
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark small" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div>
            <p class="eyebrow">眠海</p>
            <p class="brand-title">审势台</p>
          </div>
        </div>
        <div class="topbar-actions">
          <p class="connection-state"><span aria-hidden="true"></span> 已安全连接</p>
          <button class="secondary-button" id="logout-button" type="button">退出</button>
        </div>
      </header>

      <main class="main-content">
        <section class="page-heading" aria-labelledby="page-title">
          <div>
            <p class="eyebrow">内容管理</p>
            <h1 id="page-title">关卡审核</h1>
            <p class="page-subtitle">先打开隔离试玩，再批准发布或填写拒绝原因。</p>
          </div>
          <button class="secondary-button refresh-button" id="refresh-button" type="button">
            <span class="refresh-icon" aria-hidden="true">↻</span>
            刷新
          </button>
        </section>

        <nav class="resource-switch" aria-label="选择审核内容">
          <button class="resource-button is-active" type="button" data-resource="levels" aria-current="page">
            <span aria-hidden="true">◇</span>
            关卡投稿
          </button>
          <button class="resource-button" type="button" data-resource="props">
            <span aria-hidden="true">✦</span>
            AI 物件创作
          </button>
          <button class="resource-button" type="button" data-resource="dreamsea">
            <span aria-hidden="true">〰</span>
            眠海运维
          </button>
        </nav>

        <nav class="status-tabs" id="status-tabs" aria-label="按审核状态筛选">
          <button class="status-tab is-active" type="button" data-resource="levels" data-status="pending" aria-current="page">
            待审核 <span class="tab-count" data-count="pending">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="levels" data-status="approved">
            已发布 <span class="tab-count" data-count="approved">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="levels" data-status="rejected">
            已拒绝 <span class="tab-count" data-count="rejected">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="pending_review" hidden>
            待审核 <span class="tab-count" data-count="pending_review">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="queued" hidden>
            排队中 <span class="tab-count" data-count="queued">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="running" hidden>
            处理中 <span class="tab-count" data-count="running">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="approved" hidden>
            已完成 <span class="tab-count" data-count="approved">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="rejected" hidden>
            已驳回 <span class="tab-count" data-count="rejected">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="failed" hidden>
            处理失败 <span class="tab-count" data-count="failed">–</span>
          </button>
          <button class="status-tab" type="button" data-resource="props" data-status="cancelled" hidden>
            已取消 <span class="tab-count" data-count="cancelled">–</span>
          </button>
        </nav>

        <section class="review-panel" aria-live="polite" aria-busy="false">
          <div class="list-toolbar">
            <div>
              <h2 id="list-title">待审核关卡</h2>
              <p id="list-summary">正在读取关卡…</p>
            </div>
            <label class="search-field" for="search-input">
              <span aria-hidden="true">⌕</span>
              <input id="search-input" type="search" placeholder="搜索名称、作者或 ID" autocomplete="off" />
            </label>
          </div>

          <div class="loading-state" id="loading-state">
            <span class="spinner" aria-hidden="true"></span>
            <p>正在读取关卡…</p>
          </div>

          <div class="error-state" id="error-state" hidden>
            <div class="state-icon" aria-hidden="true">!</div>
            <h3>暂时无法读取关卡</h3>
            <p id="error-message">请稍后再试。</p>
            <button class="secondary-button" id="retry-button" type="button">重新加载</button>
          </div>

          <div class="empty-state" id="empty-state" hidden>
            <div class="state-icon empty-icon" aria-hidden="true">✓</div>
            <h3 id="empty-title">没有待审核关卡</h3>
            <p id="empty-message">新的关卡提交后会出现在这里。</p>
          </div>

          <div class="level-list" id="review-list" tabindex="-1"></div>
        </section>

        <section class="dreamsea-panel" id="dreamsea-panel" hidden aria-labelledby="dreamsea-patrol-title">
          <article class="dreamsea-card">
            <div class="section-heading">
              <div>
                <h2 id="dreamsea-patrol-title">沉没巡查（浮力法则）</h2>
                <p>梦以被梦见为生。巡查会让久无人访问的已发布梦域没入迷失域（移出海图但不删除），深潜者可打捞复浮。</p>
              </div>
              <button class="secondary-button" id="patrol-button" type="button">立即巡查</button>
            </div>
            <div class="patrol-result" id="patrol-result" aria-live="polite"></div>
          </article>

          <article class="dreamsea-card">
            <div class="section-heading">
              <div>
                <h2>宣告梦灾（限时事件）</h2>
                <p>当过多相互矛盾的愿念对撞，成片域理会发生紊乱。梦灾无法预告，只能响应；到期自然消散。</p>
              </div>
            </div>
            <form id="calamity-form" novalidate>
              <div class="calamity-fields">
                <label class="field-label" for="calamity-title">事件名称（必填，≤80 字）
                  <input id="calamity-title" maxlength="80" required placeholder="滤念过载：低语潮" />
                </label>
                <label class="field-label" for="calamity-note">公告（≤240 字）
                  <input id="calamity-note" maxlength="240" placeholder="成片域理紊乱，请勿单独下潜。" />
                </label>
                <label class="field-label" for="calamity-channel">限定频道（留空为全服）
                  <input id="calamity-channel" placeholder="0000" />
                </label>
                <label class="field-label" for="calamity-duration">持续时长
                  <select id="calamity-duration">
                    <option value="1800000">30 分钟</option>
                    <option value="3600000" selected>1 小时</option>
                    <option value="21600000">6 小时</option>
                    <option value="86400000">24 小时</option>
                  </select>
                </label>
              </div>
              <p class="form-error" id="calamity-error" role="alert" hidden></p>
              <button class="primary-button" id="calamity-submit" type="submit">宣告梦灾</button>
            </form>
          </article>

          <article class="dreamsea-card">
            <div class="section-heading">
              <div>
                <h2>进行中的梦灾</h2>
                <p>玩家门户与世界观接口会实时展示以下事件。</p>
              </div>
            </div>
            <ul class="calamity-list" id="calamity-list"></ul>
          </article>

          <article class="dreamsea-card">
            <div class="section-heading">
              <div>
                <h2>资产体检（加载性能）</h2>
                <p>盘点 Avatar 与 GLB 梦物的体积、纹理与三角形，核算指定频道的动态首载负荷——用数据回答「卡顿是否因 3D 资产过大」。</p>
              </div>
              <form class="report-controls" id="asset-report-form">
                <input id="report-channel" value="0000" aria-label="频道" />
                <button class="secondary-button" id="report-button" type="submit">体检</button>
              </form>
            </div>
            <div class="report-result" id="report-result" aria-live="polite"></div>
          </article>
        </section>
      </main>
    </div>

    <div class="drawer-layer" id="detail-layer" hidden>
      <button class="drawer-backdrop" id="drawer-backdrop" type="button" aria-label="关闭内容详情"></button>
      <aside
        class="detail-drawer"
        id="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-name"
        aria-describedby="detail-description"
      >
        <div class="drawer-header">
          <button class="icon-button" id="close-detail" type="button" aria-label="关闭详情">×</button>
          <div class="drawer-heading">
            <div class="drawer-heading-line">
              <span class="status-pill" id="detail-status">待审核</span>
              <span class="mono-id" id="detail-id"></span>
            </div>
            <h2 id="detail-name">关卡详情</h2>
            <p id="detail-description"></p>
          </div>
        </div>

        <div class="drawer-loading" id="detail-loading">
          <span class="spinner" aria-hidden="true"></span>
          <p>正在读取详情…</p>
        </div>

        <div class="drawer-error" id="detail-error" hidden>
          <p id="detail-error-message">详情加载失败。</p>
          <button class="secondary-button" id="detail-retry" type="button">重试</button>
        </div>

        <div class="drawer-body" id="detail-content" hidden>
          <section class="detail-section overview-section" aria-labelledby="overview-title">
            <div class="section-heading">
              <h3 id="overview-title">审核摘要</h3>
            </div>
            <dl class="fact-grid" id="fact-grid"></dl>
          </section>

          <section class="detail-section" id="rejection-section" aria-labelledby="rejection-title" hidden>
            <div class="section-heading">
              <h3 id="rejection-title">拒绝原因</h3>
            </div>
            <p class="rejection-note" id="rejection-note"></p>
          </section>

          <section class="detail-section" id="prompt-section" aria-labelledby="prompt-title" hidden>
            <div class="section-heading">
              <div>
                <h3 id="prompt-title">玩家创作需求</h3>
                <p>以下文本仅作为不可信创作输入，不会在页面中执行</p>
              </div>
            </div>
            <pre class="solution-text" id="prompt-text"></pre>
          </section>

          <section class="detail-section" id="changed-files-section" aria-labelledby="changed-files-title" hidden>
            <div class="section-heading">
              <div>
                <h3 id="changed-files-title">候选代码变更</h3>
                <p>仅列出本机校验器允许的文件路径</p>
              </div>
            </div>
            <ul class="changed-files" id="changed-files-list"></ul>
          </section>

          <section class="detail-section release-boundary" id="release-boundary" hidden aria-labelledby="release-boundary-title">
            <div class="section-heading">
              <div>
                <h3 id="release-boundary-title">发布记录</h3>
                <p>自动发布会在安全校验通过后由本机 Worker 完成合并、构建、部署与线上验证。</p>
              </div>
            </div>
            <p>候选包、变更文件与最终发布结果都会保留在这里；启用自动发布前的人工审核记录仍按原状态展示。</p>
          </section>

          <section class="detail-section" id="solution-section" aria-labelledby="solution-title">
            <div class="section-heading">
              <div>
                <h3 id="solution-title">官方攻略</h3>
                <p>试玩时可对照检查是否能够正常通关</p>
              </div>
            </div>
            <pre class="solution-text" id="solution-text"></pre>
          </section>

          <details class="manifest-details" id="manifest-details">
            <summary>查看完整关卡清单</summary>
            <pre id="manifest-text"></pre>
          </details>
        </div>

        <footer class="drawer-actions" id="drawer-actions" hidden>
          <button class="preview-button" id="preview-button" type="button">
            <span aria-hidden="true">↗</span>
            打开隔离试玩
          </button>
          <div class="prop-artifact-actions" id="prop-artifact-actions" hidden>
            <button class="preview-button" id="artifact-button" type="button">
              <span aria-hidden="true">↓</span>
              下载候选 .wrprop
            </button>
            <a class="secondary-button codex-link" id="codex-link" href="codex://threads/" hidden>
              在这台 Mac 的 Codex 中打开
            </a>
          </div>
          <div class="review-actions" id="review-actions">
            <button class="reject-button" id="reject-button" type="button">拒绝</button>
            <button class="approve-button" id="approve-button" type="button">
              <span aria-hidden="true">✓</span>
              批准发布
            </button>
          </div>
        </footer>
      </aside>
    </div>

    <div class="modal-layer" id="action-modal" hidden>
      <button class="modal-backdrop" id="modal-backdrop" type="button" aria-label="取消操作"></button>
      <section class="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-title">
        <div class="dialog-icon" id="action-icon" aria-hidden="true">✓</div>
        <h2 id="action-title">批准发布这个关卡？</h2>
        <p id="action-description">批准后，所有玩家都能在关卡目录中看到并进入它。</p>

        <div class="reject-reason" id="reject-reason" hidden>
          <label class="field-label" for="reason-input">拒绝原因</label>
          <textarea
            id="reason-input"
            maxlength="500"
            rows="5"
            placeholder="请说明需要修改的问题，创作者会看到这段内容。"
          ></textarea>
          <div class="reason-meta">
            <span id="reason-error" role="alert"></span>
            <span><span id="reason-count">0</span>/500</span>
          </div>
        </div>

        <div class="dialog-actions">
          <button class="secondary-button" id="cancel-action" type="button">取消</button>
          <button class="approve-button" id="confirm-action" type="button">确认批准</button>
        </div>
      </section>
    </div>

    <div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="true"></div>

    <script type="module" src="./app.js"></script>
  </body>
</html>
```

## Portal primitives and page shell

- Source: `public/portal/index.html`
- Includes dark navigation, identity chips, cards, upload forms, lists and operational panels.

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#050c18" />
    <title>眠海 · 潜航门户</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23050c18'/%3E%3Cpath d='M4 20c3-4 6-4 9 0s6 4 9 0 4-3 6-1' stroke='%2359c2ff' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3Ccircle cx='23' cy='9' r='2.6' fill='%23ffc36b'/%3E%3C/svg%3E" />
    <link rel="stylesheet" href="/portal/styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#main-content">跳到主要内容</a>

    <div class="sea-backdrop" aria-hidden="true">
      <span class="drift drift-a"></span>
      <span class="drift drift-b"></span>
      <span class="drift drift-c"></span>
    </div>

    <header class="topbar">
      <div class="brand">
        <span class="brand-glyph" aria-hidden="true">〰</span>
        <div>
          <p class="brand-name">眠海</p>
          <p class="brand-sub">潜航门户 · WhiteRoom</p>
        </div>
      </div>
      <p class="dream-time" id="dream-time" title="标准梦时：全海时间被钉死于岸上时间">标准梦时 --:--:--</p>
      <div class="identity-chip" id="identity-chip" hidden>
        <span class="sigil-dot" aria-hidden="true"></span>
        <span id="identity-label">未接入</span>
      </div>
    </header>

    <div class="calamity-banner" id="calamity-banner" hidden role="status"></div>

    <nav class="deck-nav" aria-label="选择区域" id="deck-nav">
      <button class="deck-tab is-active" type="button" data-deck="world" aria-current="page">总纲</button>
      <button class="deck-tab" type="button" data-deck="self">我的眠海</button>
      <button class="deck-tab" type="button" data-deck="chart">海图</button>
      <button class="deck-tab" type="button" data-deck="lobby">明海大厅</button>
      <button class="deck-tab" type="button" data-deck="lineage">念脉</button>
      <button class="deck-tab" type="button" data-deck="abyss">迷失域</button>
      <button class="deck-tab" type="button" data-deck="wish">愿念</button>
    </nav>

    <main class="main-content" id="main-content">
      <!-- 总纲 -->
      <section class="deck" data-deck-panel="world">
        <div class="hero">
          <p class="hero-eyebrow">《眠海》世界观 v0.1</p>
          <h1>在眠海中，想象即施工，同行即共梦。</h1>
          <p class="hero-lede" id="world-lede">
            在人类共享的现实之下，存在一片由全体人类的睡梦沉积而成的意识海洋。
            你手中的这套潜航协议，让你第一次得以清醒地、结伴地潜入，并留下不随醒来而消散的造物。
          </p>
          <div class="notice-card" id="engine-notice" hidden></div>
        </div>

        <h2 class="deck-title">三条海律</h2>
        <div class="card-grid" id="sea-laws"></div>

        <h2 class="deck-title">层带</h2>
        <ol class="strata-list" id="strata-list"></ol>

        <h2 class="deck-title">潜航协议 · 四功能</h2>
        <div class="card-grid" id="protocol-grid"></div>

        <h2 class="deck-title">阶位</h2>
        <ol class="rank-ladder" id="rank-ladder"></ol>

        <h2 class="deck-title">共梦礼仪</h2>
        <ul class="etiquette-list" id="etiquette-list"></ul>

        <details class="glossary">
          <summary>术语表（世界观 ↔ 产品机制）</summary>
          <table class="glossary-table">
            <thead><tr><th>术语</th><th>释义</th><th>对应机制</th></tr></thead>
            <tbody id="glossary-body"></tbody>
          </table>
        </details>
      </section>

      <!-- 我的眠海 -->
      <section class="deck" data-deck-panel="self" hidden>
        <h2 class="deck-title">图腾</h2>
        <p class="deck-note">初次下潜时由你的潜意识自发凝结。不可指定，不可转让，在他人眼中永远失焦。醒后先看图腾。</p>
        <div class="totem-stage">
          <div class="totem-card" id="totem-card">
            <p class="totem-placeholder" id="totem-placeholder">正在下潜，等待图腾凝成…</p>
            <div class="totem-body" id="totem-body" hidden>
              <p class="totem-form" id="totem-form"></p>
              <p class="totem-description" id="totem-description"></p>
              <p class="totem-sigil">凝痕 <code id="totem-sigil"></code></p>
              <p class="totem-lore" id="totem-lore"></p>
            </div>
          </div>
        </div>

        <h2 class="deck-title">旅程与阶位</h2>
        <div class="journey-panel" id="journey-panel">
          <div class="rank-now">
            <p class="rank-label">当前阶位</p>
            <p class="rank-name" id="rank-name">—</p>
            <ul class="rank-grants" id="rank-grants"></ul>
          </div>
          <div class="rank-next" id="rank-next-block">
            <p class="rank-label">下一阶位</p>
            <p class="rank-name small" id="next-rank-name">—</p>
            <div id="next-rank-progress"></div>
          </div>
          <div class="journey-counts">
            <p class="rank-label">旅程留痕</p>
            <dl class="counts-grid" id="counts-grid"></dl>
          </div>
        </div>

        <h2 class="deck-title">我的梦物（GLB 资产）</h2>
        <div class="asset-panel">
          <form class="inline-form" id="asset-upload-form">
            <label>名称 <input id="asset-name" maxlength="40" required placeholder="云朵沙发" /></label>
            <label>类别 <input id="asset-category" maxlength="20" required placeholder="家具" /></label>
            <label>缩放 <input id="asset-scale" value="1" size="4" /></label>
            <label class="file-label">GLB 文件 <input id="asset-file" type="file" accept=".glb" required /></label>
            <button class="primary-button" type="submit">凝结上传</button>
          </form>
          <p class="form-hint">上传即入念脉；与他人相同的字节会自动记为回响。</p>
          <ul class="asset-list" id="asset-list"></ul>
        </div>
      </section>

      <!-- 海图 -->
      <section class="deck" data-deck-panel="chart" hidden>
        <h2 class="deck-title">明海海图</h2>
        <p class="deck-note">锚定于明海的梦域。梦以被梦见为生——下潜即为它续浮力；久无人至的梦域会缓缓沉入迷失域。</p>
        <div class="chart-toolbar">
          <button class="secondary-button" id="chart-refresh" type="button">刷新海图</button>
          <p id="chart-summary"></p>
        </div>
        <div class="level-grid" id="level-grid"></div>
        <p class="empty-note" id="chart-empty" hidden>海图上暂时没有漂浮的梦域。</p>
      </section>

      <!-- 明海大厅 -->
      <section class="deck" data-deck-panel="lobby" hidden>
        <h2 class="deck-title">明海大厅</h2>
        <p class="deck-note">共梦区的实时状态。认领家园地块即为「投锚」；梦主可授予访客共笔权，受共笔者可在地块内凝结梦物。</p>
        <form class="inline-form" id="lobby-channel-form">
          <label>频道 <input id="lobby-channel" value="0000" pattern="[0-9]{4,12}|space-[0-9]{4,12}-(heaven|hell)" /></label>
          <button class="secondary-button" type="submit">进入频道</button>
          <p class="online-chip" id="lobby-online" hidden></p>
        </form>

        <div class="lobby-columns">
          <div>
            <h3 class="sub-title">家园地块</h3>
            <div class="plot-list" id="plot-list"></div>
          </div>
          <div>
            <h3 class="sub-title">域内梦物</h3>
            <form class="inline-form" id="object-create-form">
              <label>目录 <select id="object-catalog"></select></label>
              <label>x <input id="object-x" value="2" size="4" /></label>
              <label>z <input id="object-z" value="2" size="4" /></label>
              <button class="secondary-button" type="submit">凝结摆放</button>
            </form>
            <ul class="object-list" id="object-list"></ul>
          </div>
        </div>

        <h3 class="sub-title">潮汐记录（实时）</h3>
        <ul class="event-feed" id="event-feed"></ul>
      </section>

      <!-- 念脉 -->
      <section class="deck" data-deck-panel="lineage" hidden>
        <h2 class="deck-title">念脉查询</h2>
        <p class="deck-note">潜流记得一切凝结的来历。你可以模仿任何东西，但你无法隐瞒你在模仿。</p>
        <form class="inline-form" id="lineage-form">
          <label class="grow">内容哈希（sha256）<input id="lineage-hash" pattern="[a-f0-9]{64}" placeholder="64 位十六进制" required /></label>
          <button class="secondary-button" type="submit">追溯</button>
        </form>
        <div class="lineage-result" id="lineage-result" hidden></div>

        <h2 class="deck-title">授出念种</h2>
        <p class="deck-note">念种是「被启发的权利」，只有原凝者（造梦师阶位以上）能授出；念种当面授受为敬。</p>
        <form class="inline-form" id="seed-form">
          <label class="grow">作品哈希 <input id="seed-hash" pattern="[a-f0-9]{64}" required /></label>
          <label class="grow">受种者 ownerId <input id="seed-owner" placeholder="owner-…" required /></label>
          <button class="primary-button" type="submit">授出念种</button>
        </form>
      </section>

      <!-- 迷失域 -->
      <section class="deck" data-deck-panel="abyss" hidden>
        <h2 class="deck-title">迷失域 · 梦境考古</h2>
        <p class="deck-note">沉没之域在此互相渗透、碎裂。深潜者可下潜打捞，让被遗忘的杰作重见天日。</p>
        <div class="chart-toolbar">
          <button class="secondary-button" id="abyss-refresh" type="button">下潜巡视</button>
          <p id="abyss-summary"></p>
        </div>
        <div class="abyss-gate" id="abyss-gate" hidden></div>
        <ul class="abyss-list" id="abyss-list"></ul>
      </section>

      <!-- 愿念 -->
      <section class="deck" data-deck-panel="wish" hidden>
        <h2 class="deck-title">愿念 · 潜流凝结</h2>
        <p class="deck-note">向潜流描述想要之物，它会补全细节、凝结成形。造梦师给出骨架，潜流填充血肉。</p>
        <div class="notice-card" id="wish-status"></div>
        <form class="stacked-form" id="account-login-form" hidden>
          <label>Supabase 访问令牌
            <input id="account-token" type="password" autocomplete="off" placeholder="粘贴 access token" />
          </label>
          <button class="secondary-button" type="submit">接入账号</button>
        </form>
        <form class="stacked-form" id="wish-form" hidden>
          <label>愿念（最多 600 字）
            <textarea id="wish-prompt" maxlength="600" rows="4" placeholder="一盏点亮时照出这个房间昨天样子的灯…"></textarea>
          </label>
          <div class="inline-form">
            <label>目标频道 <input id="wish-channel" value="0000" /></label>
            <button class="primary-button" type="submit">向潜流许愿</button>
          </div>
        </form>
        <ul class="wish-list" id="wish-list"></ul>
      </section>
    </main>

    <footer class="site-footer">
      <p>眠海不审判，它只是浮不起某些东西。 · <span id="footer-time"></span></p>
    </footer>

    <div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="true"></div>

    <script type="module" src="/portal/app.js"></script>
  </body>
</html>
```
