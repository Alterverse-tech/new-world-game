import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AssetCenterOpenApiClient,
  AssetCenterOpenApiError,
  MAX_ASSET_CENTER_GLB_BYTES,
} from '../src/asset-center-openapi.js';

const SERVICE_TOKEN = `acs_live_test_${'s'.repeat(40)}`;
const EXTERNAL_USER_ID = 'owner-123e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-07-24T08:00:00.000Z';

function generation(overrides = {}) {
  return {
    id: 'acj_generation_123',
    object: 'asset_generation',
    status: 'queued',
    progress: 0,
    stage: 'queued',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function asset(overrides = {}) {
  return {
    id: 'ast_asset_123',
    object: 'asset',
    display_name: '蓝色能量水晶',
    format: 'glb',
    generation_id: 'acj_generation_123',
    download_url_endpoint: '/openapi/v1/assets/ast_asset_123/download-url',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeHeaderOnlyGlb() {
  const buffer = Buffer.alloc(12);
  buffer.write('glTF', 0, 'ascii');
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  return buffer;
}

test('creates a generation with server credentials, external owner identity, and idempotency', async () => {
  const calls = [];
  const client = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return jsonResponse(generation(), 202);
    },
  });

  const result = await client.createGeneration({
    externalUserId: EXTERNAL_USER_ID,
    prompt: '  一个低多边形风格的蓝色能量水晶  ',
    displayName: ' 蓝色能量水晶 ',
    idempotencyKey: 'wr_job_12345678',
  });

  assert.equal(result.id, 'acj_generation_123');
  assert.equal(result.status, 'queued');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://asset-center.example.test/openapi/v1/generations');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE_TOKEN}`);
  assert.equal(calls[0].init.headers['X-External-User-Id'], EXTERNAL_USER_ID);
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'wr_job_12345678');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: '一个低多边形风格的蓝色能量水晶',
    display_name: '蓝色能量水晶',
  });
  assert.equal(JSON.stringify(result).includes(SERVICE_TOKEN), false);
});

test('reads a completed generation and validates its GLB without forwarding service credentials', async () => {
  const glb = makeHeaderOnlyGlb();
  const sha256 = createHash('sha256').update(glb).digest('hex');
  const calls = [];
  const client = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test/openapi/v1',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      if (url.pathname.endsWith('/generations/acj_generation_123')) {
        return jsonResponse(generation({
          status: 'succeeded',
          progress: 100,
          stage: 'completed',
          asset: asset({ size_bytes: glb.length, sha256 }),
        }));
      }
      if (url.pathname.endsWith('/assets/ast_asset_123/download-url')) {
        return jsonResponse({
          url: 'https://downloads.example.test/private/model.glb?signature=short-lived',
          expires_at: '2026-07-24T08:05:00.000Z',
        });
      }
      if (url.hostname === 'downloads.example.test') {
        return new Response(glb, {
          status: 200,
          headers: {
            'Content-Type': 'model/gltf-binary',
            'Content-Length': String(glb.length),
          },
        });
      }
      throw new Error('unexpected request');
    },
  });

  const completed = await client.getGeneration({
    externalUserId: EXTERNAL_USER_ID,
    generationId: 'acj_generation_123',
  });
  const target = await client.getDownloadTarget({
    externalUserId: EXTERNAL_USER_ID,
    assetId: completed.asset.id,
  });
  const downloaded = await client.downloadGlb({
    url: target.url,
    expectedSizeBytes: completed.asset.sizeBytes,
    expectedSha256: completed.asset.sha256,
  });

  assert.equal(downloaded.sizeBytes, glb.length);
  assert.equal(downloaded.sha256, sha256);
  assert.deepEqual(downloaded.buffer, glb);
  assert.deepEqual(Object.keys(downloaded).sort(), ['buffer', 'sha256', 'sizeBytes']);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE_TOKEN}`);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${SERVICE_TOKEN}`);
  assert.equal(calls[2].init.headers.Authorization, undefined);
  assert.equal(calls[2].init.headers['X-External-User-Id'], undefined);
  assert.equal(calls[2].init.redirect, 'error');
});

test('returns a safe retryable error for upstream rate limiting', async () => {
  const client = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async () => jsonResponse({
      error: {
        code: 'rate_limited',
        message: `echoed credential ${SERVICE_TOKEN}`,
        request_id: 'req_123',
      },
    }, 429, { 'Retry-After': '7' }),
  });

  await assert.rejects(
    client.createGeneration({
      externalUserId: EXTERNAL_USER_ID,
      prompt: '一个安全的低多边形能量水晶',
      idempotencyKey: 'wr_job_12345678',
    }),
    (error) => {
      assert.ok(error instanceof AssetCenterOpenApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, 'rate_limited');
      assert.equal(error.retryAfterMs, 7_000);
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes(SERVICE_TOKEN), false);
      assert.equal(JSON.stringify(error).includes(SERVICE_TOKEN), false);
      assert.equal(Object.hasOwn(error, 'url'), false);
      return true;
    },
  );
});

test('turns an aborted upstream request into a safe timeout error', async () => {
  const client = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    timeoutMs: 100,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  });

  await assert.rejects(
    client.getGeneration({ externalUserId: EXTERNAL_USER_ID, generationId: 'acj_generation_123' }),
    (error) => {
      assert.ok(error instanceof AssetCenterOpenApiError);
      assert.equal(error.status, 504);
      assert.equal(error.code, 'asset_center_timeout');
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes(SERVICE_TOKEN), false);
      return true;
    },
  );
});

test('keeps the timeout active while consuming JSON and GLB response streams', async (t) => {
  await t.test('slow JSON body', async () => {
    let cancelled = false;
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      timeoutMs: 100,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('{"id":'));
        },
        cancel() {
          cancelled = true;
        },
      }), { status: 202 }),
    });
    await assert.rejects(
      client.createGeneration({
        externalUserId: EXTERNAL_USER_ID,
        prompt: '一个安全的低多边形能量水晶',
        idempotencyKey: 'wr_job_12345678',
      }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_timeout',
    );
    assert.equal(cancelled, true);
  });

  await t.test('slow GLB body', async () => {
    let cancelled = false;
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      timeoutMs: 100,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(makeHeaderOnlyGlb());
        },
        cancel() {
          cancelled = true;
        },
      }), { status: 200 }),
    });
    await assert.rejects(
      client.downloadGlb({ url: 'https://downloads.example.test/model.glb' }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_timeout',
    );
    assert.equal(cancelled, true);
  });
});

test('cancels oversized JSON and GLB streams as soon as the byte limit is exceeded', async (t) => {
  await t.test('oversized JSON', async () => {
    let cancelled = false;
    let requestSignal;
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.alloc(300 * 1024, 0x20));
          },
          cancel() {
            cancelled = true;
          },
        }), { status: 202 });
      },
    });
    await assert.rejects(
      client.createGeneration({
        externalUserId: EXTERNAL_USER_ID,
        prompt: '一个安全的低多边形能量水晶',
        idempotencyKey: 'wr_job_12345678',
      }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_response_too_large',
    );
    assert.equal(cancelled, true);
    assert.equal(requestSignal.aborted, true);
  });

  await t.test('oversized GLB', async () => {
    let cancelled = false;
    let requestSignal;
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(makeHeaderOnlyGlb());
            controller.enqueue(Buffer.alloc(8));
          },
          cancel() {
            cancelled = true;
          },
        }), { status: 200 });
      },
    });
    await assert.rejects(
      client.downloadGlb({
        url: 'https://downloads.example.test/model.glb',
        maximumBytes: 16,
      }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_glb_too_large',
    );
    assert.equal(cancelled, true);
    assert.equal(requestSignal.aborted, true);
  });
});

test('requires secure origins and rejects obvious local or private signed download targets', async () => {
  assert.throws(
    () => new AssetCenterOpenApiClient({
      origin: 'http://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
    }),
    /must use HTTPS outside localhost/,
  );
  assert.doesNotThrow(() => new AssetCenterOpenApiClient({
    origin: 'http://localhost:8787',
    serviceToken: SERVICE_TOKEN,
  }));

  let calls = 0;
  const directClient = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not fetch a private target');
    },
  });
  for (const url of [
    'https://localhost/model.glb',
    'https://127.0.0.1/model.glb',
    'https://10.20.30.40/model.glb',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.20/model.glb',
    'https://[::1]/model.glb',
    'https://[fd00::1]/model.glb',
  ]) {
    await assert.rejects(
      directClient.downloadGlb({ url }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'invalid_asset_download_url',
      url,
    );
  }
  assert.equal(calls, 0);

  const targetClient = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async () => jsonResponse({
      url: 'https://169.254.169.254/private/model.glb',
      expires_at: '2026-07-24T08:05:00.000Z',
    }),
  });
  await assert.rejects(
    targetClient.getDownloadTarget({ externalUserId: EXTERNAL_USER_ID, assetId: 'ast_asset_123' }),
    (error) => error instanceof AssetCenterOpenApiError && error.code === 'invalid_asset_center_response',
  );
});

test('rejects oversized, malformed, and checksum-mismatched GLB downloads', async (t) => {
  await t.test('content length over the hard ceiling', async () => {
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      fetchImpl: async () => new Response(new Uint8Array(), {
        status: 200,
        headers: { 'Content-Length': String(MAX_ASSET_CENTER_GLB_BYTES + 1) },
      }),
    });
    await assert.rejects(
      client.downloadGlb({ url: 'https://downloads.example.test/model.glb' }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_glb_too_large',
    );
  });

  await t.test('invalid GLB magic', async () => {
    const invalid = Buffer.alloc(12);
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      fetchImpl: async () => new Response(invalid),
    });
    await assert.rejects(
      client.downloadGlb({ url: 'https://downloads.example.test/model.glb' }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'invalid_asset_center_glb',
    );
  });

  await t.test('checksum mismatch', async () => {
    const glb = makeHeaderOnlyGlb();
    const client = new AssetCenterOpenApiClient({
      origin: 'https://asset-center.example.test',
      serviceToken: SERVICE_TOKEN,
      fetchImpl: async () => new Response(glb),
    });
    await assert.rejects(
      client.downloadGlb({
        url: 'https://downloads.example.test/model.glb',
        expectedSha256: '0'.repeat(64),
      }),
      (error) => error instanceof AssetCenterOpenApiError && error.code === 'asset_center_glb_checksum_mismatch',
    );
  });
});

test('rejects invalid user context and malformed successful responses before use', async () => {
  let calls = 0;
  const client = new AssetCenterOpenApiClient({
    origin: 'https://asset-center.example.test',
    serviceToken: SERVICE_TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ id: 'unexpected' }, 202);
    },
  });

  await assert.rejects(
    client.createGeneration({
      externalUserId: 'bad user id',
      prompt: '一个安全的低多边形能量水晶',
      idempotencyKey: 'wr_job_12345678',
    }),
    (error) => error instanceof AssetCenterOpenApiError && error.code === 'invalid_external_user_id',
  );
  assert.equal(calls, 0);

  await assert.rejects(
    client.createGeneration({
      externalUserId: EXTERNAL_USER_ID,
      prompt: '一个安全的低多边形能量水晶',
      idempotencyKey: 'wr_job_12345678',
    }),
    (error) => error instanceof AssetCenterOpenApiError && error.code === 'invalid_asset_center_response',
  );
  assert.equal(calls, 1);
});
