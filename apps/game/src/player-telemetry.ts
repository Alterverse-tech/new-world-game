export type PlayerActivity = 'online' | 'moving' | 'driving' | 'playing' | 'away';

export interface PlayerTelemetry {
  fps: number;
  rttMs: number;
  state: PlayerActivity;
  region: string;
  updatedAt: number;
}

export interface PlayerTelemetryRow extends PlayerTelemetry {
  id: string;
  name: string;
  connected: boolean;
}

export interface PlayerTelemetryState {
  connection: 'connecting' | 'online' | 'offline';
  selfId: string | null;
  channel: string;
  players: PlayerTelemetryRow[];
}

export interface PlayerTelemetryDependencies {
  send(payload: string): void;
  render(state: Readonly<PlayerTelemetryState>): void;
  now(): number;
  region(): string;
}

const ACTIVITIES = new Set<PlayerActivity>(['online', 'moving', 'driving', 'playing', 'away']);
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const FRAME_SAMPLE_WINDOW_MS = 800;
const PING_INTERVAL_MS = 2_000;
const PING_EXPIRY_MS = 10_000;
const TELEMETRY_MIN_INTERVAL_MS = 750;

const EMPTY_TELEMETRY: Readonly<PlayerTelemetry> = Object.freeze({
  fps: 0,
  rttMs: 0,
  state: 'online',
  region: 'Unknown',
  updatedAt: 0,
});

interface NormalizedPlayer {
  row: PlayerTelemetryRow;
  hasTelemetry: boolean;
}

interface PendingPing {
  startedAt: number;
  timeout: ReturnType<typeof globalThis.setTimeout>;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : 0;
}

function sanitizeText(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== 'string') return fallback;
  const withoutControls = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f);
    })
    .join('')
    .trim();
  const bounded = [...withoutControls].slice(0, maximum).join('').trim();
  return bounded || fallback;
}

function sanitizeRegion(value: unknown): string {
  return sanitizeText(value, 'Unknown', 24);
}

function isPlayerActivity(value: unknown): value is PlayerActivity {
  return typeof value === 'string' && ACTIVITIES.has(value as PlayerActivity);
}

function isClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

export function normalizePlayerTelemetry(value: unknown): PlayerTelemetry {
  const source = recordOf(value);
  if (!source) return { ...EMPTY_TELEMETRY };
  try {
    return {
      fps: boundedInteger(source.fps, 240),
      rttMs: boundedInteger(source.rttMs, 60_000),
      state: isPlayerActivity(source.state) ? source.state : 'online',
      region: sanitizeRegion(source.region),
      updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : 0,
    };
  } catch {
    return { ...EMPTY_TELEMETRY };
  }
}

export function detectPlayerRegion(): string {
  const timeZoneCountries: Readonly<Record<string, string>> = {
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
    'Pacific/Auckland': 'NZ',
  };
  let regionCode = '';
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    regionCode = timeZoneCountries[timeZone] ?? '';
  } catch {
    regionCode = '';
  }
  if (!regionCode) {
    try {
      const language = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en';
      regionCode = new Intl.Locale(language).region ?? '';
    } catch {
      regionCode = '';
    }
  }
  if (!regionCode) return 'Unknown';
  try {
    return sanitizeRegion(new Intl.DisplayNames(['en'], { type: 'region' }).of(regionCode));
  } catch {
    const fallbackNames: Readonly<Record<string, string>> = {
      CN: 'China',
      US: 'United States',
      JP: 'Japan',
      KR: 'South Korea',
      GB: 'United Kingdom',
    };
    return sanitizeRegion(fallbackNames[regionCode] ?? regionCode);
  }
}

function playerActivityLabel(player: Readonly<PlayerTelemetryRow>): string {
  if (!player.connected) return '离线';
  return {
    online: '在线',
    moving: '移动中',
    driving: '驾驶中',
    playing: '游戏中',
    away: '暂离',
  }[player.state];
}

function metricClass(value: number, kind: 'rtt' | 'fps'): string {
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

function createMetric(value: number, suffix: string, kind: 'rtt' | 'fps'): HTMLElement {
  const element = document.createElement('span');
  const quality = metricClass(value, kind);
  element.className = quality ? `player-stat-metric ${quality}` : 'player-stat-metric';
  element.textContent = value ? `${value}${suffix}` : '--';
  return element;
}

export function renderPlayerStats(state: Readonly<PlayerTelemetryState>): void {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('player-stats-panel');
  const list = document.getElementById('player-stats-list');
  const summary = document.getElementById('player-stats-summary');
  if (!panel || !list || !summary) return;

  panel.classList.toggle('is-offline', state.connection === 'offline');
  const players = state.players;
  summary.textContent = state.connection === 'offline'
    ? '连接中断'
    : `${players.filter((player) => player.connected).length} 人在线`;
  list.replaceChildren();
  if (players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'player-stats-empty';
    empty.textContent = state.connection === 'offline' ? '多人服务暂时不可用' : '正在同步玩家信息';
    list.appendChild(empty);
    return;
  }

  for (const player of players) {
    const row = document.createElement('div');
    row.className = 'player-stat-row';
    row.dataset.state = player.connected ? player.state : 'offline';

    const person = document.createElement('div');
    person.className = 'player-stat-person';
    const dot = document.createElement('span');
    dot.className = 'player-stat-dot';
    dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'player-stat-person-copy';
    const name = document.createElement('span');
    name.className = 'player-stat-name';
    name.textContent = player.name;
    copy.appendChild(name);
    if (player.id === state.selfId) {
      const you = document.createElement('small');
      you.className = 'player-stat-you';
      you.textContent = '你';
      copy.appendChild(you);
    }
    person.append(dot, copy);

    const activity = document.createElement('span');
    activity.className = 'player-stat-state';
    activity.textContent = playerActivityLabel(player);
    const region = document.createElement('span');
    region.className = 'player-stat-region';
    region.textContent = player.region || 'Unknown';
    region.title = player.region || 'Unknown';
    row.append(
      person,
      activity,
      createMetric(player.rttMs, 'ms', 'rtt'),
      createMetric(player.fps, '', 'fps'),
      region,
    );
    list.appendChild(row);
  }
}

function normalizePlayer(value: unknown): NormalizedPlayer | null {
  const source = recordOf(value);
  if (!source) return null;
  try {
    const id = source.id ?? source.clientId;
    if (!isClientId(id)) return null;
    const telemetryValue = source.telemetry;
    const telemetry = normalizePlayerTelemetry(telemetryValue);
    const pose = recordOf(source.pose) ?? source;
    if (pose.moving === true && telemetry.state !== 'driving') telemetry.state = 'moving';
    return {
      row: {
        id,
        name: sanitizeText(source.name, '访客', 24),
        connected: true,
        ...telemetry,
      },
      hasTelemetry: Object.hasOwn(source, 'telemetry'),
    };
  } catch {
    return null;
  }
}

function frozenState(
  connection: PlayerTelemetryState['connection'],
  selfId: string | null,
  channel: string,
  players: ReadonlyMap<string, PlayerTelemetryRow>,
): Readonly<PlayerTelemetryState> {
  const rows = [...players.values()]
    .sort((left, right) => {
      if (left.id === selfId) return -1;
      if (right.id === selfId) return 1;
      const byName = left.name.localeCompare(right.name, 'zh-CN');
      return byName || left.id.localeCompare(right.id);
    })
    .map((row) => Object.freeze({ ...row }));
  return Object.freeze({
    connection,
    selfId,
    channel,
    players: Object.freeze(rows) as unknown as PlayerTelemetryRow[],
  });
}

export class PlayerTelemetryController {
  private readonly dependencies: PlayerTelemetryDependencies;
  private readonly players = new Map<string, PlayerTelemetryRow>();
  private readonly pendingPings = new Map<number, PendingPing>();
  private connection: PlayerTelemetryState['connection'] = 'connecting';
  private selfId: string | null = null;
  private channel = 'lobby';
  private localFps = 0;
  private localRttMs = 0;
  private baseLocalActivity: PlayerActivity = 'online';
  private localHidden = false;
  private localRegion = 'Unknown';
  private nextNonce = 1;
  private lastTelemetrySentAt = Number.NEGATIVE_INFINITY;
  private frameStartedAt: number | null = null;
  private frameCount = 0;
  private pingInterval: ReturnType<typeof globalThis.setInterval> | null = null;
  private telemetryTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  private lastState: Readonly<PlayerTelemetryState>;

  public constructor(dependencies: PlayerTelemetryDependencies) {
    this.dependencies = dependencies;
    this.lastState = frozenState(this.connection, this.selfId, this.channel, this.players);
  }

  public connect(selfId: string, channel: string, players: unknown[]): void {
    this.clearTimers();
    this.players.clear();
    this.connection = 'online';
    this.selfId = isClientId(selfId) ? selfId : null;
    this.channel = sanitizeText(channel, 'lobby', 96);
    this.baseLocalActivity = this.channel.startsWith('level:') ? 'playing' : 'online';
    this.localRegion = this.readRegion();
    this.localRttMs = 0;
    this.lastTelemetrySentAt = Number.NEGATIVE_INFINITY;
    this.frameStartedAt = null;
    this.frameCount = 0;
    this.replacePlayersInternal(players);
    this.syncSelf();
    this.pingInterval = globalThis.setInterval(() => this.ping(), PING_INTERVAL_MS);
    this.publish();
  }

  public replacePlayers(players: unknown[]): void {
    this.replacePlayersInternal(players);
    this.syncSelf();
    this.publish();
  }

  public playerJoined(player: unknown): void {
    const normalized = normalizePlayer(player);
    if (!normalized) return;
    this.players.set(normalized.row.id, normalized.row);
    if (normalized.row.id === this.selfId) this.syncSelf();
    this.publish();
  }

  public playerLeft(id: string): void {
    if (!isClientId(id) || !this.players.delete(id)) return;
    this.publish();
  }

  public updateProfile(id: string, name: string): void {
    if (!isClientId(id)) return;
    const current = this.players.get(id);
    if (!current) return;
    this.players.set(id, {
      ...current,
      name: sanitizeText(name, current.name, 24),
    });
    this.publish();
  }

  public updateActivity(id: string, activity: PlayerActivity): void {
    if (!isClientId(id) || !isPlayerActivity(activity)) return;
    if (id === this.selfId) {
      this.setLocalActivity(activity);
      return;
    }
    const current = this.players.get(id);
    if (!current) return;
    if (current.state === activity) return;
    this.players.set(id, { ...current, state: activity });
    this.publish();
  }

  public receive(id: string, telemetry: unknown): void {
    if (!isClientId(id)) return;
    const current = this.players.get(id);
    if (!current) return;
    this.players.set(id, {
      ...current,
      ...normalizePlayerTelemetry(telemetry),
    });
    this.publish();
  }

  public recordFrame(now: number): void {
    if (!Number.isFinite(now)) return;
    if (this.frameStartedAt === null || now < this.frameStartedAt) {
      this.frameStartedAt = now;
      this.frameCount = 0;
      return;
    }
    this.frameCount += 1;
    const elapsed = now - this.frameStartedAt;
    if (elapsed < FRAME_SAMPLE_WINDOW_MS) return;
    this.localFps = boundedInteger(this.frameCount * 1_000 / elapsed, 240);
    this.frameStartedAt = now;
    this.frameCount = 0;
    this.syncSelf();
    this.publish();
  }

  public ping(): void {
    if (this.connection !== 'online' || !this.selfId) return;
    const nonce = this.nextNonce;
    this.nextNonce += 1;
    const timeout = globalThis.setTimeout(() => {
      this.pendingPings.delete(nonce);
    }, PING_EXPIRY_MS);
    this.pendingPings.set(nonce, {
      startedAt: this.readNow(),
      timeout,
    });
    if (!this.safeSend({ type: 'telemetry_ping', nonce })) {
      globalThis.clearTimeout(timeout);
      this.pendingPings.delete(nonce);
    }
  }

  public handlePong(nonce: number): void {
    if (!Number.isSafeInteger(nonce) || nonce < 1) return;
    const pending = this.pendingPings.get(nonce);
    if (!pending) return;
    this.pendingPings.delete(nonce);
    globalThis.clearTimeout(pending.timeout);
    this.localRttMs = boundedInteger(this.readNow() - pending.startedAt, 60_000);
    this.syncSelf();
    this.publish();
    this.sendTelemetry();
  }

  public setLocalActivity(activity: PlayerActivity): void {
    if (!isPlayerActivity(activity)) return;
    if (activity === this.baseLocalActivity) return;
    const previousActivity = this.effectiveLocalActivity();
    this.baseLocalActivity = activity;
    if (this.effectiveLocalActivity() === previousActivity) return;
    this.syncSelf();
    this.publish();
    this.sendTelemetry();
  }

  public setLocalVisibility(hidden: boolean): void {
    if (hidden === this.localHidden) return;
    const previousActivity = this.effectiveLocalActivity();
    this.localHidden = hidden;
    if (this.effectiveLocalActivity() === previousActivity) return;
    this.syncSelf();
    this.publish();
    this.sendTelemetry();
  }

  public stop(): void {
    this.clearTimers();
    this.players.clear();
    this.connection = 'offline';
    this.selfId = null;
    this.channel = 'lobby';
    this.localFps = 0;
    this.localRttMs = 0;
    this.baseLocalActivity = 'online';
    this.localRegion = 'Unknown';
    this.lastTelemetrySentAt = Number.NEGATIVE_INFINITY;
    this.frameStartedAt = null;
    this.frameCount = 0;
    this.publish();
  }

  public getState(): Readonly<PlayerTelemetryState> {
    return this.lastState;
  }

  private replacePlayersInternal(players: unknown[]): void {
    const previous = new Map(this.players);
    this.players.clear();
    if (!Array.isArray(players)) return;
    for (const player of players) {
      const normalized = normalizePlayer(player);
      if (!normalized) continue;
      const old = previous.get(normalized.row.id);
      if (old && !normalized.hasTelemetry) {
        normalized.row = {
          ...normalized.row,
          fps: old.fps,
          rttMs: old.rttMs,
          state: old.state,
          region: old.region,
          updatedAt: old.updatedAt,
        };
      }
      this.players.set(normalized.row.id, normalized.row);
    }
  }

  private syncSelf(): void {
    if (!this.selfId) return;
    const current = this.players.get(this.selfId);
    this.players.set(this.selfId, {
      id: this.selfId,
      name: current?.name ?? '我',
      connected: this.connection !== 'offline',
      fps: this.localFps,
      rttMs: this.localRttMs,
      state: this.effectiveLocalActivity(),
      region: this.localRegion,
      updatedAt: this.readNow(),
    });
  }

  private sendTelemetry(): void {
    if (this.connection !== 'online' || !this.selfId) return;
    const now = this.readNow();
    const dueAt = this.lastTelemetrySentAt + TELEMETRY_MIN_INTERVAL_MS;
    if (now < dueAt) {
      if (this.telemetryTimeout === null) {
        this.telemetryTimeout = globalThis.setTimeout(() => {
          this.telemetryTimeout = null;
          this.sendTelemetry();
        }, dueAt - now);
      }
      return;
    }
    this.clearTelemetryTimeout();
    const payload = {
      type: 'telemetry',
      fps: boundedInteger(this.localFps, 240),
      rttMs: boundedInteger(this.localRttMs, 60_000),
      state: this.effectiveLocalActivity(),
      region: sanitizeRegion(this.localRegion),
    };
    if (this.safeSend(payload)) this.lastTelemetrySentAt = now;
  }

  private safeSend(payload: Record<string, unknown>): boolean {
    try {
      this.dependencies.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private readNow(): number {
    try {
      const now = this.dependencies.now();
      return Number.isFinite(now) ? now : 0;
    } catch {
      return 0;
    }
  }

  private readRegion(): string {
    try {
      return sanitizeRegion(this.dependencies.region());
    } catch {
      return 'Unknown';
    }
  }

  private effectiveLocalActivity(): PlayerActivity {
    return this.localHidden ? 'away' : this.baseLocalActivity;
  }

  private clearTelemetryTimeout(): void {
    if (this.telemetryTimeout === null) return;
    globalThis.clearTimeout(this.telemetryTimeout);
    this.telemetryTimeout = null;
  }

  private clearTimers(): void {
    this.clearTelemetryTimeout();
    if (this.pingInterval !== null) {
      globalThis.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const pending of this.pendingPings.values()) {
      globalThis.clearTimeout(pending.timeout);
    }
    this.pendingPings.clear();
  }

  private publish(): void {
    this.lastState = frozenState(this.connection, this.selfId, this.channel, this.players);
    this.dependencies.render(this.lastState);
  }
}
