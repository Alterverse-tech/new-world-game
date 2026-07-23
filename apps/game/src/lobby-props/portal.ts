import type { LobbyPortalCapability, LobbyPortalDestination } from './types';
import type { PersistentSpaceId } from '../lobby-channel';

const PORTAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MIN_DESTINATIONS = 2;
const MAX_DESTINATIONS = 4;

function persistentSpaceId(value: unknown): value is PersistentSpaceId {
  return value === 'heaven' || value === 'hell';
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function parseLobbyPortalCapability(value: unknown): LobbyPortalCapability | null {
  if (
    !plainRecord(value)
    || !exactKeys(value, ['kind', 'destinations'])
    || value.kind !== 'space'
    || !Array.isArray(value.destinations)
    || value.destinations.length < MIN_DESTINATIONS
    || value.destinations.length > MAX_DESTINATIONS
  ) return null;

  const ids = new Set<string>();
  const spaceIds = new Set<PersistentSpaceId>();
  const destinations: LobbyPortalDestination[] = [];
  for (const candidate of value.destinations) {
    if (!plainRecord(candidate) || !exactKeys(candidate, ['id', 'label', 'spaceId'])) return null;
    const { id, label, spaceId } = candidate;
    if (
      typeof id !== 'string'
      || !PORTAL_ID_PATTERN.test(id)
      || ids.has(id)
      || typeof label !== 'string'
      || !label.trim()
      || label !== label.trim()
      || [...label].length > 20
      || !persistentSpaceId(spaceId)
      || spaceIds.has(spaceId)
      || id !== spaceId
    ) return null;
    ids.add(id);
    spaceIds.add(spaceId);
    destinations.push(Object.freeze({ id, label, spaceId }));
  }
  return Object.freeze({ kind: 'space', destinations: Object.freeze(destinations) });
}

export function lobbyPortalCapabilitiesMatch(
  left: LobbyPortalCapability,
  right: LobbyPortalCapability,
): boolean {
  const normalizedLeft = parseLobbyPortalCapability(left);
  const normalizedRight = parseLobbyPortalCapability(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

/** Sequence 0 previews the first destination; interaction 1 also enters it. */
export function lobbyPortalDestinationForSequence(
  portal: LobbyPortalCapability,
  sequence: number,
): LobbyPortalDestination {
  const normalized = parseLobbyPortalCapability(portal);
  if (!normalized) throw new Error('Invalid lobby portal capability');
  const safeSequence = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  return normalized.destinations[(safeSequence - 1) % normalized.destinations.length]!;
}
