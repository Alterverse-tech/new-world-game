import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const catalogPath = new URL('../src/lobby-catalog.json', import.meta.url);

test('the reviewed blue roadster is registered with its bounded car capability', async () => {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const roadster = catalog.items.find(({ id }) => id === 'code-azure-midnight-roadster');

  assert.deepEqual(roadster, {
    id: 'code-azure-midnight-roadster',
    name: '蓝曜双座跑车',
    category: '载具',
    kind: 'code',
    defaultScale: 1,
    code: 'azure-midnight-roadster',
    vehicle: {
      kind: 'car',
      enterRadius: 3.5,
      maxSpeed: 28,
      maxAcceleration: 21,
      maxAngularSpeed: 2.8,
    },
  });
});
