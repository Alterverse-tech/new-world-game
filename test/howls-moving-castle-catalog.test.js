import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const catalogPath = new URL('../src/lobby-catalog.json', import.meta.url);

test('the extensible catalog preserves every v25 baseline item and the reviewed moving castle', async () => {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  assert.equal(catalog.schemaVersion, 1);
  const itemIds = catalog.items.map(({ id }) => id);
  assert.equal(new Set(itemIds).size, itemIds.length);
  for (const baselineId of [
    'code-ember-shift-sentinel',
    'code-glow-cube',
    'code-heaven-hell-door',
    'code-howls-moving-castle',
    'code-light-arch',
    'code-precision-rescue-helicopter',
    'code-soft-bench',
    'code-spacex-starship',
    'glb-lounge-chair',
    'glb-luminous-plant',
    'glb-pedestal-lamp',
    'glb-yellow-sports-car',
  ]) assert.equal(itemIds.includes(baselineId), true, `missing v25 baseline item ${baselineId}`);

  const castle = catalog.items.find(({ id }) => id === 'code-howls-moving-castle');
  assert.deepEqual(castle, {
    id: 'code-howls-moving-castle',
    name: '哈尔的移动城堡',
    category: '载具',
    kind: 'code',
    defaultScale: 1,
    code: 'howls-moving-castle',
    vehicle: {
      kind: 'car',
      enterRadius: 6,
      maxSpeed: 6,
      maxAcceleration: 18,
      maxAngularSpeed: 2.2,
    },
  });
});
