import type { LobbyPropModule } from './types';
import { approvedLobbyPropModules } from './approved-modules';

const registry = new Map<string, LobbyPropModule>();

for (const [index, candidate] of approvedLobbyPropModules.entries()) {
  const path = `approved-modules[${index}]`;
  if (
    typeof candidate.code !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,63}$/.test(candidate.code) ||
    typeof candidate.createLobbyProp !== 'function'
  ) {
    console.warn(`[WhiteRoom] 忽略无效大厅物件模块：${path}`);
    continue;
  }
  if (registry.has(candidate.code)) {
    console.warn(`[WhiteRoom] 忽略重复大厅物件代码：${candidate.code}`);
    continue;
  }
  registry.set(candidate.code, candidate as LobbyPropModule);
}

export function getLobbyPropModule(code: string): LobbyPropModule | null {
  return registry.get(code) ?? null;
}

export function listLobbyPropCodes(): string[] {
  return [...registry.keys()].sort();
}
