const LEVEL_STATUS_META = {
  pending: {
    label: '待审核',
    title: '待审核关卡',
    summary: '等待试玩和审核的提交',
    emptyTitle: '没有待审核关卡',
    emptyMessage: '新的关卡提交后会出现在这里。',
  },
  approved: {
    label: '已发布',
    title: '已发布关卡',
    summary: '已经对所有玩家开放的关卡',
    emptyTitle: '还没有已发布关卡',
    emptyMessage: '批准关卡后，它会出现在这里。',
  },
  rejected: {
    label: '已拒绝',
    title: '已拒绝关卡',
    summary: '需要创作者修改后重新提交的关卡',
    emptyTitle: '没有已拒绝关卡',
    emptyMessage: '被拒绝的关卡会保留在这里，方便查看原因。',
  },
};

const PROP_STATUS_META = {
  pending_review: {
    label: '待审核',
    title: '待审核 AI 物件',
    summary: '本机 Codex 已生成并通过自动校验的候选物件',
    emptyTitle: '没有待审核物件',
    emptyMessage: '生成与校验完成的候选物件会出现在这里。',
  },
  queued: {
    label: '排队中',
    title: '排队中的创作',
    summary: '等待这台 Mac 上的 Codex 接取的玩家需求',
    emptyTitle: '没有排队中的创作',
    emptyMessage: '当前没有等待本机 Codex 处理的任务。',
  },
  running: {
    label: '处理中',
    title: '正在生成或发布',
    summary: '这台 Mac 上的 Codex 正在创作、校验或自动发布',
    emptyTitle: '没有正在生成的物件',
    emptyMessage: '本机接取任务后，生成与自动发布进度会出现在这里。',
  },
  approved: {
    label: '已完成',
    title: '已发布与历史批准',
    summary: '自动发布成功的物件，以及启用自动发布前人工批准的历史候选',
    emptyTitle: '还没有已完成物件',
    emptyMessage: '自动发布成功的物件会保留在这里。',
  },
  rejected: {
    label: '已驳回',
    title: '已驳回的物件',
    summary: '未通过人工审核的候选物件',
    emptyTitle: '没有已驳回物件',
    emptyMessage: '被驳回的候选物件会保留在这里，方便追踪原因。',
  },
  failed: {
    label: '处理失败',
    title: '生成或发布失败',
    summary: '本机创作、自动校验或自动发布未成功的任务',
    emptyTitle: '没有处理失败任务',
    emptyMessage: '创作、校验与自动发布失败的任务会显示在这里。',
  },
  cancelled: {
    label: '已取消',
    title: '已取消的任务',
    summary: '玩家在本机接取前主动取消的任务',
    emptyTitle: '没有已取消任务',
    emptyMessage: '玩家取消的任务会显示在这里。',
  },
};

const RESOURCE_META = {
  levels: {
    pageTitle: '关卡审核',
    pageSubtitle: '先打开隔离试玩，再批准发布或填写拒绝原因。',
    noun: '关卡',
    defaultStatus: 'pending',
    statuses: LEVEL_STATUS_META,
    listPath(status) {
      return `/api/admin/levels?status=${encodeURIComponent(status)}`;
    },
    detailPath(id) {
      return `/api/admin/levels/${encodeURIComponent(id)}`;
    },
    reviewPath(id, action) {
      return `/api/admin/levels/${encodeURIComponent(id)}/${action}`;
    },
  },
  props: {
    pageTitle: 'AI 物件创作记录',
    pageSubtitle: '自动校验通过后直接合并、构建并发布；这里保留全过程与失败记录。',
    noun: '物件',
    defaultStatus: 'approved',
    statuses: PROP_STATUS_META,
    listPath(status) {
      return `/api/admin/prop-creations?status=${encodeURIComponent(status)}`;
    },
    detailPath(id) {
      return `/api/admin/prop-creations/${encodeURIComponent(id)}`;
    },
    reviewPath(id, action) {
      return `/api/admin/prop-creations/${encodeURIComponent(id)}/${action}`;
    },
  },
};

const TYPE_LABELS = {
  parkour: '跑酷',
  puzzle: '解谜',
  collect: '收集',
  combat: '战斗',
  survival: '生存',
  survive: '生存',
  eliminate: '清除目标',
  reach_zone: '抵达终点',
  escape: '逃脱',
  custom: '自定义',
  exploration: '探索',
  race: '竞速',
};

const WIN_LABELS = {
  reach_zone: '到达指定区域',
  collect: '收集指定物品',
  collect_items: '收集指定物品',
  defeat: '击败目标',
  defeat_enemies: '击败目标',
  survive: '坚持到倒计时结束',
  eliminate: '清除全部目标',
  escape: '成功逃脱',
  puzzle: '完成谜题',
  custom: '完成自定义目标',
  activate: '激活指定机关',
  activate_switches: '激活指定机关',
  escort: '护送目标抵达终点',
  score: '达到目标分数',
};

const STAGE_LABELS = {
  queued: '等待本机接取',
  claimed: '本机已接取',
  preparing: '准备工作区',
  generating: 'Codex 创作中',
  validating: '自动校验中',
  uploading: '上传候选包',
  publishing: '准备自动发布',
  building: '构建发布版本',
  deploying: '部署生产版本',
  verifying: '验证生产版本',
  published: '已自动发布',
  publish_failed: '自动发布失败',
  pending_review: '等待人工审核',
  approved: '审核通过、等待合并',
  rejected: '审核未通过',
  failed: '生成或校验失败',
  cancelled: '玩家已取消',
};

const ERROR_MESSAGES = {
  unauthorized: '管理员令牌不正确或已经失效。',
  forbidden: '当前令牌没有审核权限。',
  level_not_found: '这个关卡不存在或已被移除。',
  prop_creation_not_found: '这个物件创作任务不存在或已被移除。',
  prop_artifact_not_found: '候选物件包不存在或已经被移除。',
  invalid_transition: '这项内容已经审核过，不能重复操作。',
  level_busy: '另一个审核操作正在进行，请稍后重试。',
  invalid_reason: '驳回原因需要填写 1–500 个字符。',
  preview_unavailable: '隔离试玩暂时不可用，请稍后重试。',
  invalid_status: '服务器不支持这个审核状态。',
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const elements = {
  loginView: document.querySelector('#login-view'),
  loginForm: document.querySelector('#login-form'),
  loginButton: document.querySelector('#login-button'),
  loginError: document.querySelector('#login-error'),
  tokenInput: document.querySelector('#token-input'),
  toggleToken: document.querySelector('#toggle-token'),
  appView: document.querySelector('#app-view'),
  logoutButton: document.querySelector('#logout-button'),
  refreshButton: document.querySelector('#refresh-button'),
  pageTitle: document.querySelector('#page-title'),
  pageSubtitle: document.querySelector('.page-subtitle'),
  resourceButtons: [...document.querySelectorAll('.resource-button')],
  tabs: [...document.querySelectorAll('.status-tab')],
  reviewPanel: document.querySelector('.review-panel'),
  listTitle: document.querySelector('#list-title'),
  listSummary: document.querySelector('#list-summary'),
  searchInput: document.querySelector('#search-input'),
  levelList: document.querySelector('#review-list'),
  loadingState: document.querySelector('#loading-state'),
  loadingText: document.querySelector('#loading-state p'),
  errorState: document.querySelector('#error-state'),
  errorHeading: document.querySelector('#error-state h3'),
  errorMessage: document.querySelector('#error-message'),
  retryButton: document.querySelector('#retry-button'),
  emptyState: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-title'),
  emptyMessage: document.querySelector('#empty-message'),
  detailLayer: document.querySelector('#detail-layer'),
  drawerBackdrop: document.querySelector('#drawer-backdrop'),
  closeDetail: document.querySelector('#close-detail'),
  detailStatus: document.querySelector('#detail-status'),
  detailId: document.querySelector('#detail-id'),
  detailName: document.querySelector('#detail-name'),
  detailDescription: document.querySelector('#detail-description'),
  detailLoading: document.querySelector('#detail-loading'),
  detailError: document.querySelector('#detail-error'),
  detailErrorMessage: document.querySelector('#detail-error-message'),
  detailRetry: document.querySelector('#detail-retry'),
  detailContent: document.querySelector('#detail-content'),
  factGrid: document.querySelector('#fact-grid'),
  rejectionSection: document.querySelector('#rejection-section'),
  rejectionTitle: document.querySelector('#rejection-title'),
  rejectionNote: document.querySelector('#rejection-note'),
  promptSection: document.querySelector('#prompt-section'),
  promptText: document.querySelector('#prompt-text'),
  changedFilesSection: document.querySelector('#changed-files-section'),
  changedFilesList: document.querySelector('#changed-files-list'),
  releaseBoundary: document.querySelector('#release-boundary'),
  solutionSection: document.querySelector('#solution-section'),
  solutionText: document.querySelector('#solution-text'),
  manifestDetails: document.querySelector('#manifest-details'),
  manifestText: document.querySelector('#manifest-text'),
  drawerActions: document.querySelector('#drawer-actions'),
  previewButton: document.querySelector('#preview-button'),
  propArtifactActions: document.querySelector('#prop-artifact-actions'),
  artifactButton: document.querySelector('#artifact-button'),
  codexLink: document.querySelector('#codex-link'),
  reviewActions: document.querySelector('#review-actions'),
  rejectButton: document.querySelector('#reject-button'),
  approveButton: document.querySelector('#approve-button'),
  actionModal: document.querySelector('#action-modal'),
  modalBackdrop: document.querySelector('#modal-backdrop'),
  actionIcon: document.querySelector('#action-icon'),
  actionTitle: document.querySelector('#action-title'),
  actionDescription: document.querySelector('#action-description'),
  rejectReason: document.querySelector('#reject-reason'),
  rejectReasonLabel: document.querySelector('#reject-reason .field-label'),
  reasonInput: document.querySelector('#reason-input'),
  reasonCount: document.querySelector('#reason-count'),
  reasonError: document.querySelector('#reason-error'),
  cancelAction: document.querySelector('#cancel-action'),
  confirmAction: document.querySelector('#confirm-action'),
  toastRegion: document.querySelector('#toast-region'),
};

// The administrator token deliberately lives only in page memory. Never persist it.
let adminToken = '';
let loadSequence = 0;
let detailSequence = 0;
let lastFocusedElement = null;

function emptyGroups(resource) {
  return Object.fromEntries(Object.keys(RESOURCE_META[resource].statuses).map((status) => [status, []]));
}

const state = {
  resource: 'levels',
  status: { levels: 'pending', props: 'approved' },
  groups: { levels: emptyGroups('levels'), props: emptyGroups('props') },
  selectedId: null,
  selectedResource: null,
  selectedDetail: null,
  action: null,
  isLoading: false,
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function resourceMeta(resource = state.resource) {
  return RESOURCE_META[resource];
}

function currentStatus() {
  return state.status[state.resource];
}

function currentStatusMeta() {
  return resourceMeta().statuses[currentStatus()];
}

function asText(value, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function clampDifficulty(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function recordId(record) {
  return asText(record?.id ?? record?.levelId, '未知 ID');
}

function levelManifest(record) {
  return record?.manifest && typeof record.manifest === 'object' ? record.manifest : record ?? {};
}

function normalizeLevelRecord(record, status) {
  if (!record || typeof record !== 'object') return null;
  const id = recordId(record);
  if (id === '未知 ID') return null;
  return {
    ...record,
    id,
    status: LEVEL_STATUS_META[record.status] ? record.status : status,
    manifest: levelManifest(record),
  };
}

function normalizePropRecord(record, status) {
  if (!record || typeof record !== 'object') return null;
  const id = recordId(record);
  if (id === '未知 ID') return null;
  const proposal = record.proposal && typeof record.proposal === 'object' ? record.proposal : null;
  const stage = record.stage && typeof record.stage === 'object' ? record.stage : null;
  return {
    ...record,
    id,
    status: PROP_STATUS_META[record.status] ? record.status : status,
    proposal,
    stage,
  };
}

function recordsFromPayload(payload, status, resource) {
  let source = payload;
  if (!Array.isArray(source)) {
    source = resource === 'props'
      ? payload?.jobs ?? payload?.items ?? payload?.records ?? payload?.results ?? []
      : payload?.levels ?? payload?.items ?? payload?.records ?? payload?.results ?? [];
  }
  if (!Array.isArray(source)) throw new ApiError(500, 'invalid_response', '服务器返回了无法识别的列表');
  const normalize = resource === 'props' ? normalizePropRecord : normalizeLevelRecord;
  return source
    .map((record) => normalize(record, status))
    .filter(Boolean)
    .sort((left, right) => {
      const leftDate = Date.parse(left.submittedAt ?? left.createdAt ?? 0) || 0;
      const rightDate = Date.parse(right.submittedAt ?? right.createdAt ?? 0) || 0;
      return rightDate - leftDate;
    });
}

function detailFromPayload(payload, fallbackRecord, resource) {
  const root = resource === 'props'
    ? payload?.job ?? payload?.record ?? payload?.item ?? payload
    : payload?.level ?? payload?.record ?? payload?.item ?? payload;
  if (!root || typeof root !== 'object') {
    throw new ApiError(500, 'invalid_response', '服务器返回了无法识别的详情');
  }
  const merged = { ...fallbackRecord, ...root };
  if (resource === 'props') return normalizePropRecord(merged, fallbackRecord?.status ?? 'pending_review');
  const manifest = root.manifest ?? payload?.manifest ?? fallbackRecord?.manifest ?? {};
  return {
    ...merged,
    id: recordId(merged),
    manifest,
    solution:
      root.solution ??
      root.solutionMd ??
      root.solutionMarkdown ??
      payload?.solution ??
      payload?.solutionMd ??
      payload?.solutionMarkdown ??
      payload?.solutionText ??
      '',
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '无法显示内容清单。';
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

function statusClass(status, record = null) {
  if (status === 'approved' && record?.publication?.publishedAt) return 'published';
  if (status === 'running' && record?.publication?.mode === 'automatic') return 'publishing';
  if (status === 'failed' && record?.stage?.code === 'publish_failed') return 'publish_failed';
  return ['approved', 'rejected', 'running', 'failed', 'cancelled', 'queued'].includes(status) ? status : '';
}

function statusLabel(record, resource = state.resource) {
  if (resource !== 'props') return resourceMeta(resource).statuses[record.status]?.label ?? asText(record.status);
  if (record.status === 'approved') {
    return record.publication?.publishedAt ? '已发布' : '历史已批准未发布';
  }
  if (record.status === 'running' && record.publication?.mode === 'automatic') return '发布中';
  if (record.status === 'failed' && record.stage?.code === 'publish_failed') return '发布失败';
  return resourceMeta(resource).statuses[record.status]?.label ?? asText(record.status);
}

function translatedType(value) {
  const text = asText(value);
  return TYPE_LABELS[text] ?? text;
}

function translatedWinCondition(winCondition) {
  if (!winCondition || typeof winCondition !== 'object') return '—';
  const label = WIN_LABELS[winCondition.type] ?? asText(winCondition.type);
  const details = [];
  const target = winCondition.required ?? winCondition.count ?? winCondition.targetCount ?? winCondition.targetScore;
  if (Number.isFinite(Number(target))) details.push(`目标 ${target}`);
  const seconds = winCondition.duration ?? winCondition.timeLimit ?? winCondition.durationSeconds;
  if (Number.isFinite(Number(seconds))) details.push(`${seconds} 秒`);
  return details.length ? `${label} · ${details.join(' · ')}` : label;
}

function stageLabel(stage) {
  const code = stage?.code;
  return STAGE_LABELS[code] ?? asText(code, '—');
}

function errorText(error, fallback = '操作失败，请稍后再试。') {
  if (error?.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
  if (error instanceof TypeError) return '无法连接服务器，请检查网络后重试。';
  if (error instanceof ApiError && error.status >= 500) return '服务器暂时不可用，请稍后再试。';
  return error?.message || fallback;
}

async function api(path, options = {}) {
  if (!adminToken) throw new ApiError(401, 'unauthorized', '需要管理员令牌');
  const headers = new Headers(options.headers ?? {});
  headers.set('Authorization', `Bearer ${adminToken}`);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const contentType = response.headers.get('content-type') ?? '';
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    if (text) payload = { error: { message: text } };
  }
  if (!response.ok) {
    const code = payload?.error?.code ?? `http_${response.status}`;
    const message = payload?.error?.message ?? `请求失败（${response.status}）`;
    const error = new ApiError(response.status, code, message);
    if (response.status === 401 && !options.allowUnauthorized) showLogin('管理员令牌已失效，请重新输入。');
    throw error;
  }
  return payload;
}

function showLogin(message = '') {
  adminToken = '';
  loadSequence += 1;
  detailSequence += 1;
  closeActionModal(false);
  closeDetail(false);
  state.resource = 'levels';
  state.status = { levels: 'pending', props: 'approved' };
  state.groups = { levels: emptyGroups('levels'), props: emptyGroups('props') };
  state.selectedId = null;
  state.selectedResource = null;
  state.selectedDetail = null;
  elements.appView.hidden = true;
  elements.loginView.hidden = false;
  elements.tokenInput.value = '';
  elements.tokenInput.type = 'password';
  elements.toggleToken.textContent = '显示';
  elements.toggleToken.setAttribute('aria-pressed', 'false');
  elements.loginError.textContent = message;
  elements.loginError.hidden = !message;
  document.body.classList.remove('has-overlay');
  updateResourceChrome();
  window.setTimeout(() => elements.tokenInput.focus(), 0);
}

function showApp() {
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  elements.loginError.hidden = true;
  elements.tokenInput.value = '';
}

function setLoginBusy(isBusy) {
  elements.loginButton.disabled = isBusy;
  elements.tokenInput.disabled = isBusy;
  elements.toggleToken.disabled = isBusy;
  elements.loginButton.querySelector('span').textContent = isBusy ? '正在验证…' : '进入审核台';
}

async function handleLogin(event) {
  event.preventDefault();
  const candidate = elements.tokenInput.value.trim();
  if (!candidate) {
    elements.loginError.textContent = '请先输入管理员令牌。';
    elements.loginError.hidden = false;
    elements.tokenInput.focus();
    return;
  }
  setLoginBusy(true);
  elements.loginError.hidden = true;
  adminToken = candidate;
  try {
    await loadAllStatuses({ isLogin: true });
    showApp();
    renderList();
  } catch (error) {
    adminToken = '';
    elements.loginError.textContent = errorText(error, '无法登录，请重试。');
    elements.loginError.hidden = false;
    elements.tokenInput.select();
  } finally {
    setLoginBusy(false);
  }
}

async function loadAllStatuses({ isLogin = false, announce = false } = {}) {
  const sequence = ++loadSequence;
  const resource = state.resource;
  const meta = resourceMeta(resource);
  const statuses = Object.keys(meta.statuses);
  state.isLoading = true;
  if (!isLogin) setListLoading(true);
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add('is-spinning');
  try {
    const payloads = await Promise.all(statuses.map((status) => api(meta.listPath(status), {
      allowUnauthorized: isLogin,
    })));
    if (sequence !== loadSequence || resource !== state.resource) return;
    statuses.forEach((status, index) => {
      state.groups[resource][status] = recordsFromPayload(payloads[index], status, resource);
    });
    updateTabs();
    if (!isLogin) renderList();
    if (announce) showToast(`${meta.noun}列表已刷新。`);
  } finally {
    if (sequence === loadSequence) {
      state.isLoading = false;
      elements.refreshButton.disabled = false;
      elements.refreshButton.classList.remove('is-spinning');
      if (!isLogin) elements.reviewPanel.setAttribute('aria-busy', 'false');
    }
  }
}

async function refreshList(announce = false) {
  try {
    await loadAllStatuses({ announce });
  } catch (error) {
    if (error?.status === 401) return;
    showListError(errorText(error, `无法读取${resourceMeta().noun}。`));
  }
}

function setListLoading(isLoading) {
  const noun = resourceMeta().noun;
  elements.reviewPanel.setAttribute('aria-busy', String(isLoading));
  elements.loadingState.hidden = !isLoading;
  elements.errorState.hidden = true;
  elements.emptyState.hidden = true;
  elements.levelList.hidden = isLoading;
  elements.loadingText.textContent = `正在读取${noun}…`;
  if (isLoading) {
    elements.listSummary.textContent = `正在读取${noun}…`;
    elements.levelList.replaceChildren();
  }
}

function showListError(message) {
  elements.loadingState.hidden = true;
  elements.levelList.hidden = true;
  elements.emptyState.hidden = true;
  elements.errorHeading.textContent = `暂时无法读取${resourceMeta().noun}`;
  elements.errorMessage.textContent = message;
  elements.errorState.hidden = false;
  elements.listSummary.textContent = '读取失败';
  elements.reviewPanel.setAttribute('aria-busy', 'false');
}

function updateResourceChrome() {
  const meta = resourceMeta();
  elements.pageTitle.textContent = meta.pageTitle;
  elements.pageSubtitle.textContent = meta.pageSubtitle;
  elements.searchInput.placeholder = state.resource === 'props' ? '搜索需求、用户、名称或 ID' : '搜索名称、作者或 ID';
  elements.resourceButtons.forEach((button) => {
    const active = button.dataset.resource === state.resource;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  updateTabs();
}

function updateTabs() {
  elements.tabs.forEach((tab) => {
    const sameResource = tab.dataset.resource === state.resource;
    tab.hidden = !sameResource;
    const active = sameResource && tab.dataset.status === currentStatus();
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
    const count = tab.querySelector('.tab-count');
    if (count && sameResource) count.textContent = String(state.groups[state.resource][tab.dataset.status]?.length ?? 0);
  });
}

async function selectResource(resource) {
  if (!RESOURCE_META[resource] || resource === state.resource) return;
  closeActionModal(false);
  closeDetail(false);
  state.resource = resource;
  elements.searchInput.value = '';
  updateResourceChrome();
  await refreshList(false);
}

function selectStatus(status) {
  if (!resourceMeta().statuses[status]) return;
  state.status[state.resource] = status;
  elements.searchInput.value = '';
  updateTabs();
  renderList();
}

function currentFilteredRecords() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('zh-CN');
  const records = state.groups[state.resource][currentStatus()] ?? [];
  if (!query) return records;
  return records.filter((record) => {
    const values = state.resource === 'props'
      ? [record.id, record.prompt, record.ownerId, record.proposal?.name, record.proposal?.summary, record.proposal?.catalogId]
      : [record.id, record.manifest?.name, record.manifest?.author?.name, record.manifest?.description];
    return values.some((value) => typeof value === 'string' && value.toLocaleLowerCase('zh-CN').includes(query));
  });
}

function renderList() {
  const meta = currentStatusMeta();
  const allRecords = state.groups[state.resource][currentStatus()] ?? [];
  const records = currentFilteredRecords();
  const hasSearch = Boolean(elements.searchInput.value.trim());
  elements.listTitle.textContent = meta.title;
  elements.listSummary.textContent = allRecords.length ? `${meta.summary} · 共 ${allRecords.length} 个` : meta.summary;
  elements.loadingState.hidden = true;
  elements.errorState.hidden = true;
  elements.levelList.replaceChildren();
  elements.levelList.hidden = records.length === 0;
  if (!records.length) {
    elements.emptyTitle.textContent = hasSearch ? `没有找到匹配${resourceMeta().noun}` : meta.emptyTitle;
    elements.emptyMessage.textContent = hasSearch ? '换一个需求、名称、用户或 ID 试试。' : meta.emptyMessage;
    elements.emptyState.hidden = false;
    return;
  }
  elements.emptyState.hidden = true;
  const fragment = document.createDocumentFragment();
  records.forEach((record) => fragment.append(state.resource === 'props' ? createPropRow(record) : createLevelRow(record)));
  elements.levelList.append(fragment);
}

function createBaseRow(record, titleText, descriptionText) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'level-row';
  row.setAttribute('aria-label', `查看${resourceMeta().noun}：${titleText}`);
  row.addEventListener('click', () => openDetail(record));
  const primary = document.createElement('div');
  primary.className = 'level-primary';
  const titleLine = document.createElement('div');
  titleLine.className = 'row-title-line';
  const title = document.createElement('h3');
  title.className = 'level-name';
  title.textContent = titleText;
  const pill = document.createElement('span');
  pill.className = `status-pill ${statusClass(record.status, record)}`.trim();
  pill.textContent = statusLabel(record);
  titleLine.append(title, pill);
  const description = document.createElement('p');
  description.className = 'level-description';
  description.textContent = descriptionText;
  primary.append(titleLine, description);
  return { row, primary };
}

function createLevelRow(record) {
  const manifest = record.manifest;
  const { row, primary } = createBaseRow(
    record,
    asText(manifest.name, record.id),
    asText(manifest.description, '暂无关卡简介'),
  );
  const author = createRowMeta('创作者', asText(manifest.author?.name), record.id);
  const difficulty = createDifficultyMeta(manifest.difficulty, manifest.estimatedMinutes);
  row.append(primary, author, difficulty, createRowArrow());
  return row;
}

function createPropRow(record) {
  const { row, primary } = createBaseRow(
    record,
    asText(record.proposal?.name, '尚未命名的 AI 物件'),
    asText(record.proposal?.summary ?? record.prompt, '暂无创作需求'),
  );
  const owner = createRowMeta('提交用户', asText(record.ownerId), asText(record.proposal?.catalogId, record.id));
  const stage = createRowMeta('处理阶段', stageLabel(record.stage), formatDate(record.stage?.updatedAt ?? record.updatedAt));
  row.append(primary, owner, stage, createRowArrow());
  return row;
}

function createRowArrow() {
  const arrow = document.createElement('span');
  arrow.className = 'row-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  return arrow;
}

function createRowMeta(label, value, subvalue = '') {
  const container = document.createElement('div');
  container.className = 'row-meta';
  const labelNode = document.createElement('p');
  labelNode.className = 'row-meta-label';
  labelNode.textContent = label;
  const valueNode = document.createElement('p');
  valueNode.className = 'row-meta-value';
  valueNode.textContent = value;
  container.append(labelNode, valueNode);
  if (subvalue) {
    const subvalueNode = document.createElement('p');
    subvalueNode.className = 'row-meta-subvalue';
    subvalueNode.textContent = subvalue;
    container.append(subvalueNode);
  }
  return container;
}

function createDifficultyMeta(difficulty, estimatedMinutes) {
  const value = clampDifficulty(difficulty);
  const container = document.createElement('div');
  container.className = 'row-meta';
  const label = document.createElement('p');
  label.className = 'row-meta-label';
  label.textContent = '难度 / 时长';
  const dots = document.createElement('div');
  dots.className = 'difficulty-dots';
  dots.setAttribute('aria-label', value ? `难度 ${value} 星` : '未填写难度');
  for (let index = 1; index <= 5; index += 1) {
    const dot = document.createElement('span');
    if (index <= value) dot.className = 'filled';
    dots.append(dot);
  }
  const time = document.createElement('p');
  time.className = 'row-meta-subvalue';
  time.textContent = Number.isFinite(Number(estimatedMinutes)) ? `约 ${estimatedMinutes} 分钟` : '时长未填写';
  container.append(label, dots, time);
  return container;
}

function findRecord(resource, id) {
  for (const records of Object.values(state.groups[resource])) {
    const record = records.find((item) => item.id === id);
    if (record) return record;
  }
  return null;
}

function propName(record) {
  return asText(record?.proposal?.name, '尚未命名的 AI 物件');
}

function setDetailHeader(record, resource) {
  const statuses = resourceMeta(resource).statuses;
  const fallbackStatus = resourceMeta(resource).defaultStatus;
  const status = statuses[record?.status] ? record.status : fallbackStatus;
  elements.detailStatus.className = `status-pill ${statusClass(status, record)}`.trim();
  elements.detailStatus.textContent = resource === 'props' ? statusLabel(record, resource) : statuses[status].label;
  elements.detailId.textContent = recordId(record);
  if (resource === 'props') {
    elements.detailName.textContent = propName(record);
    elements.detailDescription.textContent = asText(record?.proposal?.summary ?? record?.stage?.message, '等待本机 Codex 生成候选物件。');
  } else {
    const manifest = record?.manifest ?? {};
    elements.detailName.textContent = asText(manifest.name, recordId(record));
    elements.detailDescription.textContent = asText(manifest.description, '暂无关卡简介');
  }
}

async function openDetail(record) {
  lastFocusedElement = document.activeElement;
  state.selectedId = record.id;
  state.selectedResource = state.resource;
  state.selectedDetail = null;
  setDetailHeader(record, state.selectedResource);
  elements.detailLayer.hidden = false;
  document.body.classList.add('has-overlay');
  elements.detailLoading.hidden = false;
  elements.detailError.hidden = true;
  elements.detailContent.hidden = true;
  elements.drawerActions.hidden = true;
  window.setTimeout(() => elements.closeDetail.focus(), 0);
  await loadDetail();
}

async function loadDetail() {
  if (!state.selectedId || !state.selectedResource) return;
  const id = state.selectedId;
  const resource = state.selectedResource;
  const sequence = ++detailSequence;
  elements.detailLoading.hidden = false;
  elements.detailError.hidden = true;
  elements.detailContent.hidden = true;
  elements.drawerActions.hidden = true;
  try {
    const payload = await api(resourceMeta(resource).detailPath(id));
    if (sequence !== detailSequence || id !== state.selectedId || resource !== state.selectedResource) return;
    const detail = detailFromPayload(payload, findRecord(resource, id), resource);
    state.selectedDetail = detail;
    setDetailHeader(detail, resource);
    renderDetail(detail, resource);
    elements.detailLoading.hidden = true;
    elements.detailContent.hidden = false;
  } catch (error) {
    if (sequence !== detailSequence || error?.status === 401) return;
    elements.detailLoading.hidden = true;
    elements.detailErrorMessage.textContent = errorText(error, `无法读取${resourceMeta(resource).noun}详情。`);
    elements.detailError.hidden = false;
  }
}

function addFact(label, value, { wide = false, node = null } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = `fact-item${wide ? ' wide' : ''}`;
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  if (node) description.append(node);
  else description.textContent = asText(value);
  wrapper.append(term, description);
  elements.factGrid.append(wrapper);
}

function resetDetailSections() {
  elements.factGrid.replaceChildren();
  elements.rejectionSection.hidden = true;
  elements.promptSection.hidden = true;
  elements.changedFilesSection.hidden = true;
  elements.releaseBoundary.hidden = true;
  elements.solutionSection.hidden = true;
  elements.manifestDetails.hidden = true;
  elements.previewButton.hidden = true;
  elements.propArtifactActions.hidden = true;
  elements.artifactButton.hidden = true;
  elements.codexLink.hidden = true;
  elements.codexLink.removeAttribute('href');
  elements.reviewActions.hidden = true;
  elements.drawerActions.hidden = true;
}

function renderDetail(detail, resource) {
  resetDetailSections();
  if (resource === 'props') renderPropDetail(detail);
  else renderLevelDetail(detail);
}

function renderLevelDetail(detail) {
  const manifest = detail.manifest ?? {};
  addFact('创作者', manifest.author?.name);
  addFact('提交时间', formatDate(detail.submittedAt ?? detail.createdAt));
  addFact('玩法类型', translatedType(manifest.type));
  addFact('难度', clampDifficulty(manifest.difficulty) ? `${clampDifficulty(manifest.difficulty)} / 5` : '—');
  addFact('预计时长', Number.isFinite(Number(manifest.estimatedMinutes)) ? `约 ${manifest.estimatedMinutes} 分钟` : '—');
  addFact('版本', manifest.version);
  addFact('关卡目标', manifest.objective, { wide: true });
  addFact('通关条件', translatedWinCondition(manifest.winCondition), { wide: true });
  if (Array.isArray(manifest.tags) && manifest.tags.length) {
    const tagList = document.createElement('div');
    tagList.className = 'tag-list';
    manifest.tags.forEach((tag) => {
      const item = document.createElement('span');
      item.className = 'tag-item';
      item.textContent = asText(tag);
      tagList.append(item);
    });
    addFact('标签', '', { wide: true, node: tagList });
  }
  const reason = detail.rejectionReason ?? detail.reason;
  elements.rejectionTitle.textContent = '拒绝原因';
  elements.rejectionNote.textContent = asText(reason, '未提供原因');
  elements.rejectionSection.hidden = detail.status !== 'rejected';
  elements.solutionText.textContent = asText(detail.solution, '未提供攻略内容。');
  elements.solutionSection.hidden = false;
  elements.manifestText.textContent = safeJson(manifest);
  elements.manifestDetails.hidden = false;
  elements.previewButton.hidden = false;
  elements.reviewActions.hidden = detail.status !== 'pending';
  elements.rejectButton.textContent = '拒绝';
  elements.approveButton.textContent = '✓ 批准发布';
  elements.drawerActions.hidden = false;
}

function renderPropDetail(detail) {
  const proposal = detail.proposal ?? {};
  addFact('提交用户', detail.ownerId);
  addFact('提交时间', formatDate(detail.submittedAt));
  addFact('最近更新', formatDate(detail.updatedAt));
  addFact('处理阶段', stageLabel(detail.stage));
  addFact('阶段说明', detail.stage?.message, { wide: true });
  addFact('目录名称', proposal.name);
  addFact('Catalog ID', proposal.catalogId);
  addFact('候选类型', proposal.kind === 'code' ? 'Three.js 纯代码物件' : proposal.kind);
  addFact('本机尝试次数', detail.attempt);
  const publication = detail.publication;
  if (publication?.mode === 'automatic') {
    addFact('发布方式', '自动发布');
    addFact('发布开始', formatDate(publication.startedAt));
    addFact('发布完成', formatDate(publication.publishedAt));
    addFact('游戏版本', publication.release?.gameRelease);
    addFact('平台版本', publication.release?.platformRelease);
    addFact('线上地址', publication.release?.publicUrl, { wide: true });
  } else if (detail.status === 'approved') {
    addFact('发布方式', '历史人工批准');
    addFact('上线状态', '没有自动发布记录，仍需人工合并与发布', { wide: true });
  }
  elements.promptText.textContent = asText(detail.prompt, '未提供创作需求。');
  elements.promptSection.hidden = false;

  elements.changedFilesList.replaceChildren();
  const changedFiles = Array.isArray(detail.changedFiles) ? detail.changedFiles.filter((item) => typeof item === 'string') : [];
  if (changedFiles.length) {
    changedFiles.forEach((file) => {
      const item = document.createElement('li');
      item.textContent = file;
      elements.changedFilesList.append(item);
    });
  } else {
    const item = document.createElement('li');
    item.className = 'is-empty';
    item.textContent = '当前任务还没有候选文件。';
    elements.changedFilesList.append(item);
  }
  elements.changedFilesSection.hidden = false;
  elements.releaseBoundary.hidden = false;

  const failureReason = detail.publication?.failure?.message ?? detail.failure?.message;
  const rejectionReason = detail.review?.reason ?? detail.reason;
  if (detail.status === 'failed' || detail.status === 'rejected') {
    elements.rejectionTitle.textContent = detail.stage?.code === 'publish_failed'
      ? '自动发布失败原因'
      : detail.status === 'failed' ? '生成失败原因' : '驳回原因';
    elements.rejectionNote.textContent = asText(detail.status === 'failed' ? failureReason : rejectionReason, '未提供原因');
    elements.rejectionSection.hidden = false;
  }

  const artifactUrl = safeArtifactUrl(detail.artifactUrl, detail.id);
  const codexUrl = safeCodexUrl(proposal.codexThreadId);
  elements.propArtifactActions.hidden = !artifactUrl && !codexUrl;
  elements.artifactButton.hidden = !artifactUrl;
  elements.codexLink.hidden = !codexUrl;
  if (codexUrl) elements.codexLink.href = codexUrl;
  const reviewable = detail.status === 'pending_review';
  elements.reviewActions.hidden = !reviewable;
  elements.rejectButton.textContent = '驳回';
  elements.approveButton.textContent = '✓ 批准待合并';
  elements.drawerActions.hidden = !artifactUrl && !codexUrl && !reviewable;
}

function safeArtifactUrl(value, id) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    const expected = `/api/admin/prop-creations/${encodeURIComponent(id)}/artifact`;
    if (url.origin !== window.location.origin || url.pathname !== expected || url.search || url.hash) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function safeCodexUrl(threadId) {
  if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(threadId)) return null;
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

function closeDetail(restoreFocus = true) {
  if (elements.detailLayer.hidden) return;
  detailSequence += 1;
  elements.detailLayer.hidden = true;
  state.selectedId = null;
  state.selectedResource = null;
  state.selectedDetail = null;
  document.body.classList.remove('has-overlay');
  if (restoreFocus && lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function isSelectedReviewable() {
  if (!state.selectedDetail || !state.selectedResource) return false;
  return state.selectedResource === 'props'
    ? state.selectedDetail.status === 'pending_review'
    : state.selectedDetail.status === 'pending';
}

function openActionModal(action) {
  if (!isSelectedReviewable()) return;
  state.action = action;
  elements.reasonInput.value = '';
  elements.reasonCount.textContent = '0';
  elements.reasonError.textContent = '';
  const isReject = action === 'reject';
  const isProp = state.selectedResource === 'props';
  elements.actionIcon.className = `dialog-icon${isReject ? ' reject' : ''}`;
  elements.actionIcon.textContent = isReject ? '×' : '✓';
  elements.actionTitle.textContent = isReject
    ? `驳回这个${isProp ? '物件' : '关卡'}？`
    : isProp ? '批准进入待合并流程？' : '批准发布这个关卡？';
  elements.actionDescription.textContent = isReject
    ? '请告诉创作者需要修改的问题。提交后，本次审核不能撤回。'
    : isProp
      ? '批准只代表候选包可以进入人工合并、构建与版本发布流程；不会执行代码，也不会立即上线。'
      : '批准后，所有玩家都能在关卡目录中看到并进入它。';
  elements.rejectReasonLabel.textContent = isProp ? '驳回原因' : '拒绝原因';
  elements.rejectReason.hidden = !isReject;
  elements.confirmAction.className = isReject ? 'reject-button' : 'approve-button';
  elements.confirmAction.textContent = isReject ? '确认驳回' : isProp ? '批准待合并' : '确认批准';
  elements.actionModal.hidden = false;
  if (isReject) window.setTimeout(() => elements.reasonInput.focus(), 0);
  else window.setTimeout(() => elements.confirmAction.focus(), 0);
}

function closeActionModal(restoreFocus = true) {
  if (elements.actionModal.hidden) return;
  elements.actionModal.hidden = true;
  state.action = null;
  elements.confirmAction.disabled = false;
  elements.cancelAction.disabled = false;
  elements.reasonInput.disabled = false;
  if (restoreFocus) {
    const target = elements.detailLayer.hidden ? lastFocusedElement : elements.closeDetail;
    if (target instanceof HTMLElement) target.focus();
  }
}

async function confirmAction() {
  if (!state.selectedDetail || !state.action || !state.selectedResource) return;
  const action = state.action;
  const resource = state.selectedResource;
  const reason = elements.reasonInput.value.trim();
  if (action === 'reject' && !reason) {
    elements.reasonError.textContent = '请填写驳回原因。';
    elements.reasonInput.focus();
    return;
  }
  if (reason.length > 500) {
    elements.reasonError.textContent = '驳回原因不能超过 500 个字符。';
    elements.reasonInput.focus();
    return;
  }
  const id = state.selectedDetail.id;
  const contentName = resource === 'props'
    ? propName(state.selectedDetail)
    : asText(state.selectedDetail.manifest?.name, id);
  elements.confirmAction.disabled = true;
  elements.cancelAction.disabled = true;
  elements.reasonInput.disabled = true;
  elements.confirmAction.textContent = action === 'reject' ? '正在驳回…' : resource === 'props' ? '正在批准…' : '正在发布…';
  try {
    await api(resourceMeta(resource).reviewPath(id, action), {
      method: 'POST',
      body: JSON.stringify(action === 'reject' ? { reason } : {}),
    });
    closeActionModal(false);
    closeDetail(false);
    if (state.resource === resource) await refreshList(false);
    const message = action === 'reject'
      ? `已驳回「${contentName}」。`
      : resource === 'props'
        ? `「${contentName}」已批准进入待合并流程，尚未发布。`
        : `「${contentName}」已发布。`;
    showToast(message);
  } catch (error) {
    if (error?.status === 401) return;
    showToast(errorText(error), 'error');
    elements.confirmAction.disabled = false;
    elements.cancelAction.disabled = false;
    elements.reasonInput.disabled = false;
    elements.confirmAction.textContent = action === 'reject' ? '确认驳回' : resource === 'props' ? '批准待合并' : '确认批准';
  }
}

function previewUrlFromPayload(payload, id) {
  const direct = payload?.previewUrl;
  if (typeof direct === 'string' && direct.trim()) {
    const url = new URL(direct, window.location.origin);
    if (url.origin !== window.location.origin) throw new ApiError(500, 'invalid_preview_url', '试玩地址不是同源地址');
    return url.href;
  }
  const baseValue = payload?.previewBaseUrl;
  if (typeof baseValue !== 'string' || !baseValue.trim()) {
    throw new ApiError(503, 'preview_unavailable', '服务器没有返回试玩地址');
  }
  const base = new URL(baseValue, window.location.origin);
  if (base.origin !== window.location.origin) throw new ApiError(500, 'invalid_preview_url', '试玩地址不是同源地址');
  const url = new URL('/', base);
  url.searchParams.set('reviewLevel', id);
  url.searchParams.set('devLevel', id);
  return url.href;
}

async function openPreview() {
  if (!state.selectedDetail || state.selectedResource !== 'levels') return;
  const id = state.selectedDetail.id;
  elements.previewButton.disabled = true;
  const originalText = elements.previewButton.textContent;
  elements.previewButton.textContent = '正在准备试玩…';
  try {
    const payload = await api(`/api/admin/levels/${encodeURIComponent(id)}/preview-token`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const previewUrl = previewUrlFromPayload(payload, id);
    const previewWindow = window.open(previewUrl, '_blank', 'noopener,noreferrer');
    if (!previewWindow) showToast('浏览器阻止了新窗口，请允许弹出窗口后重试。', 'error');
  } catch (error) {
    if (error?.status !== 401) showToast(errorText(error, '无法打开隔离试玩。'), 'error');
  } finally {
    elements.previewButton.disabled = false;
    elements.previewButton.textContent = originalText;
  }
}

async function downloadArtifact() {
  if (!state.selectedDetail || state.selectedResource !== 'props') return;
  const artifactUrl = safeArtifactUrl(state.selectedDetail.artifactUrl, state.selectedDetail.id);
  if (!artifactUrl) {
    showToast('这个任务没有可下载的候选包。', 'error');
    return;
  }
  elements.artifactButton.disabled = true;
  const originalText = elements.artifactButton.textContent;
  elements.artifactButton.textContent = '正在下载…';
  try {
    const response = await fetch(artifactUrl, {
      headers: { Authorization: `Bearer ${adminToken}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      let payload = null;
      if ((response.headers.get('content-type') ?? '').includes('application/json')) payload = await response.json().catch(() => null);
      const error = new ApiError(
        response.status,
        payload?.error?.code ?? `http_${response.status}`,
        payload?.error?.message ?? `下载失败（${response.status}）`,
      );
      if (response.status === 401) showLogin('管理员令牌已失效，请重新输入。');
      throw error;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${state.selectedDetail.id}.wrprop`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    showToast('候选 .wrprop 已开始下载。');
  } catch (error) {
    if (error?.status !== 401) showToast(errorText(error, '无法下载候选包。'), 'error');
  } finally {
    elements.artifactButton.disabled = false;
    elements.artifactButton.textContent = originalText;
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const mark = document.createElement('span');
  mark.className = 'toast-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = type === 'error' ? '!' : '✓';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(mark, text);
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function handleEscape(event) {
  if (event.key !== 'Escape') return;
  if (!elements.actionModal.hidden) {
    closeActionModal();
    return;
  }
  if (!elements.detailLayer.hidden) closeDetail();
}

elements.loginForm.addEventListener('submit', handleLogin);
elements.toggleToken.addEventListener('click', () => {
  const showing = elements.tokenInput.type === 'text';
  elements.tokenInput.type = showing ? 'password' : 'text';
  elements.toggleToken.textContent = showing ? '显示' : '隐藏';
  elements.toggleToken.setAttribute('aria-pressed', String(!showing));
  elements.tokenInput.focus();
});
elements.logoutButton.addEventListener('click', () => showLogin());
elements.refreshButton.addEventListener('click', () => refreshList(true));
elements.retryButton.addEventListener('click', () => refreshList(false));
elements.resourceButtons.forEach((button) => button.addEventListener('click', () => selectResource(button.dataset.resource)));
elements.tabs.forEach((tab) => tab.addEventListener('click', () => {
  if (tab.dataset.resource === state.resource) selectStatus(tab.dataset.status);
}));
elements.searchInput.addEventListener('input', renderList);
elements.drawerBackdrop.addEventListener('click', () => closeDetail());
elements.closeDetail.addEventListener('click', () => closeDetail());
elements.detailRetry.addEventListener('click', loadDetail);
elements.previewButton.addEventListener('click', openPreview);
elements.artifactButton.addEventListener('click', downloadArtifact);
elements.approveButton.addEventListener('click', () => openActionModal('approve'));
elements.rejectButton.addEventListener('click', () => openActionModal('reject'));
elements.modalBackdrop.addEventListener('click', () => closeActionModal());
elements.cancelAction.addEventListener('click', () => closeActionModal());
elements.confirmAction.addEventListener('click', confirmAction);
elements.reasonInput.addEventListener('input', () => {
  elements.reasonCount.textContent = String(elements.reasonInput.value.length);
  elements.reasonError.textContent = '';
});
document.addEventListener('keydown', handleEscape);

showLogin();
