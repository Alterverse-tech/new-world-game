import { describe, expect, it } from 'vitest';
import {
  applyLobbyPropInteraction,
  code,
  createLobbyProp,
  interactLobbyProp,
} from './lobby-props/generated/infernal-concert-grand';

describe('infernal concert grand interaction proxy', () => {
  it('exposes a focused listening prompt and synchronized playback state', () => {
    const root = createLobbyProp();
    expect(code).toBe('infernal-concert-grand');
    expect(root.userData.prompt).toBe('聆听原创钢琴曲');
    expect(root.getObjectByName('infernal-concert-grand-interaction-target')).toBeDefined();
    expect(root.getObjectByName('infernal-concert-grand-interaction-target')?.position.toArray()).toEqual([
      1.65,
      1.35,
      1.15,
    ]);

    interactLobbyProp(root);
    expect(root.userData.interactionState).toBe('playing-original-score');
    applyLobbyPropInteraction(root, { sequence: 3, ageSeconds: 12.5 });
    expect(root.userData).toMatchObject({
      interactionSequence: 3,
      interactionAgeSeconds: 12.5,
      interactionState: 'playing-original-score',
    });
    applyLobbyPropInteraction(root, { sequence: 3, ageSeconds: 56 });
    expect(root.userData.interactionState).toBe('ready');
  });
});
