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
      return codePoint >= 0x20 && codePoint !== 0x7f;
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
  private localActivity: PlayerActivity = 'online';
  private localRegion = 'Unknown';
  private nextNonce = 1;
  private lastTelemetrySentAt = Number.NEGATIVE_INFINITY;
  private frameStartedAt: number | null = null;
  private frameCount = 0;
  private pingInterval: ReturnType<typeof globalThis.setInterval> | null = null;
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
    this.localActivity = this.channel.startsWith('level:') ? 'playing' : 'online';
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
      this.frameCount = 1;
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
    this.localActivity = activity;
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
    this.localActivity = 'online';
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
      state: this.localActivity,
      region: this.localRegion,
      updatedAt: this.readNow(),
    });
  }

  private sendTelemetry(): void {
    if (this.connection !== 'online' || !this.selfId) return;
    const now = this.readNow();
    if (now - this.lastTelemetrySentAt < TELEMETRY_MIN_INTERVAL_MS) return;
    const payload = {
      type: 'telemetry',
      fps: boundedInteger(this.localFps, 240),
      rttMs: boundedInteger(this.localRttMs, 60_000),
      state: this.localActivity,
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

  private clearTimers(): void {
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
