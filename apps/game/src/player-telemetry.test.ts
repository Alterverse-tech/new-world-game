import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlayerTelemetryController,
  detectPlayerRegion,
  normalizePlayerTelemetry,
  type PlayerTelemetryDependencies,
  type PlayerTelemetryState,
} from './player-telemetry';

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

  it('never sends telemetry more frequently than the server 750ms limit', () => {
    const harness = createHarness('\u0000  China and a region name that is too long  ', 1_000);
    harness.controller.connect('self-0001', 'lobby:0000', [player('self-0001', 'Self')]);
    harness.controller.setLocalActivity('moving');
    harness.setNow(1_749);
    harness.controller.setLocalActivity('away');
    harness.setNow(1_750);
    harness.controller.setLocalActivity('driving');
    harness.setNow(2_000);
    harness.controller.setLocalActivity('hacked' as never);

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
        state: 'driving',
        region: 'China and a region name',
      },
    ]);
    harness.controller.stop();
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
