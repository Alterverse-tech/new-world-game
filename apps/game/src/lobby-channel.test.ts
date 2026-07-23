import { describe, expect, it } from 'vitest';
import {
  isPersistentSpaceChannel,
  isLobbyChannelProtocolName,
  LEGACY_LOBBY_CHANNEL,
  lobbyChannelFromSearch,
  lobbyChannelProtocolName,
  normalizeLobbyChannel,
  normalizePublicLobbyChannel,
  persistentSpaceChannel,
  withLobbyChannel,
} from './lobby-channel';

describe('lobby channel', () => {
  it('accepts only 4–12 digits as public lobbies and preserves leading zeroes', () => {
    expect(normalizePublicLobbyChannel(' 0012 ')).toBe('0012');
    expect(normalizePublicLobbyChannel('123456789012')).toBe('123456789012');
    expect(normalizePublicLobbyChannel('123')).toBeNull();
    expect(normalizePublicLobbyChannel('1234567890123')).toBeNull();
    expect(normalizePublicLobbyChannel('12 34')).toBeNull();
    expect(normalizePublicLobbyChannel('space-0012-heaven')).toBeNull();

    expect(normalizeLobbyChannel(' 0012 ')).toBe('0012');
    expect(normalizeLobbyChannel('123456789012')).toBe('123456789012');
    expect(normalizeLobbyChannel('room-1234')).toBeNull();
  });

  it('derives one reviewed persistent channel per origin lobby and destination', () => {
    expect(persistentSpaceChannel('2048', 'heaven')).toBe('space-2048-heaven');
    expect(persistentSpaceChannel('0012', 'hell')).toBe('space-0012-hell');
    expect(persistentSpaceChannel(' 0012 ', 'heaven')).toBe('space-0012-heaven');
    expect(persistentSpaceChannel('2048', 'heaven')).not.toBe(persistentSpaceChannel('2048', 'hell'));
    expect(persistentSpaceChannel('2048', 'heaven')).not.toBe(persistentSpaceChannel('4096', 'heaven'));
    expect(() => persistentSpaceChannel('space-2048-heaven', 'hell')).toThrow(TypeError);
    expect(() => persistentSpaceChannel('../2048', 'heaven')).toThrow(TypeError);
    expect(() => persistentSpaceChannel('2048', 'limbo' as never)).toThrow(TypeError);
  });

  it('recognizes only canonical derived persistent-space channels', () => {
    for (const channel of ['space-2048-heaven', 'space-0012-hell', 'space-123456789012-heaven']) {
      expect(normalizeLobbyChannel(channel)).toBe(channel);
      expect(isPersistentSpaceChannel(channel)).toBe(true);
    }
    for (const channel of [
      'space-123-heaven',
      'space-1234567890123-hell',
      'space-2048-Heaven',
      'space-2048-limbo',
      'space-space-2048-heaven-hell',
      'space-../2048-heaven',
      'space-2048-heaven/extra',
    ]) {
      expect(normalizeLobbyChannel(channel)).toBeNull();
      expect(isPersistentSpaceChannel(channel)).toBe(false);
    }
  });

  it('uses only public lobbies in the visible entry form', () => {
    expect(lobbyChannelFromSearch('')).toBe(LEGACY_LOBBY_CHANNEL);
    expect(lobbyChannelFromSearch('?channel=2048')).toBe('2048');
    expect(lobbyChannelFromSearch('?channel=bad')).toBe(LEGACY_LOBBY_CHANNEL);
    expect(lobbyChannelFromSearch('?channel=space-2048-heaven')).toBe(LEGACY_LOBBY_CHANNEL);
  });

  it('builds isolated API and multiplayer channel names', () => {
    expect(withLobbyChannel('/api/lobby/state', '2048')).toBe('/api/lobby/state?channel=2048');
    expect(withLobbyChannel('/api/lobby/events?clientId=web-1', '0012'))
      .toBe('/api/lobby/events?clientId=web-1&channel=0012');
    expect(lobbyChannelProtocolName('2048')).toBe('lobby:2048');
    expect(isLobbyChannelProtocolName('lobby:2048')).toBe(true);
    expect(withLobbyChannel('/api/lobby/state', 'space-2048-heaven'))
      .toBe('/api/lobby/state?channel=space-2048-heaven');
    expect(withLobbyChannel('/api/lobby/events?clientId=web-1', 'space-0012-hell'))
      .toBe('/api/lobby/events?clientId=web-1&channel=space-0012-hell');
    expect(lobbyChannelProtocolName('space-2048-heaven')).toBe('lobby:space-2048-heaven');
    expect(isLobbyChannelProtocolName('lobby:space-2048-heaven')).toBe(true);
    expect(isLobbyChannelProtocolName('lobby:space-2048-limbo')).toBe(false);
    expect(isLobbyChannelProtocolName('lobby')).toBe(false);
    expect(() => withLobbyChannel('/api/lobby/state', '../bad')).toThrow(TypeError);
  });
});
