import { describe, expect, it } from 'vitest';
import {
  MusicVendingMachine,
  VENDING_TRACK,
  VendingMachineSynth,
  vendingPlaybackSnapshot,
} from './vending-machine';

describe('music vending machine timeline', () => {
  it('keeps an idle machine quiet and deterministic', () => {
    const first = vendingPlaybackSnapshot(null, 100, false);
    const second = vendingPlaybackSnapshot(null, 999, false);
    expect(first.phase).toBe('idle');
    expect(first.activeSlots).toEqual([]);
    expect(first.displayText).toBe('- - -');
    expect(second).toEqual(first);
  });

  it('animates the coin before starting the 126 BPM song', () => {
    const state = vendingPlaybackSnapshot(10, 10 + VENDING_TRACK.coinSeconds / 2, false);
    expect(state.phase).toBe('coin');
    expect(state.coinVisible).toBe(true);
    expect(state.coinProgress).toBeCloseTo(0.5, 4);
    expect(state.displayText).toBe('INSERT');
  });

  it('produces deterministic active slots throughout the song', () => {
    const time = 4 + VENDING_TRACK.coinSeconds + 2.4;
    const first = vendingPlaybackSnapshot(4, time, false);
    const second = vendingPlaybackSnapshot(4, time, false);
    expect(first.phase).toBe('playing');
    expect(first.bar).toBeGreaterThanOrEqual(0);
    expect(first.activeSlots.length).toBeGreaterThan(0);
    expect(first.activeSlots.every((slot) => slot >= 0 && slot < 15)).toBe(true);
    expect(second).toEqual(first);
  });

  it('limits flashes and removes cabinet shake when reduced motion is enabled', () => {
    const time = VENDING_TRACK.coinSeconds + VENDING_TRACK.sixteenthSeconds * 64;
    const full = vendingPlaybackSnapshot(0, time, false);
    const reduced = vendingPlaybackSnapshot(0, time, true);
    expect(reduced.phase).toBe('playing');
    expect(reduced.reducedMotion).toBe(true);
    expect(Math.max(...reduced.slotIntensities)).toBeLessThanOrEqual(0.58);
    expect(reduced.signIntensity).toBeLessThan(full.signIntensity);
    expect(reduced.cabinetOffset).toEqual({ x: 0, y: 0 });
  });

  it('ends after all 18 bars without forcing a level transition', () => {
    const state = vendingPlaybackSnapshot(3, 3 + VENDING_TRACK.durationSeconds + 0.01, false);
    expect(VENDING_TRACK.bars).toBe(18);
    expect(VENDING_TRACK.musicSeconds).toBeCloseTo(34.2857, 3);
    expect(state.phase).toBe('ended');
    expect(state.coinVisible).toBe(false);
    expect(state.activeSlots).toEqual([]);
    expect(state.displayText).toBe('ありがとう');
  });
});

describe('MusicVendingMachine', () => {
  it('keeps the protected root fixed while only the inner cabinet animates', () => {
    const machine = new MusicVendingMachine();
    machine.root.position.set(2, 0, -7.42);
    machine.start(5);
    machine.update(5 + VENDING_TRACK.coinSeconds + VENDING_TRACK.sixteenthSeconds * 64.1);
    expect(machine.root.position.toArray()).toEqual([2, 0, -7.42]);
    expect(machine.localCollider.min.toArray()).toEqual([-1.21, 0, -0.63]);
    expect(machine.localCollider.max.toArray()).toEqual([1.21, 3.95, 0.63]);
    expect(machine.snapshot(6).phase).not.toBe('idle');
    machine.stop();
    expect(machine.snapshot(6).phase).toBe('idle');
    machine.dispose();
    machine.dispose();
  });

  it('allows the audio controller to stop safely before or after use', () => {
    const synth = new VendingMachineSynth();
    expect(synth.active).toBe(false);
    synth.stop();
    synth.stop();
    expect(synth.active).toBe(false);
  });
});
