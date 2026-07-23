import { describe, expect, it, vi } from 'vitest';
import {
  INFERNAL_PIANO_SCORE,
  InfernalPianoAudio,
  planInfernalPianoPerformance,
  validateLicensedTrackSource,
  type LicensedTrackRights,
} from './infernal-piano-audio';

class MockAudioParam {
  public value = 0;
  public readonly events: Array<{ kind: string; value: number; time: number }> = [];

  public setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  public exponentialRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }
}

class MockAudioNode {
  public disconnected = false;
  public readonly connections: MockAudioNode[] = [];

  public connect<T extends MockAudioNode>(node: T): T {
    this.connections.push(node);
    return node;
  }

  public disconnect(): void {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class MockGain extends MockAudioNode {
  public readonly gain = new MockAudioParam();
}

class MockFilter extends MockAudioNode {
  public type = 'lowpass';
  public readonly frequency = new MockAudioParam();
  public readonly Q = new MockAudioParam();
}

class MockPanner extends MockAudioNode {
  public panningModel = 'HRTF';
  public distanceModel = 'inverse';
  public refDistance = 1;
  public maxDistance = 10_000;
  public rolloffFactor = 1;
  public readonly positionX = new MockAudioParam();
  public readonly positionY = new MockAudioParam();
  public readonly positionZ = new MockAudioParam();
}

class MockSource extends MockAudioNode {
  public onended: (() => void) | null = null;
  public readonly starts: number[] = [];
  public readonly stops: number[] = [];

  public start(time = 0): void {
    this.starts.push(time);
  }

  public stop(time = 0): void {
    this.stops.push(time);
  }
}

class MockOscillator extends MockSource {
  public type = 'sine';
  public readonly frequency = new MockAudioParam();
  public readonly detune = new MockAudioParam();
}

class MockBufferSource extends MockSource {
  public buffer: AudioBuffer | null = null;
}

class MockAudioContext {
  public currentTime = 10;
  public state: AudioContextState = 'suspended';
  public readonly resume = vi.fn(async () => { this.state = 'running'; });
  public readonly gains: MockGain[] = [];
  public readonly sources: MockSource[] = [];

  public createGain(): MockGain {
    const gain = new MockGain();
    this.gains.push(gain);
    return gain;
  }

  public createOscillator(): MockOscillator {
    const source = new MockOscillator();
    this.sources.push(source);
    return source;
  }

  public createBiquadFilter(): MockFilter {
    return new MockFilter();
  }

  public createPanner(): MockPanner {
    return new MockPanner();
  }

  public createBufferSource(): MockBufferSource {
    const source = new MockBufferSource();
    this.sources.push(source);
    return source;
  }

  public async decodeAudioData(): Promise<AudioBuffer> {
    return { duration: 1 } as AudioBuffer;
  }
}

class MockVisibilitySource {
  public visibilityState = 'visible';
  private listener: (() => void) | null = null;

  public addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listener = listener;
  }

  public removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    if (this.listener === listener) this.listener = null;
  }

  public hide(): void {
    this.visibilityState = 'hidden';
    this.listener?.();
  }
}

const RIGHTS: LicensedTrackRights = {
  rightsHolder: 'WhiteRoom Audio Studio',
  licenseId: 'WR-ORIGINAL-2026-07',
  authorizedUse: 'Public playback inside the WhiteRoom game',
};

describe('original infernal piano score planner', () => {
  it('is deterministic and explicitly identifies an original composition', () => {
    const first = planInfernalPianoPerformance();
    const second = planInfernalPianoPerformance();
    expect(second).toEqual(first);
    expect(INFERNAL_PIANO_SCORE.id).toBe('ember-nocturne-original-v1');
    expect(INFERNAL_PIANO_SCORE.originalityNotice).toContain('original score');
    expect(INFERNAL_PIANO_SCORE.originalityNotice).toContain('does not reproduce');
    expect(Object.isFrozen(INFERNAL_PIANO_SCORE)).toBe(true);
    expect(Object.isFrozen(INFERNAL_PIANO_SCORE.notes)).toBe(true);
  });

  it('plans a complete 88-key-safe, polyphonic two-hand performance with dynamics and pedal', () => {
    const plan = planInfernalPianoPerformance();
    expect(plan.durationSeconds).toBeGreaterThanOrEqual(45);
    expect(plan.durationSeconds).toBeLessThanOrEqual(60);
    expect(plan.notes.length).toBeGreaterThan(200);
    expect(plan.notes.every((note) => note.midi >= 21 && note.midi <= 108)).toBe(true);
    expect(plan.notes.every((note) => note.keyIndex >= 0 && note.keyIndex < 88)).toBe(true);
    expect(new Set(plan.notes.map((note) => note.hand))).toEqual(new Set(['left', 'right']));
    expect(new Set(plan.notes.map((note) => note.voice))).toEqual(new Set(['bass', 'tenor', 'inner', 'melody']));
    expect(new Set(plan.notes.map((note) => note.velocity).map((value) => value.toFixed(3))).size).toBeGreaterThan(12);
    expect(plan.pedal.some((event) => event.down)).toBe(true);
    expect(plan.pedal.some((event) => !event.down)).toBe(true);
    expect(plan.notes.some((note, index) => plan.notes.slice(index + 1).some((other) => (
      other.startSeconds < note.keyUpSeconds && other.startSeconds >= note.startSeconds
    )))).toBe(true);
  });
});

describe('InfernalPianoAudio lifecycle', () => {
  it('unlocks from a gesture, prevents duplicate starts, and releases every source on stop/restart', async () => {
    const context = new MockAudioContext();
    const master = new MockGain();
    const ended = vi.fn();
    const audio = new InfernalPianoAudio(
      context as unknown as AudioContext,
      master as unknown as GainNode,
      { onEnded: ended, visibilitySource: null },
    );

    expect(await audio.start()).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(audio.active).toBe(true);
    expect(audio.activeSourceCount).toBeGreaterThan(400);
    const scheduledCount = audio.activeSourceCount;
    expect(await audio.start()).toBe(false);
    expect(audio.activeSourceCount).toBe(scheduledCount);

    expect(audio.getActiveMidiNotes(10.06).length).toBeGreaterThan(0);
    audio.stop();
    expect(audio.active).toBe(false);
    expect(audio.activeSourceCount).toBe(0);
    expect(ended).toHaveBeenLastCalledWith('stopped');
    expect(context.sources.every((source) => source.disconnected)).toBe(true);

    expect(await audio.restart()).toBe(true);
    expect(audio.active).toBe(true);
    audio.leaveRealm();
    expect(audio.activeSourceCount).toBe(0);
    expect(ended).toHaveBeenLastCalledWith('left');
    audio.dispose();
    expect(() => audio.dispose()).not.toThrow();
    await expect(audio.start()).rejects.toThrow('disposed');
  });

  it('clears scheduled sources when the page becomes hidden', async () => {
    const context = new MockAudioContext();
    const visibility = new MockVisibilitySource();
    const ended = vi.fn();
    const audio = new InfernalPianoAudio(
      context as unknown as AudioContext,
      new MockGain() as unknown as GainNode,
      { onEnded: ended, visibilitySource: visibility },
    );
    await audio.start();
    visibility.hide();
    expect(audio.active).toBe(false);
    expect(audio.activeSourceCount).toBe(0);
    expect(ended).toHaveBeenLastCalledWith('hidden');
    audio.dispose();
  });

  it('resumes a persisted multiplayer performance from its authoritative elapsed offset', async () => {
    const context = new MockAudioContext();
    const audio = new InfernalPianoAudio(
      context as unknown as AudioContext,
      new MockGain() as unknown as GainNode,
      { visibilitySource: null },
    );
    expect(await audio.start(20)).toBe(true);
    expect(audio.active).toBe(true);
    const activeAtResume = audio.getActiveMidiNotes(context.currentTime + 0.06);
    const expected = planInfernalPianoPerformance().notes
      .filter((note) => 20.005 >= note.startSeconds && 20.005 < note.keyUpSeconds)
      .map((note) => note.midi);
    expect(activeAtResume).toEqual([...new Set(expected)].sort((left, right) => left - right));
    expect(audio.activeSourceCount).toBeLessThan(planInfernalPianoPerformance().notes.length * 2 + 1);
    audio.dispose();
  });
});

describe('licensed track safety gate', () => {
  it('accepts only same-origin URLs carrying complete rights metadata', () => {
    const valid = validateLicensedTrackSource(
      { url: '/assets/audio/licensed/authorized-performance.ogg', rights: RIGHTS },
      'https://altverse.fun',
    );
    expect(valid.href).toBe('https://altverse.fun/assets/audio/licensed/authorized-performance.ogg');

    expect(() => validateLicensedTrackSource(
      { url: 'https://media.invalid/track.ogg', rights: RIGHTS },
      'https://altverse.fun',
    )).toThrow('same origin');

    expect(() => validateLicensedTrackSource(
      {
        url: '/assets/audio/licensed/unverified.ogg',
        rights: { ...RIGHTS, licenseId: '' },
      },
      'https://altverse.fun',
    )).toThrow('rightsHolder, licenseId, and authorizedUse');
  });

  it('rejects unsafe optional configuration before fetching or playing it', () => {
    const context = new MockAudioContext();
    const master = new MockGain();
    expect(() => new InfernalPianoAudio(
      context as unknown as AudioContext,
      master as unknown as GainNode,
      {
        licensedTrackUrl: 'https://media.invalid/track.ogg',
        licensedTrackRights: RIGHTS,
        assetOrigin: 'https://altverse.fun',
        visibilitySource: null,
      },
    )).toThrow('same origin');

    expect(() => new InfernalPianoAudio(
      context as unknown as AudioContext,
      master as unknown as GainNode,
      {
        licensedTrackUrl: '/assets/audio/licensed/unverified.ogg',
        assetOrigin: 'https://altverse.fun',
        visibilitySource: null,
      },
    )).toThrow('rightsHolder, licenseId, and authorizedUse');
  });
});
