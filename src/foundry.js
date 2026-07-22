import { randomBytes } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors.js';
import { atomicWriteJson } from './store.js';

const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ACTION_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const ROUTES = new Set(['auto', 'tripo', 'gemini_reference']);
const ROLES = new Set(['player', 'npc', 'enemy', 'boss', 'collectible', 'weapon', 'vehicle', 'hazard', 'prop', 'environment']);
const ASSET_KINDS = new Set(['character', 'creature', 'prop', 'vehicle', 'environment']);
const STATES = new Set(['pending', 'running', 'ready', 'failed']);
const MAX_ITEMS = 5;

function cleanText(value, maximum, { required = false } = {}) {
  if (typeof value !== 'string') {
    if (required) throw new HttpError(422, 'invalid_foundry_plan', 'Required text is missing');
    return '';
  }
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if ((required && !text) || [...text].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new HttpError(422, 'invalid_foundry_plan', `Text must contain at most ${maximum} characters`);
  }
  return text;
}

function clampProgress(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function normalizeState(value, fallback = 'pending') {
  const state = String(value || '').toLowerCase();
  if (STATES.has(state)) return state;
  if (/fail|error|cancel|terminate/.test(state)) return 'failed';
  if (/success|complete|ready/.test(state)) return 'ready';
  if (/run|process|generat|queue|submit|progress/.test(state)) return 'running';
  return fallback;
}

function safeRuntimeUrl(value) {
  if (typeof value !== 'string') return '';
  let candidate = value.trim().replaceAll('\\', '/');
  if (!candidate || /^https?:\/\//i.test(candidate)) return '';
  const publicIndex = candidate.indexOf('/public/generated-assets/');
  if (publicIndex >= 0) candidate = candidate.slice(publicIndex + '/public'.length);
  if (candidate.startsWith('public/generated-assets/')) candidate = `/${candidate.slice('public/'.length)}`;
  if (candidate.startsWith('./generated-assets/')) candidate = `/${candidate.slice(2)}`;
  if (candidate.startsWith('generated-assets/')) candidate = `/${candidate}`;
  if (!candidate.startsWith('/generated-assets/')) return '';
  const relative = candidate.slice('/generated-assets/'.length).split(/[?#]/, 1)[0];
  if (!relative || relative.includes('..') || relative.includes('\\') || relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return `/generated-assets/${relative}`;
}

async function readOptionalJson(file) {
  try {
    const [source, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { data: JSON.parse(source), modifiedAt: info.mtime.toISOString() };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { error: error.message, modifiedAt: null };
  }
}

function planItem(value, seenIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'invalid_foundry_plan', 'Each asset must be an object');
  }
  const id = cleanText(value.id, 64, { required: true }).toLowerCase();
  if (!PLAN_ID_PATTERN.test(id) || seenIds.has(id)) {
    throw new HttpError(422, 'invalid_foundry_plan', `Asset id "${id}" is invalid or duplicated`);
  }
  seenIds.add(id);
  const role = cleanText(value.role, 24, { required: true }).toLowerCase();
  const assetKind = cleanText(value.assetKind, 24, { required: true }).toLowerCase();
  if (!ROLES.has(role) || !ASSET_KINDS.has(assetKind)) {
    throw new HttpError(422, 'invalid_foundry_plan', `Asset "${id}" has an unsupported role or kind`);
  }
  const actions = [...new Set((Array.isArray(value.actions) ? value.actions : []).map((action) => cleanText(String(action), 32, { required: true }).toLowerCase()))];
  if (actions.some((action) => !ACTION_PATTERN.test(action)) || actions.length > 8) {
    throw new HttpError(422, 'invalid_foundry_plan', `Asset "${id}" has invalid semantic actions`);
  }
  return {
    id,
    name: cleanText(value.name, 60, { required: true }),
    role,
    assetKind,
    prompt: cleanText(value.prompt, 1000, { required: true }),
    actions,
  };
}

function validatePlanPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(422, 'invalid_foundry_plan', 'Plan body must be an object');
  }
  const route = cleanText(payload.route, 32, { required: true });
  if (!ROUTES.has(route)) throw new HttpError(422, 'invalid_foundry_plan', 'Unsupported asset route');
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > MAX_ITEMS) {
    throw new HttpError(422, 'invalid_foundry_plan', `A plan needs 1-${MAX_ITEMS} assets`);
  }
  const seenIds = new Set();
  return {
    projectName: cleanText(payload.projectName, 80, { required: true }),
    gamePrompt: cleanText(payload.gamePrompt, 2000, { required: true }),
    route,
    items: payload.items.map((item) => planItem(item, seenIds)),
  };
}

function emptyStatus(plan, now) {
  return {
    status: 'pending',
    runId: plan.runId,
    updatedAt: now,
    message: `生产计划已创建，等待 Shark worker 处理 ${plan.items.length} 个基础模型。`,
    items: plan.items.map((item) => ({
      id: item.id,
      name: item.name,
      role: item.role,
      status: 'pending',
      progress: 0,
      runtimeUrl: '',
      clips: item.actions.map((name) => ({ name, status: 'pending', progress: 0, runtimeUrl: '', error: '' })),
      error: '',
    })),
    failures: [],
  };
}

function publicManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    version: Number(raw.version || 1),
    schema: String(raw.schema || '').slice(0, 80),
    route: String(raw.route || '').slice(0, 80),
    bindings: raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {},
    assets: (Array.isArray(raw.assets) ? raw.assets : []).map((asset) => ({
      id: String(asset?.id || ''),
      name: String(asset?.name || asset?.id || ''),
      role: String(asset?.role || asset?.gameplayRole || ''),
      assetKind: String(asset?.assetKind || ''),
      model: {
        url: safeRuntimeUrl(asset?.model?.url ?? asset?.url),
        source: String(asset?.model?.source || asset?.source || ''),
      },
      rig: asset?.rig && typeof asset.rig === 'object' ? {
        rigged: Boolean(asset.rig.rigged),
        rigType: String(asset.rig.rigType || ''),
        animationSource: String(asset.rig.animationSource || ''),
      } : null,
      orientation: asset?.orientation && typeof asset.orientation === 'object' ? {
        nativeForwardAxis: String(asset.orientation.nativeForwardAxis || ''),
        canonicalForwardAxis: String(asset.orientation.canonicalForwardAxis || ''),
        calibrationYawDegrees: Number(asset.orientation.calibrationYawDegrees || 0),
        auditMethod: String(asset.orientation.auditMethod || ''),
        status: String(asset.orientation.status || 'UNVERIFIED'),
      } : null,
      actions: Object.fromEntries(Object.entries(asset?.actions || {}).map(([name, action]) => [name, {
        url: safeRuntimeUrl(action?.url),
        source: String(action?.source || ''),
        preset: String(action?.preset || ''),
      }])),
    })).filter((asset) => asset.id),
  };
}

function publicJobs(raw) {
  const jobs = raw?.jobs || raw?.assets || raw?.items || [];
  if (!Array.isArray(jobs)) return [];
  return jobs.map((job) => ({
    id: String(job?.id || ''),
    jobId: String(job?.jobId || job?.taskId || job?.requestId || ''),
    name: String(job?.name || job?.label || job?.id || ''),
    status: normalizeState(job?.status),
    progress: clampProgress(job?.progress ?? job?.modelProgress),
    stage: String(job?.stage || job?.phase || ''),
    error: String(job?.error || '').normalize('NFC').slice(0, 500),
    updatedAt: String(job?.updatedAt || job?.completedAt || ''),
  })).filter((job) => job.id);
}

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function verifiedRuntimeUrl(root, value) {
  const runtimeUrl = safeRuntimeUrl(value);
  if (!runtimeUrl) return '';
  const relative = runtimeUrl.slice('/generated-assets/'.length);
  const generatedRoot = path.resolve(root, 'public/generated-assets');
  const candidate = path.resolve(generatedRoot, relative);
  if (!candidate.startsWith(`${generatedRoot}${path.sep}`) || !(await fileExists(candidate))) return '';
  return runtimeUrl;
}

function mergeState(current, incoming, progress) {
  if (current === 'failed' || incoming === 'failed') return 'failed';
  if (current === 'ready' || incoming === 'ready') return 'ready';
  if (current === 'running' || incoming === 'running' || progress > 0) return 'running';
  return 'pending';
}

async function deriveStatus(root, plan, status, manifest, jobs) {
  if (!plan?.items?.length) return status ?? { status: 'idle', runId: '', updatedAt: '', message: '尚未创建模型生产计划。', items: [], failures: [] };
  const statusById = new Map((status?.items || []).map((item) => [item.id, item]));
  const manifestById = new Map((manifest?.assets || []).map((asset) => [asset.id, asset]));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const items = [];
  for (const planned of plan.items) {
    const current = statusById.get(planned.id) || {};
    const asset = manifestById.get(planned.id);
    const job = jobsById.get(planned.id);
    const conventional = `/generated-assets/${planned.id}.glb`;
    const runtimeUrl = await verifiedRuntimeUrl(root, current.runtimeUrl || asset?.model?.url || conventional);
    const error = String(current.error || job?.error || '');
    let itemState = error ? 'failed' : normalizeState(current.status, normalizeState(job?.status));
    itemState = mergeState(itemState, runtimeUrl ? 'ready' : 'pending', clampProgress(current.progress ?? job?.progress));
    const plannedActions = Array.isArray(planned.actions) ? planned.actions.map((action) => String(action?.name || action)) : [];
    const currentClips = new Map((current.clips || []).map((clip) => [clip.name, clip]));
    const clips = [];
    for (const name of plannedActions) {
      const clip = currentClips.get(name) || {};
      const action = asset?.actions?.[name] || {};
      const clipUrl = await verifiedRuntimeUrl(root, clip.runtimeUrl || action.url || `/generated-assets/${planned.id}-${name}.glb`);
      const clipError = String(clip.error || '');
      let clipState = clipError ? 'failed' : normalizeState(clip.status);
      clipState = mergeState(clipState, clipUrl ? 'ready' : 'pending', clampProgress(clip.progress));
      clips.push({
        name,
        status: clipState,
        progress: clipState === 'ready' ? 100 : Math.min(99, clampProgress(clip.progress)),
        runtimeUrl: clipUrl,
        error: clipError,
      });
    }
    items.push({
      id: planned.id,
      name: planned.name || planned.id,
      role: planned.role || 'prop',
      assetKind: planned.assetKind || asset?.assetKind || '',
      prompt: planned.prompt || '',
      status: itemState,
      progress: itemState === 'ready' ? 100 : Math.min(99, clampProgress(current.progress ?? job?.progress)),
      runtimeUrl,
      clips,
      error,
      job: job || null,
      manifest: asset || null,
    });
  }
  const allStates = items.flatMap((item) => [item.status, ...item.clips.map((clip) => clip.status)]);
  const failures = items.flatMap((item) => [
    ...(item.error ? [{ id: item.id, error: item.error }] : []),
    ...item.clips.filter((clip) => clip.error).map((clip) => ({ id: item.id, action: clip.name, error: clip.error })),
  ]);
  const overall = failures.length ? 'completed_with_errors' : allStates.length && allStates.every((state) => state === 'ready') ? 'ready' : allStates.some((state) => state === 'running' || state === 'ready') ? 'running' : 'pending';
  return {
    status: overall,
    runId: plan.runId || status?.runId || '',
    updatedAt: status?.updatedAt || plan.startedAt || '',
    message: status?.message || `${items.length} 个基础模型已进入生产计划。`,
    items,
    failures,
  };
}

export class FoundryStore {
  constructor({ rootDirectory, clock = Date.now } = {}) {
    this.rootDirectory = path.resolve(rootDirectory || '.');
    this.clock = clock;
  }

  async createPlan(payload) {
    const validated = validatePlanPayload(payload);
    const now = new Date(this.clock()).toISOString();
    const runId = `foundry-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
    const plan = {
      version: 1,
      runId,
      startedAt: now,
      projectName: validated.projectName,
      gamePrompt: validated.gamePrompt,
      route: validated.route,
      items: validated.items,
    };
    await atomicWriteJson(path.join(this.rootDirectory, 'regeneration-plan.json'), plan);
    await atomicWriteJson(path.join(this.rootDirectory, 'public/regeneration-status.json'), emptyStatus(plan, now));
    return this.snapshot();
  }

  async snapshot() {
    const sourceFiles = [
      { kind: 'plan', file: path.join(this.rootDirectory, 'regeneration-plan.json') },
      { kind: 'status', file: path.join(this.rootDirectory, 'public/regeneration-status.json') },
      { kind: 'jobs', file: path.join(this.rootDirectory, 'asset-jobs.json') },
      { kind: 'manifest', file: path.join(this.rootDirectory, 'asset_manifest.json') },
    ];
    try {
      const entries = await readdir(path.join(this.rootDirectory, '.asset-batches'), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !PLAN_ID_PATTERN.test(entry.name)) continue;
        sourceFiles.push(
          { kind: 'jobs', file: path.join(this.rootDirectory, '.asset-batches', entry.name, 'asset-jobs.json') },
          { kind: 'manifest', file: path.join(this.rootDirectory, '.asset-batches', entry.name, 'asset_manifest.json') },
        );
      }
    } catch {
      // Split batches are optional.
    }
    const reads = await Promise.all(sourceFiles.map(async (source) => ({ ...source, result: await readOptionalJson(source.file) })));
    const present = reads.filter((source) => source.result && !source.result.error);
    const plan = present.filter((source) => source.kind === 'plan').at(-1)?.result.data ?? null;
    const status = present.filter((source) => source.kind === 'status').at(-1)?.result.data ?? null;
    const manifests = present.filter((source) => source.kind === 'manifest').map((source) => publicManifest(source.result.data)).filter(Boolean);
    const manifest = manifests.reduce((combined, current) => ({
      version: Math.max(combined.version || 0, current.version || 0),
      schema: current.schema || combined.schema || '',
      route: current.route || combined.route || '',
      bindings: { ...(combined.bindings || {}), ...(current.bindings || {}) },
      assets: [...(combined.assets || []).filter((asset) => !current.assets.some((candidate) => candidate.id === asset.id)), ...current.assets],
    }), null);
    const jobs = present.filter((source) => source.kind === 'jobs').flatMap((source) => publicJobs(source.result.data));
    const latestJobs = [...new Map(jobs.map((job) => [job.id, job])).values()];
    const derivedStatus = await deriveStatus(this.rootDirectory, plan, status, manifest, latestJobs);
    return {
      serverTime: new Date(this.clock()).toISOString(),
      plan,
      status: derivedStatus,
      manifest,
      jobs: latestJobs,
      sources: reads.filter((source) => source.result).map((source) => ({
        kind: source.kind,
        path: path.relative(this.rootDirectory, source.file).replaceAll(path.sep, '/'),
        modifiedAt: source.result.modifiedAt,
        healthy: !source.result.error,
        error: source.result.error || '',
      })),
      capabilities: {
        createPlan: true,
        startsGeneration: false,
        localGlbRequired: true,
        maximumItems: MAX_ITEMS,
      },
    };
  }
}
