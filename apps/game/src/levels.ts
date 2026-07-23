import type { LevelDefinition } from './types';

export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 'skyline-relay-official',
    name: '天际跃迁',
    author: 'WhiteRoom Lab',
    type: 'reach_zone',
    typeLabel: '跑酷',
    difficulty: 2,
    estimatedMinutes: 3,
    description: '在云层之上的碎裂数据桥间跳跃，于倒计时结束前触碰远方信标。',
    objective: '在时限内抵达尽头的光信标',
    timeLimit: 95,
    killY: -7,
    spawn: [0, 0.02, 5],
    yaw: 0,
    palette: ['#77e6de', '#2e6688', '#111c2b'],
    glyph: '△',
  },
  {
    id: 'memory-garden-official',
    name: '回声花园',
    author: 'WhiteRoom Lab',
    type: 'collect',
    typeLabel: '收集',
    difficulty: 1,
    estimatedMinutes: 4,
    description: '一片被遗忘的数据花园仍在呼吸。找回散落其中的六枚记忆光核。',
    objective: '收集全部 6 枚记忆光核',
    required: 6,
    killY: -8,
    spawn: [0, 0.02, 9],
    yaw: 0,
    palette: ['#eec0ff', '#744da1', '#11142b'],
    glyph: '✦',
  },
  {
    id: 'signal-order-official',
    name: '三相协议',
    author: 'WhiteRoom Lab',
    type: 'puzzle',
    typeLabel: '谜题',
    difficulty: 2,
    estimatedMinutes: 3,
    description: '三座信号台等待重启。读懂中央投影，并按正确的色相顺序恢复协议。',
    objective: '按 金 → 青 → 紫 的顺序激活三座信号台',
    flags: ['gold', 'cyan', 'violet'],
    killY: -8,
    spawn: [0, 0.02, 8],
    yaw: 0,
    palette: ['#ffd977', '#63d8d0', '#8b62d8'],
    glyph: '≡',
  },
] as const;

export function findLevel(id: string): LevelDefinition {
  const found = LEVELS.find((level) => level.id === id);
  if (!found) throw new Error(`Unknown level: ${id}`);
  return found;
}
