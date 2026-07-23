export type PianoHand = 'left' | 'right';

export interface OriginalPianoNote {
  readonly beat: number;
  readonly durationBeats: number;
  readonly midi: number;
  readonly velocity: number;
  readonly hand: PianoHand;
  readonly voice: 'bass' | 'tenor' | 'inner' | 'melody';
}

export interface PianoPedalEvent {
  readonly beat: number;
  readonly down: boolean;
}

export interface OriginalPianoScore {
  readonly id: string;
  readonly title: string;
  readonly composerCredit: string;
  readonly originalityNotice: string;
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly durationBeats: number;
  readonly notes: readonly OriginalPianoNote[];
  readonly pedal: readonly PianoPedalEvent[];
}

export interface ScheduledPianoNote extends OriginalPianoNote {
  readonly id: string;
  readonly keyIndex: number;
  readonly frequencyHz: number;
  readonly startSeconds: number;
  readonly keyUpSeconds: number;
  readonly releaseSeconds: number;
}

export interface ScheduledPedalEvent extends PianoPedalEvent {
  readonly timeSeconds: number;
}

export interface PianoPerformancePlan {
  readonly scoreId: string;
  readonly title: string;
  readonly durationSeconds: number;
  readonly notes: readonly ScheduledPianoNote[];
  readonly pedal: readonly ScheduledPedalEvent[];
}

export interface LicensedTrackRights {
  readonly rightsHolder: string;
  readonly licenseId: string;
  readonly authorizedUse: string;
}

export interface LicensedTrackSource {
  readonly url: string;
  readonly rights: LicensedTrackRights;
}

export interface InfernalPianoPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type PianoPlaybackEndReason = 'completed' | 'stopped' | 'restarted' | 'hidden' | 'left';

interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface InfernalPianoAudioOptions {
  readonly musicGain?: number;
  readonly spatialPosition?: InfernalPianoPosition;
  readonly onEnded?: (reason: PianoPlaybackEndReason) => void;
  readonly licensedTrackUrl?: string;
  readonly licensedTrackRights?: LicensedTrackRights;
  readonly assetOrigin?: string;
  readonly fetchImpl?: typeof fetch;
  readonly visibilitySource?: VisibilitySource | null;
}

interface HarmonyBar {
  readonly bass: number;
  readonly left: readonly [number, number, number, number];
  readonly upper: readonly [number, number, number, number, number];
}

const HARMONY: readonly HarmonyBar[] = [
  { bass: 38, left: [38, 45, 53, 57], upper: [62, 65, 69, 76, 77] },
  { bass: 34, left: [34, 41, 50, 53], upper: [58, 62, 65, 69, 72] },
  { bass: 40, left: [40, 46, 55, 58], upper: [64, 67, 70, 74, 77] },
  { bass: 45, left: [45, 52, 61, 67], upper: [61, 64, 67, 70, 76] },
  { bass: 43, left: [43, 50, 58, 62], upper: [62, 67, 70, 74, 79] },
  { bass: 37, left: [37, 43, 52, 55], upper: [61, 64, 67, 73, 76] },
  { bass: 41, left: [41, 48, 57, 60], upper: [60, 65, 69, 72, 76] },
  { bass: 39, left: [39, 46, 55, 58], upper: [58, 63, 67, 70, 74] },
  { bass: 36, left: [36, 43, 52, 55], upper: [60, 63, 67, 71, 75] },
  { bass: 42, left: [42, 49, 58, 61], upper: [61, 66, 70, 73, 78] },
  { bass: 44, left: [44, 51, 60, 63], upper: [60, 63, 68, 72, 75] },
  { bass: 33, left: [33, 40, 49, 52], upper: [57, 61, 64, 68, 73] },
] as const;

const MELODY_RHYTHMS = [
  { offsets: [0.5, 1.5, 2.5, 3.25], lengths: [0.78, 0.66, 0.58, 0.62] },
  { offsets: [0.25, 1.25, 2.0, 3.0], lengths: [0.9, 0.68, 0.82, 0.72] },
  { offsets: [0.0, 1.0, 1.75, 2.75], lengths: [0.82, 0.6, 0.88, 0.84] },
] as const;

function freezeNote(note: OriginalPianoNote): OriginalPianoNote {
  return Object.freeze(note);
}

function buildOriginalScore(): OriginalPianoScore {
  const bars = 24;
  const beatsPerBar = 4;
  const notes: OriginalPianoNote[] = [];
  const pedal: PianoPedalEvent[] = [];

  for (let bar = 0; bar < bars; bar += 1) {
    const harmony = HARMONY[bar % HARMONY.length]!;
    const beat = bar * beatsPerBar;
    const isClosingBar = bar === bars - 1;
    const intensity = bar < 4 ? 0.72 : bar < 16 ? 0.88 : bar < 22 ? 0.96 : 0.78;

    pedal.push(Object.freeze({ beat, down: true }));
    pedal.push(Object.freeze({ beat: beat + (isClosingBar ? 3.92 : 3.72), down: false }));

    if (isClosingBar) {
      notes.push(
        freezeNote({ beat, durationBeats: 4, midi: harmony.bass, velocity: 0.58, hand: 'left', voice: 'bass' }),
        freezeNote({ beat, durationBeats: 4, midi: harmony.left[2], velocity: 0.48, hand: 'left', voice: 'tenor' }),
        ...harmony.upper.slice(0, 4).map((midi, index) => freezeNote({
          beat,
          durationBeats: 4,
          midi,
          velocity: 0.48 + index * 0.035,
          hand: 'right' as const,
          voice: index === 3 ? 'melody' as const : 'inner' as const,
        })),
      );
      continue;
    }

    harmony.left.forEach((midi, index) => {
      notes.push(freezeNote({
        beat: beat + index,
        durationBeats: index === 0 ? 1.35 : 1.08,
        midi: index === 0 && bar >= 16 && bar % 2 === 0 ? midi - 12 : midi,
        velocity: (0.48 + (index === 0 ? 0.15 : index * 0.025)) * intensity,
        hand: 'left',
        voice: index === 0 ? 'bass' : 'tenor',
      }));
    });

    [0, 2].forEach((offset, phraseIndex) => {
      const upperOffset = (bar + phraseIndex * 2) % 3;
      notes.push(
        freezeNote({
          beat: beat + offset,
          durationBeats: 2.18,
          midi: harmony.upper[upperOffset]!,
          velocity: 0.34 * intensity,
          hand: 'right',
          voice: 'inner',
        }),
        freezeNote({
          beat: beat + offset + 0.04,
          durationBeats: 2.12,
          midi: harmony.upper[upperOffset + 1]!,
          velocity: 0.31 * intensity,
          hand: 'right',
          voice: 'inner',
        }),
      );
    });

    const rhythm = MELODY_RHYTHMS[bar % MELODY_RHYTHMS.length]!;
    rhythm.offsets.forEach((offset, index) => {
      const contourIndex = (bar * 2 + index * 3 + Math.floor(bar / 4)) % harmony.upper.length;
      const octaveLift = bar >= 12 && bar < 20 && index === 2 ? 12 : 0;
      notes.push(freezeNote({
        beat: beat + offset,
        durationBeats: rhythm.lengths[index]!,
        midi: harmony.upper[contourIndex]! + octaveLift,
        velocity: (0.53 + ((bar + index) % 4) * 0.055) * intensity,
        hand: 'right',
        voice: 'melody',
      }));
    });
  }

  notes.sort((a, b) => (
    a.beat - b.beat
    || (a.hand === b.hand ? 0 : a.hand === 'left' ? -1 : 1)
    || a.midi - b.midi
  ));
  return Object.freeze({
    id: 'ember-nocturne-original-v1',
    title: 'Ember Nocturne',
    composerCredit: 'Original in-game composition',
    originalityNotice: 'An original score that does not reproduce any pre-existing melody, harmony, recording, or arrangement.',
    bpm: 108,
    beatsPerBar,
    bars,
    durationBeats: bars * beatsPerBar,
    notes: Object.freeze(notes),
    pedal: Object.freeze(pedal),
  });
}

/** Pure score data for the default performance. It is an original composition. */
export const INFERNAL_PIANO_SCORE: OriginalPianoScore = buildOriginalScore();

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToPianoKeyIndex(midi: number): number {
  if (!Number.isInteger(midi) || midi < 21 || midi > 108) {
    throw new RangeError('A piano MIDI note must be an integer from 21 through 108.');
  }
  return midi - 21;
}

export function planInfernalPianoPerformance(
  score: OriginalPianoScore = INFERNAL_PIANO_SCORE,
): PianoPerformancePlan {
  const secondsPerBeat = 60 / score.bpm;
  const pedal = score.pedal.map((event) => Object.freeze({
    ...event,
    timeSeconds: event.beat * secondsPerBeat,
  }));

  const notes = score.notes.map((note, index) => {
    const startSeconds = note.beat * secondsPerBeat;
    const keyUpSeconds = (note.beat + note.durationBeats) * secondsPerBeat;
    const pedalUp = score.pedal.find((event) => !event.down && event.beat >= note.beat + note.durationBeats);
    const pedalReleaseSeconds = pedalUp ? pedalUp.beat * secondsPerBeat + 0.12 : keyUpSeconds;
    const naturalReleaseSeconds = keyUpSeconds + 0.42 + (1 - note.velocity) * 0.46;
    const releaseSeconds = Math.min(
      score.durationBeats * secondsPerBeat + 1.35,
      Math.max(naturalReleaseSeconds, pedalReleaseSeconds),
    );
    return Object.freeze({
      ...note,
      id: `${note.hand}-${note.voice}-${index}`,
      keyIndex: midiToPianoKeyIndex(note.midi),
      frequencyHz: midiToFrequency(note.midi),
      startSeconds,
      keyUpSeconds,
      releaseSeconds,
    });
  });

  const lastRelease = notes.reduce((latest, note) => Math.max(latest, note.releaseSeconds), 0);
  const durationSeconds = Math.max(score.durationBeats * secondsPerBeat + 1.35, lastRelease + 0.2);
  return Object.freeze({
    scoreId: score.id,
    title: score.title,
    durationSeconds,
    notes: Object.freeze(notes),
    pedal: Object.freeze(pedal),
  });
}

function requireRights(rights: LicensedTrackRights | undefined): asserts rights is LicensedTrackRights {
  if (!rights
    || !rights.rightsHolder.trim()
    || !rights.licenseId.trim()
    || !rights.authorizedUse.trim()) {
    throw new Error('Licensed audio requires rightsHolder, licenseId, and authorizedUse metadata.');
  }
}

export function validateLicensedTrackSource(source: LicensedTrackSource, pageOrigin: string): URL {
  requireRights(source.rights);
  const origin = new URL(pageOrigin);
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
    throw new Error('The asset origin must use HTTP or HTTPS.');
  }
  const url = new URL(source.url, origin);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== origin.origin) {
    throw new Error('Licensed audio must be served from the same origin as the game.');
  }
  return url;
}

function runtimeOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

function runtimeVisibilitySource(): VisibilitySource | null {
  return typeof document === 'undefined' ? null : document;
}

function setParam(param: AudioParam, value: number, time: number): void {
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time);
  else param.value = value;
}

export class InfernalPianoAudio {
  private readonly context: AudioContext;
  private readonly musicGainNode: GainNode;
  private readonly panner: PannerNode | null;
  private readonly plan = planInfernalPianoPerformance();
  private readonly onEnded: ((reason: PianoPlaybackEndReason) => void) | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly visibilitySource: VisibilitySource | null;
  private readonly visibilityListener: () => void;
  private readonly licensedSource: LicensedTrackSource | null;
  private readonly licensedUrl: URL | null;
  private licensedBuffer: AudioBuffer | null = null;
  private state: 'idle' | 'starting' | 'playing' | 'disposed' = 'idle';
  private generation = 0;
  private playbackStartTime: number | null = null;
  private scorePlayback = false;
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private readonly transientNodes = new Set<AudioNode>();

  public constructor(context: AudioContext, masterGain: GainNode, options: InfernalPianoAudioOptions = {}) {
    this.context = context;
    this.onEnded = options.onEnded;
    this.fetchImpl = options.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch.bind(globalThis));

    if (options.licensedTrackUrl) {
      const rights = options.licensedTrackRights;
      requireRights(rights);
      const source = Object.freeze({ url: options.licensedTrackUrl, rights });
      const origin = options.assetOrigin ?? runtimeOrigin();
      if (!origin) throw new Error('assetOrigin is required to validate licensed audio outside a browser.');
      this.licensedSource = source;
      this.licensedUrl = validateLicensedTrackSource(source, origin);
    } else {
      if (options.licensedTrackRights) {
        throw new Error('licensedTrackRights cannot be set without licensedTrackUrl.');
      }
      this.licensedSource = null;
      this.licensedUrl = null;
    }

    this.musicGainNode = context.createGain();
    this.musicGainNode.gain.value = Math.min(1.5, Math.max(0, options.musicGain ?? 0.72));

    if (options.spatialPosition && typeof context.createPanner === 'function') {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3.5;
      panner.maxDistance = 65;
      panner.rolloffFactor = 1.28;
      this.panner = panner;
      this.musicGainNode.connect(panner);
      panner.connect(masterGain);
      this.setPosition(options.spatialPosition);
    } else {
      this.panner = null;
      this.musicGainNode.connect(masterGain);
    }

    this.visibilitySource = options.visibilitySource === undefined
      ? runtimeVisibilitySource()
      : options.visibilitySource;
    this.visibilityListener = () => {
      if (this.visibilitySource?.visibilityState === 'hidden') this.stop('hidden');
    };
    this.visibilitySource?.addEventListener('visibilitychange', this.visibilityListener);
  }

  public get active(): boolean {
    return this.state === 'playing';
  }

  public get starting(): boolean {
    return this.state === 'starting';
  }

  public get activeSourceCount(): number {
    return this.sources.size;
  }

  public get musicGain(): number {
    return this.musicGainNode.gain.value;
  }

  public get licensedTrackUrl(): string | null {
    return this.licensedUrl?.href ?? null;
  }

  public setMusicGain(value: number): void {
    const safeValue = Math.min(1.5, Math.max(0, Number.isFinite(value) ? value : 0));
    setParam(this.musicGainNode.gain, safeValue, this.context.currentTime);
  }

  public setPosition(position: InfernalPianoPosition): void {
    if (!this.panner) return;
    setParam(this.panner.positionX, position.x, this.context.currentTime);
    setParam(this.panner.positionY, position.y, this.context.currentTime);
    setParam(this.panner.positionZ, position.z, this.context.currentTime);
  }

  public async loadLicensedTrack(): Promise<void> {
    if (!this.licensedSource || !this.licensedUrl) return;
    if (!this.fetchImpl) throw new Error('No fetch implementation is available for licensed audio.');
    const response = await this.fetchImpl(this.licensedUrl.href, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Licensed audio request failed with HTTP ${response.status}.`);
    this.licensedBuffer = await this.context.decodeAudioData(await response.arrayBuffer());
  }

  /** Call directly from a click/key interaction so the browser can unlock Web Audio. */
  public async start(offsetSeconds = 0): Promise<boolean> {
    this.assertUsable();
    if (this.state === 'starting' || this.state === 'playing') return false;
    const generation = ++this.generation;
    this.state = 'starting';
    try {
      if (this.context.state !== 'running') await this.context.resume();
      if (generation !== this.generation) return false;
      if (this.licensedSource && !this.licensedBuffer) await this.loadLicensedTrack();
      if (generation !== this.generation) return false;

      const duration = this.licensedBuffer?.duration ?? this.plan.durationSeconds;
      const offset = Math.min(
        Math.max(0, duration - 0.05),
        Math.max(0, Number.isFinite(offsetSeconds) ? offsetSeconds : 0),
      );
      const startTime = this.context.currentTime + 0.055;
      this.playbackStartTime = startTime - offset;
      this.scorePlayback = !this.licensedBuffer;
      if (this.licensedBuffer) this.scheduleLicensedBuffer(this.licensedBuffer, startTime, generation, offset);
      else this.scheduleOriginalScore(startTime, generation, offset);
      this.state = 'playing';
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.cleanupSources();
        this.playbackStartTime = null;
        this.scorePlayback = false;
        this.state = 'idle';
      }
      throw error;
    }
  }

  /** A deliberate second interaction restarts from the first bar without stacking sources. */
  public async restart(offsetSeconds = 0): Promise<boolean> {
    this.assertUsable();
    this.stop('restarted');
    return this.start(offsetSeconds);
  }

  public stop(reason: PianoPlaybackEndReason = 'stopped'): void {
    if (this.state === 'disposed') return;
    const shouldNotify = this.state === 'playing' || this.state === 'starting';
    this.generation += 1;
    this.cleanupSources();
    this.playbackStartTime = null;
    this.scorePlayback = false;
    this.state = 'idle';
    if (shouldNotify) this.onEnded?.(reason);
  }

  public leaveRealm(): void {
    this.stop('left');
  }

  public getActiveNotes(atContextTime = this.context.currentTime): readonly ScheduledPianoNote[] {
    if (!this.active || !this.scorePlayback || this.playbackStartTime === null) return [];
    const elapsed = atContextTime - this.playbackStartTime;
    if (elapsed < 0) return [];
    return this.plan.notes.filter((note) => elapsed >= note.startSeconds && elapsed < note.keyUpSeconds);
  }

  public getActiveMidiNotes(atContextTime = this.context.currentTime): readonly number[] {
    return Object.freeze([...new Set(this.getActiveNotes(atContextTime).map((note) => note.midi))].sort((a, b) => a - b));
  }

  public dispose(): void {
    if (this.state === 'disposed') return;
    this.stop('stopped');
    this.visibilitySource?.removeEventListener('visibilitychange', this.visibilityListener);
    try { this.musicGainNode.disconnect(); } catch { /* already disconnected */ }
    try { this.panner?.disconnect(); } catch { /* already disconnected */ }
    this.state = 'disposed';
  }

  private assertUsable(): void {
    if (this.state === 'disposed') throw new Error('InfernalPianoAudio has been disposed.');
  }

  private scheduleOriginalScore(startTime: number, generation: number, offsetSeconds: number): void {
    this.plan.notes
      .filter((note) => note.releaseSeconds > offsetSeconds)
      .forEach((note) => this.schedulePianoNote(note, startTime, offsetSeconds));
    const markerTime = startTime + Math.max(0.05, this.plan.durationSeconds - offsetSeconds);
    const marker = this.context.createOscillator();
    const silent = this.context.createGain();
    silent.gain.value = 0;
    marker.frequency.value = 1;
    marker.connect(silent);
    silent.connect(this.musicGainNode);
    this.transientNodes.add(silent);
    this.registerSingleSource(marker, [silent], () => this.finishNaturally(generation));
    marker.start(markerTime);
    marker.stop(markerTime + 0.025);
  }

  private schedulePianoNote(
    note: ScheduledPianoNote,
    performanceStart: number,
    offsetSeconds: number,
  ): void {
    const start = Math.max(performanceStart + 0.001, performanceStart + note.startSeconds - offsetSeconds);
    const keyUp = Math.max(start + 0.015, performanceStart + note.keyUpSeconds - offsetSeconds);
    const end = Math.max(keyUp + 0.02, performanceStart + note.releaseSeconds - offsetSeconds);
    const peak = Math.max(0.004, note.velocity ** 1.45 * 0.105);
    const cutoff = Math.min(9200, 1900 + note.frequencyHz * 5.2 + note.velocity * 2100);
    const partials = [
      { ratio: 1, level: 1, type: 'triangle' as OscillatorType, cents: (note.midi % 3 - 1) * 0.45 },
      { ratio: 2.003, level: 0.19 + note.velocity * 0.12, type: 'sine' as OscillatorType, cents: 0.8 },
    ];

    partials.forEach((partial, partialIndex) => {
      const oscillator = this.context.createOscillator();
      const partialGain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const envelope = this.context.createGain();
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(note.frequencyHz * partial.ratio, start);
      oscillator.detune.setValueAtTime(partial.cents, start);
      partialGain.gain.value = partial.level;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff * (partialIndex === 0 ? 1 : 1.18), start);
      filter.Q.value = 0.7 + note.velocity * 0.55;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + 0.004 + (1 - note.velocity) * 0.004);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.00035, peak * 0.19), Math.max(start + 0.09, keyUp));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(partialGain);
      partialGain.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.musicGainNode);
      this.transientNodes.add(partialGain);
      this.transientNodes.add(filter);
      this.transientNodes.add(envelope);
      this.registerSingleSource(oscillator, [partialGain, filter, envelope]);
      oscillator.start(start);
      oscillator.stop(end + 0.018);
    });
  }

  private scheduleLicensedBuffer(
    buffer: AudioBuffer,
    startTime: number,
    generation: number,
    offsetSeconds: number,
  ): void {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.musicGainNode);
    this.registerSingleSource(source, [], () => this.finishNaturally(generation));
    source.start(startTime, offsetSeconds);
  }

  private registerSingleSource(
    source: AudioScheduledSourceNode,
    ownedNodes: readonly AudioNode[],
    onEnded?: () => void,
  ): void {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      try { source.disconnect(); } catch { /* already disconnected */ }
      ownedNodes.forEach((node) => {
        this.transientNodes.delete(node);
        try { node.disconnect(); } catch { /* already disconnected */ }
      });
      onEnded?.();
    };
  }

  private finishNaturally(generation: number): void {
    if (generation !== this.generation || this.state !== 'playing') return;
    this.cleanupSources();
    this.playbackStartTime = null;
    this.scorePlayback = false;
    this.state = 'idle';
    this.onEnded?.('completed');
  }

  private cleanupSources(): void {
    const now = this.context.currentTime;
    this.sources.forEach((source) => {
      source.onended = null;
      try { source.stop(now); } catch { /* not started or already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    });
    this.transientNodes.forEach((node) => {
      try { node.disconnect(); } catch { /* already disconnected */ }
    });
    this.sources.clear();
    this.transientNodes.clear();
  }
}
