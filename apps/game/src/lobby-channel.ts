export const LEGACY_LOBBY_CHANNEL = '0000';
export type PersistentSpaceId = 'heaven' | 'hell';
export type PersistentSpaceChannel = `space-${string}-${PersistentSpaceId}`;

export const NUMERIC_LOBBY_CHANNEL_PATTERN = /^\d{4,12}$/;
export const PERSISTENT_SPACE_CHANNEL_PATTERN = /^space-\d{4,12}-(?:heaven|hell)$/;
export const LOBBY_CHANNEL_PATTERN = /^(?:\d{4,12}|space-\d{4,12}-(?:heaven|hell))$/;

export function isPersistentSpaceChannel(value: unknown): value is PersistentSpaceChannel {
  return typeof value === 'string' && PERSISTENT_SPACE_CHANNEL_PATTERN.test(value);
}

export function persistentSpaceChannel(originChannel: string, spaceId: PersistentSpaceId): PersistentSpaceChannel {
  const origin = normalizePublicLobbyChannel(originChannel);
  if (!origin) throw new TypeError('Persistent spaces require a 4–12 digit origin lobby');
  if (spaceId !== 'heaven' && spaceId !== 'hell') throw new TypeError('Unknown persistent space');
  return `space-${origin}-${spaceId}`;
}

export function normalizeLobbyChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim();
  return LOBBY_CHANNEL_PATTERN.test(channel) ? channel : null;
}

export function normalizePublicLobbyChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim();
  return NUMERIC_LOBBY_CHANNEL_PATTERN.test(channel) ? channel : null;
}

export function lobbyChannelFromSearch(search: string): string {
  const requested = normalizePublicLobbyChannel(new URLSearchParams(search).get('channel'));
  return requested ?? LEGACY_LOBBY_CHANNEL;
}

export function lobbyChannelProtocolName(channel: string): string {
  const normalized = normalizeLobbyChannel(channel);
  if (!normalized) throw new TypeError('Lobby channel must be a 4–12 digit lobby or a reviewed persistent space');
  return `lobby:${normalized}`;
}

export function isLobbyChannelProtocolName(value: unknown): value is string {
  return typeof value === 'string' && /^lobby:(?:\d{4,12}|space-\d{4,12}-(?:heaven|hell))$/.test(value);
}

export function withLobbyChannel(path: string, channel: string): string {
  const normalized = normalizeLobbyChannel(channel);
  if (!normalized) throw new TypeError('Lobby channel must be a 4–12 digit lobby or a reviewed persistent space');
  const url = new URL(path, 'https://whiteroom.invalid');
  url.searchParams.set('channel', normalized);
  return `${url.pathname}${url.search}${url.hash}`;
}
