import tuibingzi from './tuibingzi/index.js';
import xihua from './xihua/index.js';
import supermeng from './supermeng/index.js';

/**
 * 游戏注册表
 * 新增玩法只需在 games/ 下实现同一接口的模块，然后在此登记。
 */
const modules = new Map();

export function registerGame(mod) {
  modules.set(mod.id, mod);
}

registerGame(tuibingzi);
registerGame(xihua);
registerGame(supermeng);

export function getGame(id) {
  return modules.get(id) || null;
}

export function listGames() {
  return [...modules.values()].map((m) => ({
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    minPlayers: m.minPlayers,
    maxPlayers: m.maxPlayers,
    accent: m.accent,
    enabled: true,
    configSchema: m.configSchema,
    defaultConfig: m.defaultConfig(),
    rules: m.rulesSummary(m.defaultConfig()),
    rulesVariants: m.rulesVariants ? m.rulesVariants() : [],
  }));
}

export default { registerGame, getGame, listGames };
