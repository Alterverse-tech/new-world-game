import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../src/errors.js';
import { createApplication } from '../src/server.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const OWNER_A = `owner-${USER_A}`;
const JOB_ID = 'propjob-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GENERATION_ID = 'acj_generation_123';
const REMOTE_ASSET_ID = 'ast_asset_123';
const SERVICE_TOKEN = `acs_live_test_${'s'.repeat(40)}`;
const SIGNED_URL = 'https://downloads.example.test/model.glb?X-Amz-Signature=secret-signature';
const UPLOAD_TOKEN = 'upload-token-for-asset-center-route-tests';
const ADMIN_TOKEN = 'admin-token-for-asset-center-route-tests';

function fakeSupabaseAuth() {
  const users = new Map([
    ['token-a', { subject: USER_A, email: 'alice@example.test', displayName: 'Alice' }],
    ['token-b', { subject: USER_B, email: 'bob@example.test', displayName: 'Bob' }],
  ]);
  return {
    enabled: true,
    publicConfig() {
      return {
        enabled: true,
        provider: 'email',
        supabaseUrl: 'https://project-ref.supabase.co',
        publishableKey: 'sb_publishable_asset_center_route_tests',
      };
    },
    async verifyRequest(request) {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
      const user = users.get(token);
      if (!user) throw new HttpError(401, 'account_token_invalid', 'Invalid test token');
      return { ...user, avatarUrl: null, expiresAt: Date.now() + 45 * 60 * 1000 };
    },
  };
}

function cookiePair(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
}

async function login(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return cookiePair(response);
}

test('account prop creation facade uses server identity and imports Asset Center GLB without exposing secrets', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-asset-center-route-'));
  const glbPath = fileURLToPath(new URL('../public/game/generated-assets/glb-luminous-plant.glb', import.meta.url));
  const glb = await readFile(glbPath);
  const sha256 = createHash('sha256').update(glb).digest('hex');
  const calls = [];
  const assetCenterClient = {
    serviceToken: SERVICE_TOKEN,
    async createGeneration(input) {
      calls.push(['createGeneration', input]);
      return {
        id: GENERATION_ID,
        status: 'succeeded',
        stage: 'completed',
        progress: 100,
        asset: {
          id: REMOTE_ASSET_ID,
          displayName: '蓝色发光植物',
          sizeBytes: glb.length,
          sha256,
        },
      };
    },
    async getDownloadTarget(input) {
      calls.push(['getDownloadTarget', input]);
      return { url: SIGNED_URL };
    },
    async downloadGlb(input) {
      calls.push(['downloadGlb', input]);
      return { buffer: glb, sizeBytes: glb.length, sha256 };
    },
  };
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    dataDirectory,
    supabaseAuth: fakeSupabaseAuth(),
    assetCenterClient,
    assetCenterPropCreationIdFactory: () => JOB_ID,
    logger: { error() {} },
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  try {
    const config = await (await fetch(`${baseUrl}/api/account/prop-creations/config`)).json();
    assert.equal(config.enabled, true);
    assert.equal(config.publicationMode, 'automatic');

    const unauthenticated = await fetch(`${baseUrl}/api/account/prop-creations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '一个蓝色发光的低多边形植物', channel: '0000' }),
    });
    assert.equal(unauthenticated.status, 401);

    const aliceCookie = await login(baseUrl, 'token-a');
    const spoofedIdentity = await fetch(`${baseUrl}/api/account/prop-creations`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '一个蓝色发光的低多边形植物',
        channel: '0000',
        externalUserId: `owner-${USER_B}`,
      }),
    });
    assert.equal(spoofedIdentity.status, 422);
    assert.equal(calls.length, 0);

    const createdResponse = await fetch(`${baseUrl}/api/account/prop-creations`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '一个蓝色发光的低多边形植物', channel: '0000' }),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    assert.equal(created.job.status, 'published');
    assert.equal(created.job.asset.kind, 'glb');
    assert.equal(created.job.asset.name, '蓝色发光植物');

    const apiInputs = calls.filter(([name]) => name !== 'downloadGlb').map(([, input]) => input);
    assert.deepEqual(apiInputs.map((input) => input.externalUserId), [OWNER_A, OWNER_A]);
    assert.equal(Object.hasOwn(apiInputs[0], 'email'), false);

    const browserPayload = JSON.stringify(created);
    assert.equal(browserPayload.includes(SERVICE_TOKEN), false);
    assert.equal(browserPayload.includes(SIGNED_URL), false);
    assert.equal(browserPayload.includes('X-Amz-Signature'), false);

    const ownerJobs = await (await fetch(`${baseUrl}/api/account/prop-creations`, {
      headers: { Cookie: aliceCookie },
    })).json();
    assert.equal(ownerJobs.jobs.some((job) => job.id === JOB_ID && job.status === 'published'), true);

    const ownerDetail = await (await fetch(`${baseUrl}/api/account/prop-creations/${JOB_ID}`, {
      headers: { Cookie: aliceCookie },
    })).json();
    assert.equal(ownerDetail.job.asset.id, created.job.asset.id);

    const assets = await (await fetch(`${baseUrl}/api/lobby/assets`, {
      headers: { Cookie: aliceCookie },
    })).json();
    assert.equal(assets.assets.some((asset) => asset.id === created.job.asset.id), true);

    const placed = await fetch(`${baseUrl}/api/lobby/objects?channel=0000`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'asset-center-client-0001',
        catalogId: created.job.asset.id,
        position: { x: -12, y: 0, z: -12 },
        rotationY: 0,
        scale: 1,
      }),
    });
    assert.equal(placed.status, 201, 'a generated asset must be placeable without restarting WhiteRoom');

    const bobCookie = await login(baseUrl, 'token-b');
    const crossOwner = await fetch(`${baseUrl}/api/account/prop-creations/${JOB_ID}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(crossOwner.status, 404);
  } finally {
    await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
