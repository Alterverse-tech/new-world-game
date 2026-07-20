import { createHmac } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GRAVITY_LAW_LORE, HttpError } from './errors.js';
import { atomicWriteJson } from './store.js';
import { LOBBY_OWNER_ID_PATTERN } from './auth.js';

export { GRAVITY_LAW_LORE };

// ---------------------------------------------------------------------------
// 《眠海》世界观常量
//
// 本模块把平台的产品机制映射为《眠海》设定集 v0.1 中的世界观概念：
//   内容审核  = 沉重律（浮不起来）      身份体系  = 图腾／凝痕
//   相似溯源  = 念脉／回响／念种        协作权限  = 共笔权
//   热度归档  = 浮力法则／迷失域        用户成长  = 阶位
//   限时事件  = 梦灾                    多人同步  = 标准梦时
// ---------------------------------------------------------------------------

export const SEA_LAWS = Object.freeze([
  Object.freeze({
    id: 'exit',
    name: '出口律',
    text: '万梦必有出口。任何梦域必须存在坠醒路径，任何试图封锁出口的构造都无法凝结。',
    mechanism: '所有关卡与空间强制可退出；潜航协议的「归航」功能保证你随时找得到出口。',
  }),
  Object.freeze({
    id: 'totem',
    name: '图腾律',
    text: '图腾不可夺、不可仿、不可署他名。身份在眠海中不是可争夺的资产，而是无法转移的事实。',
    mechanism: '账号身份与创作者签名体系；凝痕由图腾派生，仿制品无法通过握持验证。',
  }),
  Object.freeze({
    id: 'gravity',
    name: '沉重律',
    text: '过于沉重之物，浮不起来。眠海不审判，它只是浮不起某些东西。',
    mechanism: '内容安全审核：违规内容不是被删除，而是潜流拒绝为它凝结。',
  }),
]);

export const STRATA = Object.freeze([
  Object.freeze({ id: 'shore', name: '岸上', summary: '物理现实。眠海无法直接作用于岸上，这条边界是绝对的。' }),
  Object.freeze({ id: 'shallows', name: '浅滩', summary: '个人夜梦的发生地，醒即消散。每位潜航者初次下潜的必经之门。' }),
  Object.freeze({ id: 'brightsea', name: '明海', summary: '被梦锚撑起的稳定共梦区，锚定梦域悬浮于此，是平台的主要空间。' }),
  Object.freeze({ id: 'abyss', name: '迷失域', summary: '未被锚定的深海，眠海的默认无序态。沉没之域在此等待打捞。' }),
]);

export const PROTOCOL_FUNCTIONS = Object.freeze([
  Object.freeze({ id: 'descend', name: '下潜', summary: '让清醒的意识进入眠海而不坠入昏睡。' }),
  Object.freeze({ id: 'sync', name: '同步', summary: '将所有接入的意识强制校准到岸上时间，即标准梦时。' }),
  Object.freeze({ id: 'filter', name: '滤念', summary: '过滤访客的潜意识杂念，防止个人心绪污染共享海域。' }),
  Object.freeze({ id: 'return', name: '归航', summary: '保证任何时刻存在坠醒通道，是出口律的技术兑现。' }),
]);

export const DREAM_ETIQUETTE = Object.freeze([
  '入他域，客随主便。',
  '未受共笔，不动他物。',
  '念种当面授受为敬。',
]);

// 阶位：初醒者 → 拾梦人 → 造梦师 → 深潜者（＝用户成长体系）
export const RANKS = Object.freeze([
  Object.freeze({
    id: 'awakened',
    name: '初醒者',
    order: 0,
    grants: ['可游历明海', '可拾取念种'],
  }),
  Object.freeze({
    id: 'gleaner',
    name: '拾梦人',
    order: 1,
    grants: ['可微调既有梦物', '可受共笔'],
  }),
  Object.freeze({
    id: 'dreamwright',
    name: '造梦师',
    order: 2,
    grants: ['可投锚建域、订立域理', '可授出念种'],
  }),
  Object.freeze({
    id: 'deepdiver',
    name: '深潜者',
    order: 3,
    grants: ['可入迷失域考古', '可打捞沉没梦域'],
  }),
]);

const RANK_BY_ID = new Map(RANKS.map((rank) => [rank.id, rank]));

export const DEFAULT_RANK_THRESHOLDS = Object.freeze({
  gleaner: Object.freeze({ total: 3 }),
  dreamwright: Object.freeze({ creations: 1 }),
  deepdiver: Object.freeze({ creations: 3, total: 10 }),
});

// 活动计数器：潜航者在眠海中的每一类留痕
export const ACTIVITY_KINDS = Object.freeze([
  'dives', // 下潜（进入梦域）
  'shapes', // 凝结梦物（摆放物件）
  'interacts', // 触碰梦物（互动）
  'anchors', // 投锚（认领地块）
  'wishes', // 许愿（发起潜流凝结请求）
  'creations', // 凝结成形（上传/生成完成的造物）
  'salvages', // 打捞（梦境考古）
  'seedsGranted', // 授出念种
  'seedsReceived', // 承种
  'echoes', // 回响（重凝他人造物）
]);
const ACTIVITY_KIND_SET = new Set(ACTIVITY_KINDS);

// 图腾形态素材：形制取自设定集附录 B 的留白（怀表、生锈的钥匙……）
const TOTEM_FORMS = Object.freeze([
  '怀表', '生锈的钥匙', '黄铜罗盘', '单翼纸鸢', '裂纹陶铃', '半融的蜡烛',
  '褪色船票', '鲸骨哨', '缺角棋子', '无字信笺', '单面镜', '断弦怀琴',
  '空茧', '盐晶沙漏', '折角海图', '哑光铃铛',
]);
const TOTEM_MATERIALS = Object.freeze([
  '旧银', '沉水木', '磨砂玻璃', '白瓷', '蜜蜡', '陨铁', '乌木', '月光石',
]);
const TOTEM_MOTIFS = Object.freeze([
  '潮汐纹', '星图', '涡旋', '鳞纹', '云雷纹', '盐晶簇', '月相环', '暗礁影',
]);
const TOTEM_AURAS = Object.freeze([
  '握在掌心时微微发烫', '靠近耳边能听见退潮声', '在完全的黑暗里泛着微光',
  '永远比周围的空气凉一度', '偶尔无风自颤', '沾不上任何灰尘',
]);

export const GLOSSARY = Object.freeze([
  Object.freeze({ term: '眠海', meaning: '全人类睡梦沉积而成的意识海洋，本世界的舞台。', product: '平台本体' }),
  Object.freeze({ term: '潜航者', meaning: '经由潜航协议进入眠海的人。', product: '用户' }),
  Object.freeze({ term: '潜流', meaning: '眠海的成形本能，听取愿念、凝结万物。', product: '生成式 AI（prop 生成流水线）' }),
  Object.freeze({ term: '愿念', meaning: '对潜流发出的创造请求。', product: '生成指令（prop prompt）' }),
  Object.freeze({ term: '梦物', meaning: '被凝结的可存留超现实造物。', product: 'UGC 物件（prop / avatar / GLB 资产）' }),
  Object.freeze({ term: '梦域', meaning: '被锚定、有域理的海域。', product: '关卡（.wrlevel）与大厅频道' }),
  Object.freeze({ term: '梦锚', meaning: '令梦域在梦主离线后存续之物。', product: '内容持久化' }),
  Object.freeze({ term: '梦主', meaning: '梦域的锚定者，在场时拥有最高解释权。', product: '房主 / 地块主人' }),
  Object.freeze({ term: '共笔权', meaning: '梦主授予访客的域内创作权。', product: '地块协作权限' }),
  Object.freeze({ term: '图腾', meaning: '潜意识自凝的身份之锚，不可夺不可仿。', product: '账号身份' }),
  Object.freeze({ term: '凝痕', meaning: '图腾派生的创作签名。', product: '创作者数字签名' }),
  Object.freeze({ term: '念脉', meaning: '潜流保存的创作来历记录。', product: '内容哈希溯源谱系' }),
  Object.freeze({ term: '回响', meaning: '与既有梦物过于相似的凝结产物，自动带原作凝痕。', product: '重复内容自动溯源' }),
  Object.freeze({ term: '念种', meaning: '原作者授予的「被启发的权利」。', product: 'remix 授权凭证' }),
  Object.freeze({ term: '投影', meaning: '梦域原住民兼免疫系统。', product: '系统管理物件（realm-system）' }),
  Object.freeze({ term: '坠醒', meaning: '离开眠海的动作。', product: '退出 / 登出' }),
  Object.freeze({ term: '标准梦时', meaning: '协议强制的全海时间同步。', product: '多人实时同步' }),
  Object.freeze({ term: '浮力法则', meaning: '梦以被梦见为生，无人访问则下沉。', product: '热度与自然归档' }),
  Object.freeze({ term: '梦境考古', meaning: '深入迷失域打捞沉没造物。', product: '归档内容探索' }),
  Object.freeze({ term: '梦灾', meaning: '愿念对撞或滤念失效引发的域理紊乱。', product: '限时全服事件' }),
  Object.freeze({ term: '阶位', meaning: '初醒者 → 拾梦人 → 造梦师 → 深潜者。', product: '用户成长体系' }),
]);

const LINEAGE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const LINEAGE_KINDS = new Set(['level', 'avatar', 'lobby-asset', 'prop']);
const MAX_SEEDS_PER_LINEAGE = 64;
const MAX_ECHOES_PER_LINEAGE = 256;
const MAX_CALAMITIES = 16;
const MAX_CALAMITY_TITLE_CHARACTERS = 80;
const MAX_CALAMITY_NOTE_CHARACTERS = 240;
const CALAMITY_CHANNEL_PATTERN = /^(?:[0-9]{4,12}|space-[0-9]{4,12}-(?:heaven|hell))$/;
const BUOYANCY_PERSIST_DELAY_MS = 2_000;

function normalizedLoreText(value, maximumCharacters, field) {
  if (typeof value !== 'string') {
    throw new HttpError(422, `invalid_${field}`, `${field} must be a string`);
  }
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximumCharacters || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpError(422, `invalid_${field}`, `${field} must be 1-${maximumCharacters} characters`);
  }
  return normalized;
}

function validOwnerId(value) {
  return LOBBY_OWNER_ID_PATTERN.test(value ?? '');
}

export function validateLineageHash(value) {
  if (typeof value !== 'string' || !LINEAGE_HASH_PATTERN.test(value)) {
    throw new HttpError(422, 'invalid_lineage_hash', 'A 64-character sha256 hex hash is required');
  }
  return value;
}

export function rankMeetsRequirement(rankId, requiredId) {
  const rank = RANK_BY_ID.get(rankId);
  const required = RANK_BY_ID.get(requiredId);
  if (!rank || !required) return false;
  return rank.order >= required.order;
}

function emptyCounts() {
  return Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0]));
}

function normalizedCounts(value) {
  const counts = emptyCounts();
  if (value && typeof value === 'object') {
    for (const kind of ACTIVITY_KINDS) {
      const stored = value[kind];
      if (Number.isSafeInteger(stored) && stored >= 0) counts[kind] = stored;
    }
  }
  return counts;
}

export class DreamseaStore {
  constructor({
    dataDirectory,
    clock = Date.now,
    secret,
    sinkAfterMs = 30 * 24 * 60 * 60_000,
    rankThresholds = DEFAULT_RANK_THRESHOLDS,
    logger = console,
  }) {
    if (!dataDirectory) throw new Error('DreamseaStore requires a data directory');
    if (!secret) throw new Error('DreamseaStore requires a signing secret');
    if (!Number.isSafeInteger(sinkAfterMs) || sinkAfterMs < 1_000) {
      throw new Error('sinkAfterMs must be at least 1000 milliseconds');
    }
    this.rootDirectory = path.join(path.resolve(dataDirectory), 'dreamsea');
    this.totemsDirectory = path.join(this.rootDirectory, 'totems');
    this.journeysDirectory = path.join(this.rootDirectory, 'journeys');
    this.lineageDirectory = path.join(this.rootDirectory, 'lineage');
    this.buoyancyPath = path.join(this.rootDirectory, 'buoyancy.json');
    this.calamitiesPath = path.join(this.rootDirectory, 'calamities.json');
    this.clock = clock;
    this.secret = secret;
    this.sinkAfterMs = sinkAfterMs;
    this.rankThresholds = {
      gleaner: { ...DEFAULT_RANK_THRESHOLDS.gleaner, ...rankThresholds?.gleaner },
      dreamwright: { ...DEFAULT_RANK_THRESHOLDS.dreamwright, ...rankThresholds?.dreamwright },
      deepdiver: { ...DEFAULT_RANK_THRESHOLDS.deepdiver, ...rankThresholds?.deepdiver },
    };
    this.logger = logger;
    this.totems = new Map();
    this.journeys = new Map();
    this.lineages = new Map();
    this.buoyancy = new Map();
    this.calamities = [];
    this.appliedSunkenIds = new Set();
    this.buoyancyDirty = false;
    this.buoyancyTimer = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o750 });
    await Promise.all([
      mkdir(this.totemsDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.journeysDirectory, { recursive: true, mode: 0o750 }),
      mkdir(this.lineageDirectory, { recursive: true, mode: 0o750 }),
    ]);
    const buoyancy = await this.readJsonFile(this.buoyancyPath);
    if (buoyancy?.schemaVersion === 1 && buoyancy.levels && typeof buoyancy.levels === 'object') {
      for (const [levelId, entry] of Object.entries(buoyancy.levels)) {
        if (
          /^[a-z0-9][a-z0-9-]{2,63}$/.test(levelId)
          && Number.isSafeInteger(entry?.lastVisitedAt)
          && entry.lastVisitedAt >= 0
        ) {
          this.buoyancy.set(levelId, {
            lastVisitedAt: entry.lastVisitedAt,
            visits: Number.isSafeInteger(entry.visits) && entry.visits >= 0 ? entry.visits : 0,
            salvages: Number.isSafeInteger(entry.salvages) && entry.salvages >= 0 ? entry.salvages : 0,
          });
        }
      }
    }
    const calamities = await this.readJsonFile(this.calamitiesPath);
    if (calamities?.schemaVersion === 1 && Array.isArray(calamities.calamities)) {
      this.calamities = calamities.calamities.filter((calamity) => (
        typeof calamity?.id === 'string'
        && typeof calamity.title === 'string'
        && Number.isSafeInteger(calamity.declaredAt)
        && Number.isSafeInteger(calamity.endsAt)
      ));
    }
  }

  close() {
    this.closed = true;
    if (this.buoyancyTimer) {
      clearTimeout(this.buoyancyTimer);
      this.buoyancyTimer = null;
    }
  }

  async readJsonFile(filePath) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  enqueue(action) {
    const task = this.queue.then(action);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  ownerFilePath(directory, ownerId) {
    if (!validOwnerId(ownerId)) {
      throw new HttpError(422, 'invalid_owner_id', 'A valid owner ID is required');
    }
    return path.join(directory, `${ownerId.toLowerCase()}.json`);
  }

  // -------------------------------------------------------------------------
  // 图腾与凝痕（第八章 · 第二律）
  // -------------------------------------------------------------------------

  totemDigest(ownerId) {
    return createHmac('sha256', this.secret)
      .update(`dreamsea-totem\0${ownerId.toLowerCase()}`)
      .digest();
  }

  condenseTotem(ownerId, condensedAt) {
    const digest = this.totemDigest(ownerId);
    return {
      schemaVersion: 1,
      ownerId: ownerId.toLowerCase(),
      form: TOTEM_FORMS[digest[0] % TOTEM_FORMS.length],
      material: TOTEM_MATERIALS[digest[1] % TOTEM_MATERIALS.length],
      motif: TOTEM_MOTIFS[digest[2] % TOTEM_MOTIFS.length],
      aura: TOTEM_AURAS[digest[3] % TOTEM_AURAS.length],
      sigil: `seal-${digest.toString('hex').slice(0, 12)}`,
      condensedAt,
    };
  }

  async loadTotem(ownerId) {
    const key = ownerId.toLowerCase();
    if (this.totems.has(key)) return this.totems.get(key);
    const record = await this.readJsonFile(this.ownerFilePath(this.totemsDirectory, ownerId));
    if (record?.schemaVersion === 1 && typeof record.sigil === 'string') {
      this.totems.set(key, record);
      return record;
    }
    return null;
  }

  async ensureTotem(ownerId) {
    if (!validOwnerId(ownerId)) {
      throw new HttpError(422, 'invalid_owner_id', 'A valid owner ID is required');
    }
    return this.enqueue(async () => {
      const existing = await this.loadTotem(ownerId);
      if (existing) return existing;
      const record = this.condenseTotem(ownerId, new Date(this.clock()).toISOString());
      await atomicWriteJson(this.ownerFilePath(this.totemsDirectory, ownerId), record);
      this.totems.set(record.ownerId, record);
      return record;
    });
  }

  async peekTotem(ownerId) {
    if (!validOwnerId(ownerId)) {
      throw new HttpError(422, 'invalid_owner_id', 'A valid owner ID is required');
    }
    return this.loadTotem(ownerId);
  }

  totemView(record) {
    return {
      ownerId: record.ownerId,
      form: record.form,
      material: record.material,
      motif: record.motif,
      aura: record.aura,
      sigil: record.sigil,
      condensedAt: record.condensedAt,
      description: `一件${record.material}质地的${record.form}，纹着${record.motif}，${record.aura}。`,
      lore: '图腾由你的潜意识自发凝结：不可指定，不可转让，不可复制。醒后先看图腾。',
    };
  }

  blurredTotemView(record) {
    return {
      ownerId: record.ownerId,
      sigil: record.sigil,
      focus: 'blurred',
      description: '一件小物。无论如何注视，它在你的视野中永远失焦。',
      lore: '图腾律：图腾在他人眼中永远失焦，仿制品无法通过握持验证。',
    };
  }

  async sigilFor(ownerId) {
    if (!validOwnerId(ownerId)) return null;
    const totem = await this.ensureTotem(ownerId);
    return totem.sigil;
  }

  // -------------------------------------------------------------------------
  // 旅程与阶位（第八章）
  // -------------------------------------------------------------------------

  async loadJourney(ownerId) {
    const key = ownerId.toLowerCase();
    if (this.journeys.has(key)) return this.journeys.get(key);
    const record = await this.readJsonFile(this.ownerFilePath(this.journeysDirectory, ownerId));
    if (record?.schemaVersion === 1) {
      const journey = {
        schemaVersion: 1,
        ownerId: key,
        counts: normalizedCounts(record.counts),
        startedAt: typeof record.startedAt === 'string' ? record.startedAt : new Date(this.clock()).toISOString(),
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(this.clock()).toISOString(),
      };
      this.journeys.set(key, journey);
      return journey;
    }
    return null;
  }

  async recordActivity(ownerId, kind, amount = 1) {
    if (!validOwnerId(ownerId) || !ACTIVITY_KIND_SET.has(kind)) return null;
    if (!Number.isSafeInteger(amount) || amount < 1) return null;
    return this.enqueue(async () => {
      const now = new Date(this.clock()).toISOString();
      const existing = await this.loadJourney(ownerId);
      const journey = existing ?? {
        schemaVersion: 1,
        ownerId: ownerId.toLowerCase(),
        counts: emptyCounts(),
        startedAt: now,
        updatedAt: now,
      };
      journey.counts[kind] += amount;
      journey.updatedAt = now;
      await atomicWriteJson(this.ownerFilePath(this.journeysDirectory, ownerId), journey);
      this.journeys.set(journey.ownerId, journey);
      return journey;
    });
  }

  totalActivity(counts) {
    return ACTIVITY_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
  }

  meetsThreshold(counts, threshold) {
    if (!threshold) return true;
    if (threshold.total && this.totalActivity(counts) < threshold.total) return false;
    if (threshold.creations && counts.creations < threshold.creations) return false;
    return true;
  }

  rankForCounts(counts) {
    let rank = RANKS[0];
    if (this.meetsThreshold(counts, this.rankThresholds.gleaner)) rank = RANK_BY_ID.get('gleaner');
    else return rank;
    if (this.meetsThreshold(counts, this.rankThresholds.dreamwright)) rank = RANK_BY_ID.get('dreamwright');
    else return rank;
    if (this.meetsThreshold(counts, this.rankThresholds.deepdiver)) rank = RANK_BY_ID.get('deepdiver');
    return rank;
  }

  async rankOf(ownerId) {
    if (!validOwnerId(ownerId)) return RANKS[0];
    const journey = await this.loadJourney(ownerId);
    return this.rankForCounts(journey?.counts ?? emptyCounts());
  }

  async assertRank(ownerId, requiredId) {
    const rank = await this.rankOf(ownerId);
    if (!rankMeetsRequirement(rank.id, requiredId)) {
      const required = RANK_BY_ID.get(requiredId);
      throw new HttpError(403, 'dreamsea_rank_required', `This depth requires the ${required.name} rank`, {
        requiredRank: { id: required.id, name: required.name },
        currentRank: { id: rank.id, name: rank.name },
        lore: '眠海对一个意识的信任度尚不足以让你抵达这个深度。',
      });
    }
    return rank;
  }

  nextRankView(counts, rank) {
    const next = RANKS[rank.order + 1];
    if (!next) return null;
    const threshold = this.rankThresholds[next.id] ?? {};
    const total = this.totalActivity(counts);
    const requirements = {};
    if (threshold.total) requirements.total = { required: threshold.total, current: total };
    if (threshold.creations) requirements.creations = { required: threshold.creations, current: counts.creations };
    return { id: next.id, name: next.name, grants: next.grants, requirements };
  }

  async journeyView(ownerId) {
    const journey = await this.loadJourney(ownerId);
    const counts = journey?.counts ?? emptyCounts();
    const rank = this.rankForCounts(counts);
    return {
      ownerId: ownerId.toLowerCase(),
      counts,
      totalActivity: this.totalActivity(counts),
      startedAt: journey?.startedAt ?? null,
      updatedAt: journey?.updatedAt ?? null,
      rank: { id: rank.id, name: rank.name, grants: rank.grants },
      nextRank: this.nextRankView(counts, rank),
      lore: '阶位不是头衔，而是潜深适应性——眠海对一个意识的信任度。',
    };
  }

  // -------------------------------------------------------------------------
  // 念脉、回响与念种（第六章）
  // -------------------------------------------------------------------------

  lineagePath(hash) {
    return path.join(this.lineageDirectory, `${validateLineageHash(hash)}.json`);
  }

  async loadLineage(hash) {
    if (this.lineages.has(hash)) return this.lineages.get(hash);
    const record = await this.readJsonFile(this.lineagePath(hash));
    if (record?.schemaVersion === 1 && record.hash === hash && record.origin) {
      record.seeds = Array.isArray(record.seeds) ? record.seeds : [];
      record.echoes = Array.isArray(record.echoes) ? record.echoes : [];
      this.lineages.set(hash, record);
      return record;
    }
    return null;
  }

  async recordCondensation({ hash, kind, ownerId = null, name = null }) {
    validateLineageHash(hash);
    if (!LINEAGE_KINDS.has(kind)) throw new Error(`Unknown lineage kind: ${kind}`);
    const normalizedOwner = validOwnerId(ownerId) ? ownerId.toLowerCase() : null;
    return this.enqueue(async () => {
      const now = new Date(this.clock()).toISOString();
      const existing = await this.loadLineage(hash);
      if (!existing) {
        const record = {
          schemaVersion: 1,
          hash,
          kind,
          origin: {
            ownerId: normalizedOwner,
            sigil: normalizedOwner ? this.condenseTotem(normalizedOwner, now).sigil : null,
            name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null,
            condensedAt: now,
          },
          seeds: [],
          echoes: [],
        };
        await atomicWriteJson(this.lineagePath(hash), record);
        this.lineages.set(hash, record);
        return { lineage: record, isOrigin: true, echo: null };
      }
      if (existing.origin.ownerId === normalizedOwner) {
        return { lineage: existing, isOrigin: true, echo: null };
      }
      const honored = normalizedOwner !== null
        && existing.seeds.some((seed) => seed.toOwnerId === normalizedOwner);
      const sigil = normalizedOwner ? this.condenseTotem(normalizedOwner, now).sigil : null;
      const known = existing.echoes.find((echo) => echo.ownerId === normalizedOwner && normalizedOwner !== null);
      if (known) {
        known.at = now;
        known.honored = honored;
      } else if (existing.echoes.length < MAX_ECHOES_PER_LINEAGE) {
        existing.echoes.push({ ownerId: normalizedOwner, sigil, at: now, honored });
      }
      await atomicWriteJson(this.lineagePath(hash), existing);
      return {
        lineage: existing,
        isOrigin: false,
        echo: {
          originSigil: existing.origin.sigil,
          originName: existing.origin.name,
          honored,
          lore: honored
            ? '念脉记为承种：带着原作者亲手授予的念种而来，是荣誉而非污点。'
            : '回响：外观可以几乎一致，但凝痕处叠着原作凝痕的淡影，念脉一查便知源头。',
        },
      };
    });
  }

  async grantSeed({ hash, byOwnerId, toOwnerId }) {
    validateLineageHash(hash);
    if (!validOwnerId(toOwnerId)) {
      throw new HttpError(422, 'invalid_owner_id', 'A valid recipient owner ID is required');
    }
    const granter = byOwnerId.toLowerCase();
    const recipient = toOwnerId.toLowerCase();
    if (granter === recipient) {
      throw new HttpError(422, 'dreamsea_seed_self', 'The origin dreamer already holds every right to this work');
    }
    return this.enqueue(async () => {
      const lineage = await this.loadLineage(hash);
      if (!lineage) throw new HttpError(404, 'dreamsea_lineage_not_found', 'No condensation lineage exists for this hash');
      if (lineage.origin.ownerId !== granter) {
        throw new HttpError(403, 'dreamsea_not_origin', 'Only the origin dreamer may grant a seed for this work');
      }
      if (lineage.seeds.some((seed) => seed.toOwnerId === recipient)) {
        throw new HttpError(409, 'dreamsea_seed_exists', 'This dreamer already carries a seed for this work');
      }
      if (lineage.seeds.length >= MAX_SEEDS_PER_LINEAGE) {
        throw new HttpError(409, 'dreamsea_seed_limit', `A work cannot carry more than ${MAX_SEEDS_PER_LINEAGE} seeds`);
      }
      const seed = { toOwnerId: recipient, grantedAt: new Date(this.clock()).toISOString() };
      lineage.seeds.push(seed);
      // 既有回响若来自持种者，追认为承种
      for (const echo of lineage.echoes) {
        if (echo.ownerId === recipient) echo.honored = true;
      }
      await atomicWriteJson(this.lineagePath(hash), lineage);
      return { lineage, seed };
    });
  }

  async lineageView(hash) {
    const lineage = await this.loadLineage(hash);
    if (!lineage) return null;
    return {
      hash: lineage.hash,
      kind: lineage.kind,
      origin: {
        sigil: lineage.origin.sigil,
        name: lineage.origin.name,
        condensedAt: lineage.origin.condensedAt,
      },
      seedCount: lineage.seeds.length,
      echoes: lineage.echoes.map((echo) => ({
        sigil: echo.sigil,
        at: echo.at,
        honored: echo.honored === true,
      })),
      lore: '潜流记得一切凝结的来历。你可以模仿任何东西，但你无法隐瞒你在模仿。',
    };
  }

  // -------------------------------------------------------------------------
  // 浮力法则与梦境考古（第七章）
  // -------------------------------------------------------------------------

  scheduleBuoyancyPersist() {
    this.buoyancyDirty = true;
    if (this.buoyancyTimer || this.closed) return;
    this.buoyancyTimer = setTimeout(() => {
      this.buoyancyTimer = null;
      this.flushBuoyancy().catch((error) => {
        this.logger.error?.('dreamsea buoyancy persist failed', error);
      });
    }, BUOYANCY_PERSIST_DELAY_MS);
    this.buoyancyTimer.unref?.();
  }

  async flushBuoyancy() {
    if (!this.buoyancyDirty) return;
    this.buoyancyDirty = false;
    const levels = Object.fromEntries(
      [...this.buoyancy.entries()].map(([levelId, entry]) => [levelId, { ...entry }]),
    );
    await atomicWriteJson(this.buoyancyPath, {
      schemaVersion: 1,
      updatedAt: new Date(this.clock()).toISOString(),
      levels,
    });
  }

  buoyancyEntry(levelId, { seedIfMissing = false } = {}) {
    let entry = this.buoyancy.get(levelId);
    if (!entry && seedIfMissing) {
      entry = { lastVisitedAt: this.clock(), visits: 0, salvages: 0 };
      this.buoyancy.set(levelId, entry);
      this.scheduleBuoyancyPersist();
    }
    return entry ?? null;
  }

  isSunken(levelId) {
    const entry = this.buoyancy.get(levelId);
    if (!entry) return false;
    return this.clock() - entry.lastVisitedAt > this.sinkAfterMs;
  }

  noteLevelVisit(levelId, { seedIfMissing = false } = {}) {
    const entry = this.buoyancyEntry(levelId, { seedIfMissing });
    if (!entry || this.isSunken(levelId)) return null;
    entry.lastVisitedAt = this.clock();
    entry.visits += 1;
    this.scheduleBuoyancyPersist();
    return entry;
  }

  // FileStore.rebuildRegistry 的钩子：为浮着的梦域放行，沉没者移出海图
  filterRegistryLevels(levels) {
    const kept = [];
    const sunken = new Set();
    for (const level of levels) {
      this.buoyancyEntry(level.id, { seedIfMissing: true });
      if (this.isSunken(level.id)) sunken.add(level.id);
      else kept.push(level);
    }
    this.appliedSunkenIds = sunken;
    return kept;
  }

  sunkenStateChanged(records) {
    const current = new Set();
    for (const record of records) {
      if (record.status === 'approved' && this.isSunken(record.id)) current.add(record.id);
    }
    if (current.size !== this.appliedSunkenIds.size) return true;
    for (const id of current) {
      if (!this.appliedSunkenIds.has(id)) return true;
    }
    return false;
  }

  abyssView(records) {
    const now = this.clock();
    return records
      .filter((record) => record.status === 'approved' && this.isSunken(record.id))
      .map((record) => {
        const entry = this.buoyancy.get(record.id);
        return {
          levelId: record.id,
          name: record.manifest.name,
          author: record.manifest.author?.name ?? null,
          description: record.manifest.description,
          publishedAt: record.publishedAt ?? null,
          lastVisitedAt: new Date(entry.lastVisitedAt).toISOString(),
          sunkForMs: Math.max(0, now - entry.lastVisitedAt - this.sinkAfterMs),
          visits: entry.visits,
        };
      })
      .sort((left, right) => left.lastVisitedAt.localeCompare(right.lastVisitedAt) || left.levelId.localeCompare(right.levelId));
  }

  async salvageLevel(levelId, record) {
    if (!record || record.status !== 'approved') {
      throw new HttpError(404, 'level_not_found', 'Level was not found');
    }
    if (!this.isSunken(levelId)) {
      throw new HttpError(409, 'dreamsea_not_sunken', 'This dream domain is still afloat in the bright sea');
    }
    const entry = this.buoyancy.get(levelId);
    entry.lastVisitedAt = this.clock();
    entry.visits += 1;
    entry.salvages += 1;
    this.buoyancyDirty = true;
    await this.flushBuoyancy();
    return {
      levelId,
      refloatedAt: new Date(entry.lastVisitedAt).toISOString(),
      salvages: entry.salvages,
      lore: '被遗忘的杰作重见天日。锚力恢复，此域重新浮上明海。',
    };
  }

  // -------------------------------------------------------------------------
  // 梦灾（第十一章）
  // -------------------------------------------------------------------------

  async declareCalamity({ title, note = null, channel = null, durationMs = 60 * 60_000 }) {
    const safeTitle = normalizedLoreText(title, MAX_CALAMITY_TITLE_CHARACTERS, 'calamity_title');
    const safeNote = note === null || note === undefined
      ? null
      : normalizedLoreText(note, MAX_CALAMITY_NOTE_CHARACTERS, 'calamity_note');
    if (channel !== null && channel !== undefined && !CALAMITY_CHANNEL_PATTERN.test(channel)) {
      throw new HttpError(422, 'invalid_calamity_channel', 'calamity channel must be a valid lobby channel');
    }
    if (!Number.isSafeInteger(durationMs) || durationMs < 60_000 || durationMs > 7 * 24 * 60 * 60_000) {
      throw new HttpError(422, 'invalid_calamity_duration', 'durationMs must be between 1 minute and 7 days');
    }
    return this.enqueue(async () => {
      const now = this.clock();
      this.calamities = this.calamities.filter((calamity) => calamity.endsAt > now);
      if (this.calamities.length >= MAX_CALAMITIES) {
        throw new HttpError(409, 'dreamsea_calamity_limit', `No more than ${MAX_CALAMITIES} calamities may rage at once`);
      }
      const digest = createHmac('sha256', this.secret).update(`calamity\0${now}\0${safeTitle}`).digest('hex');
      const calamity = {
        id: `calamity-${digest.slice(0, 12)}`,
        title: safeTitle,
        note: safeNote,
        channel: channel ?? null,
        declaredAt: now,
        endsAt: now + durationMs,
      };
      this.calamities.push(calamity);
      await atomicWriteJson(this.calamitiesPath, {
        schemaVersion: 1,
        updatedAt: new Date(now).toISOString(),
        calamities: this.calamities,
      });
      return this.calamityView(calamity);
    });
  }

  calamityView(calamity) {
    return {
      id: calamity.id,
      title: calamity.title,
      note: calamity.note,
      channel: calamity.channel,
      declaredAt: new Date(calamity.declaredAt).toISOString(),
      endsAt: new Date(calamity.endsAt).toISOString(),
    };
  }

  activeCalamities() {
    const now = this.clock();
    return this.calamities
      .filter((calamity) => calamity.endsAt > now)
      .map((calamity) => this.calamityView(calamity));
  }

  // -------------------------------------------------------------------------
  // 世界观元数据
  // -------------------------------------------------------------------------

  worldviewView() {
    return {
      sea: '眠海',
      motto: '在眠海中，想象即施工，同行即共梦。',
      standardDreamTime: new Date(this.clock()).toISOString(),
      strata: STRATA,
      seaLaws: SEA_LAWS,
      protocol: { name: '潜航协议', functions: PROTOCOL_FUNCTIONS },
      etiquette: DREAM_ETIQUETTE,
      ranks: RANKS.map((rank) => ({
        id: rank.id,
        name: rank.name,
        order: rank.order,
        grants: rank.grants,
      })),
      buoyancy: {
        law: '梦以被梦见为生。有人到访的梦域获得浮力；久无人至，锚力渐衰，梦域缓缓下沉，没入迷失域。',
        sinkAfterMs: this.sinkAfterMs,
      },
      calamities: this.activeCalamities(),
      glossary: GLOSSARY,
    };
  }
}
