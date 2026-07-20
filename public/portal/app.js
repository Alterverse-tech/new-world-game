// 《眠海》潜航门户 —— 同源静态客户端，全部功能经由平台 API 完成。
// 身份使用 HttpOnly Cookie（同源 fetch 自动携带），页面自身不保存任何凭据。

const RANK_ORDER = ['awakened', 'gleaner', 'dreamwright', 'deepdiver'];
const COUNT_LABELS = {
  dives: '下潜',
  shapes: '凝结梦物',
  interacts: '触碰梦物',
  anchors: '投锚',
  wishes: '许愿',
  creations: '凝结成形',
  salvages: '打捞',
  seedsGranted: '授出念种',
  seedsReceived: '承种',
  echoes: '回响',
};

const $ = (id) => document.getElementById(id);

const state = {
  ownerId: null,
  worldview: null,
  signedIn: false,
  lobbyChannel: '0000',
  catalogItems: [],
  eventSource: null,
};

function toast(message, kind = 'info') {
  const region = $('toast-region');
  const node = document.createElement('p');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  region.append(node);
  window.setTimeout(() => node.classList.add('is-visible'), 10);
  window.setTimeout(() => {
    node.classList.remove('is-visible');
    window.setTimeout(() => node.remove(), 400);
  }, 4200);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let payload = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `请求失败（${response.status}）`);
    error.status = response.status;
    error.code = payload?.error?.code ?? `http_${response.status}`;
    error.lore = payload?.error?.lore ?? payload?.error?.details?.lore ?? null;
    error.details = payload?.error?.details ?? null;
    throw error;
  }
  return payload;
}

function loreOf(error, fallback) {
  return error?.lore ?? error?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// 身份与标准梦时
// ---------------------------------------------------------------------------

async function ensureIdentity() {
  const payload = await api('/api/lobby/identity');
  state.ownerId = payload.ownerId;
  state.signedIn = payload.account?.signedIn === true;
  const chip = $('identity-chip');
  chip.hidden = false;
  $('identity-label').textContent = `${state.signedIn ? '账号潜航者' : '访客潜航者'} · ${payload.ownerId.slice(0, 14)}…`;
  chip.title = payload.ownerId;
  return payload;
}

function startDreamClock() {
  const tick = () => {
    const now = new Date();
    const text = now.toLocaleTimeString('zh-CN', { hour12: false });
    $('dream-time').textContent = `标准梦时 ${text}`;
    $('footer-time').textContent = `标准梦时 ${now.toLocaleString('zh-CN', { hour12: false })}`;
  };
  tick();
  window.setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// 总纲
// ---------------------------------------------------------------------------

function renderWorldview(worldview) {
  state.worldview = worldview;
  const laws = $('sea-laws');
  laws.replaceChildren(...worldview.seaLaws.map((law) => {
    const card = document.createElement('article');
    card.className = 'law-card';
    card.innerHTML = '<h3></h3><p class="law-text"></p><p class="law-mech"></p>';
    card.querySelector('h3').textContent = `${law.name}`;
    card.querySelector('.law-text').textContent = law.text;
    card.querySelector('.law-mech').textContent = `机制：${law.mechanism}`;
    return card;
  }));

  $('strata-list').replaceChildren(...worldview.strata.map((stratum) => {
    const item = document.createElement('li');
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = stratum.name;
    item.querySelector('span').textContent = stratum.summary;
    return item;
  }));

  $('protocol-grid').replaceChildren(...worldview.protocol.functions.map((fn) => {
    const card = document.createElement('article');
    card.className = 'law-card compact';
    card.innerHTML = '<h3></h3><p></p>';
    card.querySelector('h3').textContent = fn.name;
    card.querySelector('p').textContent = fn.summary;
    return card;
  }));

  $('rank-ladder').replaceChildren(...worldview.ranks.map((rank) => {
    const item = document.createElement('li');
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = rank.name;
    item.querySelector('span').textContent = rank.grants.join('；');
    return item;
  }));

  $('etiquette-list').replaceChildren(...worldview.etiquette.map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));

  $('glossary-body').replaceChildren(...worldview.glossary.map((entry) => {
    const row = document.createElement('tr');
    row.innerHTML = '<td></td><td></td><td></td>';
    const cells = row.querySelectorAll('td');
    cells[0].textContent = entry.term;
    cells[1].textContent = entry.meaning;
    cells[2].textContent = entry.product;
    return row;
  }));

  renderCalamities(worldview.calamities);
}

function renderCalamities(calamities) {
  const banner = $('calamity-banner');
  if (!calamities?.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.textContent = calamities
    .map((calamity) => `⚠ 梦灾「${calamity.title}」${calamity.channel ? `（频道 ${calamity.channel}）` : ''}正在肆虐，至 ${new Date(calamity.endsAt).toLocaleString('zh-CN', { hour12: false })}${calamity.note ? ` — ${calamity.note}` : ''}`)
    .join('　');
}

async function loadWorldview() {
  try {
    renderWorldview(await api('/api/dreamsea/worldview'));
  } catch (error) {
    toast(`世界观加载失败：${error.message}`, 'error');
  }
}

// 引擎参数提示：/?avatar= 与 /?reviewLevel= 属于 3D 引擎客户端的入口
function detectEngineParams() {
  const params = new URLSearchParams(window.location.search);
  const notice = $('engine-notice');
  if (params.has('reviewLevel')) {
    notice.hidden = false;
    notice.textContent = `此链接用于隔离试玩梦域「${params.get('reviewLevel')}」。当前部署未包含 3D 引擎客户端；预览文件可经 /api/admin/preview/ 接口读取。`;
  } else if (params.has('avatar')) {
    notice.hidden = false;
    notice.textContent = `此链接携带梦身参数「${params.get('avatar')}」，将在 3D 引擎客户端中生效。`;
  }
}

// ---------------------------------------------------------------------------
// 我的眠海：图腾 / 旅程 / 梦物
// ---------------------------------------------------------------------------

async function loadTotem() {
  try {
    const payload = await api('/api/dreamsea/totem');
    const totem = payload.totem;
    $('totem-placeholder').hidden = true;
    const body = $('totem-body');
    body.hidden = false;
    $('totem-form').textContent = `${totem.material} · ${totem.form}`;
    $('totem-description').textContent = totem.description;
    $('totem-sigil').textContent = totem.sigil;
    $('totem-lore').textContent = totem.lore;
  } catch (error) {
    $('totem-placeholder').textContent = `图腾未能凝成：${error.message}`;
  }
}

function renderJourney(journey) {
  $('rank-name').textContent = journey.rank.name;
  $('rank-grants').replaceChildren(...journey.rank.grants.map((grant) => {
    const item = document.createElement('li');
    item.textContent = grant;
    return item;
  }));

  const nextBlock = $('rank-next-block');
  const progress = $('next-rank-progress');
  if (!journey.nextRank) {
    $('next-rank-name').textContent = '已达最深处';
    progress.replaceChildren();
  } else {
    $('next-rank-name').textContent = journey.nextRank.name;
    const bars = Object.entries(journey.nextRank.requirements).map(([key, requirement]) => {
      const wrap = document.createElement('div');
      wrap.className = 'progress-line';
      const ratio = Math.min(1, requirement.current / requirement.required);
      const label = key === 'creations' ? '凝结成形' : '总活动';
      wrap.innerHTML = '<span class="progress-label"></span><span class="progress-track"><span class="progress-fill"></span></span><span class="progress-nums"></span>';
      wrap.querySelector('.progress-label').textContent = label;
      wrap.querySelector('.progress-fill').style.width = `${Math.round(ratio * 100)}%`;
      wrap.querySelector('.progress-nums').textContent = `${requirement.current}/${requirement.required}`;
      return wrap;
    });
    progress.replaceChildren(...bars);
  }
  nextBlock.hidden = false;

  const grid = $('counts-grid');
  grid.replaceChildren(...Object.entries(journey.counts).flatMap(([key, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = COUNT_LABELS[key] ?? key;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    return [dt, dd];
  }));
}

async function loadJourney() {
  try {
    const payload = await api('/api/dreamsea/journey');
    renderJourney(payload.journey);
  } catch (error) {
    toast(`旅程读取失败：${error.message}`, 'error');
  }
}

async function loadMyAssets() {
  try {
    const payload = await api('/api/lobby/assets');
    const list = $('asset-list');
    if (!payload.assets?.length) {
      list.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'empty-note',
        textContent: '还没有凝结过 GLB 梦物。',
      }));
      return;
    }
    list.replaceChildren(...payload.assets.map((asset) => {
      const item = document.createElement('li');
      item.innerHTML = '<strong></strong> <span class="muted"></span> <a target="_blank" rel="noopener"></a>';
      item.querySelector('strong').textContent = asset.name;
      item.querySelector('.muted').textContent = `${asset.category} · 缩放 ${asset.defaultScale}`;
      const link = item.querySelector('a');
      link.href = asset.assetUrl;
      link.textContent = '模型';
      return item;
    }));
  } catch (error) {
    toast(`梦物列表读取失败：${error.message}`, 'error');
  }
}

async function uploadAsset(event) {
  event.preventDefault();
  const file = $('asset-file').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('name', $('asset-name').value.trim());
  form.append('category', $('asset-category').value.trim());
  form.append('defaultScale', $('asset-scale').value.trim() || '1');
  try {
    const payload = await api('/api/lobby/assets', { method: 'POST', body: form });
    toast(payload.deduplicated ? '相同字节已存在：此次凝结未新增造物。' : `「${payload.asset.name}」凝结成形。`, 'success');
    $('asset-upload-form').reset();
    $('asset-scale').value = '1';
    await Promise.all([loadMyAssets(), loadJourney()]);
  } catch (error) {
    toast(loreOf(error, '凝结失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 海图（关卡）
// ---------------------------------------------------------------------------

async function loadChart() {
  try {
    const registry = await api('/registry.json');
    const grid = $('level-grid');
    $('chart-summary').textContent = `共 ${registry.levels.length} 个漂浮梦域 · 海图生成于 ${new Date(registry.generatedAt).toLocaleString('zh-CN', { hour12: false })}`;
    $('chart-empty').hidden = registry.levels.length > 0;
    grid.replaceChildren(...registry.levels.map((level) => {
      const card = document.createElement('article');
      card.className = 'level-card';
      card.innerHTML = `
        <div class="level-cover"><img alt="" loading="lazy" /></div>
        <div class="level-body">
          <h3></h3>
          <p class="muted level-author"></p>
          <p class="level-desc"></p>
          <p class="muted level-meta"></p>
          <button class="primary-button dive-button" type="button">下潜此域</button>
        </div>`;
      card.querySelector('img').src = level.cover;
      card.querySelector('h3').textContent = level.name;
      card.querySelector('.level-author').textContent = `梦主 ${level.author}`;
      card.querySelector('.level-desc').textContent = level.description;
      card.querySelector('.level-meta').textContent = `${level.objective} · 难度 ${level.difficulty} · 约 ${level.estimatedMinutes} 分钟`;
      card.querySelector('.dive-button').addEventListener('click', () => dive(level.id));
      return card;
    }));
  } catch (error) {
    toast(`海图读取失败：${error.message}`, 'error');
  }
}

async function dive(levelId) {
  try {
    const payload = await api('/api/dreamsea/dive', { method: 'POST', body: JSON.stringify({ levelId }) });
    toast(payload.lore ?? '下潜完成。', 'success');
    loadJourney().catch(() => {});
  } catch (error) {
    toast(loreOf(error, '下潜失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 明海大厅
// ---------------------------------------------------------------------------

async function loadCatalog() {
  try {
    const payload = await api('/api/lobby/catalog');
    state.catalogItems = payload.items ?? [];
    const select = $('object-catalog');
    select.replaceChildren(...state.catalogItems.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      return option;
    }));
  } catch {
    // 目录读取失败时保持空下拉，摆放会给出明确错误
  }
}

function catalogName(catalogId) {
  return state.catalogItems.find((item) => item.id === catalogId)?.name ?? catalogId;
}

function renderPlots(stateSnapshot) {
  const list = $('plot-list');
  const plots = stateSnapshot.plots ?? [];
  if (!plots.length) {
    list.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'empty-note',
      textContent: '本频道还没有被投锚的地块。',
    }));
  } else {
    list.replaceChildren(...plots.map((plot) => {
      const mine = plot.ownerId === state.ownerId;
      const coAuthor = (plot.coAuthors ?? []).includes(state.ownerId);
      const card = document.createElement('article');
      card.className = `plot-card${mine ? ' is-mine' : ''}`;
      card.innerHTML = `
        <div class="plot-head"><strong></strong><span class="plot-tag" hidden></span></div>
        <p class="muted plot-owner"></p>
        <p class="muted plot-co"></p>
        <div class="plot-actions"></div>`;
      card.querySelector('strong').textContent = `${plot.id} · ${plot.ownerNickname}`;
      const tag = card.querySelector('.plot-tag');
      if (mine) { tag.hidden = false; tag.textContent = '梦主：我'; }
      else if (coAuthor) { tag.hidden = false; tag.textContent = '我持共笔'; }
      card.querySelector('.plot-owner').textContent = `梦主 ${plot.ownerId.slice(0, 20)}…`;
      card.querySelector('.plot-co').textContent = plot.coAuthors?.length
        ? `共笔 ${plot.coAuthors.length}/4：${plot.coAuthors.map((id) => `${id.slice(0, 14)}…`).join('，')}`
        : '尚未授出共笔权';
      const actions = card.querySelector('.plot-actions');
      if (mine) {
        actions.append(
          smallButton('授共笔', () => grantCoAuthor(plot.id)),
          smallButton('撤共笔', () => revokeCoAuthor(plot.id, null)),
          smallButton('改名', () => renamePlot(plot.id)),
          smallButton('释放', () => releasePlot(plot.id)),
        );
      } else if (coAuthor) {
        actions.append(smallButton('退出共笔', () => revokeCoAuthor(plot.id, state.ownerId)));
      }
      return card;
    }));
  }
  const claimButton = smallButton('投锚认领一块地', () => claimPlot(), 'primary-button');
  list.append(claimButton);
}

function smallButton(label, onClick, className = 'secondary-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} small`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderObjects(stateSnapshot) {
  const list = $('object-list');
  const objects = stateSnapshot.objects ?? [];
  if (!objects.length) {
    list.replaceChildren(Object.assign(document.createElement('li'), {
      className: 'empty-note',
      textContent: '域内还没有梦物。',
    }));
    return;
  }
  list.replaceChildren(...objects.map((object) => {
    const item = document.createElement('li');
    item.innerHTML = '<strong></strong> <span class="muted"></span> <span class="object-actions"></span>';
    item.querySelector('strong').textContent = catalogName(object.catalogId);
    item.querySelector('.muted').textContent =
      `(${object.position.x.toFixed(1)}, ${object.position.z.toFixed(1)})${object.plotId ? ` · ${object.plotId}` : ' · 公共区'} · 凝者 ${object.createdBy.slice(0, 12)}…`;
    const actions = item.querySelector('.object-actions');
    actions.append(smallButton('移除', () => deleteObject(object.id)));
    return item;
  }));
}

async function loadLobby() {
  try {
    const snapshot = await api(`/api/lobby/state?channel=${encodeURIComponent(state.lobbyChannel)}`);
    renderPlots(snapshot);
    renderObjects(snapshot);
  } catch (error) {
    toast(`频道读取失败：${error.message}`, 'error');
  }
}

function connectLobbyEvents() {
  state.eventSource?.close();
  const clientId = `portal-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  const source = new EventSource(`/api/lobby/events?clientId=${clientId}&channel=${encodeURIComponent(state.lobbyChannel)}`);
  state.eventSource = source;
  const feed = $('event-feed');
  const push = (text) => {
    const item = document.createElement('li');
    item.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${text}`;
    feed.prepend(item);
    while (feed.children.length > 12) feed.lastChild.remove();
  };
  source.addEventListener('presence', (event) => {
    try {
      const payload = JSON.parse(event.data);
      const chip = $('lobby-online');
      chip.hidden = false;
      chip.textContent = `同潜 ${payload.online} 人`;
    } catch { /* 呈现层忽略坏帧 */ }
  });
  source.addEventListener('change', (event) => {
    try {
      const payload = JSON.parse(event.data);
      const kinds = {
        'object.created': '有人凝结了梦物',
        'object.updated': '有梦物被调整',
        'object.deleted': '有梦物消散',
        'object.interacted': '有人触碰了梦物',
        'plot.claimed': '有人投锚认领了地块',
        'plot.updated': '地块域理更新（含共笔变动）',
        'plot.released': '有地块被释放',
        'realm.vehicle.parked': '投影载具停泊',
      };
      push(kinds[payload.type] ?? payload.type);
      loadLobby();
    } catch { /* 呈现层忽略坏帧 */ }
  });
  source.onerror = () => push('潮汐连接波动，浏览器将自动重连…');
}

async function switchChannel(event) {
  event.preventDefault();
  const channel = $('lobby-channel').value.trim();
  if (!channel) return;
  state.lobbyChannel = channel;
  await loadLobby();
  connectLobbyEvents();
}

async function claimPlot() {
  const plotId = window.prompt('要认领的地块 ID（plot-001 … plot-072）：', 'plot-001');
  if (!plotId) return;
  const nickname = window.prompt('给这块家园起个名字：', '无名梦主');
  if (!nickname) return;
  try {
    await api(`/api/lobby/plots/${encodeURIComponent(plotId)}/claim?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    });
    toast('梦锚已投下，此域归你。', 'success');
    await Promise.all([loadLobby(), loadJourney()]);
  } catch (error) {
    toast(loreOf(error, '投锚失败'), 'error');
  }
}

async function renamePlot(plotId) {
  const nickname = window.prompt('新的家园名字：');
  if (!nickname) return;
  try {
    await api(`/api/lobby/plots/${encodeURIComponent(plotId)}?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'PATCH',
      body: JSON.stringify({ nickname }),
    });
    await loadLobby();
  } catch (error) {
    toast(loreOf(error, '改名失败'), 'error');
  }
}

async function releasePlot(plotId) {
  if (!window.confirm(`释放 ${plotId}？地块须先清空梦物。`)) return;
  try {
    await api(`/api/lobby/plots/${encodeURIComponent(plotId)}?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    toast('梦锚已收回。', 'success');
    await loadLobby();
  } catch (error) {
    toast(loreOf(error, '释放失败'), 'error');
  }
}

async function grantCoAuthor(plotId) {
  const coAuthorId = window.prompt('授予共笔权的潜航者 ownerId：', 'owner-');
  if (!coAuthorId) return;
  try {
    await api(`/api/lobby/plots/${encodeURIComponent(plotId)}/coauthors?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'POST',
      body: JSON.stringify({ coAuthorId: coAuthorId.trim() }),
    });
    toast('共笔权已授出。入他域，客随主便。', 'success');
    await loadLobby();
  } catch (error) {
    toast(loreOf(error, '授予失败'), 'error');
  }
}

async function revokeCoAuthor(plotId, presetOwnerId) {
  const coAuthorId = presetOwnerId ?? window.prompt('要撤回共笔权的 ownerId：', 'owner-');
  if (!coAuthorId) return;
  try {
    await api(`/api/lobby/plots/${encodeURIComponent(plotId)}/coauthors/${encodeURIComponent(coAuthorId.trim())}?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'DELETE',
    });
    toast('共笔权已收回。', 'success');
    await loadLobby();
  } catch (error) {
    toast(loreOf(error, '撤回失败'), 'error');
  }
}

async function createObject(event) {
  event.preventDefault();
  const catalogId = $('object-catalog').value;
  const x = Number($('object-x').value);
  const z = Number($('object-z').value);
  if (!catalogId || !Number.isFinite(x) || !Number.isFinite(z)) return;
  try {
    await api(`/api/lobby/objects?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'POST',
      body: JSON.stringify({
        clientId: state.ownerId ?? 'portal-client-0000',
        catalogId,
        position: { x, y: 0, z },
        rotationY: 0,
        scale: 1,
      }),
    });
    toast('愿念成形，梦物已凝结。', 'success');
    await Promise.all([loadLobby(), loadJourney()]);
  } catch (error) {
    toast(loreOf(error, '凝结失败'), 'error');
  }
}

async function deleteObject(objectId) {
  try {
    await api(`/api/lobby/objects/${encodeURIComponent(objectId)}?channel=${encodeURIComponent(state.lobbyChannel)}`, {
      method: 'DELETE',
      body: JSON.stringify({ clientId: state.ownerId ?? 'portal-client-0000' }),
    });
    toast('梦物已消散。', 'success');
    await loadLobby();
  } catch (error) {
    toast(loreOf(error, '移除失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 念脉与念种
// ---------------------------------------------------------------------------

async function queryLineage(event) {
  event.preventDefault();
  const hash = $('lineage-hash').value.trim().toLowerCase();
  const panel = $('lineage-result');
  try {
    const payload = await api(`/api/dreamsea/lineage/${encodeURIComponent(hash)}`);
    const lineage = payload.lineage;
    panel.hidden = false;
    panel.replaceChildren();
    const origin = document.createElement('p');
    origin.innerHTML = '<strong>原凝</strong> ';
    origin.append(`${lineage.origin.name ?? '未名之物'} · 凝痕 ${lineage.origin.sigil ?? '（岸上来客，无凝痕）'} · ${new Date(lineage.origin.condensedAt).toLocaleString('zh-CN', { hour12: false })} · 类别 ${lineage.kind}`);
    const seeds = document.createElement('p');
    seeds.textContent = `已授念种 ${lineage.seedCount} 份`;
    panel.append(origin, seeds);
    if (lineage.echoes.length) {
      const list = document.createElement('ul');
      list.className = 'echo-list';
      list.replaceChildren(...lineage.echoes.map((echo) => {
        const item = document.createElement('li');
        item.textContent = `${echo.honored ? '承种' : '回响'} · 凝痕 ${echo.sigil ?? '（无凝痕）'} · ${new Date(echo.at).toLocaleString('zh-CN', { hour12: false })}`;
        item.className = echo.honored ? 'is-honored' : '';
        return item;
      }));
      panel.append(list);
    } else {
      panel.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: '尚无回响。' }));
    }
    panel.append(Object.assign(document.createElement('p'), { className: 'lore-line', textContent: payload.lineage.lore }));
  } catch (error) {
    panel.hidden = false;
    panel.textContent = error.status === 404 ? '念脉中查无此凝结。' : loreOf(error, '追溯失败');
  }
}

async function grantSeed(event) {
  event.preventDefault();
  try {
    const payload = await api('/api/dreamsea/seeds', {
      method: 'POST',
      body: JSON.stringify({
        hash: $('seed-hash').value.trim().toLowerCase(),
        toOwnerId: $('seed-owner').value.trim(),
      }),
    });
    toast(payload.lore ?? '念种已授出。', 'success');
    $('seed-form').reset();
    loadJourney().catch(() => {});
  } catch (error) {
    toast(loreOf(error, '授种失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 迷失域
// ---------------------------------------------------------------------------

async function loadAbyss() {
  const gate = $('abyss-gate');
  const list = $('abyss-list');
  try {
    const payload = await api('/api/dreamsea/abyss');
    gate.hidden = true;
    $('abyss-summary').textContent = `迷失域中沉没着 ${payload.domains.length} 个梦域`;
    if (!payload.domains.length) {
      list.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'empty-note',
        textContent: '迷失域此刻空无一物——所有梦域都还漂浮在明海。',
      }));
      return;
    }
    list.replaceChildren(...payload.domains.map((domain) => {
      const item = document.createElement('li');
      item.className = 'abyss-item';
      item.innerHTML = '<div><strong></strong><p class="muted"></p></div>';
      item.querySelector('strong').textContent = `${domain.name}（${domain.levelId}）`;
      item.querySelector('.muted').textContent =
        `梦主 ${domain.author ?? '无名'} · 最后被梦见于 ${new Date(domain.lastVisitedAt).toLocaleString('zh-CN', { hour12: false })} · 曾被到访 ${domain.visits} 次`;
      item.append(smallButton('打捞此域', () => salvage(domain.levelId), 'primary-button'));
      return item;
    }));
  } catch (error) {
    list.replaceChildren();
    $('abyss-summary').textContent = '';
    gate.hidden = false;
    if (error.code === 'dreamsea_rank_required') {
      const required = error.details?.requiredRank?.name ?? '深潜者';
      const current = error.details?.currentRank?.name ?? '初醒者';
      gate.textContent = `此深度需要「${required}」阶位（你当前是「${current}」）。${error.details?.lore ?? ''}`;
    } else {
      gate.textContent = loreOf(error, '下潜失败');
    }
  }
}

async function salvage(levelId) {
  try {
    const payload = await api(`/api/dreamsea/abyss/${encodeURIComponent(levelId)}/salvage`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    toast(payload.salvage.lore ?? '打捞成功。', 'success');
    await Promise.all([loadAbyss(), loadChart(), loadJourney()]);
  } catch (error) {
    toast(loreOf(error, '打捞失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 愿念（潜流 AI 造物，需账号会话）
// ---------------------------------------------------------------------------

async function loadWishDeck() {
  const status = $('wish-status');
  const loginForm = $('account-login-form');
  const wishForm = $('wish-form');
  try {
    const config = await api('/api/account/prop-creations/config');
    if (!config.enabled) {
      status.textContent = '潜流的本机凝结通道（Codex bridge）未在此部署配置，愿念暂不可用。';
      loginForm.hidden = true;
      wishForm.hidden = true;
      return;
    }
    const me = await api('/api/auth/me');
    if (!me.account?.signedIn) {
      status.textContent = '向潜流许愿需要账号会话。请粘贴 Supabase 访问令牌接入（令牌只用于本次换取会话 Cookie，不会被保存）。';
      loginForm.hidden = false;
      wishForm.hidden = true;
      return;
    }
    status.textContent = `已接入：${me.account.email ?? me.ownerId}。潜流听取愿念中。`;
    loginForm.hidden = true;
    wishForm.hidden = false;
    await loadWishes();
  } catch (error) {
    status.textContent = `愿念状态读取失败：${error.message}`;
  }
}

async function accountLogin(event) {
  event.preventDefault();
  const token = $('account-token').value.trim();
  if (!token) return;
  try {
    await api('/api/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    $('account-token').value = '';
    toast('账号已接入眠海。', 'success');
    await ensureIdentity();
    await loadWishDeck();
  } catch (error) {
    toast(loreOf(error, '接入失败'), 'error');
  }
}

async function loadWishes() {
  try {
    const payload = await api('/api/account/prop-creations');
    const list = $('wish-list');
    if (!payload.jobs?.length) {
      list.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'empty-note',
        textContent: '还没有许过愿。',
      }));
      return;
    }
    list.replaceChildren(...payload.jobs.map((job) => {
      const item = document.createElement('li');
      item.className = 'wish-item';
      item.innerHTML = '<p class="wish-prompt"></p><p class="muted"></p>';
      item.querySelector('.wish-prompt').textContent = job.prompt;
      item.querySelector('.muted').textContent = `${job.status} · ${job.stage?.message ?? ''} · ${new Date(job.submittedAt).toLocaleString('zh-CN', { hour12: false })}`;
      return item;
    }));
  } catch (error) {
    toast(`愿念列表读取失败：${error.message}`, 'error');
  }
}

async function submitWish(event) {
  event.preventDefault();
  const prompt = $('wish-prompt').value.trim();
  if (!prompt) return;
  try {
    await api('/api/account/prop-creations', {
      method: 'POST',
      body: JSON.stringify({ prompt, channel: $('wish-channel').value.trim() || '0000' }),
    });
    toast('愿念已递入潜流。凝结完成后可在此追踪。', 'success');
    $('wish-prompt').value = '';
    await loadWishes();
    loadJourney().catch(() => {});
  } catch (error) {
    toast(loreOf(error, '许愿失败'), 'error');
  }
}

// ---------------------------------------------------------------------------
// 区域切换
// ---------------------------------------------------------------------------

const DECK_LOADERS = {
  world: () => loadWorldview(),
  self: () => Promise.all([loadTotem(), loadJourney(), loadMyAssets()]),
  chart: () => loadChart(),
  lobby: async () => {
    await loadCatalog();
    await loadLobby();
    connectLobbyEvents();
  },
  lineage: () => Promise.resolve(),
  abyss: () => loadAbyss(),
  wish: () => loadWishDeck(),
};

const loadedDecks = new Set();

function selectDeck(deck) {
  document.querySelectorAll('.deck-tab').forEach((tab) => {
    const active = tab.dataset.deck === deck;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-deck-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.deckPanel !== deck;
  });
  if (deck !== 'lobby') state.eventSource?.close();
  if (!loadedDecks.has(deck) || deck === 'lobby' || deck === 'abyss' || deck === 'chart') {
    loadedDecks.add(deck);
    DECK_LOADERS[deck]?.()?.catch?.(() => {});
  }
}

document.querySelectorAll('.deck-tab').forEach((tab) => {
  tab.addEventListener('click', () => selectDeck(tab.dataset.deck));
});
$('chart-refresh').addEventListener('click', loadChart);
$('abyss-refresh').addEventListener('click', loadAbyss);
$('lobby-channel-form').addEventListener('submit', switchChannel);
$('object-create-form').addEventListener('submit', createObject);
$('asset-upload-form').addEventListener('submit', uploadAsset);
$('lineage-form').addEventListener('submit', queryLineage);
$('seed-form').addEventListener('submit', grantSeed);
$('account-login-form').addEventListener('submit', accountLogin);
$('wish-form').addEventListener('submit', submitWish);

startDreamClock();
detectEngineParams();
ensureIdentity()
  .then(() => loadWorldview())
  .catch((error) => toast(`接入眠海失败：${error.message}`, 'error'));
loadedDecks.add('world');
