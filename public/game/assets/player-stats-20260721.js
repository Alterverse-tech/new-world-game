(function () {
  'use strict';

  var NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || window.__whiteRoomPlayerStatsInstalled) return;
  window.__whiteRoomPlayerStatsInstalled = true;

  var players = new Map();
  var activeSocket = null;
  var selfId = null;
  var currentChannel = 'lobby';
  var connectionState = 'connecting';
  var localFps = 0;
  var localRttMs = 0;
  var localState = 'online';
  var localRegion = detectPlayerRegion();
  var nonce = 1;
  var pendingPings = new Map();
  var panel = null;
  var list = null;
  var summary = null;

  function text(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
    return clean || fallback;
  }

  function finiteInteger(value, maximum) {
    return Number.isFinite(value)
      ? Math.max(0, Math.min(maximum, Math.round(value)))
      : 0;
  }

  function normalizeTelemetry(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      fps: finiteInteger(source.fps, 240),
      rttMs: finiteInteger(source.rttMs, 60000),
      state: ['online', 'moving', 'driving', 'playing', 'away'].includes(source.state)
        ? source.state
        : 'online',
      region: text(source.region, 'Unknown'),
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0
    };
  }

  function detectPlayerRegion() {
    var timeZone = '';
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_error) {
      timeZone = '';
    }
    var timeZoneCountry = {
      'Asia/Shanghai': 'CN',
      'Asia/Chongqing': 'CN',
      'Asia/Harbin': 'CN',
      'Asia/Urumqi': 'CN',
      'Asia/Hong_Kong': 'CN',
      'Asia/Macau': 'CN',
      'Asia/Taipei': 'CN',
      'Asia/Tokyo': 'JP',
      'Asia/Seoul': 'KR',
      'Asia/Singapore': 'SG',
      'Asia/Bangkok': 'TH',
      'Asia/Kuala_Lumpur': 'MY',
      'Asia/Jakarta': 'ID',
      'Asia/Kolkata': 'IN',
      'Europe/London': 'GB',
      'America/New_York': 'US',
      'America/Chicago': 'US',
      'America/Denver': 'US',
      'America/Los_Angeles': 'US',
      'America/Phoenix': 'US',
      'America/Toronto': 'CA',
      'America/Vancouver': 'CA',
      'America/Mexico_City': 'MX',
      'America/Sao_Paulo': 'BR',
      'America/Argentina/Buenos_Aires': 'AR',
      'Australia/Sydney': 'AU',
      'Australia/Melbourne': 'AU',
      'Australia/Brisbane': 'AU',
      'Australia/Perth': 'AU',
      'Pacific/Auckland': 'NZ'
    };
    var regionCode = timeZoneCountry[timeZone] || '';
    if (!regionCode) {
      try {
        regionCode = new Intl.Locale(navigator.language || 'en').region || '';
      } catch (_error) {
        regionCode = '';
      }
    }
    if (!regionCode) return 'Unknown';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(regionCode) || 'Unknown';
    } catch (_error) {
      return {
        CN: 'China',
        US: 'United States',
        JP: 'Japan',
        KR: 'South Korea',
        GB: 'United Kingdom'
      }[regionCode] || regionCode;
    }
  }

  function normalizePlayer(value) {
    if (!value || typeof value !== 'object') return null;
    var id = typeof value.id === 'string' ? value.id : value.clientId;
    if (typeof id !== 'string' || !id) return null;
    var pose = value.pose && typeof value.pose === 'object' ? value.pose : value;
    var telemetry = normalizeTelemetry(value.telemetry);
    if (pose.moving === true && telemetry.state !== 'driving') telemetry.state = 'moving';
    return {
      id: id,
      name: text(value.name, '访客'),
      state: telemetry.state,
      fps: telemetry.fps,
      rttMs: telemetry.rttMs,
      updatedAt: telemetry.updatedAt,
      region: telemetry.region,
      connected: true
    };
  }

  function defaultState() {
    if (document.hidden) return 'away';
    if (localState === 'driving' || localState === 'moving') return localState;
    return currentChannel.indexOf('level:') === 0 ? 'playing' : 'online';
  }

  function stateLabel(player) {
    if (!player.connected) return '离线';
    return {
      online: '在线',
      moving: '移动中',
      driving: '驾驶中',
      playing: '游戏中',
      away: '暂离'
    }[player.state] || '在线';
  }

  function metricClass(value, kind) {
    if (!value) return '';
    if (kind === 'rtt') {
      if (value <= 80) return 'is-good';
      if (value <= 160) return 'is-fair';
      return 'is-poor';
    }
    if (value >= 50) return 'is-good';
    if (value >= 30) return 'is-fair';
    return 'is-poor';
  }

  function makeMetric(value, suffix, kind) {
    var element = document.createElement('span');
    element.className = 'player-stat-metric ' + metricClass(value, kind);
    element.textContent = value ? String(value) + suffix : '--';
    return element;
  }

  function render() {
    if (!panel || !list || !summary) return;
    panel.classList.toggle('is-offline', connectionState === 'offline');
    var values = Array.from(players.values()).sort(function (left, right) {
      if (left.id === selfId) return -1;
      if (right.id === selfId) return 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    summary.textContent = connectionState === 'offline'
      ? '连接中断'
      : String(values.filter(function (player) { return player.connected; }).length) + ' 人在线';
    list.replaceChildren();
    if (!values.length) {
      var empty = document.createElement('p');
      empty.className = 'player-stats-empty';
      empty.textContent = connectionState === 'offline' ? '多人服务暂时不可用' : '正在同步玩家信息';
      list.appendChild(empty);
      return;
    }
    values.forEach(function (player) {
      var row = document.createElement('div');
      row.className = 'player-stat-row';
      row.dataset.state = player.connected ? player.state : 'offline';

      var person = document.createElement('div');
      person.className = 'player-stat-person';
      var dot = document.createElement('span');
      dot.className = 'player-stat-dot';
      dot.setAttribute('aria-hidden', 'true');
      var copy = document.createElement('div');
      copy.className = 'player-stat-person-copy';
      var name = document.createElement('span');
      name.className = 'player-stat-name';
      name.textContent = player.name;
      copy.appendChild(name);
      if (player.id === selfId) {
        var you = document.createElement('small');
        you.className = 'player-stat-you';
        you.textContent = '你';
        copy.appendChild(you);
      }
      person.append(dot, copy);

      var state = document.createElement('span');
      state.className = 'player-stat-state';
      state.textContent = stateLabel(player);
      var region = document.createElement('span');
      region.className = 'player-stat-region';
      region.textContent = player.region || 'Unknown';
      region.title = player.region || 'Unknown';
      row.append(person, state, makeMetric(player.rttMs, 'ms', 'rtt'), makeMetric(player.fps, '', 'fps'), region);
      list.appendChild(row);
    });
  }

  function updateSelf() {
    if (!selfId) return;
    var existing = players.get(selfId) || {
      id: selfId,
      name: '我',
      connected: connectionState !== 'offline'
    };
    players.set(selfId, Object.assign({}, existing, {
      state: defaultState(),
      fps: localFps,
      rttMs: localRttMs,
      region: localRegion,
      updatedAt: Date.now(),
      connected: connectionState !== 'offline'
    }));
    render();
  }

  function sendTelemetry() {
    if (!activeSocket || activeSocket.readyState !== NativeWebSocket.OPEN || !selfId) return;
    updateSelf();
    activeSocket.send(JSON.stringify({
      type: 'telemetry',
      fps: localFps,
      rttMs: localRttMs,
      state: defaultState(),
      region: localRegion
    }));
  }

  function sendPing() {
    if (!activeSocket || activeSocket.readyState !== NativeWebSocket.OPEN) return;
    var next = nonce++;
    pendingPings.set(next, performance.now());
    activeSocket.send(JSON.stringify({ type: 'telemetry_ping', nonce: next }));
    window.setTimeout(function () { pendingPings.delete(next); }, 10000);
  }

  function replacePlayers(values) {
    var previous = players;
    players = new Map();
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var player = normalizePlayer(value);
      if (!player) return;
      var old = previous.get(player.id);
      if (old && !player.fps && !player.rttMs) {
        player.fps = old.fps;
        player.rttMs = old.rttMs;
        player.state = old.state;
        player.region = old.region;
      }
      players.set(player.id, player);
    });
  }

  function handleServerMessage(raw, socket) {
    if (socket !== activeSocket || typeof raw !== 'string') return;
    var message;
    try {
      message = JSON.parse(raw);
    } catch (_error) {
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'welcome' || message.type === 'channel_snapshot') {
      if (message.type === 'welcome' && typeof message.selfId === 'string') selfId = message.selfId;
      if (typeof message.channel === 'string') currentChannel = message.channel;
      replacePlayers(message.players);
      connectionState = 'online';
      updateSelf();
      sendPing();
      return;
    }
    if (message.type === 'join' || message.type === 'player') {
      var joined = normalizePlayer(message.player || message);
      if (joined) players.set(joined.id, joined);
    } else if (message.type === 'leave') {
      players.delete(message.id);
    } else if (message.type === 'profile') {
      var profile = message.player || message;
      var profileId = profile.id || message.id;
      var current = players.get(profileId);
      if (current) players.set(profileId, Object.assign({}, current, { name: text(profile.name, current.name) }));
    } else if (message.type === 'pose') {
      var poseId = message.id || (message.player && message.player.id);
      var pose = message.player || message;
      var movingPlayer = players.get(poseId);
      if (movingPlayer && movingPlayer.state !== 'driving') {
        movingPlayer.state = pose.moving ? 'moving' : (currentChannel.indexOf('level:') === 0 ? 'playing' : 'online');
      }
    } else if (message.type === 'vehicle_claimed' || message.type === 'vehicle_state') {
      var driverId = message.vehicle && message.vehicle.driverId;
      var driver = players.get(driverId);
      if (driver) driver.state = 'driving';
    } else if (message.type === 'vehicle_released') {
      var released = players.get(message.driverId);
      if (released) released.state = currentChannel.indexOf('level:') === 0 ? 'playing' : 'online';
    } else if (message.type === 'party_launch') {
      localState = 'playing';
    } else if (message.type === 'telemetry_pong') {
      var started = pendingPings.get(message.nonce);
      if (started !== undefined) {
        pendingPings.delete(message.nonce);
        localRttMs = Math.max(1, Math.round(performance.now() - started));
        sendTelemetry();
      }
    } else if (message.type === 'telemetry') {
      var target = players.get(message.id);
      if (target) {
        target.fps = finiteInteger(message.fps, 240);
        target.rttMs = finiteInteger(message.rttMs, 60000);
        target.state = ['online', 'moving', 'driving', 'playing', 'away'].includes(message.state)
          ? message.state
          : target.state;
        target.region = text(message.region, target.region || 'Unknown');
        target.updatedAt = Number.isFinite(message.updatedAt) ? message.updatedAt : Date.now();
      }
    }
    render();
  }

  function inspectClientMessage(raw, socket) {
    if (socket !== activeSocket || typeof raw !== 'string') return;
    var message;
    try {
      message = JSON.parse(raw);
    } catch (_error) {
      return;
    }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'pose') {
      localState = message.moving ? 'moving' : (currentChannel.indexOf('level:') === 0 ? 'playing' : 'online');
    } else if (message.type === 'vehicle_enter' || message.type === 'vehicle_state') {
      localState = 'driving';
    } else if (message.type === 'vehicle_exit' || message.type === 'vehicle_recover' || message.type === 'return_lobby') {
      localState = currentChannel.indexOf('level:') === 0 ? 'playing' : 'online';
    }
    updateSelf();
  }

  function trackSocket(socket) {
    var url;
    try {
      url = new URL(socket.url, location.href);
    } catch (_error) {
      return;
    }
    if (url.pathname !== '/api/lobby/multiplayer') return;
    activeSocket = socket;
    selfId = url.searchParams.get('clientId');
    currentChannel = 'lobby:' + (url.searchParams.get('channel') || '0000');
    connectionState = 'connecting';
    players = new Map();
    if (selfId) {
      players.set(selfId, {
        id: selfId,
        name: text(url.searchParams.get('name'), '我'),
        state: 'online',
        fps: localFps,
        rttMs: 0,
        region: localRegion,
        updatedAt: 0,
        connected: true
      });
    }
    render();
    socket.addEventListener('open', function () {
      if (socket !== activeSocket) return;
      connectionState = 'online';
      updateSelf();
      sendPing();
    });
    socket.addEventListener('message', function (event) {
      handleServerMessage(event.data, socket);
    });
    socket.addEventListener('close', function () {
      if (socket !== activeSocket) return;
      connectionState = 'offline';
      players.forEach(function (player) { player.connected = false; });
      render();
    });
  }

  class PlayerStatsWebSocket extends NativeWebSocket {
    constructor() {
      super(...arguments);
      trackSocket(this);
    }

    send(data) {
      inspectClientMessage(data, this);
      return super.send(data);
    }
  }

  window.WebSocket = PlayerStatsWebSocket;

  var frameCount = 0;
  var frameStartedAt = performance.now();
  function measureFps(now) {
    frameCount += 1;
    var elapsed = now - frameStartedAt;
    if (elapsed >= 800) {
      localFps = Math.max(1, Math.min(240, Math.round(frameCount * 1000 / elapsed)));
      frameCount = 0;
      frameStartedAt = now;
      updateSelf();
    }
    window.requestAnimationFrame(measureFps);
  }
  window.requestAnimationFrame(measureFps);

  document.addEventListener('DOMContentLoaded', function () {
    panel = document.getElementById('player-stats-panel');
    list = document.getElementById('player-stats-list');
    summary = document.getElementById('player-stats-summary');
    render();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && localState === 'away') localState = currentChannel.indexOf('level:') === 0 ? 'playing' : 'online';
    if (document.hidden) localState = 'away';
    sendTelemetry();
  });

  window.setInterval(function () {
    sendPing();
    render();
  }, 2000);
}());
