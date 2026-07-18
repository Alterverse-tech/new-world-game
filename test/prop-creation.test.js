import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.js';
import { HttpError } from '../src/errors.js';

const UPLOAD_TOKEN = 'upload-token-for-prop-creation-tests';
const ADMIN_TOKEN = 'admin-token-for-prop-creation-tests';
const WORKER_TOKEN = 'worker-token-for-prop-creation-tests-0000000000000000';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function fakeSupabaseAuth(clock = Date.now) {
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
        publishableKey: 'sb_publishable_prop_creation_tests',
      };
    },
    async verifyRequest(request) {
      const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
      const user = users.get(match?.[1]);
      if (!user) throw new HttpError(401, 'account_token_invalid', 'Invalid test token');
      return { ...user, avatarUrl: null, expiresAt: clock() + 45 * 60 * 1000 };
    },
  };
}

async function createHarness(options = {}) {
  const dataDirectory = options.dataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'whiteroom-prop-creation-'));
  const application = await createApplication({
    uploadToken: UPLOAD_TOKEN,
    adminToken: ADMIN_TOKEN,
    propWorkerToken: WORKER_TOKEN,
    dataDirectory,
    supabaseAuth: fakeSupabaseAuth(options.clock),
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  return {
    application,
    dataDirectory,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`,
    async close({ remove = true } = {}) {
      if (application.server.listening) {
        await new Promise((resolve, reject) => application.server.close((error) => error ? reject(error) : resolve()));
      }
      if (remove) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

function setCookiePair(response) {
  const header = response.headers.get('set-cookie');
  return header?.split(';', 1)[0] ?? '';
}

async function login(harness, token) {
  const response = await fetch(`${harness.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return setCookiePair(response);
}

async function submit(harness, cookie, prompt = '做一盏会随玩家靠近而亮起的未来感落地灯', channel = '0000', headers = {}) {
  return fetch(`${harness.baseUrl}/api/account/prop-creations`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ prompt, channel }),
  });
}

async function claim(harness, workerId = 'haidong-mac') {
  const response = await fetch(`${harness.baseUrl}/api/worker/prop-creations/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId }),
  });
  return { response, body: response.status === 204 ? null : await response.json() };
}

function artifactFor(jobId, { unsafe = false, unsafeMode = false, extraPatch = '' } = {}) {
  const catalogId = 'code-nearby-lamp';
  const generatedPath = unsafe
    ? 'game/package.json'
    : 'game/src/lobby-props/generated/nearby-lamp.ts';
  let patch = [
    `diff --git a/${generatedPath} b/${generatedPath}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${generatedPath}`,
    '@@ -0,0 +1 @@',
    '+export const nearbyLamp = true;',
    '',
    'diff --git a/game/src/lobby-props/approved-modules.ts b/game/src/lobby-props/approved-modules.ts',
    'index 1111111..2222222 100644',
    '--- a/game/src/lobby-props/approved-modules.ts',
    '+++ b/game/src/lobby-props/approved-modules.ts',
    '@@ -1 +1,2 @@',
    ' export const approved = true;',
    '+export const nearby = true;',
    '',
    'diff --git a/platform/src/lobby-catalog.json b/platform/src/lobby-catalog.json',
    'index 1111111..2222222 100644',
    '--- a/platform/src/lobby-catalog.json',
    '+++ b/platform/src/lobby-catalog.json',
    '@@ -1 +1 @@',
    '-{}',
    '+{"updated":true}',
    '',
  ].join('\n') + extraPatch;
  if (unsafeMode) patch = patch.replace('new file mode 100644', 'new file mode 120000');
  const proposal = {
    schemaVersion: 1,
    jobId,
    name: '感应未来落地灯',
    summary: '靠近时灯体渐亮，离开后平滑熄灭；已通过物件安全校验。',
    kind: 'code',
    catalogId,
    codexThreadId: '019f-local-codex-thread-1234567890',
  };
  return makeZip([
    { name: 'proposal.json', data: `${JSON.stringify(proposal)}\n` },
    { name: 'changes.patch', data: patch },
  ]);
}

async function complete(harness, claimBody, artifact = artifactFor(claimBody.job.id), workerId = 'haidong-mac') {
  const form = new FormData();
  form.append('workerId', workerId);
  form.append('leaseToken', claimBody.leaseToken);
  form.append('file', new Blob([artifact], { type: 'application/zip' }), 'candidate.wrprop');
  return fetch(`${harness.baseUrl}/api/worker/prop-creations/${claimBody.job.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
    body: form,
  });
}

function publicationRequest(harness, jobId, action, body) {
  return fetch(`${harness.baseUrl}/api/worker/prop-creations/${jobId}/publication-${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function publicationRelease(overrides = {}) {
  return {
    id: 'auto-prop-20260717-001',
    gameRelease: '20260717-whiteroom-ugc-v35-auto-prop',
    platformRelease: '20260717-whiteroom-platform-v26-auto-prop',
    gameSha256: '1'.repeat(64),
    platformSha256: '2'.repeat(64),
    catalogId: 'code-nearby-lamp',
    publicUrl: 'https://altverse.fun/',
    ...overrides,
  };
}

test('prop creation feature requires an email account, same origin, and a configured local Codex bridge', async () => {
  const harness = await createHarness();
  try {
    const config = await (await fetch(`${harness.baseUrl}/api/account/prop-creations/config`)).json();
    assert.equal(config.enabled, true);
    assert.equal(config.requiresAccount, true);
    assert.equal(config.publicationMode, 'manual');
    assert.equal(config.worker.online, false);

    const configResponse = await fetch(`${harness.baseUrl}/api/account/prop-creations/config`);
    assert.equal(configResponse.headers.get('cache-control'), 'private, no-store');

    const guest = await submit(harness, '');
    assert.equal(guest.status, 401);
    assert.equal((await guest.json()).error.code, 'account_session_required');

    const cookie = await login(harness, 'token-a');
    const crossSite = await submit(harness, cookie, undefined, undefined, {
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).error.code, 'cross_origin_lobby_write');
    assert.equal(crossSite.headers.get('cache-control'), 'no-store');

    const nullBody = await fetch(`${harness.baseUrl}/api/account/prop-creations`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(nullBody.status, 422);
    assert.equal((await nullBody.json()).error.code, 'invalid_prop_creation');

    const invalid = await submit(harness, cookie, 'x');
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, 'invalid_prop_prompt');
  } finally {
    await harness.close();
  }

  const disabled = await createHarness({ propWorkerToken: null });
  try {
    const config = await (await fetch(`${disabled.baseUrl}/api/account/prop-creations/config`)).json();
    assert.equal(config.enabled, false);
    const cookie = await login(disabled, 'token-a');
    const response = await submit(disabled, cookie);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'prop_creation_unavailable');
  } finally {
    await disabled.close();
  }
});

test('account prop creation jobs are owner-isolated, durable, bounded, and cancellable only while queued', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-prop-creation-restart-'));
  const first = await createHarness({ dataDirectory });
  let aliceCookie;
  let bobCookie;
  let firstJob;
  try {
    aliceCookie = await login(first, 'token-a');
    bobCookie = await login(first, 'token-b');
    const created = await submit(first, aliceCookie);
    assert.equal(created.status, 202);
    firstJob = (await created.json()).job;
    assert.equal(firstJob.status, 'queued');
    assert.equal(firstJob.channel, '0000');

    const aliceJobs = await (await fetch(`${first.baseUrl}/api/account/prop-creations`, {
      headers: { Cookie: aliceCookie },
    })).json();
    assert.deepEqual(aliceJobs.jobs.map(({ id }) => id), [firstJob.id]);
    const bobJobs = await (await fetch(`${first.baseUrl}/api/account/prop-creations`, {
      headers: { Cookie: bobCookie },
    })).json();
    assert.deepEqual(bobJobs.jobs, []);
    const hidden = await fetch(`${first.baseUrl}/api/account/prop-creations/${firstJob.id}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(hidden.status, 404);

    const second = await submit(first, aliceCookie, '做一张可以坐下后改变颜色的金属长椅');
    assert.equal(second.status, 202);
    const limited = await submit(first, aliceCookie, '做一个慢慢旋转的空间站模型');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'prop_creation_limit_reached');

    const cancelled = await fetch(`${first.baseUrl}/api/account/prop-creations/${firstJob.id}/cancel`, {
      method: 'POST',
      headers: { Cookie: aliceCookie },
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).job.status, 'cancelled');
  } finally {
    await first.close({ remove: false });
  }

  const restarted = await createHarness({ dataDirectory });
  try {
    aliceCookie = await login(restarted, 'token-a');
    const jobs = await (await fetch(`${restarted.baseUrl}/api/account/prop-creations`, {
      headers: { Cookie: aliceCookie },
    })).json();
    assert.equal(jobs.jobs.length, 2);
    assert.equal(jobs.jobs.some(({ id, status }) => id === firstJob.id && status === 'cancelled'), true);
  } finally {
    await restarted.close();
  }
});

test('the Mac worker uses a fenced lease, reports safe progress, and uploads only allowlisted review artifacts', async () => {
  const harness = await createHarness();
  try {
    const cookie = await login(harness, 'token-a');
    const job = (await (await submit(harness, cookie)).json()).job;

    const unauthorized = await fetch(`${harness.baseUrl}/api/worker/prop-creations/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: 'haidong-mac' }),
    });
    assert.equal(unauthorized.status, 401);

    const claimed = await claim(harness);
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.body.job.id, job.id);
    assert.equal(claimed.body.job.prompt, job.prompt);
    assert.equal(typeof claimed.body.leaseToken, 'string');

    const resumed = await claim(harness);
    assert.equal(resumed.response.status, 200);
    assert.equal(resumed.body.job.id, job.id);
    assert.equal(resumed.body.resumed, true);
    assert.notEqual(resumed.body.leaseToken, claimed.body.leaseToken);

    const otherWorker = await claim(harness, 'other-mac');
    assert.equal(otherWorker.response.status, 204);

    const supersededProgress = await fetch(`${harness.baseUrl}/api/worker/prop-creations/${job.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workerId: 'haidong-mac',
        leaseToken: claimed.body.leaseToken,
        stage: 'generating',
        message: '旧租约不应继续生效',
      }),
    });
    assert.equal(supersededProgress.status, 409);
    assert.equal((await supersededProgress.json()).error.code, 'prop_creation_lease_lost');

    const config = await (await fetch(`${harness.baseUrl}/api/account/prop-creations/config`)).json();
    assert.equal(config.worker.online, true);

    const progress = await fetch(`${harness.baseUrl}/api/worker/prop-creations/${job.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workerId: 'haidong-mac',
        leaseToken: resumed.body.leaseToken,
        stage: 'generating',
        message: 'Codex 正在调用 whiteroom-lobby-prop',
      }),
    });
    assert.equal(progress.status, 200);
    assert.equal((await progress.json()).job.stage.code, 'generating');

    const unsafe = await complete(harness, resumed.body, artifactFor(job.id, { unsafe: true }));
    assert.equal(unsafe.status, 422);
    assert.equal((await unsafe.json()).error.code, 'unsafe_prop_patch_path');

    const unsafeMode = await complete(harness, resumed.body, artifactFor(job.id, { unsafeMode: true }));
    assert.equal(unsafeMode.status, 422);
    assert.equal((await unsafeMode.json()).error.code, 'invalid_prop_patch');

    const quotedPath = await complete(harness, resumed.body, artifactFor(job.id, {
      extraPatch: [
        'diff --git "a/game/package.json" "b/game/package.json"',
        '--- a/game/package.json',
        '+++ b/game/package.json',
        '@@ -1 +1 @@',
        '-{}',
        '+{"scripts":{}}',
        '',
      ].join('\n'),
    }));
    assert.equal(quotedPath.status, 422);
    assert.equal((await quotedPath.json()).error.code, 'unsafe_prop_patch_path');

    const completed = await complete(harness, resumed.body);
    assert.equal(completed.status, 200);
    const completedJob = (await completed.json()).job;
    assert.equal(completedJob.status, 'pending_review');
    assert.equal(completedJob.proposal.catalogId, 'code-nearby-lamp');
    assert.equal(Object.hasOwn(completedJob.proposal, 'codexThreadId'), false);

    const ownerDetail = await fetch(`${harness.baseUrl}/api/account/prop-creations/${job.id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(ownerDetail.headers.get('cache-control'), 'private, no-store');
    assert.equal(Object.hasOwn((await ownerDetail.json()).job.proposal, 'codexThreadId'), false);

    const staleProgress = await fetch(`${harness.baseUrl}/api/worker/prop-creations/${job.id}/progress`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: 'haidong-mac', leaseToken: resumed.body.leaseToken, stage: 'uploading', message: '重复' }),
    });
    assert.equal(staleProgress.status, 409);
    assert.equal((await staleProgress.json()).error.code, 'prop_creation_lease_lost');
  } finally {
    await harness.close();
  }
});

test('administrators can inspect, download, and review a Codex prop artifact without publishing executable code', async () => {
  const harness = await createHarness();
  try {
    const cookie = await login(harness, 'token-a');
    const submitted = (await (await submit(harness, cookie)).json()).job;
    const claimed = await claim(harness);
    const artifact = artifactFor(submitted.id);
    assert.equal((await complete(harness, claimed.body, artifact)).status, 200);

    const pending = await fetch(`${harness.baseUrl}/api/admin/prop-creations?status=pending_review`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(pending.status, 200);
    const list = await pending.json();
    assert.equal(list.total, 1);
    assert.equal(list.jobs[0].proposal.name, '感应未来落地灯');
    assert.equal(Object.hasOwn(list.jobs[0].proposal, 'codexThreadId'), false);
    assert.equal(pending.headers.get('cache-control'), 'private, no-store');

    const detail = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.job.artifactUrl.endsWith('/artifact'), true);
    assert.equal(detailBody.job.changedFiles.includes('game/src/lobby-props/generated/nearby-lamp.ts'), true);
    assert.equal(detailBody.job.proposal.codexThreadId, '019f-local-codex-thread-1234567890');
    assert.equal(detailBody.job.codexUrl, 'codex://threads/019f-local-codex-thread-1234567890');
    assert.equal(detail.headers.get('cache-control'), 'private, no-store');

    const unauthorizedDownload = await fetch(`${harness.baseUrl}${detailBody.job.artifactUrl}`);
    assert.equal(unauthorizedDownload.status, 401);
    assert.equal(unauthorizedDownload.headers.get('cache-control'), 'no-store');

    const download = await fetch(`${harness.baseUrl}${detailBody.job.artifactUrl}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    assert.equal(download.headers.get('content-disposition'), `attachment; filename="${submitted.id}.zip"`);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), artifact);

    const approved = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(approved.status, 200);
    const approvedJob = (await approved.json()).job;
    assert.equal(approvedJob.status, 'approved');
    assert.match(approvedJob.stage.message, /等待合并/);

    const catalog = await (await fetch(`${harness.baseUrl}/api/lobby/catalog`)).json();
    assert.equal(catalog.items.some(({ id }) => id === 'code-nearby-lamp'), false);
    const duplicateReview = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(duplicateReview.status, 409);

    const stored = JSON.parse(await readFile(
      path.join(harness.dataDirectory, 'prop-creations', 'records', `${submitted.id}.json`),
      'utf8',
    ));
    assert.equal(stored.status, 'approved');
    assert.equal(stored.lease, undefined);
    assert.deepEqual(
      stored.events.map(({ type }) => type),
      ['submitted', 'claimed', 'artifact_uploaded', 'reviewed'],
    );
  } finally {
    await harness.close();
  }
});

test('automatic publication keeps a rollback-compatible status while the Worker builds and records the verified release', async () => {
  const harness = await createHarness({ propAutoPublish: true });
  try {
    const config = await (await fetch(`${harness.baseUrl}/api/account/prop-creations/config`)).json();
    assert.equal(config.publicationMode, 'automatic');

    const cookie = await login(harness, 'token-a');
    const submitted = (await (await submit(harness, cookie)).json()).job;
    const claimed = await claim(harness);
    const completion = await complete(harness, claimed.body);
    assert.equal(completion.status, 200);
    const publishing = (await completion.json()).job;
    assert.equal(publishing.status, 'running');
    assert.equal(publishing.stage.code, 'publishing');
    assert.equal(publishing.publication.mode, 'automatic');
    assert.equal(publishing.publication.status, 'publishing');
    assert.equal(Object.hasOwn(publishing.publication, 'workerId'), false);
    assert.equal(Object.hasOwn(publishing.publication, 'tokenHash'), false);

    const runningList = await fetch(`${harness.baseUrl}/api/admin/prop-creations?status=running`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const runningBody = await runningList.json();
    assert.equal(runningBody.autoPublish, true);
    assert.equal(runningBody.jobs[0].publication.mode, 'automatic');

    const resumed = await claim(harness);
    assert.equal(resumed.response.status, 200);
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.job.phase, 'publication');
    assert.equal(resumed.body.job.stage.code, 'publishing');
    assert.equal(resumed.body.job.proposal.catalogId, 'code-nearby-lamp');
    assert.match(resumed.body.job.artifactSha256, /^[a-f0-9]{64}$/);

    const unauthorizedProgress = await fetch(
      `${harness.baseUrl}/api/worker/prop-creations/${submitted.id}/publication-progress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerId: 'haidong-mac',
          leaseToken: resumed.body.leaseToken,
          stage: 'building',
          message: '未授权请求不能更新发布状态',
        }),
      },
    );
    assert.equal(unauthorizedProgress.status, 401);

    const invalidStage = await publicationRequest(harness, submitted.id, 'progress', {
      workerId: 'haidong-mac',
      leaseToken: resumed.body.leaseToken,
      stage: 'uploading',
      message: '不允许回到候选上传阶段',
    });
    assert.equal(invalidStage.status, 422);

    const supersededLease = await publicationRequest(harness, submitted.id, 'progress', {
      workerId: 'haidong-mac',
      leaseToken: claimed.body.leaseToken,
      stage: 'building',
      message: '旧发布租约不能继续使用',
    });
    assert.equal(supersededLease.status, 409);
    assert.equal((await supersededLease.json()).error.code, 'prop_publication_lease_lost');

    const progress = await publicationRequest(harness, submitted.id, 'progress', {
      workerId: 'haidong-mac',
      leaseToken: resumed.body.leaseToken,
      stage: 'building',
      message: '正在构建不可变游戏与平台版本',
    });
    assert.equal(progress.status, 200);
    assert.equal((await progress.json()).job.stage.code, 'building');

    const wrongCatalog = await publicationRequest(harness, submitted.id, 'success', {
      workerId: 'haidong-mac',
      leaseToken: resumed.body.leaseToken,
      release: publicationRelease({ catalogId: 'code-another-prop' }),
    });
    assert.equal(wrongCatalog.status, 422);
    assert.equal((await wrongCatalog.json()).error.code, 'invalid_prop_publication');

    const successBody = {
      workerId: 'haidong-mac',
      leaseToken: resumed.body.leaseToken,
      release: publicationRelease(),
    };
    const success = await publicationRequest(harness, submitted.id, 'success', successBody);
    assert.equal(success.status, 200);
    const published = (await success.json()).job;
    assert.equal(published.status, 'approved');
    assert.equal(published.stage.code, 'published');
    assert.equal(published.publication.status, 'published');
    assert.equal(published.publication.release.catalogId, 'code-nearby-lamp');
    assert.equal(published.publication.release.publicUrl, 'https://altverse.fun/');

    const duplicate = await publicationRequest(harness, submitted.id, 'success', successBody);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).job.stage.code, 'published');

    const detail = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const detailJob = (await detail.json()).job;
    assert.equal(detailJob.publication.release.gameRelease, publicationRelease().gameRelease);
    assert.equal(Object.hasOwn(detailJob.publication, 'tokenHash'), false);
    assert.deepEqual(
      detailJob.events.map(({ type }) => type),
      ['submitted', 'claimed', 'artifact_uploaded', 'publication_started', 'lease_resumed', 'published'],
    );

    const duplicateReview = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(duplicateReview.status, 409);
  } finally {
    await harness.close();
  }
});

test('automatic mode keeps legacy pending reviews as history without consuming active creation slots', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'whiteroom-prop-creation-legacy-review-'));
  const limits = { maxDailyPerOwner: 10 };
  const manual = await createHarness({ dataDirectory, propCreationLimits: limits });
  try {
    const cookie = await login(manual, 'token-a');
    for (const prompt of [
      '做一盏会随音乐变色的历史落地灯',
      '做一把可以互动切换材质的历史长椅',
    ]) {
      assert.equal((await submit(manual, cookie, prompt)).status, 202);
      const claimed = await claim(manual);
      assert.equal(claimed.response.status, 200);
      const completed = await complete(manual, claimed.body);
      assert.equal(completed.status, 200);
      assert.equal((await completed.json()).job.status, 'pending_review');
    }
  } finally {
    await manual.close({ remove: false });
  }

  const automatic = await createHarness({
    dataDirectory,
    propAutoPublish: true,
    propCreationLimits: limits,
  });
  try {
    const cookie = await login(automatic, 'token-a');
    const first = await submit(automatic, cookie, '做一辆可以驾驶的自动发布小汽车');
    const second = await submit(automatic, cookie, '做一架可以驾驶的自动发布小飞机');
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);

    const limited = await submit(automatic, cookie, '做第三个仍应受并发上限约束的自动发布物件');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'prop_creation_limit_reached');

    const history = await fetch(`${automatic.baseUrl}/api/admin/prop-creations?status=pending_review`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const historicalJobs = (await history.json()).jobs;
    assert.equal(historicalJobs.length, 2);
  } finally {
    await automatic.close();
  }
});

test('automatic publication failure records rollback outcome and remains visible in failed history', async () => {
  const harness = await createHarness({ propAutoPublish: true });
  try {
    const cookie = await login(harness, 'token-a');
    const submitted = (await (await submit(harness, cookie)).json()).job;
    const claimed = await claim(harness);
    assert.equal((await complete(harness, claimed.body)).status, 200);

    const progress = await publicationRequest(harness, submitted.id, 'progress', {
      workerId: 'haidong-mac',
      leaseToken: claimed.body.leaseToken,
      stage: 'deploying',
      message: '正在原子切换生产版本',
    });
    assert.equal(progress.status, 200);

    const invalidRollback = await publicationRequest(harness, submitted.id, 'failure', {
      workerId: 'haidong-mac',
      leaseToken: claimed.body.leaseToken,
      code: 'deployment_failed',
      message: '生产验证未通过',
      rollback: { attempted: false, succeeded: true },
    });
    assert.equal(invalidRollback.status, 422);

    const failureBody = {
      workerId: 'haidong-mac',
      leaseToken: claimed.body.leaseToken,
      code: 'deployment_failed',
      message: '生产验证未通过，已恢复上一版本',
      rollback: { attempted: true, succeeded: true },
    };
    const failure = await publicationRequest(harness, submitted.id, 'failure', failureBody);
    assert.equal(failure.status, 200);
    const failed = (await failure.json()).job;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.stage.code, 'publish_failed');
    assert.equal(failed.publication.status, 'failed');
    assert.deepEqual(failed.publication.failure.rollback, { attempted: true, succeeded: true });

    const duplicate = await publicationRequest(harness, submitted.id, 'failure', failureBody);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).job.stage.code, 'publish_failed');

    const failedList = await fetch(`${harness.baseUrl}/api/admin/prop-creations?status=failed`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const failedJobs = (await failedList.json()).jobs;
    assert.equal(failedJobs.length, 1);
    assert.equal(failedJobs[0].publication.failure.code, 'deployment_failed');

    const stored = JSON.parse(await readFile(
      path.join(harness.dataDirectory, 'prop-creations', 'records', `${submitted.id}.json`),
      'utf8',
    ));
    assert.equal(stored.status, 'failed');
    assert.equal(stored.stage.code, 'publish_failed');
    assert.equal(stored.lease, undefined);
  } finally {
    await harness.close();
  }
});

test('an interrupted automatic publication remains reconcilable across repeated lease loss', async () => {
  let now = Date.parse('2026-07-17T00:00:00.000Z');
  const harness = await createHarness({
    propAutoPublish: true,
    clock: () => now,
    propCreationLimits: { leaseMs: 60_000, maxAttempts: 3 },
  });
  try {
    const cookie = await login(harness, 'token-a');
    const submitted = (await (await submit(harness, cookie)).json()).job;
    const claimed = await claim(harness);
    assert.equal((await complete(harness, claimed.body)).status, 200);

    now += 60_001;
    const secondAttempt = await claim(harness, 'recovery-mac');
    assert.equal(secondAttempt.response.status, 200);
    assert.equal(secondAttempt.body.resumed, true);
    assert.equal(secondAttempt.body.job.phase, 'publication');
    assert.match(secondAttempt.body.job.artifactSha256, /^[a-f0-9]{64}$/);

    now += 60_001;
    const thirdAttempt = await claim(harness, 'recovery-mac');
    assert.equal(thirdAttempt.response.status, 200);
    assert.equal(thirdAttempt.body.job.phase, 'publication');
    assert.equal(thirdAttempt.body.job.artifactSha256, secondAttempt.body.job.artifactSha256);

    now += 60_001;
    const fourthAttempt = await claim(harness, 'recovery-mac');
    assert.equal(fourthAttempt.response.status, 200);
    assert.equal(fourthAttempt.body.job.phase, 'publication');
    assert.equal(fourthAttempt.body.job.artifactSha256, secondAttempt.body.job.artifactSha256);

    const detail = await fetch(`${harness.baseUrl}/api/admin/prop-creations/${submitted.id}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const reconciling = (await detail.json()).job;
    assert.equal(reconciling.status, 'running');
    assert.equal(reconciling.stage.code, 'publishing');
    assert.equal(reconciling.publication.status, 'publishing');
    assert.equal(reconciling.events.filter(({ type }) => type === 'publication_requeued').length, 3);
  } finally {
    await harness.close();
  }
});

test('the platform serializes generation and publication globally across workers', async () => {
  const harness = await createHarness({ propAutoPublish: true });
  try {
    const alice = await login(harness, 'token-a');
    const bob = await login(harness, 'token-b');
    const aliceJob = (await (await submit(harness, alice, '做一盏会呼吸发光的方形壁灯')).json()).job;
    const bobJob = (await (await submit(harness, bob, '做一块可互动变色的未来路牌')).json()).job;

    const first = await claim(harness, 'worker-one');
    assert.equal(first.response.status, 200);
    assert.equal([aliceJob.id, bobJob.id].includes(first.body.job.id), true);
    assert.equal((await claim(harness, 'worker-two')).response.status, 204);

    assert.equal((await complete(harness, first.body, artifactFor(first.body.job.id), 'worker-one')).status, 200);
    assert.equal((await claim(harness, 'worker-two')).response.status, 204);
    const published = await publicationRequest(harness, first.body.job.id, 'success', {
      workerId: 'worker-one',
      leaseToken: first.body.leaseToken,
      release: publicationRelease(),
    });
    assert.equal(published.status, 200);

    const second = await claim(harness, 'worker-two');
    assert.equal(second.response.status, 200);
    assert.notEqual(second.body.job.id, first.body.job.id);
  } finally {
    await harness.close();
  }
});
