import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelLobbyPropCreation,
  fetchLobbyPropCreationConfig,
  fetchLobbyPropCreations,
  lobbyPropCreationErrorMessage,
  lobbyPropCreationIsActive,
  lobbyPropCreationStatusLabel,
  lobbyPropPromptIsValid,
  normalizeLobbyPropPrompt,
  parseLobbyPropCreationJob,
  submitLobbyPropCreation,
} from './lobby-prop-creation';

const NOW = '2026-07-16T08:00:00.000Z';
const JOB_ID = 'propjob-11111111-1111-4111-8111-111111111111';

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    prompt: '做一盏靠近玩家会亮起的未来感落地灯',
    channel: '0000',
    status: 'queued',
    stage: { code: 'queued', message: '等待这台 Mac 上的 Codex 接单', updatedAt: NOW },
    submittedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('lobby prop creation copy', () => {
  it('describes automatic publication and keeps review as history only', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('通过后会自动合并、构建并部署到大厅目录');
    expect(html).toContain('审核后台只保留发布历史和失败记录');
    expect(html).not.toContain('审核、合并和发布后才会出现在大厅目录');
  });
});

describe('lobby prop prompt validation', () => {
  it('normalizes Unicode/newlines and enforces the 4-600 character contract', () => {
    expect(normalizeLobbyPropPrompt('  Cafe\u0301\r\n灯  ')).toBe('Café\n灯');
    expect(lobbyPropPromptIsValid('未来感灯')).toBe(true);
    expect(lobbyPropPromptIsValid('abc')).toBe(false);
    expect(lobbyPropPromptIsValid('a'.repeat(600))).toBe(true);
    expect(lobbyPropPromptIsValid('a'.repeat(601))).toBe(false);
    expect(lobbyPropPromptIsValid('灯\u0000具')).toBe(false);
  });
});

describe('lobby prop creation response parsing', () => {
  it('parses a published task and derives player labels without accepting arbitrary links', () => {
    const parsed = parseLobbyPropCreationJob(job({
      status: 'approved',
      stage: { code: 'published', message: '物件已自动发布', updatedAt: NOW },
      proposal: {
        name: '感应落地灯',
        summary: '靠近后平滑点亮。',
        kind: 'code',
        catalogId: 'code-nearby-lamp',
      },
      publication: {
        mode: 'automatic',
        status: 'published',
        startedAt: NOW,
        updatedAt: NOW,
        publishedAt: NOW,
        release: {
          id: 'auto-20260716-nearby-lamp',
          catalogId: 'code-nearby-lamp',
          gameRelease: '20260716-whiteroom-ugc-auto-nearby-lamp',
          platformRelease: '20260716-whiteroom-platform-auto-nearby-lamp',
          gameSha256: 'a'.repeat(64),
          platformSha256: 'b'.repeat(64),
          publicUrl: 'https://altverse.fun/',
        },
      },
    }));
    expect(parsed.proposal?.name).toBe('感应落地灯');
    expect(parsed.proposal?.codexThreadId).toBeUndefined();
    expect(parsed.publication?.release?.catalogId).toBe('code-nearby-lamp');
    expect(lobbyPropCreationStatusLabel(parsed)).toBe('已自动发布');
    expect(lobbyPropCreationIsActive(parsed)).toBe(false);
  });

  it('keeps automatic publishing active while the trusted parent is deploying', () => {
    const parsed = parseLobbyPropCreationJob(job({
      status: 'running',
      stage: { code: 'deploying', message: '正在原子部署到生产', updatedAt: NOW },
    }));
    expect(lobbyPropCreationStatusLabel(parsed)).toBe('自动发布中');
    expect(lobbyPropCreationIsActive(parsed)).toBe(true);
  });

  it('rejects malformed IDs, states, timestamps, prompts, and hostile thread URLs', () => {
    expect(() => parseLobbyPropCreationJob(job({ id: '../../secret' }))).toThrow(/无法识别/);
    expect(() => parseLobbyPropCreationJob(job({ status: 'published_now' }))).toThrow(/无法识别/);
    expect(() => parseLobbyPropCreationJob(job({ submittedAt: 'tomorrow' }))).toThrow(/无法识别/);
    expect(() => parseLobbyPropCreationJob(job({ prompt: '灯\u0000具' }))).toThrow(/无法识别/);
    expect(() => parseLobbyPropCreationJob(job({
      proposal: {
        name: '灯',
        summary: '灯',
        kind: 'code',
        catalogId: 'code-lamp',
        codexThreadId: 'https://evil.example',
      },
    }))).toThrow(/物件候选/);
  });
});

describe('lobby prop creation API', () => {
  it('loads config/list and submits exact same-origin JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        enabled: true,
        requiresAccount: true,
        maximumPromptCharacters: 600,
        publicationMode: 'automatic',
        worker: { online: true, lastSeenAt: NOW },
      }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        jobs: [job()],
        worker: { online: true, lastSeenAt: NOW },
      }))
      .mockResolvedValueOnce(response({
        job: job(),
        worker: { online: true, lastSeenAt: NOW },
      }, 202));
    vi.stubGlobal('fetch', fetchMock);

    const config = await fetchLobbyPropCreationConfig();
    expect(config.worker.online).toBe(true);
    expect(config.publicationMode).toBe('automatic');
    expect((await fetchLobbyPropCreations()).jobs).toHaveLength(1);
    expect((await submitLobbyPropCreation('  未来感落地灯  ', '0000')).job.id).toBe(JOB_ID);

    const [pathname, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(pathname).toBe('/api/account/prop-creations');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('same-origin');
    expect(JSON.parse(options.body as string)).toEqual({ prompt: '未来感落地灯', channel: '0000' });
  });

  it('maps account, quota, and cancellation errors to player-safe messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: { code: 'account_session_required', message: 'internal' },
    }, 401)));
    await expect(fetchLobbyPropCreations()).rejects.toSatisfy((error: unknown) => (
      lobbyPropCreationErrorMessage(error).includes('登录邮箱账号')
    ));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: { code: 'prop_creation_cannot_cancel', message: 'internal' },
    }, 409)));
    await expect(cancelLobbyPropCreation(JOB_ID)).rejects.toSatisfy((error: unknown) => (
      lobbyPropCreationErrorMessage(error).includes('不能再取消')
    ));
  });
});
