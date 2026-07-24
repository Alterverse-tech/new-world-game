import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlayerTelemetryController,
  detectPlayerRegion,
  normalizePlayerTelemetry,
  renderPlayerStats,
  type PlayerTelemetryDependencies,
  type PlayerTelemetryState,
} from './player-telemetry';

class FakeClassList {
  private readonly values = new Set<string>();

  public toggle(name: string, force?: boolean): void {
    if (force === false) this.values.delete(name);
    else if (force === true || !this.values.has(name)) this.values.add(name);
    else this.values.delete(name);
  }

  public contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  public className = '';
  public textContent = '';
  public title = '';
  public readonly classList = new FakeClassList();
  public readonly dataset: Record<string, string> = {};
  public readonly children: FakeElement[] = [];
  public readonly attributes = new Map<string, string>();

  public set innerHTML(_value: string) {
    throw new Error('renderPlayerStats must not use innerHTML');
  }

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  private readonly elements = new Map<string, FakeElement>();

  public add(id: string): FakeElement {
    const element = new FakeElement();
    this.elements.set(id, element);
    return element;
  }

  public getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  public createElement(): FakeElement {
    return new FakeElement();
  }
}

interface Harness {
  controller: PlayerTelemetryController;
  payloads: Array<Record<string, unknown>>;
  renders: Readonly<PlayerTelemetryState>[];
  setNow(value: number): void;
}

function createHarness(region = 'China', initialNow = 1_000): Harness {
  let currentNow = initialNow;
  const payloads: Array<Record<string, unknown>> = [];
  const renders: Readonly<PlayerTelemetryState>[] = [];
  const dependencies: PlayerTelemetryDependencies = {
    send(payload) {
      payloads.push(JSON.parse(payload) as Record<string, unknown>);
    },
    render(state) {
      renders.push(state);
    },
    now: () => currentNow,
    region: () => region,
  };
  return {
    controller: new PlayerTelemetryController(dependencies),
    payloads,
    renders,
    setNow(value) {
      currentNow = value;
    },
  };
}

function player(
  id: string,
  name: string,
  telemetry: unknown = {
    fps: 60,
    rttMs: 40,
    state: 'online',
    region: 'China',
    updatedAt: 12,
  },
): Record<string, unknown> {
  return { id, name, telemetry };
}

describe('player telemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders safely when the DOM or stats panel is absent', () => {
    const state: PlayerTelemetryState = {
      connection: 'connecting',
      selfId: null,
      channel: 'lobby',
      players: [],
    };
    vi.stubGlobal('document', undefined);
    expect(() => renderPlayerStats(state)).not.toThrow();
    vi.stubGlobal('document', new FakeDocument());
    expect(() => renderPlayerStats(state)).not.toThrow();
  });

  it('renders player names as text with production state and metric labels', () => {
    const document = new FakeDocument();
    const panel = document.add('player-stats-panel');
    const summary = document.add('player-stats-summary');
    const list = document.add('player-stats-list');
    vi.stubGlobal('document', document);

    renderPlayerStats({
      connection: 'online',
      selfId: 'self-0001',
      channel: 'lobby:0000',
      players: [{
        id: 'self-0001',
        name: '<img src=x onerror=alert(1)>',
        connected: true,
        fps: 60,
        rttMs: 42,
        state: 'moving',
        region: '<script>China</script>',
        updatedAt: 123,
      }, {
        id: 'alice-0001',
        name: 'Alice',
        connected: true,
        fps: 12,
        rttMs: 240,
        state: 'away',
        region: 'Canada',
        updatedAt: 123,
      }],
    });

    expect(panel.classList.contains('is-offline')).toBe(false);
    expect(summary.textContent).toBe('2 人在线');
    expect(list.children).toHaveLength(2);
    const self = list.children[0]!;
    expect(self.dataset.state).toBe('moving');
    expect(self.children[0]!.children[1]!.children[0]!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(self.children[0]!.children[1]!.children[1]!.textContent).toBe('你');
    expect(self.children[1]!.textContent).toBe('移动中');
    expect(self.children[2]!.textContent).toBe('42ms');
    expect(self.children[2]!.className).toContain('is-good');
    expect(self.children[3]!.textContent).toBe('60');
    expect(self.children[3]!.className).toContain('is-good');
    expect(self.children[4]!.textContent).toBe('<script>China</script>');
    expect(self.children[4]!.title).toBe('<script>China</script>');
    expect(list.children[1]!.children[2]!.className).toContain('is-poor');
    expect(list.children[1]!.children[3]!.className).toContain('is-poor');
  });

  it('renders the offline empty state without player rows', () => {
    const document = new FakeDocument();
    const panel = document.add('player-stats-panel');
    const summary = document.add('player-stats-summary');
    const list = document.add('player-stats-list');
    vi.stubGlobal('document', document);

    renderPlayerStats({
      connection: 'offline',
      selfId: null,
      channel: 'lobby',
      players: [],
    });

    expect(panel.classList.contains('is-offline')).toBe(true);
    expect(summary.textContent).toBe('连接中断');
    expect(list.children).toHaveLength(1);
    expect(list.children[0]).toMatchObject({
      className: 'player-stats-empty',
      textContent: '多人服务暂时不可用',
    });
  });

  it('renders the controller-owned player order without sorting a second time', () => {
    const document = new FakeDocument();
    document.add('player-stats-panel');
    document.add('player-stats-summary');
    const list = document.add('player-stats-list');
    vi.stubGlobal('document', document);

    renderPlayerStats({
      connection: 'online',
      selfId: 'self-0001',
      channel: 'lobby:0000',
      players: [
        {
          id: 'alice-001', name: 'Alice', connected: true,
          fps: 60, rttMs: 40, state: 'online', region: 'China', updatedAt: 12,
        },
        {
          id: 'self-0001', name: 'Self', connected: true,
          fps: 60, rttMs: 40, state: 'online', region: 'China', updatedAt: 12,
        },
      ],
    });

    expect(list.children[0]!.children[0]!.children[1]!.children[0]!.textContent).toBe('Alice');
    expect(list.children[1]!.children[0]!.children[1]!.children[0]!.textContent).toBe('Self');
  });

  it('clamps untrusted metrics, accepts only known activities, and sanitizes regions', () => {
    expect(normalizePlayerTelemetry({
      fps: 999.4,
      rttMs: -4,
      state: 'hacked',
      region: `\u0000  ${'界'.repeat(30)}\u007f  `,
      updatedAt: 12,
    })).toEqual({
      fps: 240,
      rttMs: 0,
      state: 'online',
      region: '界'.repeat(24),
      updatedAt: 12,
    });
    expect(normalizePlayerTelemetry({
      fps: Number.NaN,
      rttMs: Number.POSITIVE_INFINITY,
      state: null,
      region: '\u0001 \u007f',
      updatedAt: 'secret',
    })).toEqual({
      fps: 0,
      rttMs: 0,
      state: 'online',
      region: 'Unknown',
      updatedAt: 0,
    });
    expect(normalizePlayerTelemetry('<img src=x>')).toEqual({
      fps: 0,
      rttMs: 0,
      state: 'online',
      region: 'Unknown',
      updatedAt: 0,
    });
  });

  it('removes C0, DEL, and C1 controls while preserving printable Unicode boundaries', () => {
    expect(normalizePlayerTelemetry({
      region: '\u001f A\u007fB\u0080C\u009fD\u00a0E ',
    }).region).toBe('ABCD\u00a0E');
    expect(normalizePlayerTelemetry({
      region: '\u0080\u009f',
    }).region).toBe('Unknown');
    expect(normalizePlayerTelemetry({
      region: '\u{1f642}'.repeat(30),
    }).region).toBe('\u{1f642}'.repeat(24));

    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [
      player('self-0001', '\u007fA\u0080B\u009fC\u00a0D'),
    ]);
    expect(harness.controller.getState().players[0]?.name).toBe('ABC\u00a0D');
    harness.controller.updateProfile('self-0001', `\u0080${'\u{1f642}'.repeat(30)}\u009f`);
    expect(harness.controller.getState().players[0]?.name).toBe('\u{1f642}'.repeat(24));
    harness.controller.stop();
  });

  it('treats hostile property access as malformed telemetry', () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error('do not leak or crash');
      },
    });
    expect(normalizePlayerTelemetry(hostile)).toEqual({
      fps: 0,
      rttMs: 0,
      state: 'online',
      region: 'Unknown',
      updatedAt: 0,
    });
  });

  it('detects a bounded, control-free region without requiring browser DOM', () => {
    const region = detectPlayerRegion();
    expect(region.length).toBeGreaterThan(0);
    expect([...region].length).toBeLessThanOrEqual(24);
    expect([...region].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })).toBe(true);
  });

  it('normalizes hostile players, sorts self first then names, and exposes immutable plain data', () => {
    const harness = createHarness();
    const hostile = new Proxy({}, {
      get() {
        throw new Error('hostile player');
      },
    });
    harness.controller.connect('self-0001', 'lobby:0000', [
      player('bob-00001', '  Bob\u0000  ', {
        fps: -1,
        rttMs: 99_999,
        state: 'hacked',
        region: '<img>',
        updatedAt: 3,
      }),
      hostile,
      { id: '../bad', name: 'Mallory' },
      player('self-0001', 'Alice'),
      player('ann-00001', 'Ann'),
    ]);

    const state = harness.controller.getState();
    expect(state).toEqual({
      connection: 'online',
      selfId: 'self-0001',
      channel: 'lobby:0000',
      players: [
        expect.objectContaining({ id: 'self-0001', name: 'Alice', region: 'China' }),
        expect.objectContaining({ id: 'ann-00001', name: 'Ann' }),
        expect.objectContaining({
          id: 'bob-00001',
          name: 'Bob',
          fps: 0,
          rttMs: 60_000,
          state: 'online',
          region: '<img>',
        }),
      ],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.players)).toBe(true);
    expect(Object.isFrozen(state.players[0])).toBe(true);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(() => {
      (state.players[0] as { name: string }).name = 'mutated';
    }).toThrow(TypeError);
    expect(harness.renders.at(-1)).toBe(state);
    harness.controller.stop();
  });

  it('handles snapshots, joins, leaves, profiles, activities, and untrusted telemetry', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [
      player('self-0001', 'Self'),
      player('alice-001', 'Alice', {
        fps: 55,
        rttMs: 30,
        state: 'online',
        region: 'Japan',
        updatedAt: 10,
      }),
    ]);
    const firstSnapshot = harness.controller.getState();

    harness.controller.replacePlayers([
      player('self-0001', 'Self'),
      { id: 'alice-001', name: '  Alice 2  ' },
    ]);
    expect(harness.controller.getState().players.find(({ id }) => id === 'alice-001')).toMatchObject({
      name: 'Alice 2',
      fps: 55,
      rttMs: 30,
      region: 'Japan',
    });
    harness.controller.playerJoined(player('bob-00001', 'Bob'));
    harness.controller.playerJoined({ id: '<script>', name: 'ignored' });
    harness.controller.updateProfile('bob-00001', `  B\u0000${'o'.repeat(30)}  `);
    harness.controller.updateActivity('bob-00001', 'moving');
    harness.controller.updateActivity('bob-00001', 'hacked' as never);
    harness.controller.receive('bob-00001', {
      fps: 901,
      rttMs: -12,
      state: 'driving',
      region: '\u0000 Moon ',
      updatedAt: 33,
    });
    expect(harness.controller.getState().players.find(({ id }) => id === 'bob-00001')).toEqual({
      id: 'bob-00001',
      name: `B${'o'.repeat(23)}`,
      connected: true,
      fps: 240,
      rttMs: 0,
      state: 'driving',
      region: 'Moon',
      updatedAt: 33,
    });
    harness.controller.receive('../bad', { fps: 10 });
    harness.controller.playerLeft('bob-00001');
    expect(harness.controller.getState().players.some(({ id }) => id === 'bob-00001')).toBe(false);
    expect(firstSnapshot.players.find(({ id }) => id === 'alice-001')).toMatchObject({
      name: 'Alice',
      fps: 55,
    });
    harness.controller.stop();
  });

  it('does not render or send when local or remote activity is unchanged', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [
      player('self-0001', 'Self'),
      player('alice-001', 'Alice'),
    ]);
    const renderCount = harness.renders.length;

    harness.controller.updateActivity('alice-001', 'online');
    harness.controller.updateActivity('self-0001', 'online');
    expect(harness.renders).toHaveLength(renderCount);
    expect(harness.payloads).toHaveLength(0);

    harness.controller.updateActivity('alice-001', 'moving');
    expect(harness.renders).toHaveLength(renderCount + 1);
    harness.controller.updateActivity('alice-001', 'moving');
    expect(harness.renders).toHaveLength(renderCount + 1);
    harness.controller.stop();
  });

  it('keeps away effective while hidden and restores the latest base activity when visible', () => {
    const harness = createHarness('China', 1_000);
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.setLocalVisibility(true);
    expect(harness.controller.getState().players[0]).toMatchObject({ state: 'away' });
    expect(harness.payloads.at(-1)).toMatchObject({ type: 'telemetry', state: 'away' });
    const hiddenRenderCount = harness.renders.length;
    const hiddenPayloadCount = harness.payloads.length;

    harness.controller.setLocalActivity('driving');
    harness.controller.setLocalActivity('playing');
    expect(harness.controller.getState().players[0]).toMatchObject({ state: 'away' });
    expect(harness.renders).toHaveLength(hiddenRenderCount);
    expect(harness.payloads).toHaveLength(hiddenPayloadCount);

    harness.setNow(1_750);
    harness.controller.setLocalVisibility(false);
    expect(harness.controller.getState().players[0]).toMatchObject({ state: 'playing' });
    expect(harness.payloads.at(-1)).toMatchObject({ type: 'telemetry', state: 'playing' });
    harness.controller.stop();
  });

  it('measures exact frame intervals without endpoint overcount or consecutive-window drift', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.recordFrame(1_000);
    for (let frame = 1; frame <= 8; frame += 1) {
      harness.controller.recordFrame(1_000 + frame * 100);
    }
    expect(harness.controller.getState().players[0]?.fps).toBe(10);
    for (let frame = 1; frame <= 8; frame += 1) {
      harness.controller.recordFrame(1_800 + frame * 100);
    }
    expect(harness.controller.getState().players[0]?.fps).toBe(10);

    harness.controller.stop();
  });

  it('measures approximately sixty FPS and resets cleanly after a backward timestamp', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.recordFrame(2_000);
    for (let frame = 1; frame <= 48; frame += 1) {
      harness.controller.recordFrame(2_000 + frame * (1_000 / 60));
    }
    expect(harness.controller.getState().players[0]?.fps).toBe(60);

    harness.controller.recordFrame(3_000);
    harness.controller.recordFrame(3_100);
    harness.controller.recordFrame(1_500);
    for (let frame = 1; frame <= 8; frame += 1) {
      harness.controller.recordFrame(1_500 + frame * 100);
    }
    expect(harness.controller.getState().players[0]?.fps).toBe(10);

    harness.controller.stop();
  });

  it('clamps burst frame samples', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.recordFrame(2_000);

    for (let frame = 1; frame <= 800; frame += 1) {
      harness.controller.recordFrame(2_000 + frame);
    }
    expect(harness.controller.getState().players[0]?.fps).toBe(240);
    harness.controller.stop();
  });

  it('uses monotonic ping nonces and ignores spoofed or already-consumed pongs', () => {
    const harness = createHarness('China', 1_000);
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.ping();
    harness.controller.ping();
    expect(harness.payloads).toEqual([
      { type: 'telemetry_ping', nonce: 1 },
      { type: 'telemetry_ping', nonce: 2 },
    ]);

    harness.setNow(1_042);
    harness.controller.handlePong(9_999);
    harness.controller.handlePong(-1);
    expect(harness.payloads).toHaveLength(2);
    harness.controller.handlePong(2);
    expect(harness.payloads.at(-1)).toEqual({
      type: 'telemetry',
      fps: 0,
      rttMs: 42,
      state: 'online',
      region: 'China',
    });
    const sendCount = harness.payloads.length;
    harness.controller.handlePong(2);
    expect(harness.payloads).toHaveLength(sendCount);
    harness.controller.stop();
  });

  it('expires unanswered pings after ten seconds and clears their timeout', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.ping();
    const nonce = harness.payloads[0]?.nonce as number;
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(10_000);
    const beforePong = harness.payloads.length;
    harness.controller.handlePong(nonce);
    expect(harness.payloads).toHaveLength(beforePong);
    harness.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pings every two seconds and replaces timers and pending work on reconnect', () => {
    const harness = createHarness();
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(harness.payloads).toEqual([{ type: 'telemetry_ping', nonce: 1 }]);
    expect(vi.getTimerCount()).toBe(2);

    harness.controller.connect('self-0001', 'level:party-1', [player('self-0001', 'Self')]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(harness.payloads.at(-1)).toEqual({ type: 'telemetry_ping', nonce: 2 });
    harness.controller.stop();
    const stoppedCount = harness.payloads.length;
    vi.advanceTimersByTime(20_000);
    expect(harness.payloads).toHaveLength(stoppedCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces throttled transitions into one trailing send with the latest effective state', () => {
    const harness = createHarness('\u0000  China and a region name that is too long  ', 1_000);
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.setLocalActivity('moving');
    expect(vi.getTimerCount()).toBe(1);

    harness.setNow(1_100);
    harness.controller.setLocalActivity('online');
    harness.setNow(1_200);
    harness.controller.setLocalVisibility(true);
    harness.controller.setLocalActivity('driving');
    expect(vi.getTimerCount()).toBe(2);
    expect(harness.payloads).toHaveLength(1);

    harness.setNow(1_749);
    vi.advanceTimersByTime(649);
    expect(harness.payloads).toHaveLength(1);
    harness.setNow(1_750);
    vi.advanceTimersByTime(1);

    expect(harness.payloads).toEqual([
      {
        type: 'telemetry',
        fps: 0,
        rttMs: 0,
        state: 'moving',
        region: 'China and a region name',
      },
      {
        type: 'telemetry',
        fps: 0,
        rttMs: 0,
        state: 'away',
        region: 'China and a region name',
      },
    ]);
    expect(vi.getTimerCount()).toBe(1);
    harness.controller.stop();
  });

  it('cancels coalesced telemetry on reconnect and stop without stale sends', () => {
    const harness = createHarness('China', 1_000);
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.setLocalActivity('moving');
    harness.setNow(1_100);
    harness.controller.setLocalActivity('online');
    expect(vi.getTimerCount()).toBe(2);

    harness.controller.connect('self-0001', 'level:party-1', [player('self-0001', 'Self')]);
    expect(vi.getTimerCount()).toBe(1);
    const beforeReconnectAdvance = harness.payloads.length;
    harness.setNow(2_000);
    vi.advanceTimersByTime(750);
    expect(harness.payloads).toHaveLength(beforeReconnectAdvance);

    harness.controller.setLocalActivity('moving');
    harness.setNow(2_100);
    harness.controller.setLocalActivity('playing');
    expect(vi.getTimerCount()).toBe(2);
    harness.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
    const beforeStopAdvance = harness.payloads.length;
    harness.setNow(3_000);
    vi.advanceTimersByTime(2_000);
    expect(harness.payloads).toHaveLength(beforeStopAdvance);
  });

  it('stop releases every timer and pending ping and clears all connection state', () => {
    const harness = createHarness();
    expect(harness.controller.getState()).toEqual({
      connection: 'connecting',
      selfId: null,
      channel: 'lobby',
      players: [],
    });
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.ping();
    harness.controller.ping();
    expect(vi.getTimerCount()).toBe(3);

    harness.controller.stop();
    expect(harness.controller.getState()).toEqual({
      connection: 'offline',
      selfId: null,
      channel: 'lobby',
      players: [],
    });
    expect(vi.getTimerCount()).toBe(0);
    harness.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
